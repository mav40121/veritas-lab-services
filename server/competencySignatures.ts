// server/competencySignatures.ts
//
// B5 (signatures mock 2, 2026-11-27; shared/competencyObservation.ts has the rules and the owner's three answers). The server
// half of "signed by the person who watched and the person who evaluated":
//   - who the signed-in person is on this lab's VeritaStaff roster (server/ownRoster.ts, from the session; never a name picked
//     from a list), so the observer and the evaluator each sign as themselves;
//   - an Element 1 or 4 entry's observer state, read from its row and the observer's signature row: a signature holds only while
//     the entry still reads as it did when signed;
//   - what an evaluator's save carries over from the rows it replaces (the observer's signature, and whether the entry was made
//     before this went live);
//   - the record's fingerprint, SHA-256 of the frozen entries, made by the server when a method is signed.
import crypto from "crypto";
import { matchObserver, type QualifiedObserver } from "./competencyObserver";
import { ownRosterRows } from "./ownRoster";
import { elementHasData } from "@shared/competencyStatus";
import { isObservedElement, observationContent, type ObserverSignature, type ObserverState } from "@shared/competencyObservation";

/** The signed-in person's own roster row in this lab (a Staff login's seat, or a sign-in linked in VeritaStaff), or null. */
export function ownStaffIdInLab(sqlite: any, userId: number, labId: number): number | null {
  const row = ownRosterRows(sqlite, Number(userId), Number(labId))[0];
  return row ? Number(row.id) : null;
}

/** "11/24/2026 9:41 AM EST" in the lab's time zone. */
export function signedAtText(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
      .format(d).replace(",", "");
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** A person's name as people say it ("Casey Tate"), from a QualifiedObserver. */
export const observerDisplayName = (o: QualifiedObserver): string => `${o.firstName || ""} ${o.lastName || ""}`.trim() || o.name;

/** Every observer signature on one person's competency in this lab, by id. */
export function loadObservationSignatures(sqlite: any, labId: number, staffEmployeeId: number): Map<number, any> {
  const rows = sqlite.prepare("SELECT * FROM competency_observation_signatures WHERE lab_id = ? AND staff_employee_id = ?").all(labId, staffEmployeeId) as any[];
  return new Map(rows.map((r) => [Number(r.id), r]));
}

export function toObserverSignature(sig: any, tz: string): ObserverSignature {
  return {
    id: Number(sig.id), name: String(sig.observer_name || ""), role: sig.observer_role || null, typedName: String(sig.typed_name || ""),
    signedAt: String(sig.signed_at || ""), signedAtText: signedAtText(sig.signed_at, tz),
    signedWith: sig.signed_with || null, provider: sig.signed_with_provider || null,
    dateObserved: String(sig.date_observed || ""), result: sig.result === "fail" ? "fail" : "pass",
  };
}

/** An Element 1 or 4 row's observer state. A signature holds only while the entry reads as it did when signed. */
export function observerStateFor(row: any, el: number, ctx: { sigById: Map<number, any>; observers: QualifiedObserver[]; tz: string }): ObserverState {
  const value = el === 1 ? row?.el1_observer_initials : row?.el4_observer_initials;
  const o = value ? matchObserver(ctx.observers, value) : undefined;
  const sig = row?.observer_signature_id != null ? ctx.sigById.get(Number(row.observer_signature_id)) : null;
  const holds = !!sig && sig.signed_content === observationContent(row, el);
  return {
    required: Number(row?.observer_sign_required) === 1,
    observerStaffEmployeeId: o ? o.employeeId : null,
    observerName: o ? observerDisplayName(o) : null,
    signed: holds ? toObserverSignature(sig, ctx.tz) : null,
    changedAfterSigning: !!sig && !holds,
  };
}

/**
 * What an evaluator's save (PUT .../test-system/:instrumentId, which replaces the method's working rows) keeps from the row it
 * replaces for element n: the observer's signature (it still holds only if the entry reads the same), and whether the entry was
 * made before this went live. An entry with data from before stays as recorded (NULL); anything entered now is 1.
 */
export function carriedObserverColumns(oldRow: any | null | undefined, n: number): { observer_sign_required: number | null; observer_signature_id: number | null } {
  const signatureId = oldRow?.observer_signature_id != null && isObservedElement(n) ? Number(oldRow.observer_signature_id) : null;
  if (oldRow && Number(oldRow.observer_sign_required) === 1) return { observer_sign_required: 1, observer_signature_id: signatureId };
  if (oldRow && elementHasData(oldRow, n)) return { observer_sign_required: null, observer_signature_id: signatureId };
  return { observer_sign_required: 1, observer_signature_id: signatureId };
}

// What the fingerprint leaves out: row ids and the pointer the sign-off itself sets. Empty values are left out too, so a column
// added later (NULL on every frozen row) doesn't change a fingerprint made before it.
const FINGERPRINT_SKIP = new Set(["id", "assessment_id", "signoff_id"]);
const canonicalRow = (row: any): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const k of Object.keys(row || {}).sort()) {
    const v = row[k];
    if (FINGERPRINT_SKIP.has(k) || v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
};

/** The record's fingerprint: SHA-256 of the sign-off and the entries it froze, made by the server, never sent by a screen. */
export function recordFingerprint(signoff: any, frozenRows: any[]): string {
  const head = {
    lab: Number(signoff.lab_id), person: Number(signoff.staff_employee_id), method: Number(signoff.instrument_id),
    milestone: signoff.milestone ?? null, signedDate: signoff.signed_date ?? null, determination: signoff.determination ?? "pass",
    signer: signoff.signer_staff_employee_id ?? null, signerName: signoff.signer_name ?? null, signerRole: signoff.signer_role ?? null,
    typedName: signoff.typed_name ?? null, signedWith: signoff.signed_with ?? null, fromPaper: Number(signoff.from_paper) === 1,
    paperLocation: signoff.paper_location ?? null, remediationPlan: signoff.remediation_plan ?? null,
  };
  const items = (frozenRows || []).map(canonicalRow).sort((a, b) =>
    (Number(a.element_number ?? a.waived_method_number ?? 0) - Number(b.element_number ?? b.waived_method_number ?? 0))
    || JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return crypto.createHash("sha256").update(JSON.stringify({ head, items })).digest("hex");
}
