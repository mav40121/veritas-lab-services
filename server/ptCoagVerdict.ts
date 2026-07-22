// Server-side PT/INR geomean pass/fail verdict.
//
// This mirrors, rule-for-rule, the client engine calculatePTCoag() in
// client/src/lib/calculations.ts. The server never trusts the client-submitted
// status: computeStudyStatus() recomputes from the raw dataPoints for every
// study type, and pt_coag is no exception. Keeping the logic in one importable
// module (the same posture as server/teaAllowance.ts) lets the verify script
// exercise the ACTUAL server code against the client engine so the two cannot
// drift.
//
// Symmetric multi-instrument model: each instrument in module1Instruments
// establishes its own mean normal PT (MNPT = geometric mean of its normal
// specimens), its own ISI, and its own PT/INR reference intervals. INR is
// (PT / MNPT) ^ ISI. Module 1 passes when <= 10% of specimens fall outside the
// PT RI AND <= 10% fall outside the INR RI. The two comparison modules
// (two-instrument Deming, old-lot vs new-lot) are OPTIONAL; each present module
// passes when its error-index coverage (share of pairs with |EI| <= 1.0 within
// TEa) is >= 90%. Overall PASS requires every Module 1 plus any present
// comparison module.
//
// Backward compatible: legacy single-instrument studies persisted only a
// singular `module1` block (plus top-level instrument); those map to a
// one-element instrument list here.

export type PtCoagPair = { id?: string; x?: number | null; y?: number | null };
export type PtCoagModule1Block = {
  name?: string;
  ptValues?: number[];
  isi?: number;
  ptRI?: { low?: number; high?: number };
  inrRI?: { low?: number; high?: number };
};
export type PtCoagRawData = {
  module1Instruments?: PtCoagModule1Block[];
  module1?: PtCoagModule1Block;
  module2?: { data?: PtCoagPair[]; tea?: number } | null;
  module3?: { data?: PtCoagPair[]; tea?: number } | null;
};

// Geometric mean of the positive values (PT seconds are always > 0). Mirrors
// client geometricMean(); the positive filter only guards against a malformed
// non-positive entry producing NaN.
function geoMean(values: number[]): number {
  const pos = values.filter(v => typeof v === "number" && !isNaN(v) && v > 0);
  if (pos.length === 0) return 0;
  return Math.exp(pos.reduce((s, v) => s + Math.log(v), 0) / pos.length);
}

// One instrument's Module-1 verdict: geomean PT -> per-specimen INR -> <=10%
// outside BOTH the PT and INR reference intervals. Mirrors calculateModule1().
function module1Passes(b: PtCoagModule1Block | undefined): boolean {
  const pts = (b?.ptValues || []).filter(v => typeof v === "number" && !isNaN(v)) as number[];
  const isi = b?.isi;
  const ptLow = b?.ptRI?.low, ptHigh = b?.ptRI?.high;
  const inrLow = b?.inrRI?.low, inrHigh = b?.inrRI?.high;
  if (pts.length === 0) return false;
  if (typeof isi !== "number" || typeof ptLow !== "number" || typeof ptHigh !== "number"
    || typeof inrLow !== "number" || typeof inrHigh !== "number") return false;
  const mnpt = geoMean(pts);
  if (!(mnpt > 0)) return false;
  const ptOutside = pts.filter(pt => pt < ptLow || pt > ptHigh).length;
  const inrOutside = pts.filter(pt => {
    const inr = Math.pow(pt / mnpt, isi);
    return inr < inrLow || inr > inrHigh;
  }).length;
  const ptRIPass = (ptOutside / pts.length) <= 0.10;
  const inrRIPass = (inrOutside / pts.length) <= 0.10;
  return ptRIPass && inrRIPass;
}

// One comparison module's verdict: error-index coverage >= 90%. EI = (y-x)/(tea*x),
// with EI = 0 when tea <= 0 or x === 0 (so those pairs pass). Mirrors
// calculateDemingModule().pass, which needs only the coverage, not the slope.
function comparisonPasses(mod: { data?: PtCoagPair[]; tea?: number } | null | undefined): boolean {
  const data = (mod?.data || []).filter(
    d => d && typeof d.x === "number" && !isNaN(d.x as number) && typeof d.y === "number" && !isNaN(d.y as number)
  ) as { x: number; y: number }[];
  const tea = typeof mod?.tea === "number" ? mod.tea : 0;
  const n = data.length;
  if (n === 0) return false;
  const withinTea = data.filter(d => {
    const ei = (tea > 0 && d.x !== 0) ? (d.y - d.x) / (tea * d.x) : 0;
    return Math.abs(ei) <= 1.0;
  }).length;
  return (withinTea / n) * 100 >= 90;
}

export function computePTCoagStatus(rawData: PtCoagRawData | null | undefined): "pass" | "fail" {
  const rd = rawData || {};
  const blocks: PtCoagModule1Block[] = Array.isArray(rd.module1Instruments) && rd.module1Instruments.length > 0
    ? rd.module1Instruments
    : (rd.module1 ? [rd.module1] : []);
  if (blocks.length === 0) return "fail";
  const module1sPass = blocks.every(module1Passes);
  const m2Pass = rd.module2 && typeof rd.module2 === "object" ? comparisonPasses(rd.module2) : true;
  const m3Pass = rd.module3 && typeof rd.module3 === "object" ? comparisonPasses(rd.module3) : true;
  return (module1sPass && m2Pass && m3Pass) ? "pass" : "fail";
}
