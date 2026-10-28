// tests/integration/veritatrack-categories-weekly.test.ts
//
// STANDING integration test for VeritaTrack per-lab categories (#110) and the Weekly frequency (#111), Michael
// 2026-10-26:
//   1. A lab owner sees the built-in categories, adds a lab category, and cannot add a duplicate, a built-in name, a
//      blank name or one with a long dash. A staff member cannot change categories; another lab cannot see or edit it.
//   2. A task saves with the lab category and refuses a category the lab does not have.
//   3. Weekly: stored as 0 months / 7 days; next due is the sign-off day + 7; due soon inside 2 days; overdue after.
//   4. Rename moves the lab's tasks (with an audit row on each); retire keeps the tasks but stops new use; adding the
//      retired name again brings it back.
//   5. Reminders: a weekly task due in 3 days gets no reminder (the ladder would have sent one), a weekly task due
//      tomorrow gets the day-before reminder, and a monthly task due in 3 days still gets its ladder reminder.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritatrack-categories-weekly

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { labLocalDate, addLabDays } from "../../server/dateLocal";
import { runVeritaTrackReminders } from "../../server/veritatrackReminders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY; // the reminder run counts what it would send; nothing is mailed
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
  const PW = ["Vt", "wk", "7x!"].join("-");
  const register = async (tag: string) => {
    const email = `it-vtcat-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `IT VT ${tag}`, hipaa_acknowledged: true });
    return { email, userId: Number(reg.body?.user?.id) };
  };
  const login = async (u: { email: string; userId: number }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.userId);
    return (await call("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const mkLab = async (tag: string, clia: string) => {
    const u = await register(tag);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: u.email, labName: `IT VT Lab ${tag}`, plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(clia, labId); // Massachusetts (22D): Eastern
    return { labId, userId: u.userId, token: await login(u) };
  };

  try {
    const a = await mkLab("a", "22D7770001");
    const b = await mkLab("b", "22D7770002");
    check("0. labs made", a.labId > 0 && b.labId > 0 && !!a.token && !!b.token);
    const today = labLocalDate(new Date().toISOString(), false, "America/New_York");
    const cats = (l: any) => call("GET", `/api/labs/${l.labId}/veritatrack/categories`, undefined, l.token, l.labId);
    const addCat = (l: any, name: unknown) => call("POST", `/api/labs/${l.labId}/veritatrack/categories`, { name }, l.token, l.labId);

    // 1. Categories
    const c0 = await cats(a);
    check("1a. the built-in categories are listed and the owner can edit", c0.status === 200 && c0.body.defaults.length === 13 && c0.body.defaults.includes("QC Review") && c0.body.custom.length === 0 && c0.body.can_edit === true, JSON.stringify(c0.body).slice(0, 160));
    const added = await addCat(a, "  Safety   Inspections ");
    check("1b. the owner adds a lab category (spaces tidied)", added.status === 200 && added.body.custom.some((c: any) => c.name === "Safety Inspections") && added.body.active.includes("Safety Inspections"), JSON.stringify(added.body.custom));
    const dup = await addCat(a, "safety inspections");
    const builtIn = await addCat(a, "qc review");
    const blank = await addCat(a, "   ");
    const dash = await addCat(a, "Safety \u2014 Fire");
    check("1c. a duplicate, a built-in name, a blank name and a long dash are refused", dup.status === 400 && builtIn.status === 400 && blank.status === 400 && dash.status === 400, [dup.body.error, builtIn.body.error, blank.body.error, dash.body.error].join(" | "));
    const otherLab = await cats(b);
    check("1d. another lab does not see it", otherLab.status === 200 && otherLab.body.custom.length === 0 && !otherLab.body.active.includes("Safety Inspections"));
    const catId = added.body.custom.find((c: any) => c.name === "Safety Inspections").id;
    const crossEdit = await call("PUT", `/api/labs/${b.labId}/veritatrack/categories/${catId}`, { name: "Hijacked" }, b.token, b.labId);
    check("1e. another lab cannot edit it", crossEdit.status === 404 && (sqlite.prepare("SELECT name FROM veritatrack_categories WHERE id = ?").get(catId) as any).name === "Safety Inspections", String(crossEdit.status));
    const staffU = await register("staff");
    const nowIso = new Date().toISOString();
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(a.labId, staffU.userId, nowIso, nowIso, nowIso);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(a.labId, staffU.userId);
    const staffToken = await login(staffU);
    const staffAdd = await call("POST", `/api/labs/${a.labId}/veritatrack/categories`, { name: "Staff Category" }, staffToken, a.labId);
    check("1f. a staff member cannot change categories", staffAdd.status === 403 && !sqlite.prepare("SELECT 1 FROM veritatrack_categories WHERE name = 'Staff Category'").get(), `${staffAdd.status} ${staffAdd.body?.error ?? ""}`);
    // With an edit seat the module gate lets the staff member through, so only the owner/admin rule stands in the way.
    sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
       VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`
    ).run(a.userId, staffU.email, staffU.userId, nowIso, nowIso, `it-vtcat-${Date.now()}`, a.labId);
    const seatAdd = await call("POST", `/api/labs/${a.labId}/veritatrack/categories`, { name: "Staff Category" }, staffToken, a.labId);
    const seatTask = await call("POST", `/api/labs/${a.labId}/veritatrack/tasks`, { name: "Staff task", category: "Other", frequency: "Monthly" }, staffToken, a.labId);
    check("1g. a staff member with an edit seat still cannot change categories (but can add tasks)", seatAdd.status === 403 && /owner or admin/.test(seatAdd.body?.error || "") && seatTask.status === 200, `${seatAdd.status} ${seatAdd.body?.error ?? ""} / task ${seatTask.status}`);
    const adminU = await register("admin");
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'admin','active',1,?,?,?)").run(a.labId, adminU.userId, nowIso, nowIso, nowIso);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(a.labId, adminU.userId);
    const adminToken = await login(adminU);
    const adminCats = await call("GET", `/api/labs/${a.labId}/veritatrack/categories`, undefined, adminToken, a.labId);
    const adminAdd = await call("POST", `/api/labs/${a.labId}/veritatrack/categories`, { name: "Admin Category" }, adminToken, a.labId);
    check("1h. a lab admin can change categories", adminCats.body?.can_edit === true && adminAdd.status === 200, `${adminAdd.status} ${adminAdd.body?.error ?? ""}`);
    const adminCatId = adminAdd.body?.custom?.find((c: any) => c.name === "Admin Category")?.id;
    if (adminCatId) sqlite.prepare("DELETE FROM veritatrack_categories WHERE id = ?").run(adminCatId); // keep the counts below simple

    // 2. Tasks with categories
    const mkTask = (l: any, body: any) => call("POST", `/api/labs/${l.labId}/veritatrack/tasks`, body, l.token, l.labId);
    const weekly = await mkTask(a, { name: "Eyewash flush", category: "Safety Inspections", frequency: "Weekly" });
    check("2a. a task saves with the lab category", weekly.status === 200 && weekly.body.category === "Safety Inspections", JSON.stringify(weekly.body).slice(0, 160));
    const bogus = await mkTask(a, { name: "Bogus", category: "Not A Category", frequency: "Monthly" });
    const foreign = await mkTask(b, { name: "Foreign", category: "Safety Inspections", frequency: "Monthly" });
    check("2b. an unknown category is refused, and so is another lab's", bogus.status === 400 && foreign.status === 400, `${bogus.body.error} | ${foreign.body.error}`);
    const builtinTask = await mkTask(a, { name: "QC review - Chemistry", category: "QC Review", frequency: "Monthly" });
    check("2c. a built-in category still works", builtinTask.status === 200);

    // 3. Weekly
    check("3a. Weekly is stored as 0 months and 7 days", weekly.body.frequency === "Weekly" && weekly.body.frequency_months === 0 && weekly.body.frequency_days === 7, JSON.stringify({ m: weekly.body.frequency_months, d: weekly.body.frequency_days }));
    const signoff = (l: any, id: number, date: string) => call("POST", `/api/veritatrack/tasks/${id}/signoff`, { completed_date: date, initials: "IT" }, l.token, l.labId);
    const taskRow = async (l: any, id: number) => ((await call("GET", `/api/labs/${l.labId}/veritatrack/tasks`, undefined, l.token, l.labId)).body as any[]).find((t) => t.id === id);
    await signoff(a, weekly.body.id, today);
    let t = await taskRow(a, weekly.body.id);
    check("3b. signed today: next due is today + 7, current", t?.next_due === addLabDays(today, 7) && t?.status === "current", JSON.stringify({ due: t?.next_due, s: t?.status }));
    await signoff(a, weekly.body.id, addLabDays(today, -6)); // older sign-off: the latest still wins
    t = await taskRow(a, weekly.body.id);
    check("3c. the latest sign-off still drives the due date", t?.next_due === addLabDays(today, 7));
    const w2 = await mkTask(a, { name: "Fridge log review", category: "Safety Inspections", frequency: "Weekly" });
    await signoff(a, w2.body.id, addLabDays(today, -6));
    t = await taskRow(a, w2.body.id);
    check("3d. signed 6 days ago: due tomorrow, due soon", t?.next_due === addLabDays(today, 1) && t?.status === "due_soon", JSON.stringify({ due: t?.next_due, s: t?.status }));
    const w3 = await mkTask(a, { name: "Safety walk", category: "Safety Inspections", frequency: "Weekly" });
    await signoff(a, w3.body.id, addLabDays(today, -4));
    t = await taskRow(a, w3.body.id);
    check("3e. signed 4 days ago: due in 3 days, not yet due soon (window 2)", t?.next_due === addLabDays(today, 3) && t?.status === "current", JSON.stringify({ due: t?.next_due, s: t?.status }));
    const w4 = await mkTask(a, { name: "Shower check", category: "Safety Inspections", frequency: "Weekly" });
    await signoff(a, w4.body.id, addLabDays(today, -8));
    t = await taskRow(a, w4.body.id);
    check("3f. signed 8 days ago: overdue", t?.status === "overdue", JSON.stringify({ due: t?.next_due, s: t?.status }));
    const edited = await call("PUT", `/api/veritatrack/tasks/${builtinTask.body.id}`, { name: "QC review - Chemistry", category: "QC Review", frequency: "Weekly" }, a.token, a.labId);
    const back = await call("PUT", `/api/veritatrack/tasks/${builtinTask.body.id}`, { name: "QC review - Chemistry", category: "QC Review", frequency: "Quarterly" }, a.token, a.labId);
    check("3g. editing a task to Weekly and back sets and clears the day interval", edited.body.frequency_days === 7 && edited.body.frequency_months === 0 && back.body.frequency_days === null && back.body.frequency_months === 3, JSON.stringify([edited.body.frequency_days, back.body.frequency_days, back.body.frequency_months]));
    const board = (await call("GET", `/api/labs/${a.labId}/veritatrack/dashboard`, undefined, a.token, a.labId)).body;
    check("3h. the dashboard counts the overdue weekly task", board.overdue >= 1 && board.overdueItems.some((i: any) => i.id === w4.body.id), JSON.stringify({ overdue: board.overdue }));

    // 4. Rename, retire, restore
    const renamed = await call("PUT", `/api/labs/${a.labId}/veritatrack/categories/${catId}`, { name: "Safety Rounds" }, a.token, a.labId);
    const movedCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_tasks WHERE lab_id = ? AND category = 'Safety Rounds'").get(a.labId) as any).n;
    const leftCount = (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_tasks WHERE lab_id = ? AND category = 'Safety Inspections'").get(a.labId) as any).n;
    check("4a. rename moves the lab's tasks to the new name", renamed.status === 200 && movedCount === 4 && leftCount === 0, `${renamed.status} moved=${movedCount} left=${leftCount}`);
    check("4b. each moved task has an audit row", !!sqlite.prepare("SELECT 1 FROM veritatrack_audit WHERE task_id = ? AND detail LIKE 'Category renamed from Safety Inspections to Safety Rounds%'").get(weekly.body.id));
    const toBuiltIn = await call("PUT", `/api/labs/${a.labId}/veritatrack/categories/${catId}`, { name: "HIPAA" }, a.token, a.labId);
    check("4c. renaming to a built-in name is refused", toBuiltIn.status === 400);
    const retired = await call("PUT", `/api/labs/${a.labId}/veritatrack/categories/${catId}`, { retired: true }, a.token, a.labId);
    check("4d. retire: no longer offered, tasks keep it", retired.status === 200 && !retired.body.active.includes("Safety Rounds") && retired.body.custom.find((c: any) => c.id === catId)?.retired === true && retired.body.custom.find((c: any) => c.id === catId)?.task_count === 4);
    const newOnRetired = await mkTask(a, { name: "New on retired", category: "Safety Rounds", frequency: "Weekly" });
    const keepRetired = await call("PUT", `/api/veritatrack/tasks/${weekly.body.id}`, { name: "Eyewash flush", category: "Safety Rounds", frequency: "Weekly" }, a.token, a.labId);
    const moveToRetired = await call("PUT", `/api/veritatrack/tasks/${builtinTask.body.id}`, { name: "QC review - Chemistry", category: "Safety Rounds", frequency: "Monthly" }, a.token, a.labId);
    check("4e. a new task cannot use a retired category; an existing task keeps it on edit; another task cannot move onto it", newOnRetired.status === 400 && keepRetired.status === 200 && moveToRetired.status === 400, [newOnRetired.status, keepRetired.status, moveToRetired.status].join(","));
    const restored = await addCat(a, "safety rounds");
    check("4f. adding the retired name again brings it back (no duplicate)", restored.status === 200 && restored.body.active.includes("Safety Rounds") && (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_categories WHERE lab_id = ?").get(a.labId) as any).n === 1);
    check("4g. category changes are audited for the lab", ["category_added", "category_renamed", "category_retired", "category_restored"].every((e) => !!sqlite.prepare("SELECT 1 FROM veritatrack_audit WHERE lab_id = ? AND event = ?").get(a.labId, e)));

    // 5. Reminders. Only lab b has reminders on; its tasks are set up here.
    sqlite.prepare("UPDATE veritatrack_reminder_config SET enabled = 0").run();
    const rem = await call("PUT", `/api/labs/${b.labId}/veritatrack/reminder-config`, { enabled: true, lead_days: 14, overdue_cadence_days: 2, recipients: ["it-reminders@example.com"] }, b.token, b.labId);
    const wkIn3 = await mkTask(b, { name: "Weekly in 3", category: "Other", frequency: "Weekly" });
    await signoff(b, wkIn3.body.id, addLabDays(today, -4));
    const wkTomorrow = await mkTask(b, { name: "Weekly tomorrow", category: "Other", frequency: "Weekly" });
    await signoff(b, wkTomorrow.body.id, addLabDays(today, -6));
    // The monthly task must fall due on a ladder day. 3 days out works except near a month end: on 10/28 the target
    // is 10/31, and no September sign-off falls due on 10/31 (9/30 + 1 month = 10/30), so the test failed on those
    // days only. Use the first of 3, 7, 14 days out that a monthly sign-off can land on exactly.
    const moLead = [3, 7, 14].find((k) => { const due = addLabDays(today, k); return addLabDays(addLabDays(due, 0, -1), 0, 1) === due; })!;
    const moIn3 = await mkTask(b, { name: `Monthly in ${moLead}`, category: "Other", frequency: "Monthly" });
    await signoff(b, moIn3.body.id, addLabDays(addLabDays(today, moLead), 0, -1));
    const summary = await runVeritaTrackReminders();
    check(`5a. reminders: weekly due in 3 days is quiet, weekly due tomorrow and monthly due in ${moLead} days are reminded (2 of 3)`, rem.status === 200 && summary.labs === 1 && summary.tasksChecked === 3 && summary.notifiable === 2, JSON.stringify(summary));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
