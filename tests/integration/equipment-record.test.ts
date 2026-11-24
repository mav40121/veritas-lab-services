// tests/integration/equipment-record.test.ts
//
// STANDING integration test for the VeritaMaintain equipment record (B9, 2026-11-24; server/equipment.ts, shared/equipmentPm.ts):
//   1. The PM due date: only an event that completes PM moves it, never earlier unless the person says so. Before, a repair, service,
//      calibration or function check moved it, and a backdated entry moved it earlier (OLD=1 prints what main does: those checks fail).
//   2. Events: who was signed in, cost, the vendor, an audit row. Corrected with a reason (the original row is kept) or voided; never edited.
//   3. A vendor PM waits for its report when the lab requires one (off by default), and completes when it is attached.
//   4. Files: size cap, types from the bytes, the patient information warning, lab-scoped download, removal keeps the row and drops the bytes.
//   5. The record's fields, the IFU link and its document at the current approved version.
//   6. Out of service: start, stop, computed time, correction with a reason.
//   7. Retire with a reason, the Retired list, restore. A record holding anything isn't deleted.
//   8. Move to another lab of the same organization: who may, what goes along read-only, the dropped links, an audit row in both labs.
//   9. Refusals: another lab, a view-only seat, a limited Staff login, Veritas support.
//  10. The monthly review and its workbook. The analyzer trail. The VeritaMap IFU link.
//  11. Export-all and the customer purge take every new table and file.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:equipment-record

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
import { labLocalDate } from "../../server/dateLocal";

