// shared/tissueRules.ts
//
// The rules of the VeritaStock tissue sub-module (Heywood, parking lot #105, REQ-106; Michael Q152 = 1: NO PHI), shared by
// the server (server/tissue.ts) and the page (client/src/pages/VeritaStockTissuePage.tsx) so they can't disagree. Pure: no
// database and no clock. scripts/verify-tissue-rules.mts exercises every branch on a fixed input set.
//
// A record carries the supplier's tissue ID, the implant date and time, the surgeon, the requesting physician and where the
// unit was delivered, never a patient. There is no recipient field anywhere. The patient link stays in the hospital's chart:
// a lookback runs tissue ID, then our record, then the chart.

import { detectPhi } from "./phiPatterns";

export const TISSUE_STATES = ["received_mm", "stored", "issued", "implanted", "wasted", "returned", "expired"] as const;
export type TissueState = (typeof TISSUE_STATES)[number];

export const OTHER_DISPOSITIONS = ["wasted", "returned", "expired"] as const;
export type OtherDisposition = (typeof OTHER_DISPOSITIONS)[number];

// "returned" is the stored value of the terminal disposition: the unit went back to the supplier. It reads "Returned to supplier"
// so nobody takes it for a unit that came back to the blood bank unused, which is its own step ("returned_unused" below).
export const TISSUE_STATE_LABELS: Record<TissueState, string> = {
  received_mm: "Received in Materials Management",
  stored: "In blood bank storage",
  issued: "Issued",
  implanted: "Implanted",
  wasted: "Wasted",
  returned: "Returned to supplier",
  expired: "Expired",
};

export const OTHER_DISPOSITION_LABELS: Record<OtherDisposition, string> = { wasted: "Wasted", returned: "Returned to supplier", expired: "Expired" };

/** Every unit ends in exactly one of these. It's one column, so a unit can't hold two. */
export function isFinalState(state: string | null | undefined): boolean {
  return state === "implanted" || state === "wasted" || state === "returned" || state === "expired";
}

/** A unit with no final disposition shows as open on the log. */
export function isOpenOnLog(state: string | null | undefined): boolean {
  return !isFinalState(state);
}

/**
 * What makes two tissue IDs the same: case, spaces, dashes, dots and underscores don't count. The same shape as the recall
 * tracker's normalizeLot (server/stockRecallLogic.ts), so a recall's number finds the unit however either was typed.
 */
export function tissueIdKey(s: unknown): string {
  return String(s ?? "").toUpperCase().replace(/[\s\-_.]/g, "");
}

