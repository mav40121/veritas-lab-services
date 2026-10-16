// tests/integration/continuous-backup.test.ts
//
// Continuous backup (Litestream, 2026-10-16; server/continuousBackup.ts). Pins:
//   1. when it runs: production with the R2 settings; CONTINUOUS_BACKUP=0 turns it off; =1 turns it on outside
//      production; a missing R2 setting is named
//   2. each Railway service replicates to its own folder (main app: litestream/veritas.db; VeritaStock under veritastock/)
//   3. the config file Litestream reads holds no credential values (only ${VAR} references) and caps the WAL at ~50 MB
//   4. live round trip (only when LITESTREAM_BIN and the BACKUP_S3_* settings are present; skipped in CI): the database
//      switches to WAL, Litestream replicates to R2 under a throwaway folder, a change made 5 s before a restore is in
//      the restored copy, integrity_check = ok, a killed Litestream is restarted, and shutdown stops it. The throwaway
//      folder is deleted afterwards.
// Run: npm run test:continuous-backup

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import {
  continuousBackupPlan, continuousBackupReplicaPath, litestreamConfig, startContinuousBackup, stopContinuousBackup,
  continuousBackupStatus, continuousRestoreSelfTest,
} from "../../server/continuousBackup";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const r2 = { BACKUP_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", BACKUP_S3_BUCKET: "b", BACKUP_S3_ACCESS_KEY_ID: "k", BACKUP_S3_SECRET_ACCESS_KEY: "s" };

// Deletes the throwaway replica folder from R2 after a live run.
async function deleteR2Folder(prefix: string) {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const c = new S3Client({ region: "auto", endpoint: process.env.BACKUP_S3_ENDPOINT, credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID!, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY! } });
  let removed = 0;
  for (let token: string | undefined, i = 0; i < 20; i++) {
    const page: any = await c.send(new ListObjectsV2Command({ Bucket: process.env.BACKUP_S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents || []).map((o: any) => ({ Key: o.Key }));
    if (keys.length) { await c.send(new DeleteObjectsCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Delete: { Objects: keys } })); removed += keys.length; }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    if (!token) break;
  }
  const left = await c.send(new ListObjectsV2Command({ Bucket: process.env.BACKUP_S3_BUCKET, Prefix: prefix }));
  check("4f. the throwaway R2 folder is deleted", (left.KeyCount ?? 0) === 0, `${removed} objects removed`);
}