(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);
const JSZip = require2("jszip");
const ExcelJS = require2("exceljs");

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
  const PW = ["Equip", "rec", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const sendFile = async (p: string, token: string, file: { name: string; type: string; bytes: Buffer }, kind = "other") => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const PDF = { name: "made-up-report.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 made-up service report") };
  const mkLab = async (tag: string, email = `equip-${tag}-${Date.now()}@example.com`) => {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Equip Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };

  try {
    const A = await mkLab("a");
    const B = await mkLab("b");
    const X = await mkLab("x"); // another customer
    sqlite.prepare("UPDATE labs SET is_demo = 0 WHERE id IN (?, ?, ?)").run(A.labId, B.labId, X.labId);
    const addPerson = async (lab: { labId: number; userId: number }, tag: string, kind: "editor" | "staff" | "viewer", name = `Person ${tag}`) => {
      const email = `equip-${tag}-${Date.now()}@example.com`;
      const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
      const userId = Number(reg.body.user?.id ?? reg.body.id);
      sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(lab.labId, userId, now, now, now);
      sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab.labId, userId);
      if (kind === "staff") {
        const sl = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab.labId) as any)?.id
          ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up', '99D0000000', ?, ?, ?)").run(lab.userId, lab.labId, now, now).lastInsertRowid);
        const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Made', 'active', ?, ?)").run(sl, lab.labId, lab.userId, tag, now, now).lastInsertRowid);
        sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`).run(lab.userId, email, userId, lab.labId, emp, now, now);
      } else {
        sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')`)
          .run(lab.userId, email, userId, now, now, kind === "editor" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}', `equip-${tag}-${Date.now()}`, lab.labId);
      }
      sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
      const login = await call("POST", "/api/auth/login", { email, password: PW });
      return { email, userId, token: login.body.token as string, name };
    };
    const editor = await addPerson(A, "editor", "editor", "Edie Editor");
    const staff = await addPerson(A, "staff", "staff", "Stan Stafford");
    const viewer = await addPerson(A, "viewer", "viewer");
    const L = `/api/labs/${A.labId}`;
    const auditRows = (entity: string, id: number | string) => sqlite.prepare("SELECT * FROM audit_log WHERE module = 'veritamaintain' AND entity_type = ? AND entity_id = ? ORDER BY id").all(entity, String(id)) as any[];
    const due = (id: number) => (sqlite.prepare("SELECT next_due_date FROM lab_equipment WHERE id = ?").get(id) as any).next_due_date;
    const mk = async (body: any, token = A.token, lab = L) => (await call("POST", `${lab}/equipment`, body, token)).body.id as number;

    // ── 1. The PM due date ──
    const an = await mk({ instrument_name: "Made-up chemistry analyzer", pm_interval_days: 90, next_due_date: "2026-12-01" });
    const ev = (id: number, body: any, token = A.token) => call("POST", `${L}/equipment/${id}/events`, body, token);
    for (const t of ["repair", "service", "calibration", "function_check"]) {
      const r = await ev(an, { event_type: t, event_date: "2026-11-20" });
      check(`1. logging a ${t} leaves the PM due date alone`, r.status === 200 && due(an) === "2026-12-01", `${r.status} ${due(an)}`);
    }
    const typed = await ev(an, { event_type: "calibration", event_date: "2026-11-20", next_due_date: "2027-11-20" });
    check("1. a date typed on an entry that doesn't complete PM isn't the PM due date", typed.status === 200 && due(an) === "2026-12-01", due(an));
    const pm = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-11-20" });
    check("1. a PM entry moves it by the interval", pm.body.next_due_date === "2027-02-18" && due(an) === "2027-02-18", pm.body.next_due_date);
    const back = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-06-01" });
    check("1. a backdated PM never moves it earlier", back.status === 200 && due(an) === "2027-02-18" && back.body.due_date_held?.keeps === "2027-02-18" && back.body.due_date_held?.works_out_to === "2026-08-30", JSON.stringify(back.body.due_date_held));
    check("1. ... and the backdated entry says it set no date", (sqlite.prepare("SELECT next_due_date FROM equipment_maintenance_events WHERE id = ?").get(back.body.event_id) as any).next_due_date === null);
    const said = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-06-01", allow_earlier_due: true });
    check("1. unless the person says so", due(an) === "2026-08-30" && said.body.due_date_held === null, due(an));
    const svc = await ev(an, { event_type: "service", event_date: "2026-11-20", completes_pm: true });
    check("1. a service visit marked as completing PM moves it", svc.status === 200 && due(an) === "2027-02-18", due(an));
    const ts = await ev(an, { event_type: "troubleshooting", event_date: "2026-11-21", completes_pm: true, next_due_date: "2030-01-01", allow_earlier_due: true });
    check("1. troubleshooting never does, even when asked", ts.status === 200 && due(an) === "2027-02-18", due(an));
    const partial = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-11-22", completes_pm: false });
    check("1. a PM entry that doesn't complete PM doesn't either", partial.status === 200 && due(an) === "2027-02-18", due(an));
    const typedPm = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-11-22", next_due_date: "2027-06-01" });
    check("1. a typed date wins over the interval on a PM", typedPm.body.next_due_date === "2027-06-01", typedPm.body.next_due_date);
    const typedBack = await ev(an, { event_type: "preventive_maintenance", event_date: "2026-11-22", next_due_date: "2027-01-01" });
    check("1. a typed earlier date is held too", due(an) === "2027-06-01" && typedBack.body.due_date_held?.works_out_to === "2027-01-01", JSON.stringify(typedBack.body.due_date_held));
    check("1. a date that isn't a date is refused", (await ev(an, { event_type: "preventive_maintenance", event_date: "soon" })).body.code === "BAD_DATE" && (await ev(an, { event_type: "preventive_maintenance", event_date: "2026-02-30" })).body.code === "BAD_DATE");

    // ── 2. Who, cost, vendor, audit; corrections ──
    const E2 = await mk({ instrument_name: "Made-up centrifuge", pm_interval_days: 365, next_due_date: "2027-01-15" });
    const asStaff = await ev(E2, { event_type: "repair", event_date: "2026-11-10", performed_by: "Vendor tech", cost: "$1,250.50", by_vendor: true, vendor_company: "Made-up Service Co", vendor_technician: "R. Made-up", notes: "Replaced the belt" }, staff.token);
    const row2 = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(asStaff.body.event_id) as any;
    check("2. a Staff login logs an event, and it keeps who was signed in", asStaff.status === 200 && row2.logged_by_user_id === staff.userId && row2.logged_by_name === "Stan Stafford", JSON.stringify(row2));
    check("2. cost, vendor company and technician are kept", row2.cost === 1250.5 && row2.by_vendor === 1 && row2.vendor_company === "Made-up Service Co" && row2.vendor_technician === "R. Made-up");
    check("2. a signed-in name from the body is never taken", (sqlite.prepare("SELECT logged_by_user_id AS u FROM equipment_maintenance_events WHERE id = ?").get((await ev(E2, { event_type: "repair", event_date: "2026-11-11", logged_by_user_id: 1, logged_by_name: "Someone Else" }, staff.token)).body.event_id) as any).u === staff.userId);
    check("2. a cost that isn't a number is refused", (await ev(E2, { event_type: "repair", event_date: "2026-11-10", cost: "a lot" })).body.code === "BAD_COST" && (await ev(E2, { event_type: "repair", event_date: "2026-11-10", cost: -5 })).body.code === "BAD_COST");
    const a2 = auditRows("equipment_event", row2.id);
    check("2. it writes an audit row with who and the lab", a2.length === 1 && a2[0].user_id === staff.userId && a2[0].owner_user_id === A.userId && JSON.parse(a2[0].after_json).lab_id === A.labId, JSON.stringify(a2[0]));

    const evBase = `${L}/equipment/${E2}/events`;
    check("2. a correction needs a reason", (await call("POST", `${evBase}/${row2.id}/correct`, { cost: 1300 }, editor.token)).body.code === "REASON_REQUIRED");
    const corr = await call("POST", `${evBase}/${row2.id}/correct`, { reason: "Invoice total", cost: 1300, notes: "Replaced the belt and the lid seal" }, editor.token);
    const orig = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(row2.id) as any;
    const next = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(corr.body.event_id) as any;
    check("2. an editor corrects it: a new row, and the original is exactly as it was", corr.status === 200 && orig.cost === 1250.5 && orig.notes === "Replaced the belt" && orig.superseded_by_event_id === next.id
      && next.cost === 1300 && next.notes === "Replaced the belt and the lid seal" && next.corrects_event_id === orig.id && next.correction_reason === "Invoice total" && next.corrected_by_user_id === editor.userId, JSON.stringify({ orig, next }));
    check("2. the correction keeps who logged the work", next.logged_by_user_id === staff.userId && next.event_type === "repair" && next.event_date === "2026-11-10");
    check("2. ... and leaves the PM due date alone", due(E2) === "2027-01-15", due(E2));
    check("2. a corrected row can't be corrected again", (await call("POST", `${evBase}/${row2.id}/correct`, { reason: "again" }, editor.token)).body.code === "ALREADY_CORRECTED");
    const again = await call("POST", `${evBase}/${next.id}/correct`, { reason: "Wrong day", event_date: "2026-11-09" }, editor.token);
    const hist = (await call("GET", evBase, undefined, A.token)).body as any[];
    const top = hist.find((h) => h.id === again.body.event_id);
    check("2. the history shows what stands, with each earlier version under it", !!top && top.event_date === "2026-11-09" && top.earlier_versions.length === 2 && !hist.some((h) => h.id === row2.id || h.id === next.id), JSON.stringify(hist.map((h) => h.id)));
    check("2. each correction has its audit row with before and after", auditRows("equipment_event", next.id).length === 1 && JSON.parse(auditRows("equipment_event", next.id)[0].before_json).cost === 1250.5 && JSON.parse(auditRows("equipment_event", next.id)[0].after_json).reason === "Invoice total");

    // A correction of the PM that set the due date
    const E3 = await mk({ instrument_name: "Made-up microscope", pm_interval_days: 100, next_due_date: "2026-12-01" });
    const p3 = await ev(E3, { event_type: "preventive_maintenance", event_date: "2026-11-20" });
    check("2. the PM set the date", due(E3) === "2027-02-28", due(E3));
    const c3 = await call("POST", `${L}/equipment/${E3}/events/${p3.body.event_id}/correct`, { reason: "It was the 10th", event_date: "2026-11-10" }, editor.token);
    check("2. correcting its date to an earlier one holds the due date", due(E3) === "2027-02-28" && c3.body.due_date_held?.works_out_to === "2027-02-18", JSON.stringify(c3.body.due_date_held));
    const c3b = await call("POST", `${L}/equipment/${E3}/events/${c3.body.event_id}/correct`, { reason: "Move the date with it", event_date: "2026-11-11", allow_earlier_due: true }, editor.token);
    check("2. unless the person says so", due(E3) === "2027-02-19" && c3b.body.due_date_held === null, due(E3));
    const notPm = await call("POST", `${L}/equipment/${E3}/events/${c3b.body.event_id}/correct`, { reason: "Only part of the PM was done", completes_pm: false }, editor.token);
    check("2. saying it never completed PM holds the date it set, and says so", due(E3) === "2027-02-19" && !!notPm.body.due_date_held, JSON.stringify(notPm.body.due_date_held));
    const p3b = await ev(E3, { event_type: "preventive_maintenance", event_date: "2026-11-23" });
    const v3 = await call("POST", `${L}/equipment/${E3}/events/${p3b.body.event_id}/void`, { reason: "Wrong instrument", allow_earlier_due: true }, editor.token);
    check("2. a void needs a reason, keeps the row, and can put the date back", (await call("POST", `${L}/equipment/${E3}/events/${p3b.body.event_id}/void`, { reason: "x" }, editor.token)).body.code === "ALREADY_VOIDED"
      && v3.status === 200 && due(E3) === "2027-02-19" && (sqlite.prepare("SELECT void_reason FROM equipment_maintenance_events WHERE id = ?").get(p3b.body.event_id) as any).void_reason === "Wrong instrument", `${v3.status} ${due(E3)}`);
    check("2. a void with no reason is refused", (await call("POST", `${L}/equipment/${E3}/events/${notPm.body.event_id}/void`, {}, editor.token)).body.code === "REASON_REQUIRED");
    check("2. there is no route that edits or deletes an event in place", [404, 405].includes((await call("PUT", `${evBase}/${next.id}`, { notes: "x" }, A.token)).status) && [404, 405].includes((await call("DELETE", `${evBase}/${next.id}`, undefined, A.token)).status));

    // ── 3. A vendor PM and its report ──
    const E4 = await mk({ instrument_name: "Made-up hematology analyzer", pm_interval_days: 180, next_due_date: "2026-12-10" });
    const S = `${L}/equipment-settings`;
    check("3. off by default", (await call("GET", S, undefined, A.token)).body.require_vendor_report === false);
    const free = await ev(E4, { event_type: "preventive_maintenance", event_date: "2026-11-01", by_vendor: true, vendor_company: "Made-up Service Co" });
    check("3. with it off, a vendor PM counts with no report", free.body.awaiting_vendor_report_event === false && due(E4) === "2027-04-30", due(E4));
    check("3. an editor turns it on", (await call("PUT", S, { require_vendor_report: true }, editor.token)).body.require_vendor_report === true && auditRows("maintain_settings", A.labId).length === 1);
    const waits = await ev(E4, { event_type: "preventive_maintenance", event_date: "2026-11-20", by_vendor: true, vendor_company: "Made-up Service Co" }, staff.token);
    check("3. with it on, a vendor PM with no report doesn't count yet", waits.body.awaiting_vendor_report_event === true && due(E4) === "2027-04-30", due(E4));
    check("3. ... and the list says one is waiting", (await call("GET", `${L}/equipment`, undefined, A.token)).body.find((e: any) => e.id === E4).awaiting_vendor_report === 1);
    const inHouse = await ev(E4, { event_type: "function_check", event_date: "2026-11-20" });
    check("3. an in-house entry isn't held by the rule", inHouse.body.awaiting_vendor_report_event === false);
    const wrongKind = await sendFile(`${L}/equipment/${E4}/events/${waits.body.event_id}/files`, staff.token, PDF, "pm_checklist");
    check("3. a file of another kind doesn't complete it", wrongKind.status === 201 && wrongKind.body.pm_completed === null && due(E4) === "2027-04-30");
    const rep = await sendFile(`${L}/equipment/${E4}/events/${waits.body.event_id}/files`, staff.token, PDF, "vendor_report");
    check("3. the person who logged it attaches the vendor report, and then it counts", rep.status === 201 && rep.body.pm_completed?.next_due_date === "2027-05-19" && due(E4) === "2027-05-19", JSON.stringify(rep.body.pm_completed));
    const done3 = sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE id = ?").get(waits.body.event_id) as any;
    check("3. the entry reads vendor report attached and complete", done3.vendor_report_attached === 1 && done3.pm_complete === 1 && done3.next_due_date === "2027-05-19");
    check("3. its only report can't be removed while the lab requires one", (await call("POST", `${L}/equipment/${E4}/files/${rep.body.id}/remove`, { reason: "wrong file" }, editor.token)).body.code === "LAST_VENDOR_REPORT");
    const backdatedVendor = await ev(E4, { event_type: "preventive_maintenance", event_date: "2026-01-05", by_vendor: true });
    const repBack = await sendFile(`${L}/equipment/${E4}/events/${backdatedVendor.body.event_id}/files`, A.token, PDF, "vendor_report");
    check("3. a report on a backdated vendor PM never moves the date earlier", due(E4) === "2027-05-19" && repBack.body.pm_completed?.due_date_held?.works_out_to === "2026-07-04", JSON.stringify(repBack.body.pm_completed));

    // ── 4. Files ──
    const F = `${L}/equipment/${E2}/files`;
    const rf = await sendFile(F, editor.token, PDF, "calibration_certificate");
    check("4. an editor attaches a file to the record", rf.status === 201 && rf.body.kind === "calibration_certificate" && rf.body.mime_type === "application/pdf" && rf.body.phiWarning === null, JSON.stringify(rf.body));
    check("4. no file is refused", (await sendFile(F, editor.token, { ...PDF, bytes: Buffer.alloc(0) })).status === 400);
    check("4. a program named as a PDF is refused by its bytes", (await sendFile(F, editor.token, { name: "report.pdf", type: "application/pdf", bytes: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 1, 2, 3]) })).body.code === "BAD_TYPE");
    check("4. HTML is refused", (await sendFile(F, editor.token, { name: "x.html", type: "text/html", bytes: Buffer.from("<script>alert(1)</script>") })).body.code === "BAD_TYPE");
    check("4. over 20 MB is refused", (await sendFile(F, editor.token, { ...PDF, bytes: Buffer.concat([PDF.bytes, Buffer.alloc(20 * 1024 * 1024 + 1)]) })).status === 400);
    const phi = await sendFile(F, editor.token, { name: "notes.txt", type: "text/plain", bytes: Buffer.from("Patient Name: Made Up MRN: 12345678") }, "other");
    check("4. a file that reads like patient information is stored with a warning", phi.status === 201 && /patient information/.test(phi.body.phiWarning || ""), String(phi.body.phiWarning));
    const dl = await fetch(`${base}${F}/${rf.body.id}`, { headers: { Authorization: `Bearer ${viewer.token}` } });
    const dlBytes = Buffer.from(await dl.arrayBuffer());
    check("4. anyone who reads the record downloads it, as an attachment", dl.status === 200 && dlBytes.equals(PDF.bytes) && /attachment/.test(dl.headers.get("content-disposition") || "") && dl.headers.get("x-content-type-options") === "nosniff");
    check("4. removal needs a reason", (await call("POST", `${F}/${phi.body.id}/remove`, {}, editor.token)).body.code === "REASON_REQUIRED");
    const rm = await call("POST", `${F}/${phi.body.id}/remove`, { reason: "Held patient information" }, editor.token);
    const rmRow = sqlite.prepare("SELECT * FROM equipment_files WHERE id = ?").get(phi.body.id) as any;
    check("4. a removed file keeps its row and reason and loses its bytes", rm.status === 200 && rmRow.file_data === null && rmRow.removal_reason === "Held patient information" && rmRow.removed_by_user_id === editor.userId && (await call("GET", `${F}/${phi.body.id}`, undefined, A.token)).status === 410);
    check("4. file adds and removals have audit rows", auditRows("equipment_file", phi.body.id).length === 2 && !/%PDF/.test(JSON.stringify(auditRows("equipment_file", rf.body.id))));
    const staffEvent = hist.find((h) => h.logged_by_user_id === staff.userId && h.id !== again.body.event_id)!;
    check("4. a Staff login attaches a file to its own entry", (await sendFile(`${evBase}/${staffEvent.id}/files`, staff.token, PDF, "service_report")).status === 201);

    // ── 5. The record's fields and the IFU ──
    const put = await call("PUT", `${L}/equipment/${E2}`, { placed_in_service_date: "2020-05-01", vendor_name: "Made-up Service Co", service_contract: "Contract 123, full service through 2027", ifu_url: "https://example.com/ifu.pdf" }, editor.token);
    check("5. the new fields save", put.status === 200 && put.body.placed_in_service_date === "2020-05-01" && put.body.service_contract.startsWith("Contract 123") && put.body.ifu_url === "https://example.com/ifu.pdf", JSON.stringify(put.body));
    check("5. ... with an audit row of what changed", JSON.parse(auditRows("equipment", E2).pop().after_json).vendor_name === "Made-up Service Co");
    const keepPut = await call("PUT", `${L}/equipment/${E2}`, { instrument_name: "Made-up centrifuge", location: "Bench 3" }, editor.token);
    check("5. a save that leaves them out keeps them", keepPut.body.placed_in_service_date === "2020-05-01" && keepPut.body.ifu_url === "https://example.com/ifu.pdf" && keepPut.body.next_due_date === "2027-01-15");
    check("5. a link that isn't a web address is refused", (await call("PUT", `${L}/equipment/${E2}`, { ifu_url: "javascript:alert(1)" }, editor.token)).status === 400);
    check("5. a date that isn't one is refused", (await call("PUT", `${L}/equipment/${E2}`, { placed_in_service_date: "2020-13-01" }, editor.token)).status === 400);
    const manual = Number(sqlite.prepare("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Made-up manual')").run(A.labId).lastInsertRowid);
    const mkDoc = (labId: number, title: string, status: string, versions: string[]) => {
      const doc = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, manual_id, title, owner_user_id, status) VALUES (?, ?, ?, ?, ?)").run(labId, manual, title, A.userId, status).lastInsertRowid);
      const ids = versions.map((t, i) => {
        const rel = `${labId}/${doc}/v${i + 1}/document.txt`;
        fs.mkdirSync(path.dirname(resolveVersionFilePath(rel)), { recursive: true });
        fs.writeFileSync(resolveVersionFilePath(rel), t);
        return Number(sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, ?, ?, 'txt', ?, ?, ?)").run(doc, i + 1, rel, t.length, hashBuffer(Buffer.from(t)), A.userId).lastInsertRowid);
      });
      return { doc, ids };
    };
    const ifu = mkDoc(A.labId, "Made-up IFU", "in_review", ["Approved IFU text", "Draft IFU text"]);
    sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(ifu.ids[1], ifu.ids[0], ifu.doc);
    const otherDoc = mkDoc(X.labId, "Another lab's IFU", "approved", ["Not yours"]);
    sqlite.prepare("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?").run(otherDoc.ids[0], otherDoc.ids[0], otherDoc.doc);
    check("5. another lab's document can't be linked", (await call("PUT", `${L}/equipment/${E2}`, { ifu_document_id: otherDoc.doc }, editor.token)).status === 400);
    check("5. this lab's can", (await call("PUT", `${L}/equipment/${E2}`, { ifu_document_id: ifu.doc }, editor.token)).body.ifu_document_id === ifu.doc);
    const open = await call("GET", `${L}/equipment/${E2}/ifu-document`, undefined, staff.token);
    check("5. it opens at its current approved version, not the revision in review", open.status === 200 && /Approved IFU text/.test(open.body.html) && !/Draft IFU text/.test(open.body.html) && open.body.revision_in_progress === true, JSON.stringify(open.body).slice(0, 200));
    sqlite.prepare("UPDATE policy_documents SET status = 'approved', current_version_id = ?, approved_version_id = ? WHERE id = ?").run(ifu.ids[1], ifu.ids[1], ifu.doc);
    check("5. once the revision is approved, the same link opens it", /Draft IFU text/.test((await call("GET", `${L}/equipment/${E2}/ifu-document`, undefined, staff.token)).body.html));
    sqlite.prepare("UPDATE policy_documents SET status = 'draft', approved_version_id = NULL WHERE id = ?").run(ifu.doc);
    check("5. with no approved version there is nothing to open", (await call("GET", `${L}/equipment/${E2}/ifu-document`, undefined, A.token)).body.code === "NO_APPROVED_VERSION");
    sqlite.prepare("UPDATE policy_documents SET status = 'approved', approved_version_id = ? WHERE id = ?").run(ifu.ids[1], ifu.doc);
    check("5. opening it is on VeritaDC's record", !!sqlite.prepare("SELECT 1 FROM policy_audit_log WHERE document_id = ? AND action = 'viewed' AND details LIKE '%equipment_ifu%'").get(ifu.doc));
    const rec = await call("GET", `${L}/equipment/${E2}/record`, undefined, staff.token);
    check("5. the record reads back with the document's title, its files and no edit for a Staff login", rec.status === 200 && rec.body.ifu_document?.title === "Made-up IFU" && rec.body.files.length === 2 && rec.body.can_edit === false && !("file_data" in rec.body.files[0]), JSON.stringify(rec.body).slice(0, 300));

    // ── 6. Out of service ──
    const D = `${L}/equipment/${E2}/downtime`;
    check("6. it needs a reason and a real time", (await call("POST", D, { down_from: "2026-11-01T08:00" }, editor.token)).body.code === "REASON_REQUIRED" && (await call("POST", D, { reason: "x", down_from: "2026-11-01" }, editor.token)).body.code === "BAD_DATE" && (await call("POST", D, { reason: "x", down_from: "2099-01-01T08:00" }, editor.token)).body.code === "BAD_DATE");
    const d1 = await call("POST", D, { down_from: "2026-11-01T08:00", reason: "Rotor fault" }, editor.token);
    check("6. out of service starts, and the list shows it", d1.status === 201 && (await call("GET", `${L}/equipment`, undefined, A.token)).body.find((e: any) => e.id === E2).out_of_service?.reason === "Rotor fault");
    check("6. it can't start twice", (await call("POST", D, { down_from: "2026-11-02T08:00", reason: "again" }, editor.token)).body.code === "ALREADY_OUT");
    check("6. it can't come back before it went out", (await call("POST", `${D}/${d1.body.id}/end`, { down_until: "2026-10-31T08:00" }, editor.token)).body.code === "BAD_DATE");
    const d1e = await call("POST", `${D}/${d1.body.id}/end`, { down_until: "2026-11-03T10:30", return_note: "Rotor replaced, function check passed" }, editor.token);
    check("6. the time out of service is worked out (2 days 2 h 30 min)", d1e.status === 200 && d1e.body.minutes === 2 * 1440 + 150, String(d1e.body.minutes));
    check("6. it can't end twice, and a period can't overlap another", (await call("POST", `${D}/${d1.body.id}/end`, {}, editor.token)).body.code === "ALREADY_ENDED" && (await call("POST", D, { down_from: "2026-11-02T08:00", reason: "overlap" }, editor.token)).body.code === "OVERLAP");
    check("6. a correction needs a reason", (await call("PUT", `${D}/${d1.body.id}`, { down_until: "2026-11-03T11:30" }, editor.token)).body.code === "REASON_REQUIRED");
    const d1c = await call("PUT", `${D}/${d1.body.id}`, { down_until: "2026-11-03T11:30", correction_reason: "Wrong hour" }, editor.token);
    const dAudit = auditRows("equipment_downtime", d1.body.id);
    check("6. ... and keeps the values before in the audit row", d1c.body.down_until === "2026-11-03T11:30" && JSON.parse(dAudit[dAudit.length - 1].before_json).down_until === "2026-11-03T10:30" && JSON.parse(dAudit[dAudit.length - 1].after_json).correction_reason === "Wrong hour");

    // ── 7. Retire and restore ──
    const E5 = await mk({ instrument_name: "Made-up old analyzer", placed_in_service_date: "2015-01-01" });
    await call("POST", `${L}/equipment/${E5}/downtime`, { down_from: "2026-11-01T08:00", reason: "Waiting for parts" }, editor.token);
    check("7. retiring needs a reason", (await call("POST", `${L}/equipment/${E5}/retire`, {}, editor.token)).body.code === "REASON_REQUIRED");
    check("7. the older way (a status on the save) is refused", (await call("PUT", `${L}/equipment/${E5}`, { status: "retired" }, editor.token)).body.code === "REASON_REQUIRED" && (sqlite.prepare("SELECT status FROM lab_equipment WHERE id = ?").get(E5) as any).status === "active");
    check("7. it can't leave service before it was placed in service", (await call("POST", `${L}/equipment/${E5}/retire`, { reason: "Replaced", removed_from_service_date: "2014-01-01" }, editor.token)).body.code === "BAD_DATE");
    const ret = await call("POST", `${L}/equipment/${E5}/retire`, { reason: "Replaced by the new analyzer", removed_from_service_date: "2026-11-15" }, editor.token);
    check("7. it retires with the date and the reason", ret.status === 200 && ret.body.status === "retired" && ret.body.removed_from_service_date === "2026-11-15" && ret.body.retired_by_name === "Edie Editor");
    check("7. ... and its out of service period ends", !!(sqlite.prepare("SELECT down_until FROM equipment_downtime WHERE equipment_id = ?").get(E5) as any).down_until);
    const live7 = (await call("GET", `${L}/equipment`, undefined, A.token)).body as any[];
    const ret7 = (await call("GET", `${L}/equipment?retired=1`, undefined, A.token)).body as any[];
    check("7. it leaves the list and is on the Retired list", !live7.some((e) => e.id === E5) && ret7.length === 1 && ret7[0].id === E5 && ret7[0].removed_from_service_reason === "Replaced by the new analyzer");
    check("7. a retired instrument takes no entries", (await ev(E5, { event_type: "repair", event_date: "2026-11-20" })).body.code === "RETIRED");
    const back7 = await call("POST", `${L}/equipment/${E5}/restore`, { note: "Back as a spare" }, editor.token);
    check("7. restoring brings it back, and the retirement stays in the audit", back7.body.status === "active" && back7.body.removed_from_service_date === null && auditRows("equipment", E5).some((r) => r.action === "restore" && JSON.parse(r.before_json).reason === "Replaced by the new analyzer") && auditRows("equipment_retired", E5).length === 1);
    check("7. an instrument holding records can't be deleted", (await call("DELETE", `${L}/equipment/${E2}`, undefined, A.token)).body.code === "HOLDS_RECORDS" && !!sqlite.prepare("SELECT 1 FROM lab_equipment WHERE id = ?").get(E2));
    const empty = await mk({ instrument_name: "Added by mistake" });
    check("7. one holding nothing can", (await call("DELETE", `${L}/equipment/${empty}`, undefined, A.token)).status === 200);

    // ── 8. Move ──
    const org = Number(sqlite.prepare("INSERT INTO organizations (name, billing_owner_user_id) VALUES ('Made-up System', ?)").run(A.userId).lastInsertRowid);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)").run(org, A.labId, B.labId);
    const mapId = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Made-up map', '[]', ?, ?)").run(A.userId, A.labId, now, now).lastInsertRowid);
    const menuId = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, 'Made-up centrifuge', 'Primary', 'Chemistry', ?)").run(mapId, now).lastInsertRowid);
    await call("PUT", `${L}/equipment/${E2}`, { map_instrument_id: menuId }, editor.token);
    const stainRow = Number(sqlite.prepare("INSERT INTO stain_log_rows (lab_id, equipment_id, name, created_at, updated_at) VALUES (?, ?, 'Eosin', ?, ?)").run(A.labId, E2, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO stain_log_entries (lab_id, equipment_id, row_id, log_date, code, initials, created_at) VALUES (?, ?, ?, '2026-11-02', 'C', 'MU', ?)").run(A.labId, E2, stainRow, now);
    const M = `${L}/equipment/${E2}/move`;
    check("8. an editor here with no edit there has nowhere to move it", (await call("GET", `${L}/equipment/${E2}/move-targets`, undefined, editor.token)).body.length === 0);
    check("8. ... and is refused, naming the lab in the body or not", (await call("POST", M, { to_lab_id: B.labId, reason: "x" }, editor.token)).body.code === "MOVE_NOT_ALLOWED");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 0, ?, ?, ?)").run(B.labId, editor.userId, now, now, now);
    check("8. being a member there isn't enough", (await call("POST", M, { to_lab_id: B.labId, reason: "x" }, editor.token)).body.code === "MOVE_NOT_ALLOWED");
    sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`).run(B.userId, editor.email, editor.userId, now, now, `equip-both-${Date.now()}`, B.labId);
    const targets = await call("GET", `${L}/equipment/${E2}/move-targets`, undefined, editor.token);
    check("8. someone who can edit both sees that lab and no other", targets.body.length === 1 && targets.body[0].id === B.labId, JSON.stringify(targets.body));
    // Someone who can edit in a lab of no organization, and in one of another: neither is a place to move it.
    const solo = await mkLab("solo"), other = await mkLab("other");
    const org2 = Number(sqlite.prepare("INSERT INTO organizations (name, billing_owner_user_id) VALUES ('Another System', ?)").run(other.userId).lastInsertRowid);
    sqlite.prepare("UPDATE labs SET organization_id = ?, is_demo = 0 WHERE id = ?").run(org2, other.labId);
    for (const l of [solo, other]) sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', 'active', 0, ?, ?, ?)").run(l.labId, A.userId, now, now, now);
    const ownerTargets = (await call("GET", `${L}/equipment/${E2}/move-targets`, undefined, A.token)).body as any[];
    check("8. editing in a lab outside the organization doesn't make it a place to move to", !ownerTargets.some((t) => t.id === solo.labId || t.id === other.labId)
      && (await call("POST", M, { to_lab_id: solo.labId, reason: "x" }, A.token)).body.code === "MOVE_NOT_ALLOWED" && (await call("POST", M, { to_lab_id: other.labId, reason: "x" }, A.token)).body.code === "MOVE_NOT_ALLOWED", JSON.stringify(ownerTargets));
    check("8. a lab outside the organization is refused", (await call("POST", M, { to_lab_id: X.labId, reason: "x" }, editor.token)).body.code === "MOVE_NOT_ALLOWED" && (await call("POST", M, { to_lab_id: A.labId, reason: "x" }, editor.token)).body.code === "MOVE_NOT_ALLOWED");
    sqlite.prepare("UPDATE labs SET subscription_expires_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(B.labId);
    const orgExp = (sqlite.prepare("SELECT * FROM organizations WHERE id = ?").get(org) as any);
    check("8. a lab that isn't taking new records is refused", (await call("POST", M, { to_lab_id: B.labId, reason: "x" }, editor.token)).body.code === "MOVE_NOT_ALLOWED", JSON.stringify(orgExp));
    sqlite.prepare("UPDATE labs SET subscription_expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(B.labId);
    check("8. a move needs a reason", (await call("POST", M, { to_lab_id: B.labId }, editor.token)).body.code === "REASON_REQUIRED");
    const aEventsBefore = JSON.stringify(sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE equipment_id = ? ORDER BY id").all(E2));
    await call("POST", D, { down_from: "2026-11-20T08:00", reason: "Being moved" }, editor.token);
    const mv = await call("POST", M, { to_lab_id: B.labId, reason: "Consolidating the core lab" }, editor.token);
    const LB = `/api/labs/${B.labId}`;
    const there = sqlite.prepare("SELECT * FROM lab_equipment WHERE id = ?").get(mv.body.equipment_id) as any;
    const here = sqlite.prepare("SELECT * FROM lab_equipment WHERE id = ?").get(E2) as any;
    check("8. it moves: a live record there, retired here", mv.status === 200 && there.lab_id === B.labId && there.status === "active" && here.status === "retired" && here.moved_to_lab_id === B.labId && here.moved_to_equipment_id === there.id, JSON.stringify(mv.body));
    check("8. its due date and fields went along", there.next_due_date === "2027-01-15" && there.serial_number === here.serial_number && there.placed_in_service_date === "2020-05-01" && there.vendor_name === "Made-up Service Co" && there.ifu_url === "https://example.com/ifu.pdf");
    check("8. the VeritaMap link and the other lab's document are dropped, with a note", there.map_instrument_id === null && there.ifu_document_id === null && /VeritaMap® analyzer link \(Made-up centrifuge\)/.test(there.move_note) && /IFU document link/.test(there.move_note), there.move_note);
    const bHist = (await call("GET", `${LB}/equipment/${there.id}/events`, undefined, B.token)).body as any[];
    check("8. the history is there, marked where it came from, corrections and files included", bHist.length === hist.length + 1 && bHist.every((h) => h.carried_from_lab_id === A.labId && h.carried_from_lab_name === "Equip Lab a") && bHist.some((h) => h.earlier_versions.length === 2) && bHist.some((h) => h.files.length === 1) && bHist.some((h) => h.event_type === "stain_log" && /Eosin: C/.test(h.notes)), JSON.stringify(bHist.map((h) => [h.event_type, h.files.length, h.earlier_versions.length])));
    check("8. the lab that made it keeps its own rows, unchanged", JSON.stringify(sqlite.prepare("SELECT * FROM equipment_maintenance_events WHERE equipment_id = ? ORDER BY id").all(E2)) === aEventsBefore);
    const bFile = sqlite.prepare("SELECT * FROM equipment_files WHERE equipment_id = ? AND event_id IS NULL AND removed_at IS NULL").get(there.id) as any;
    const bDl = await fetch(`${base}${LB}/equipment/${there.id}/files/${bFile.id}`, { headers: { Authorization: `Bearer ${B.token}` } });
    check("8. a file that went along downloads there", bDl.status === 200 && Buffer.from(await bDl.arrayBuffer()).equals(PDF.bytes));
    check("8. carried history is read-only there", (await call("POST", `${LB}/equipment/${there.id}/events/${bHist[0].id}/correct`, { reason: "x", notes: "y" }, B.token)).body.code === "CARRIED_READ_ONLY" && (await call("POST", `${LB}/equipment/${there.id}/events/${bHist[0].id}/void`, { reason: "x" }, B.token)).body.code === "CARRIED_READ_ONLY"
      && (await sendFile(`${LB}/equipment/${there.id}/events/${bHist[0].id}/files`, B.token, PDF)).body.code === "CARRIED_READ_ONLY");
    check("8. the record left here is read-only", (await call("PUT", `${L}/equipment/${E2}`, { location: "x" }, editor.token)).body.code === "MOVED_AWAY" && (await call("POST", `${L}/equipment/${E2}/restore`, {}, editor.token)).body.code === "MOVED_AWAY" && (await call("POST", M, { to_lab_id: B.labId, reason: "x" }, editor.token)).body.code === "MOVED_AWAY"
      && (await call("POST", `${evBase}/${again.body.event_id}/correct`, { reason: "x" }, editor.token)).body.code === "MOVED_AWAY" && (await sendFile(F, editor.token, PDF)).body.code === "MOVED_AWAY");
    check("8. it still reads here", (await call("GET", `${L}/equipment/${E2}/record`, undefined, A.token)).status === 200 && (await call("GET", `${L}/equipment?retired=1`, undefined, A.token)).body.some((e: any) => e.id === E2 && e.moved_to_lab_name === "Equip Lab b"));
    const out8 = auditRows("equipment", E2).find((r) => r.action === "transfer_out"), in8 = auditRows("equipment", there.id).find((r) => r.action === "transfer_in");
    check("8. both labs have an audit row", !!out8 && out8.owner_user_id === A.userId && JSON.parse(out8.after_json).lab_id === A.labId && !!in8 && in8.owner_user_id === B.userId && JSON.parse(in8.after_json).lab_id === B.labId && JSON.parse(in8.after_json).reason === "Consolidating the core lab");
    const openB = sqlite.prepare("SELECT * FROM equipment_downtime WHERE equipment_id = ? AND down_until IS NULL").all(there.id) as any[];
    check("8. an open out of service period ended here and goes on there", !sqlite.prepare("SELECT 1 FROM equipment_downtime WHERE equipment_id = ? AND down_until IS NULL").get(E2) && openB.length === 1 && openB[0].lab_id === B.labId && openB[0].carried_from_lab_id === null);
    check("8. new work is logged there as that lab's own", (await call("POST", `${LB}/equipment/${there.id}/events`, { event_type: "function_check", event_date: "2026-11-23" }, B.token)).status === 200);
    check("8. the first lab can't read the new record, nor log on it", (await call("GET", `${L}/equipment/${there.id}/events`, undefined, A.token)).status === 404 && [403, 404].includes((await call("POST", `${LB}/equipment/${there.id}/events`, { event_type: "repair", event_date: "2026-11-23" }, A.token)).status));
    const bMonths = (await call("GET", `${LB}/maintain-reviews?month=2026-10`, undefined, B.token)).body.items as any[];
    check("8. a month from before the move isn't reviewed again there", !bMonths.some((i) => i.type === "equipment" && i.id === there.id));

    // ── 9. Refusals ──
    const refused = async (who: { token: string }, label: string, allowEvent: boolean, lab = L) => {
      const id = E3;
      const tries: [string, string, any][] = [
        ["POST", `${lab}/equipment`, { instrument_name: "x" }], ["PUT", `${lab}/equipment/${id}`, { location: "x" }], ["DELETE", `${lab}/equipment/${id}`, undefined],
        ["POST", `${lab}/equipment/${id}/retire`, { reason: "x" }], ["POST", `${lab}/equipment/${id}/restore`, {}], ["POST", `${lab}/equipment/${id}/move`, { to_lab_id: B.labId, reason: "x" }],
        ["POST", `${lab}/equipment/${id}/downtime`, { reason: "x" }], ["PUT", `${lab}/equipment-settings`, { require_vendor_report: false }],
        ["POST", `${lab}/equipment/${id}/events/${notPm.body.event_id}/correct`, { reason: "x" }], ["POST", `${lab}/equipment/${id}/events/${notPm.body.event_id}/void`, { reason: "x" }],
        ["POST", `${lab}/equipment/${id}/files/1/remove`, { reason: "x" }], ["GET", `${lab}/equipment/${id}/move-targets`, undefined], ["PUT", `${lab}/equipment/reminder-config`, { enabled: true }],
      ];
      const bad: string[] = [];
      for (const [m, p, b] of tries) { const r = await call(m, p, b, who.token); if (![401, 403, 404].includes(r.status)) bad.push(`${m} ${p} ${r.status}`); }
      const rf2 = await sendFile(`${lab}/equipment/${id}/files`, who.token, PDF); if (![403, 404].includes(rf2.status)) bad.push(`record file ${rf2.status}`);
      const ef = await sendFile(`${lab}/equipment/${id}/events/${notPm.body.event_id}/files`, who.token, PDF); if (![403, 404].includes(ef.status)) bad.push(`event file ${ef.status}`);
      const le = await call("POST", `${lab}/equipment/${id}/events`, { event_type: "function_check", event_date: "2026-11-23" }, who.token);
      if (allowEvent ? le.status !== 200 : ![403, 404].includes(le.status)) bad.push(`log event ${le.status}`);
      check(`9. ${label}`, bad.length === 0, bad.join("; "));
    };
    const snapshot = () => JSON.stringify([sqlite.prepare("SELECT * FROM lab_equipment WHERE id = ?").get(E3), sqlite.prepare("SELECT COUNT(*) AS n FROM equipment_files").get(), sqlite.prepare("SELECT * FROM maintain_settings ORDER BY id").all()]);
    const before9 = snapshot();
    await refused(staff, "a limited Staff login logs an event and nothing else", true);
    await refused(viewer, "a view-only seat can log an event as today, and nothing else", true);
    await refused(X, "another customer is refused everything", false);
    const reads = ["equipment", "equipment?retired=1", "equipment-settings", `equipment/${E3}/record`, `equipment/${E3}/events`, `equipment/${E2}/ifu-document`, `equipment/${E2}/files/${rf.body.id}`];
    const leak: string[] = [];
    for (const p of reads) { const r = await call("GET", `${L}/${p}`, undefined, X.token); if (![403, 404].includes(r.status)) leak.push(`${p} ${r.status}`); }
    for (const p of reads.slice(3)) { const r = await call("GET", `/api/labs/${X.labId}/${p}`, undefined, X.token); if (r.status !== 404) leak.push(`own lab path ${p} ${r.status}`); }
    check("9. another customer reads nothing, by this lab's path or by its own with these ids", leak.length === 0, leak.join("; "));
    const support = await mkLab("support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support.userId);
    const sup: string[] = [];
    for (const [m, p, b] of [
      ["POST", `${L}/equipment/${E3}/events`, { event_type: "repair", event_date: "2026-11-23" }], ["POST", `${L}/equipment/${E3}/events/${notPm.body.event_id}/correct`, { reason: "x" }],
      ["POST", `${L}/equipment/${E3}/events/${notPm.body.event_id}/void`, { reason: "x" }], ["POST", `${L}/equipment/${E3}/retire`, { reason: "x" }], ["POST", `${L}/equipment/${E3}/restore`, {}],
      ["POST", `${L}/equipment/${E3}/move`, { to_lab_id: B.labId, reason: "x" }], ["POST", `${L}/equipment/${E3}/downtime`, { reason: "x" }], ["POST", `${L}/equipment/${E3}/downtime/1/end`, {}],
      ["PUT", `${L}/equipment/${E3}/downtime/1`, { correction_reason: "x" }], ["POST", `${L}/equipment/${E3}/files/1/remove`, { reason: "x" }],
    ] as [string, string, any][]) { const r = await call(m, p, b, support.token); if (r.body.code !== "VLS_SUPPORT_CANNOT_SIGN") sup.push(`${m} ${p} ${r.status}`); }
    const supFile = await sendFile(`${L}/equipment/${E3}/events/${notPm.body.event_id}/files`, support.token, PDF, "vendor_report");
    if (supFile.body.code !== "VLS_SUPPORT_CANNOT_SIGN") sup.push(`event file ${supFile.status}`);
    check("9. Veritas support can't log, correct, void, attach to an entry, retire, restore, move or take it out of service", sup.length === 0, sup.join("; "));
    check("9. ... but may set up a record, and its audit row says who it was", (await call("PUT", `${L}/equipment/${E3}`, { vendor_name: "Set up by support" }, support.token)).status === 200 && auditRows("equipment", E3).some((r) => r.acting_as === "vls_support"));
    sqlite.prepare("UPDATE lab_equipment SET vendor_name = NULL, updated_at = ? WHERE id = ?").run(JSON.parse(before9)[0].updated_at, E3);
    check("9. none of those refusals changed anything", snapshot() === before9, `${snapshot()} vs ${before9}`);
    const staffHist = JSON.stringify((await call("GET", `${L}/equipment/${E3}/events`, undefined, staff.token)).body) + JSON.stringify((await call("GET", `${L}/equipment?retired=1`, undefined, staff.token)).body) + JSON.stringify((await call("GET", `${L}/equipment/${E3}/record`, undefined, staff.token)).body);
    check("9. a limited Staff login doesn't read a coworker's sign-in name", !/Edie Editor|Owner a/.test(staffHist), staffHist.match(/.{40}(Edie Editor|Owner a).{20}/)?.[0]);
    sqlite.prepare("UPDATE labs SET subscription_expires_at = '2026-06-01T00:00:00.000Z' WHERE id = ?").run(A.labId);
    check("9. a lab in read-only can't log or retire", (await ev(E3, { event_type: "repair", event_date: "2026-11-23" })).body.code === "SUBSCRIPTION_EXPIRED_READ_ONLY" && (await call("POST", `${L}/equipment/${E3}/retire`, { reason: "x" }, A.token)).body.code === "SUBSCRIPTION_EXPIRED_READ_ONLY");
    sqlite.prepare("UPDATE labs SET subscription_expires_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(A.labId);

    // ── 10. Review, report, trail, VeritaMap IFU ──
    const review = (await call("GET", `${L}/maintain-reviews?month=2026-11`, undefined, A.token)).body.items as any[];
    const i4 = review.find((i) => i.type === "equipment" && i.id === E4), i2 = review.find((i) => i.type === "equipment" && i.id === E2), i3 = review.find((i) => i.type === "equipment" && i.id === E3);
    check("10. the review counts standing entries, the files on them and the corrections", /files attached/.test(i4.notes.join("; ")) && /1 corrected entry/.test(i2.notes.join("; ")) && /1 voided entry/.test(i3.notes.join("; ")), JSON.stringify([i4.notes, i2.notes, i3.notes]));
    check("10. ... and the time out of service", /Out of service/.test(i2.notes.join("; ")), JSON.stringify(i2.notes));
    const waiting10 = await ev(E4, { event_type: "preventive_maintenance", event_date: "2026-11-23", by_vendor: true });
    check("10. a vendor PM waiting for its report is called out", /1 vendor PM waiting for the vendor report/.test(((await call("GET", `${L}/maintain-reviews?month=2026-11`, undefined, A.token)).body.items as any[]).find((i) => i.id === E4 && i.type === "equipment").notes.join("; ")) && waiting10.status === 200);
    const readBook = async (token: string) => {
      const r = await fetch(`${base}${L}/maintain-reviews/report.xlsx?month=2026-11`, { headers: { Authorization: `Bearer ${token}` } });
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await r.arrayBuffer()));
      const rows: string[] = []; wb.eachSheet((ws: any) => ws.eachRow((row: any) => rows.push(`${ws.name}|${(row.values as any[]).slice(1).map((v) => v ?? "").join("|")}`)));
      return { wb, rows };
    };
    const book = await readBook(A.token);
    check("10. the workbook has the entry's vendor, cost, files, who logged it and the correction", book.rows.some((r) => r.startsWith("Equipment Entries|Made-up centrifuge|2026-11-09|Repair") && /Made-up Service Co, R\. Made-up\|1300/.test(r) && /Stan Stafford/.test(r) && /Wrong day/.test(r)) && book.rows.some((r) => /Vendor report: made-up-report\.pdf/.test(r)), book.rows.filter((r) => /centrifuge/.test(r)).join("\n"));
    check("10. ... and the out of service periods", book.rows.some((r) => r.startsWith("Out of Service|Made-up centrifuge|2026-11-01 08:00|2026-11-03 11:30")), book.rows.filter((r) => /Out of Service/.test(r)).join("\n"));
    check("10. ... and a corrected entry's earlier versions aren't counted as entries", book.rows.filter((r) => r.startsWith("Equipment Entries|Made-up centrifuge|") && /\|Repair\|Vendor tech/.test(r)).length === 1);
    check("10. a limited Staff login's workbook leaves coworkers' sign-in names out", !/Edie Editor/.test((await readBook(staff.token)).rows.filter((r) => r.startsWith("Equipment Entries")).join("\n")));
    const trailEq = await mk({ instrument_name: "Made-up trail analyzer", map_instrument_id: menuId });
    const te = await ev(trailEq, { event_type: "calibration", event_date: "2026-11-18", notes: "first" });
    await call("POST", `${L}/equipment/${trailEq}/events/${te.body.event_id}/correct`, { reason: "Typo", notes: "second" }, editor.token);
    await call("POST", `${L}/equipment/${trailEq}/downtime`, { down_from: "2026-11-18T09:00", reason: "Calibration failure" }, editor.token);
    const trail = (await call("GET", `${L}/instruments/${menuId}/trail`, undefined, A.token)).body;
    check("10. the analyzer trail shows the standing entry, that it was corrected, and the out of service period", trail.maintenance.filter((m: any) => m.equipment_id === trailEq).length === 1 && trail.maintenance.find((m: any) => m.equipment_id === trailEq).notes === "second" && trail.maintenance.find((m: any) => m.equipment_id === trailEq).correction_reason === "Typo" && trail.downtime.some((d: any) => d.equipment_id === trailEq && d.reason === "Calibration failure"), JSON.stringify(trail.maintenance));
    const it = Number(sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, 'Sodium', 'Routine Chemistry', 'MODERATE', 1)").run(menuId, mapId).lastInsertRowid);
    const IFU = `${L}/veritamap/maps/${mapId}/tests/${it}/ifu`;
    check("10. the VeritaMap IFU link: an editor sets it, others are refused", (await call("PUT", IFU, { ifuUrl: "https://example.com/na.pdf" }, editor.token)).body.ifu_url === "https://example.com/na.pdf" && (await call("PUT", IFU, { ifuUrl: "" }, staff.token)).status === 403 && (await call("PUT", IFU, { ifuUrl: "" }, viewer.token)).status === 403 && [403, 404].includes((await call("PUT", IFU, { ifuUrl: "" }, X.token)).status));

    // ── 11. Export-all and the purge ──
    const TABLES = ["equipment_files", "equipment_downtime", "maintain_settings"];
    check("11. every table is classified for the export and has a purge rule", unclassifiedTables(sqlite).length === 0 && unruledTables(sqlite).length === 0 && TABLES.every((t) => !!EXPORT_TABLES[t] && purgeRule(t)?.kind === "delete"), [...unclassifiedTables(sqlite), ...unruledTables(sqlite)].join(", "));
    const rowsFor = (t: string, lab: number) => selectRecords(sqlite, t, exportContext(sqlite, lab)!)!.rows as any[];
    check("11. the export takes this lab's rows and no other lab's", [...TABLES, "lab_equipment", "equipment_maintenance_events"].every((t) => { const r = rowsFor(t, A.labId); return r.length > 0 && r.every((x) => x.lab_id === A.labId); }) && rowsFor("equipment_files", X.labId).length === 0);
    const start = await call("POST", `${L}/export-all`, {}, A.token);
    let ready: any = null;
    for (let i = 0; i < 240 && !ready; i++) {
      const st = await call("GET", `${L}/export-all`, undefined, A.token);
      if (st.body.job?.status === "running") { await new Promise((r) => setTimeout(r, 500)); continue; }
      ready = st.body.ready?.[0] ?? { none: true };
    }
    const tok = ready?.id ? await call("POST", `${L}/export-all/${ready.id}/download-token`, {}, A.token) : null;
    const zip = tok ? await JSZip.loadAsync(Buffer.from(await (await fetch(base + tok.body.url)).arrayBuffer())) : null;
    const zname = zip ? Object.keys(zip.files).find((n) => n.startsWith("Files/VeritaMaintain/equipment_files/") && n.endsWith("made-up-report.pdf")) : null;
    check("11. the zip holds the files' bytes and the records", !!zname && (await zip.file(zname!)!.async("nodebuffer")).equals(PDF.bytes) && !!zip.file("Records/JSON/equipment_downtime.json"), `${start.status} ${JSON.stringify(ready)}`);
    const bBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM equipment_files WHERE lab_id = ?").get(B.labId) as any;
    sqlite.prepare("UPDATE labs SET organization_id = NULL WHERE id IN (?, ?)").run(A.labId, B.labId);
    const plan = planCustomerPurge(sqlite, { ownerUserId: A.userId }) as any;
    const inPlan = plan.plan?.rowsByTable ?? {};
    check("11. the purge plan takes every new table's rows of this customer", TABLES.every((t) => inPlan[t] === (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id = ?`).get(A.labId) as any).n && inPlan[t] > 0), JSON.stringify({ code: plan.code, t: TABLES.map((t) => inPlan[t]) }));
    if (plan.plan) applyCustomerPurge(sqlite, plan.plan, plan.internal);
    check("11. ... and applying it leaves none, and the lab it moved to keeps its copy", TABLES.every((t) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id = ?`).get(A.labId) as any).n === 0) && (sqlite.prepare("SELECT COUNT(*) AS n FROM equipment_files WHERE lab_id = ?").get(B.labId) as any).n === bBefore.n && bBefore.n > 0);
    void labLocalDate;
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
