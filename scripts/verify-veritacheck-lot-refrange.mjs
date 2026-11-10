// scripts/verify-veritacheck-lot-refrange.mjs
//
// Math receipt for BUG-157 and BUG-155 (2026-11-10). Hand-calculated, made-up values through the real code
// (shared/lotToLotCohort.ts, client/src/lib/calculations.ts, client/src/lib/studyFormPayload.ts,
// client/src/lib/studyResults.ts, server/verdictRuleHold.ts).
// BUG-157: reagent lot verification (lot-to-lot, CLSI EP26) "Abnormal Only" counted no pairs. The form types an
// Abnormal Only study's pairs into the Specimen Data grid, whose rows carry cohort "Normal", and the screen, the stored
// verdict and the PDF kept only rows labeled "Abnormal".
//   1. an Abnormal Only study counts its pairs; the cohort rule's two branches (mean within TEa, >= 90% of pairs within)
//   2. Normal Only and Both are as before
//   3. the form labels each pair with its cohort; Edit puts a one-cohort study's pairs back in its grid
//   4. which saved rows the boot recompute holds (only those the old and new rules read differently)
// BUG-155: reference range verification's stored verdict counted blank cells, read censored results as in range and had
// no 20-result minimum. It now uses the results page's calculator (calculateRefInterval after deepResolveCensored).
//   5. blank, censored (each policy), the 20-result minimum, the 10% limit at its edges, limits inclusive
//   6. the old and new pass tests agree on every row of 20 to 1,000 plain numbers, so only other rows are held
// Run: npx tsx scripts/verify-veritacheck-lot-refrange.mjs
import { lotCohortsFor, pairInCohort, lotCohortRuleChanges } from "../shared/lotToLotCohort.ts";
import { calculateLotToLot, calculateRefInterval } from "../client/src/lib/calculations.ts";
import { buildLotToLotPayload, readStudyForms } from "../client/src/lib/studyFormPayload.ts";
import { deepResolveCensored } from "../client/src/lib/studyResults.ts";
import { heldForVerdictRuleDecision, refIntervalRuleChanges, refIntervalHoldReasons } from "../server/verdictRuleHold.ts";

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`}`);
  ok ? pass++ : fail++;
};

// ── 1. Abnormal Only ────────────────────────────────────────────────────────
// 20 made-up high glucose pairs (mg/dL): current 200, 210, ... 390. TEa 10%.
const CUR = Array.from({ length: 20 }, (_, i) => 200 + 10 * i);
const id = (i) => `S${String(i + 1).padStart(3, "0")}`;
// newLot as a factor of currentLot per pair, rounded to 0.1 as typed. At 2%, 15% and 20% each |%diff| is the factor's
// exactly; at 9.5% and 10.5% the rounding moves a pair by at most 0.03%, which doesn't cross 10% or move the mean's 2nd decimal.
const pairs = (factors, cohort = "Normal") => CUR.map((c, i) => ({ specimenId: id(i), currentLot: c, newLot: +(c * factors[i]).toFixed(1), cohort }));
const at = (n, f, rest = 1.02) => Array.from({ length: 20 }, (_, i) => (i < n ? f : (i % 2 ? rest : 2 - rest)));
const sum = (r) => r.cohorts.map((c) => [c.cohort, c.n, +c.meanAbsPctDiff.toFixed(2), +c.coverage.toFixed(1), c.pass]);

