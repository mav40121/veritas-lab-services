// server/verificationSignatures.ts
//
// B4 (2026-11-27, mock 1 of the 11/24 signatures mocks; the owner picked the recommended answer on all three questions).
//   - A VeritaCheck(R) verification package has a plan: what each element tests, for which analytes, its acceptance criterion and
//     specimens. The medical director or a designee signs it before testing. Testing may start before it is signed (Q1); a study
//     dated before the plan's first signature is named on the package and on page 1. A plan changed after signing becomes a new
//     version; the signed one is kept.
//   - The finished package is signed with the signer's typed name, own password, role and Accepted or Not accepted chosen. The
//     server makes a fingerprint of what the signature covers (plan, studies, analytes, units); a change afterwards keeps the old
//     signature and its page and asks for a new one, and a signature asked for on a screen that is out of date is refused with
//     what moved.
//   - Single studies, package analytes and sign-off groups take the same signature (Q3). Rows signed before keep what they hold;
//     their PDF says how they were recorded (signed_with is empty on them).
// Who signs (Q2): the lab's designated medical director, or a Technical Consultant (moderate) or Technical Supervisor named in an
// active Letter of Delegation with the "verify test method performance" duty for the test's complexity (mayAttestAsDirectorOrDesignee,
// gate verify_method), with an active membership in the record's own laboratory. Edit access to VeritaCheck doesn't enter into it
// (B4 review, 2026-11-27): as the monthly QC co-sign decides who may co-sign, so a director on a view-only seat signs and an
// editor who isn't qualified doesn't. The account owner's override that QC co-sign allows does not apply. Veritas support and a
// Staff login never sign.
// tests/integration/verification-signatures.test.ts pins it.
import crypto from "node:crypto";
import type { SignaturePurpose } from "../shared/eSignature";
import { verifySigner, signedWithValues, type SignedWith } from "./eSignature";
import { mayAttestAsDirectorOrDesignee, complexityForAnalyte, labHighestComplexity } from "./delegationGate";
import { positionCoversComplexity, positionLabel, type DelegationComplexity, type DelegationPosition } from "./directorDelegation";
import { isVlsSupportUser } from "./vlsSupport";
import { labLocalDate, labTimeZoneById } from "./dateLocal";
import { verificationSlots } from "./verificationLinks";
import { INSTRUMENT_WIDE_ELEMENTS } from "./verificationSlots";

type Sqlite = any;
export type Refusal = { status: number; body: { error: string; code?: string; moved?: string[]; missing?: string[] } };
export type Decision = "accepted" | "not_accepted";

export const VERIFY_GATE = "verify_method" as const;
export const CANNOT_SIGN = "Only the medical director, or someone named in a signed Letter of Delegation for verifying test method performance, can sign it.";

export const ELEMENT_LABELS: Record<string, string> = {
  accuracy: "Accuracy / Bias",
  precision: "Precision",
  reportable_range: "Reportable Range",
  reference_interval: "Reference Range",
  method_comparison: "Method Comparison",
  carryover: "Carryover",
};
export const ELEMENT_ORDER = Object.keys(ELEMENT_LABELS);

// ── The signature check: S0's, the one every signature uses ─────────────────
// server/eSignature.ts verifySigner: the typed name and the signer's own password, or a fresh hospital sign-in proof bound to this
// purpose and person (where the domain requires single sign-on, only that); a wrong password counts toward the sign-in lockout.
// signedWithValues gives the signed_with / signed_with_provider columns. Its words for these purposes are VERIFICATION_WORDING
// there, the words these routes answered with before.
export const VERIFICATION_PURPOSES = ["verification_plan", "verification_package", "verification_study", "verification_analyte", "verification_signoff_group"] as const satisfies readonly SignaturePurpose[];
export type VerificationPurpose = (typeof VERIFICATION_PURPOSES)[number];
export { verifySigner, signedWithValues };
export type { SignedWith };

