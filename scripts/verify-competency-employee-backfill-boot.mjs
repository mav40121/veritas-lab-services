// scripts/verify-competency-employee-backfill-boot.mjs
//
// BUG-048 (2026-10-14): the PR D+ boot backfill in server/db.ts linked unlinked competency_employees rows to the
// VeritaStaff person with the same name in one UPDATE. When a lab re-added people as new unlinked rows while their old
// rows (inactive) already held the same staff person, the UPDATE hit idx_competency_employees_staff_lab_unique and threw
// at boot, so the server could not start. This script boots the built server (dist/index.cjs) on a scratch database
// that carries that exact shape and asserts:
//   1. the server starts (health 200) with the collision present
//   2. a re-added row whose person is already held stays unlinked; the holder keeps the person
//   3. an unlinked row whose person is free is linked
//   4. two unlinked rows matching the same free person: exactly one is linked, the other stays unlinked
//   5. a row matching nobody stays unlinked
//   6. a second boot changes nothing (idempotent) and still starts
//
// Usage: node scripts/verify-competency-employee-backfill-boot.mjs [seed.db]
//   seed.db (optional): a production backup copy to start from; it is COPIED, never written. Without it the script
//   boots a fresh database first to create the schema. Requires `npm run build` first.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = path.join(ROOT, "dist", "index.cjs");
const PORT = 5171;
const LAB = 990048; // scratch lab id, far above any real lab
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };

if (!fs.existsSync(DIST)) { console.error("dist/index.cjs not found; run npm run build first"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug048-"));
const dbPath = path.join(dir, "scratch.db");
if (process.argv[2]) fs.copyFileSync(process.argv[2], dbPath);

async function boot() {
  const child = spawn(process.execPath, [DIST], {
    env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: "bug048-local", ADMIN_SECRET: "bug048-local",
      STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  let exited = false;
  child.on("exit", () => (exited = true));
  let up = false;
  for (let i = 0; i < 90 && !exited && !up; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {}
  }
  child.kill();
  await new Promise((r) => setTimeout(r, 1500));
  return { up, log };
}

// Fresh database: boot once to build the schema.
if (!process.argv[2]) {
  const first = await boot();
  if (!first.up) { console.error("schema boot failed\n" + first.log.slice(-2000)); process.exit(2); }
}

// Seed the collision shape on the scratch copy.
const db = new Database(dbPath);
db.pragma("foreign_keys = OFF"); // scratch copy only: the seed rows point at a lab and user that do not exist here
const now = new Date().toISOString();
const staff = (first, last) => Number(db.prepare(
  "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, first_name, last_name, status, created_at, updated_at) VALUES (?, ?, 1, ?, ?, 'active', ?, ?)"
).run(LAB, LAB, first, last, now, now).lastInsertRowid);
const comp = (name, staffId, status) => Number(db.prepare(
  "INSERT INTO competency_employees (user_id, lab_id, name, staff_employee_id, status, created_at) VALUES (1, ?, ?, ?, ?, ?)"
).run(LAB, name, staffId, status, now).lastInsertRowid);
const held = staff("Carla", "Heldperson");
const free = staff("Frank", "Freeperson");
const twin = staff("Tina", "Twinperson");
const holder = comp("Carla Heldperson", held, "inactive");
const readded = comp("Carla Heldperson", null, "active");
const freeRow = comp("Freeperson, Frank", null, "active");
const twinA = comp("Tina Twinperson", null, "active");
const twinB = comp("tina twinperson", null, "active");
const nobody = comp("Nobody Matches", null, "active");
db.close();

const second = await boot();
check("1. server starts with a re-added person whose old row already holds the VeritaStaff link", second.up, second.log.slice(-1500));
const read = () => { const d = new Database(dbPath, { readonly: true }); const m = Object.fromEntries(d.prepare("SELECT id, staff_employee_id FROM competency_employees WHERE lab_id = ?").all(LAB).map((r) => [r.id, r.staff_employee_id])); d.close(); return m; };
const s = read();
check("2a. the re-added row stays unlinked", s[readded] == null, JSON.stringify(s));
check("2b. the old row keeps the person", s[holder] === held, JSON.stringify(s));
check("2c. boot log names the rows left unlinked", /left unlinked because another row in the same lab already holds/.test(second.log));
check("3. a free person is linked (\"Last, First\" form)", s[freeRow] === free, JSON.stringify(s));
check("4. two rows for one free person: exactly one linked", [s[twinA], s[twinB]].filter((v) => v === twin).length === 1 && [s[twinA], s[twinB]].filter((v) => v == null).length === 1, JSON.stringify(s));
check("5. a row matching nobody stays unlinked", s[nobody] == null, JSON.stringify(s));

const third = await boot();
check("6a. a second boot starts", third.up, third.log.slice(-1500));
check("6b. a second boot changes nothing", JSON.stringify(read()) === JSON.stringify(s), JSON.stringify(read()));

fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