// Hand: every pair 2% apart -> mean |%diff| 2.00%, 20 of 20 within 10% -> PASS.
let r = calculateLotToLot(pairs(at(0, 1)), 0.1, "abnormal");
check("Abnormal Only, 20 pairs 2% apart (labeled Normal, as the form saved them): N 20, mean 2.00%, coverage 100%, PASS", sum(r), [["Abnormal", 20, 2, 100, true]]);
check("... summary names the Abnormal cohort and its N", r.summary.includes("Abnormal cohort (N=20): Mean |%Diff| = 2.0%, Coverage = 100% within TEa of ±10.0%. PASS.") && r.summary.includes("20/20 specimens within TEa"), true);
// Hand: every pair 20% apart -> mean 20.00%, 0 of 20 within -> FAIL, with N 20 (not 0).
r = calculateLotToLot(pairs(at(20, 1.2)), 0.1, "abnormal");
check("Abnormal Only, 20 pairs 20% apart: N 20, mean 20.00%, coverage 0%, FAIL", sum(r), [["Abnormal", 20, 20, 0, false]]);
// Hand: 2 pairs at 15%, 18 at 2% -> 18/20 = 90% within, mean (2*15 + 18*2)/20 = 3.30% -> PASS (coverage >= 90%).
r = calculateLotToLot(pairs(at(2, 1.15)), 0.1, "abnormal");
check("Abnormal Only, 2 of 20 pairs at 15%: coverage 90%, mean 3.30%, PASS", sum(r), [["Abnormal", 20, 3.3, 90, true]]);
// Hand: 3 pairs at 15% -> 17/20 = 85% within, mean (3*15 + 17*2)/20 = 3.95% -> FAIL on coverage alone.
r = calculateLotToLot(pairs(at(3, 1.15)), 0.1, "abnormal");
check("Abnormal Only, 3 of 20 pairs at 15%: coverage 85%, mean 3.95%, FAIL (coverage below 90%)", sum(r), [["Abnormal", 20, 3.95, 85, false]]);
// Hand: every pair 9.5% apart -> 20/20 within 10%, mean 9.50% -> PASS; 10.5% -> 0 within, mean 10.50% -> FAIL.
r = calculateLotToLot(pairs(at(20, 1.095)), 0.1, "abnormal");
check("Abnormal Only, every pair 9.5% apart: mean 9.50% within 10%, coverage 100%, PASS", sum(r), [["Abnormal", 20, 9.5, 100, true]]);
r = calculateLotToLot(pairs(at(20, 1.105)), 0.1, "abnormal");
check("Abnormal Only, every pair 10.5% apart: mean 10.50% over 10%, coverage 0%, FAIL", sum(r), [["Abnormal", 20, 10.5, 0, false]]);
// A half-typed pair is not counted (19 complete).
const half = pairs(at(0, 1)); half[19] = { ...half[19], newLot: null };
check("Abnormal Only, 19 complete pairs and a half-typed one: N 19", calculateLotToLot(half, 0.1, "abnormal").cohorts[0].n, 19);
// No sample type saved reads as Abnormal Only (unchanged), and now counts its pairs.
check("no sample type saved: reads as the Abnormal cohort and counts its 20 pairs", sum(calculateLotToLot(pairs(at(0, 1)), 0.1, undefined)), [["Abnormal", 20, 2, 100, true]]);

// ── 2. Normal Only and Both ─────────────────────────────────────────────────
check("Normal Only, 20 pairs labeled Normal: N 20, PASS (as before)", sum(calculateLotToLot(pairs(at(0, 1)), 0.1, "normal")), [["Normal", 20, 2, 100, true]]);
const both = [...pairs(at(0, 1)).slice(0, 10), ...pairs(at(20, 1.2), "Abnormal").slice(10)];
check("Both: 10 Normal pairs at 2% PASS, 10 Abnormal pairs at 20% FAIL, split by label (as before)", sum(calculateLotToLot(both, 0.1, "both")), [["Normal", 10, 2, 100, true], ["Abnormal", 10, 20, 0, false]]);
check("cohorts by sample type: both, normal, abnormal, none", [lotCohortsFor("both"), lotCohortsFor("normal"), lotCohortsFor("abnormal"), lotCohortsFor(undefined)], [["Normal", "Abnormal"], ["Normal"], ["Abnormal"], ["Abnormal"]]);
check("pairInCohort: Both splits by label; one cohort takes every pair",
  [pairInCohort("Normal", "Abnormal", "both"), pairInCohort("Abnormal", "Abnormal", "both"), pairInCohort("Normal", "Abnormal", "abnormal"), pairInCohort(undefined, "Normal", "normal")], [false, true, true, true]);

// ── 3. The form ─────────────────────────────────────────────────────────────
const form = (sampleType, data, dataAbnormal = pairs(at(0, 1), "Abnormal").map((p) => ({ ...p, currentLot: null, newLot: null }))) => ({
  sampleType, currentLotNum: "CUR-MU-1", currentLotExp: "", newLotNum: "NEW-MU-1", newLotExp: "", analyte: "Made-up Glucose", units: "mg/dL", numSpecimens: 20, data, dataAbnormal,
});
const saved = buildLotToLotPayload(form("abnormal", pairs(at(0, 1)))).dataPoints;
check("Run Study saves an Abnormal Only study's 20 pairs labeled Abnormal", saved.data.map((d) => d.cohort).join(","), Array(20).fill("Abnormal").join(","));
check("... and Normal Only's labeled Normal, Both's by grid", [
  buildLotToLotPayload(form("normal", pairs(at(0, 1)))).dataPoints.data.every((d) => d.cohort === "Normal"),
  buildLotToLotPayload(form("both", pairs(at(0, 1)).slice(0, 10), pairs(at(0, 1), "Abnormal").slice(0, 10))).dataPoints.data.map((d) => d.cohort).join("").length,
], [true, "Normal".length * 10 + "Abnormal".length * 10]);
const back = readStudyForms({ studyType: "lot_to_lot", dataPoints: JSON.stringify(saved) }).lot_to_lot;
check("Edit of the Abnormal Only study: sample type Abnormal Only, the 20 pairs back in the Specimen Data grid", [back.sampleType, back.data.filter((d) => d.newLot !== null).length, back.data.every((d) => d.cohort === "Normal")], ["abnormal", 20, true]);
check("... switched to Both, they are the Normal cohort's 20 pairs (not lost)", sum(calculateLotToLot(buildLotToLotPayload({ ...back, sampleType: "both" }).allData, 0.1, "both")).map((c) => c.slice(0, 2)), [["Normal", 20], ["Abnormal", 0]]);

