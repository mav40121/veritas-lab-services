// scripts/verify-legacy-signoff-milestone.mjs
//
// BUG-049 (2026-10-14): a method signed on the whole record before per-method sign-off (a locked assessment in the
// lab's implicit program) reads as a legacy sign-off. It was built with milestone null, so the person's page asked for
// the INITIAL again and computed no due date (Lisa Thompson, Riverside lab 1, waived Nova StatStrip, initial signed
// 10/13/2026). The legacy sign-off now carries the record's own assessment_type.
// Boots the built server (dist/index.cjs) on a COPY of a production backup (never written) and asserts, for every
// legacy-locked implicit record in it:
//   1. the method's last sign-off is the legacy one and its milestone equals the record's type (initial -> initial)
//   2. the next milestone follows from it (waived initial -> annual; moderate/high initial -> six_month)
//   3. a due date is computed (nextDue.targetDate present)
// On the pre-fix build, checks 1-3 FAIL (milestone null, next "initial", no due date).
// Usage: node scripts/verify-legacy-signoff-milestone.mjs <production-backup.db>   (requires npm run build)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = path.join(ROOT, "dist", "index.cjs"), PORT = 5169, SECRET = "bug049-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-legacy-signoff-milestone.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug049-"));
const dbPath = path.join(dir, "copy.db");
fs.copyFileSync(process.argv[2], dbPath);

const child = spawn(process.execPath, [DIST], {
  env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" },
  stdio: ["ignore", "pipe", "pipe"],
});
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }

// Query AFTER boot: the server adds the per-method columns (signoff_id) on startup; an older backup lacks them.
// Legacy-locked implicit records with an instrument, and the VeritaStaff person each belongs to.
const ro = new Database(dbPath, { readonly: true });
const cases = ro.prepare(`
  SELECT DISTINCT p.lab_id, a.id AS assessment_id, a.assessment_type, ce.staff_employee_id, i.instrument_id, l.owner_user_id
  FROM competency_assessments a
  JOIN competency_programs p ON p.id = a.program_id
  JOIN competency_employees ce ON ce.id = a.employee_id
  JOIN competency_assessment_items i ON i.assessment_id = a.id AND i.instrument_id IS NOT NULL AND i.signoff_id IS NULL
  JOIN labs l ON l.id = p.lab_id
  WHERE p.is_implicit = 1 AND a.locked = 1 AND ce.staff_employee_id IS NOT NULL`).all();
ro.close();
console.log(`legacy-locked implicit records with an instrument: ${cases.length}`);
if (!cases.length) { console.error("no legacy records in this backup; nothing to check"); child.kill(); process.exit(2); }


const NEXT = { WAIVED: { initial: "annual", annual: "annual" }, OTHER: { initial: "six_month", six_month: "first_annual", first_annual: "annual", annual: "annual" } };
const TYPE = { initial: "initial", "6month": "six_month", six_month: "six_month", first_annual: "first_annual", annual: "annual" };
for (const c of cases) {
  const tok = jwt.sign({ userId: c.owner_user_id }, SECRET, { expiresIn: "5m" });
  const r = await fetch(`http://localhost:${PORT}/api/labs/${c.lab_id}/competency/employee/${c.staff_employee_id}`, { headers: { Authorization: `Bearer ${tok}`, "X-Active-Lab-Id": String(c.lab_id) } });
  const j = await r.json().catch(() => ({}));
  const ts = (j.testSystems || []).find((t) => t.instrumentId === c.instrument_id);
  const tag = `lab ${c.lab_id} staff ${c.staff_employee_id} instrument ${c.instrument_id} (${c.assessment_type})`;
  check(`${tag}: view 200 and the method is listed`, r.status === 200 && !!ts, `${r.status}`);
  if (!ts) continue;
  const want = TYPE[c.assessment_type];
  const cx = String(ts.complexity || "").toUpperCase() === "WAIVED" ? "WAIVED" : "OTHER";
  check(`${tag}: last sign-off is the legacy one with milestone ${want}`, ts.lastSignoff?.legacy === true && ts.lastSignoff?.milestone === want, JSON.stringify({ legacy: ts.lastSignoff?.legacy, milestone: ts.lastSignoff?.milestone }));
  check(`${tag}: next milestone is ${NEXT[cx][want]}`, ts.nextMilestone === NEXT[cx][want], String(ts.nextMilestone));
  check(`${tag}: a due date is computed`, !!ts.nextDue?.targetDate, JSON.stringify(ts.nextDue));
}
child.kill();
await new Promise((r) => setTimeout(r, 1000));
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
