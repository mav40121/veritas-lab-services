// tests/integration/continuous-backup-watchdog.test.ts
//
// Receipt for the continuous-backup watchdog (Michael Q17, 2026-10-27, "once an hour"; server/continuousBackupWatchdog.ts).
// Boots the REAL routes on a scratch DB; R2 listing, email and the clock are stand-ins. Proves:
//   1. continuous backup off -> SKIP, nothing recorded, no email
//   2. a new file in the replica's level-0 folder after the probe -> OK, recorded; it lists the generation-2 folder and
//      the probe row is written
//   3. no new file -> BEHIND, recorded, ONE email; a second BEHIND within 6 hours sends no second email; after 6 hours
//      it emails again
//   4. shipping again -> OK and a recovery email; the next OK sends nothing
//   5. R2 listing fails -> BEHIND with the error in the notes (an alarm, not a silent pass)
//   6. retention: shipping rows older than 90 days and watchdog probes older than 30 days are pruned; restore rows kept
//   7. GET /api/admin/continuous-backup/watchdog: 403 without the admin header; with it, the history newest first
// Run (from bash): DB_PATH=.tmp-cbw.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/continuous-backup-watchdog.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { runShippingCheck, _resetAlertStateForTests } = await import("../../server/continuousBackupWatchdog");
  const { continuousBackupReplicaPath } = await import("../../server/continuousBackup");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json());
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  let clock = new Date("2026-10-27T15:00:00.000Z");
  let enabled = true;
  let newest: Date | null = null;
  let listError: string | null = null;
  const listed: string[] = [];
  const mails: string[] = [];
  const deps = {
    newestUnder: async (prefix: string) => { listed.push(prefix); if (listError) throw new Error(listError); return newest ? { key: `${prefix}0000000000000abc.ltx`, lastModified: newest } : null; },
    alert: async (subject: string) => { mails.push(subject); return true; },
    sleep: async () => { clock = new Date(clock.getTime() + 30000); },
    now: () => clock,
    status: () => ({ enabled, reason: enabled ? "" : "not production", generation: 2 }),
  };
  const count = (kind: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM continuous_backup_checks WHERE kind = ?").get(kind) as any).n;
  _resetAlertStateForTests();

  enabled = false;
  const r1 = await runShippingCheck(sqlite, deps as any, 30000);
  check("1. continuous backup off -> SKIP, nothing recorded, no email", r1.verdict === "SKIP" && count("shipping") === 0 && mails.length === 0, JSON.stringify(r1));
  enabled = true;

  const probesBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM continuous_backup_probe WHERE note = 'hourly watchdog'").get() as any).n;
  newest = new Date(clock.getTime() + 1500); // uploaded 1.5 s after the probe
  const r2 = await runShippingCheck(sqlite, deps as any, 30000);
  const probesAfter = (sqlite.prepare("SELECT COUNT(*) AS n FROM continuous_backup_probe WHERE note = 'hourly watchdog'").get() as any).n;
  check("2a. a file uploaded after the probe -> OK, recorded, no email", r2.verdict === "OK" && count("shipping") === 1 && mails.length === 0, JSON.stringify(r2));
  check("2b. it lists the generation-2 level-0 folder and writes a probe row", listed[listed.length - 1] === `${continuousBackupReplicaPath(process.env, 2)}/0000/` && probesAfter === probesBefore + 1, `${listed[listed.length - 1]} probes ${probesBefore}->${probesAfter}`);

  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  newest = new Date(clock.getTime() - 50 * 60 * 1000); // nothing new for 50 minutes
  const r3 = await runShippingCheck(sqlite, deps as any, 30000);
  check("3a. no new file -> BEHIND, recorded, one email", r3.verdict === "BEHIND" && mails.length === 1 && /behind/i.test(mails[0]) && (r3.lagSeconds ?? 0) >= 50 * 60, JSON.stringify({ v: r3.verdict, lag: r3.lagSeconds, mails }));
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  await runShippingCheck(sqlite, deps as any, 30000);
  check("3b. still behind an hour later -> no second email within 6 hours", mails.length === 1, JSON.stringify(mails));
  clock = new Date(clock.getTime() + 6 * 60 * 60 * 1000);
  await runShippingCheck(sqlite, deps as any, 30000);
  check("3c. still behind 6+ hours after the first email -> it emails again", mails.length === 2, JSON.stringify(mails));

  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  newest = new Date(clock.getTime() + 1000);
  const r4 = await runShippingCheck(sqlite, deps as any, 30000);
  check("4a. shipping again -> OK and a recovery email", r4.verdict === "OK" && mails.length === 3 && /recovered/i.test(mails[2]), JSON.stringify(mails));
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  newest = new Date(clock.getTime() + 1000);
  await runShippingCheck(sqlite, deps as any, 30000);
  check("4b. the next OK sends nothing", mails.length === 3, JSON.stringify(mails));

  listError = "R2 unreachable";
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  const r5 = await runShippingCheck(sqlite, deps as any, 30000);
  check("5. R2 listing fails -> BEHIND with the error noted, and an email", r5.verdict === "BEHIND" && r5.notes.some((n) => /R2 unreachable/.test(n)) && mails.length === 4, JSON.stringify(r5));
  listError = null;

  const old = new Date(clock.getTime() - 100 * 24 * 60 * 60 * 1000).toISOString();
  sqlite.prepare("INSERT INTO continuous_backup_checks (kind, verdict, checked_at, details_json) VALUES ('shipping', 'OK', ?, '{}'), ('restore', 'PASS', ?, '{}')").run(old, old);
  sqlite.prepare("INSERT INTO continuous_backup_probe (written_at, note) VALUES (?, 'hourly watchdog'), (?, 'restore self-test')").run(old, old);
  clock = new Date(clock.getTime() + 60 * 60 * 1000);
  newest = new Date(clock.getTime() + 1000);
  await runShippingCheck(sqlite, deps as any, 30000);
  const oldShip = (sqlite.prepare("SELECT COUNT(*) AS n FROM continuous_backup_checks WHERE kind = 'shipping' AND checked_at = ?").get(old) as any).n;
  const oldRestore = (sqlite.prepare("SELECT COUNT(*) AS n FROM continuous_backup_checks WHERE kind = 'restore' AND checked_at = ?").get(old) as any).n;
  const oldProbes = sqlite.prepare("SELECT note FROM continuous_backup_probe WHERE written_at = ?").all(old).map((r: any) => r.note);
  check("6. retention: old shipping rows and old watchdog probes pruned; restore rows and restore-test probes kept",
    oldShip === 0 && oldRestore === 1 && JSON.stringify(oldProbes) === JSON.stringify(["restore self-test"]), JSON.stringify({ oldShip, oldRestore, oldProbes }));

  const no = await fetch(`${base}/api/admin/continuous-backup/watchdog`);
  const yes = await fetch(`${base}/api/admin/continuous-backup/watchdog?limit=5`, { headers: { "x-admin-secret": ADMIN } });
  const j: any = await yes.json();
  check("7. watchdog route: 403 without the admin header; history newest first with a summary",
    no.status === 403 && yes.status === 200 && j.checks?.length === 5 && j.checks[0].id > j.checks[1].id && Array.isArray(j.summary) && j.checks[0].details?.verdict === "OK",
    JSON.stringify({ no: no.status, yes: yes.status, n: j.checks?.length, first: j.checks?.[0]?.verdict, summary: j.summary }));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