/** How a signature was made, for a printed line: "with name and password" or "with <hospital> sign-in". */
export function signedWithPhrase(method: string | null | undefined, provider: string | null | undefined): string {
  if (method === "sso") return `with ${provider || "hospital"} sign-in`;
  return "with name and password";
}

// ── Who signs ───────────────────────────────────────────────────────────────
export interface Signer { capacity: "medical_director" | "designee"; label: string; delegationId: number | null }

const designeeLabel = (position: unknown) => {
  try { return `Designee, ${positionLabel(position as DelegationPosition)}`; } catch { return "Designee"; }
};

/** The person's capacity to sign verification records in this lab, or why not. Decided in the record's own laboratory. */
export function signerFor(sqlite: Sqlite, labId: number | null | undefined, userId: number, complexity: DelegationComplexity): { signer: Signer } | Refusal {
  if (isVlsSupportUser(sqlite, userId)) return { status: 403, body: { error: "Veritas support sets a laboratory up and never signs for it.", code: "VLS_SUPPORT_CANNOT_SIGN" } };
  if (!labId) return { status: 403, body: { error: "This record has no laboratory, so there is no medical director or designee to sign it.", code: "NO_LAB" } };
  if (!sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(labId, userId)) {
    return { status: 403, body: { error: `${CANNOT_SIGN} Signing is for members of this record's laboratory.`, code: "NOT_A_MEMBER" } };
  }
  if (staffLoginOnly(sqlite, Number(labId), userId)) return { status: 403, body: { error: "A Staff login can't sign this. Sign in with your laboratory account to sign.", code: "STAFF_LOGIN_CANNOT_SIGN" } };
  const a = mayAttestAsDirectorOrDesignee(Number(labId), userId, VERIFY_GATE, complexity);
  if (!a.ok) return { status: 403, body: { error: CANNOT_SIGN, code: "NOT_DIRECTOR_OR_DESIGNEE" } };
  if (a.via === "medical_director") return { signer: { capacity: "medical_director", label: "Medical director", delegationId: null } };
  return { signer: { capacity: "designee", label: designeeLabel(a.position), delegationId: a.delegationId ?? null } };
}

// A director or designee on a view-only seat signs these records: their routes are on the one allow-list of signatures a view-only
// seat may make, server/qualifiedSigning.ts QUALIFIED_SIGNING_ROUTES (B4 review), because they decide by signerFor.

/** A Staff login here: an active Staff seat in this lab and no other active seat, and not the lab's owner or admin. */
function staffLoginOnly(sqlite: Sqlite, labId: number, userId: number): boolean {
  const seats = sqlite.prepare("SELECT seat_type FROM user_seats WHERE seat_user_id = ? AND lab_id = ? AND status = 'active'").all(userId, labId) as any[];
  if (!seats.some((s) => s.seat_type === "staff_portal") || seats.some((s) => s.seat_type !== "staff_portal")) return false;
  return !sqlite.prepare(
    "SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ? UNION SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner','admin') LIMIT 1"
  ).get(labId, userId, labId, userId);
}

/** What a screen shows before signing: "You sign as", or why this person can't. */
export function signAs(sqlite: Sqlite, labId: number | null | undefined, userId: number, complexity: DelegationComplexity) {
  const r = signerFor(sqlite, labId, userId, complexity);
  return "signer" in r ? { canSign: true, label: r.signer.label, reason: null } : { canSign: false, label: null, reason: r.body.error };
}

