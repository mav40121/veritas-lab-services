// tests/integration/policy-reminder-cycles.test.ts
//
// BUG-187 (2026-11-24): a document's review notices went out once per document, ever. After a review the next review date
// moves ahead, but the notice already sent for the earlier date blocked the new one, so the second cycle sent nothing.
// Boots the REAL routes on a scratch DB (no mail key) and proves, on one approved document:
//   1. each notice goes out once for a review date, however many nights the job runs
//   2. a new review date gets its own notices
//   3. a notice already sent for a date stays sent when the date is stored with a time
//
// Run (Windows, from bash): DB_PATH=.tmp-remcycle.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/policy-reminder-cycles.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { addLabDays, labLocalDate } from "../../server/dateLocal";
import { runPolicyReviewReminders } from "../../server/veritapolicyReminders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY; // nothing is mailed; the job records what it would send
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const post = async (p: string, body: unknown) => (await (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as any;
  const email = `it-remcycle-${Date.now()}@example.com`;
  const userId = Number((await post("/api/auth/register", { email, password: ["Rc", "yc", "7x!"].join("-"), name: "IT Cycle", hipaa_acknowledged: true }))?.user?.id);
  const labId = Number((await post("/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Cycle Lab", plan: "hospital" })).labId);
  sqlite.prepare("UPDATE labs SET time_zone = 'America/New_York' WHERE id = ?").run(labId);
  const today = labLocalDate(new Date().toISOString(), false, "America/New_York");
  const now = new Date().toISOString();
  const docId = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, created_at, updated_at) VALUES (?, 'IT Cycle', ?, 'approved', ?, ?, ?)").run(labId, userId, addLabDays(today, 10), now, now).lastInsertRowid);
  const sent = () => (sqlite.prepare("SELECT reminder_type || ' ' || substr(reminder_date, 1, 10) AS k FROM policy_review_reminders WHERE document_id = ? ORDER BY id").all(docId) as any[]).map((r) => r.k);
  const due = (d: string) => sqlite.prepare("UPDATE policy_documents SET next_review_date = ? WHERE id = ?").run(d, docId);
  check("0. setup", userId > 0 && labId > 0 && docId > 0);

  const first = addLabDays(today, 10);
  await runPolicyReviewReminders();
  await runPolicyReviewReminders();
  check("1a the 30-day notice goes out once, though the job ran twice", JSON.stringify(sent()) === JSON.stringify([`30_day_warning ${first}`]), JSON.stringify(sent()));
  due(addLabDays(today, 0));
  await runPolicyReviewReminders();
  await runPolicyReviewReminders();
  check("1b the overdue notice goes out once", sent().filter((k) => k.startsWith("overdue")).length === 1, JSON.stringify(sent()));

  const second = addLabDays(today, 20); // reviewed: the next cycle comes round
  due(second);
  await runPolicyReviewReminders();
  check("2a the next review date gets its own 30-day notice", sent().includes(`30_day_warning ${second}`), JSON.stringify(sent()));
  const before = sent().length;
  await runPolicyReviewReminders();
  check("2b and only one", sent().length === before, String(sent().length));

  due(`${second} 00:00:00`);
  await runPolicyReviewReminders();
  check("3. the same day stored with a time is the same cycle", sent().length === before, JSON.stringify(sent()));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
