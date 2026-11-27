// shared/competencyObservation.ts
//
// B5 (signatures mock 2, 2026-11-27): competency signed by the person who watched and the person who evaluated. The owner
// picked the recommended answer on all three questions:
//   Q1  a sign-off done on paper and entered later by someone else is kept, marked From paper, with where the paper is and who
//       recorded it (howSignedText);
//   Q2  for entries made after this goes live, the observer named on Element 1 and Element 4 signs before the method can be a
//       Pass (observerPassProblem); entries made before stay as they are and print as recorded;
//   Q3  someone can sign as observer or evaluator from a Staff login, their own signature only, with no editing.
// The observer signs Elements 1 and 4 (direct observation of routine testing, and of maintenance and function checks; 42 CFR
// 493.1451(b)(8), 493.1413(b)(8)) with their own name and password, or their hospital sign-in (server/eSignature.ts
// verifySigner). Who may be the observer and who may sign a method are today's rules, unchanged (server/competencyObserver.ts,
// shared/competencySignoff.ts). Pure rules shared by the server, the screens and the printed record.

import { normInitials } from "./competencyObserver";

/** The elements a named observer signs. */
export const OBSERVED_ELEMENTS = [1, 4] as const;
export const isObservedElement = (n: unknown): boolean => Number(n) === 1 || Number(n) === 4;

/** Up to this many observations in one signature, as bulk document approval allows a batch. */
export const OBSERVATION_SIGN_MAX = 50;

/** The observer's own date column for an element. Element 1's is new with this build. */
export const observedDateColumn = (el: number): "el1_date_observed" | "el4_date_observed" => (el === 1 ? "el1_date_observed" : "el4_date_observed");

/**
 * What an observer's signature covers, as one string compared exactly: the specimen watched (Element 1), the date observed, the
 * observer named and the result. Change any of it after signing and the signature no longer holds; the observer signs again.
 */
export function observationContent(row: any, el: number): string {
  const watched = el === 1 ? String(row?.el1_specimen_id ?? "").trim() : "";
  const date = String(row?.[observedDateColumn(el)] ?? "").trim().slice(0, 10);
  const observer = normInitials(el === 1 ? row?.el1_observer_initials : row?.el4_observer_initials);
  return JSON.stringify([el, watched, date, observer, row?.passed ? 1 : 0]);
}

/** One observer's signature on an element, as the screens and the record show it. */
export interface ObserverSignature {
  id: number;
  name: string;          // the observer's VeritaStaff name
  role: string | null;   // LD, TC or TS
  typedName: string;
  signedAt: string;      // ISO instant
  signedAtText: string;  // "11/24/2026 9:41 AM EST", in the lab's time zone
  signedWith: string | null;
  provider: string | null;
  dateObserved: string;
  result: "pass" | "fail";
}

/** An Element 1 or 4 entry's observer state. */
export interface ObserverState {
  /** Entered after this went live, so a Pass waits for the observer's signature (Q2 = 1). False for entries made before. */
  required: boolean;
  /** The VeritaStaff person the entry names, when it names one. */
  observerStaffEmployeeId: number | null;
  observerName: string | null;
  signed: ObserverSignature | null;
  /** A signature is on file but the entry changed after it, so it no longer holds. */
  changedAfterSigning: boolean;
}

/** The observed elements still waiting for their observer, on a method whose entries need it. */
export function observersWaiting(elements: Array<{ num: number; status?: string; na?: boolean; observer?: ObserverState | null }>): Array<{ num: number; observerName: string | null }> {
  return (elements || [])
    .filter((e) => isObservedElement(e.num) && !e.na && e.status !== "na" && e.observer?.required && !e.observer?.signed)
    .map((e) => ({ num: Number(e.num), observerName: e.observer?.observerName ?? null }));
}

/**
 * Why a method can't be signed electronically as a Pass while an observer hasn't signed, or null. Fail and Remediation Required
 * stay open either way (Q2 = 1). A sign-off from paper isn't held by this: the paper carries both signatures.
 */
export function observerPassProblem(methodName: string, elements: Array<{ num: number; status?: string; na?: boolean; observer?: ObserverState | null }>): string | null {
  const waiting = observersWaiting(elements);
  if (!waiting.length) return null;
  const list = waiting.map((w) => `Element ${w.num} (${w.observerName || "no observer named"})`).join(" and ");
  return `${methodName} can't be signed as a Pass until the observer signs ${list}. Fail and Remediation Required can still be signed.`;
}

/** What the record says of a sign-off made before this build: it was recorded, not signed. */
export const NOT_ESIGNED_TEXT = "Recorded in VeritaComp™, not electronically signed";

/** How a method sign-off was made, for its line on the record and the screen. */
export interface MethodHowSigned {
  signedWith?: string | null;
  provider?: string | null;
  fromPaper?: boolean;
  paperLocation?: string | null;
  recordedByName?: string | null;
  recordedDate?: string | null; // YYYY-MM-DD, lab date
}

const mdy = (iso: string | null | undefined): string => {
  const s = String(iso || "").slice(0, 10);
  const [y, m, d] = s.split("-");
  return y && m && d ? `${m}/${d}/${y}` : s;
};

export function howSignedText(s: MethodHowSigned | null | undefined): string {
  if (!s) return NOT_ESIGNED_TEXT;
  if (s.fromPaper) {
    const where = String(s.paperLocation || "").trim().replace(/\.+$/, "");
    const by = s.recordedByName ? ` Recorded by ${s.recordedByName}${s.recordedDate ? ` ${mdy(s.recordedDate)}` : ""}.` : "";
    return `From paper.${where ? ` ${where}.` : ""}${by}`;
  }
  if (s.signedWith === "sso") return `Electronically, ${s.provider ? `${s.provider} sign-in` : "hospital sign-in"}`;
  if (s.signedWith === "password") return "Electronically, name and password";
  return NOT_ESIGNED_TEXT;
}

/** How an observer's signature was made, after "Signed by the observer, <name>, <role>, <when>, ". */
export function observerHowText(sig: Pick<ObserverSignature, "signedWith" | "provider">): string {
  return sig.signedWith === "sso" ? `${sig.provider ? `${sig.provider} sign-in` : "hospital sign-in"}` : "name and password";
}

/** A record's fingerprint as the record prints it: the first 16 hex characters in groups of four. */
export function fingerprintGroups(hex: string | null | undefined): string {
  const s = String(hex || "").replace(/[^0-9a-f]/gi, "").toLowerCase().slice(0, 16);
  return s.match(/.{1,4}/g)?.join(" ") ?? "";
}

/** Why a method sign-off is unlocked: required, kept with the sign-off and its audit row. */
export const UNLOCK_REASON_MAX = 500;