// ── 4. Which saved rows the boot recompute holds ────────────────────────────
const row = (dp) => ({ studyType: "lot_to_lot", dataPoints: JSON.stringify(dp) });
check("held: Abnormal Only with pairs labeled Normal (saved before the fix)", heldForVerdictRuleDecision(row({ data: pairs(at(0, 1)), sampleType: "abnormal" })), "lot_to_lot_one_cohort");
check("held: no sample type with pairs labeled Normal", heldForVerdictRuleDecision(row({ data: pairs(at(0, 1)) })), "lot_to_lot_one_cohort");
check("held: Normal Only holding a complete pair labeled Abnormal", heldForVerdictRuleDecision(row({ data: [...pairs(at(0, 1)).slice(0, 19), pairs(at(0, 1), "Abnormal")[19]], sampleType: "normal" })), "lot_to_lot_one_cohort");
check("not held: Abnormal Only saved since the fix (labeled Abnormal)", heldForVerdictRuleDecision(row(saved)), null);
check("not held: Normal Only labeled Normal, Both, a half-typed mislabeled pair, another study type", [
  heldForVerdictRuleDecision(row({ data: pairs(at(0, 1)), sampleType: "normal" })),
  heldForVerdictRuleDecision(row({ data: both, sampleType: "both" })),
  heldForVerdictRuleDecision(row({ data: [...pairs(at(0, 1), "Abnormal").slice(0, 19), { ...pairs(at(0, 1))[19], newLot: null }], sampleType: "abnormal" })),
  heldForVerdictRuleDecision({ studyType: "precision", dataPoints: "[]" }),
], [null, null, null, null]);
check("lotCohortRuleChanges on unreadable data: false (the recompute's own error guard handles it)", [lotCohortRuleChanges(null), lotCohortRuleChanges([]), lotCohortRuleChanges({ sampleType: "abnormal" })], [false, false, false]);

// ── 5. Reference range (BUG-155) ────────────────────────────────────────────
// Made-up sodium, 135 to 145 mmol/L. The stored verdict is now this, the results page's calculation:
const page = (values, policy = "exclude", lo = 135, hi = 145) => {
  const r = calculateRefInterval(deepResolveCensored(values.map((value, i) => ({ specimenId: id(i), value })), policy), lo, hi, "Made-up Sodium", "mmol/L");
  return [r.n, r.outsideCount, r.overallPass];
};
// The reading it replaced (computeStudyStatus before 2026-11-10), for the cases where they differ.
const old = (values, lo = 135, hi = 145) => {
  const out = values.filter((v) => v < lo || v > hi).length;
  return (out / values.length) * 100 <= 10;
};
const C = (v, dir = "below") => ({ censored: true, censor_direction: dir, censor_value: v });
const ins = (n) => Array.from({ length: n }, (_, i) => 136 + (i % 9));
// Hand: blank cells aren't results. 18 numbers, all in range -> N 18 < 20 -> FAIL. Old: 20 rows, null < 135 -> 2 outside, 10% -> PASS.
check("2 blank + 18 in range: N 18, 0 outside, FAIL (fewer than 20 results); the old reading gave PASS", [...page([...ins(18), null, null]), old([...ins(18), null, null])], [18, 0, false, true]);
// Hand: 3 blank + 20 in range -> N 20, 0 outside -> PASS. Old: 23 rows, 3 outside (blanks), 13% -> FAIL.
check("3 blank + 20 in range: N 20, 0 outside, PASS; the old reading gave FAIL", [...page([...ins(20), null, null, null]), old([...ins(20), null, null, null])], [20, 0, true, false]);
// Hand: refLow 0 (a blank compared as 0 was in range): 2 blank + 18 in range -> still N 18, FAIL.
check("2 blank + 18 in range with a low limit of 0: N 18, FAIL", page([...ins(18).map((v) => v - 130), null, null], "exclude", 0, 15), [18, 0, false]);
// Hand: censored "<120" under exclude is dropped -> N 19 -> FAIL. Under substitute it is 120 -> outside: 1 of 20 -> PASS.
// Under substitute half it is 60 -> outside: 1 of 20 -> PASS.
check("19 in range + <120: exclude N 19 FAIL; substitute 120 -> N 20, 1 outside, PASS; half 60 -> N 20, 1 outside, PASS",
  [page([...ins(19), C(120)], "exclude"), page([...ins(19), C(120)], "substitute_lld"), page([...ins(19), C(120)], "substitute_lld_half")], [[19, 0, false], [20, 1, true], [20, 1, true]]);
