// tests/integration/policy-auto-expire-nightly.test.ts
//
// BUG-081 (Michael Q45 = 1, 2026-10-27): VeritaPolicy auto-expire was only reachable from an admin route; the nightly
// job ran review reminders only. The nightly job now runs runNightlyPolicyJobs (reminders, then the auto-expire sweep).
// This pins:
//   1. the wiring: server/index.ts schedules runNightlyPolicyJobs, and the old reminders-only call is gone
//   2. the sweep through the nightly entry point: an approved policy more than 60 days past its review date flips to
//      expired with one 'auto_expired' audit row; one 59 days past, a draft, an archived policy and one with no review
//      date stay as they were
//   3. idempotent: a second run flips nothing
// Scratch DB, made-up rows. Run: npm run test:policy-auto-expire-nightly
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { db } from "../../server/db";
import { runNightlyPolicyJobs } from "../../server/veritapolicyReminders";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) wiring
  const index = fs.readFileSync(fileURLToPath(new URL("../../server/index.ts", import.meta.url)), "utf8");
  check("1. index.ts schedules runNightlyPolicyJobs", /runNightlyPolicyJobs\(\)/.test(index));
  check("1b. the reminders-only nightly call is gone", !/runPolicyReviewReminders\(\)\.catch/.test(index));

  // 2) sweep through the nightly entry point
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const day = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const uid = Number(sqlite.prepare(
    "INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Nightly Owner', 'hospital', ?)"
  ).run(`nightly-${Date.now()}@example.com`, now).lastInsertRowid);
  const labId = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, created_at) VALUES ('Nightly Lab', ?, ?)").run(uid, now).lastInsertRowid);
  const ins = sqlite.prepare(
    `INSERT INTO policy_documents (lab_id, title, status, owner_user_id, next_review_date, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const mk = (title: string, status: string, review: string | null, archived: string | null = null) =>
    Number(ins.run(labId, title, status, uid, review, archived, now, now).lastInsertRowid);
  const past61 = mk("Approved, 61 days past review", "approved", day(61));
  const past59 = mk("Approved, 59 days past review", "approved", day(59));
  const draft = mk("Draft, 100 days past review", "draft", day(100));
  const archived = mk("Archived approved, 100 days past review", "approved", day(100), now);
  const noDate = mk("Approved, no review date", "approved", null);

  const first = await runNightlyPolicyJobs();
  const status = (id: number) => (sqlite.prepare("SELECT status FROM policy_documents WHERE id = ?").get(id) as any)?.status;
  const audits = (id: number) => Number((sqlite.prepare(
    "SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'auto_expired'"
  ).get(id) as any).n);
  check("2a. approved, 61 days past review -> expired, one audit row", status(past61) === "expired" && audits(past61) === 1,
    `${status(past61)} audits=${audits(past61)}`);
  check("2b. 59 days past, draft, archived and no-date policies unchanged",
    status(past59) === "approved" && status(draft) === "draft" && status(archived) === "approved" && status(noDate) === "approved"
      && [past59, draft, archived, noDate].every((id) => audits(id) === 0),
    [past59, draft, archived, noDate].map(status).join(","));
  check("2c. the nightly run reports the flip and still runs the reminder pass",
    first.expire.flipped === 1 && first.reminders !== null, JSON.stringify(first));

  // 3) idempotent
  const second = await runNightlyPolicyJobs();
  check("3. a second run flips nothing and adds no audit row", second.expire.flipped === 0 && audits(past61) === 1, JSON.stringify(second.expire));

  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
