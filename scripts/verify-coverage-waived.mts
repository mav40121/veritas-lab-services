// scripts/verify-coverage-waived.mts
//
// Receipt for BUG-016 on the VeritaCheck Coverage report (Michael 2026-10-09: "They are required to do
// non-waived. It can be best practice to include waived, but this is a choice, not a requirement.").
// Runs the real computeCoverageFrom() on fixed inputs shaped like Milford (a chemistry analyzer plus a
// WAIVED StatStrip meter) and checks:
//   1. analyzer + waived meter only: no method comparison required;
//   2. add a nonwaived i-STAT: one comparison, listing the two nonwaived instruments, not the meter;
//   3. a WAIVED test is cal-ver exempt from its complexity alone (no manual flag);
//   4. a nonwaived test with no exemption still requires cal ver.
// Run (from repo root): node_modules/.bin/tsx scripts/verify-coverage-waived.mts
import { computeCoverageFrom } from "../server/veritacheckCoverage";

let fails = 0;
const check = (n: string, ok: boolean, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  :: " + d : ""}`); if (!ok) fails++; };
const inst = [
  { id: 1, instrument_name: "Siemens Atellica CH 930", nickname: null, serial_number: "A1" },
  { id: 2, instrument_name: "Nova StatStrip Glucose Hospital Meter", nickname: null, serial_number: null },
  { id: 3, instrument_name: "Abbott i-STAT 1", nickname: null, serial_number: "IS1" },
];
const combo = (id: number, instrument_id: number, complexity: string) => ({ id, analyte: "Glucose", specialty: "General Chemistry", instrument_id, complexity });

const a = computeCoverageFrom(inst as any, [combo(10, 1, "MODERATE"), combo(11, 2, "WAIVED")] as any, []);
check("1. analyzer + waived meter: no method comparison required", a.summary.methodComparisonsNeeded === 0 && a.methodComparisons.length === 0, `needed=${a.summary.methodComparisonsNeeded}`);
const meterRow = a.rows.find((r: any) => r.instrumentTestId === 11) as any;
check("3. the WAIVED meter test is cal-ver exempt with no manual flag", meterRow?.linearityRequired === false && meterRow?.linearityStatus === "exempt", JSON.stringify({ req: meterRow?.linearityRequired, st: meterRow?.linearityStatus }));
const chemRow = a.rows.find((r: any) => r.instrumentTestId === 10) as any;
check("4. the nonwaived analyzer test still requires cal ver", chemRow?.linearityRequired === true && chemRow?.linearityStatus !== "exempt", JSON.stringify({ req: chemRow?.linearityRequired, st: chemRow?.linearityStatus }));

const b = computeCoverageFrom(inst as any, [combo(10, 1, "MODERATE"), combo(11, 2, "WAIVED"), combo(12, 3, "MODERATE")] as any, []);
const mc = b.methodComparisons[0];
check("2. add a nonwaived i-STAT: one comparison required", b.summary.methodComparisonsNeeded === 1, `needed=${b.summary.methodComparisonsNeeded}`);
check("2. it lists the analyzer and the i-STAT, not the waived meter", !!mc && mc.instruments.length === 2 && !mc.instruments.some((x) => /StatStrip/.test(x)), JSON.stringify(mc?.instruments));

console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
process.exit(fails ? 1 : 0);
