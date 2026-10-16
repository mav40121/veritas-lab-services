// scripts/restore-drill.mjs
//
// Timed disaster-recovery drill (Q56 item 2, 2026-10-16). Recovers VeritaAssure from the off-site backups the way we
// would after losing production, and times each step:
//   1. find the newest VeritaAssure copy in R2 (main-app names only: veritas-hourly- / veritas-backup-)
//   2. download it
//   3. unzip it and run PRAGMA integrity_check
//   4. boot the production build on the restored database and wait for /api/health to answer
//   5. compare record counts with live production (read-only admin path)
// The booted app gets NO backup credentials (it cannot upload anything) and no mail or payment keys.
// Run (download step needs the BACKUP_S3_* env, count check needs ADMIN_SECRET):
//   railenv_backup.sh railenv.sh node scripts/restore-drill.mjs <work dir> <path to built dist/index.cjs>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
const Database = require("better-sqlite3");

const [work, distEntry] = process.argv.slice(2);
if (!work || !distEntry) { console.error("usage: restore-drill.mjs <work dir> <dist/index.cjs>"); process.exit(2); }
fs.mkdirSync(work, { recursive: true });
const t0 = Date.now();
const lap = { };
const mark = (k, since) => { lap[k] = ((Date.now() - since) / 1000).toFixed(1); return Date.now(); };
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// 1) newest main-app copy
let t = Date.now();
const s3 = new S3Client({ region: "auto", endpoint: process.env.BACKUP_S3_ENDPOINT, credentials: { accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY } });
const all = [];
for (const prefix of ["veritas-hourly-", "veritas-backup-"]) {
  let token;
  do {
    const p = await s3.send(new ListObjectsV2Command({ Bucket: process.env.BACKUP_S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
    all.push(...(p.Contents || []));
    token = p.IsTruncated ? p.NextContinuationToken : undefined;
  } while (token);
}
// Copies under 5 MB are the VeritaStock service's (BUG-082, before 10/16); never restore one of those.
const newest = all.filter((o) => o.Size >= 5e6).sort((a, b) => b.LastModified - a.LastModified)[0];
t = mark("find", t);
check("1. newest VeritaAssure backup found", !!newest, newest ? `${newest.Key} ${(newest.Size / 1e6).toFixed(1)} MB, taken ${newest.LastModified.toISOString()}` : "none");
if (!newest) process.exit(1);

// 2) download
const gz = path.join(work, "restore.db.gz");
const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BACKUP_S3_BUCKET, Key: newest.Key }));
await pipeline(obj.Body, fs.createWriteStream(gz));
t = mark("download", t);

// 3) unzip + integrity
const dbPath = path.join(work, "restored.db");
for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm"]) fs.rmSync(f, { force: true });
await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(dbPath));
const db = new Database(dbPath, { readonly: true });
const integrity = db.pragma("integrity_check", { simple: true });
const counts = Object.fromEntries(["labs", "users", "studies", "competency_assessment_items", "policy_documents", "qc_results", "inventory_items"].map((tb) => [tb, db.prepare(`SELECT COUNT(*) n FROM "${tb}"`).get().n]));
db.close();
t = mark("unzip_and_check", t);
check("3. restored database passes PRAGMA integrity_check", integrity === "ok", `${integrity}; ${(fs.statSync(dbPath).size / 1e6).toFixed(1)} MB`);

// 4) boot the app on it
const port = 5299;
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "production", PORT: String(port), DB_PATH: dbPath, JWT_SECRET: "restore-drill", ADMIN_SECRET: "restore-drill-admin", STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy", POLICY_STORAGE_ROOT: path.join(work, "policies"), EXPORT_ALL_DIR: path.join(work, "exports") };
const app = spawn(process.execPath, [distEntry], { env, cwd: path.dirname(path.dirname(distEntry)), stdio: ["ignore", "pipe", "pipe"] });
let log = "";
app.stdout.on("data", (d) => { log += d; });
app.stderr.on("data", (d) => { log += d; });
let health = null;
for (let i = 0; i < 240 && !health; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) health = await r.json(); } catch { /* not up yet */ }
}
t = mark("boot_to_healthy", t);
check("4. the app boots on the restored database and answers /api/health", !!health && health.status === "ok", health ? JSON.stringify(health).slice(0, 120) : log.slice(-400));
let restoredLabs = null;
try { const r = await fetch(`http://127.0.0.1:${port}/api/admin/backup-integrity-log?limit=1`, { headers: { "x-admin-secret": "restore-drill-admin" } }); restoredLabs = r.status; } catch { /* ignore */ }
app.kill();

// 5) compare with live production
let live = null;
if (process.env.ADMIN_SECRET) {
  try {
    const r = await fetch("https://www.veritaslabservices.com/api/admin/backup-integrity-log", { headers: { "x-admin-secret": process.env.ADMIN_SECRET } });
    const j = await r.json();
    live = (j.rows || j.log || j)[0] || null;
  } catch { live = null; }
}
const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`restored counts: ${JSON.stringify(counts)}`);
if (live) console.log(`latest production integrity-log row: users ${live.user_count}, studies ${live.study_count}, tables ${live.table_count}, at ${live.run_at}`);
console.log(`TIMES (seconds): find ${lap.find}, download ${lap.download}, unzip+integrity ${lap.unzip_and_check}, boot to healthy ${lap.boot_to_healthy}; TOTAL ${total}`);
console.log(`backup age at restore: ${((Date.now() - newest.LastModified.getTime()) / 60000).toFixed(0)} minutes (data loss if production had failed now)`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
