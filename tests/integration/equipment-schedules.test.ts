// tests/integration/equipment-schedules.test.ts
//
// STANDING integration test for VeritaMaintain schedules and checklists (B10, 2026-11-24; server/equipmentSchedules.ts, shared/equipmentSchedules.ts):
//   1. An instrument's PM interval is its first schedule, and the two follow each other. More schedules, each with how often, next due, recipients and SOP.
//   2. Completing: the due date moves by the schedule's own frequency, never earlier unless the person says so. An entry can complete several schedules.
//   3. Checklists: every step answered; a failed step or a value outside its limits needs its corrective action; an edit adds a version and
//      changes nothing already completed; someone answering an older version is told.
//   4. Corrections and voids carry to what an entry completed. A vendor PM schedule waits for its report when the lab requires one.
//   5. The reminder digest covers every schedule and goes to each schedule's own recipients; reminders sent before schedules still count.
//   6. The review due email: off until turned on, from the 5th, to the medical director or designee, once a month, never when all is signed.
//   7. The monthly review and its workbook: days with no record, past due schedules, checklist answers.
//  7b. The days a daily schedule is due: every day unless it says, weekdays, a weekend record, a change part way through a month, the due date
//      going to the next due day, no reminder on a day it isn't due, and any other frequency refusing days.
//   8. Refusals: another lab, a view-only seat, a limited Staff login (which may complete one), Veritas support.
//   9. Move, export-all and the customer purge.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:equipment-schedules

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { EXPORT_TABLES } from "../../server/exportAllTables";
import { exportContext, selectRecords, unclassifiedTables } from "../../server/exportAll";
import { applyCustomerPurge, planCustomerPurge, purgeRule, unruledTables } from "../../server/customerPurge";
import { hashBuffer, resolveVersionFilePath } from "../../server/veritapolicyApproval";
import { equipmentMailer, runEquipmentReminders } from "../../server/equipmentReminders";
import { reviewDueRecipients, runMaintainReviewDueEmails } from "../../server/maintainReviewDue";
import { readSignMailer } from "../../server/policyReadSign";
import { addLabDays, labLocalDate, labTimeZoneById } from "../../server/dateLocal";

