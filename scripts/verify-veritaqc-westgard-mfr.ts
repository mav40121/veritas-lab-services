// Verify receipt for VeritaQC Westgard evaluation against the lot's PROGRAMMED
// mean/SD (2026-10-04, Michael's option 1). Proves the fix: a point that was a
// false 1-3s rejection under the old cumulative-history SD is NOT flagged when
// scored against the lot's mfr mean/SD (which the Levey-Jennings chart uses), and
// every rule still fires correctly against the programmed SDI.
//
// Run: npx tsx scripts/verify-veritaqc-westgard-mfr.ts
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
import { evaluateWestgardForLot } from "../server/qcWestgard";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE qc_control_lots (id INTEGER PRIMARY KEY, lab_id INTEGER, mfr_mean REAL, mfr_sd REAL);
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER, control_lot_id INTEGER,
    result_value REAL, result_date TEXT, accepted_for_reporting INTEGER DEFAULT 1, voided_at TEXT);
`);
const LAB = 1;
let lotSeq = 0, day = 0;
function mkLot(mean: number, sd: number): number {
  const id = ++lotSeq;
  db.prepare("INSERT INTO qc_control_lots (id,lab_id,mfr_mean,mfr_sd) VALUES (?,?,?,?)").run(id, LAB, mean, sd);
  day = 0; // reset per lot so each lot's results stay on days 01..10 (no month wrap)
  return id;
}
function add(lotId: number, value: number): number {
  const d = `2026-09-${String((day++ % 28) + 1).padStart(2, "0")}`;
  const r = db.prepare("INSERT INTO qc_results (lab_id,control_lot_id,result_value,result_date) VALUES (?,?,?,?)")
    .run(LAB, lotId, value, d);
  return Number(r.lastInsertRowid);
}
const evalP = (lotId: number, rid: number, biasN = 10, trendN = 7) =>
  evaluateWestgardForLot(db, LAB, lotId, rid, biasN, trendN).map(v => v.rule_code);

interface C { name: string; got: any; exp: any; }
const cases: C[] = [];

// A: the fix. mfr mean 100 / sd 10. Tight history (99..101) -> history SD ~0.8.
// A point at 115 is +7s from the HISTORY mean (old code => 1-3s), but only +1.5s
// from the PROGRAMMED mean (within 2SD) => NO violation now.
const A = mkLot(100, 10);
for (const v of [100, 99, 101, 100, 99.5, 100.5, 100, 99, 101, 100]) add(A, v);
const flyer = add(A, 115);
cases.push({ name: "FIX: +1.5s-from-mfr point (was +7s from history) NOT flagged", got: JSON.stringify(evalP(A, flyer)), exp: "[]" });

// B: single point +3.5s from mfr -> 1-3s rejection.
const B = mkLot(100, 10); const b1 = add(B, 135);
cases.push({ name: "1-3s at +3.5s from mfr (also proves eval on the FIRST point)", got: JSON.stringify(evalP(B, b1)), exp: `["1-3s"]` });

// C: single point +2.5s -> 1-2s warning only.
const C = mkLot(100, 10); const c1 = add(C, 125);
cases.push({ name: "1-2s at +2.5s, no prior point", got: JSON.stringify(evalP(C, c1)), exp: `["1-2s"]` });

// D: 2-2s -> two consecutive >2s same side.
const D = mkLot(100, 10); add(D, 124); const d2 = add(D, 125);
cases.push({ name: "2-2s (124 then 125, both >+2s)", got: JSON.stringify(evalP(D, d2)), exp: `["1-2s","2-2s"]` });

// E: R-4s -> straddle the mean with >4s span.
const E = mkLot(100, 10); add(E, 125); const e2 = add(E, 72);
cases.push({ name: "R-4s (+2.5s then -2.8s, straddle, 5.3s span)", got: JSON.stringify(evalP(E, e2)), exp: `["1-2s","R-4s"]` });

// F: 4-1s -> four consecutive >1s same side.
const F = mkLot(100, 10); add(F, 112); add(F, 113); add(F, 111); const f4 = add(F, 114);
cases.push({ name: "4-1s (112,113,111,114 all >+1s)", got: JSON.stringify(evalP(F, f4)), exp: `["4-1s"]` });

// G: 10-x bias -> 10 consecutive same side of mean (all within 1s so no other rule).
const G = mkLot(100, 10); let g = 0; for (let k = 0; k < 10; k++) g = add(G, 100.5);
cases.push({ name: "10-x bias (10 on same side of mean)", got: JSON.stringify(evalP(G, g)), exp: `["10-x"]` });

// H: mfr_sd <= 0 -> no evaluation (guard).
const H = mkLot(100, 0); const h1 = add(H, 150);
cases.push({ name: "mfr_sd=0 guard -> no violations (no divide-by-zero)", got: JSON.stringify(evalP(H, h1)), exp: "[]" });

let pass = 0, fail = 0;
for (const c of cases) {
  const ok = c.got === c.exp;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (exp ${c.exp}, got ${c.got})`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail) process.exit(1);
