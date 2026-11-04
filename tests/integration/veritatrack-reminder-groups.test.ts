// tests/integration/veritatrack-reminder-groups.test.ts
//
// STANDING integration test for a lab's groups and VeritaTrack group reminders, Michael 2026-11-04: "build a group (leads,
// supervisors, etc.) and set the email reminder to everyone assigned to that group."
//   1. A lab owner builds a group and adds a roster person with a login, a roster person with no login (typed address), and
//      someone not on the roster. A duplicate name, a dash, a bad address and a repeat member are refused. A staff member
//      cannot change groups or see who is in one; another lab cannot see or touch them.
//   2. A task saves with its group, keeps it when an edit leaves it out, clears it on request, and refuses another lab's
//      group or a retired one. The lab-prefixed create also keeps the owner's email (it used to drop it).
//   3. What goes out: a task's group gets that task, a group on the lab's list gets every task, each person gets one email,
//      and nobody gets a task twice. Owner-only keeps the owner and adds the group.
//   4. Nothing is silently dropped: someone who leaves the roster stops getting email, and a task whose group is retired or
//      reaches nobody falls back to the lab's list. A lab with no groups gets the same email it always did.
//   5. A send Resend refuses is counted as a failure and the tasks are not logged as reminded.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Nothing is mailed: the run is handed a stand-in
// for Resend. Run: npm run test:veritatrack-reminder-groups

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
  const PW = ["Grp", "rem", "7x!"].join("-");
  const register = async (tag: string) => {
    const email = `it-vtgrp-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `IT Group ${tag}`, hipaa_acknowledged: true });
    return { email, userId: Number(reg.body?.user?.id) };
  };
  const login = async (u: { email: string; userId: number }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.userId);
    return (await call("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const makeLab = async (u: { email: string }, clia: string) => {
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: u.email, labName: "placeholder", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET clia_number = ?, lab_name = ? WHERE id = ?").run(clia, `IT Lab ${labId}`, labId);
    return labId;
  };
  const addEmployee = (labId: number, ownerId: number, first: string, last: string, loginUserId: number | null = null) => {
    const now = new Date().toISOString();
    let staffLab = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
    if (!staffLab) {
      staffLab = { id: Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(ownerId, "IT Lab", `22D${labId}`, labId, now, now).lastInsertRowid) };
    }
    return Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, login_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)"
    ).run(staffLab.id, labId, ownerId, last, first, loginUserId, now, now).lastInsertRowid);
  };
  // Runs the reminders with a stand-in for Resend and answers who got which tasks. The log is cleared first so each run
  // decides fresh. A task nobody has signed off counts as overdue, so every run below has something to send.
  const runFor = async (labId: number, answer: () => any = () => ({ data: { id: "stub" } })) => {
    sqlite.prepare("DELETE FROM veritatrack_reminder_log WHERE lab_id = ?").run(labId);
    const sent: { to: string[]; text: string; subject: string }[] = [];
    const summary = await runVeritaTrackReminders({ send: async (msg) => { sent.push({ to: msg.to, text: msg.text, subject: msg.subject }); return answer(); } });
    const mine = sent.filter((m) => m.text.includes(`reminder for IT Lab ${labId}.`));
    const tasksFor = (email: string) => mine.filter((m) => m.to.map((t) => t.toLowerCase()).includes(email.toLowerCase())).map((m) => m.text);
    return { summary, mine, tasksFor };
  };
  const hasTask = (texts: string[], name: string) => texts.some((t) => t.includes(`- ${name}`));
  const countTask = (texts: string[], name: string) => texts.filter((t) => t.includes(`- ${name}`)).length;

  const owner = await register("owner");
  const staffUser = await register("staff");
  const otherOwner = await register("other");
  const labId = await makeLab(owner, "22D7780001");
  const otherLab = await makeLab(otherOwner, "22D7780002");
  const nowIso = new Date().toISOString();
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(labId, staffUser.userId, nowIso, nowIso, nowIso);
  sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, staffUser.userId);
  const token = await login(owner);
  const staffToken = await login(staffUser);
  const otherToken = await login(otherOwner);
  const G = `/api/labs/${labId}/veritatrack/groups`;
  const T = `/api/labs/${labId}/veritatrack/tasks`;
  const C = `/api/labs/${labId}/veritatrack/reminder-config`;

  // ── 1. Building a group ──
  const leadLogin = await register("lead");
  const empWithLogin = addEmployee(labId, owner.userId, "Lena", "Lead", leadLogin.userId);
  const empNoLogin = addEmployee(labId, owner.userId, "Sam", "Sup");
  const empLeaves = addEmployee(labId, owner.userId, "Dana", "Departing");
  const empOtherLab = addEmployee(otherLab, otherOwner.userId, "Other", "Person");

  const empty = await call("GET", G, undefined, token, labId);
  check("a lab starts with no groups and the owner may edit", empty.status === 200 && empty.body.groups.length === 0 && empty.body.can_edit === true, `HTTP ${empty.status}`);
  check("the roster picker lists the lab's people", empty.body.roster.length === 3, `${empty.body.roster?.length}`);
  check("the picker shows the login's address", empty.body.roster.find((p: any) => p.id === empWithLogin)?.email === leadLogin.email);
  check("the picker shows no address for someone with no login", empty.body.roster.find((p: any) => p.id === empNoLogin)?.email === null);

  const made = await call("POST", G, { name: "  Super   visors " }, token, labId);
  check("the owner adds a group; spaces are cleaned", made.status === 200 && made.body.groups[0]?.name === "Super visors", `HTTP ${made.status}`);
  const groupId = made.body.groups[0].id;
  const renamed = await call("PUT", `${G}/${groupId}`, { name: "Supervisors" }, token, labId);
  check("the owner renames it", renamed.body.groups[0]?.name === "Supervisors");
  check("a duplicate name is refused", (await call("POST", G, { name: "supervisors" }, token, labId)).status === 400);
  check("a blank name is refused", (await call("POST", G, { name: "   " }, token, labId)).status === 400);
  check("a long dash is refused", (await call("POST", G, { name: "Leads — day" }, token, labId)).status === 400);
  const leadsMade = await call("POST", G, { name: "Leads" }, token, labId);
  const leadsId = leadsMade.body.groups.find((g: any) => g.name === "Leads").id;

  const M = `${G}/${groupId}/members`;
  const addLogin = await call("POST", M, { employee_id: empWithLogin }, token, labId);
  const lead = addLogin.body.groups?.find((g: any) => g.id === groupId)?.members?.[0];
  check("a roster person with a login takes their login's address", addLogin.status === 200 && lead?.email === leadLogin.email, lead?.email);
  check("the same person cannot be added twice", (await call("POST", M, { employee_id: empWithLogin }, token, labId)).status === 400);
  check("someone from another lab's roster is refused", (await call("POST", M, { employee_id: empOtherLab }, token, labId)).status === 400);
  check("a bad address is refused", (await call("POST", M, { email: "not-an-address" }, token, labId)).status === 400);
  check("an empty add is refused", (await call("POST", M, {}, token, labId)).status === 400);

  const addNoLogin = await call("POST", M, { employee_id: empNoLogin }, token, labId);
  const samRow = addNoLogin.body.groups.find((g: any) => g.id === groupId).members.find((m: any) => m.employee_id === empNoLogin);
  check("a roster person with no login can be added with no address yet", addNoLogin.status === 200 && samRow?.email === null);
  check("a bad typed address is refused", (await call("PUT", `${M}/${samRow.id}`, { email: "nope" }, token, labId)).status === 400);
  const samEmail = `sam-sup-${Date.now()}@example.com`;
  const typed = await call("PUT", `${M}/${samRow.id}`, { email: samEmail }, token, labId);
  check("the lab types the address", typed.body.groups.find((g: any) => g.id === groupId).members.find((m: any) => m.id === samRow.id)?.email === samEmail);
  const leadsWithSam = await call("POST", `${G}/${leadsId}/members`, { employee_id: empNoLogin }, token, labId);
  check("that address carries to the person's next group", leadsWithSam.body.groups.find((g: any) => g.id === leadsId).members[0]?.email === samEmail);

  const outsiderEmail = `outside-${Date.now()}@example.com`;
  const addOutside = await call("POST", M, { email: outsiderEmail, name: "Olly Outside" }, token, labId);
  check("someone not on the roster joins by address", addOutside.status === 200);
  check("the same address cannot be added twice", (await call("POST", M, { email: outsiderEmail.toUpperCase() }, token, labId)).status === 400);
  const departEmail = `dana-${Date.now()}@example.com`;
  await call("POST", M, { employee_id: empLeaves, email: departEmail }, token, labId);
  const full = await call("GET", G, undefined, token, labId);
  check("the group shows four people", full.body.groups.find((g: any) => g.id === groupId).member_count === 4, `${full.body.groups.find((g: any) => g.id === groupId).member_count}`);

  const staffRead = await call("GET", G, undefined, staffToken, labId);
  check("a staff member can read group names for the task form", staffRead.status === 200 && staffRead.body.groups.length === 2 && staffRead.body.can_edit === false, `HTTP ${staffRead.status}`);
  check("a staff member does not see who is in a group", staffRead.body.groups.every((g: any) => g.members === undefined) && staffRead.body.roster.length === 0);
  check("a staff member cannot add a group", (await call("POST", G, { name: "Nope" }, staffToken, labId)).status === 403);
  check("a staff member cannot change who is in one", (await call("POST", M, { email: "x@example.com" }, staffToken, labId)).status === 403);
  // With an edit seat the module gate lets the staff member through, so only the owner/admin rule stands in the way.
  sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
     VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`
  ).run(owner.userId, staffUser.email, staffUser.userId, nowIso, nowIso, `it-vtgrp-${Date.now()}`, labId);
  const seatAdd = await call("POST", G, { name: "Seat Group" }, staffToken, labId);
  check("an edit seat still cannot change groups", seatAdd.status === 403 && /owner or admin/.test(seatAdd.body?.error || ""), `HTTP ${seatAdd.status}`);
  const seatTask = await call("POST", T, { name: "Seat task", category: "Other", frequency: "Monthly", reminder_group_id: groupId }, staffToken, labId);
  check("an edit seat can pick a group on a task", seatTask.status === 200 && seatTask.body.reminder_group_id === groupId, `HTTP ${seatTask.status}`);
  await call("DELETE", `/api/veritatrack/tasks/${seatTask.body.id}`, undefined, token, labId); // out of the way of the counts below
  check("another lab's owner cannot read this lab's groups", [403, 404].includes((await call("GET", G, undefined, otherToken, labId)).status));
  check("another lab's owner cannot change them", [403, 404].includes((await call("PUT", `${G}/${groupId}`, { retired: true }, otherToken, labId)).status));
  const otherGroupMade = await call("POST", `/api/labs/${otherLab}/veritatrack/groups`, { name: "Other lab group" }, otherToken, otherLab);
  const otherGroupId = otherGroupMade.body.groups[0].id;
  check("this lab cannot reach another lab's group through its own path", (await call("PUT", `${G}/${otherGroupId}`, { name: "Taken" }, token, labId)).status === 404);

  // ── 2. Tasks ──
  const ownerMail = `task-owner-${Date.now()}@example.com`;
  const groupTask = await call("POST", T, { name: "Group task", category: "Other", frequency: "Monthly", reminder_group_id: groupId, owner: "Task Owner", owner_email: ownerMail }, token, labId);
  check("a task saves with its group", groupTask.status === 200 && groupTask.body.reminder_group_id === groupId, `HTTP ${groupTask.status}`);
  check("the lab-prefixed create keeps the owner's email", groupTask.body.owner_email === ownerMail, groupTask.body.owner_email);
  const plainTask = await call("POST", T, { name: "Plain task", category: "Other", frequency: "Monthly" }, token, labId);
  check("a task with no group saves with none", plainTask.body.reminder_group_id === null);
  check("another lab's group is refused on a new task", (await call("POST", T, { name: "Bad", category: "Other", reminder_group_id: otherGroupId }, token, labId)).status === 400);
  const taskPut = `/api/veritatrack/tasks/${groupTask.body.id}`;
  const base_ = { name: "Group task", category: "Other", frequency: "Monthly" };
  const keptEdit = await call("PUT", taskPut, base_, token, labId);
  check("an edit that leaves the group out keeps it", keptEdit.body.reminder_group_id === groupId);
  check("another lab's group is refused on an edit", (await call("PUT", taskPut, { ...base_, reminder_group_id: otherGroupId }, token, labId)).status === 400);
  const cleared = await call("PUT", taskPut, { ...base_, reminder_group_id: null }, token, labId);
  check("an edit can clear it", cleared.body.reminder_group_id === null);
  const set = await call("PUT", taskPut, { ...base_, reminder_group_id: groupId }, token, labId);
  check("an edit can set it", set.body.reminder_group_id === groupId);
  const audit = await call("GET", `${taskPut}/audit`, undefined, token, labId);
  const auditText = JSON.stringify(audit.body);
  check("the task's history shows the group changes", auditText.includes("Reminder group set to Supervisors") && auditText.includes("Reminder group removed"));

  // ── 3. What goes out ──
  const listMail = `list-${Date.now()}@example.com`;
  const cfgPut = (body: any) => call("PUT", C, { enabled: true, lead_days: 14, overdue_cadence_days: 2, ...body }, token, labId);
  const cfg = await cfgPut({ recipients: [{ email: listMail }], owner_only: false });
  check("the settings save", cfg.status === 200 && cfg.body.enabled === true, `HTTP ${cfg.status}`);

  let run = await runFor(labId);
  check("the lab's list gets every task", hasTask(run.tasksFor(listMail), "Group task") && hasTask(run.tasksFor(listMail), "Plain task"));
  check("a group member gets the group's task", hasTask(run.tasksFor(samEmail), "Group task"));
  check("every member with an address gets it", hasTask(run.tasksFor(leadLogin.email), "Group task") && hasTask(run.tasksFor(outsiderEmail), "Group task") && hasTask(run.tasksFor(departEmail), "Group task"));
  check("a group member does not get another task", !hasTask(run.tasksFor(samEmail), "Plain task"));
  check("each person gets one email", run.tasksFor(listMail).length === 1 && run.tasksFor(samEmail).length === 1, `${run.tasksFor(listMail).length}/${run.tasksFor(samEmail).length}`);
  check("the email names the group", run.tasksFor(samEmail)[0]?.includes("Group: Supervisors"));

  const both = await cfgPut({ recipients: [{ email: samEmail }], owner_only: false });
  check("the settings still answer", both.status === 200);
  run = await runFor(labId);
  check("someone on the list and in the group gets one email with both tasks", run.tasksFor(samEmail).length === 1 && countTask(run.tasksFor(samEmail), "Group task") === 1 && hasTask(run.tasksFor(samEmail), "Plain task"), `${run.tasksFor(samEmail).length}`);

  const listed = await cfgPut({ recipients: [], recipient_group_ids: [leadsId, otherGroupId, 999999], owner_only: false });
  check("only this lab's groups save onto the list", JSON.stringify(listed.body.recipient_group_ids) === JSON.stringify([leadsId]), JSON.stringify(listed.body.recipient_group_ids));
  run = await runFor(labId);
  check("a group on the list gets every task", hasTask(run.tasksFor(samEmail), "Plain task") && hasTask(run.tasksFor(samEmail), "Group task"));
  check("the lab owner is not the fallback when a listed group reaches someone", run.tasksFor(owner.email).length === 0);
  const untouched = await call("PUT", C, { enabled: true, lead_days: 14, overdue_cadence_days: 2, recipients: [{ email: listMail }], owner_only: false }, token, labId);
  check("a save that does not mention groups keeps them", JSON.stringify(untouched.body.recipient_group_ids) === JSON.stringify([leadsId]));
  await cfgPut({ recipients: [{ email: listMail }], recipient_group_ids: [], owner_only: true });
  run = await runFor(labId);
  check("owner-only: the owner gets their task", hasTask(run.tasksFor(ownerMail), "Group task"));
  check("owner-only: the group still gets the task", hasTask(run.tasksFor(samEmail), "Group task"));
  check("owner-only: the list gets only what reaches nobody else", hasTask(run.tasksFor(listMail), "Plain task") && !hasTask(run.tasksFor(listMail), "Group task"));

  // ── 4. Nothing silently dropped ──
  sqlite.prepare("UPDATE staff_employees SET status = 'terminated' WHERE id = ?").run(empLeaves);
  run = await runFor(labId);
  check("someone who left the roster stops getting email", run.tasksFor(departEmail).length === 0);
  check("the rest of the group still does", hasTask(run.tasksFor(samEmail), "Group task"));
  const afterLeave = await call("GET", G, undefined, token, labId);
  const group = afterLeave.body.groups.find((g: any) => g.id === groupId);
  check("the screen marks them as no longer active and stops counting them", group.member_count === 3 && group.members.find((m: any) => m.employee_id === empLeaves)?.inactive === true, `${group.member_count}`);
  const leftRow = group.members.find((m: any) => m.employee_id === empLeaves);
  const removed = await call("DELETE", `${M}/${leftRow.id}`, undefined, token, labId);
  check("the owner takes them out", removed.status === 200 && !removed.body.groups.find((g: any) => g.id === groupId).members.some((m: any) => m.id === leftRow.id));
  check("that person cannot be taken out twice", (await call("DELETE", `${M}/${leftRow.id}`, undefined, token, labId)).status === 404);

  await call("PUT", taskPut, { ...base_, owner_email: "" }, token, labId);
  const retired = await call("PUT", `${G}/${groupId}`, { retired: true }, token, labId);
  check("the owner retires the group", retired.body.groups.find((g: any) => g.id === groupId).retired === true);
  run = await runFor(labId);
  check("a retired group's members stop getting its task", !hasTask(run.tasksFor(samEmail), "Group task"));
  check("its task falls back to the lab's list", hasTask(run.tasksFor(listMail), "Group task"));
  check("a task keeps a group retired after it was set", (await call("PUT", taskPut, { ...base_, reminder_group_id: groupId }, token, labId)).status === 200);
  check("a retired group is refused for a new task", (await call("POST", T, { name: "Late", category: "Other", reminder_group_id: groupId }, token, labId)).status === 400);
  const restored = await call("POST", G, { name: "supervisors" }, token, labId);
  check("adding the retired name again brings it back", restored.body.groups.find((g: any) => g.id === groupId)?.retired === false);

  const emptyGroupMade = await call("POST", G, { name: "Nobody yet" }, token, labId);
  const emptyGroupId = emptyGroupMade.body.groups.find((g: any) => g.name === "Nobody yet").id;
  await call("PUT", taskPut, { ...base_, reminder_group_id: emptyGroupId }, token, labId);
  run = await runFor(labId);
  check("a task whose group reaches nobody falls back to the lab's list", hasTask(run.tasksFor(listMail), "Group task"));

  // A lab with no groups: the one email it always got.
  const plainOwner = await register("plain");
  const plainLab = await makeLab(plainOwner, "22D7780003");
  const plainToken = await login(plainOwner);
  const plainMail = `plain-${Date.now()}@example.com`;
  for (const n of ["A task", "B task"]) {
    await call("POST", `/api/labs/${plainLab}/veritatrack/tasks`, { name: n, category: "Other", frequency: "Monthly" }, plainToken, plainLab);
  }
  await call("PUT",`/api/labs/${plainLab}/veritatrack/reminder-config`, { enabled: true, lead_days: 14, overdue_cadence_days: 2, recipients: [{ email: plainMail }] }, plainToken, plainLab);
  const plainRun = await runFor(plainLab);
  check("a lab with no groups gets one email with all its tasks", plainRun.mine.length === 1 && hasTask(plainRun.mine.map((m) => m.text), "A task") && hasTask(plainRun.mine.map((m) => m.text), "B task"), `${plainRun.mine.length}`);
  check("no group line appears in it", !plainRun.mine[0]?.text.includes("Group:"));

  // ── 5. A refused send ── (the plain lab alone is switched on, so its errors are the only errors)
  sqlite.prepare("UPDATE veritatrack_reminder_config SET enabled = 0 WHERE lab_id <> ?").run(plainLab);
  const refusedRun = await runFor(plainLab, () => ({ error: { message: "rate limited" } }));
  check("a send Resend refuses counts as an error", refusedRun.summary.errors > 0);
  const logged = sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_reminder_log WHERE lab_id = ?").get(plainLab) as any;
  check("those tasks are not logged as reminded", Number(logged.n) === 0, `${logged.n}`);
  const goodRun = await runFor(plainLab);
  const loggedGood = sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_reminder_log WHERE lab_id = ?").get(plainLab) as any;
  check("a send Resend accepts is logged", goodRun.mine.length === 1 && Number(loggedGood.n) === 2, `${loggedGood.n}`);

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
