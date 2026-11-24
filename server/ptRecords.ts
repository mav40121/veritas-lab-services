// server/ptRecords.ts
//
// Whether any VeritaPT result holds a record of its own (B11, 2026-11-24), so a delete would take the laboratory's evidence
// with it. Kept apart from the modules that write those records, so each of them adds its table here.
import { ptResults } from "./ptEvents";

export const PT_PROGRAM_HOLDS_RECORDS = { error: "A result of this enrollment has records on file, so the enrollment can't be removed.", code: "HOLDS_RECORDS" };

/** True when a result recorded against this pt_enrollments_v2 row, in its own laboratory, holds records. */
export function ptProgramHoldsRecords(sqlite: any, row: { id: number; lab_id: number | null; user_id: number }): boolean {
  // A pt_enrollments row can have the same id; ptResults tells the two apart (server/ptEvents.ts).
  const results = row.lab_id
    ? ptResults(sqlite, Number(row.lab_id)).filter((r) => r.program_key === `v2|${row.id}`).map((r) => r.id)
    : (sqlite.prepare("SELECT id FROM pt_events WHERE enrollment_id = ? AND lab_id IS NULL AND user_id = ?").all(row.id, row.user_id) as any[]).map((r) => Number(r.id));
  return ptResultsHoldRecords(sqlite, results);
}

/** True when any of these results has the laboratory's evaluation on file, or is part of a reviewed event or one with a report. */
export function ptResultsHoldRecords(sqlite: any, resultIds: number[]): boolean {
  return resultIds.some((id) => !!sqlite.prepare("SELECT 1 FROM pt_event_evaluations WHERE event_id = ? LIMIT 1").get(id)
    || !!sqlite.prepare("SELECT 1 FROM pt_event_reviews r, json_each(r.result_ids_json) j WHERE j.value = ? LIMIT 1").get(id)
    || !!sqlite.prepare("SELECT 1 FROM pt_event_documents d, json_each(d.result_ids_json) j WHERE j.value = ? LIMIT 1").get(id));
}
