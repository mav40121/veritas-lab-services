// server/digestCounts.ts
//
// The compliance digest's shared counts (Michael's approved spec, 2026-11-10, Q281 = 1; PR 2 of 5). One function,
// digestCountsForLab, returns every section's numbers for one lab and one month of the lab's own calendar. Each count is
// the one its module's screen shows, read through the same function the screen's route calls (moved out of the routes
// for this), plus the small new counts the spec lists. The digest calls these functions directly and never the server
// over HTTP: a lab-scoped GET writes a record_views row as if a person had looked (server/recordViews.ts).
//
// Counts only. No person's name, email or id is in the result: the screens' lists name people (an overdue sample, who
// owes a signature, an assignee), and only their counts are taken here. A section that fails to compute is null, and
// the rest still come back.
//
// Two kinds of number:
//   - "now" counts (overdue, due soon, open, expired, signatures owed): as of the lab's today (asOf), which is what the
//     screens show. The issue builder (PR 3) runs at the lab's month end and freezes them.
//   - month counts (studies completed, new tests, PT results, documents changed, QC rejections): things dated inside
//     [monthStart, monthEnd] on the lab's calendar. A stored instant (UTC) is read on the lab's clock, so a 9 PM entry
//     on the 31st in New York counts in that month though its UTC day is the 1st.

import { withLabClock, labTimeZoneById, labToday, labLocalDate, addLabDays } from "./dateLocal";
import { competencyDashboardStats } from "./competencyReminders";
import { nontechnicalDueForLab, readNontechnicalFrequency } from "./competencyNontechnicalDue";
import { nontechnicalDueCounts } from "@shared/competencyNontechnicalFrequency";
import { computeCoverageForLab, studiesForMapTest, instLabel } from "./veritacheckCoverage";
import { ptSummaryForLab } from "./ptSummary";
import { policyComplianceHeadline, policyOverdueDocuments } from "./policyComplianceCounts";
import { readSignTracker } from "./policyReadSign";
import { certificateExpiryCounts, equipmentDueCounts } from "./labReadiness";
import { monthReviewItems } from "./maintainRecordReview";
import { expiredLotsOnShelf, expiredOnShelfItems } from "./inventoryLots";
import { recallCounts } from "./stockRecalls";
import { trackDashboardForLab } from "./veritatrack";
import { isFindingOpen, isFindingPastDue } from "@shared/findingCounts";
import { scanStatusCounts, AUTOMATIC_MARK_SOURCES } from "./veritascanCounts";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
// An invalid Date's toISOString throws a RangeError, so test the time first and the bad day gets this module's own message.
const validDay = (d: string) => { if (!DAY_RE.test(d)) return false; const t = new Date(`${d}T00:00:00Z`); return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d; };

export interface DigestCounts {
  labId: number;
  monthStart: string;
  monthEnd: string;
  asOf: string; // the lab's today: the date the "now" counts are as of
  timeZone: string;
  competencies: {
    overdue: number; dueIn30: number; dueIn90: number; testingStaff: number;
    nontechnical: { months: number; overdue: number; dueSoon: number; total: number } | null; // null: the lab set no frequency
  } | null;
  studies: {
    hasMap: boolean;
    overdue: number; calVerOverdue: number; methodComparisonOverdue: number;
    dueSoon: number; calVerDueSoon: number; methodComparisonDueSoon: number; // next due within 30 days
    completedInMonth: number; passedInMonth: number; failedInMonth: number;
    openDrafts: number;
  } | null;
  newTests: {
    count: number;
    items: Array<{ mapId: number; analyte: string; instrumentName: string; studyOnFile: boolean }>;
    maps: Array<{ mapId: number; mapBuiltThisMonth: boolean; newTests: number }>;
  } | null;
  pt: { unacceptableInMonth: number; openCorrectiveActions: number; acceptableYearToDate: number; gradedYearToDate: number } | null;
  documents: {
    pastReview: number; overdueReview: number; expired: number;
    signaturesOwed: number; peopleOwingSignatures: number;
    changedInMonth: number; newInMonth: number; revisedInMonth: number;
  } | null;
  certificates: { expired: number; expiringIn90: number } | null;
  maintenance: { overdue: number; dueIn30: number; reviewProblems: number; recordsWithProblems: number } | null;
  qc: { rejectedRunsInMonth: number; withoutCorrectiveAction: number } | null;
  stock: { expiredLots: number; expiredProducts: number; openRecalls: number; overdueRecalls: number } | null;
  tasks: { overdue: number; dueThisMonth: number; notStarted: number } | null;
  findings: { open: number; pastDue: number } | null;
  scan: {
    scanId: number; updatedOn: string | null;
    total: number; assessed: number; compliant: number; needsAttention: number; immediateAction: number; na: number; notAssessed: number;
    automatic: StatusTally; staff: StatusTally;
  } | null; // null: no scan
}
type StatusTally = { compliant: number; needsAttention: number; immediateAction: number; na: number };

