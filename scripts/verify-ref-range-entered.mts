// scripts/verify-ref-range-entered.mts
//
// shared/refRangeEntered.ts (Heywood 2026-11-21): a one-sided reference range is a complete verified range, so the
// attest route, the map page's Attest link and the export's "Pending director attestation" cell take a band with
// either end filled; bandAttestCounts gives the map page's "attested on X of N bands" line.
// Run: npx tsx scripts/verify-ref-range-entered.mts
import { refRangeEntered, bandAttestCounts } from "../shared/refRangeEntered";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`); if (!ok) failures++; };

const cases: Array<[string, any, boolean]> = [
  ["two-sided 136-145", { ref_range_low: "136", ref_range_high: "145" }, true],
  ["high only (<200)", { ref_range_low: null, ref_range_high: "200" }, true],
  ["high only, low blank string", { ref_range_low: "", ref_range_high: "200" }, true],
  ["low only (>60)", { ref_range_low: "60", ref_range_high: null }, true],
  ["low of 0 kept as text", { ref_range_low: "0", ref_range_high: "5" }, true],
  ["low of 0 as a number", { ref_range_low: 0, ref_range_high: null }, true],
  ["both blank", { ref_range_low: "", ref_range_high: "" }, false],
  ["both null", { ref_range_low: null, ref_range_high: null }, false],
  ["spaces only", { ref_range_low: "  ", ref_range_high: " " }, false],
  ["no row", null, false],
  ["criticals only, no range", { critical_low: "2.5", critical_high: "6.5" }, false],
];
for (const [name, row, want] of cases) check(`1. ${name} -> ${want}`, refRangeEntered(row) === want, String(refRangeEntered(row)));

const counts = bandAttestCounts([
  { ref_range_low: "0.6", ref_range_high: "1.1", ref_locked: 0 },
  { ref_range_low: "0.7", ref_range_high: "1.3", ref_locked: 1 },
  { ref_range_low: null, ref_range_high: "200", ref_locked: 1 },
  { ref_range_low: null, ref_range_high: null, ref_locked: 0 },
]);
check("2. bandAttestCounts: 3 bands with a range, 2 attested; the empty band isn't counted", counts.withRange === 3 && counts.attested === 2, JSON.stringify(counts));
check("3. bandAttestCounts of no bands", JSON.stringify(bandAttestCounts([])) === JSON.stringify({ withRange: 0, attested: 0 }));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