/** Everyone who can sign at this complexity: the medical director and active letters with the duty. Names and roles only. */
export function whoCanSign(sqlite: Sqlite, labId: number | null | undefined, complexity: DelegationComplexity): Array<{ name: string; role: string }> {
  if (!labId) return [];
  const out: Array<{ name: string; role: string }> = [];
  const md = sqlite.prepare(
    `SELECT COALESCE(NULLIF(TRIM(u.name), ''), l.medical_director_name, u.email) AS name FROM lab_members lm JOIN users u ON u.id = lm.user_id JOIN labs l ON l.id = lm.lab_id
      WHERE lm.lab_id = ? AND lm.status = 'active' AND l.medical_director_email IS NOT NULL AND TRIM(l.medical_director_email) != '' AND lower(u.email) = lower(l.medical_director_email) LIMIT 1`
  ).get(labId) as any;
  if (md?.name) out.push({ name: String(md.name), role: "Medical director" });
  const letters = sqlite.prepare("SELECT delegate_name, position, responsibilities_json FROM director_delegations WHERE lab_id = ? AND status = 'active' AND delegate_user_id IS NOT NULL ORDER BY id").all(labId) as any[];
  for (const l of letters) {
    let duties: any = {};
    try { duties = JSON.parse(l.responsibilities_json || "{}"); } catch { /* no duties */ }
    if (duties[VERIFY_GATE] === true && positionCoversComplexity(l.position, complexity)) out.push({ name: String(l.delegate_name || ""), role: designeeLabel(l.position) });
  }
  return out;
}

// ── Reading a signature from a request ──────────────────────────────────────
export interface Signature {
  userId: number; typedName: string; title: string; decision: Decision | null;
  capacity: Signer["capacity"]; capacityLabel: string; delegationId: number | null; at: string;
  signedWith: SignedWith;
}

export function readDecision(v: unknown): Decision | null {
  return v === "accepted" || v === "not_accepted" ? v : null;
}

/**
 * The full signature or why not, in this order: Veritas support, the signer's role in the record's laboratory, the typed name and
 * credential (verifySigner), then Accepted or Not accepted chosen (when the record takes one).
 * Body: { signature, password or ssoProof, decision?, title? }.
 */
export async function readSignature(sqlite: Sqlite, req: any, labId: number | null | undefined, complexity: DelegationComplexity, opts: { decision: boolean; purpose: VerificationPurpose }): Promise<{ sig: Signature } | Refusal> {
  const who = signerFor(sqlite, labId, req.userId, complexity);
  if (!("signer" in who)) return who;
  const body = req.body || {};
  const typed = body.signature ?? body.typedSignature;
  const verdict = await verifySigner(sqlite, req.userId, { typedName: typed, password: body.password, ssoProof: body.ssoProof, purpose: opts.purpose }, { ip: req.ip });
  if (!verdict.ok) return { status: verdict.status, body: verdict.body };
  const decision = readDecision(body.decision);
  if (opts.decision && !decision) return { status: 400, body: { error: "Choose Accepted or Not accepted. Nothing is chosen for you.", code: "DECISION_REQUIRED" } };
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : who.signer.label;
  return {
    sig: {
      userId: req.userId, typedName: String(typed).trim().slice(0, 200), title, decision: opts.decision ? decision : null,
      capacity: who.signer.capacity, capacityLabel: who.signer.label, delegationId: who.signer.delegationId, at: new Date().toISOString(),
      signedWith: verdict.signedWith,
    },
  };
}

/** The columns a signed study or package analyte stores (finalized_signature, _at and _by_user_id are written by the caller). */
export function signatureColumns(sig: Signature) {
  const [signedWith, provider] = signedWithValues(sig.signedWith);
  return {
    finalized_decision: sig.decision, signed_with: signedWith, signed_with_provider: provider, finalized_capacity: sig.capacity,
    finalized_capacity_label: sig.capacityLabel, finalized_title: sig.title, finalized_delegation_id: sig.delegationId,
  };
}

// ── Complexity ──────────────────────────────────────────────────────────────
const higher = (a: DelegationComplexity, b: DelegationComplexity): DelegationComplexity => (a === "high" || b === "high" ? "high" : "moderate");

export function studyComplexity(study: { lab_id?: number | null; test_name?: string | null }): DelegationComplexity {
  return complexityForAnalyte(Number(study.lab_id) || 0, study.test_name || null);
}

