// Verify the symmetric multi-instrument PT/INR geomean (calculatePTCoag).
// Proves: geomean math; N=1 backward-compat (matches calculateModule1); N>1
// independent per-instrument geomeans; the >=10%-outside RI rule; optional
// comparison modules (null); and overall PASS = every instrument's Module 1
// passes AND any present comparison module passes.
// Run: npx tsx scripts/verify-ptcoag-multi.mts
import { calculatePTCoag, calculateModule1, geometricMean } from "../client/src/lib/calculations";

let pass = 0, fail = 0;
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const ptRI = { low: 9, high: 14 };
const inrRI = { low: 0.9, high: 1.2 };

// 20 normals with a known geomean. All near 12s so geomean ~= 12 and all in RI.
const normalA = Array.from({ length: 20 }, (_, i) => 11.5 + (i % 5) * 0.2); // 11.5..12.3
const normalB = Array.from({ length: 20 }, (_, i) => 10.5 + (i % 5) * 0.2); // 10.5..11.3, a different analyzer

// --- geomean math sanity
check("geometricMean([2,8]) == 4", approx(geometricMean([2, 8]), 4));

// --- Case 1: N=1 backward-compat, all pass
const one = calculatePTCoag(
  [{ name: "ACL TOP 351", ptValues: normalA, isi: 1.0, ptRI, inrRI }],
  { xValues: [11, 12, 13], yValues: [11.1, 12.1, 12.9], specimenIds: ["S1", "S2", "S3"], tea: 0.20 },
  null,
);
check("N=1 -> module1s.length === 1", one.module1s.length === 1);
const legacy = calculateModule1(normalA, 1.0, ptRI, inrRI);
check("N=1 module1s[0] matches calculateModule1 geoMeanPT", approx(one.module1s[0].geoMeanPT, legacy.geoMeanPT), `${one.module1s[0].geoMeanPT.toFixed(4)}`);
check("N=1 module1s[0] matches calculateModule1 geoMeanINR", approx(one.module1s[0].geoMeanINR, legacy.geoMeanINR));
check("N=1 module1s[0].pass matches", one.module1s[0].pass === legacy.pass && one.module1s[0].pass === true);
check("N=1 carries instrumentName + isi", one.module1s[0].instrumentName === "ACL TOP 351" && one.module1s[0].isi === 1.0);
check("N=1 module2 present (optional kept)", one.module2 !== null);
check("N=1 overallPass true", one.overallPass === true, one.summary.slice(0, 60));

// --- Case 2: N=2 independent geomeans, both pass, no comparison modules
const two = calculatePTCoag(
  [
    { name: "ACL TOP 351", ptValues: normalA, isi: 1.0, ptRI, inrRI },
    { name: "STA-R Max", ptValues: normalB, isi: 1.05, ptRI, inrRI },
  ],
  null, // no two-instrument comparison
  null,
);
check("N=2 -> two module1s", two.module1s.length === 2);
check("N=2 geomeans are independent (A != B)", !approx(two.module1s[0].geoMeanPT, two.module1s[1].geoMeanPT), `${two.module1s[0].geoMeanPT.toFixed(2)} vs ${two.module1s[1].geoMeanPT.toFixed(2)}`);
check("N=2 each matches its own single-instrument compute", approx(two.module1s[1].geoMeanPT, geometricMean(normalB)));
check("N=2 module2 null tolerated (optional)", two.module2 === null);
check("N=2 both pass -> overallPass true", two.overallPass === true);
check("N=2 summary lists both instruments", two.summary.includes("ACL TOP 351") && two.summary.includes("STA-R Max"));

// --- Case 3: one instrument fails RI verification -> overall fails
// Bad analyzer: 4 of 20 PTs outside the RI (20% > 10% allowed) -> ptRIPass false.
const bad = [...Array(16).fill(12), 20, 21, 22, 23]; // 4 high outliers outside [9,14]
const mixed = calculatePTCoag(
  [
    { name: "Good", ptValues: normalA, isi: 1.0, ptRI, inrRI },
    { name: "Bad", ptValues: bad, isi: 1.0, ptRI, inrRI },
  ],
  null, null,
);
check("mixed: good instrument passes", mixed.module1s[0].pass === true);
check("mixed: bad instrument fails (>10% outside RI)", mixed.module1s[1].pass === false, `${mixed.module1s[1].ptOutsideRI}/${mixed.module1s[1].n} outside`);
check("mixed: overallPass false when any instrument fails", mixed.overallPass === false);

// --- Case 4: comparison module drives verdict even when all instruments pass
const failCompare = calculatePTCoag(
  [{ name: "A", ptValues: normalA, isi: 1.0, ptRI, inrRI }],
  { xValues: [10, 11, 12], yValues: [20, 22, 24], specimenIds: ["S1", "S2", "S3"], tea: 0.05 }, // huge disagreement
  null,
);
check("comparison-fail: module1 passes", failCompare.module1s[0].pass === true);
check("comparison-fail: module2 fails on poor coverage", failCompare.module2!.pass === false, `coverage ${failCompare.module2!.coverage.toFixed(0)}%`);
check("comparison-fail: overallPass false", failCompare.overallPass === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
