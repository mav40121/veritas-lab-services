// tests/integration/reminders-lab-day.test.ts
//
// STANDING integration test (per-lab time zone, 2026-10-27): the reminder jobs that run at midnight UTC count each
// lab's due dates from that lab's own calendar day, not the UTC day (which is already tomorrow for every US lab at
// that hour, so reminders went out a day early and a review due "today" was called overdue the evening before).
//
// Two labs 21 hours apart (Guam, UTC+10, and American Samoa, UTC-11) each get an item due a set number of days after
// THEIR OWN today. A job that counts every lab from one shared day cannot land both on the same reminder step while
// the two labs are on different days (21 hours of 24); counting per lab, both always do.
//   1. VeritaPT submission deadlines: due in 3 days -> approaching-3 for both labs.
//   2. VeritaMaintain equipment: due in 3 days -> approaching-3 for both labs.
//   3. VeritaResponse findings: due in 3 days -> T-3 for both labs.
//   4. VeritaPolicy reviews: due tomorrow -> 30-day warning (not overdue) for both labs.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:reminders-lab-day

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { labLocalDate, addLabDays } from "../../server/dateLocal";
import { runPtReminders } from "../../server/ptReminders";
import { runEquipmentReminders } from "../../server/equipmentReminders";
import { runFindingReminders } from "../../server/audit";
import { runPolicyReviewReminders } from "../../server/veritapolicyReminders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY; // the jobs report what they would send; nothing is mailed
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
  const PW = ["Rm", "ld", "7x!"].join("-");
  const mkLab = async (tag: string, tz: string) => {
    const email = `it-remday-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `IT RD ${tag}`, hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: `IT RD Lab ${tag}`, plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET time_zone = ? WHERE id = ?").run(tz, labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    return { labId, userId, token, today: labLocalDate(new Date().toISOString(), false, tz) };
  };

  try {
    const guam = await mkLab("guam", "Pacific/Guam");
    const samoa = await mkLab("samoa", "Pacific/Pago_Pago");
    const labs = [guam, samoa];
    check("0. labs made", guam.labId > 0 && samoa.labId > 0 && !!guam.token);
    console.log(`      (Guam's day ${guam.today}, Samoa's day ${samoa.today}: ${guam.today === samoa.today ? "the same at this hour, so this run cannot tell the two ways apart" : "different, so a shared day would fail"})`);
    const now = new Date().toISOString();

    // 1. PT
    for (const l of labs) {
      sqlite.prepare("INSERT INTO pt_reminder_config (lab_id, enabled, lead_days, overdue_cadence_days, recipients_json, created_at, updated_at) VALUES (?, 1, 14, 2, ?, ?, ?)").run(l.labId, JSON.stringify([{ email: "it-pt@example.com" }]), now, now);
      sqlite.prepare("INSERT INTO pt_events (enrollment_id, user_id, event_date, analyte, pass_fail, submission_due_date, lab_id, created_at, updated_at) VALUES (0, ?, ?, 'Glucose', 'pending', ?, ?, ?, ?)").run(l.userId, l.today, addLabDays(l.today, 3), l.labId, now, now);
    }
    const pt = await runPtReminders();
    check("1. PT deadlines due in 3 lab days are both reminded (approaching-3)", pt.labs === 2 && pt.eventsChecked === 2 && pt.notifiable === 2, JSON.stringify(pt));

    // 2. Equipment
    for (const l of labs) {
      sqlite.prepare("INSERT INTO equipment_reminder_config (lab_id, enabled, lead_days, overdue_cadence_days, recipients_json, created_at, updated_at) VALUES (?, 1, 14, 2, ?, ?, ?)").run(l.labId, JSON.stringify([{ email: "it-eq@example.com" }]), now, now);
      sqlite.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, status, next_due_date, created_at, updated_at) VALUES (?, 'IT Centrifuge', 'active', ?, ?, ?)").run(l.labId, addLabDays(l.today, 3), now, now);
    }
    const eq = await runEquipmentReminders();
    check("2. equipment due in 3 lab days is reminded in both labs (approaching-3)", eq.labs === 2 && eq.equipmentChecked === 2 && eq.notifiable === 2, JSON.stringify(eq));

    // 3. Findings
    const findingIds: number[] = [];
    for (const l of labs) {
      const f = await call("POST", `/api/labs/${l.labId}/findings`, { accreditor: "CMS", anchor_date: l.today, description: "IT reminder day" }, l.token, l.labId);
      const id = Number(f.body?.id);
      findingIds.push(id);
      sqlite.prepare("UPDATE findings SET due_date = ? WHERE id = ?").run(addLabDays(l.today, 3), id);
    }
    const fr = await runFindingReminders();
    const kinds = findingIds.map((id) => fr.details.find((d: any) => d.findingId === id)?.reminderType);
    check("3. findings due in 3 lab days are both on the T-3 reminder", findingIds.every((id) => id > 0) && kinds.every((k) => k === "T-3"), JSON.stringify(kinds));

    // 4. Policy reviews
    const docIds: number[] = [];
    for (const l of labs) {
      const r = sqlite.prepare("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, created_at, updated_at) VALUES (?, 'IT Review Day', ?, 'approved', ?, ?, ?)").run(l.labId, l.userId, addLabDays(l.today, 1), now, now);
      docIds.push(Number(r.lastInsertRowid));
    }
    await runPolicyReviewReminders();
    const types = docIds.map((id) => (sqlite.prepare("SELECT reminder_type FROM policy_review_reminders WHERE document_id = ?").get(id) as any)?.reminder_type);
    check("4. a review due tomorrow (lab day) is a 30-day warning in both labs, not overdue", types.every((t) => t === "30_day_warning"), JSON.stringify(types));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