(globalThis as any).require ??= createRequire(import.meta.url);
const ExcelJS = createRequire(import.meta.url)("exceljs");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Sched", "rec", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const sendFile = async (p: string, token: string, kind: string) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", new Blob([new Uint8Array(Buffer.from("%PDF-1.4 made-up"))], { type: "application/pdf" }), "report.pdf");
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `sched-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Sched Lab ${tag}`, plan: "hospital", isWarehouse: true });
    sqlite.prepare("UPDATE labs SET is_demo = 0 WHERE id = ?").run(prov.body.labId);
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };

  try {
    const A = await mkLab("a"), B = await mkLab("b"), X = await mkLab("x");
    const addPerson = async (lab: { labId: number; userId: number }, tag: string, kind: "editor" | "staff" | "viewer", name = `Person ${tag}`) => {
      const email = `sched-${tag}-${Date.now()}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(lab.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ?, email_verification_pending = 0 WHERE id = ?").run(lab.labId, userId);
      let employeeId = 0;
      if (kind === "staff") {
        const sl = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab.labId) as any)?.id
          ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up', '99D0000000', ?, ?, ?)").run(lab.userId, lab.labId, now, now).lastInsertRowid);
        employeeId = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Made', 'active', ?, ?)").run(sl, lab.labId, lab.userId, tag, now, now).lastInsertRowid);
        sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`).run(lab.userId, email, userId, lab.labId, employeeId, now, now);
      } else {
        sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')`)
          .run(lab.userId, email, userId, now, now, kind === "editor" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}', `sched-${tag}-${Date.now()}`, lab.labId);
      }
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
      return { email, userId, employeeId, name, token: (await call("POST", "/api/auth/login", { email, password: PW })).body.token as string };
    };
    const editor = await addPerson(A, "editor", "editor", "Edie Editor");
    const staff = await addPerson(A, "staff", "staff", "Stan Stafford");
    const viewer = await addPerson(A, "viewer", "viewer");
    const L = `/api/labs/${A.labId}`;
    const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, A.labId));
    const d = (n: number) => addLabDays(today, n);
    const audits = (entity: string, id: number) => sqlite.prepare("SELECT * FROM audit_log WHERE module = 'veritamaintain' AND entity_type = ? AND entity_id = ? ORDER BY id").all(entity, String(id)) as any[];
    const mk = async (body: any, token = A.token, lab = L) => (await call("POST", `${lab}/equipment`, body, token)).body.id as number;
    const eqRow = (id: number) => sqlite.prepare("SELECT * FROM lab_equipment WHERE id = ?").get(id) as any;
    const sRow = (id: number) => sqlite.prepare("SELECT * FROM equipment_schedules WHERE id = ?").get(id) as any;
    const list = async (id: number, token = A.token) => (await call("GET", `${L}/equipment/${id}/schedules`, undefined, token)).body;

    // ── 1. Schedules ──
    const an = await mk({ instrument_name: "Made-up analyzer", pm_interval_days: 90, next_due_date: d(20) });
    const first0 = (await list(an)).schedules;
    check("1. the PM interval is the first schedule", first0.length === 1 && first0[0].is_primary === 1 && first0[0].frequency === "every_n_days" && first0[0].interval_days === 90 && first0[0].next_due_date === d(20) && first0[0].frequency_label === "Every 90 days", JSON.stringify(first0));
    const primary = first0[0].id as number;
    check("1. the list carries each instrument's schedules", (await call("GET", `${L}/equipment`, undefined, A.token)).body.find((e: any) => e.id === an).schedules.length === 1);
    await call("PUT", `${L}/equipment/${an}`, { pm_interval_days: 60, next_due_date: d(30) }, editor.token);
    check("1. a change on the instrument's own form reaches the first schedule", sRow(primary).interval_days === 60 && sRow(primary).next_due_date === d(30));
    await call("PUT", `${L}/equipment/${an}`, { location: "Bench 2" }, editor.token);
    check("1. a save that leaves them out leaves it alone", sRow(primary).interval_days === 60 && sRow(primary).next_due_date === d(30));
    const SCH = `${L}/equipment/${an}/schedules`;
    await call("PUT", `${SCH}/${primary}`, { frequency: "quarterly", next_due_date: d(40) }, editor.token);
    check("1. a change to the first schedule reaches the instrument", eqRow(an).next_due_date === d(40) && eqRow(an).pm_interval_days === 91);
    await call("PUT", `${L}/equipment/${an}`, { instrument_name: "Made-up analyzer", pm_interval_days: 91, next_due_date: d(41) }, editor.token);
    check("1. the form sending back the same interval keeps it quarterly", sRow(primary).frequency === "quarterly" && sRow(primary).next_due_date === d(41));
    const bad = async (body: any, code: string) => { const r = await call("POST", SCH, { name: "x", frequency: "weekly", ...body }, editor.token); return r.status === 400 && r.body.code === code; };
    check("1. a name, a frequency, a kind, whole days, a real date and real addresses are required", await bad({ name: " " }, "NAME_REQUIRED") && await bad({ frequency: "sometimes" }, "BAD_FREQUENCY") && await bad({ schedule_type: "party" }, "BAD_TYPE")
      && await bad({ frequency: "every_n_days", interval_days: 0 }, "BAD_INTERVAL") && await bad({ frequency: "every_n_days", interval_days: 1.5 }, "BAD_INTERVAL") && await bad({ next_due_date: "2026-02-30" }, "BAD_DATE") && await bad({ recipients: ["not an address"] }, "BAD_RECIPIENT") && await bad({ sop_document_id: 999999 }, "BAD_DOCUMENT"));
    const weekly = (await call("POST", SCH, { name: "Weekly clean", schedule_type: "service", frequency: "weekly", next_due_date: d(3), recipients: "weekly@example.com, weekly@example.com" }, editor.token)).body;
    const daily = (await call("POST", SCH, { name: "Daily maintenance", schedule_type: "preventive_maintenance", frequency: "daily" }, editor.token)).body;
    check("1. more schedules, each its own; a daily one is due today", weekly.frequency === "weekly" && weekly.recipients.length === 1 && daily.next_due_date === today && daily.is_primary === 0 && eqRow(an).next_due_date === d(41));
    check("1. each has an audit row", audits("equipment_schedule", weekly.id).length === 1 && audits("equipment_schedule", primary).length === 1);
    const bare = await mk({ instrument_name: "Made-up scope" });
    check("1. an instrument with no interval and no date has no schedule", (await list(bare)).schedules.length === 0);
    const annual = (await call("POST", `${L}/equipment/${bare}/schedules`, { name: "Annual PM", schedule_type: "preventive_maintenance", frequency: "annual", next_due_date: d(100) }, editor.token)).body;
    check("1. its first longer PM schedule becomes the PM the list and readiness read", annual.is_primary === 1 && eqRow(bare).next_due_date === d(100) && eqRow(bare).pm_interval_days === 365);
    check("1. ending a schedule needs a reason and keeps it", (await call("POST", `${L}/equipment/${bare}/schedules/${annual.id}/end`, {}, editor.token)).body.code === "REASON_REQUIRED");
    await call("POST", `${L}/equipment/${bare}/schedules/${annual.id}/end`, { reason: "Vendor does it" }, editor.token);
    check("1. ended, it stays on file and the instrument has no PM date", sRow(annual.id).active === 0 && sRow(annual.id).end_reason === "Vendor does it" && eqRow(bare).next_due_date === null);
    await call("POST", `${L}/equipment/${bare}/schedules/${annual.id}/resume`, {}, editor.token);
    check("1. resumed, the date is back", sRow(annual.id).active === 1 && eqRow(bare).next_due_date === d(100));
    // SOP
    const manual = Number(sqlite.prepare("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Made-up manual')").run(A.labId).lastInsertRowid);
    const mkDoc = (labId: number, title: string, texts: string[], status = "approved") => {
      const doc = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, manual_id, title, owner_user_id, status) VALUES (?, ?, ?, ?, ?)").run(labId, manual, title, A.userId, status).lastInsertRowid);
      const ids = texts.map((t, i) => {
        const rel = `${labId}/${doc}/v${i + 1}/document.txt`;
        fs.mkdirSync(path.dirname(resolveVersionFilePath(rel)), { recursive: true });
        fs.writeFileSync(resolveVersionFilePath(rel), t);
        return Number(sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, ?, ?, 'txt', ?, ?, ?)").run(doc, i + 1, rel, t.length, hashBuffer(Buffer.from(t)), A.userId).lastInsertRowid);
      });
      sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(ids[ids.length - 1], ids[0], doc);
      return doc;
    };
    const sop = mkDoc(A.labId, "Daily maintenance SOP", ["Approved SOP text", "Draft SOP text"], "draft");
    const otherSop = mkDoc(X.labId, "Another lab's SOP", ["Not yours"]);
    check("1. another lab's document can't be the SOP; this lab's can", (await call("PUT", `${SCH}/${daily.id}`, { sop_document_id: otherSop }, editor.token)).body.code === "BAD_DOCUMENT" && (await call("PUT", `${SCH}/${daily.id}`, { sop_document_id: sop }, editor.token)).body.sop?.id === sop);
    const opened = await call("GET", `${SCH}/${daily.id}/sop`, undefined, staff.token);
    check("1. it opens at its approved version, not the draft", opened.status === 200 && /Approved SOP text/.test(opened.body.html) && !/Draft SOP/.test(opened.body.html) && opened.body.revision_in_progress === true);

    // ── 2. Completing ──
    const done = (sid: number, body: any = {}, token = A.token) => call("POST", `${SCH}/${sid}/complete`, body, token);
    const w1 = await done(weekly.id, { done_on: today }, staff.token);
    check("2. a Staff login completes a schedule; it moves by its own frequency", w1.status === 201 && sRow(weekly.id).next_due_date === d(7) && eqRow(an).next_due_date === d(41), JSON.stringify(w1.body));
    const ev1 = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(w1.body.event_id) as any;
    check("2. it is a maintenance event in their sign-in, of the schedule's kind, and not a PM", ev1.event_type === "service" && ev1.logged_by_user_id === staff.userId && ev1.completes_pm === 0 && /Weekly clean/.test(ev1.notes) && audits("equipment_event", ev1.id).length === 1);
    const wBack = await done(weekly.id, { done_on: d(-10) });
    check("2. a backdated one never moves it earlier", sRow(weekly.id).next_due_date === d(7) && wBack.body.due_date_held?.works_out_to === d(-3), JSON.stringify(wBack.body));
    await done(weekly.id, { done_on: d(-10), allow_earlier_due: true });
    check("2. unless the person says so", sRow(weekly.id).next_due_date === d(-3));
    check("2. a future date and an ended schedule are refused", (await done(weekly.id, { done_on: d(1) })).body.code === "BAD_DATE" && (await done(999999)).status === 404);
    for (const [frequency, from, to] of [["monthly", "2026-01-31", "2026-02-28"], ["quarterly", "2026-01-31", "2026-04-30"], ["semiannual", "2026-01-31", "2026-07-31"], ["annual", "2024-02-29", "2025-02-28"], ["weekly", "2026-01-31", "2026-02-07"], ["daily", "2026-01-31", "2026-02-01"]] as const) {
      const sc = (await call("POST", `${L}/equipment/${bare}/schedules`, { name: `Try ${frequency}`, schedule_type: "function_check", frequency, next_due_date: "2020-01-01" }, editor.token)).body;
      await call("POST", `${L}/equipment/${bare}/schedules/${sc.id}/complete`, { done_on: from }, A.token);
      check(`2. ${frequency}: ${from} is next due ${to}`, sRow(sc.id).next_due_date === to, sRow(sc.id).next_due_date);
    }
    const manualSc = (await call("POST", `${L}/equipment/${bare}/schedules`, { name: "By hand", schedule_type: "calibration", frequency: "manual", next_due_date: d(5) }, editor.token)).body;
    await call("POST", `${L}/equipment/${bare}/schedules/${manualSc.id}/complete`, { done_on: today }, A.token);
    check("2. one with no interval stays until a date is typed", sRow(manualSc.id).next_due_date === d(5));
    await call("POST", `${L}/equipment/${bare}/schedules/${manualSc.id}/complete`, { done_on: today, next_due_date: d(60) }, A.token);
    check("2. ... and takes the typed one", sRow(manualSc.id).next_due_date === d(60));
    const both = await call("POST", `${L}/equipment/${an}/events`, { event_type: "preventive_maintenance", event_date: today, completes_pm: true, schedule_ids: [weekly.id] }, A.token);
    check("2. one entry can complete the PM and another schedule", both.status === 200 && sRow(weekly.id).next_due_date === d(7) && both.body.completed_schedules.length === 2 && sRow(primary).next_due_date > d(41), JSON.stringify(both.body.completed_schedules));
    check("2. the instrument's date and its first schedule still agree", eqRow(an).next_due_date === sRow(primary).next_due_date);
    check("2. a schedule of another instrument is refused", (await call("POST", `${L}/equipment/${an}/events`, { event_type: "service", event_date: today, schedule_ids: [annual.id] }, A.token)).body.code === "BAD_SCHEDULE");
    const tsAll = await call("POST", `${L}/equipment/${an}/events`, { event_type: "troubleshooting", event_date: today, schedule_ids: [weekly.id, primary], completes_pm: true }, A.token);
    check("2. troubleshooting completes nothing, even when asked", tsAll.status === 200 && tsAll.body.completed_schedules.length === 0);

    // ── 3. Checklists ──
    const steps1 = [
      { step_text: "Wipe the probe", kind: "check" },
      { step_text: "Reagent temperature", kind: "value", unit: "°C", min_value: 2, max_value: 8 },
      { step_text: "Waste emptied", kind: "check" },
    ];
    const CL = `${SCH}/${daily.id}/checklist`;
    check("3. a step with no text, limits that aren't numbers, and crossed limits are refused", (await call("PUT", CL, { steps: [{ step_text: " " }] }, editor.token)).body.code === "BAD_STEPS" && (await call("PUT", CL, { steps: [{ step_text: "x", kind: "value", min_value: "low" }] }, editor.token)).body.code === "BAD_STEPS"
      && (await call("PUT", CL, { steps: [{ step_text: "x", kind: "value", min_value: 9, max_value: 2 }] }, editor.token)).body.code === "BAD_STEPS");
    const v1 = (await call("PUT", CL, { steps: steps1 }, editor.token)).body;
    check("3. an editor sets the checklist: version 1", v1.checklist?.version_no === 1 && v1.checklist.steps.length === 3 && v1.checklist.steps[1].min_value === 2);
    check("3. saving it unchanged adds no version", (await call("PUT", CL, { steps: steps1 }, editor.token)).body.unchanged === true);
    const [s1, s2, s3] = v1.checklist.steps as any[];
    const answers = (o: any = {}) => [{ step_id: s1.id, result: "pass" }, { step_id: s2.id, value: 4.5 }, { step_id: s3.id, result: "na" }].map((x) => ({ ...x, ...(o[x.step_id] || {}) }));
    const comp = (body: any, token = staff.token) => done(daily.id, { done_on: today, version_id: v1.checklist.version_id, ...body }, token);
    check("3. every step has to be answered", (await comp({ answers: answers().slice(0, 2) })).body.code === "STEP_UNANSWERED" && (await comp({})).body.code === "STEP_UNANSWERED");
    check("3. a value that isn't a number is refused", (await comp({ answers: answers({ [s2.id]: { value: "warm" } }) })).body.code === "BAD_VALUE");
    const failNoAction = await comp({ answers: answers({ [s1.id]: { result: "fail" } }) });
    check("3. a failed step needs its corrective action, and says which step", failNoAction.body.code === "CORRECTIVE_ACTION_REQUIRED" && failNoAction.body.step_id === s1.id);
    check("3. so does a value outside its limits, whatever result was sent", (await comp({ answers: answers({ [s2.id]: { value: 11, result: "pass" } }) })).body.code === "CORRECTIVE_ACTION_REQUIRED");
    check("3. nothing was recorded by any of those", !sqlite.prepare("SELECT 1 FROM equipment_schedule_completions WHERE schedule_id = ?").get(daily.id) && sRow(daily.id).next_due_date === today);
    const ok1 = await comp({ answers: answers({ [s2.id]: { value: 11, corrective_action: "Moved the reagent to the other cooler" }, [s3.id]: { result: "pass" } }), notes: "Two flags cleared" });
    const c1 = sqlite.prepare("SELECT * FROM equipment_schedule_completions WHERE event_id = ?").get(ok1.body.event_id) as any;
    const r1 = sqlite.prepare("SELECT * FROM equipment_checklist_results WHERE completion_id = ? ORDER BY position").all(c1.id) as any[];
    check("3. completed, it records each step, who and when", ok1.status === 201 && ok1.body.failed_steps === 1 && c1.completed_by_user_id === staff.userId && c1.completed_by_name === "Stan Stafford" && c1.checklist_version_no === 1 && c1.done_on === today && r1.length === 3 && r1[0].result === "pass" && r1[1].result === "fail" && r1[1].value === 11 && r1[1].corrective_action === "Moved the reagent to the other cooler", JSON.stringify(r1));
    check("3. ... and the schedule is next due tomorrow, with the PM date untouched", sRow(daily.id).next_due_date === d(1) && eqRow(an).next_due_date === sRow(primary).next_due_date);
    const before3 = JSON.stringify([c1, r1]);
    const v2 = (await call("PUT", CL, { steps: [{ step_text: "Wipe the probe and the arm", kind: "check" }, steps1[1]], change_note: "Arm added" }, editor.token)).body;
    check("3. an edit adds version 2", v2.checklist.version_no === 2 && v2.checklist.steps.length === 2 && audits("equipment_checklist", daily.id).length === 2);
    check("3. ... and what was completed is exactly as it was", JSON.stringify([sqlite.prepare("SELECT * FROM equipment_schedule_completions WHERE id = ?").get(c1.id), sqlite.prepare("SELECT * FROM equipment_checklist_results WHERE completion_id = ? ORDER BY position").all(c1.id)]) === before3);
    check("3. someone answering version 1 is told it changed", (await comp({ answers: answers() })).body.code === "CHECKLIST_CHANGED");
    const versions = (await call("GET", `${SCH}/${daily.id}/checklist-versions`, undefined, staff.token)).body;
    check("3. every version reads back, newest first", versions.length === 2 && versions[0].version_no === 2 && versions[1].steps.length === 3 && versions[0].change_note === "Arm added");
    check("3. an entry alone can't complete a schedule that has a checklist", (await call("POST", `${L}/equipment/${an}/events`, { event_type: "service", event_date: today, schedule_ids: [daily.id] }, A.token)).body.code === "CHECKLIST_REQUIRED");
    await call("PUT", `${SCH}/${primary}/checklist`, { steps: [{ step_text: "PM kit changed", kind: "check" }] }, editor.token);
    const pmDue = eqRow(an).next_due_date;
    check("3. ... the first schedule included; an entry that doesn't claim it still logs", (await call("POST", `${L}/equipment/${an}/events`, { event_type: "preventive_maintenance", event_date: today, completes_pm: true }, A.token)).body.code === "CHECKLIST_REQUIRED"
      && (await call("POST", `${L}/equipment/${an}/events`, { event_type: "preventive_maintenance", event_date: today }, A.token)).body.completed_schedules.length === 0 && eqRow(an).next_due_date === pmDue);
    const pmList = (await list(an)).schedules.find((x: any) => x.id === primary).checklist;
    const pmDone = await call("POST", `${SCH}/${primary}/complete`, { done_on: today, version_id: pmList.version_id, answers: [{ step_id: pmList.steps[0].id, result: "pass" }] }, staff.token);
    const pmEv = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(pmDone.body.event_id) as any;
    check("3. its checklist completes the PM, as an entry that completes PM", pmDone.status === 201 && pmEv.completes_pm === 1 && pmEv.event_type === "preventive_maintenance" && eqRow(an).next_due_date === sRow(primary).next_due_date && eqRow(an).next_due_date >= pmDue, JSON.stringify(pmDone.body));
    await call("PUT", `${SCH}/${primary}/checklist`, { steps: [] }, editor.token);
    check("3. no steps takes the checklist off, and the versions stay", (await list(an)).schedules.find((x: any) => x.id === primary).checklist === null && (await call("GET", `${SCH}/${primary}/checklist-versions`, undefined, A.token)).body.length === 2);
    const history = (await call("GET", `${L}/equipment/${an}/events`, undefined, A.token)).body.find((e: any) => e.id === ok1.body.event_id);
    check("3. the history shows what an entry completed, with its answers", history.completions.length === 1 && history.completions[0].schedule_name === "Daily maintenance" && history.completions[0].results.length === 3);

    // ── 4. Corrections, voids, vendor report ──
    const weeklyBefore = sRow(weekly.id).next_due_date;
    const wEv = await done(weekly.id, { done_on: today, next_due_date: d(20) });
    const corr = await call("POST", `${L}/equipment/${an}/events/${wEv.body.event_id}/correct`, { reason: "It was two days ago", event_date: d(-2) }, editor.token);
    check("4. a corrected date holds the schedule's due date when it works out earlier", corr.status === 200 && sRow(weekly.id).next_due_date === d(20) && corr.body.due_date_held?.works_out_to === d(5), JSON.stringify(corr.body.due_date_held));
    const comps = (await call("GET", `${SCH}/${weekly.id}/completions`, undefined, A.token)).body;
    check("4. the completion counts for the corrected day", comps.some((c: any) => c.event_id === wEv.body.event_id && c.done_day === d(-2)));
    const vd = await call("POST", `${L}/equipment/${an}/events/${corr.body.event_id}/void`, { reason: "Wrong instrument", allow_earlier_due: true }, editor.token);
    check("4. a void takes it out, and can put the date back", vd.status === 200 && sRow(weekly.id).next_due_date === weeklyBefore && !(await call("GET", `${SCH}/${weekly.id}/completions`, undefined, A.token)).body.some((c: any) => c.event_id === wEv.body.event_id), `${sRow(weekly.id).next_due_date} ${weeklyBefore}`);
    const wEv2 = await done(weekly.id, { done_on: today, next_due_date: d(30) });
    await call("POST", `${L}/equipment/${an}/events/${wEv2.body.event_id}/void`, { reason: "Twice" }, editor.token);
    check("4. without saying so, a void leaves the date", sRow(weekly.id).next_due_date === d(30));
    check("4. an entry that completed a schedule can't become troubleshooting", (await call("POST", `${L}/equipment/${an}/events/${w1.body.event_id}/correct`, { reason: "x", event_type: "troubleshooting" }, editor.token)).body.code === "COMPLETED_SCHEDULE");
    const vendorSc = (await call("POST", `${L}/equipment/${bare}/schedules`, { name: "Vendor 6 month PM", schedule_type: "preventive_maintenance", frequency: "semiannual", next_due_date: d(1) }, editor.token)).body;
    await call("PUT", `${L}/equipment-settings`, { require_vendor_report: true }, editor.token);
    const vp = await call("POST", `${L}/equipment/${bare}/events`, { event_type: "preventive_maintenance", event_date: today, completes_pm: false, schedule_ids: [vendorSc.id], by_vendor: true }, staff.token);
    check("4. a vendor PM on any PM schedule waits for its report", vp.body.awaiting_vendor_report_event === true && sRow(vendorSc.id).next_due_date === d(1), JSON.stringify(vp.body));
    const rep = await sendFile(`${L}/equipment/${bare}/events/${vp.body.event_id}/files`, staff.token, "vendor_report");
    check("4. ... and moves when it is attached", rep.status === 201 && rep.body.pm_completed?.completed_schedules?.length === 1 && sRow(vendorSc.id).next_due_date > d(150), JSON.stringify(rep.body.pm_completed));
    await call("PUT", `${L}/equipment-settings`, { require_vendor_report: false }, editor.token);

    // ── 5. Reminders ──
    const R = await mkLab("r");
    const RL = `/api/labs/${R.labId}`;
    const rToday = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, R.labId));
    const rd = (n: number) => addLabDays(rToday, n);
    const re = await mk({ instrument_name: "Reminder analyzer", pm_interval_days: 90, next_due_date: rd(7), location: "Bench 1" }, R.token, RL);
    const add = async (body: any) => (await call("POST", `${RL}/equipment/${re}/schedules`, body, R.token)).body.id as number;
    const rDaily = await add({ name: "Daily", schedule_type: "function_check", frequency: "daily", next_due_date: rd(1) });
    const rWeekly = await add({ name: "Weekly", schedule_type: "service", frequency: "weekly", next_due_date: rd(7) });
    const rMonthly = await add({ name: "Monthly", schedule_type: "service", frequency: "monthly", next_due_date: rd(-2), recipients: ["bench@example.com"] });
    await call("PUT", `${RL}/equipment/reminder-config`, { enabled: true, lead_days: 14, recipients: [{ email: "lab-list@example.com" }] }, R.token);
    const sent: any[] = [];
    const realReady = equipmentMailer.ready, realSend = equipmentMailer.send;
    equipmentMailer.ready = () => true;
    equipmentMailer.send = async (m) => { sent.push(m); };
    sqlite.prepare("UPDATE equipment_reminder_config SET enabled = 0 WHERE lab_id <> ?").run(R.labId);
    await runEquipmentReminders();
    const toLab = sent.find((m) => m.to.includes("lab-list@example.com")), toBench = sent.find((m) => m.to.includes("bench@example.com"));
    check("5. two emails: the lab's list, and the schedule's own people", sent.length === 2 && !!toLab && !!toBench && toLab.to.length === 1 && toBench.to.length === 1, JSON.stringify(sent.map((m) => m.to)));
    check("5. the lab's email has the PM and not the schedule with its own list", /Reminder analyzer \[Bench 1\], Preventive maintenance: due in 7 days/.test(toLab.text) && !/Monthly/.test(toLab.text), toLab?.text);
    check("5. ... no approaching note for a daily schedule, nor a weekly one a week out", !/, Daily:/.test(toLab.text) && !/, Weekly:/.test(toLab.text));
    check("5. the schedule's own people get it, overdue", /Monthly: overdue by 2 days/.test(toBench.text));
    sent.length = 0;
    await runEquipmentReminders();
    check("5. the same night again sends nothing", sent.length === 0, JSON.stringify(sent));
    sqlite.prepare("UPDATE equipment_schedules SET next_due_date = ? WHERE id = ?").run(rToday, rDaily);
    sqlite.prepare("UPDATE equipment_schedules SET next_due_date = ? WHERE id = ?").run(rd(3), rWeekly);
    await runEquipmentReminders();
    check("5. a daily one due today and a weekly one three days out are in the lab's email", sent.length === 1 && /Daily: due today/.test(sent[0].text) && /Weekly: due in 3 days/.test(sent[0].text), sent[0]?.text);
    sent.length = 0;
    await call("POST", `${RL}/equipment/${re}/schedules/${rMonthly}/end`, { reason: "Done by the vendor" }, R.token);
    sqlite.prepare("UPDATE equipment_reminder_log SET sent_on = ? WHERE lab_id = ?").run(rd(-30), R.labId);
    await runEquipmentReminders();
    check("5. an ended schedule isn't reminded", !sent.some((m) => /Monthly/.test(m.text)) && sent.some((m) => /Daily/.test(m.text)));
    // A reminder logged before schedules existed carries no schedule: it still counts for the PM.
    sent.length = 0;
    sqlite.prepare("DELETE FROM equipment_reminder_log WHERE lab_id = ?").run(R.labId);
    sqlite.prepare("INSERT INTO equipment_reminder_log (equipment_id, lab_id, reminder_kind, due_date, sent_on, recipient_email) VALUES (?, ?, 'approaching-7', ?, ?, 'lab-list@example.com')").run(re, R.labId, rd(7), rToday);
    for (const id of [rDaily, rWeekly]) sqlite.prepare("UPDATE equipment_schedules SET next_due_date = ? WHERE id = ?").run(rd(6), id);
    await runEquipmentReminders();
    check("5. a reminder sent before schedules existed isn't sent again", sent.length === 0, JSON.stringify(sent));
    await call("POST", `${RL}/equipment/${re}/retire`, { reason: "Gone" }, R.token);
    sqlite.prepare("DELETE FROM equipment_reminder_log WHERE lab_id = ?").run(R.labId);
    await runEquipmentReminders();
    check("5. a retired instrument's schedules aren't reminded", sent.length === 0);
    equipmentMailer.ready = realReady; equipmentMailer.send = realSend;

    // ── 6. The review due email ──
    const month = "2026-09";
    const mail: any[] = [];
    const realReadSend = readSignMailer.send; readSignMailer.pauseMs = 0;
    readSignMailer.send = async (m) => { mail.push(m); };
    const at = (iso: string) => runMaintainReviewDueEmails(sqlite, new Date(iso));
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE lab_id = ?").run(A.labId);
    check("6. off for every lab until it is turned on", (await at("2026-10-06T18:00:00Z")).labs === 0 && (await call("GET", `${L}/equipment-settings`, undefined, A.token)).body.review_due_email === false);
    check("6. with nobody to send to, the screen says so", (await call("GET", `${L}/equipment-settings`, undefined, A.token)).body.review_due_recipients === 0);
    const on = await call("PUT", `${L}/equipment-settings`, { review_due_email: true }, editor.token);
    check("6. an editor turns it on, with an audit row", on.body.review_due_email === true && on.body.require_vendor_report === false && audits("maintain_settings", A.labId).some((r) => JSON.parse(r.after_json).review_due_email === true));
    check("6. with no medical director or designee on file nothing is sent", (await at("2026-10-06T18:00:00Z")).skipped === 1 && mail.length === 0);
    const md = await addPerson(A, "md", "viewer", "Morgan Director");
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(md.email, A.labId);
    const gs = await addPerson(A, "gs", "editor", "Gale Supervisor");
    const addLetter = (who: any, duties: any, status = "active") => sqlite.prepare(
      "INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_staff_employee_id, delegate_name, position, complexity_scope, responsibilities_json, status, created_at, updated_at) VALUES (?, ?, ?, 'Made Up', 'general_supervisor', 'high', ?, ?, ?, ?)"
    ).run(A.labId, who.user ?? null, who.employee ?? null, JSON.stringify(duties), status, now, now);
    addLetter({ user: gs.userId }, { equipment_record_review: true });
    addLetter({ employee: staff.employeeId }, { equipment_record_review: true });
    addLetter({ user: editor.userId }, { finding_closure: true });
    addLetter({ user: viewer.userId }, { equipment_record_review: true }, "revoked");
    const who = reviewDueRecipients(sqlite, A.labId).map((p) => p.email).sort();
    check("6. the medical director and the designees in an active letter for this, by login or by roster, and nobody else", JSON.stringify(who) === JSON.stringify([md.email, gs.email, staff.email].sort()), JSON.stringify(who));
    check("6. not on the 4th of the lab's month", (await at("2026-10-04T18:00:00Z")).due === 0 && mail.length === 0);
    check("6. the 5th is the lab's own day, not the UTC one", (await at("2026-10-05T01:00:00Z")).due === 0 && mail.length === 0);
    let fail = true;
    readSignMailer.send = async (m) => { if (fail) throw new Error("made-up failure"); mail.push(m); };
    const failed = await at("2026-10-06T01:00:00Z");
    check("6. a night when nothing could be sent is tried again", failed.emailed === 0 && failed.errors === 3 && (sqlite.prepare("SELECT review_due_last_period AS p FROM maintain_settings WHERE lab_id = ?").get(A.labId) as any).p === null, JSON.stringify(failed));
    fail = false;
    const run = await at("2026-10-06T01:00:00Z");
    check("6. on the evening of the 5th it goes out, once to each", run.emailed === 3 && mail.length === 3 && JSON.stringify(mail.map((m) => m.to).sort()) === JSON.stringify(who), JSON.stringify(run));
    check("6. it says which month and how many, with no record and no person's name", /September 2026/.test(mail[0].subject) && /is(n't| not)|are not signed/.test(mail[0].html) && !/Made-up analyzer|Stafford|Editor/.test(mail[0].html) && !/[\u2014\u2013]/.test(mail[0].html + mail[0].subject), mail[0].html);
    await at("2026-10-07T01:00:00Z"); await at("2026-10-28T01:00:00Z");
    check("6. once a month, whatever the day", mail.length === 3);
    const pw = { typed_signature: "Morgan Director", password: PW };
    const octItems = (await call("GET", `${L}/maintain-reviews?month=2026-10`, undefined, md.token)).body.items;
    const signed = await call("POST", `${L}/maintain-reviews`, { month: "2026-10", items: octItems.map((i: any) => ({ type: i.type, id: i.id })), corrective_action: "Reviewed", ...pw }, md.token);
    await at("2026-11-06T02:00:00Z");
    check("6. a month that is all signed sends nothing", signed.status === 201 && mail.length === 3, `${signed.status} ${JSON.stringify(signed.body)} ${mail.length}`);
    sqlite.prepare("DELETE FROM maintain_record_reviews WHERE lab_id = ? AND period = '2026-10'").run(A.labId);
    readSignMailer.send = realReadSend;
    await call("PUT", `${L}/equipment-settings`, { review_due_email: false }, editor.token);

    // ── 7. The monthly review ──
    const rv = await mk({ instrument_name: "Review analyzer" });
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(rv);
    const RV = `${L}/equipment/${rv}/schedules`;
    const rvDaily = (await call("POST", RV, { name: "Daily check", schedule_type: "function_check", frequency: "daily", steps: [{ step_text: "Background count", kind: "value", max_value: 10 }] }, editor.token)).body;
    const rvMonthly = (await call("POST", RV, { name: "Monthly clean", schedule_type: "service", frequency: "monthly", next_due_date: "2026-09-15" }, editor.token)).body;
    sqlite.prepare("UPDATE equipment_schedules SET starts_on = '2026-09-03' WHERE id = ?").run(rvDaily.id);
    for (let day = 3; day <= 30; day += 1) {
      if ([5, 6, 20].includes(day)) continue;
      const on2 = `2026-09-${String(day).padStart(2, "0")}`;
      await call("POST", `${RV}/${rvDaily.id}/complete`, { done_on: on2, version_id: rvDaily.checklist.version_id, answers: [{ step_id: rvDaily.checklist.steps[0].id, value: day === 10 ? 14 : 3, corrective_action: day === 10 ? "Flushed and repeated" : null }] }, staff.token);
    }
    await call("POST", `${L}/equipment/${rv}/downtime`, { down_from: "2026-09-19T12:00", reason: "Laser fault" }, editor.token);
    const dtId = (sqlite.prepare("SELECT id FROM equipment_downtime WHERE equipment_id = ?").get(rv) as any).id;
    await call("POST", `${L}/equipment/${rv}/downtime/${dtId}/end`, { down_until: "2026-09-21T08:00" }, editor.token);
    const item = async (m: string) => (await call("GET", `${L}/maintain-reviews?month=${m}`, undefined, A.token)).body.items.find((i: any) => i.type === "equipment" && i.id === rv);
    const sep = await item(month);
    check("7. a day with no record is a problem, named by date; a day wholly out of service isn't, nor one before it started", sep.problems.some((p: string) => p === "Daily check: 2 days with no record: 9/5, 9/6"), JSON.stringify(sep.problems));
    check("7. a schedule past due is a problem", sep.problems.some((p: string) => /Monthly clean was due 2026-09-15 and is not recorded as done/.test(p)), JSON.stringify(sep.problems));
    check("7. the notes say how many days were done and what failed", sep.notes.some((n: string) => n === "Daily check: 25 of 27 days done") && sep.notes.some((n: string) => /1 failed step, each with its corrective action/.test(n)), JSON.stringify(sep.notes));
    check("7. a problem needs a corrective action to sign", (await call("POST", `${L}/maintain-reviews`, { month, items: [{ type: "equipment", id: rv }], ...pw }, md.token)).body.code === "CORRECTIVE_ACTION_REQUIRED");
    check("7. with one, the medical director signs, and what was seen is kept", (await call("POST", `${L}/maintain-reviews`, { month, items: [{ type: "equipment", id: rv }], corrective_action: "Staff reminded", ...pw }, md.token)).status === 201 && JSON.parse((sqlite.prepare("SELECT summary_json FROM maintain_record_reviews WHERE lab_id = ? AND item_id = ? AND period = ?").get(A.labId, rv, month) as any).summary_json).schedules.some((x: any) => x.name === "Daily check" && x.missed_days === 2));
    await call("POST", `${RV}/${rvDaily.id}/complete`, { done_on: "2026-09-05", version_id: rvDaily.checklist.version_id, answers: [{ step_id: rvDaily.checklist.steps[0].id, value: 4 }] }, staff.token);
    check("7. a checklist filled in after it was signed shows as added after", (await item(month)).entries_after_review === 1);
    await call("POST", `${RV}/${rvMonthly.id}/complete`, { done_on: "2026-09-14" }, A.token);
    const readBook = async (token: string, m: string) => {
      const r = await fetch(`${base}${L}/maintain-reviews/report.xlsx?month=${m}`, { headers: { Authorization: `Bearer ${token}` } });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
      const rows: string[] = []; wb.eachSheet((ws: any) => ws.eachRow((row: any) => rows.push(`${ws.name}|${(row.values as any[]).slice(1).map((v) => v ?? "").join("|")}`)));
      return { wb, rows };
    };
    const book = await readBook(A.token, month);
    const schedRow = book.rows.find((r) => r.startsWith("Schedules|Review analyzer|Daily check|Function check|Daily|"));
    check("7. the workbook lists the schedule, the days with no record and which", !!schedRow && /\|26\|27\|1\|2026-09-06\|1\|/.test(schedRow!), schedRow);
    check("7. ... and each step as it was answered, with its limits, version and corrective action", book.rows.some((r) => r.startsWith("Checklist Results|Review analyzer|Daily check|2026-09-10|1|Background count|Fail|14|at most 10|Flushed and repeated|Stan Stafford")), book.rows.filter((r) => r.startsWith("Checklist Results")).slice(0, 4).join("\n"));
    check("7. the About sheet comes first and names the new sheets", book.wb.worksheets[0].name === "About" && book.rows.some((r) => r.startsWith("About|") && /Checklist Results lists each checklist step/.test(r)));
    const asOther = await readBook(gs.token, month);
    check("7. a coworker's name is in an editor's workbook and left out of a limited Staff login's", asOther.rows.some((r) => /Stan Stafford/.test(r)) && !(await readBook((await addPerson(A, "other", "staff", "Olive Other")).token, month)).rows.some((r) => r.startsWith("Checklist Results") && /Stan Stafford/.test(r)));
    const cur = today.slice(0, 7);
    const nowItem = await item(cur);
    check("7. today isn't over, so it isn't missed yet", !nowItem.problems.some((p: string) => p.includes(`${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`)), JSON.stringify(nowItem.problems));

    // ── 7b. The days a daily schedule is due ──
    const K = await mkLab("k");
    const KL = `/api/labs/${K.labId}`;
    const kToday = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, K.labId));
    const kd = (n: number) => addLabDays(kToday, n);
    const wd = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();
    const allBut = (...out: number[]) => [0, 1, 2, 3, 4, 5, 6].filter((x) => !out.includes(x));
    const ke = await mk({ instrument_name: "Weekday analyzer" }, K.token, KL);
    sqlite.prepare("UPDATE lab_equipment SET created_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(ke);
    const KS = `${KL}/equipment/${ke}/schedules`;
    const kPost = (body: any) => call("POST", KS, { schedule_type: "function_check", frequency: "daily", ...body }, K.token);
    const kPut = (id: number, body: any) => call("PUT", `${KS}/${id}`, body, K.token);
    const kDone = (id: number, day: string) => call("POST", `${KS}/${id}/complete`, { done_on: day }, K.token);
    const every = (await kPost({ name: "Every day" })).body;
    check("7b. unless it says otherwise a daily schedule is due every day, from today", every.days_of_week === null && every.days_history === null && every.next_due_date === kToday && every.frequency_label === "Daily");
    check("7b. a schedule made before days existed reads the same", sRow(daily.id).days_of_week === null && sRow(rvDaily.id).days_of_week === null);
    for (const [label, body] of [["no days", { days_of_week: [] }], ["a day that isn't one", { days_of_week: [7] }], ["a word", { days_of_week: ["1"] }], ["a string", { days_of_week: "1,2" }], ["half a day", { days_of_week: [1.5] }], ["days on a weekly schedule", { frequency: "weekly", days_of_week: [1] }]] as [string, any][]) {
      const r = await kPost({ name: "x", ...body });
      check(`7b. ${label} is refused`, r.status === 400 && r.body.code === "BAD_DAYS", `${r.status} ${JSON.stringify(r.body)}`);
    }
    const wk = (await kPost({ name: "Weekday check", days_of_week: [5, 4, 3, 2, 1, 1], next_due_date: "2026-09-04" })).body;
    check("7b. the days are kept sorted, and the label says them", wk.days_of_week === "1,2,3,4,5" && wk.frequency_label === "Daily, Monday to Friday" && (await kPost({ name: "Some days", days_of_week: [6, 1, 3] })).body.frequency_label === "Daily, Mon, Wed, Sat" && (await kPost({ name: "All seven", days_of_week: [0, 1, 2, 3, 4, 5, 6] })).body.days_of_week === null);
    check("7b. the first due date is today when today is one of its days, else the next that is", (await kPost({ name: "Today's day", days_of_week: [wd(kToday)] })).body.next_due_date === kToday && (await kPost({ name: "Tomorrow's day", days_of_week: [wd(kd(1))] })).body.next_due_date === kd(1));
    const later = (await kPost({ name: "Starts later", next_due_date: kd(9) })).body;
    check("7b. one set to start later owes nothing before that; one already due starts today", later.starts_on === kd(9) && wk.starts_on === kToday, JSON.stringify([later.starts_on, wk.starts_on]));
    const fri = await kDone(wk.id, "2026-09-04");
    check("7b. done on a Friday, it is next due on Monday", fri.status === 201 && sRow(wk.id).next_due_date === "2026-09-07", sRow(wk.id).next_due_date);
    const sat = await kDone(wk.id, "2026-09-05");
    check("7b. done on the weekend as well, it stays Monday and nothing is held", sat.status === 201 && sRow(wk.id).next_due_date === "2026-09-07" && sat.body.due_date_held === null);
    check("7b. a date typed on a day it isn't due goes to the next one", (await kPut(wk.id, { next_due_date: "2026-09-12" })).body.next_due_date === "2026-09-14");
    sqlite.prepare("UPDATE equipment_schedules SET starts_on = '2026-09-01' WHERE id = ?").run(wk.id);
    for (let n = 1; n <= 30; n += 1) {
      const day = `2026-09-${String(n).padStart(2, "0")}`;
      if ([0, 6].includes(wd(day)) || [4, 9].includes(n)) continue;
      await kDone(wk.id, day);
    }
    const kItem = async () => (await call("GET", `${KL}/maintain-reviews?month=2026-09`, undefined, K.token)).body.items.find((i: any) => i.type === "equipment" && i.id === ke);
    const k1 = await kItem();
    check("7b. the review counts weekdays only: a weekend with nothing isn't missed, the weekday is, and the Saturday done counts as done", k1.problems.includes("Weekday check: 1 day with no record: 9/9") && k1.notes.includes("Weekday check: 22 of 23 days done"), JSON.stringify([k1.problems, k1.notes]));
    const kSign = await call("POST", `${KL}/maintain-reviews`, { month: "2026-09", items: [{ type: "equipment", id: ke }], typed_signature: "Owner K", password: PW, corrective_action: "Spoken with the bench" }, K.token);
    const kSigned = JSON.stringify((await kItem()).review);
    check("7b. the month is signed", kSign.status === 201 && /9\/9/.test(kSigned), JSON.stringify(kSign.body));
    // A change part way through a month
    const mid = (await kPost({ name: "Changed part way" })).body;
    sqlite.prepare("UPDATE equipment_schedules SET starts_on = '2026-09-01' WHERE id = ?").run(mid.id);
    const midPut = await kPut(mid.id, { days_of_week: [1, 2, 3, 4, 5] });
    check("7b. a change counts from the day it is made, and keeps the days before it", JSON.stringify(JSON.parse(midPut.body.days_history)) === JSON.stringify([{ from: "2026-09-01", days: null }, { from: kToday, days: "1,2,3,4,5" }]), midPut.body.days_history);
    check("7b. ... with an audit row of what they were", audits("equipment_schedule", mid.id).some((r) => r.action === "update" && JSON.parse(r.before_json).days_of_week === null && JSON.parse(r.after_json).days_of_week === "1,2,3,4,5"));
    sqlite.prepare("UPDATE equipment_schedules SET days_history = REPLACE(days_history, ?, '2026-09-16') WHERE id = ?").run(kToday, mid.id);
    const k2 = await kItem();
    check("7b. the first half is judged every day and the second by weekdays (15 + 11)", k2.summary.schedules.find((x: any) => x.name === "Changed part way")?.missed_days === 26, JSON.stringify(k2.summary.schedules));
    await kPut(mid.id, { days_of_week: [1] });
    await kPut(wk.id, { days_of_week: [2] });
    check("7b. a later change rewrites no day before it", (await kItem()).summary.schedules.find((x: any) => x.name === "Changed part way")?.missed_days === 26 && (await kItem()).summary.schedules.find((x: any) => x.name === "Weekday check")?.missed_days === 1);
    check("7b. and the signed month is exactly as it was signed", JSON.stringify((await kItem()).review) === kSigned);
    // The due date goes with the days
    await kDone(every.id, kToday);
    const shrunk = await kPut(every.id, { days_of_week: allBut(wd(kd(1))) });
    check("7b. a day taken away moves the due date past it", sRow(every.id).next_due_date === kd(2) && shrunk.status === 200, sRow(every.id).next_due_date);
    const grown = await kPut(every.id, { days_of_week: [0, 1, 2, 3, 4, 5, 6] });
    check("7b. a day put back is due again, and every day is blank", sRow(every.id).next_due_date === kd(1) && grown.body.days_of_week === null && grown.body.days_history === null, JSON.stringify([sRow(every.id).next_due_date, grown.body.days_history]));
    const late = (await kPost({ name: "Late", next_due_date: kd(-3) })).body;
    await kPut(late.id, { days_of_week: allBut(wd(kd(1))) });
    check("7b. one that is overdue stays overdue", sRow(late.id).next_due_date === kd(-3), sRow(late.id).next_due_date);
    const badPut = await kPut(wk.id, { frequency: "weekly", days_of_week: [1] });
    check("7b. changing it to weekly with days is refused and changes nothing", badPut.body.code === "BAD_DAYS" && sRow(wk.id).frequency === "daily" && sRow(wk.id).days_of_week === "2");
    await kPut(wk.id, { frequency: "weekly" });
    check("7b. changing it to weekly clears them", sRow(wk.id).frequency === "weekly" && sRow(wk.id).days_of_week === null && sRow(wk.id).days_history === null);
    await kPut(wk.id, { frequency: "daily" });
    check("7b. back to daily, it is every day from today", sRow(wk.id).days_of_week === null && sRow(wk.id).starts_on === kToday);
    const pmDay = await mk({ instrument_name: "Daily PM", pm_interval_days: 1, next_due_date: kToday }, K.token, KL);
    const pmFirst = (await call("GET", `${KL}/equipment/${pmDay}/schedules`, undefined, K.token)).body.schedules[0].id;
    await call("PUT", `${KL}/equipment/${pmDay}/schedules/${pmFirst}`, { frequency: "daily", days_of_week: [wd(kd(1))] }, K.token);
    const viaForm = await call("PUT", `${KL}/equipment/${pmDay}`, { next_due_date: kToday }, K.token);
    check("7b. a date typed on the instrument's own form follows its days too, on both", viaForm.body.next_due_date === kd(1) && sRow(pmFirst).next_due_date === kd(1) && eqRow(pmDay).next_due_date === kd(1), JSON.stringify(viaForm.body.next_due_date));
    const kBook = await (async () => {
      const r = await fetch(`${base}${KL}/maintain-reviews/report.xlsx?month=2026-09`, { headers: { Authorization: `Bearer ${K.token}` } });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
      const rows: string[] = []; wb.getWorksheet("Schedules").eachRow((row: any) => rows.push((row.values as any[]).slice(1).map((v) => v ?? "").join("|")));
      return rows;
    })();
    check("7b. the workbook says the days", kBook.some((r) => /\|Changed part way\|Function check\|Daily, Mon\|/.test(r)), kBook.join("\n"));
    // No reminder on a day it isn't due
    const kMail: any[] = [];
    equipmentMailer.ready = () => true; equipmentMailer.send = async (m) => { kMail.push(m); };
    sqlite.prepare("UPDATE equipment_reminder_config SET enabled = 0").run();
    await call("PUT", `${KL}/equipment/reminder-config`, { enabled: true, lead_days: 14, recipients: [{ email: "k-list@example.com" }] }, K.token);
    const rem = (await kPost({ name: "Not today", days_of_week: allBut(wd(kToday)), next_due_date: kd(1) })).body;
    sqlite.prepare("UPDATE equipment_schedules SET next_due_date = ? WHERE id = ?").run(kd(-1), rem.id);
    await runEquipmentReminders();
    check("7b. overdue, it isn't reminded on a day it isn't due", !kMail.some((m) => /Not today/.test(m.text)) && kMail.some((m) => /Late: overdue by 3 days/.test(m.text)), kMail.map((m) => m.text).join("\n"));
    kMail.length = 0;
    sqlite.prepare("UPDATE equipment_schedules SET days_of_week = NULL WHERE id = ?").run(rem.id);
    await runEquipmentReminders();
    check("7b. on a day it is, it is", kMail.some((m) => /Not today: overdue by 1 day/.test(m.text)), kMail.map((m) => m.text).join("\n"));
    equipmentMailer.ready = realReady; equipmentMailer.send = realSend;

    // ── 8. Refusals ──
    const setupTries: [string, string, any][] = [
      ["POST", SCH, { name: "x", frequency: "weekly" }], ["PUT", `${SCH}/${weekly.id}`, { name: "x" }], ["POST", `${SCH}/${weekly.id}/end`, { reason: "x" }], ["POST", `${SCH}/${weekly.id}/resume`, {}],
      ["PUT", CL, { steps: [] }], ["PUT", `${L}/equipment-settings`, { review_due_email: true }],
    ];
    const snap = () => JSON.stringify([sqlite.prepare("SELECT * FROM equipment_schedules WHERE lab_id = ? ORDER BY id").all(A.labId), sqlite.prepare("SELECT * FROM equipment_checklist_versions WHERE lab_id = ? ORDER BY id").all(A.labId), sqlite.prepare("SELECT * FROM maintain_settings ORDER BY id").all()]);
    for (const [who2, label] of [[staff, "a limited Staff login never changes schedules, checklists or settings"], [viewer, "a view-only seat doesn't either"], [X, "nor another customer"]] as [{ token: string }, string][]) {
      const before = snap(); const badOnes: string[] = [];
      for (const [m, p, b] of setupTries) { const r = await call(m, p, b, who2.token); if (![401, 403, 404].includes(r.status)) badOnes.push(`${m} ${p} ${r.status}`); }
      check(`8. ${label}`, badOnes.length === 0 && snap() === before, badOnes.join("; "));
    }
    check("8. a view-only seat completes one as it logs an event today; another customer doesn't", (await done(weekly.id, { done_on: today }, viewer.token)).status === 201 && [403, 404].includes((await done(weekly.id, { done_on: today }, X.token)).status));
    const reads = [`${an}/schedules`, `${an}/schedules/${daily.id}/sop`, `${an}/schedules/${daily.id}/checklist-versions`, `${an}/schedules/${daily.id}/completions`];
    const leak: string[] = [];
    for (const p of reads) { for (const lab of [A.labId, X.labId]) { const r = await call("GET", `/api/labs/${lab}/equipment/${p}`, undefined, X.token); if (![403, 404].includes(r.status)) leak.push(`${lab} ${p} ${r.status}`); } }
    check("8. another customer reads nothing", leak.length === 0, leak.join("; "));
    check("8. a schedule reached through another instrument's address is 404", (await call("GET", `${L}/equipment/${bare}/schedules/${daily.id}/completions`, undefined, A.token)).status === 404 && (await call("PUT", `${L}/equipment/${bare}/schedules/${daily.id}`, { name: "x" }, editor.token)).status === 404);
    const staffSees = JSON.stringify([await list(an, staff.token), (await call("GET", `${SCH}/${daily.id}/checklist-versions`, undefined, staff.token)).body, (await call("GET", `${SCH}/${weekly.id}/completions`, undefined, staff.token)).body, (await call("GET", `${L}/equipment/${an}/events`, undefined, staff.token)).body]);
    check("8. a limited Staff login doesn't read a coworker's name or who gets the emails", !/Edie Editor|Owner a|Person viewer|weekly@example\.com/.test(staffSees), staffSees.match(/.{60}(Edie Editor|Owner a|Person viewer|weekly@example\.com)/)?.[0]);
    const support = await mkLab("support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support.userId);
    check("8. Veritas support can't complete one, nor turn the review emails on", (await done(weekly.id, { done_on: today }, support.token)).body.code === "VLS_SUPPORT_CANNOT_SIGN" && (await call("PUT", `${L}/equipment-settings`, { review_due_email: true }, support.token)).body.code === "VLS_SUPPORT_CANNOT_SIGN");
    check("8. ... and may set one up", (await call("POST", SCH, { name: "Set up by support", frequency: "monthly", schedule_type: "service" }, support.token)).status === 201);
    check("8. an ended schedule can't be completed or changed", (await call("POST", `${SCH}/${weekly.id}/end`, { reason: "x" }, editor.token)).status === 200 && (await done(weekly.id, { done_on: today })).body.code === "ENDED" && (await call("PUT", `${SCH}/${weekly.id}`, { name: "y" }, editor.token)).body.code === "ENDED");

    // ── 9. Move, export, purge ──
    const org = Number(sqlite.prepare("INSERT INTO organizations (name, billing_owner_user_id) VALUES ('Made-up System', ?)").run(A.userId).lastInsertRowid);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)").run(org, A.labId, B.labId);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', 'active', 0, ?, ?, ?)").run(B.labId, A.userId, now, now, now);
    await call("PUT", `${SCH}/${daily.id}`, { recipients: ["daily@example.com"], days_of_week: [1, 2, 3, 4, 5] }, editor.token);
    const aCompletions = JSON.stringify(sqlite.prepare("SELECT * FROM equipment_schedule_completions WHERE equipment_id = ? ORDER BY id").all(an));
    const mv = await call("POST", `${L}/equipment/${an}/move`, { to_lab_id: B.labId, reason: "Moved campus" }, A.token);
    const LB = `/api/labs/${B.labId}`;
    const there = (await call("GET", `${LB}/equipment/${mv.body.equipment_id}/schedules`, undefined, B.token)).body.schedules as any[];
    const bToday = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, B.labId));
    check("9. its schedules go along with their due dates, starting that day, reminding that lab's list, with no SOP link", mv.status === 200 && there.length === (sqlite.prepare("SELECT COUNT(*) AS n FROM equipment_schedules WHERE equipment_id = ?").get(an) as any).n && there.every((x) => x.sop === null && x.recipients.length === 0 && x.starts_on === bToday)
      && there.find((x) => x.is_primary)?.next_due_date === eqRow(an).next_due_date, JSON.stringify(there.map((x) => [x.name, x.starts_on, x.sop])));
    const bDaily = there.find((x) => x.name === "Daily maintenance");
    check("9. the days it is due go along", bDaily.days_of_week === "1,2,3,4,5" && bDaily.days_history === null && bDaily.frequency_label === "Daily, Monday to Friday", JSON.stringify([bDaily.days_of_week, bDaily.days_history]));
    check("9. the current checklist goes along", bDaily.checklist?.version_no === 2 && bDaily.checklist.steps.length === 2);
    const carried = (await call("GET", `${LB}/equipment/${mv.body.equipment_id}/schedules/${bDaily.id}/completions`, undefined, B.token)).body;
    check("9. what was completed goes along, marked, with its answers", carried.length === 1 && carried[0].carried_from_lab_id === A.labId && carried[0].results.length === 3 && carried[0].checklist_version_no === 1);
    check("9. the lab that did it keeps its own, unchanged", JSON.stringify(sqlite.prepare("SELECT * FROM equipment_schedule_completions WHERE equipment_id = ? ORDER BY id").all(an)) === aCompletions);
    check("9. the note says what was dropped", /SOP links/.test(mv.body.note) && /reminder recipients/.test(mv.body.note), mv.body.note);
    check("9. the new lab completes its own there", (await call("POST", `${LB}/equipment/${mv.body.equipment_id}/schedules/${bDaily.id}/complete`, { done_on: bToday, version_id: bDaily.checklist.version_id, answers: bDaily.checklist.steps.map((x: any) => ({ step_id: x.id, ...(x.kind === "value" ? { value: 4 } : { result: "pass" }) })) }, B.token)).status === 201);
    check("9. here they are read-only", (await call("POST", SCH, { name: "x", frequency: "weekly" }, editor.token)).body.code === "MOVED_AWAY" && (await done(daily.id, { done_on: today })).body.code === "RETIRED");
    const TABLES = ["equipment_schedules", "equipment_checklist_versions", "equipment_checklist_steps", "equipment_schedule_completions", "equipment_checklist_results", "maintain_settings"];
    check("9. every table is classified for the export and has a purge rule", unclassifiedTables(sqlite).length === 0 && unruledTables(sqlite).length === 0 && TABLES.every((t) => !!EXPORT_TABLES[t] && purgeRule(t)?.kind === "delete"), [...unclassifiedTables(sqlite), ...unruledTables(sqlite)].join(", "));
    const rowsFor = (t: string, lab: number) => selectRecords(sqlite, t, exportContext(sqlite, lab)!)!.rows as any[];
    const total = (t: string, lab: number) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id = ?`).get(lab) as any).n;
    check("9. the export takes all of this lab's rows and no other lab's", TABLES.every((t) => { const r = rowsFor(t, A.labId); return r.length === total(t, A.labId) && r.length > 0 && r.every((x) => x.lab_id === A.labId); }));
    const orphan = (sqlite.prepare("SELECT COUNT(*) AS n FROM equipment_checklist_results r WHERE NOT EXISTS (SELECT 1 FROM equipment_schedule_completions c WHERE c.id = r.completion_id AND c.lab_id = r.lab_id)").get() as any).n;
    check("9. no answer is left without its completion in its own lab", orphan === 0, String(orphan));
    sqlite.prepare("UPDATE labs SET organization_id = NULL WHERE id IN (?, ?)").run(A.labId, B.labId);
    const bBefore = TABLES.filter((t) => t !== "maintain_settings").map((t) => total(t, B.labId));
    const plan = planCustomerPurge(sqlite, { ownerUserId: A.userId }) as any;
    check("9. the purge plan takes every row of this customer", TABLES.every((t) => plan.plan?.rowsByTable?.[t] === total(t, A.labId)), JSON.stringify(plan.code ?? TABLES.map((t) => plan.plan?.rowsByTable?.[t])));
    if (plan.plan) applyCustomerPurge(sqlite, plan.plan, plan.internal);
    check("9. ... applying it leaves none, and the lab it moved to keeps its copy", TABLES.every((t) => total(t, A.labId) === 0) && JSON.stringify(TABLES.filter((t) => t !== "maintain_settings").map((t) => total(t, B.labId))) === JSON.stringify(bBefore) && bBefore.every((n) => n > 0), JSON.stringify(bBefore));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
