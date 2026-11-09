// tests/integration/veritatrack-signoff-log.test.ts
//
// STANDING integration test for the VeritaTrack sign-off log and the void rule, Michael 2026-11-09: "Does veritatrack hold
// a log of all historical sign offs and is it available to customers? Both of these need to be true because an inspector is
// going to ask for it."
//   1. Three sign-offs on one task all appear in the log, with who recorded them and when.
//   2. A sign-off from before the audit trail (created_at before 2026-06-12, no audit row, no lab_id) appears.
//   3. A removed task's sign-offs appear, labeled Removed, and the task leaves the active list.
//   4. A void needs a reason, keeps the row, leaves next due / status / dashboard / worklist / calendar export / reminders,
//      so the previous sign-off drives the due date, and shows in the log with the reason. A second void is refused.
//   5. The old DELETE path voids (reason required) and never deletes.
//   6. A pre-rule "signoff_deleted" audit event shows as Deleted before the void rule, with its date and performer.
//   7. The date, task and category filters work; a bad filter is refused.
//   8. Another lab's sign-offs never appear, even when a row's own lab_id points here; another lab can't read this log.
//   9. Reach is the task detail's: a staff member reads both, a view-only seat is refused both.
//  10. The Excel export: About first, a Sign-off Log sheet with one row per sign-off, lab identity, protection, filters.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Nothing is mailed.
// Run: npm run test:veritatrack-signoff-log

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { runVeritaTrackReminders } from "../../server/veritatrackReminders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const fetchBuf = async (p: string, token: string) => {
    const r = await fetch(base + p, { headers: { Authorization: `Bearer ${token}` } });
    return { status: r.status, type: r.headers.get("content-type") || "", disp: r.headers.get("content-disposition") || "", buf: Buffer.from(await r.arrayBuffer()) };
  };
  const PW = ["Log", "void", "7x!"].join("-");
  const register = async (tag: string, name: string) => {
    const email = `it-vtlog-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    return { email, userId: Number(reg.body?.user?.id), name };
  };
  const login = async (u: { email: string; userId: number }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.userId);
    return (await call("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const makeLab = async (u: { email: string }, clia: string, name: string) => {
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: u.email, labName: "placeholder", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET clia_number = ?, lab_name = ? WHERE id = ?").run(clia, name, labId);
    return labId;
  };

  const owner = await register("owner", "Olive Logowner");
  const other = await register("other", "Otto Otherlab");
  const staff = await register("staff", "Stan Staffmember");
  const viewer = await register("viewer", "Vera Viewseat");
  const labId = await makeLab(owner, "22D7781001", "IT Log Lab");
  const otherLab = await makeLab(other, "22D7781002", "IT Other Lab");
  const nowIso = new Date().toISOString();
  for (const u of [staff, viewer]) {
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(labId, u.userId, nowIso, nowIso, nowIso);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, u.userId);
  }
  sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
     VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'view_only')`
  ).run(owner.userId, viewer.email, viewer.userId, nowIso, nowIso, `it-vtlog-${Date.now()}`, labId);
  const token = await login(owner);
  const otherToken = await login(other);
  const staffToken = await login(staff);
  const viewerToken = await login(viewer);
  const T = `/api/labs/${labId}/veritatrack/tasks`;
  const LOG = `/api/labs/${labId}/veritatrack/signoff-log`;
  const getLog = async (qs = "", tk = token) => call("GET", `${LOG}${qs ? `?${qs}` : ""}`, undefined, tk, labId);
  const newTask = async (name: string, category: string, frequency: string, lab = labId, tk = token) =>
    (await call("POST", `/api/labs/${lab}/veritatrack/tasks`, { name, category, frequency }, tk, lab)).body;
  const signOff = async (taskId: number, completed_date: string, performed_by: string, initials: string, notes = "", lab = labId, tk = token) =>
    (await call("POST", `/api/veritatrack/tasks/${taskId}/signoff`, { completed_date, performed_by, initials, notes }, tk, lab)).body;

  // ── 1. Three sign-offs on one task ──
  const taskA = await newTask("Monthly QC review (made-up)", "QC Review", "Monthly");
  const a1 = await signOff(taskA.id, "2026-08-01", "Pat Example", "PE", "Lot 1 reviewed");
  const a2 = await signOff(taskA.id, "2026-09-01", "Pat Example", "PE", "Lot 2 reviewed");
  const a3 = await signOff(taskA.id, "2026-10-01", "Sam Sample", "SS", "Lot 3 reviewed");
  check("1a. three sign-offs are saved", [a1, a2, a3].every((s) => Number.isInteger(s?.id)), JSON.stringify([a1?.id, a2?.id, a3?.id]));
  let log = await getLog();
  const rowsFor = (l: any, taskId: number) => (l.body.rows || []).filter((r: any) => r.task_id === taskId && r.entry !== "deleted_before_void_rule");
  const aRows = rowsFor(log, taskA.id);
  check("1b. the log answers", log.status === 200 && Array.isArray(log.body.rows), `HTTP ${log.status}`);
  check("1c. all three sign-offs on the task appear", aRows.length === 3 && [a1.id, a2.id, a3.id].every((id) => aRows.some((r: any) => r.signoff_id === id)), `${aRows.length}`);
  const r1 = aRows.find((r: any) => r.signoff_id === a1.id);
  check("1d. a row carries date, task, category, frequency, performer, initials and notes",
    r1?.completed_date === "2026-08-01" && r1?.task_name === "Monthly QC review (made-up)" && r1?.category === "QC Review" && r1?.frequency === "Monthly"
      && r1?.performed_by === "Pat Example" && r1?.initials === "PE" && r1?.notes === "Lot 1 reviewed", JSON.stringify(r1));
  check("1e. a row says who recorded it and when", r1?.recorded_by === owner.name && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r1?.recorded_at || "") && !!r1?.recorded_at_utc, `${r1?.recorded_by} ${r1?.recorded_at}`);
  check("1f. the task reads Active and the entry Recorded", r1?.task_state === "Active" && r1?.entry === "recorded" && r1?.entry_label === "Recorded");
  check("1g. newest completed date first", aRows.map((r: any) => r.completed_date).join(",") === "2026-10-01,2026-09-01,2026-08-01", aRows.map((r: any) => r.completed_date).join(","));
  check("1h. the log names the lab from the live record", log.body.lab?.name === "IT Log Lab" && log.body.lab?.clia === "22D7781001", JSON.stringify(log.body.lab));

  // ── 2. A sign-off from before the audit trail: created 2026-03-01, no audit row, no lab_id (as the map import left them) ──
  const taskC = await newTask("Thermometer check (made-up)", "Equipment Calibration", "Monthly");
  const oldId = Number(sqlite.prepare(
    "INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, initials, performed_by, notes, created_at, lab_id) VALUES (?, ?, '2026-03-01', 'OT', 'Old Timer', 'Before the audit trail', '2026-03-01 10:00:00', NULL)"
  ).run(taskC.id, owner.userId).lastInsertRowid);
  const oldAudit = sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_audit WHERE signoff_id = ?").get(oldId) as any;
  log = await getLog();
  const oldRow = log.body.rows.find((r: any) => r.signoff_id === oldId);
  check("2a. the old sign-off has no audit row", Number(oldAudit.n) === 0);
  check("2b. it still appears in the log", !!oldRow && oldRow.completed_date === "2026-03-01" && oldRow.performed_by === "Old Timer" && oldRow.notes === "Before the audit trail", JSON.stringify(oldRow));
  check("2c. its recorded-at is the row's own time and its recorder the account on it", oldRow?.recorded_at_utc === "2026-03-01T10:00:00Z" && oldRow?.recorded_by === owner.name, `${oldRow?.recorded_at_utc} ${oldRow?.recorded_by}`);

  // ── 3. A removed task ──
  const taskB = await newTask("Pipette calibration (made-up)", "Equipment Calibration", "Annual");
  const b1 = await signOff(taskB.id, "2026-07-15", "Robin Remover", "RR", "Annual check");
  const removed = await call("DELETE", `/api/veritatrack/tasks/${taskB.id}`, undefined, token, labId);
  const activeList = (await call("GET", T, undefined, token, labId)).body;
  check("3a. the task is taken off the active list", removed.status === 200 && Array.isArray(activeList) && !activeList.some((t: any) => t.id === taskB.id), `HTTP ${removed.status}`);
  check("3b. its sign-off is still on file", (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_signoffs WHERE id = ?").get(b1.id) as any).n === 1);
  log = await getLog();
  const bRow = log.body.rows.find((r: any) => r.signoff_id === b1.id);
  check("3c. a removed task's sign-off appears in the log, labeled Removed", !!bRow && bRow.task_state === "Removed" && bRow.task_name === "Pipette calibration (made-up)", JSON.stringify(bRow));
  check("3d. the log's task list offers the removed task, marked", log.body.tasks.some((t: any) => t.id === taskB.id && t.active === false));

  // ── 4. A void ──
  const V = (id: number) => `/api/veritatrack/signoffs/${id}/void`;
  const beforeVoid = (await call("GET", T, undefined, token, labId)).body.find((t: any) => t.id === taskA.id);
  check("4a. before the void, the 10/01 sign-off drives next due (11/01)", beforeVoid?.last_signoff?.completed_date === "2026-10-01" && beforeVoid?.next_due === "2026-11-01", `${beforeVoid?.last_signoff?.completed_date} ${beforeVoid?.next_due}`);
  const noReason = await call("POST", V(a3.id), {}, token, labId);
  const blankReason = await call("POST", V(a3.id), { reason: "   " }, token, labId);
  check("4b. a void with no reason is refused", noReason.status === 400 && noReason.body?.code === "VOID_REASON_REQUIRED", `HTTP ${noReason.status}`);
  check("4c. a blank reason is refused", blankReason.status === 400);
  check("4d. a refused void changes nothing", (sqlite.prepare("SELECT voided_at FROM veritatrack_signoffs WHERE id = ?").get(a3.id) as any)?.voided_at == null);
  check("4e. a staff member without VeritaTrack edit cannot void", [401, 403].includes((await call("POST", V(a3.id), { reason: "Not mine" }, staffToken, labId)).status));
  check("4f. another lab's owner cannot void it", [403, 404].includes((await call("POST", V(a3.id), { reason: "Not mine" }, otherToken, otherLab)).status));
  const voided = await call("POST", V(a3.id), { reason: "Entered on the wrong task" }, token, labId);
  const a3Row = sqlite.prepare("SELECT * FROM veritatrack_signoffs WHERE id = ?").get(a3.id) as any;
  check("4g. the void answers ok", voided.status === 200 && voided.body?.ok === true && !!voided.body?.signoff?.voided_at, `HTTP ${voided.status} ${JSON.stringify(voided.body).slice(0, 120)}`);
  check("4h. the row is kept, marked with who, when and why", !!a3Row && !!a3Row.voided_at && a3Row.voided_by_user_id === owner.userId && a3Row.void_reason === "Entered on the wrong task" && a3Row.completed_date === "2026-10-01");
  check("4i. a second void is refused", (await call("POST", V(a3.id), { reason: "Again" }, token, labId)).status === 409);
  const audit = sqlite.prepare("SELECT event, detail FROM veritatrack_audit WHERE signoff_id = ? ORDER BY id").all(a3.id) as any[];
  check("4j. the audit trail records the void with the reason", audit.some((e) => e.event === "signoff_voided" && /Entered on the wrong task/.test(e.detail) && /2026-10-01/.test(e.detail)), JSON.stringify(audit));
  const afterList = (await call("GET", T, undefined, token, labId)).body.find((t: any) => t.id === taskA.id);
  check("4k. lab task list: the previous sign-off (09/01) drives next due (10/01)", afterList?.last_signoff?.completed_date === "2026-09-01" && afterList?.next_due === "2026-10-01" && afterList?.status === "overdue", `${afterList?.last_signoff?.completed_date} ${afterList?.next_due} ${afterList?.status}`);
  const legacyList = (await call("GET", "/api/veritatrack/tasks", undefined, token, labId)).body.find((t: any) => t.id === taskA.id);
  check("4l. the older task list agrees", legacyList?.last_signoff?.completed_date === "2026-09-01" && legacyList?.next_due === "2026-10-01");
  const detail = (await call("GET", `/api/veritatrack/tasks/${taskA.id}`, undefined, token, labId)).body;
  check("4m. task detail keeps all three, the voided one marked, and next due follows 09/01",
    detail?.signoffs?.length === 3 && detail.signoffs.some((s: any) => s.id === a3.id && s.voided_at && s.voided_by_name === owner.name) && detail?.next_due === "2026-10-01", `${detail?.signoffs?.length} ${detail?.next_due}`);
  const dash = (await call("GET", `/api/labs/${labId}/veritatrack/dashboard`, undefined, token, labId)).body;
  const legacyDash = (await call("GET", "/api/veritatrack/dashboard", undefined, token, labId)).body;
  const inOverdue = (d: any) => (d?.overdueItems || []).some((t: any) => t.id === taskA.id && t.next_due === "2026-10-01");
  check("4n. both dashboards count it overdue from 10/01", inOverdue(dash) && inOverdue(legacyDash));
  const worklist = (await call("GET", `/api/labs/${labId}/veritatrack/worklist`, undefined, token, labId)).body;
  check("4o. the worklist puts it in overdue from 10/01", (worklist?.buckets?.overdue || []).some((t: any) => t.id === taskA.id && t.next_due === "2026-10-01" && t.last_signoff?.completed_date === "2026-09-01"));
  // The calendar workbook's Last Performed is the live sign-off.
  const { default: ExcelJS } = await import("exceljs");
  const cal = await fetch(base + "/api/veritatrack/export/excel", { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) } });
  const calWb = new ExcelJS.Workbook();
  await calWb.xlsx.load(Buffer.from(await cal.arrayBuffer()) as any);
  const calWs = calWb.getWorksheet("Regulatory Calendar");
  let calLast = "";
  calWs?.eachRow((row) => { if (row.getCell(3).value === "Monthly QC review (made-up)") calLast = String(row.getCell(6).value ?? ""); });
  check("4p. the calendar export's Last Performed is 09/01", calLast === "2026-09-01", calLast);
  const calAbout = JSON.stringify(calWb.getWorksheet("About")?.getSheetValues() ?? []);
  check("4q. the calendar's About points to the Sign-off log and says a void doesn't count", /Sign-off log/.test(calAbout) && /voided sign-off is not counted/.test(calAbout));
  // The nightly reminders date the task from 09/01.
  await call("PUT", `/api/labs/${labId}/veritatrack/reminder-config`, { enabled: true, lead_days: 14, overdue_cadence_days: 2, recipients: [{ email: `it-vtlog-rem-${Date.now()}@example.com` }] }, token, labId);
  sqlite.prepare("DELETE FROM veritatrack_reminder_log WHERE lab_id = ?").run(labId);
  await runVeritaTrackReminders({ send: async () => ({ data: { id: "stub" } }) });
  const remRow = sqlite.prepare("SELECT due_date FROM veritatrack_reminder_log WHERE task_id = ? ORDER BY id DESC LIMIT 1").get(taskA.id) as any;
  check("4r. the reminders date the task from 09/01 (due 10/01)", remRow?.due_date === "2026-10-01", remRow?.due_date);
  log = await getLog();
  const vRow = log.body.rows.find((r: any) => r.signoff_id === a3.id);
  check("4s. the voided sign-off shows in the log with the reason, who and when",
    vRow?.entry === "voided" && vRow?.entry_label === "Voided" && vRow?.void_reason === "Entered on the wrong task" && vRow?.voided_by === owner.name && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(vRow?.voided_at || ""), JSON.stringify(vRow));

  // ── 5. The old DELETE path ──
  const delNoReason = await call("DELETE", `/api/veritatrack/signoffs/${a2.id}`, undefined, token, labId);
  check("5a. DELETE without a reason is refused and the row stays", delNoReason.status === 400 && (sqlite.prepare("SELECT voided_at FROM veritatrack_signoffs WHERE id = ?").get(a2.id) as any)?.voided_at == null, `HTTP ${delNoReason.status}`);
  const deletedBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_audit WHERE event = 'signoff_deleted'").get() as any).n;
  const del = await call("DELETE", `/api/veritatrack/signoffs/${a2.id}`, { reason: "Duplicate entry" }, token, labId);
  const a2Row = sqlite.prepare("SELECT * FROM veritatrack_signoffs WHERE id = ?").get(a2.id) as any;
  check("5b. DELETE with a reason voids the sign-off", del.status === 200 && !!a2Row && !!a2Row.voided_at && a2Row.void_reason === "Duplicate entry", `HTTP ${del.status}`);
  check("5c. DELETE writes a void to the audit trail, never a deletion",
    (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_audit WHERE event = 'signoff_deleted'").get() as any).n === deletedBefore
      && (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_audit WHERE event = 'signoff_voided' AND signoff_id = ?").get(a2.id) as any).n === 1);
  const afterDel = (await call("GET", T, undefined, token, labId)).body.find((t: any) => t.id === taskA.id);
  check("5d. with 09/01 and 10/01 voided, 08/01 drives next due (09/01)", afterDel?.last_signoff?.completed_date === "2026-08-01" && afterDel?.next_due === "2026-09-01", `${afterDel?.last_signoff?.completed_date} ${afterDel?.next_due}`);
  check("5e. every sign-off row on the task is still on file", (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_signoffs WHERE task_id = ?").get(taskA.id) as any).n === 3);

  // ── 6. A deletion from before the void rule, read back from the audit trail ──
  sqlite.prepare(
    "INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id, at) VALUES (?, ?, 990001, 'signoff_deleted', 'Removed sign-off dated 2026-05-15 (Dana Deleted)', ?, '2026-06-20 12:00:00')"
  ).run(labId, taskA.id, owner.userId);
  sqlite.prepare(
    "INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id, at) VALUES (?, ?, 990002, 'signoff_deleted', 'Removed sign-off dated 2026-05-20', ?, '2026-06-21 12:00:00')"
  ).run(labId, taskC.id, owner.userId);
  log = await getLog();
  const dRow = log.body.rows.find((r: any) => r.entry === "deleted_before_void_rule" && r.signoff_id === 990001);
  const dRow2 = log.body.rows.find((r: any) => r.entry === "deleted_before_void_rule" && r.signoff_id === 990002);
  check("6a. a pre-rule deletion shows, labeled", dRow?.entry_label === "Deleted before the void rule" && dRow?.task_name === "Monthly QC review (made-up)", JSON.stringify(dRow));
  check("6b. with the date and performer its detail holds", dRow?.completed_date === "2026-05-15" && dRow?.performed_by === "Dana Deleted", `${dRow?.completed_date} ${dRow?.performed_by}`);
  check("6c. and who deleted it and when", dRow?.deleted_by === owner.name && dRow?.deleted_at_utc === "2026-06-20T12:00:00Z", `${dRow?.deleted_by} ${dRow?.deleted_at_utc}`);
  check("6d. a deletion with no performer shows too", dRow2?.completed_date === "2026-05-20" && dRow2?.performed_by === null);
  check("6e. the counts add up", log.body.counts.rows === log.body.rows.length && log.body.counts.recorded === 3 && log.body.counts.voided === 2 && log.body.counts.deleted_before_void_rule === 2, JSON.stringify(log.body.counts));

  // ── 7. Filters ──
  const sept = await getLog("from=2026-09-01&to=2026-09-30");
  check("7a. a September range returns only the 09/01 sign-off", sept.status === 200 && sept.body.rows.length === 1 && sept.body.rows[0].signoff_id === a2.id, sept.body.rows?.map((r: any) => r.completed_date).join(","));
  const may = await getLog("from=2026-05-01&to=2026-05-31");
  check("7b. the date filter covers pre-rule deletions by their completion date", may.body.rows.length === 2 && may.body.rows.every((r: any) => r.entry === "deleted_before_void_rule"), may.body.rows?.map((r: any) => r.completed_date).join(","));
  const fromOnly = await getLog("from=2026-08-01");
  check("7c. a start date alone keeps everything on or after it", fromOnly.body.rows.length === 3 && fromOnly.body.rows.every((r: any) => r.completed_date >= "2026-08-01"), fromOnly.body.rows?.map((r: any) => r.completed_date).join(","));
  const toOnly = await getLog("to=2026-03-31");
  check("7d. an end date alone keeps everything on or before it", toOnly.body.rows.length === 1 && toOnly.body.rows[0].signoff_id === oldId);
  const byTask = await getLog(`task_id=${taskB.id}`);
  check("7e. the task filter returns that task only, removed or not", byTask.body.rows.length === 1 && byTask.body.rows[0].signoff_id === b1.id);
  const byCat = await getLog(`category=${encodeURIComponent("Equipment Calibration")}`);
  check("7f. the category filter returns that category only", byCat.body.rows.length === 3 && byCat.body.rows.every((r: any) => r.category === "Equipment Calibration"), `${byCat.body.rows?.length}`);
  check("7g. a bad date is refused", (await getLog("from=11/01/2026")).status === 400);
  check("7h. a start after the end is refused", (await getLog("from=2026-10-01&to=2026-09-01")).status === 400);

  // ── 8. Cross-lab ──
  const otherTask = await newTask("Other lab QC (made-up)", "QC Review", "Monthly", otherLab, otherToken);
  const o1 = await signOff(otherTask.id, "2026-09-15", "Other Person", "OP", "Other lab", otherLab, otherToken);
  // A row whose own lab_id was back-filled to this lab, on the other lab's task, and an audit deletion stamped with this lab.
  const strayId = Number(sqlite.prepare("INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, performed_by, lab_id) VALUES (?, ?, '2026-09-16', 'Stray Row', ?)").run(otherTask.id, other.userId, labId).lastInsertRowid);
  sqlite.prepare("INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id, at) VALUES (?, ?, 990003, 'signoff_deleted', 'Removed sign-off dated 2026-05-25 (Stray Deletion)', ?, '2026-06-22 12:00:00')").run(labId, otherTask.id, other.userId);
  log = await getLog();
  const text = JSON.stringify(log.body);
  check("8a. another lab's sign-offs never appear here", !log.body.rows.some((r: any) => [o1.id, strayId].includes(r.signoff_id)) && !/Other Person|Stray Row|Stray Deletion|Other lab QC/.test(text));
  check("8b. another lab's task is not offered as a filter", !log.body.tasks.some((t: any) => t.id === otherTask.id));
  const crossTask = await getLog(`task_id=${otherTask.id}`);
  check("8c. naming another lab's task returns nothing", crossTask.status === 200 && crossTask.body.rows.length === 0);
  const otherReads = await call("GET", LOG, undefined, otherToken, labId);
  check("8d. another lab's owner cannot read this lab's log", [403, 404].includes(otherReads.status), `HTTP ${otherReads.status}`);
  const otherExcel = await fetchBuf(`${LOG}/excel`, otherToken);
  check("8e. or export it", [403, 404].includes(otherExcel.status), `HTTP ${otherExcel.status}`);
  const otherLog = await call("GET", `/api/labs/${otherLab}/veritatrack/signoff-log`, undefined, otherToken, otherLab);
  const otherText = JSON.stringify(otherLog.body);
  check("8f. the other lab's log has its own rows, the stray ones included, and none of ours",
    otherLog.status === 200 && otherLog.body.rows.some((r: any) => r.signoff_id === o1.id) && otherLog.body.rows.some((r: any) => r.signoff_id === strayId)
      && /Stray Deletion/.test(otherText) && !/Monthly QC review|Pipette calibration|Old Timer|Dana Deleted/.test(otherText), `HTTP ${otherLog.status}`);

  // ── 9. Same reach as the task detail ──
  const staffDetail = await call("GET", `/api/veritatrack/tasks/${taskA.id}`, undefined, staffToken, labId);
  const staffLog = await getLog("", staffToken);
  check("9a. a staff member reads the task detail and the log", staffDetail.status === 200 && staffLog.status === 200 && staffLog.body.rows.length === log.body.rows.length, `${staffDetail.status} ${staffLog.status}`);
  const viewerDetail = await call("GET", `/api/veritatrack/tasks/${taskA.id}`, undefined, viewerToken, labId);
  const viewerLog = await getLog("", viewerToken);
  const viewerExcel = await fetchBuf(`${LOG}/excel`, viewerToken);
  check("9b. a view-only seat is refused the task detail and the log alike", viewerDetail.status === 403 && viewerLog.status === 403 && viewerExcel.status === 403, `${viewerDetail.status} ${viewerLog.status} ${viewerExcel.status}`);
  check("9c. signed out is refused", [401, 403].includes((await call("GET", LOG)).status));

  // ── 10. The Excel export ──
  const xl = await fetchBuf(`${LOG}/excel`, token);
  check("10a. the export downloads a workbook", xl.status === 200 && /spreadsheetml/.test(xl.type) && /VeritaTrack_Signoff_Log_\d{4}-\d{2}-\d{2}\.xlsx/.test(xl.disp), `${xl.status} ${xl.disp}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xl.buf as any);
  check("10b. About is the first sheet and opens first", wb.worksheets[0]?.name === "About" && wb.worksheets[1]?.name === "Sign-off Log" && (wb.views?.[0] as any)?.activeTab === 0, wb.worksheets.map((w) => w.name).join(","));
  const ws = wb.getWorksheet("Sign-off Log")!;
  const headers = (ws.getRow(1).values as any[]).slice(1);
  const expectedHeaders = ["Completed Date", "Task", "Category", "Frequency", "Task State", "Performed By", "Initials", "Notes", "Recorded By", "Recorded At", "Entry Status", "Voided or Deleted At", "Voided or Deleted By", "Void Reason"];
  check("10c. the sheet has the agreed columns", JSON.stringify(headers) === JSON.stringify(expectedHeaders), JSON.stringify(headers));
  const dataRows: any[][] = [];
  ws.eachRow((row, n) => { if (n > 1) dataRows.push((row.values as any[]).slice(1)); });
  check("10d. one row per sign-off in the log", dataRows.length === log.body.rows.length, `${dataRows.length} vs ${log.body.rows.length}`);
  const xlVoid = dataRows.find((r) => r[10] === "Voided" && r[13] === "Entered on the wrong task");
  check("10e. the voided row carries its status, who and the reason", !!xlVoid && xlVoid[0] === "2026-10-01" && xlVoid[12] === owner.name);
  check("10f. the removed task's row says Removed", dataRows.some((r) => r[1] === "Pipette calibration (made-up)" && r[4] === "Removed"));
  check("10g. the pre-rule deletion's row says so", dataRows.some((r) => r[10] === "Deleted before the void rule" && r[0] === "2026-05-15" && r[5] === "Dana Deleted"));
  check("10h. the pre-audit row is there", dataRows.some((r) => r[0] === "2026-03-01" && r[5] === "Old Timer"));
  check("10i. blank values are blank, never null or undefined", dataRows.every((r) => r.every((v) => v !== "null" && v !== "undefined")));
  const hdr = String(ws.headerFooter?.oddHeader || ""), ftr = String(ws.headerFooter?.oddFooter || "");
  check("10j. lab identity in the header and footer", hdr.includes("IT Log Lab    CLIA: 22D7781001") && ftr.includes("IT Log Lab    CLIA: 22D7781001"), hdr);
  check("10k. teal headers, frozen panes and an auto-filter", (ws.getCell("A1").fill as any)?.fgColor?.argb === "FF01696F" && (ws.views?.[0] as any)?.state === "frozen" && !!ws.autoFilter);
  check("10l. both sheets are protected", !!(ws as any).sheetProtection?.sheet && !!(wb.getWorksheet("About") as any)?.sheetProtection?.sheet);
  const aboutText = JSON.stringify(wb.getWorksheet("About")?.getSheetValues() ?? []);
  check("10m. the About names the lab and says what the sheet holds", aboutText.includes("Prepared for: IT Log Lab    CLIA: 22D7781001") && /holds every sign-off recorded in VeritaTrack/.test(aboutText) && /Deleted before the void rule/.test(aboutText));
  const EM_DASH = new RegExp(String.fromCharCode(0x2014));
  check("10n. no em dash and no audit-grade claim anywhere in it", !EM_DASH.test(aboutText + JSON.stringify(dataRows) + hdr + ftr) && !/audit-grade/i.test(aboutText));
  const xlSept = await fetchBuf(`${LOG}/excel?from=2026-09-01&to=2026-09-30`, token);
  const wbSept = new ExcelJS.Workbook();
  await wbSept.xlsx.load(xlSept.buf as any);
  const septRows = (wbSept.getWorksheet("Sign-off Log")?.rowCount ?? 0) - 1;
  check("10o. the export honors the date filter and says so on the About", septRows === 1 && /completed 2026-09-01 through 2026-09-30/.test(JSON.stringify(wbSept.getWorksheet("About")?.getSheetValues() ?? [])), `${septRows}`);

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
