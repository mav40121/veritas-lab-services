// scripts/verify-certificate-reminders.ts
//
// Receipt for BUG-021 (Michael Q62 = 1, 2026-10-10): VeritaLab certificate reminders. Boots the REAL routes on a
// throwaway SQLite DB (no prod data, no real email: a capture mailer stands in for Resend).
//   1. dryRun returns the plan (newest due stage per certificate) and writes nothing.
//   2. A real run sends exactly that: one 3-month notice for a CLIA certificate (its stale 9- and 6-month
//      stages are skipped, not sent) and one expiration notice for an expired agreement (its four older stages
//      skipped); future stages stay queued; an inactive certificate sends nothing.
//   3. The mail goes to the lab owner, names the lab, links the lab's VeritaLab page, says "expired on" for the
//      expired item and "expires on" otherwise, and has no em dash.
//   4. A second run sends nothing (idempotent).
//   5. A failed send stays queued and goes out on the next run.
//   6. A legacy certificate with no lab mails the reminder's user and links /veritalab-app.
// Run (from repo root):
//   DB_PATH=.tmp-verify-certrem.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy node_modules/.bin/tsx scripts/verify-certificate-reminders.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const sqlite = (db as any).$client;
const ADMIN = process.env.ADMIN_SECRET || "localadmin";
let fails = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); if (!ok) fails++; };
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

