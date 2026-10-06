// Verify the restore mechanics (gunzip -> open read-only -> integrity_check ->
// counts) WITHOUT R2: build a tiny SQLite DB, gzip it like the nightly job, and
// run verifyBackupGzFile over it. Proves the core restore path and the real-user
// exclusion. Run: npx tsx scripts/verify-restore-self-test.ts
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import Database from "better-sqlite3";
import { verifyBackupGzFile } from "../server/backup";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-verify-"));
  const dbPath = path.join(dir, "mini.db");
  const gzPath = `${dbPath}.gz`;

  // Minimal DB with the tables the counter reads.
  const d = new Database(dbPath);
  d.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT); CREATE TABLE studies (id INTEGER PRIMARY KEY);");
  d.prepare("INSERT INTO users (email) VALUES (?)").run("real.customer@hospital.org");
  d.prepare("INSERT INTO users (email) VALUES (?)").run("qa@veritaslabservices.com"); // internal, excluded
  for (let i = 0; i < 3; i++) d.prepare("INSERT INTO studies DEFAULT VALUES").run();
  d.close();

  // Gzip it the same way the nightly backup does.
  await new Promise<void>((resolve, reject) => {
    const s = fs.createReadStream(dbPath);
    const dst = fs.createWriteStream(gzPath);
    const g = zlib.createGzip();
    s.on("error", reject);
    dst.on("error", reject);
    g.on("error", reject);
    dst.on("finish", resolve);
    s.pipe(g).pipe(dst);
  });

  const v = await verifyBackupGzFile(gzPath);
  const checks: [string, boolean][] = [
    ["integrityOk === true", v.integrityOk === true],
    ["integrityResult === 'ok'", v.integrityResult === "ok"],
    ["restoredBytes > 0", v.restoredBytes > 0],
    ["userCount === 2", v.counts.userCount === 2],
    ["realUserCount === 1 (excludes @veritaslabservices.com)", v.counts.realUserCount === 1],
    ["studyCount === 3", v.counts.studyCount === 3],
    ["tableCount === 2", v.counts.tableCount === 2],
  ];

  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    if (!ok) fail++;
  }
  console.log(`\n${checks.length - fail}/${checks.length} passed`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