export function studiesComplexity(labId: number, studies: Array<{ test_name?: string | null }>): DelegationComplexity {
  if (!studies.length) return labHighestComplexity(labId);
  return studies.map((s) => complexityForAnalyte(labId, s.test_name || null)).reduce(higher, "moderate");
}

/** A package's complexity: the highest of its analytes' (VeritaMap), else the lab's highest. */
export function packageComplexity(sqlite: Sqlite, v: { id: number; lab_id: number | null }): DelegationComplexity {
  const labId = Number(v.lab_id) || 0;
  const names = sqlite.prepare("SELECT analyte_name FROM veritacheck_verification_analytes WHERE verification_id = ?").all(v.id) as any[];
  if (!names.length) return labHighestComplexity(labId);
  return names.map((a) => complexityForAnalyte(labId, a.analyte_name)).reduce(higher, "moderate");
}

// ── Printing ────────────────────────────────────────────────────────────────
/** "11/30/2026 9:12 AM EST" in the lab's own zone. */
export function printedMoment(instant: string | null | undefined, labId: number | null | undefined, sqlite: Sqlite): string {
  if (!instant) return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return String(instant);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: labTimeZoneById(sqlite, labId), month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d).replace(",", "");
}
/** "11/30/2026" in the lab's own zone. */
export function printedDay(instant: string | null | undefined, labId: number | null | undefined, sqlite: Sqlite): string {
  if (!instant) return "";
  const day = labLocalDate(instant, false, labTimeZoneById(sqlite, labId));
  return isoDayUs(day);
}
export const isoDayUs = (day: string | null | undefined) => (day && /^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}` : String(day || ""));

/** "the medical director" or "a designee (Technical Supervisor ...)" for the printed line. */
export function signedAsPhrase(capacity: string | null | undefined, label: string | null | undefined): string {
  if (capacity === "medical_director") return "the medical director";
  return label ? `${String(label).replace(/^Designee, /, "a designee, ")}` : "a designee";
}

export const shortFingerprint = (fp: string | null | undefined) => (fp ? String(fp).slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ") : "");
const hash = (x: unknown) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");

// ── The plan ────────────────────────────────────────────────────────────────
export interface PlanRow { element: string; analyte_ids: number[] | null; tested: string; criterion: string; specimens: string }

const text = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The plan rows a save may hold: an element the package includes, once each, analytes on the package, plain text. */
export function cleanPlanRows(raw: unknown, v: { elements?: string | null }, analyteIds: number[]): { rows: PlanRow[] } | Refusal {
  if (!Array.isArray(raw) || raw.length === 0) return { status: 400, body: { error: "A plan needs at least one element.", code: "PLAN_EMPTY" } };
  let included: string[] = [];
  try { included = JSON.parse(v.elements || "[]"); } catch { included = []; }
  const seen = new Set<string>();
  const rows: PlanRow[] = [];
  for (const r of raw as any[]) {
    const element = typeof r?.element === "string" ? r.element : "";
    if (!included.includes(element) || seen.has(element)) return { status: 400, body: { error: `"${element}" isn't an element this package includes, or is listed twice.`, code: "PLAN_ELEMENT" } };
    seen.add(element);
    let ids: number[] | null = null;
    if (Array.isArray(r.analyte_ids)) {
      ids = [...new Set((r.analyte_ids as unknown[]).map(Number))].filter((n) => Number.isInteger(n));
      if (ids.some((n) => !analyteIds.includes(n))) return { status: 400, body: { error: "An analyte in the plan isn't on this package.", code: "PLAN_ANALYTE" } };
    }
    rows.push({ element, analyte_ids: ids, tested: text(r.tested), criterion: text(r.criterion), specimens: text(r.specimens, 200) });
  }
  rows.sort((a, b) => ELEMENT_ORDER.indexOf(a.element) - ELEMENT_ORDER.indexOf(b.element));
  return { rows };
}

export const planRowsHash = (rows: PlanRow[]) => hash(rows);