async function main() {
  const app = express(); app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const run = async (dry: boolean) => (await (await fetch(`${base}/api/veritalab/check-reminders${dry ? "?dryRun=1" : ""}`, { method: "POST", headers: { "x-admin-secret": ADMIN, "Content-Type": "application/json" }, body: "{}" })).json()) as any;

  let mod: any = null;
  try { mod = await import("../server/certificateReminders"); } catch { console.log("NOTE  server/certificateReminders.ts not present (main's code): no capture mailer"); }
  const mails: any[] = [];
  let failNext = false;
  mod?.setCertificateReminderMailerForTest(async (m: any) => { if (failNext) { failNext = false; throw new Error("provider down"); } mails.push(m); });

  const now = new Date().toISOString();
  const owner = storage.createUser("certrem-owner@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Cert Owner") as any;
  const legacy = storage.createUser("certrem-legacy@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Legacy User") as any;
  const lab = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES (?,?,?,?,?)").run("Reminder Test Lab", owner.id, "hospital", now, now).lastInsertRowid);
  const mkCert = (userId: number, labId: number | null, type: string, name: string, exp: string, active = 1) =>
    Number(sqlite.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, cert_number, expiration_date, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(userId, labId, type, name, "03D0000001", exp, active, now, now).lastInsertRowid);
  const stages = (certId: number, userId: number, exp: string) => {
    const e = new Date(exp + "T00:00:00Z");
    const at = (months: number, days = 0) => { const d = new Date(e); d.setUTCMonth(d.getUTCMonth() - months); d.setUTCDate(d.getUTCDate() - days); return d.toISOString().slice(0, 10); };
    for (const [t, d] of [["9month", at(9)], ["6month", at(6)], ["3month", at(3)], ["30day", at(0, 30)], ["expired", exp]] as const)
      sqlite.prepare("INSERT INTO lab_certificate_reminders (certificate_id, user_id, reminder_type, scheduled_date, is_sent) VALUES (?,?,?,?,0)").run(certId, userId, t, d);
  };
  const clia = mkCert(owner.id, lab, "clia", "CLIA Certificate", day(84)); stages(clia, owner.id, day(84));          // 9m, 6m, 3m due; 30d, expired future
  const vendor = mkCert(owner.id, lab, "vendor_agreement", "Vendor Agreement", day(-100)); stages(vendor, owner.id, day(-100)); // all five due
  const future = mkCert(owner.id, lab, "cap", "CAP Accreditation", day(700)); stages(future, owner.id, day(700));    // none due
  const inactive = mkCert(owner.id, lab, "state", "State License", day(-30), 0); stages(inactive, owner.id, day(-30)); // inactive: nothing
  const state = () => sqlite.prepare("SELECT certificate_id, reminder_type, is_sent, skipped_at FROM lab_certificate_reminders").all() as any[];

  // 1. dry run
  const dry = await run(true);
  const plan = (dry.toSend || []).map((x: any) => `${x.certificate_id}:${x.stage}`).sort();
  check("1. dryRun plans exactly the newest due stage per certificate (CLIA 3month, vendor expired)", JSON.stringify(plan) === JSON.stringify([`${clia}:3month`, `${vendor}:expired`].sort()), JSON.stringify(plan));
  check("1. dryRun lists the 6 superseded stages as skipped", (dry.skipped || []).length === 6, String((dry.skipped || []).length));
  check("1. dryRun writes nothing", state().every((r) => r.is_sent === 0 && !r.skipped_at), "");

  // 2 + 3. real run
  const real = await run(false);
  check("2. real run sends 2 emails (not 8)", real.sent === 2 && mails.length === 2, JSON.stringify({ sent: real.sent ?? real.processed, captured: mails.length }));
  const rows = state();
  const by = (c: number, t: string) => rows.find((r) => r.certificate_id === c && r.reminder_type === t);
  check("2. CLIA 9- and 6-month stages are marked skipped, never sent", ["9month", "6month"].every((t) => by(clia, t)?.skipped_at && by(clia, t)?.is_sent === 0));
  check("2. CLIA 30-day and expiration stages stay queued", ["30day", "expired"].every((t) => by(clia, t)?.is_sent === 0 && !by(clia, t)?.skipped_at));
  check("2. inactive and future certificates send nothing", rows.filter((r) => r.certificate_id === inactive || r.certificate_id === future).every((r) => r.is_sent === 0 && !r.skipped_at));
  const m3 = mails.find((m) => /3-Month Reminder/.test(m.subject)), mx = mails.find((m) => /Expiration Notice/.test(m.subject));
  check("3. both go to the lab owner", mails.every((m) => m.to === "certrem-owner@qa.test"), mails.map((m) => m.to).join(","));
  check("3. CLIA notice says 'expires on', subject 'expires'", !!m3 && /expires on/.test(m3.html) && /CLIA Certificate expires \d\d\/\d\d\/\d{4}/.test(m3.subject), m3?.subject);
  check("3. expired item says 'expired on', subject 'expired'", !!mx && /expired on/.test(mx.html) && /Vendor Agreement expired \d\d\/\d\d\/\d{4}/.test(mx.subject), mx?.subject);
  check("3. emails name the lab and link its VeritaLab page", mails.every((m) => m.html.includes("Reminder Test Lab") && m.html.includes(`/labs/${lab}/veritalab-app`)));
  check("3. no em dash in any email", mails.every((m) => !/—/.test(m.subject + m.html)));

  // 4. idempotent
  const again = await run(false);
  check("4. a second run sends nothing", again.sent === 0 && (again.toSend || []).length === 0 && mails.length === 2, JSON.stringify({ sent: again.sent ?? again.processed }));

  // 5. failure stays queued
  const c5 = mkCert(owner.id, lab, "clia", "CLIA Certificate (second lab unit)", day(60)); stages(c5, owner.id, day(60));
  failNext = true;
  const failRun = await run(false);
  const r5 = () => (sqlite.prepare("SELECT reminder_type, is_sent, skipped_at FROM lab_certificate_reminders WHERE certificate_id = ? AND reminder_type = '3month'").get(c5) as any);
  check("5. a failed send is counted and stays queued", failRun.errors === 1 && r5()?.is_sent === 0 && !r5()?.skipped_at, JSON.stringify({ errors: failRun.errors, row: r5() }));
  const retry = await run(false);
  check("5. the next run sends it", retry.sent === 1 && r5()?.is_sent === 1, JSON.stringify({ sent: retry.sent }));

  // 6. legacy certificate (no lab)
  const c6 = mkCert(legacy.id, null, "clia", "Legacy CLIA", day(80)); stages(c6, legacy.id, day(80));
  const before = mails.length;
  await run(false);
  const m6 = mails.slice(before)[0];
  check("6. legacy certificate mails the reminder's user and links /veritalab-app", !!m6 && m6.to === "certrem-legacy@qa.test" && m6.html.includes("https://www.veritaslabservices.com/veritalab-app\""), m6?.to);

  server.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
