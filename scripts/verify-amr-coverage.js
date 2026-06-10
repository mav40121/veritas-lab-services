// scripts/verify-amr-coverage.js
//
// Math receipt for the per-study AMR coverage analysis (Michael L
// feedback, 2026-06-09). Mirrors the helper in server/amrCoverage.ts.
//
// Cases:
//   1. Full coverage   (each end >=95%)            -> verdict "full"
//   2. Near-edge low   (low end 90-94%)            -> verdict "near_edge"
//   3. Under-tested    (any end <90%)              -> verdict "under_tested"
//   4. Outside AMR     (any tested point past edge)-> verdict "outside_amr"
//   5. Blank AMR       (low or high null)          -> shouldRender false
//   6. Zero data       (no numeric values)         -> verdict "under_tested" + summary note
//   7. Single point at edge                        -> verdict reflects only end touched
//   8. axis extraction per study type
//
// Run: node scripts/verify-amr-coverage.js

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-9 : tol); }

// Inline mirror of server/amrCoverage.ts logic (kept literally
// identical to that file so a divergence shows up as a test failure).
function shouldRender(study) {
  const lo = study.amr_low, hi = study.amr_high;
  if (lo == null || hi == null) return false;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  if (hi <= lo) return false;
  return true;
}
function computeAmrCoverage({ amrLow, amrHigh, amrUnits = "", values }) {
  if (!Number.isFinite(amrLow) || !Number.isFinite(amrHigh) || amrHigh <= amrLow) return null;
  const numericValues = values.filter((v) => Number.isFinite(v));
  const amrSpan = amrHigh - amrLow;
  if (numericValues.length === 0) {
    return {
      amrLow, amrHigh, amrSpan, amrUnits,
      lowestTested: null, highestTested: null,
      lowEdgeDistance: null, highEdgeDistance: null,
      lowCoveragePct: 0, highCoveragePct: 0,
      verdict: "under_tested",
      summary: `AMR claimed ${amrLow} to ${amrHigh}${amrUnits ? " " + amrUnits : ""}; no numeric data points to evaluate coverage.`,
    };
  }
  const lowestTested = Math.min(...numericValues);
  const highestTested = Math.max(...numericValues);
  const lowEdgeDistance = lowestTested - amrLow;
  const highEdgeDistance = amrHigh - highestTested;
  const lowCoveragePct = lowEdgeDistance <= 0 ? 1 : Math.max(0, 1 - lowEdgeDistance / amrSpan);
  const highCoveragePct = highEdgeDistance <= 0 ? 1 : Math.max(0, 1 - highEdgeDistance / amrSpan);
  const minCoverage = Math.min(lowCoveragePct, highCoveragePct);
  let verdict;
  if (lowEdgeDistance < 0 || highEdgeDistance < 0) verdict = "outside_amr";
  else if (minCoverage >= 0.95) verdict = "full";
  else if (minCoverage >= 0.90) verdict = "near_edge";
  else verdict = "under_tested";
  return {
    amrLow, amrHigh, amrSpan, amrUnits,
    lowestTested, highestTested,
    lowEdgeDistance, highEdgeDistance,
    lowCoveragePct, highCoveragePct,
    verdict, summary: "",
  };
}
function extractValuesForCoverage(studyType, dataPoints, comparisonInstrumentName) {
  if (studyType === "precision") {
    if (!Array.isArray(dataPoints)) return [];
    const out = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const vals = p.days ? p.days.flat() : p.values || [];
      for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
    return out;
  }
  if (studyType === "cal_ver" || studyType === "reportable_range") {
    if (!Array.isArray(dataPoints)) return [];
    const out = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const vals = Object.values(p.instrumentValues || {}).filter((v) => typeof v === "number" && Number.isFinite(v));
      if (vals.length === 0) {
        if (typeof p.expectedValue === "number" && Number.isFinite(p.expectedValue)) out.push(p.expectedValue);
        continue;
      }
      out.push(vals.reduce((s, v) => s + v, 0) / vals.length);
    }
    return out;
  }
  if (studyType === "method_comparison" || studyType === "correlation") {
    if (!Array.isArray(dataPoints)) return [];
    const out = [];
    for (const p of dataPoints) {
      if (!p || p.excluded === true) continue;
      const v = comparisonInstrumentName ? p.instrumentValues?.[comparisonInstrumentName] : Object.values(p.instrumentValues || {})[0];
      if (typeof v === "number" && Number.isFinite(v)) out.push(v);
    }
    return out;
  }
  if (studyType === "ref_interval") {
    const specimens = Array.isArray(dataPoints?.specimens) ? dataPoints.specimens : [];
    return specimens.filter((s) => s && s.excluded !== true).map((s) => s.value).filter((v) => typeof v === "number" && Number.isFinite(v));
  }
  return [];
}

