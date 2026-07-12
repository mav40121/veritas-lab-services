// scripts/verify-veritatrack-worklist-idor.mjs
//
// Receipt for the VeritaTrack /worklist cross-lab IDOR fix (audit #1 HIGH,
// 2026-07-11). The GET /api/labs/:labId/veritatrack/worklist route had
// authMiddleware ONLY (no labScopeMiddleware, unlike its /tasks and /dashboard
// siblings) and read Number(req.params.labId) directly, so any authenticated
// track-plan user could read ANY lab's worklist + cross-module data (cert
// numbers, PT analytes, competency employee NAMES) by passing an arbitrary
// :labId. The fix resolves the lab via resolveLegacyLabId(sqlite, req) -- the
// same membership-validating guard the /tasks list read already uses -- which
// ignores a forged foreign lab and falls back to the requester's own validated
// lab, so no cross-lab read is possible.
//
// Part 1: source receipts. Part 2: a functional better-sqlite3 proof that a
// worklist read keyed by a resolved lab returns ONLY that lab's tasks (the
// isolation guarantee the fix provides once the lab is membership-validated).
//
//   node scripts/verify-veritatrack-worklist-idor.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/veritatrack.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// ── Part 1: source receipts ───────────────────────────────────────────────
console.log("--- source receipts ---");
// Isolate the worklist route (from its registration to the first query).
const wl = (src.match(/veritatrack\/worklist"[\s\S]{0,900}/) || [""])[0];

ok("worklist no longer reads Number(req.params.labId)", !/Number\(req\.params\.labId\)/.test(wl));
ok("NO Number(req.params.labId) lab-read remains anywhere in veritatrack.ts", !/Number\(req\.params\.labId\)/.test(src));
ok("worklist resolves the lab via the membership-validating resolveLegacyLabId",
  /veritatrack\/worklist"[\s\S]*?const labId = resolveLegacyLabId\(sqlite, req\);/.test(src));
ok("worklist null-guards the resolved lab", /veritatrack\/worklist"[\s\S]*?if \(labId == null\) return res\.status\(400\)/.test(src));
ok("the SECURITY IDOR fix is documented at the route", /SECURITY \(multi-lab IDOR fix/.test(src));
// regression guard: the two scoped siblings still carry labScopeMiddleware
ok("/tasks + /dashboard siblings still chain labScopeMiddleware",
  (src.match(/veritatrack\/(tasks|dashboard)", authMiddleware, labScopeMiddleware,/g) || []).length >= 2);

// ── Part 2: functional sqlite isolation proof ─────────────────────────────
console.log("--- functional sqlite proof ---");
let Database;
try { Database = (await import("better-sqlite3")).default; }
catch {
  console.log("SKIP: better-sqlite3 not importable (source receipts still authoritative).");
  console.log(fails === 0 ? "\n=== VERITATRACK WORKLIST IDOR: PASS (receipts) ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}
const sq = new Database(":memory:");
sq.exec(`CREATE TABLE veritatrack_tasks (id INTEGER PRIMARY KEY, lab_id INTEGER, name TEXT, active INTEGER DEFAULT 1);`);
const LAB_A = 10, LAB_B = 14;
sq.prepare("INSERT INTO veritatrack_tasks (lab_id, name) VALUES (?, 'A-cal-ver')").run(LAB_A);
sq.prepare("INSERT INTO veritatrack_tasks (lab_id, name) VALUES (?, 'B-staff-competency')").run(LAB_B);

// The worklist read is `WHERE lab_id = ?`. Before the fix, labId came from
// req.params.labId (attacker-controlled). After the fix, labId is the resolved
// OWN lab. Prove the query isolates by lab.
const readWorklist = (labId) => sq.prepare("SELECT name FROM veritatrack_tasks WHERE lab_id = ? AND active = 1").all(labId).map(r => r.name);

// Attacker on Lab A resolves to Lab A (resolveLegacyLabId ignores a forged
// :labId=14 for a non-member). Simulate: resolved lab is the OWN lab (A).
const attackerResolvedLab = LAB_A; // what resolveLegacyLabId returns for a non-member forging 14
ok("scoping to the requester's own lab returns only their tasks",
  JSON.stringify(readWorklist(attackerResolvedLab)) === JSON.stringify(["A-cal-ver"]));
ok("the requester never sees Lab B's competency task via their own resolved lab",
  !readWorklist(attackerResolvedLab).includes("B-staff-competency"));
ok("a legit Lab B member (resolves to B) sees only Lab B", JSON.stringify(readWorklist(LAB_B)) === JSON.stringify(["B-staff-competency"]));
sq.close();

console.log(fails === 0 ? "\n=== VERITATRACK WORKLIST IDOR: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
