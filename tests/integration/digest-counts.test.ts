// tests/integration/digest-counts.test.ts
//
// 2026-11-11 (Michael, Q281 = 1; the compliance digest, PR 2 "shared counts"): server/digestCounts.ts digestCountsForLab
// returns each section's counts for one lab and one month. A made-up owner and lab on a fresh database, with made-up data
// in every module. For EVERY section it checks:
//   - the digest equals what that module's own screen route reports for the same lab (called over HTTP here; the digest
//     itself never calls a route);
//   - the new counts against hand-known values, with an item just outside the month on each month count (the last day
//     of the month before, the first day of the month after, and stored instants whose UTC day is in the month but whose
//     day on the lab's clock is not);
//   - and that the result carries no @ sign, no made-up person's name and no person key, and writes no record_views row.
// Run: rm -f .tmp-digest.db && DB_PATH=.tmp-digest.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/digest-counts.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { digestCountsForLab } = await import("../../server/digestCounts");
  const { labToday, addLabDays, withLabClock } = await import("../../server/dateLocal");
  const { isFindingOpen, isFindingPastDue } = await import("../../shared/findingCounts");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };

  try {
    // ── Setup: a made-up owner with two labs on New York time ─────────────────────────────────────────────────────────
    const stamp = Date.now();
    const email = `digest-${stamp}@example.test`;
    const OWNER_NAME = "Made-up Digest Owner";
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: OWNER_NAME, hipaa_acknowledged: true })).j;
    const T = reg.token as string;
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const provision = async (labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const LAB = await provision("Made-up Digest Lab");
    const SISTER = await provision("Made-up Digest Sister Lab");
    const L = `/api/labs/${LAB}`;
    const AS_LAB = { "X-Active-Lab-Id": String(LAB) };
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Digest Lab", cliaNumber: "11D7654390", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
    sqlite.prepare("UPDATE labs SET time_zone = 'America/New_York' WHERE id IN (?, ?)").run(LAB, SISTER);
    const TZ = "America/New_York";
    const today = withLabClock(TZ, () => labToday());
    const M0 = `${today.slice(0, 8)}01`;                 // first day of this month on the lab's clock
    const M1 = addLabDays(M0, -1, 1);                    // last day of this month
    const prevLast = addLabDays(M0, -1);                 // last day of the month before
    const prevStart = `${prevLast.slice(0, 8)}01`;
    const nextFirst = addLabDays(M1, 1);                 // first day of the month after
    const day = (n: number, months = 0) => addLabDays(today, n, months);
    const now = new Date().toISOString();
    // Instants whose UTC day is the 1st of this month: 02:00Z is the evening of the last day before (New York is UTC-4 or
    // -5), 05:30Z is early on the 1st.
    const BEFORE_MIDNIGHT = `${M0}T02:00:00.000Z`;
    const AFTER_MIDNIGHT = `${M0}T05:30:00.000Z`;
    check("setup: an owner, a lab and a sister lab, on New York time", !!T && LAB > 0 && SISTER > 0 && /^\d{4}-\d{2}-01$/.test(M0), JSON.stringify({ LAB, SISTER, today, M0, M1 }));

    // ── 1. VeritaComp ───────────────────────────────────────────────────────────────────────────────────────────────
    const STAFF = [["Zeller", "Made-up", true], ["Quist", "Made-up", true], ["Ober", "Made-up", true], ["Pryce", "Made-up", true], ["Vance", "Made-up", false]] as const;
    const staffIds: number[] = [];
    for (const [last, first, testing] of STAFF) {
      const r = await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "H", performsTesting: testing, hireDate: "2019-03-01" }, T);
      staffIds.push(Number(r.j.id));
    }
    const staffLab = Number((sqlite.prepare("SELECT lab_id FROM staff_employees WHERE id = ?").get(staffIds[0]) as any).lab_id);
    const schedule = (empId: number, sixMonthDue: string) => {
      sqlite.prepare("DELETE FROM staff_competency_schedules WHERE employee_id = ?").run(empId);
      sqlite.prepare("INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, six_month_due_at) VALUES (?, ?, ?, ?)").run(empId, staffLab, day(-200), sixMonthDue);
    };
    schedule(staffIds[0], day(-10));  // overdue
    schedule(staffIds[1], day(10));   // due in 30
    schedule(staffIds[2], day(60));   // due in 90
    schedule(staffIds[3], day(200));  // current
    schedule(staffIds[4], day(-10));  // overdue, but doesn't test patients
    const d1 = digestCountsForLab(sqlite, LAB, M0, M1);
    check("1. setup: five made-up roster people", staffIds.every((n) => n > 0) && staffLab > 0, JSON.stringify(staffIds));
    const tile = await call("GET", `${L}/competency/dashboard-stats`, undefined, T);
    check("1. competencies equal the VeritaComp tile (dashboard-stats)",
      tile.s === 200 && d1.competencies?.overdue === tile.j.overdue && d1.competencies?.dueIn30 === tile.j.dueSoon30 && d1.competencies?.dueIn90 === tile.j.dueSoon90 && d1.competencies?.testingStaff === tile.j.total,
      JSON.stringify({ digest: d1.competencies, tile: { s: tile.s, o: tile.j.overdue, d30: tile.j.dueSoon30, d90: tile.j.dueSoon90, t: tile.j.total } }));
    check("1. competencies: 1 overdue, 1 due in 30, 1 due in 90 of 4 testing staff (the non-testing person is left out)",
      d1.competencies?.overdue === 1 && d1.competencies?.dueIn30 === 1 && d1.competencies?.dueIn90 === 1 && d1.competencies?.testingStaff === 4, JSON.stringify(d1.competencies));
    check("1. non-technical is null while the lab has set no frequency", d1.competencies !== null && d1.competencies.nontechnical === null, JSON.stringify(d1.competencies));
    // Non-technical: a 12-month frequency, one program, one person overdue and one due within 30 days.
    const freq = await call("PUT", `${L}/competency/nontechnical-frequency`, { months: 12 }, T);
    const prog = Number((await call("POST", `${L}/competency/programs`, { name: "Made-up Safety", department: "Core", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, T)).j.id);
    const comp = (staffId: number, name: string) => Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, ?, 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(ownerId, LAB, name, staffId, now).lastInsertRowid);
    const record = (programId: number, employeeId: number, date: string) => sqlite.prepare(
      `INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, locked, completion_date, competency_type, created_at)
       VALUES (?, ?, 'annual', ?, 'Made-up Evaluator Kett', 'pass', 1, ?, 'nontechnical', ?)`
    ).run(programId, employeeId, date, date, now);
    record(prog, comp(staffIds[0], "Made-up Zeller"), day(-35, -12)); // due about 35 days ago
    record(prog, comp(staffIds[1], "Made-up Quist"), day(25, -12));   // due in about 25 days
    const d1b = digestCountsForLab(sqlite, LAB, M0, M1);
    const ntDue = await call("GET", `${L}/competency/nontechnical-due`, undefined, T);
    check("1. non-technical equals GET .../nontechnical-due once a frequency is set",
      freq.s === 200 && prog > 0 && ntDue.s === 200 && d1b.competencies?.nontechnical?.months === 12 && d1b.competencies.nontechnical.overdue === ntDue.j.counts.overdue && d1b.competencies.nontechnical.dueSoon === ntDue.j.counts.dueSoon && d1b.competencies.nontechnical.total === ntDue.j.counts.total,
      JSON.stringify({ digest: d1b.competencies?.nontechnical, route: ntDue.j.counts, freq: freq.s, prog }));
    check("1. non-technical: 1 overdue, 1 due soon", d1b.competencies?.nontechnical?.overdue === 1 && d1b.competencies.nontechnical.dueSoon === 1, JSON.stringify(d1b.competencies?.nontechnical));

    // ── 2 and 3. VeritaCheck and VeritaMap ──────────────────────────────────────────────────────────────────────────
    // An older map (built three months ago) with two analyzers, and a map built this month.
    const mapOld = (await call("POST", `${L}/veritamap/maps`, { name: "Made-up Chemistry" }, T)).j.id as number;
    const A = (await call("POST", `${L}/veritamap/maps/${mapOld}/instruments`, { instrument_name: "Alphamatic 500", role: "Primary", category: "Chemistry" }, T)).j.id as number;
    const B = (await call("POST", `${L}/veritamap/maps/${mapOld}/instruments`, { instrument_name: "Betatron 9", role: "Backup", category: "Chemistry" }, T)).j.id as number;
    const t = (analyte: string, active: number) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active });
    const putA = await call("PUT", `${L}/veritamap/maps/${mapOld}/instruments/${A}/tests`, { tests: [t("Sodium", 1), t("Potassium", 1), t("Chloride", 1), t("Lithium", 0)] }, T);
    const putB = await call("PUT", `${L}/veritamap/maps/${mapOld}/instruments/${B}/tests`, { tests: [t("Sodium", 1), t("Potassium", 1)] }, T);
    sqlite.prepare("UPDATE veritamap_maps SET created_at = ? WHERE id = ?").run(`${addLabDays(M0, 0, -3)}T15:00:00.000Z`, mapOld);
    const setSince = (inst: number, analyte: string, v: string | null) => sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = ? WHERE instrument_id = ? AND analyte = ?").run(v, inst, analyte);
    setSince(A, "Potassium", null);           // a row from before the column: never new
    setSince(A, "Chloride", AFTER_MIDNIGHT);  // early on the 1st on the lab's clock: new this month
    setSince(B, "Potassium", BEFORE_MIDNIGHT); // UTC day in the month, the lab's day the month before: not new
    const mapNew = (await call("POST", `${L}/veritamap/maps`, { name: "Made-up Urinalysis" }, T)).j.id as number;
    const G = (await call("POST", `${L}/veritamap/maps/${mapNew}/instruments`, { instrument_name: "Gammascope 3", role: "Primary", category: "Urinalysis" }, T)).j.id as number;
    const putG = await call("PUT", `${L}/veritamap/maps/${mapNew}/instruments/${G}/tests`, { tests: [t("Glucose", 1)] }, T);
    check("2. setup: two maps, three analyzers", [mapOld, A, B, mapNew, G].every((n) => n > 0) && [putA.s, putB.s, putG.s].every((s) => s === 200), JSON.stringify([putA.s, putB.s, putG.s]));
    const study = (o: { name: string; instrument: string; type: string; status: string; date: string; finalized?: string | null; archived?: boolean }) => Number(sqlite.prepare(
      `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lab_id, lifecycle_state, finalized_at, archived_at)
       VALUES (?, ?, ?, 'MU', ?, ?, 0.1, '[]', '[]', ?, ?, ?, ?, ?, ?)`
    ).run(ownerId, o.name, o.instrument, o.date, o.type, o.status, now, LAB, o.finalized ? "finalized" : "draft", o.finalized ?? null, o.archived ? now : null).lastInsertRowid);
    // Coverage: Sodium cal ver signed 6 months and 10 days ago (overdue), Potassium cal ver due in about 15 days, Sodium
    // comparison of the two analyzers signed 6 months and 5 days ago (overdue).
    const naSigned = day(-10, -6), kSigned = day(15, -6), mcSigned = day(-5, -6);
    study({ name: "Sodium", instrument: "Alphamatic 500", type: "cal_ver", status: "pass", date: naSigned, finalized: naSigned });
    study({ name: "Potassium", instrument: "Alphamatic 500", type: "cal_ver", status: "pass", date: kSigned, finalized: kSigned });
    study({ name: "Sodium", instrument: "Alphamatic 500", type: "method_comparison", status: "pass", date: mcSigned, finalized: mcSigned });
    // The month's studies (by study date), and drafts.
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "pass", date: M0 });
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "fail", date: today });
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "pass", date: prevLast });   // the month before
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "pass", date: nextFirst });  // the month after
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "draft", date: today });
    study({ name: "Albumin", instrument: "Alphamatic 500", type: "precision", status: "pass", date: today, archived: true });
    study({ name: "Chloride", instrument: "Alphamatic 500", type: "precision", status: "draft", date: day(-3) });  // a draft is not "on file"

    const d2 = digestCountsForLab(sqlite, LAB, M0, M1);
    const cov = await call("GET", `${L}/veritacheck/coverage`, undefined, T);
    const covOver = (cov.j.rows || []).filter((r: any) => r.overdue).length + (cov.j.methodComparisons || []).filter((m: any) => m.overdue).length;
    const soon = day(30);
    const covSoon = [...(cov.j.rows || []), ...(cov.j.methodComparisons || [])].filter((r: any) => !r.overdue && r.nextDueOn && r.nextDueOn >= today && r.nextDueOn <= soon).length;
    check("2. studies overdue and due soon equal the Coverage screen (rows and comparisons past or within 30 days of next due)",
      cov.s === 200 && d2.studies?.overdue === covOver && d2.studies?.dueSoon === covSoon && d2.studies?.methodComparisonOverdue === cov.j.summary.methodComparisonsOverdue,
      JSON.stringify({ digest: d2.studies, covOver, covSoon, mcOver: cov.j.summary?.methodComparisonsOverdue }));
    check("2. studies: 1 cal ver overdue, 1 comparison overdue, 1 cal ver due soon",
      d2.studies?.calVerOverdue === 1 && d2.studies?.methodComparisonOverdue === 1 && d2.studies?.calVerDueSoon === 1 && d2.studies?.methodComparisonDueSoon === 0, JSON.stringify(d2.studies));
    const list = await call("GET", `${L}/studies`, undefined, T);
    const inM = (d: string) => String(d).slice(0, 10) >= M0 && String(d).slice(0, 10) <= M1;
    const listed = (list.j as any[]) || [];
    const lDone = listed.filter((s) => s.status !== "draft" && inM(s.date));
    check("2. the month's studies and drafts equal the study list (GET .../studies)",
      list.s === 200 && d2.studies?.completedInMonth === lDone.length && d2.studies?.passedInMonth === lDone.filter((s) => s.status === "pass").length
        && d2.studies?.failedInMonth === lDone.filter((s) => s.status === "fail").length && d2.studies?.openDrafts === listed.filter((s) => s.status === "draft").length,
      JSON.stringify({ digest: d2.studies, listed: listed.length }));
    check("2. the month: 2 completed (1 passed, 1 failed), the day before and the day after the month and an archived study left out; 2 open drafts",
      d2.studies?.completedInMonth === 2 && d2.studies?.passedInMonth === 1 && d2.studies?.failedInMonth === 1 && d2.studies?.openDrafts === 2, JSON.stringify(d2.studies));

    const want = [
      { mapId: mapOld, analyte: "Chloride", instrumentName: "Alphamatic 500", studyOnFile: false },
      { mapId: mapOld, analyte: "Sodium", instrumentName: "Alphamatic 500", studyOnFile: true },
      { mapId: mapOld, analyte: "Sodium", instrumentName: "Betatron 9", studyOnFile: false },
    ];
    check("3. new tests: the three tests switched on this month (NULL, inactive, and the evening before the 1st on the lab's clock left out)",
      d2.newTests?.count === 3 && same(d2.newTests?.items, want), JSON.stringify(d2.newTests?.items));
    check("3. the map built this month is reported as built, its tests not counted",
      same(d2.newTests?.maps, [{ mapId: mapOld, mapBuiltThisMonth: false, newTests: 3 }, { mapId: mapNew, mapBuiltThisMonth: true, newTests: 0 }]), JSON.stringify(d2.newTests?.maps));
    const insts = await call("GET", `${L}/veritamap/maps/${mapOld}/instruments`, undefined, T);
    const activeOnMap = new Set((insts.j as any[]).flatMap((i: any) => i.tests.filter((x: any) => x.active === 1).map((x: any) => `${i.instrument_name}|${x.analyte}`)));
    check("3. every new test is an active test on the VeritaMap screen for that analyzer",
      insts.s === 200 && (d2.newTests?.items || []).every((i) => activeOnMap.has(`${i.instrumentName}|${i.analyte}`)), JSON.stringify([...activeOnMap]));
    const naRow = (cov.j.rows || []).find((r: any) => r.analyte === "Sodium" && r.instrument === "Alphamatic 500");
    const naBRow = (cov.j.rows || []).find((r: any) => r.analyte === "Sodium" && r.instrument === "Betatron 9");
    check("3. study on file agrees with Coverage: Sodium on Alphamatic has its study, Sodium on Betatron only one on another analyzer",
      !!naRow && naRow.studyIds.length > 0 && naRow.status !== "review" && !!naBRow && naBRow.status === "review", JSON.stringify({ naRow, naBRow }));
    const dPrev = digestCountsForLab(sqlite, LAB, prevStart, prevLast);
    check("3. the month before: Potassium on Betatron (the evening before the 1st) is its new test",
      dPrev.newTests?.count === 1 && dPrev.newTests.items[0]?.analyte === "Potassium" && dPrev.newTests.items[0]?.instrumentName === "Betatron 9", JSON.stringify(dPrev.newTests));
    check("2. the month before: its study (the last day) counts there", dPrev.studies?.completedInMonth === 1 && dPrev.studies?.passedInMonth === 1, JSON.stringify(dPrev.studies));

    // ── 4. VeritaPT ─────────────────────────────────────────────────────────────────────────────────────────────────
    const enr = (lab: number) => Number(sqlite.prepare("INSERT INTO pt_enrollments (user_id, analyte, specialty, pt_provider, enrollment_year, enrollment_date, status, lab_id) VALUES (?, 'Sodium', 'Chemistry', 'CAP', ?, ?, 'active', ?)").run(ownerId, Number(today.slice(0, 4)), `${today.slice(0, 4)}-01-02`, lab).lastInsertRowid);
    const enrL = enr(LAB), enrS = enr(SISTER);
    const ev = (lab: number, enrollment: number, date: string, pf: string) => Number(sqlite.prepare("INSERT INTO pt_events (enrollment_id, user_id, event_date, analyte, pass_fail, lab_id) VALUES (?, ?, ?, 'Sodium', ?, ?)").run(enrollment, ownerId, date, pf, lab).lastInsertRowid);
    const year = today.slice(0, 4);
    const e1 = ev(LAB, enrL, M0, "fail"); ev(LAB, enrL, today, "fail"); ev(LAB, enrL, prevLast, "fail"); ev(LAB, enrL, nextFirst, "fail");
    ev(LAB, enrL, today, "pass"); ev(LAB, enrL, `${year}-01-15`, "pass"); ev(LAB, enrL, `${Number(year) - 1}-12-15`, "pass"); ev(LAB, enrL, today, "pending");
    const eS = ev(SISTER, enrS, today, "fail");
    const ca = (lab: number, event: number, status: string) => sqlite.prepare("INSERT INTO pt_corrective_actions (event_id, user_id, corrective_action, date_initiated, status, lab_id) VALUES (?, ?, 'Made-up action', ?, ?, ?)").run(event, ownerId, today, status, lab);
    ca(LAB, e1, "open"); ca(LAB, e1, "closed"); ca(SISTER, eS, "open");
    const d4 = digestCountsForLab(sqlite, LAB, M0, M1);
    const ptSum = await call("GET", "/api/veritapt/summary", undefined, T, AS_LAB);
    const ptEv = await call("GET", "/api/veritapt/events", undefined, T, AS_LAB);
    const evs = (ptEv.j as any[]) || [];
    const gradedYtd = evs.filter((e) => (e.pass_fail === "pass" || e.pass_fail === "fail") && e.event_date >= `${year}-01-01` && e.event_date <= M1).length;
    check("4. PT equals the VeritaPT screens: open corrective actions (summary), unacceptable in the month and year to date (events list)",
      ptSum.s === 200 && ptEv.s === 200 && d4.pt?.openCorrectiveActions === ptSum.j.openCorrectiveActions
        && d4.pt?.unacceptableInMonth === evs.filter((e) => e.pass_fail === "fail" && inM(e.event_date)).length
        && d4.pt?.acceptableYearToDate === evs.filter((e) => e.pass_fail === "pass" && e.event_date >= `${year}-01-01` && e.event_date <= M1).length
        && d4.pt?.gradedYearToDate === gradedYtd,
      JSON.stringify({ digest: d4.pt, summary: ptSum.j, events: evs.length }));
    check("4. PT: 2 unacceptable in the month (the day before and the day after left out), 1 open corrective action, 2 acceptable this year",
      d4.pt?.unacceptableInMonth === 2 && d4.pt?.openCorrectiveActions === 1 && d4.pt?.acceptableYearToDate === 2, JSON.stringify(d4.pt));

    // ── 5. VeritaDC ─────────────────────────────────────────────────────────────────────────────────────────────────
    const doc = (title: string, status: string, nextReview: string | null, archived = false) => Number(sqlite.prepare(
      "INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, archived_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(LAB, title, ownerId, status, nextReview, archived ? now : null).lastInsertRowid);
    const version = (docId: number, n: number, uploadedAt: string) => {
      const v = Number(sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'pdf', 10, 'x', ?, ?)").run(docId, n, `${LAB}/${docId}/v${n}/document.pdf`, ownerId, uploadedAt).lastInsertRowid);
      sqlite.prepare("UPDATE policy_documents SET current_version_id = ? WHERE id = ?").run(v, docId);
      return v;
    };
    const D1 = doc("Made-up Specimen Rejection", "approved", day(-5)); const D1v = version(D1, 1, `${M0} 10:00:00`);  // overdue; new this month (SQLite datetime form)
    const D2 = doc("Made-up Critical Values", "expired", day(-90)); version(D2, 1, "2025-01-10 10:00:00"); version(D2, 2, now); // expired; revised this month
    const D3 = doc("Made-up Labeling", "approved", day(200)); version(D3, 1, `${prevLast} 12:00:00`);                   // the month before
    const D4 = doc("Made-up Draft", "draft", null); version(D4, 1, BEFORE_MIDNIGHT);                                       // the lab's day before the 1st
    const D5 = doc("Made-up Carried", "approved", day(300)); const D5v = version(D5, 1, now);                            // carried over: not a change here
    sqlite.prepare("INSERT INTO policy_carried_records (lab_id, document_id, version_id, source_system, source_number) VALUES (?, ?, ?, 'OldSystem', 'MU 9')").run(LAB, D5, D5v);
    const D6 = doc("Made-up Retired", "approved", day(-30), true); version(D6, 1, now);                                 // archived
    const assign = await call("POST", `${L}/veritapolicy/read-sign`, { scope: "lab", everyone: true }, T);
    sqlite.prepare("INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id) VALUES (?, ?, ?, ?)").run(LAB, D1, D1v, staffIds[0]);
    const d5 = digestCountsForLab(sqlite, LAB, M0, M1);
    const compl = await call("GET", `${L}/veritapolicy/compliance`, undefined, T);
    const tracker = await call("GET", `${L}/veritapolicy/read-sign/tracker?scope=lab`, undefined, T);
    check("5. documents past review equal the compliance page (overdue list + expired)",
      compl.s === 200 && d5.documents?.overdueReview === compl.j.overdueList.length && d5.documents?.expired === compl.j.headline.expired_total
        && d5.documents?.pastReview === compl.j.overdueList.length + compl.j.headline.expired_total,
      JSON.stringify({ digest: d5.documents, overdue: compl.j.overdueList?.length, expired: compl.j.headline?.expired_total }));
    check("5. signatures owed equal the read-and-sign tracker for the whole lab",
      assign.s === 201 && tracker.s === 200 && d5.documents?.signaturesOwed === tracker.j.totals.owes && d5.documents?.peopleOwingSignatures === tracker.j.people.filter((p: any) => p.owes > 0).length,
      JSON.stringify({ assign: assign.s, digest: d5.documents, totals: tracker.j.totals }));
    check("5. documents: 1 overdue + 1 expired past review; 3 approved documents x 5 people, 1 signed = 14 owed",
      d5.documents?.pastReview === 2 && d5.documents?.signaturesOwed === 14 && d5.documents?.peopleOwingSignatures === 5, JSON.stringify(d5.documents));
    check("5. changed this month: 1 new, 1 revised (the month before, the evening before the 1st, a carried-over load and an archived document left out)",
      d5.documents?.changedInMonth === 2 && d5.documents?.newInMonth === 1 && d5.documents?.revisedInMonth === 1, JSON.stringify(d5.documents));
    const d5p = digestCountsForLab(sqlite, LAB, prevStart, prevLast);
    check("5. the month before: its two new documents", d5p.documents?.changedInMonth === 2 && d5p.documents?.newInMonth === 2, JSON.stringify(d5p.documents));

    // ── 6. VeritaLab and 7. VeritaMaintain ──────────────────────────────────────────────────────────────────────────
    const cert = sqlite.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, expiration_date, is_active, created_at, updated_at) VALUES (?, ?, 'clia', ?, ?, ?, ?, ?)");
    cert.run(ownerId, LAB, "Made-up expired", day(-10), 1, now, now);
    cert.run(ownerId, LAB, "Made-up 45 days", day(45), 1, now, now);
    cert.run(ownerId, LAB, "Made-up 80 days", day(80), 1, now, now);
    cert.run(ownerId, LAB, "Made-up 120 days", day(120), 1, now, now);
    cert.run(ownerId, LAB, "Made-up inactive", day(-3), 0, now, now);
    cert.run(ownerId, SISTER, "Made-up sister expired", day(-3), 1, now, now);
    const equip = sqlite.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, next_due_date, status, created_at) VALUES (?, ?, ?, ?, ?)");
    equip.run(LAB, "Made-up Centrifuge", day(-5), "active", now);
    equip.run(LAB, "Made-up Incubator", day(10), "active", now);
    equip.run(LAB, "Made-up Water Bath", day(40), "active", now);
    equip.run(LAB, "Made-up Old Stainer", day(-20), "retired", now);
    const d6 = digestCountsForLab(sqlite, LAB, M0, M1);
    const rd = await call("GET", `${L}/readiness`, undefined, T);
    const mod = (k: string) => (rd.j.modules || []).find((m: any) => m.key === k);
    check("6. certificates expired equals readiness; 90-day window counts 45 and 80 days (readiness's 60-day window counts 45 only)",
      rd.s === 200 && d6.certificates?.expired === mod("certificates")?.overdue && d6.certificates?.expiringIn90 === 2 && mod("certificates")?.due_soon === 1 && d6.certificates?.expired === 1,
      JSON.stringify({ digest: d6.certificates, readiness: mod("certificates") }));
    const rev = await call("GET", `${L}/maintain-reviews?month=${M0.slice(0, 7)}`, undefined, T);
    const revProblems = ((rev.j.items as any[]) || []).reduce((n, i) => n + i.problems.length, 0);
    check("7. maintenance overdue and due in 30 equal readiness; review problems equal the monthly review screen",
      d6.maintenance?.overdue === mod("equipment")?.overdue && d6.maintenance?.dueIn30 === mod("equipment")?.due_soon && rev.s === 200 && d6.maintenance?.reviewProblems === revProblems
        && d6.maintenance?.recordsWithProblems === ((rev.j.items as any[]) || []).filter((i) => i.problems.length > 0).length,
      JSON.stringify({ digest: d6.maintenance, readiness: mod("equipment"), revProblems, revS: rev.s }));
    check("7. maintenance: 1 overdue, 1 due in 30 (retired left out), 1 review problem (PM not done)",
      d6.maintenance?.overdue === 1 && d6.maintenance?.dueIn30 === 1 && d6.maintenance?.reviewProblems === 1 && d6.maintenance?.recordsWithProblems === 1, JSON.stringify(d6.maintenance));

    // ── 8. VeritaQC ─────────────────────────────────────────────────────────────────────────────────────────────────
    const lot = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, lot_number, mfr_mean, mfr_sd, status) VALUES (?, 'Glucose', 'MU-QC-1', 100, 2, 'active')").run(LAB).lastInsertRowid);
    const run = (date: string, o: { sev?: string | null; ca?: boolean; voided?: boolean; superseded?: boolean } = {}) => {
      const id = Number(sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, voided_at) VALUES (?, ?, 120, ?, ?)").run(LAB, lot, date, o.voided ? now : null).lastInsertRowid);
      if (o.sev) sqlite.prepare("INSERT INTO qc_rule_violations (qc_result_id, rule_code, severity, superseded_at) VALUES (?, '1-3s', ?, ?)").run(id, o.sev, o.superseded ? now : null);
      if (o.ca) sqlite.prepare("INSERT INTO qc_corrective_actions (lab_id, qc_result_id, action_taken, taken_by_user_id) VALUES (?, ?, 'Made-up rerun', ?)").run(LAB, id, ownerId);
      return id;
    };
    const R1 = run(M0, { sev: "rejection" });                      // counted, no corrective action
    run(today, { sev: "rejection", ca: true });                     // counted, has one
    run(today, { sev: "warning" });                                 // a warning is not a rejection
    const R4 = run(today, { sev: "rejection", voided: true });      // voided
    run(prevLast, { sev: "rejection" });                            // the month before
    run(today, { sev: "rejection", superseded: true });             // its violation was superseded
    run(nextFirst, { sev: "rejection" });                           // the month after
    const d8 = digestCountsForLab(sqlite, LAB, M0, M1);
    const missing = await call("GET", `${L}/qc/recent?since=${M0}&until=${M1}&status=missing_ca`, undefined, T);
    const withV = await call("GET", `${L}/qc/recent?since=${M0}&until=${M1}&status=with_violation`, undefined, T);
    const missIds = ((missing.j.results as any[]) || []).map((r) => r.id);
    const rejIds = ((withV.j.results as any[]) || []).filter((r) => r.violations.some((v: any) => v.severity === "rejection")).map((r) => r.id);
    check("8. QC equals the daily review feed (qc/recent) for the month less its voided run",
      missing.s === 200 && withV.s === 200 && d8.qc?.withoutCorrectiveAction === missIds.filter((id) => id !== R4).length && d8.qc?.rejectedRunsInMonth === rejIds.filter((id) => id !== R4).length,
      JSON.stringify({ digest: d8.qc, missIds, rejIds }));
    check("8. QC: 2 rejected runs in the month, 1 without a corrective action; the feed counts the voided run, the digest doesn't",
      d8.qc?.rejectedRunsInMonth === 2 && d8.qc?.withoutCorrectiveAction === 1 && missIds.includes(R4) && missIds.includes(R1), JSON.stringify({ d: d8.qc, missIds }));
    const d8p = digestCountsForLab(sqlite, LAB, prevStart, prevLast);
    check("8. the month before: its rejected run", d8p.qc?.rejectedRunsInMonth === 1 && d8p.qc?.withoutCorrectiveAction === 1, JSON.stringify(d8p.qc));

    // ── 9. VeritaStock ──────────────────────────────────────────────────────────────────────────────────────────────
    const item = (lab: number, name: string, qty: number, exp: string, status = "active") => Number(sqlite.prepare(
      "INSERT INTO inventory_items (account_id, item_name, lab_id, quantity_on_hand, expiration_date, status) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(ownerId, name, lab, qty, exp, status).lastInsertRowid);
    const lotRow = (itemId: number, lab: number, lotNo: string, exp: string, qty: number) => sqlite.prepare("INSERT INTO inventory_lots (item_id, lab_id, lot_number, expiration_date, quantity) VALUES (?, ?, ?, ?, ?)").run(itemId, lab, lotNo, exp, qty);
    const I1 = item(LAB, "Made-up Reagent Pack", 9, day(-20));
    lotRow(I1, LAB, "MU-A", day(-20), 3); lotRow(I1, LAB, "MU-B", day(-5), 2); lotRow(I1, LAB, "MU-C", day(60), 4);
    item(LAB, "Made-up Calibrator", 2, day(-3));                                   // no lot rows: counts as one lot
    const I3 = item(LAB, "Made-up Diluent", 5, day(30)); lotRow(I3, LAB, "MU-D", day(30), 5);
    const I4 = item(LAB, "Made-up Empty", 0, day(-10)); lotRow(I4, LAB, "MU-E", day(-10), 0);
    item(LAB, "Made-up Discontinued", 4, day(-10), "inactive");
    item(SISTER, "Made-up Sister Stock", 3, day(-10));
    const recall = sqlite.prepare("INSERT INTO stock_recalls (lab_id, vendor, product, opened_on, due_date, status) VALUES (?, 'Made-up Vendor', 'Made-up Product', ?, ?, ?)");
    recall.run(LAB, day(-10), day(-2), "open"); recall.run(LAB, day(-1), day(5), "open"); recall.run(LAB, day(-30), day(-10), "closed"); recall.run(SISTER, day(-10), day(-2), "open");
    const d9 = digestCountsForLab(sqlite, LAB, M0, M1);
    const shelf = await call("GET", `${L}/veritastock/expired-on-shelf`, undefined, T);
    const recalls = await call("GET", `${L}/veritastock/recalls`, undefined, T);
    const cases = (recalls.j.cases as any[]) || [];
    const shelfHere = ((shelf.j.items as any[]) || []).filter((r) => r.lab_id === LAB);
    check("9. expired products equal this lab's rows on the expired-on-shelf screen; recalls equal the recall list",
      shelf.s === 200 && recalls.s === 200 && d9.stock?.expiredProducts === shelfHere.length && d9.stock?.openRecalls === cases.filter((c) => c.status === "open").length && d9.stock?.overdueRecalls === cases.filter((c) => c.overdue).length,
      JSON.stringify({ digest: d9.stock, shelf: shelf.j.total, shelfHere: shelfHere.length, cases: cases.length, s: [shelf.s, recalls.s] }));
    console.log(`INFO  9. the expired-on-shelf screen lists ${shelf.j.total} row(s) across the stock group; ${shelfHere.length} are this lab's`);
    check("9. stock: 3 expired lots on 2 products in this lab (fresh, empty, inactive and the sister lab's left out); 2 open recalls, 1 past due",
      d9.stock?.expiredLots === 3 && d9.stock?.expiredProducts === 2 && d9.stock?.openRecalls === 2 && d9.stock?.overdueRecalls === 1, JSON.stringify(d9.stock));

    // ── 10. VeritaTrack ─────────────────────────────────────────────────────────────────────────────────────────────
    const task = (name: string, months: number, active = 1) => Number(sqlite.prepare("INSERT INTO veritatrack_tasks (user_id, lab_id, name, frequency_months, active) VALUES (?, ?, ?, ?, ?)").run(ownerId, LAB, name, months, active).lastInsertRowid);
    const signoff = (taskId: number, date: string, voided = false) => sqlite.prepare("INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, voided_at) VALUES (?, ?, ?, ?)").run(taskId, ownerId, date, voided ? now : null);
    signoff(task("Made-up QC review", 1), day(-40));                // overdue
    signoff(task("Made-up pipette check", 12), addLabDays(M1, 0, -12)); // due on the month's last day
    task("Made-up new task", 12);                                    // not started
    signoff(task("Made-up voided task", 12), day(-5), true);         // only a voided sign-off: not started
    signoff(task("Made-up annual", 12), day(-1));                    // current
    signoff(task("Made-up retired task", 1, 0), day(-90));           // inactive
    const d10 = digestCountsForLab(sqlite, LAB, M0, M1);
    const dash = await call("GET", `${L}/veritatrack/dashboard`, undefined, T);
    check("10. tasks equal the VeritaTrack dashboard", dash.s === 200 && d10.tasks?.overdue === dash.j.overdue && d10.tasks?.dueThisMonth === dash.j.dueThisMonth && d10.tasks?.notStarted === dash.j.notStarted,
      JSON.stringify({ digest: d10.tasks, dash: { s: dash.s, o: dash.j.overdue, m: dash.j.dueThisMonth, n: dash.j.notStarted } }));
    check("10. tasks: 1 overdue, 1 due this month, 2 not started", d10.tasks?.overdue === 1 && d10.tasks?.dueThisMonth === 1 && d10.tasks?.notStarted === 2, JSON.stringify(d10.tasks));

    // ── 11. VeritaResponse ──────────────────────────────────────────────────────────────────────────────────────────
    const finding = (lab: number, accreditor: string, status: string, due: string) => sqlite.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, due_date, description) VALUES (?, ?, ?, ?, ?, 'Made-up finding')").run(ownerId, lab, accreditor, status, due);
    finding(LAB, "CAP", "open", day(-3));       // open, past due
    finding(LAB, "COLA", "open", day(-3));      // open; a soft clock is never past due
    finding(LAB, "TJC", "drafting", day(10));   // open
    finding(LAB, "CMS", "closed", day(-20));
    finding(LAB, "TJC", "accepted", day(-5));
    finding(LAB, "CAP", "open", today);         // open, due today
    finding(SISTER, "CAP", "open", day(-3));
    const d11 = digestCountsForLab(sqlite, LAB, M0, M1);
    const fl = await call("GET", `${L}/findings`, undefined, T);
    const fRows = (fl.j as any[]) || [];
    check("11. findings equal the VeritaResponse list by its rule (open; past due on a hard clock)",
      fl.s === 200 && d11.findings?.open === fRows.filter(isFindingOpen).length && d11.findings?.pastDue === fRows.filter((f) => isFindingPastDue(f, today)).length,
      JSON.stringify({ digest: d11.findings, listed: fRows.length }));
    check("11. findings: 4 open, 1 past due", d11.findings?.open === 4 && d11.findings?.pastDue === 1, JSON.stringify(d11.findings));

    // ── 12. VeritaScan ──────────────────────────────────────────────────────────────────────────────────────────────
    const older = (await call("POST", `${L}/veritascan/scans`, { name: "Made-up Older Scan" }, T)).j.id as number;
    const latest = (await call("POST", `${L}/veritascan/scans`, { name: "Made-up Survey Prep" }, T)).j.id as number;
    const teaching = (await call("POST", `${L}/veritascan/scans`, { name: "Made-up Teaching Scan" }, T)).j.id as number;
    const scanItem = sqlite.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, completion_source, updated_at) VALUES (?, ?, ?, ?, ?)");
    const marks: Array<[string, string | null]> = [["Compliant", "manual"], ["Compliant", "veritacheck_auto"], ["Compliant", "veritacomp_auto"], ["Needs Attention", "manual"],
      ["Immediate Action", "manual"], ["N/A", "manual"], ["Not Assessed", "manual"], ["Not Assessed", "veritacheck_evidence"]];
    marks.forEach(([st, src], i) => scanItem.run(latest, i + 1, st, src, now));
    scanItem.run(older, 1, "Immediate Action", "manual", now); scanItem.run(teaching, 1, "Compliant", "manual", now);
    sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(`${day(-30)}T12:00:00.000Z`, older);
    sqlite.prepare("UPDATE veritascan_scans SET updated_at = ?, is_teaching = 1 WHERE id = ?").run(new Date(Date.now() + 60000).toISOString(), teaching);
    const d12 = digestCountsForLab(sqlite, LAB, M0, M1);
    const scans = await call("GET", `${L}/veritascan/scans`, undefined, T);
    const sRow = ((scans.j as any[]) || []).find((s) => s.id === latest);
    check("12. the latest scan's counts equal the scan list (the teaching scan and the older scan left out)",
      scans.s === 200 && !!sRow && d12.scan?.scanId === latest && d12.scan.total === sRow.total && d12.scan.assessed === sRow.assessed && d12.scan.compliant === sRow.compliant
        && d12.scan.needsAttention === sRow.needsAttention && d12.scan.immediateAction === sRow.immediateAction && d12.scan.na === sRow.na && d12.scan.notAssessed === sRow.notAssessed,
      JSON.stringify({ digest: d12.scan, row: sRow }));
    check("12. automatic marks counted apart: 2 of 3 Compliant are VeritaCheck and VeritaComp marks; the evidence link is not a mark",
      same(d12.scan?.automatic, { compliant: 2, needsAttention: 0, immediateAction: 0, na: 0 }) && same(d12.scan?.staff, { compliant: 1, needsAttention: 1, immediateAction: 1, na: 1 }),
      JSON.stringify({ a: d12.scan?.automatic, s: d12.scan?.staff }));

    // ── Every section filled; counts only; no record_views written ──────────────────────────────────────────────────
    const views = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM record_views").get() as any).n);
    const before = views();
    const final = digestCountsForLab(sqlite, LAB, M0, M1);
    check("no record_views row is written by the digest", views() === before, `${before} -> ${views()}`);
    const sections = ["competencies", "studies", "newTests", "pt", "documents", "certificates", "maintenance", "qc", "stock", "tasks", "findings", "scan"] as const;
    check("every section is filled (none failed to compute)", sections.every((k) => final[k] !== null), JSON.stringify(sections.filter((k) => final[k] === null)));
    const text = JSON.stringify(final);
    const people = [OWNER_NAME, "Zeller", "Quist", "Ober", "Pryce", "Vance", "Kett", email, "digest-"];
    check("no @ sign in the digest", !text.includes("@"));
    check("no made-up person's name in the digest", people.every((p) => !text.toLowerCase().includes(p.toLowerCase())), people.filter((p) => text.toLowerCase().includes(p.toLowerCase())).join(", "));
    const keys = new Set<string>();
    const walk = (v: any) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
    walk(final);
    const personKeys = [...keys].filter((k) => /name$|email|employee|user|signer|owner|assignee|person/i.test(k) && k !== "instrumentName");
    check("no person key (name, email, employee or user id) in the digest", personKeys.length === 0, personKeys.join(", "));
    check("no em dash in the digest's text", !text.includes(String.fromCharCode(0x2014)));
    let threw = false; try { digestCountsForLab(sqlite, LAB, "2026-13-01", M1); } catch { threw = true; }
    check("a bad month is refused", threw);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