export function planVersions(sqlite: Sqlite, verificationId: number): any[] {
  return (sqlite.prepare("SELECT * FROM veritacheck_verification_plans WHERE verification_id = ? ORDER BY version").all(verificationId) as any[]).map((p) => ({
    ...p, rows: (() => { try { return JSON.parse(p.rows_json || "[]"); } catch { return []; } })(),
  }));
}

// ── What a package signature covers ─────────────────────────────────────────
const STUDY_COLUMNS = `s.test_name AS testName, s.study_type AS studyType, s.date AS studyDate, s.status AS studyStatus,
  s.lifecycle_state AS studyLifecycle, s.finalized_at AS studyFinalizedAt, s.signed_with AS studySignedWith,
  s.finalized_decision AS studyDecision, s.archived_at AS studyArchivedAt, s.data_points AS studyDataPoints`;

export interface Part { key: string; label: string; hash: string }

function slotLabel(slot: any, analyteName: (id: number | null) => string | null): string {
  const el = ELEMENT_LABELS[slot.element] || slot.element;
  const who = slot.scope === "instrument" || INSTRUMENT_WIDE_ELEMENTS.has(slot.element) && slot.analyte_id == null ? null : analyteName(slot.analyte_id) || slot.analyte || null;
  return who ? `${el}, ${who}` : el;
}

type SlotState = "signed" | "attested" | "not_signed" | "superseded" | "unavailable" | "no_study";

function slotState(slot: any): SlotState {
  if (slot.manual_method === 1 && slot.passed === 1) return "attested";
  if (slot.linked_study_unavailable) return "unavailable";
  if (slot.study_id == null || slot.testName == null) return "no_study";
  if (slot.studyArchivedAt) return "superseded";
  return slot.studyLifecycle === "finalized" ? "signed" : "not_signed";
}
const STATE_WORDS: Record<SlotState, string> = {
  signed: "signed", attested: "attested by manual method", not_signed: "study not signed", superseded: "linked study was replaced by an amendment",
  unavailable: "linked study not available", no_study: "no study linked",
};