// Hand: 17 in range, 147, two "<100" substituted at 100 -> 3 of 20 outside > 2 -> FAIL. Old: censored read as in range -> 1 of 20 -> PASS.
check("17 in range + 147 + two <100, substitute: N 20, 3 outside, FAIL; the old reading gave PASS",
  [...page([...ins(17), 147, C(100), C(100)], "substitute_lld"), old([...ins(17), 147, C(100), C(100)])], [20, 3, false, true]);
// Hand: a censored ">140" substituted at 140 is in range (the limit's own value), so 20 of 20 in range -> PASS.
check("19 in range + >140, substitute: 140 is in range, N 20, 0 outside, PASS", page([...ins(19), C(140, "above")], "substitute_lld"), [20, 0, true]);
// The 10% limit and the limits themselves: 2 of 20 outside PASS, 3 FAIL; 3 of 30 PASS, 3 of 29 FAIL; 135 and 145 are in range.
check("2 of 20 outside: PASS; 3 of 20: FAIL", [page([...ins(18), 134.9, 145.1])[2], page([...ins(17), 134.9, 145.1, 150])[2]], [true, false]);
check("3 of 30 outside: PASS; 3 of 29: FAIL", [page([...ins(27), 120, 150, 160])[2], page([...ins(26), 120, 150, 160])[2]], [true, false]);
check("values at 135 and 145 are in range (limits inclusive)", page([...ins(18), 135, 145]), [20, 0, true]);

// ── 6. The hold is exact ────────────────────────────────────────────────────
// On n plain numbers with k outside, old: (k / n) * 100 <= 10; new: n >= 20 and k <= floor(n * 0.1). For every n from
// 20 to 1,000 and every k they agree, so a row of 20 or more plain numbers (no blank, censored or excluded value, both
// limits numbers) gets the same verdict from both and is left to the boot recompute.
let disagree = 0;
for (let n = 20; n <= 1000; n++) for (let k = 0; k <= n; k++) if (((k / n) * 100 <= 10) !== (k <= Math.floor(n * 0.1))) disagree++;
check("old and new pass tests agree for every count of 20 to 1,000 plain numbers", disagree, 0);
const ri = (values, extra = {}) => ({ specimens: values.map((value, i) => ({ specimenId: id(i), value })), refLow: 135, refHigh: 145, ...extra });
check("held: a blank, a censored value, fewer than 20 rows, an excluded flag, a limit not a number, a text value", [
  refIntervalRuleChanges(ri([...ins(20), null])), refIntervalRuleChanges(ri([...ins(20), C(120)])), refIntervalRuleChanges(ri(ins(19))),
  refIntervalRuleChanges({ ...ri(ins(20)), specimens: ri(ins(20)).specimens.map((s, i) => (i ? s : { ...s, excluded: true })) }),
  refIntervalRuleChanges(ri(ins(20), { refHigh: null })), refIntervalRuleChanges(ri([...ins(19), "140"])),
], [true, true, true, true, true, true]);
check("not held: 20 or more plain numbers, any count outside; unreadable data (the error guard handles it)", [
  refIntervalRuleChanges(ri(ins(20))), refIntervalRuleChanges(ri([...ins(17), 120, 150, 160])), refIntervalRuleChanges(null), refIntervalRuleChanges({ specimens: "x" }),
], [false, false, false, false]);
check("heldForVerdictRuleDecision names the reference range hold", [heldForVerdictRuleDecision({ study_type: "ref_interval", data_points: JSON.stringify(ri([...ins(18), null, null])) }), heldForVerdictRuleDecision({ study_type: "ref_interval", data_points: JSON.stringify(ri(ins(20))) })], ["ref_interval", null]);
check("hold reasons: blank; censored and under 20 results (exclude); censored only (substitute)", [
  refIntervalHoldReasons(ri([...ins(20), null]), "exclude"), refIntervalHoldReasons(ri([...ins(19), C(120)]), "exclude"), refIntervalHoldReasons(ri([...ins(19), C(120)]), "substitute_lld"),
], [
  { blank: true, censored: false, fewerThan20Results: false, other: false },
  { blank: false, censored: true, fewerThan20Results: true, other: false },
  { blank: false, censored: true, fewerThan20Results: false, other: false },
]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
