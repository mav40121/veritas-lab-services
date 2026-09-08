// Receipt for the coverage-seed durable-data fix (fix/coverage-seed-durable-passing-data).
//
// Bug: seed-coverage-studies copied data_points from a template study whose
// instrumentValues were keyed on the TEMPLATE's instrument name (e.g. "ASSAYER"),
// but set the new study's instruments to the real map label. computeStudyStatus
// looked up instrumentValues[<real label>], found nothing (totalCount=0), and
// returned "fail" -- so the boot status-recompute flipped every seeded study to
// FAIL even though the INSERT wrote status='pass' (USON demo, 0-passing/all-fail).
//
// The fix generates data KEYED to the study's own label(s), in tolerance. This
// script reproduces the generators AND the exact cal_ver / method_comparison
// verdict rules from computeStudyStatus, and asserts every generated study PASSES
// at its seeded TEa -- which is what makes the stored verdict survive boot.
// Exit non-zero on any failure.

let failures = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) failures++; };

// --- generators (mirror server/routes.ts seed-coverage-studies) ---
const genCalVer = (label) => [50, 100, 150, 200, 250].map((assigned, i) => ({
  level: i + 1, expectedValue: assigned,
  instrumentValues: { [label]: Number((assigned * [1.01, 0.985, 1.01, 1.015, 0.992][i]).toFixed(2)) },
}));
const genMethodComp = (labels) => [50, 100, 150, 200, 250].map((base, i) => ({
  level: i + 1, expectedValue: null,
  instrumentValues: Object.fromEntries(labels.map((lab, j) => [lab, j === 0 ? base : Number((base + (1 + (j % 3))).toFixed(2))])),
}));

// --- verdict rules (mirror computeStudyStatus) ---
const FP_EPS = 1e-9;
function calVerVerdict(dataPoints, instrumentNames, tea, teaIsPct) {
  const valid = dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] != null));
  let pass = 0, total = 0;
  for (const dp of valid) {
    const assigned = dp.expectedValue;
    const allowance = Math.max(teaIsPct ? Math.abs(assigned) * tea : 0, teaIsPct ? 0 : tea);
    for (const n of instrumentNames) {
      const v = dp.instrumentValues[n];
      if (v != null) { total++; if (Math.abs(v - assigned) <= allowance + FP_EPS) pass++; }
    }
  }
  return pass === total && total > 0 ? "pass" : "fail";
}
function mcVerdict(dataPoints, instrumentNames, tea) {
  const primary = instrumentNames[0];
  const hasAll = dataPoints.length > 0 && instrumentNames.every(n => n in (dataPoints[0].instrumentValues || {}));
  const comparison = hasAll ? instrumentNames.slice(1) : instrumentNames.filter(n => n in (dataPoints[0]?.instrumentValues || {}));
  const mapped = hasAll ? dataPoints.map(d => ({ expectedValue: d.instrumentValues[primary] ?? null, instrumentValues: Object.fromEntries(comparison.map(n => [n, d.instrumentValues[n] ?? null])) })) : dataPoints;
  const valid = mapped.filter(dp => dp.expectedValue !== null && comparison.some(n => dp.instrumentValues[n] != null));
  let pass = 0, total = 0;
  for (const dp of valid) {
    const ref = dp.expectedValue;
    for (const n of comparison) {
      const v = dp.instrumentValues[n];
      if (v != null) { total++; if (Math.abs(v - ref) <= tea + FP_EPS) pass++; }
    }
  }
  return pass === total && total > 0 ? "pass" : "fail";
}

// cal_ver: seeded at TEa 0.075 percent
for (const label of ["Sysmex XN-1000", "Roche cobas c702", "FREND A"]) {
  const dp = genCalVer(label);
  ok(`cal_ver keyed to "${label}" PASSES at 7.5% TEa`, calVerVerdict(dp, [label], 0.075, true) === "pass");
  ok(`cal_ver keys match the study instrument ("${label}")`, dp.every(p => Object.keys(p.instrumentValues)[0] === label));
}
// The OLD bug: template keyed "ASSAYER" while study instrument differs -> fail.
const bugData = genCalVer("ASSAYER");
ok("regression guard: mismatched instrument key computes FAIL (the old bug)", calVerVerdict(bugData, ["Sysmex XN-1000"], 0.075, true) === "fail");

// method_comparison: seeded at absolute TEa 4
for (const labels of [["Sysmex XN-1000", "Sysmex XN-550"], ["A", "B", "C"]]) {
  const dp = genMethodComp(labels);
  ok(`MC keyed to [${labels.join(", ")}] PASSES at abs TEa 4`, mcVerdict(dp, labels, 4) === "pass");
  ok(`MC data carries every instrument label`, dp.every(p => labels.every(l => l in p.instrumentValues)));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