/** Everything the package page and its signature read, worked out fresh from the stored rows. */
export function packageSigning(sqlite: Sqlite, v: any) {
  const labId = v.lab_id ?? null;
  const versions = planVersions(sqlite, v.id);
  const plan = versions.length ? versions[versions.length - 1] : null;
  const firstSigned = versions.find((p) => p.signed_at) ?? null;
  let included: string[] = [];
  try { included = JSON.parse(v.elements || "[]"); } catch { included = []; }
  let reasons: Record<string, string> = {};
  try { reasons = JSON.parse(v.element_reasons || "{}"); } catch { reasons = {}; }
  const analytes = sqlite.prepare("SELECT * FROM veritacheck_verification_analytes WHERE verification_id = ? ORDER BY sort_order, id").all(v.id) as any[];
  const analyteName = (id: number | null) => (id == null ? null : analytes.find((a) => a.id === id)?.analyte_name ?? null);
  const units = sqlite.prepare("SELECT id, serial_number, model, location FROM veritacheck_verification_instruments WHERE verification_id = ? ORDER BY id").all(v.id) as any[];
  const slots = verificationSlots(sqlite, v.id, STUDY_COLUMNS).filter((s) => included.includes(s.element));

  // The studies the plan calls for: each planned analyte's slot for the element, or the element's slots when it is instrument-wide
  // or the package has no analyte rows.
  const required: any[] = [];
  const missing: string[] = [];
  if (plan) {
    for (const row of plan.rows as PlanRow[]) {
      if (!included.includes(row.element)) continue;
      const elSlots = slots.filter((s) => s.element === row.element);
      const wide = INSTRUMENT_WIDE_ELEMENTS.has(row.element) || analytes.length === 0;
      const targets = wide ? [null] : (row.analyte_ids ?? analytes.map((a) => a.id)).filter((id) => analytes.some((a) => a.id === id));
      for (const id of targets) {
        const mine = wide ? elSlots : elSlots.filter((s) => s.analyte_id === id);
        if (!mine.length) { missing.push(`${ELEMENT_LABELS[row.element]}${id != null ? `, ${analyteName(id)}` : ""}: no study linked`); continue; }
        for (const s of mine) required.push(s);
      }
    }
  }
  const described = required.map((s) => ({ slotId: s.id, label: slotLabel(s, analyteName), state: slotState(s), date: s.studyDate ?? null, passed: s.passed ?? null }));
  for (const d of described) if (d.state !== "signed" && d.state !== "attested") missing.push(`${d.label}: ${STATE_WORDS[d.state as SlotState]}`);

  // A study run before the plan's first signature (all of them while no plan is signed). Manual attestations carry no date.
  const tz = labTimeZoneById(sqlite, labId);
  const planDay = firstSigned ? labLocalDate(firstSigned.signed_at, false, tz) : null;
  const beforePlan = slots
    .filter((s) => s.testName != null && !s.linked_study_unavailable && s.studyDate && (!planDay || String(s.studyDate).slice(0, 10) < planDay))
    .map((s) => ({ slotId: s.id, label: slotLabel(s, analyteName), date: String(s.studyDate).slice(0, 10) }));

  // The fingerprint: one part per thing the signature covers, so a change can be named.
  const parts: Part[] = [];
  parts.push({ key: "plan", label: "The plan", hash: hash(plan ? { id: plan.id, version: plan.version, rows: plan.rows, signed_at: plan.signed_at } : null) });
  parts.push({ key: "elements", label: "Elements left out", hash: hash({ included, reasons: Object.fromEntries(ELEMENT_ORDER.filter((e) => !included.includes(e)).map((e) => [e, reasons[e] ?? ""])) }) });
  for (const s of slots) {
    parts.push({ key: `slot:${s.id}`, label: slotLabel(s, analyteName), hash: hash({
      study: s.study_id, passed: s.passed, manual: s.manual_method, note: s.manual_note, url: s.manual_evidence_url, summary: s.result_summary, n: s.sample_count,
      scope: s.scope, analyte: s.analyte_id, unavailable: !!s.linked_study_unavailable,
      linked: s.testName == null ? null : { name: s.testName, type: s.studyType, date: s.studyDate, status: s.studyStatus, life: s.studyLifecycle, at: s.studyFinalizedAt, decision: s.studyDecision, archived: s.studyArchivedAt, data: hash(s.studyDataPoints ?? null) },
    }) });
  }
  for (const a of analytes) parts.push({ key: `analyte:${a.id}`, label: a.analyte_name, hash: hash({ n: a.analyte_name, tea: a.tea_value, u: a.tea_units, p: a.tea_is_percentage, m: a.mdls_json, lo: a.amr_low, hi: a.amr_high, au: a.amr_units, life: a.lifecycle_state, at: a.finalized_at }) });
  for (const u of units) parts.push({ key: `unit:${u.id}`, label: `Unit S/N ${u.serial_number}`, hash: hash({ sn: u.serial_number, m: u.model, l: u.location }) });
  const fingerprint = hash(parts.map((p) => [p.key, p.hash]));

  const history = (sqlite.prepare("SELECT id, signed_at, signed_by_user_id, typed_signature, title, capacity, capacity_label, decision, signed_with, signed_with_provider, fingerprint, parts_json, covers_json, replaces_signature_id FROM veritacheck_verification_signatures WHERE verification_id = ? ORDER BY id").all(v.id) as any[]);
  const latest = history.length ? history[history.length - 1] : null;
  const current = !!latest && latest.fingerprint === fingerprint;
  const changed = latest && !current ? movedParts(JSON.parse(latest.parts_json || "[]"), parts) : [];

  const leftOut = ELEMENT_ORDER.filter((e) => !included.includes(e)).map((e) => ({ element: e, label: ELEMENT_LABELS[e], reason: reasons[e] || "" }));
  const done = described.filter((d) => d.state === "signed" || d.state === "attested");
  const covers = {
    planVersion: plan?.version ?? null,
    planSignedAt: plan?.signed_at ?? null,
    planSignedBy: plan?.typed_signature ?? null,
    studies: { total: described.length, signed: done.length, pass: done.filter((d) => d.passed === 1).length },
    beforePlan: beforePlan.map((b) => ({ label: b.label, date: b.date })),
    leftOut: leftOut.map((l) => l.label),
    units: units.map((u) => u.serial_number),
    fingerprint,
  };
  return {
    plan, versions, firstSignedAt: firstSigned?.signed_at ?? null, planSigned: !!plan?.signed_at,
    analytes: analytes.map((a) => ({ id: a.id, name: a.analyte_name, lifecycle_state: a.lifecycle_state })),
    required: described, missing, beforePlan, leftOut, units, parts, fingerprint, short: shortFingerprint(fingerprint),
    history, latest, current, changed, covers,
  };
}