async function main() {
  // 1) when it runs
  check("1a. production with the R2 settings: on", continuousBackupPlan({ NODE_ENV: "production", ...r2 }).enabled);
  check("1b. CONTINUOUS_BACKUP=0 turns it off", !continuousBackupPlan({ NODE_ENV: "production", CONTINUOUS_BACKUP: "0", ...r2 }).enabled);
  check("1c. off outside production unless CONTINUOUS_BACKUP=1", !continuousBackupPlan({ ...r2 }).enabled && continuousBackupPlan({ CONTINUOUS_BACKUP: "1", ...r2 }).enabled);
  const miss = continuousBackupPlan({ NODE_ENV: "production", ...r2, BACKUP_S3_BUCKET: "" });
  check("1d. a missing R2 setting turns it off and is named", !miss.enabled && miss.reason.includes("BACKUP_S3_BUCKET"), miss.reason);

  // 2) one replica folder per Railway service
  const main = continuousBackupReplicaPath({ RAILWAY_SERVICE_NAME: "radiant-quietude" });
  const stock = continuousBackupReplicaPath({ RAILWAY_SERVICE_NAME: "VeritaStock" });
  check("2. the main app and VeritaStock replicate to different folders", main === "litestream/veritas.db" && stock === "veritastock/litestream/veritas.db", `${main} | ${stock}`);

  // 3) config
  const cfg = litestreamConfig("/data/veritas.db", main);
  check("3a. the config names credentials only as ${VAR}", cfg.includes("access-key-id: ${BACKUP_S3_ACCESS_KEY_ID}") && cfg.includes("secret-access-key: ${BACKUP_S3_SECRET_ACCESS_KEY}") && !/access-key-id: [^$]/.test(cfg));
  check("3b. the emergency WAL limit is ~50 MB, not the ~500 MB default (the volume is 500 MB)", /truncate-page-n: 12500\b/.test(cfg));
  check("3c. point-in-time restore window 72 h, a full snapshot every 6 h", cfg.includes("interval: 6h") && cfg.includes("retention: 72h"));

  const fileCfg = litestreamConfig("/data/veritas.db", main, "/tmp/replica");
  check("3d. the local folder replica (tests only) carries no credentials", fileCfg.includes("type: file") && !fileCfg.includes("access-key-id") && !fileCfg.includes("type: s3"));

  // 4) live round trip: R2 when its settings are present (local), else a local folder replica (CI, Linux)
  const fileReplica = String(process.env.LITESTREAM_FILE_REPLICA || "").trim();
  const hasR2 = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].every((k) => process.env[k]);
  const live = !!process.env.LITESTREAM_BIN && (hasR2 || !!fileReplica);
  if (!live) {
    console.log("SKIP  4. live round trip (needs LITESTREAM_BIN and either the BACKUP_S3_* settings or LITESTREAM_FILE_REPLICA)");
  } else {
    console.log(`INFO  4. round trip against ${fileReplica ? `a local folder replica (${fileReplica})` : "R2"}`);
    const tag = `litestream-test-${Date.now()}`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-test-"));
    const dbPath = path.join(dir, "veritas.db");
    const sqlite = new Database(dbPath);
    sqlite.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); CREATE TABLE studies (id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE continuous_backup_probe (id INTEGER PRIMARY KEY AUTOINCREMENT, written_at TEXT NOT NULL, note TEXT)");
    const ins = sqlite.prepare("INSERT INTO studies (name) VALUES (?)");
    for (let i = 0; i < 500; i++) ins.run(`study ${i}`);
    sqlite.prepare("INSERT INTO users (email) VALUES (?)").run("it@example.com");
    const env = { ...process.env, CONTINUOUS_BACKUP: "1", RAILWAY_SERVICE_NAME: tag };
    try {
      const st = startContinuousBackup(sqlite, env);
      check("4a. it starts, switches the database to WAL and replicates under a throwaway folder", st.enabled && String(sqlite.pragma("journal_mode", { simple: true })) === "wal" && st.replicaPath === `${tag}/litestream/veritas.db`, `${st.reason} ${st.replicaPath} v${st.version}`);
      await new Promise((r) => setTimeout(r, 8000)); // first snapshot
      for (let i = 0; i < 200; i++) ins.run(`later ${i}`);
      const t = await continuousRestoreSelfTest(sqlite, 5000);
      check("4b. a change made 5 s before the restore is in the restored copy; integrity ok", t.verdict === "PASS" && t.probeFound === true && t.integrityCheck === "ok", JSON.stringify({ v: t.verdict, probe: t.probeFound, ic: t.integrityCheck, restoreMs: t.restoreMs, notes: t.notes }));
      check("4c. the restored copy has every row (700 studies)", t.restored?.studyCount === 700 && t.live?.studyCount === 700, `${t.restored?.studyCount} / ${t.live?.studyCount}`);
      const pid = continuousBackupStatus().pid;
      try { process.kill(pid!, "SIGKILL"); } catch {}
      let back = false;
      for (let i = 0; i < 40 && !back; i++) { await new Promise((r) => setTimeout(r, 500)); const s = continuousBackupStatus(); back = s.running && s.pid !== pid && s.restarts >= 1; }
      check("4d. a killed Litestream is restarted", back, JSON.stringify({ old: pid, now: continuousBackupStatus().pid, restarts: continuousBackupStatus().restarts }));
      await stopContinuousBackup();
      check("4e. shutdown stops it", !continuousBackupStatus().running);
    } catch (e: any) {
      console.error(e);
      failures++;
    } finally {
      await stopContinuousBackup();
      sqlite.close();
      if (fileReplica) {
        fs.rmSync(path.join(fileReplica, tag), { recursive: true, force: true });
        check("4f. the throwaway replica folder is deleted", !fs.existsSync(path.join(fileReplica, tag)));
      } else {
        await deleteR2Folder(`${tag}/`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main();