// ── Dates and times ──────────────────────────────────────────────────────────
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
export function isHhMm(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** "yes"/"no" (or true/false, 1/0) to 1/0. Anything else is unanswered: null. */
export function yesNo(v: unknown): 1 | 0 | null {
  if (v === "yes" || v === true || v === 1 || v === "1") return 1;
  if (v === "no" || v === false || v === 0 || v === "0") return 0;
  return null;
}

/** True when the second date and time is earlier than the first. A missing time counts as the start of the day. */
export function isBefore(date: string | null | undefined, time: string | null | undefined, prevDate: string | null | undefined, prevTime: string | null | undefined): boolean {
  if (!date || !prevDate) return false;
  return `${date} ${time || "00:00"}` < `${prevDate} ${prevTime || "00:00"}`;
}

// ── No PHI ───────────────────────────────────────────────────────────────────
/** The platform's no-PHI notice, as it reads on every free-text box of a tissue record. */
export const TISSUE_NO_PHI_NOTICE = "No patient information. Do not enter a patient's name, medical record number or date of birth. The link to the patient stays in the hospital's chart.";

// The platform's detectors (shared/phiPatterns.ts) are built for a corpus where the word "patient" is everywhere. These
// fields never hold a patient, so tissue routes also refuse a label that a person types in front of one. High precision:
// each needs a label. An unlabeled name can't be detected, which is why no field here is labeled for a patient.
const TISSUE_EXTRA_DETECTORS: { label: string; re: RegExp }[] = [
  { label: "Labeled patient name", re: /\b(?:patient|pt|recipient)(?:'s)?(?:\s+name)?\s*[:#]/i },
  { label: "Medical record number", re: /\b(?:mrn|mr\s?#|medical record(?:\s+(?:number|no\.?|#))?)\s*[:#]?\s*[A-Za-z]*\d{3,}/i },
  { label: "Date of birth", re: /\b(?:dob|d\.o\.b\.?|birth\s?date|date of birth)\s*[:#]?\s*\d/i },
];

/** Labels of everything in the text that looks like patient information: the platform's detectors, then the tissue ones. */
export function detectTissuePhi(text: unknown): string[] {
  const s = String(text ?? "");
  if (!s) return [];
  const found = new Set(detectPhi(s));
  for (const d of TISSUE_EXTRA_DETECTORS) if (d.re.test(s)) found.add(d.label);
  return Array.from(found);
}

/** The first string anywhere in a request body that looks like patient information: which field, and what it looks like. Never the text. */
export function findTissuePhi(body: unknown, path = ""): { field: string; labels: string[] } | null {
  if (typeof body === "string") {
    const labels = detectTissuePhi(body);
    return labels.length ? { field: path, labels } : null;
  }
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) {
      const hit = findTissuePhi(body[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      const hit = findTissuePhi(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

export function tissuePhiMessage(labels: string[]): string {
  const what = labels.map((l) => l.toLowerCase().replace("labeled ", "")).join(" and ");
  return `This looks like patient information (${what}). A tissue record never holds a patient's details: the link to the patient stays in the hospital's chart. Remove it and save again.`;
}

// ── Issue ────────────────────────────────────────────────────────────────────
export interface IssueCheckInput {
  issued_date?: string | null;
  readback_id?: unknown;
  readback_expiration?: unknown;
  readback_integrity?: unknown;
}

/** Why this unit can't be issued, in the words the person sees. Empty when it can. */
export function issueRefusals(unit: { state?: string | null; expiration_date?: string | null; source_id?: string | null }, input: IssueCheckInput, today: string): string[] {
  const out: string[] = [];
  if (unit.state !== "stored") out.push("Only a unit in blood bank storage can be issued.");
  const on = input.issued_date || today;
  if (unit.expiration_date && on > unit.expiration_date) out.push(`This unit expired on ${unit.expiration_date}, so it can't be issued.`);
  const checks: [unknown, string][] = [
    [input.readback_id, "Source ID read back and acceptable"],
    [input.readback_expiration, "Unit expiration date acceptable"],
    [input.readback_integrity, "Integrity at issue acceptable"],
  ];
  for (const [answer, label] of checks) {
    const v = yesNo(answer);
    if (v === null) out.push(`${label}: answer yes or no.`);
    else if (v === 0) out.push(`${label} was answered no, so the unit can't be issued.`);
  }
  return out;
}

// ── Returned unused: issued, not implanted, back in blood bank storage (Michael 2026-11-09) ──────────────
/** The issue fields a return to storage moves off the row into its event, so the unit can be issued again. */
export const ISSUE_ROW_FIELDS = ["issued_date", "issued_time", "requesting_physician", "issued_to", "issued_by_tech", "delivered_to", "readback_id_ok", "readback_expiration_ok", "readback_integrity_ok"] as const;

export const RETURN_UNUSED_STORAGE_LABEL = "Storage conditions maintained while out of blood bank?";
export const RETURN_UNUSED_PACKAGE_LABEL = "Package integrity acceptable on return?";

/**
 * Why a return can't put the unit back on the shelf, or null. A unit goes back to stock only when both checks are yes; a no
 * means the tissue can't be used, so what happened to it is recorded as an Other disposition instead.
 */
export function returnUnusedRefusal(storageOk: unknown, packageOk: unknown): string | null {
  const s = yesNo(storageOk);
  const p = yesNo(packageOk);
  if (s !== 0 && p !== 0) return null;
  const which = s === 0 && p === 0 ? "Storage conditions and package integrity were" : s === 0 ? "Storage conditions maintained was" : "Package integrity on return was";
  return `${which} answered no, so this unit can't go back into storage. Record what happened as an Other disposition (for example, wasted) instead.`;
}

// ── Which steps still stand on a unit, from its event chain ─────────────────────
/** Events that record a step. Corrections and the usage card change values, not where the unit is. */
export const TISSUE_STEP_EVENTS = ["received_mm", "received_bb", "issued", "implanted", "other_disposition", "returned_unused"] as const;

export interface TissueEventLite { id: number; event_type: string; detail_json?: string | null }

/**
 * The steps still standing on a unit, oldest first: every step event less the ones an undo took back. An undo names the step it
 * took back (detail.undid_event_id); one recorded before that field existed took back the latest standing step, which is what
 * every undo did then. So an undone return reads as gone and can't be undone a second time.
 */
export function liveSteps<T extends TissueEventLite>(events: T[]): T[] {
  const steps = new Set<string>(TISSUE_STEP_EVENTS);
  const stack: T[] = [];
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (steps.has(e.event_type)) { stack.push(e); continue; }
    if (e.event_type !== "undone") continue;
    let undid: number | null = null;
    try { undid = Number(JSON.parse(e.detail_json || "{}")?.undid_event_id) || null; } catch { /* no detail */ }
    if (undid == null) { stack.pop(); continue; }
    const i = stack.findIndex((s) => s.id === undid);
    if (i >= 0) stack.splice(i, 1);
  }
  return stack;
}

/** The latest return to storage that still stands, or null. */
export function lastLiveReturn<T extends TissueEventLite>(events: T[]): T | null {
  const live = liveSteps(events);
  for (let i = live.length - 1; i >= 0; i--) if (live[i].event_type === "returned_unused") return live[i];
  return null;
}

// ── How a unit reads on the log ──────────────────────────────────────────────
export interface TissueFlags {
  open: boolean;
  /** Past its expiration with no final disposition recorded. */
  expired_on_shelf: boolean;
  /** The transport temperature or the package was not acceptable at receipt. */
  receipt_problem: boolean;
  /** Implanted, and the supplier's usage card isn't recorded as returned. */
  card_pending: boolean;
}

export function tissueFlags(unit: { state?: string | null; expiration_date?: string | null; transport_temp_ok?: number | null; package_ok?: number | null; usage_card_returned?: number | null }, today: string): TissueFlags {
  const open = isOpenOnLog(unit.state);
  return {
    open,
    expired_on_shelf: open && !!unit.expiration_date && today > unit.expiration_date,
    receipt_problem: unit.transport_temp_ok === 0 || unit.package_ok === 0,
    card_pending: unit.state === "implanted" && unit.usage_card_returned !== 1,
  };
}

// ── The source line, confirmed against eCFR's renderer API (Title 21, 2026-10-01 and 2026-11-04 read the same) ────────────
export const TISSUE_CFR_TRACKING_CITATION = "21 CFR 1271.290(b)(1)";
export const TISSUE_CFR_TRACKING_QUOTE = "enables the tracking of all HCT/Ps from: (i) The donor to the consignee or final disposition; and (ii) The consignee or final disposition to the donor";
export const TISSUE_CFR_CODE_CITATION = "21 CFR 1271.290(c)";
export const TISSUE_CFR_CODE_QUOTE = "distinct identification code";

// ── Fields a correction may change, by the step that recorded them ───────────
const RECEIPT_FIELDS = ["source_id", "quantity_or_size", "expiration_date", "received_mm_date", "received_mm_time", "received_mm_by", "notes"];
const BB_FIELDS = ["received_bb_date", "received_bb_time", "received_bb_by", "transport_temp_ok", "transport_action", "package_ok", "storage_unit_id", "storage_location"];
const ISSUE_FIELDS = ["issued_date", "issued_time", "requesting_physician", "issued_to", "issued_by_tech", "delivered_to"];
const IMPLANT_FIELDS = ["implanted_date", "implanted_time", "implanted_by", "reconstituted_time", "reconstituted_by", "reconstitution_solution", "reconstitution_lot", "reconstitution_expiration"];
const DISPOSITION_FIELDS = ["disposition_date", "disposition_time", "disposition_description", "disposition_by"];

export const TISSUE_FIELD_LABELS: Record<string, string> = {
  source_id: "Tissue ID",
  quantity_or_size: "Quantity or size",
  expiration_date: "Expiration date",
  received_mm_date: "Received in Materials Management: date",
  received_mm_time: "Received in Materials Management: time",
  received_mm_by: "Received in Materials Management: by",
  notes: "Notes",
  received_bb_date: "Received in blood bank: date",
  received_bb_time: "Received in blood bank: time",
  received_bb_by: "Received in blood bank: by",
  transport_temp_ok: "Transport temperature acceptable",
  transport_action: "Action taken",
  package_ok: "Package integrity acceptable",
  storage_unit_id: "Storage unit",
  storage_location: "Storage location",
  issued_date: "Issued: date",
  issued_time: "Issued: time",
  requesting_physician: "Requesting physician",
  issued_to: "Issued to (courier)",
  issued_by_tech: "Tech issuing",
  delivered_to: "Delivered to",
  implanted_date: "Date implanted",
  implanted_time: "Time implanted",
  implanted_by: "Implanted by",
  reconstituted_time: "Reconstituted: time",
  reconstituted_by: "Reconstituted: by",
  reconstitution_solution: "Reconstituting solution",
  reconstitution_lot: "Solution lot",
  reconstitution_expiration: "Solution expiration",
  disposition_date: "Other disposition: date",
  disposition_time: "Other disposition: time",
  disposition_description: "Description of disposition",
  disposition_by: "Performed by",
};

/** Which fields a correction may change on a unit: what a step already recorded. The state and the read-backs are never corrected here. */
export function correctableFields(unit: { received_bb_date?: string | null; issued_date?: string | null; implanted_date?: string | null; disposition_date?: string | null }): string[] {
  return [
    ...RECEIPT_FIELDS,
    ...(unit.received_bb_date ? BB_FIELDS : []),
    ...(unit.issued_date ? ISSUE_FIELDS : []),
    ...(unit.implanted_date ? IMPLANT_FIELDS : []),
    ...(unit.disposition_date ? DISPOSITION_FIELDS : []),
  ];
}