/** The labels of parts that differ between two lists (changed, added or gone). */
export function movedParts(before: Part[], now: Part[]): string[] {
  const was = new Map(before.map((p) => [p.key, p]));
  const is = new Map(now.map((p) => [p.key, p]));
  const out: string[] = [];
  for (const p of now) { const b = was.get(p.key); if (!b) out.push(`${p.label} (added)`); else if (b.hash !== p.hash) out.push(p.label); }
  for (const p of before) if (!is.has(p.key)) out.push(`${p.label} (removed)`);
  return out;
}

/** A screen's copy of the parts, sent back with a signature, against the parts now. Empty when nothing moved. */
export function movedSinceShown(expect: unknown, now: Part[], fingerprint: string): string[] | null {
  const e = expect as any;
  if (!e || typeof e !== "object" || typeof e.fingerprint !== "string") return null;
  if (e.fingerprint === fingerprint) return [];
  const shown: Part[] = Array.isArray(e.parts) ? e.parts.filter((p: any) => p && typeof p.key === "string" && typeof p.hash === "string").map((p: any) => ({ key: p.key, label: String(p.label || p.key), hash: p.hash })) : [];
  const moved = movedParts(shown, now);
  return moved.length ? moved : ["Something on this package"];
}

// ── Locks ───────────────────────────────────────────────────────────────────
/**
 * A signed package analyte locks its study slots: its own, and an instrument-wide slot that covers it. An amendment draft of the
 * analyte opens them again (the amendment is then signed in its place).
 */
export function slotLockedBy(sqlite: Sqlite, verificationId: number, slotId: number): string | null {
  const slot = sqlite.prepare("SELECT analyte_id, scope, element FROM veritacheck_verification_studies WHERE id = ? AND verification_id = ?").get(slotId, verificationId) as any;
  if (!slot) return null;
  const openAmendment = "EXISTS (SELECT 1 FROM veritacheck_verification_analytes d WHERE d.amends_analyte_id = a.id AND d.lifecycle_state <> 'finalized')";
  const wide = slot.scope === "instrument" || (INSTRUMENT_WIDE_ELEMENTS.has(slot.element) && slot.analyte_id == null);
  const signed = wide
    ? sqlite.prepare(`SELECT a.analyte_name FROM veritacheck_verification_analytes a WHERE a.verification_id = ? AND a.lifecycle_state = 'finalized' AND NOT ${openAmendment} ORDER BY a.id LIMIT 1`).get(verificationId) as any
    : slot.analyte_id == null ? null
    : sqlite.prepare(`SELECT a.analyte_name FROM veritacheck_verification_analytes a WHERE a.id = ? AND a.verification_id = ? AND a.lifecycle_state = 'finalized' AND NOT ${openAmendment}`).get(slot.analyte_id, verificationId) as any;
  return signed ? String(signed.analyte_name) : null;
}