/**
 * The digest's counts for one lab and one month of its calendar. monthStartIso and monthEndIso are YYYY-MM-DD, the
 * first and last day of the month (inclusive), on the lab's own clock. A quarterly issue (server/digestIssues.ts)
 * passes its quarter's first and last day, and every month count covers the whole quarter.
 */
export function digestCountsForLab(sqlite: any, labId: number, monthStartIso: string, monthEndIso: string): DigestCounts {
  const start = String(monthStartIso || "");
  const end = String(monthEndIso || "");
  if (!validDay(start) || !validDay(end) || end < start) throw new Error("digestCountsForLab: monthStart and monthEnd must be YYYY-MM-DD, start on or before end");
  const lab = sqlite.prepare("SELECT id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) throw new Error(`digestCountsForLab: lab ${labId} not found`);
  const tz = labTimeZoneById(sqlite, labId);
  return withLabClock(tz, () => build(sqlite, Number(labId), start, end, tz));
}

function build(sqlite: any, labId: number, start: string, end: string, tz: string): DigestCounts {
  const today = labToday();
  // Every calendar month the range touches, "YYYY-MM": one for a month, three for a quarter's issue (PR 3).
  const months: string[] = [];
  for (let m = start.slice(0, 7); m <= end.slice(0, 7); m = addLabDays(`${m}-01`, 0, 1).slice(0, 7)) months.push(m);
  // A stored value's day on the lab's calendar. A date stays as written; an instant is read on the lab's clock. SQLite's
  // datetime('now') writes "YYYY-MM-DD HH:MM:SS" in UTC with no zone, which JavaScript would read as server-local.
  const labDayOf = (value: unknown): string | null => {
    if (value == null) return null;
    const s = String(value).trim();
    if (!s) return null;
    if (DAY_RE.test(s)) return s;
    const iso = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(" ", "T")}Z`;
    const d = labLocalDate(iso);
    return DAY_RE.test(d) ? d : null;
  };
  const inMonth = (value: unknown): boolean => { const d = labDayOf(value); return !!d && d >= start && d <= end; };
  // A wide lexical pre-filter for stored instants (two days either side covers any zone), then inMonth decides.
  const lo = addLabDays(start, -2), hi = addLabDays(end, 2);
  const section = <T>(name: string, fn: () => T): T | null => {
    try { return fn(); } catch (err: any) { console.error(`[digestCounts] lab ${labId} ${name}: ${err?.message || err}`); return null; }
  };

  // 1. VeritaComp: the competency tile (GET .../competency/dashboard-stats) and non-technical due (GET .../nontechnical-due).
  const competencies = section("competencies", () => {
    const s = competencyDashboardStats(sqlite, labId, null);
    const months = readNontechnicalFrequency(sqlite, labId);
    const nt = months ? nontechnicalDueCounts(nontechnicalDueForLab(sqlite, labId, today)) : null;
    return {
      overdue: s.overdue, dueIn30: s.dueSoon30, dueIn90: s.dueSoon90, testingStaff: s.total,
      nontechnical: months && nt ? { months, overdue: nt.overdue, dueSoon: nt.dueSoon, total: nt.total } : null,
    };
  });

  // 2. VeritaCheck: Coverage (GET .../veritacheck/coverage) for what is overdue or due within 30 days, and the lab's
  // study list (GET .../studies: lab_id, not archived) for the month's studies by study date and the open drafts.
  const studies = section("studies", () => {
    const cov = computeCoverageForLab(sqlite, labId);
    const soon = addLabDays(today, 30);
    const isDueSoon = (r: { overdue: boolean; nextDueOn: string | null }) => !r.overdue && !!r.nextDueOn && r.nextDueOn >= today && r.nextDueOn <= soon;
    const calVerOverdue = cov.rows.filter((r) => r.overdue).length;
    const methodComparisonOverdue = cov.methodComparisons.filter((m) => m.overdue).length;
    const calVerDueSoon = cov.rows.filter(isDueSoon).length;
    const methodComparisonDueSoon = cov.methodComparisons.filter(isDueSoon).length;
    const rows = sqlite.prepare("SELECT status, date FROM studies WHERE lab_id = ? AND archived_at IS NULL").all(labId) as Array<{ status: string; date: string }>;
    const done = rows.filter((r) => r.status !== "draft" && inMonth(r.date));
    return {
      hasMap: cov.hasMap,
      overdue: calVerOverdue + methodComparisonOverdue, calVerOverdue, methodComparisonOverdue,
      dueSoon: calVerDueSoon + methodComparisonDueSoon, calVerDueSoon, methodComparisonDueSoon,
      completedInMonth: done.length,
      passedInMonth: done.filter((r) => r.status === "pass").length,
      failedInMonth: done.filter((r) => r.status === "fail").length,
      openDrafts: rows.filter((r) => r.status === "draft").length,
    };
  });

  // 3. VeritaMap: tests switched on in the month (veritamap_instrument_tests.active_since; NULL, from before the column,
  // never counts). A map built in the month is its first build, not new tests: it is reported as built instead.
  const newTests = section("newTests", () => {
    const maps = sqlite.prepare("SELECT id, created_at FROM veritamap_maps WHERE lab_id = ? ORDER BY id").all(labId) as Array<{ id: number; created_at: string }>;
    const built = new Set(maps.filter((m) => inMonth(m.created_at)).map((m) => m.id));
    const rows = (sqlite.prepare(
      `SELECT it.map_id, it.analyte, it.active_since, i.instrument_name, i.nickname, i.serial_number
         FROM veritamap_instrument_tests it
         JOIN veritamap_instruments i ON i.id = it.instrument_id
         JOIN veritamap_maps m ON m.id = it.map_id
        WHERE m.lab_id = ? AND it.active = 1 AND it.active_since IS NOT NULL AND it.active_since >= ? AND it.active_since < ?
        ORDER BY it.map_id, i.instrument_name, it.analyte`
    ).all(labId, lo, hi) as any[]).filter((r) => inMonth(r.active_since) && !built.has(r.map_id));
    // A study on file: saved and run (not a draft), not archived, matched as Coverage matches a study to a test.
    const onFile = sqlite.prepare("SELECT test_name, instrument, coverage_analyte FROM studies WHERE lab_id = ? AND archived_at IS NULL AND status <> 'draft'").all(labId) as any[];
    const items = rows.map((r) => ({
      mapId: Number(r.map_id), analyte: String(r.analyte), instrumentName: instLabel(r),
      studyOnFile: studiesForMapTest(onFile, r.analyte, r).length > 0,
    }));
    const perMap = new Map<number, number>();
    for (const i of items) perMap.set(i.mapId, (perMap.get(i.mapId) || 0) + 1);
    const mapsOut = maps.filter((m) => built.has(m.id) || perMap.has(m.id))
      .map((m) => ({ mapId: m.id, mapBuiltThisMonth: built.has(m.id), newTests: perMap.get(m.id) || 0 }));
    return { count: items.length, items, maps: mapsOut };
  });

  // 4. VeritaPT: the summary tile's open corrective actions (GET /api/veritapt/summary), and new counts on pt_events by
  // event date: unacceptable (graded fail) in the month, acceptable and graded from January 1 through the month's end.
  const pt = section("pt", () => {
    const summary = ptSummaryForLab(sqlite, labId);
    const count = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(labId, ...args) as any)?.n || 0);
    const yearStart = `${start.slice(0, 4)}-01-01`;
    return {
      unacceptableInMonth: count("SELECT COUNT(*) AS n FROM pt_events WHERE lab_id = ? AND pass_fail = 'fail' AND substr(event_date, 1, 10) BETWEEN ? AND ?", start, end),
      openCorrectiveActions: Number(summary.openCorrectiveActions || 0),
      acceptableYearToDate: count("SELECT COUNT(*) AS n FROM pt_events WHERE lab_id = ? AND pass_fail = 'pass' AND substr(event_date, 1, 10) BETWEEN ? AND ?", yearStart, end),
      gradedYearToDate: count("SELECT COUNT(*) AS n FROM pt_events WHERE lab_id = ? AND pass_fail IN ('pass', 'fail') AND substr(event_date, 1, 10) BETWEEN ? AND ?", yearStart, end),
    };
  });

  // 5. VeritaDC: past review as the compliance page shows it (overdue list + expired), signatures owed from the
  // read-and-sign tracker for the whole lab, and documents with a version uploaded in the month (a version carried over
  // from a prior system by the bulk load is not a change made here).
  const documents = section("documents", () => {
    const headline = policyComplianceHeadline(sqlite, labId);
    const overdueReview = policyOverdueDocuments(sqlite, labId, today).length;
    const expired = Number(headline?.expired_total || 0);
    const tracker = readSignTracker(sqlite, labId, { type: "lab", id: null });
    const versions = (sqlite.prepare(
      `SELECT v.document_id, v.version_number, v.uploaded_at,
              (SELECT MIN(v2.version_number) FROM policy_versions v2 WHERE v2.document_id = v.document_id) AS first_version
         FROM policy_versions v JOIN policy_documents d ON d.id = v.document_id
        WHERE d.lab_id = ? AND d.archived_at IS NULL AND v.uploaded_at >= ? AND v.uploaded_at < ?
          AND NOT EXISTS (SELECT 1 FROM policy_carried_records c WHERE c.version_id = v.id)`
    ).all(labId, lo, hi) as any[]).filter((v) => inMonth(v.uploaded_at));
    const changed = new Set(versions.map((v) => Number(v.document_id)));
    const created = new Set(versions.filter((v) => Number(v.version_number) === Number(v.first_version)).map((v) => Number(v.document_id)));
    return {
      pastReview: overdueReview + expired, overdueReview, expired,
      signaturesOwed: Number(tracker.totals.owes || 0),
      peopleOwingSignatures: tracker.people.filter((p) => p.owes > 0).length,
      changedInMonth: changed.size, newInMonth: created.size, revisedInMonth: changed.size - created.size,
    };
  });

  // 6. VeritaLab: expired, and expiring within 90 days (readiness uses the same count with 60).
  const certificates = section("certificates", () => {
    const c = certificateExpiryCounts(sqlite, labId, today, 90);
    return { expired: c.expired, expiringIn90: c.expiring };
  });

  // 7. VeritaMaintain: overdue and due within 30 days as readiness counts them, and the month's review problems
  // (GET .../maintain-reviews?month=, server/maintainRecordReview.ts); a quarter adds up its three months' reviews.
  const maintenance = section("maintenance", () => {
    const eq = equipmentDueCounts(sqlite, labId, today);
    const items = months.flatMap((m) => monthReviewItems(sqlite, labId, m));
    return {
      overdue: eq.overdue, dueIn30: eq.dueIn30,
      reviewProblems: items.reduce((n: number, i: any) => n + (i.problems?.length || 0), 0),
      recordsWithProblems: items.filter((i: any) => (i.problems?.length || 0) > 0).length,
    };
  });

  // 8. VeritaQC: runs in the month (result_date, the monthly review's window) with a live rejection-rule violation, and
  // how many have no corrective action. Voided runs are left out, as the monthly review leaves them out; readiness and
  // the daily review feed (qc/recent) still count them.
  const qc = section("qc", () => {
    const rows = sqlite.prepare(
      `SELECT r.id, EXISTS (SELECT 1 FROM qc_corrective_actions ca WHERE ca.qc_result_id = r.id) AS has_ca
         FROM qc_results r
        WHERE r.lab_id = ? AND r.voided_at IS NULL AND r.result_date >= ? AND r.result_date < ?
          AND EXISTS (SELECT 1 FROM qc_rule_violations v WHERE v.qc_result_id = r.id AND v.severity = 'rejection' AND v.superseded_at IS NULL)`
    ).all(labId, start, addLabDays(end, 1)) as Array<{ id: number; has_ca: number }>;
    return { rejectedRunsInMonth: rows.length, withoutCorrectiveAction: rows.filter((r) => !r.has_ca).length };
  });

  // 9. VeritaStock: this lab's expired stock (the expired-on-shelf screen covers every location of the stock group),
  // at lot level and as products; recall cases open and past due (GET .../veritastock/recalls).
  const stock = section("stock", () => {
    const r = recallCounts(sqlite, labId, today);
    return {
      expiredLots: expiredLotsOnShelf(sqlite, labId, today),
      expiredProducts: expiredOnShelfItems(sqlite, [labId], today).length,
      openRecalls: r.open, overdueRecalls: r.overdue,
    };
  });

  // 10. VeritaTrack: the dashboard cards (GET .../veritatrack/dashboard), not the worklist, whose buckets are by day
  // (today, this week, next 30 days) and which adds other modules' items (certificates, documents past review).
  const tasks = section("tasks", () => {
    const d = trackDashboardForLab(sqlite, labId, today);
    return { overdue: d.overdue, dueThisMonth: d.dueThisMonth, notStarted: d.notStarted };
  });

  // 11. VeritaResponse: open and past due by the list's rule (shared/findingCounts.ts), on the lab's day.
  const findings = section("findings", () => {
    const rows = sqlite.prepare("SELECT status, accreditor, due_date FROM findings WHERE lab_id = ?").all(labId) as any[];
    return { open: rows.filter(isFindingOpen).length, pastDue: rows.filter((f) => isFindingPastDue(f, today)).length };
  });

  // 12. VeritaScan: the most recently saved scan that isn't a teaching scan, by status as the scan list counts it, with
  // the marks VeritaCheck and VeritaComp made themselves counted apart from staff marks.
  const scan = section("scan", () => {
    const s = sqlite.prepare("SELECT id, updated_at FROM veritascan_scans WHERE lab_id = ? AND COALESCE(is_teaching, 0) = 0 ORDER BY updated_at DESC, id DESC LIMIT 1").get(labId) as any;
    if (!s) return null;
    const items = sqlite.prepare("SELECT status, completion_source FROM veritascan_items WHERE scan_id = ?").all(s.id) as Array<{ status: string; completion_source: string | null }>;
    const c = scanStatusCounts(items);
    const tally = (xs: typeof items): StatusTally => ({
      compliant: xs.filter((i) => i.status === "Compliant").length,
      needsAttention: xs.filter((i) => i.status === "Needs Attention").length,
      immediateAction: xs.filter((i) => i.status === "Immediate Action").length,
      na: xs.filter((i) => i.status === "N/A").length,
    });
    const auto = (i: { completion_source: string | null }) => AUTOMATIC_MARK_SOURCES.has(String(i.completion_source || ""));
    return {
      scanId: Number(s.id), updatedOn: labDayOf(s.updated_at),
      total: c.total, assessed: c.assessed, compliant: c.compliant, needsAttention: c.needsAttention,
      immediateAction: c.immediateAction, na: c.na, notAssessed: c.notAssessed,
      automatic: tally(items.filter(auto)), staff: tally(items.filter((i) => !auto(i))),
    };
  });

  return {
    labId, monthStart: start, monthEnd: end, asOf: today, timeZone: tz,
    competencies, studies, newTests, pt, documents, certificates, maintenance, qc, stock, tasks, findings, scan,
  };
}
