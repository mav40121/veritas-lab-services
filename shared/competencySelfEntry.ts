// shared/competencySelfEntry.ts
//
// What a Staff login may enter on their OWN competency record. Michael's self-service rule (2026-09-27): an employee adds
// the factual DATA on their own unsigned record (specimen IDs, dates, evidence, sample refs, quiz refs). The observer, the
// Pass/Fail verdict, N/A determinations and the evaluator stay with the evaluator, and Element 4 is the evaluator's.
// Opened to the person page on 2026-11-05 (Cathy Thornton, RFGH: staff could not enter their own specimen numbers).
// The server applies these rules from the stored row; the page uses the same list to choose which inputs to enable.
//
// Specimen and sample rows have no ids, so the evaluator's marks (Pass, initials, Acceptable) belong to a row by position.
// A merge takes the person's text by position and the marks from the stored row at that position, then cleans, so a row's
// text and marks stay together. A row carrying a mark can never be dropped, because that would slide the mark onto
// someone else's row.

import { cleanWaivedSpecimens, WAIVED_MAX_SPECIMENS, type WaivedSpecimen } from "./competencyWaivedSpecimens";
import { cleanEl5Samples, EL5_MAX_SAMPLES, type El5Sample } from "./competencyEl5Samples";

export type SelfFieldKind = "text" | "date" | "number";
export interface SelfField { column: string; kind: SelfFieldKind }

// Element number -> field key on the person page (client/src/lib/competencyElements.ts) -> stored column. Anything not
// listed here (Element 4, 7 and 8, observers, Acceptable, N/A, Pass) is the evaluator's.
export const SELF_ELEMENT_FIELDS: Record<number, Record<string, SelfField>> = {
  1: { specimenId: { column: "el1_specimen_id", kind: "text" } },
  2: { evidence: { column: "el2_evidence", kind: "text" }, date: { column: "el2_date", kind: "date" } },
  3: { qcDate: { column: "el3_qc_date", kind: "date" } },
  5: { sampleType: { column: "el5_sample_type", kind: "text" }, sampleId: { column: "el5_sample_id", kind: "text" } },
  6: { quizId: { column: "el6_quiz_id", kind: "text" }, score: { column: "el6_score", kind: "number" }, dateTaken: { column: "el6_date_taken", kind: "date" } },
};

export const isSelfEntryField = (element: number, key: string): boolean => !!SELF_ELEMENT_FIELDS[element]?.[key];

const SELF_TEXT_MAX = 2000;

export interface SelfCleaned { value?: string | number | null; error?: string }

/** One entry made ready to store: null when blank, or the reason it is refused. */
export function cleanSelfValue(kind: SelfFieldKind, raw: unknown, label: string): SelfCleaned {
  if (raw == null || raw === "") return { value: null };
  if (typeof raw !== "string" && typeof raw !== "number") return { error: `${label}: this entry is not valid.` };
  const text = String(raw).trim();
  if (!text) return { value: null };
  if (kind === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? { value: n } : { error: `${label}: enter a number.` };
  }
  if (kind === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(new Date(`${text}T00:00:00Z`).getTime())
      ? { value: text }
      : { error: `${label}: enter a valid date.` };
  }
  return text.length <= SELF_TEXT_MAX ? { value: text } : { error: `${label}: this entry is too long.` };
}

const has = (o: unknown, k: string): boolean => o != null && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

const specimenMarked = (s: WaivedSpecimen | undefined): boolean => !!s && (!!s.passed || !!s.initials);
const sampleMarked = (s: El5Sample | undefined): boolean => !!s && s.acceptable != null;

/** May the person remove this specimen row? Not if it, or a row after it, carries the evaluator's Pass or initials. */
export const selfSpecimenRemovable = (list: WaivedSpecimen[], i: number): boolean => !list.slice(i).some(specimenMarked);
/** May the person remove this sample row? Not if it, or a row after it, carries the evaluator's Acceptable mark. */
export const selfSampleRemovable = (list: El5Sample[], i: number): boolean => !list.slice(i).some(sampleMarked);

/** The person's evidence and date on each row, with Pass and initials from the stored row at that position. */
export function mergeSelfSpecimens(stored: WaivedSpecimen[], submitted: unknown, label: string): { specimens?: WaivedSpecimen[]; error?: string } {
  if (!Array.isArray(submitted)) return { error: `${label}: the specimen list is not valid.` };
  if (submitted.length > WAIVED_MAX_SPECIMENS) return { error: `${label}: no more than ${WAIVED_MAX_SPECIMENS} specimens.` };
  for (let i = submitted.length; i < stored.length; i++) {
    if (specimenMarked(stored[i])) return { error: `${label}: specimen ${i + 1} has your evaluator's Pass or initials, so it can't be removed.` };
  }
  const merged: WaivedSpecimen[] = [];
  for (let i = 0; i < submitted.length; i++) {
    const s: any = submitted[i];
    if (s == null || typeof s !== "object") return { error: `${label}: the specimen list is not valid.` };
    const prior = stored[i];
    const evidence: SelfCleaned = has(s, "evidence") ? cleanSelfValue("text", s.evidence, label) : { value: prior?.evidence ?? "" };
    if (evidence.error) return { error: evidence.error };
    const date: SelfCleaned = has(s, "date") ? cleanSelfValue("date", s.date, label) : { value: prior?.date ?? "" };
    if (date.error) return { error: date.error };
    merged.push({ evidence: String(evidence.value ?? ""), date: String(date.value ?? ""), initials: prior?.initials ?? "", passed: !!prior?.passed });
  }
  return { specimens: cleanWaivedSpecimens(merged) };
}

/** The person's sample type and ID on each row, with Acceptable from the stored row at that position. */
export function mergeSelfSamples(stored: El5Sample[], submitted: unknown, label: string): { samples?: El5Sample[]; error?: string } {
  if (!Array.isArray(submitted)) return { error: `${label}: the sample list is not valid.` };
  if (submitted.length > EL5_MAX_SAMPLES) return { error: `${label}: no more than ${EL5_MAX_SAMPLES} samples.` };
  for (let i = submitted.length; i < stored.length; i++) {
    if (sampleMarked(stored[i])) return { error: `${label}: sample ${i + 1} has your evaluator's Acceptable mark, so it can't be removed.` };
  }
  const merged: El5Sample[] = [];
  for (let i = 0; i < submitted.length; i++) {
    const s: any = submitted[i];
    if (s == null || typeof s !== "object") return { error: `${label}: the sample list is not valid.` };
    const prior = stored[i];
    const type: SelfCleaned = has(s, "sampleType") ? cleanSelfValue("text", s.sampleType, label) : { value: prior?.sampleType ?? "" };
    if (type.error) return { error: type.error };
    const id: SelfCleaned = has(s, "sampleId") ? cleanSelfValue("text", s.sampleId, label) : { value: prior?.sampleId ?? "" };
    if (id.error) return { error: id.error };
    merged.push({ sampleType: String(type.value ?? ""), sampleId: String(id.value ?? ""), acceptable: prior?.acceptable ?? null });
  }
  return { samples: cleanEl5Samples(merged) };
}
