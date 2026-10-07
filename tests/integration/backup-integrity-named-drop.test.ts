// tests/integration/backup-integrity-named-drop.test.ts
//
// Receipt for parking-lot #70 (2026-10-07). The nightly backup integrity check
// emailed "ANOMALY" on every real-user decrease, with zero tolerance and no name:
// intentional admin deletions (Tywauna 2026-10-05; 54 -> 53 on 2026-10-06) read
// like data loss. Boots the REAL routes + backup module against a throwaway
// SQLite DB (DB_PATH from the runner) and proves:
//   1. first run with no prior row: ok, email snapshot stored
//   2. a real account that vanishes with NO admin-deletion audit row: NOT ok,
//      and the check NAMES it under `unexplained`
//   3. a real account deleted through the REAL admin route
//      (DELETE /api/admin/users/:id?confirm=true, x-admin-secret): ok, NAMED
//      under `explained`; a new account shows under `added`; the audit row
//      survives the user cascade (it is keyed on operator id 0, not the user)
//   4. internal/QA accounts (@veritaslabservices.com) never count
//   5. steady state: nothing dropped or added
//
// Run: npm run test:backup-named-drop (Linux/CI) or, on Windows, from bash:
//   DB_PATH=.tmp-backup-drop.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/backup-integrity-named-drop.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { storage } = await import("../../server/storage");
  const { checkBackupIntegrity } = await import("../../server/backup");
  const { registerRoutes } = await import("../../server/routes");
  const { logAudit } = await import("../../server/audit");
  const sqlite = (db as any).$client;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const mk = (email: string) => storage.createUser(email, "x", "IT user");
  const SIZE = 200_000; // > MIN_BACKUP_FILE_SIZE_BYTES so the file-size check is not the one tripping

  const a = mk("a@example.com"), b = mk("b@example.com"), c = mk("c@example.com");
  mk("qa-churn@veritaslabservices.com"); // internal: must never count

  // 1. baseline
  const u1 = checkBackupIntegrity(SIZE).checks.userCount;
  check("first run: ok with no prior row", u1.ok === true, JSON.stringify(u1));
  check("first run: counts the 3 real accounts only (internal excluded)", u1.value === 3, `value=${u1.value}`);
  const stored = sqlite.prepare("SELECT real_user_emails FROM backup_integrity_log ORDER BY id DESC LIMIT 1").get() as any;
  check("snapshot of real-user emails stored", JSON.parse(stored.real_user_emails || "[]").length === 3, stored.real_user_emails);

  // 2. unexplained disappearance (direct SQL, no audit row)
  sqlite.prepare("DELETE FROM users WHERE id = ?").run(b.id);
  const u2 = checkBackupIntegrity(SIZE).checks.userCount;
  check("unexplained drop: NOT ok", u2.ok === false, JSON.stringify(u2));
  check("unexplained drop: names the account", JSON.stringify(u2.unexplained) === JSON.stringify(["b@example.com"]), JSON.stringify(u2.unexplained));
  check("unexplained drop: nothing explained", (u2.explained || []).length === 0);

  // 3. explained deletion through the REAL admin route + a new signup
  const d = mk("d@example.com");
  const bad = await fetch(`${base}/api/admin/users/${c.id}?confirm=true`, { method: "DELETE", headers: { "x-admin-secret": "wrong" } });
  check("admin delete rejects a wrong secret (403)", bad.status === 403, `status=${bad.status}`);
  const del = await fetch(`${base}/api/admin/users/${c.id}?confirm=true`, { method: "DELETE", headers: { "x-admin-secret": process.env.ADMIN_SECRET || "" } });
  check("admin delete route returns 200", del.status === 200, `status=${del.status} ${await del.text()}`);
  const audit = sqlite.prepare("SELECT user_id, module, action, entity_type, entity_label FROM audit_log WHERE module = 'admin' AND action = 'delete' AND entity_type = 'user'").all() as any[];
  check("audit row written and survives the user cascade (operator id 0)", audit.length === 1 && audit[0].user_id === 0 && audit[0].entity_label === "c@example.com", JSON.stringify(audit));
  const u3 = checkBackupIntegrity(SIZE).checks.userCount;
  check("explained drop: ok (no anomaly)", u3.ok === true, JSON.stringify(u3));
  check("explained drop: names the deleted account under explained", JSON.stringify(u3.explained) === JSON.stringify(["c@example.com"]), JSON.stringify(u3.explained));
  check("explained drop: nothing unexplained", (u3.unexplained || []).length === 0, JSON.stringify(u3.unexplained));
  check("new account listed under added", JSON.stringify(u3.added) === JSON.stringify(["d@example.com"]), JSON.stringify(u3.added));
  check("count reflects a and d only", u3.value === 2, `value=${u3.value}`);

  // 4. steady state
  const u4 = checkBackupIntegrity(SIZE).checks.userCount;
  check("steady state: ok, nothing dropped or added", u4.ok === true && u4.dropped.length === 0 && u4.added.length === 0, JSON.stringify(u4));

  // 5. studyCount (parking lot #73, same class): a decrease is explained by
  //    audited study deletions since the prior run, an unaudited loss is not.
  const now = new Date().toISOString();
  const insStudy = sqlite.prepare(
    `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
     VALUES (?, 'Sodium', 'X', 'qa', '2026-10-07', 'method_comparison', 0.04, 1, '%', '[]', '[]', 'completed', ?)`
  );
  const sIds = [1, 2, 3, 4].map(() => Number(insStudy.run(a.id, now).lastInsertRowid));
  const s0 = checkBackupIntegrity(SIZE).checks.studyCount;
  check("studies baseline: ok", s0.ok === true && s0.value >= 4, JSON.stringify(s0));
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(sIds[0]); // unaudited loss
  const s1 = checkBackupIntegrity(SIZE).checks.studyCount;
  check("unaudited study loss: NOT ok, dropped 1, 0 audited deletes", s1.ok === false && s1.dropped === 1 && s1.auditedDeletesSincePriorRun === 0, JSON.stringify(s1));
  // audited deletions (what DELETE /api/studies/:id and the lab-scoped twin write), then the rows go
  logAudit({ userId: a.id, module: "veritacheck", action: "delete", entityType: "study", entityId: sIds[1], entityLabel: "Sodium - method_comparison (2026-10-07)" });
  logAudit({ userId: a.id, module: "veritacheck", action: "delete", entityType: "study", entityId: sIds[2], entityLabel: "Sodium - method_comparison (2026-10-07)" });
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(sIds[1]);
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(sIds[2]);
  insStudy.run(a.id, now); // and one new study, as happened 10/06 (7 deleted, 5 created)
  const s2 = checkBackupIntegrity(SIZE).checks.studyCount;
  check("audited deletions + a creation: ok (drop covered by audited deletes)", s2.ok === true && s2.dropped === 1 && s2.auditedDeletesSincePriorRun === 2, JSON.stringify(s2));
  // yesterday's audited deletes must not mask a NEW unaudited loss tonight (window = since prior run).
  // Simulate the day gap: those two audit rows predate the prior run (same-second resolution otherwise).
  sqlite.prepare("UPDATE audit_log SET created_at = datetime('now', '-1 day') WHERE entity_type = 'study' AND action = 'delete'").run();
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(sIds[3]);
  const s3 = checkBackupIntegrity(SIZE).checks.studyCount;
  check("fresh unaudited loss after audited ones: NOT ok (prior-run window, no masking)", s3.ok === false && s3.dropped === 1 && s3.auditedDeletesSincePriorRun === 0, JSON.stringify(s3));

  void a; void d;
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