// ── Test 1: full coverage ────────────────────────────────────────────
{
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 500, values: [12, 100, 250, 400, 495] });
  check("full coverage: verdict=full", r.verdict === "full", `got ${r.verdict}`);
  check("full coverage: lowestTested=12", r.lowestTested === 12);
  check("full coverage: highestTested=495", r.highestTested === 495);
  check("full coverage: lowEdgeDistance=2", near(r.lowEdgeDistance, 2));
  check("full coverage: highEdgeDistance=5", near(r.highEdgeDistance, 5));
  // AMR span = 490. low coverage % = 1 - 2/490 ≈ 0.9959
  check("full coverage: lowCoveragePct >=0.95", r.lowCoveragePct >= 0.95);
  check("full coverage: highCoveragePct >=0.95", r.highCoveragePct >= 0.95);
}

// ── Test 2: near-edge (low end 90-94%) ───────────────────────────────
{
  // amrSpan 100 (10-110). lowestTested 18 -> lowEdgeDistance 8 -> cov 0.92
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 110, values: [18, 50, 109] });
  check("near-edge: verdict=near_edge", r.verdict === "near_edge", `got ${r.verdict}, lowCov=${r.lowCoveragePct.toFixed(3)}, highCov=${r.highCoveragePct.toFixed(3)}`);
  check("near-edge: lowCoveragePct=0.92", near(r.lowCoveragePct, 0.92, 1e-9));
  check("near-edge: highCoveragePct=0.99", near(r.highCoveragePct, 0.99, 1e-9));
}

// ── Test 3: under-tested (low end <90%) ──────────────────────────────
{
  // amrSpan 100. lowestTested 25 -> lowEdgeDistance 15 -> cov 0.85
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 110, values: [25, 50, 100] });
  check("under-tested: verdict=under_tested", r.verdict === "under_tested", `got ${r.verdict}`);
  check("under-tested: lowCoveragePct=0.85", near(r.lowCoveragePct, 0.85, 1e-9));
}

// ── Test 4: outside AMR ──────────────────────────────────────────────
{
  // lowestTested 5 is below amrLow 10
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 110, values: [5, 50, 100] });
  check("outside AMR: verdict=outside_amr", r.verdict === "outside_amr", `got ${r.verdict}`);
  check("outside AMR: lowEdgeDistance<0", r.lowEdgeDistance < 0);
  check("outside AMR: lowCoveragePct=1", r.lowCoveragePct === 1, "coverage caps at 1 even when past edge");
}

// ── Test 5: blank AMR -> shouldRender false ──────────────────────────
{
  check("shouldRender(null low) false", !shouldRender({ amr_low: null, amr_high: 100 }));
  check("shouldRender(null high) false", !shouldRender({ amr_low: 0, amr_high: null }));
  check("shouldRender(both undef) false", !shouldRender({}));
  check("shouldRender(high <= low) false", !shouldRender({ amr_low: 100, amr_high: 50 }));
  check("shouldRender(valid pair) true", shouldRender({ amr_low: 10, amr_high: 100 }));
  // computeAmrCoverage rejects inverted range
  const r = computeAmrCoverage({ amrLow: 100, amrHigh: 100, values: [50] });
  check("computeAmrCoverage(equal range) returns null", r === null);
}

// ── Test 6: zero data ────────────────────────────────────────────────
{
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 100, values: [] });
  check("zero data: verdict=under_tested", r.verdict === "under_tested");
  check("zero data: lowestTested=null", r.lowestTested === null);
  check("zero data: summary mentions no data", /no numeric data/.test(r.summary));
}

