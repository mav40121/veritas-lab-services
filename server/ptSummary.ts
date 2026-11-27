// server/ptSummary.ts
//
// The VeritaPT summary tile (GET /api/veritapt/summary): active enrollments, events this year, the pass rate and open
// corrective actions for one lab. Shape A broader sweep (2026-06-09): scoped by lab, not user_id, so multi-lab owners
// get per-lab numbers. Moved out of routes.ts (2026-11-11) so the compliance digest (server/digestCounts.ts) reads the
// same open corrective actions; the route's answer is unchanged.
//
// What it counts, as it always has: totalEnrollments reads pt_enrollments (analyte rows), not pt_enrollments_v2;
// eventsThisYear is every event in the server's calendar year, graded or not; passRate is ALL-TIME graded events, not
// this year's.

/**
 * Results by status with an event date from start to end, both inclusive (B11, 2026-11-24). The compliance digest's VeritaPT line
 * and the period report (server/ptReport.ts) both count with this, so they can't disagree. Graded is 'pass' or 'fail'; 'ungraded'
 * and everything else ('pending') are beside it, never in it.
 */
export function ptResultCounts(sqlite: any, labId: number, start: string, end: string) {
  const r = sqlite.prepare(
    `SELECT COUNT(*) AS total, SUM(pass_fail = 'pass') AS acceptable, SUM(pass_fail = 'fail') AS unacceptable, SUM(pass_fail = 'ungraded') AS ungraded
       FROM pt_events WHERE lab_id = ? AND substr(event_date, 1, 10) BETWEEN ? AND ?`
  ).get(labId, start, end) as any;
  const n = (v: unknown) => Number(v || 0);
  const acceptable = n(r?.acceptable), unacceptable = n(r?.unacceptable), ungraded = n(r?.ungraded);
  return { acceptable, unacceptable, ungraded, not_graded: n(r?.total) - acceptable - unacceptable - ungraded, graded: acceptable + unacceptable };
}

export function ptSummaryForLab(sqlite: any, labId: number) {
  const totalEnrollments = (sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pt_enrollments WHERE lab_id = ? AND status = 'active'"
  ).get(labId) as any).cnt;

  const currentYear = new Date().getFullYear().toString();
  const eventsThisYear = (sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pt_events WHERE lab_id = ? AND strftime('%Y', event_date) = ?"
  ).get(labId, currentYear) as any).cnt;

  const passCount = (sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pt_events WHERE lab_id = ? AND pass_fail = 'pass'"
  ).get(labId) as any).cnt;
  const failCount = (sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pt_events WHERE lab_id = ? AND pass_fail = 'fail'"
  ).get(labId) as any).cnt;
  const gradedTotal = passCount + failCount;
  const passRate = gradedTotal > 0 ? Math.round((passCount / gradedTotal) * 1000) / 10 : 0;

  const openCorrectiveActions = (sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pt_corrective_actions WHERE lab_id = ? AND status = 'open'"
  ).get(labId) as any).cnt;

  return { totalEnrollments, eventsThisYear, passRate, openCorrectiveActions };
}
