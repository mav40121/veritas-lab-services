// tests/integration/demo-date-refresh.test.ts
//
// Michael 2026-11-16 ("update michael's lab expiration dates across the board. Inventory, clia certificates, veritatrack,
// everything"; option 1: his test labs, performed dates included): POST /api/admin/demo-dates/refresh rolls passed dates
// forward by whole cycles of their own period, in labs of the QA system (organization 5) that its billing owner owns. Boots
// the REAL routes on a scratch DB with made-up rows, every date relative to today. It checks:
//   1. the secret comes from the header only; labIds is required; a write needs the confirm words
//   2. a client lab, or a QA-system lab someone else owns, refuses the whole request and nothing is written
//   3. a dry run writes nothing, lists every change with no names, and shows readiness before and after
//   4. the write moves exactly the stale rows: certificates by their own span, equipment by its PM interval with the last
//      event, pending PT to next year, active QC and stock lots by a year, VeritaTrack sign-offs by the task's frequency,
//      VeritaMap "last" dates by their period, policy reviews by their interval (an auto-expired policy back to approved),
//      open findings and scan items by 30 days, and an overdue person's competency timeline by whole years
//   5. history and current rows stay: graded PT, retired equipment, inactive certificates, empty lots, voided sign-offs,
//      N/A VeritaMap fields, closed findings, compliant scan items, a policy expired by hand, dates already current
//   6. no performed date lands after today, each moved row has an audit row, and a second run changes nothing
//   7. the client lab's rows are untouched
// Run: npm run test:demo-date-refresh
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labToday, addLabDays } = await import("../../server/dateLocal");
  const { deriveCompetencyStatus, labMethodClocks } = await import("../../server/competencyReminders");
  const { DEMO_DATES_CONFIRM, QA_ORG_ID, cyclesToCurrent, monthsBetween } = await import("../../server/demoDateRefresh");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-01-01T00:00:00Z" : /count|_id$|is_|mean|sd/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const today = labToday();
  const d = (days: number, months = 0) => addLabDays(today, days, months);
  const val = (table: string, id: number, col: string) => (sqlite.prepare(`SELECT ${col} AS v FROM ${table} WHERE id = ?`).get(id) as any)?.v;

  // Pure helpers
  check("0. cyclesToCurrent: a date today or later needs no cycle", cyclesToCurrent(today, today, 0, 12) === null && cyclesToCurrent(d(5), today, 0, 12) === null);
  check("0. cyclesToCurrent: 10 days past a monthly cycle is 1 cycle, 40 days past is 2", cyclesToCurrent(d(-10), today, 0, 1) === 1 && cyclesToCurrent(d(-40), today, 0, 1) === 2);
  check("0. cyclesToCurrent: a daily cycle 800 days behind is 800 cycles, a 7-day cycle 15 days behind is 3", cyclesToCurrent(d(-800), today, 1, 0) === 800 && cyclesToCurrent(d(-15), today, 7, 0) === 3);
  check("0. monthsBetween rounds to the month", monthsBetween("2024-03-01", "2026-02-28") === 24 && monthsBetween("2024-04-15", "2026-04-14") === 24 && monthsBetween("2025-01-10", "2026-01-12") === 12);

  // People, the QA system and a client system
  const owner = insert("users", { email: "qa-owner-dates@example.test", name: "Made-up QA Owner", plan: "enterprise", seat_count: 0 });
  const other = insert("users", { email: "qa-other-dates@example.test", name: "Made-up Other Owner", plan: "enterprise", seat_count: 0 });
  const client = insert("users", { email: "client-dates@example.test", name: "Made-up Client Owner", plan: "enterprise", seat_count: 0 });
  insert("organizations", { id: QA_ORG_ID, name: "Made-up QA System", billing_owner_user_id: owner });
  const clientOrg = insert("organizations", { name: "Made-up Client System", billing_owner_user_id: client });
  const labA = insert("labs", { lab_name: "Made-up QA Lab", owner_user_id: owner, plan: "enterprise", organization_id: QA_ORG_ID });
  const labJ = insert("labs", { lab_name: "Made-up Someone Else Lab", owner_user_id: other, plan: "enterprise", organization_id: QA_ORG_ID });
  const labC = insert("labs", { lab_name: "Made-up Client Lab", owner_user_id: client, plan: "enterprise", organization_id: clientOrg });

  const fixtures = (lab: number, ownerId: number) => {
    const ids: Record<string, number> = {};
    // Certificates
    ids.certStale = insert("lab_certificates", { user_id: ownerId, lab_id: lab, cert_type: "clia", cert_name: "CLIA Certificate", issued_date: d(-100, -24), expiration_date: d(-100), is_active: 1, created_at: today, updated_at: today });
    ids.certCurrent = insert("lab_certificates", { user_id: ownerId, lab_id: lab, cert_type: "other", cert_name: "State license", issued_date: d(-200), expiration_date: d(165), is_active: 1, created_at: today, updated_at: today });
    ids.certInactive = insert("lab_certificates", { user_id: ownerId, lab_id: lab, cert_type: "other", cert_name: "Old permit", expiration_date: d(-400), is_active: 0, created_at: today, updated_at: today });
    // Equipment
    ids.eq = insert("lab_equipment", { lab_id: lab, instrument_name: "Made-up Analyzer", pm_interval_days: 180, next_due_date: d(-10), status: "active" });
    ids.eqEvent = insert("equipment_maintenance_events", { equipment_id: ids.eq, lab_id: lab, event_type: "pm", event_date: d(-190), next_due_date: d(-10) });
    ids.eqRetired = insert("lab_equipment", { lab_id: lab, instrument_name: "Made-up Retired", pm_interval_days: 365, next_due_date: d(-300), status: "retired" });
    // PT
    ids.ptPending = insert("pt_events", { user_id: ownerId, lab_id: lab, event_date: d(-50), submission_due_date: d(-20), pass_fail: "pending", analyte: "Sodium" });
    ids.ptGraded = insert("pt_events", { user_id: ownerId, lab_id: lab, event_date: d(-80), submission_due_date: d(-60), pass_fail: "pass", analyte: "Potassium" });
    // QC and stock
    ids.qcActive = insert("qc_control_lots", { lab_id: lab, analyte: "Glucose", lot_number: `L-${lab}-1`, mfr_mean: 100, mfr_sd: 3, expiration_date: d(-5), status: "active" });
    ids.qcRetired = insert("qc_control_lots", { lab_id: lab, analyte: "Glucose", lot_number: `L-${lab}-0`, mfr_mean: 100, mfr_sd: 3, expiration_date: d(-300), status: "retired" });
    ids.item = insert("inventory_items", { account_id: ownerId, lab_id: lab, item_name: "Made-up Reagent", expiration_date: d(-30), status: "active" });
    ids.lotFull = insert("inventory_lots", { item_id: ids.item, lab_id: lab, account_id: ownerId, lot_number: "R1", expiration_date: d(-30), quantity: 4 });
    ids.lotEmpty = insert("inventory_lots", { item_id: ids.item, lab_id: lab, account_id: ownerId, lot_number: "R0", expiration_date: d(-200), quantity: 0 });
    // VeritaTrack
    ids.task = insert("veritatrack_tasks", { user_id: ownerId, lab_id: lab, name: "Made-up monthly task", frequency: "Monthly", frequency_months: 1, active: 1 });
    ids.so1 = insert("veritatrack_signoffs", { task_id: ids.task, user_id: ownerId, lab_id: lab, completed_date: d(-70) });
    ids.so2 = insert("veritatrack_signoffs", { task_id: ids.task, user_id: ownerId, lab_id: lab, completed_date: d(-40) });
    ids.soVoid = insert("veritatrack_signoffs", { task_id: ids.task, user_id: ownerId, lab_id: lab, completed_date: d(-100), voided_at: today });
    ids.taskCurrent = insert("veritatrack_tasks", { user_id: ownerId, lab_id: lab, name: "Made-up current task", frequency: "Annual", frequency_months: 12, active: 1 });
    ids.soCurrent = insert("veritatrack_signoffs", { task_id: ids.taskCurrent, user_id: ownerId, lab_id: lab, completed_date: d(-30) });
    // VeritaMap
    ids.map = insert("veritamap_maps", { user_id: ownerId, lab_id: lab, name: "Made-up Map", instruments: "[]", created_at: today, updated_at: today });
    ids.mapTest = insert("veritamap_tests", { map_id: ids.map, analyte: "Sodium", last_cal_ver: d(-200), last_sop_review: d(-30), updated_at: today });
    ids.mapNa = insert("veritamap_tests", { map_id: ids.map, analyte: "Potassium", last_cal_ver: d(-400), cal_ver_na: 1, updated_at: today });
    // Policies
    ids.pol = insert("policy_documents", { lab_id: lab, owner_user_id: ownerId, title: "Made-up Policy", status: "approved", next_review_date: d(-15), review_interval_months: 12 });
    ids.polAuto = insert("policy_documents", { lab_id: lab, owner_user_id: ownerId, title: "Made-up Lapsed Policy", status: "expired", next_review_date: d(-90), review_interval_months: 24 });
    insert("policy_audit_log", { lab_id: lab, document_id: ids.polAuto, user_id: 0, action: "auto_expired", created_at: today });
    ids.polHand = insert("policy_documents", { lab_id: lab, owner_user_id: ownerId, title: "Made-up Retired By Hand", status: "expired", next_review_date: d(-90), review_interval_months: 24 });
    insert("policy_audit_log", { lab_id: lab, document_id: ids.polHand, user_id: ownerId, action: "status_changed", created_at: today });
    // Findings and scan items
    ids.findOpen = insert("findings", { user_id: ownerId, lab_id: lab, accreditor: "TJC", due_date: d(-45), status: "open" });
    ids.findClosed = insert("findings", { user_id: ownerId, lab_id: lab, accreditor: "TJC", due_date: d(-45), status: "closed" });
    ids.effOpen = insert("finding_effectiveness_checks", { finding_id: ids.findOpen, lab_id: lab, interval_days: 90, due_date: d(-10), status: "pending" });
    ids.effDone = insert("finding_effectiveness_checks", { finding_id: ids.findClosed, lab_id: lab, interval_days: 90, due_date: d(-10), status: "effective", verified_at: today });
    ids.groupOpen = insert("study_signoff_groups", { lab_id: lab, name: "Made-up group", due_date: d(-5), status: "open", created_at: today });
    ids.groupSigned = insert("study_signoff_groups", { lab_id: lab, name: "Made-up signed group", due_date: d(-5), status: "signed", created_at: today, signed_at: today });
    ids.scan = insert("veritascan_scans", { user_id: ownerId, lab_id: lab, name: "Made-up Scan", created_at: today, updated_at: today });
    ids.scanOpen = insert("veritascan_items", { scan_id: ids.scan, item_id: 1, status: "Needs Attention", due_date: d(-3), updated_at: today });
    ids.scanDone = insert("veritascan_items", { scan_id: ids.scan, item_id: 2, status: "Compliant", due_date: d(-3), updated_at: today });
    // Competency: an active tester whose annual is past due
    const staffLab = insert("staff_labs", { user_id: ownerId, lab_name: "Made-up Staff Lab", tier2_lab_id: lab });
    ids.emp = insert("staff_employees", { lab_id: staffLab, tier2_lab_id: lab, user_id: ownerId, first_name: "Made-up", last_name: `Tester${lab}`, hire_date: d(-900), status: "active", performs_testing: 1, created_at: today, updated_at: today });
    ids.sched = insert("staff_competency_schedules", { employee_id: ids.emp, lab_id: staffLab, initial_completed_at: d(-880), six_month_due_at: d(-700), six_month_completed_at: d(-700), first_annual_due_at: d(-515), first_annual_completed_at: d(-515), annual_due_at: d(-35), last_annual_completed_at: d(-400) });
    return ids;
  };
  const A = fixtures(labA, owner);
  const C = fixtures(labC, client);
  const competencyBucket = (lab: number, emp: number) => {
    const row = sqlite.prepare("SELECT e.id, s.initial_completed_at, s.six_month_due_at, s.six_month_completed_at, s.first_annual_due_at, s.first_annual_completed_at, s.annual_due_at, s.last_annual_completed_at, s.recorded_as, e.hire_date, e.created_at FROM staff_employees e LEFT JOIN staff_competency_schedules s ON s.employee_id = e.id WHERE e.id = ?").get(emp);
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return deriveCompetencyStatus(row, t, labMethodClocks(sqlite, lab).get(emp)).bucket;
  };
  check("0. the fixture tester reads overdue before the refresh", competencyBucket(labA, A.emp) === "overdue", competencyBucket(labA, A.emp));

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const post = async (body: any, hdr = true) => {
    const r = await fetch(`${base}/api/admin/demo-dates/refresh`, { method: "POST", headers: { "Content-Type": "application/json", ...(hdr ? { "x-admin-secret": process.env.ADMIN_SECRET || "" } : {}) }, body: JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, j, text };
  };
  const TABLES = ["lab_certificates", "lab_equipment", "equipment_maintenance_events", "pt_events", "qc_control_lots", "inventory_items", "inventory_lots", "veritatrack_signoffs", "veritamap_tests", "policy_documents", "findings", "veritascan_items", "staff_employees", "staff_competency_schedules"];
  const snapshot = () => JSON.stringify(TABLES.map((t) => sqlite.prepare(`SELECT * FROM ${t} ORDER BY id`).all()));
  const auditCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_label LIKE 'Demo dates moved forward%'").get() as any).n;

  try {
    // 1. Gates
    const noHdr = await post({ labIds: [labA], secret: process.env.ADMIN_SECRET, dryRun: false, confirm: DEMO_DATES_CONFIRM }, false);
    check("1. refuses without the admin header, even with the secret in the body", noHdr.status === 403, String(noHdr.status));
    const noLabs = await post({});
    check("1. labIds is required, and the answer lists the eligible labs", noLabs.status === 400 && noLabs.j.code === "LAB_IDS_REQUIRED" && JSON.stringify(noLabs.j.eligible) === JSON.stringify([labA]), noLabs.text);
    const noConfirm = await post({ labIds: [labA], dryRun: false });
    check("1. a write needs the confirm words", noConfirm.status === 400 && noConfirm.j.code === "CONFIRM_REQUIRED", noConfirm.text);

    // 2. Refusals
    const before = snapshot();
    const withClient = await post({ labIds: [labA, labC], dryRun: false, confirm: DEMO_DATES_CONFIRM });
    check("2. a client lab refuses the whole request", withClient.status === 400 && withClient.j.code === "LAB_NOT_ELIGIBLE" && withClient.j.refused?.[0]?.code === "NOT_IN_QA_SYSTEM", withClient.text);
    const withOther = await post({ labIds: [labJ], dryRun: false, confirm: DEMO_DATES_CONFIRM });
    check("2. a QA-system lab someone else owns is refused", withOther.status === 400 && withOther.j.refused?.[0]?.code === "OWNER_NOT_QA_SYSTEM_OWNER", withOther.text);
    const missing = await post({ labIds: [999999] });
    check("2. an unknown lab is refused", missing.status === 400 && missing.j.refused?.[0]?.code === "LAB_NOT_FOUND", missing.text);
    check("2. nothing was written by a refusal", snapshot() === before);

    // 3. Dry run
    const dry = await post({ labIds: [labA] });
    check("3. a dry run answers 200 and writes nothing", dry.status === 200 && dry.j.dryRun === true && snapshot() === before, dry.text.slice(0, 300));
    check("3. it names no person or lab", !/Made-up/.test(dry.text));
    check("3. it lists changes for this lab only", dry.j.planned > 0 && dry.j.changes.every((c: any) => c.labId === labA), String(dry.j.planned));
    const ra = dry.j.readiness;
    check("3. readiness before shows the lab overdue", ra?.before?.[labA]?.status === "overdue", JSON.stringify(ra?.before?.[labA]));
    check("3. readiness after has nothing overdue", ra?.after?.[labA]?.overdue_items === 0, JSON.stringify(ra?.after?.[labA]));

    // 4. Write
    const res = await post({ labIds: [labA], dryRun: false, confirm: DEMO_DATES_CONFIRM });
    check("4. the write answers 200 and changes every planned row", res.status === 200 && res.j.changed === dry.j.planned && res.j.changed > 0, `${res.status} ${res.j.changed}/${dry.j.planned}`);
    check("4. CLIA certificate moves by its own 24-month span, issue date with it", val("lab_certificates", A.certStale, "expiration_date") === d(-100, 24) && val("lab_certificates", A.certStale, "issued_date") === addLabDays(d(-100, -24), 0, 24));
    check("4. equipment moves by its 180-day interval, with its last PM event", val("lab_equipment", A.eq, "next_due_date") === d(170) && val("equipment_maintenance_events", A.eqEvent, "event_date") === d(-10) && val("equipment_maintenance_events", A.eqEvent, "next_due_date") === d(170));
    check("4. pending PT becomes next year's event", val("pt_events", A.ptPending, "submission_due_date") === addLabDays(d(-20), 0, 12) && val("pt_events", A.ptPending, "event_date") === addLabDays(d(-50), 0, 12));
    check("4. active QC lot and stocked lot and item move a year", val("qc_control_lots", A.qcActive, "expiration_date") === addLabDays(d(-5), 0, 12) && val("inventory_lots", A.lotFull, "expiration_date") === addLabDays(d(-30), 0, 12) && val("inventory_items", A.item, "expiration_date") === addLabDays(d(-30), 0, 12));
    const so2 = val("veritatrack_signoffs", A.so2, "completed_date");
    check("4. VeritaTrack sign-offs move by whole months; the last is on or before today and its next due today or later", so2 === addLabDays(d(-40), 0, 1) && val("veritatrack_signoffs", A.so1, "completed_date") === addLabDays(d(-70), 0, 1) && so2 <= today && addLabDays(so2, 0, 1) >= today, so2);
    const calVer = val("veritamap_tests", A.mapTest, "last_cal_ver");
    check("4. VeritaMap calibration verification moves by 6 months, due again today or later", calVer === addLabDays(d(-200), 0, 6) && calVer <= today && addLabDays(calVer, 0, 6) >= today, calVer);
    check("4. a policy review moves by its interval", val("policy_documents", A.pol, "next_review_date") === addLabDays(d(-15), 0, 12) && val("policy_documents", A.pol, "status") === "approved");
    check("4. an auto-expired policy is approved again with its new date", val("policy_documents", A.polAuto, "status") === "approved" && val("policy_documents", A.polAuto, "next_review_date") === addLabDays(d(-90), 0, 24));
    check("4. an open finding and an open scan item move by 30 days", val("findings", A.findOpen, "due_date") === d(15) && val("veritascan_items", A.scanOpen, "due_date") === d(27));
    check("4. an open effectiveness check and an unsigned sign-off group move by 30 days; verified and signed ones stay", val("finding_effectiveness_checks", A.effOpen, "due_date") === d(20) && val("study_signoff_groups", A.groupOpen, "due_date") === d(25) && val("finding_effectiveness_checks", A.effDone, "due_date") === d(-10) && val("study_signoff_groups", A.groupSigned, "due_date") === d(-5));
    check("4. the overdue tester's timeline moves a year and reads not overdue", val("staff_competency_schedules", A.sched, "annual_due_at") === addLabDays(d(-35), 0, 12) && val("staff_employees", A.emp, "hire_date") === addLabDays(d(-900), 0, 12) && competencyBucket(labA, A.emp) !== "overdue", competencyBucket(labA, A.emp));
    check("4. readiness after the write has nothing overdue", res.j.readiness?.after?.[labA]?.overdue_items === 0, JSON.stringify(res.j.readiness?.after?.[labA]));

    // 5. History and current rows
    check("5. a current or inactive certificate stays", val("lab_certificates", A.certCurrent, "expiration_date") === d(165) && val("lab_certificates", A.certInactive, "expiration_date") === d(-400));
    check("5. retired equipment, graded PT, a retired QC lot and an empty lot stay", val("lab_equipment", A.eqRetired, "next_due_date") === d(-300) && val("pt_events", A.ptGraded, "submission_due_date") === d(-60) && val("qc_control_lots", A.qcRetired, "expiration_date") === d(-300) && val("inventory_lots", A.lotEmpty, "expiration_date") === d(-200));
    check("5. a voided sign-off and a current task's sign-off stay", val("veritatrack_signoffs", A.soVoid, "completed_date") === d(-100) && val("veritatrack_signoffs", A.soCurrent, "completed_date") === d(-30));
    check("5. an N/A VeritaMap field and a current SOP review stay", val("veritamap_tests", A.mapNa, "last_cal_ver") === d(-400) && val("veritamap_tests", A.mapTest, "last_sop_review") === d(-30));
    check("5. a policy expired by hand keeps its status", val("policy_documents", A.polHand, "status") === "expired");
    check("5. a closed finding and a compliant scan item stay", val("findings", A.findClosed, "due_date") === d(-45) && val("veritascan_items", A.scanDone, "due_date") === d(-3));

    // 6. Performed dates, audit, rerun
    const PERFORMED = new Set(["issued_date", "event_date", "completed_date", "last_cal_ver", "last_method_comp", "last_precision", "last_sop_review", "hire_date", "signed_date", "last_performed_date", "work_performed_date", "signoff_date", "initial_completed_at", "six_month_completed_at", "first_annual_completed_at", "last_annual_completed_at", "invoice_date", "on_order_placed_date", "last_reviewed"]);
    const late = res.j.changes.flatMap((c: any) => Object.entries(c.changes).filter(([col, v]: any) => PERFORMED.has(col) && String(v[1]).slice(0, 10) > today && c.table !== "pt_events").map(([col]) => `${c.table}.${col}`));
    check("6. no performed date lands after today", late.length === 0, late.join(", "));
    check("6. one audit row per row changed", auditCount() === res.j.changed, `${auditCount()} vs ${res.j.changed}`);
    check("6. nothing is left to move", res.j.remaining === 0, String(res.j.remaining));
    const again = await post({ labIds: [labA], dryRun: false, confirm: DEMO_DATES_CONFIRM });
    check("6. a second run changes nothing", again.status === 200 && again.j.changed === 0 && again.j.planned === 0, again.text.slice(0, 200));

    // 7. The client lab
    check("7. the client lab's certificate, equipment, sign-offs and tester are untouched", val("lab_certificates", C.certStale, "expiration_date") === d(-100) && val("lab_equipment", C.eq, "next_due_date") === d(-10) && val("veritatrack_signoffs", C.so2, "completed_date") === d(-40) && val("staff_competency_schedules", C.sched, "annual_due_at") === d(-35));
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