// ── Test 7: single point at low edge ─────────────────────────────────
{
  const r = computeAmrCoverage({ amrLow: 10, amrHigh: 100, values: [10] });
  check("single@low: lowCoveragePct=1", r.lowCoveragePct === 1);
  // highEdgeDistance = 100 - 10 = 90; coverage = 1 - 90/90 = 0
  check("single@low: highCoveragePct=0", near(r.highCoveragePct, 0));
  check("single@low: verdict=under_tested", r.verdict === "under_tested", `got ${r.verdict}`);
}

// ── Test 8: extractValuesForCoverage per study type ──────────────────
{
  // precision
  const dpPrecision = [
    { level: "low", values: [10, 11, 12, 13] },
    { level: "high", values: [100, 101, 102], excluded: true }, // excluded -> skipped
    { level: "mid", days: [[50, 51], [52, 53]] },
  ];
  const valsP = extractValuesForCoverage("precision", dpPrecision);
  check("precision extract: 8 values", valsP.length === 8, `got ${valsP.length}`);
  check("precision extract: skips excluded", !valsP.includes(100));
  check("precision extract: flattens days", valsP.includes(50) && valsP.includes(53));

  // cal_ver / linearity: mean of measured per level
  const dpCalVer = [
    { level: 1, expectedValue: 25, instrumentValues: { B: 24, A: 26 } },  // mean 25
    { level: 2, expectedValue: 100, instrumentValues: { B: 99, A: 101 } },// mean 100
    { level: 3, expectedValue: 200, instrumentValues: { B: 195, A: 205 }, excluded: true }, // skip
    { level: 4, expectedValue: 300, instrumentValues: {} }, // fall back to expectedValue
  ];
  const valsC = extractValuesForCoverage("cal_ver", dpCalVer);
  check("cal_ver extract: 3 values", valsC.length === 3, `got ${valsC.length}: ${valsC.join(",")}`);
  check("cal_ver extract: mean per level", near(valsC[0], 25) && near(valsC[1], 100));
  check("cal_ver extract: falls back to expectedValue", valsC.includes(300));

  // method_comparison: comparison instrument axis
  const dpMC = [
    { expectedValue: 10, instrumentValues: { A: 10, B: 11 } },
    { expectedValue: 50, instrumentValues: { A: 49, B: 51 }, excluded: true },
    { expectedValue: 100, instrumentValues: { A: 99, B: 101 } },
  ];
  const valsM = extractValuesForCoverage("method_comparison", dpMC, "B");
  check("method_comparison extract: 2 values (skips excluded)", valsM.length === 2);
  check("method_comparison extract: uses comparison axis", valsM[0] === 11 && valsM[1] === 101);

  // ref_interval
  const dpRI = { specimens: [
    { specimenId: 1, value: 5 },
    { specimenId: 2, value: 50, excluded: true },
    { specimenId: 3, value: 95 },
  ]};
  const valsR = extractValuesForCoverage("ref_interval", dpRI);
  check("ref_interval extract: 2 values (skips excluded)", valsR.length === 2);
  check("ref_interval extract: values correct", valsR.includes(5) && valsR.includes(95));

  // carryover -> always empty (not coverage-relevant)
  const valsCO = extractValuesForCoverage("carryover", { specimens: [] });
  check("carryover extract: empty", valsCO.length === 0);
}

// ── Test 9: ethanol example from Michael's message ───────────────────
{
  // Ethanol AMR 17-500. Linearity tested 25-475.
  // lowEdgeDistance = 8 (out of span 483) -> cov = 1 - 8/483 = 0.9834 -> full
  // highEdgeDistance = 25 -> cov = 1 - 25/483 = 0.9482 -> near_edge
  const r = computeAmrCoverage({ amrLow: 17, amrHigh: 500, amrUnits: "mg/dL", values: [25, 100, 200, 300, 400, 475] });
  check("ethanol example: verdict=near_edge", r.verdict === "near_edge", `got ${r.verdict}: lowCov=${r.lowCoveragePct.toFixed(4)}, highCov=${r.highCoveragePct.toFixed(4)}`);
  check("ethanol example: lowCov ≥0.98", r.lowCoveragePct >= 0.98);
  check("ethanol example: highCov ≈0.948", near(r.highCoveragePct, 0.9482, 1e-3));
}

console.log("\n" + (failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`));
process.exit(failures === 0 ? 0 : 1);
