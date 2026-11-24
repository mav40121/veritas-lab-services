// server/ptRecords.ts
//
// Whether any VeritaPT result holds a record of its own (B11, 2026-11-24), so a delete would take the laboratory's evidence
// with it. Kept apart from the modules that write those records, so each of them adds its table here.

/** True when any of these results has the laboratory's evaluation on file, or is part of a reviewed event or one with a report. */
export function ptResultsHoldRecords(sqlite: any, resultIds: number[]): boolean {
  return resultIds.some((id) => !!sqlite.prepare("SELECT 1 FROM pt_event_evaluations WHERE event_id = ? LIMIT 1").get(id)
    || !!sqlite.prepare("SELECT 1 FROM pt_event_reviews r, json_each(r.result_ids_json) j WHERE j.value = ? LIMIT 1").get(id)
    || !!sqlite.prepare("SELECT 1 FROM pt_event_documents d, json_each(d.result_ids_json) j WHERE j.value = ? LIMIT 1").get(id));
}
