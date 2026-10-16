// tests/integration/backup-tiers.test.ts
//
// Hourly + nightly off-site backups (2026-10-16, Q47 = 1; server/backup.ts). Pins:
//   1. key names per tier (nightly keeps the original "veritas-backup-" prefix)
//   2. pruning: each tier only its own copies past its retention (hourly 7 days, nightly 730)
//   3. snapshotToGz uses SQLite's online backup: a copy taken WHILE the app writes restores with
//      integrity_check = ok and includes the rows committed before it started
//   4. with no S3 env the job skips instead of throwing
// Run: npm run test:backup-tiers

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { db } from "../../server/db";
import { backupKey, keysToPrune, snapshotToGz, verifyBackupGzFile, runHourlyBackup, TIER_PREFIX, backupScope, backupTempPath } from "../../server/backup";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const when = new Date("2026-10-16T13:30:00.000Z");
  check("1a. hourly key", backupKey("hourly", when) === "veritas-hourly-2026-10-16T13-30-00-000Z.db.gz", backupKey("hourly", when));
  check("1b. nightly key keeps the original prefix", backupKey("nightly", when).startsWith("veritas-backup-") && TIER_PREFIX.nightly === "veritas-backup-");
  // BUG-082: only the main app writes the plain names; any other service (VeritaStock) writes into its own folder.
  check("1c. the main app keeps the plain names", backupScope({ RAILWAY_SERVICE_NAME: "radiant-quietude" }) === "" && backupScope({}) === "", JSON.stringify([backupScope({ RAILWAY_SERVICE_NAME: "radiant-quietude" }), backupScope({})]));
  check("1d. the VeritaStock service writes into its own folder", backupScope({ RAILWAY_SERVICE_NAME: "VeritaStock" }) === "veritastock/", backupScope({ RAILWAY_SERVICE_NAME: "VeritaStock" }));
  check("1e. a scoped copy is never listed or pruned as a main-app copy", !"veritastock/veritas-hourly-x.db.gz".startsWith(TIER_PREFIX.hourly) && keysToPrune("hourly", [{ Key: "veritastock/veritas-hourly-old.db.gz", LastModified: new Date(0) }]).length === 0, "");
  // BUG-082 follow-up: the VeritaStock hourly backup failed with "directory does not exist" because the temp file
  // was named after the scoped key. The temp path must be flat.
  check("1f. a scoped key gives a flat temp file path", backupTempPath("veritastock/veritas-hourly-x.db.gz") === "/tmp/veritastock_veritas-hourly-x.db.gz" && backupTempPath("veritas-hourly-x.db.gz") === "/tmp/veritas-hourly-x.db.gz", backupTempPath("veritastock/veritas-hourly-x.db.gz"));

  const now = Date.parse("2026-10-16T12:00:00Z");
  const day = 24 * 60 * 60 * 1000;
  const objs = [
    { Key: "veritas-hourly-a.db.gz", LastModified: new Date(now - 8 * day) },
    { Key: "veritas-hourly-b.db.gz", LastModified: new Date(now - 6 * day) },
    { Key: "veritas-backup-old.db.gz", LastModified: new Date(now - 731 * day) },
    { Key: "veritas-backup-recent.db.gz", LastModified: new Date(now - 8 * day) },
    { Key: "something-else.txt", LastModified: new Date(now - 900 * day) },
  ];
  check("2a. hourly prunes only hourly copies older than 7 days", JSON.stringify(keysToPrune("hourly", objs, now)) === JSON.stringify(["veritas-hourly-a.db.gz"]), JSON.stringify(keysToPrune("hourly", objs, now)));
  check("2b. nightly prunes only nightly copies older than 730 days; an 8-day nightly copy stays", JSON.stringify(keysToPrune("nightly", objs, now)) === JSON.stringify(["veritas-backup-old.db.gz"]), JSON.stringify(keysToPrune("nightly", objs, now)));
  check("2c. objects of no tier are never pruned", !keysToPrune("hourly", objs, now).concat(keysToPrune("nightly", objs, now)).includes("something-else.txt"));

  const sqlite = (db as any).$client;
  sqlite.exec("CREATE TABLE IF NOT EXISTS backup_probe (id INTEGER PRIMARY KEY, v TEXT)");
  const ins = sqlite.prepare("INSERT INTO backup_probe (v) VALUES (?)");
  for (let i = 0; i < 2000; i++) ins.run("before-" + i + "-" + "x".repeat(200));
  const gz = path.join(os.tmpdir(), `backup-tiers-${Date.now()}.db.gz`);
  // Keep writing while the snapshot runs.
  let writing = true, during = 0;
  const writer = (async () => { while (writing) { ins.run("during"); during++; await new Promise((r) => setImmediate(r)); } })();
  const bytes = await snapshotToGz(sqlite, gz);
  writing = false; await writer;
  const v = await verifyBackupGzFile(gz);
  check("3a. snapshot taken during writes restores with integrity_check ok", v.integrityOk, v.integrityResult);
  const tmp = gz.replace(/\.gz$/, ".check.db");
  const zlib = require("zlib");
  fs.writeFileSync(tmp, zlib.gunzipSync(fs.readFileSync(gz)));
  const Database = require("better-sqlite3");
  const r = new Database(tmp, { readonly: true });
  const before = (r.prepare("SELECT COUNT(*) c FROM backup_probe WHERE v LIKE 'before-%'").get() as any).c;
  r.close();
  check("3b. every row committed before the snapshot is in it", before === 2000, `${before} rows; ${during} writes ran during the snapshot; ${bytes} bytes gzipped`);
  check("3c. no temp snapshot file left behind", !fs.existsSync(`${gz}.snapshot.db`));
  try { fs.unlinkSync(gz); fs.unlinkSync(tmp); } catch {}

  for (const k of ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"]) delete process.env[k];
  let threw = false;
  try { await runHourlyBackup(); } catch { threw = true; }
  check("4. with no S3 env the hourly job skips instead of throwing", !threw);

  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
