// scripts/verify-heparin-range.mjs
//
// Receipt for shared/heparinRange.ts (REQ-124, Michael Q134 = 1): the Heparin Therapeutic Range, aPTT vs Anti-Xa
// (Brill-Edwards) study. Known input = the 24 made-up samples from the approved mock (2 excluded), whose regression was
// computed independently by vls-ops/mock_heparin_range_brill_edwards.mjs: n 22, slope 87.6, intercept 32.4, r 0.983,
// aPTT 58.7 to 93.8 s at anti-Xa 0.3 to 0.7. Then every branch of the sample-set criteria.
// Run: node --import tsx scripts/verify-heparin-range.mjs
import { evaluateHeparinRange, heparinRangeNarrative, heparinRangeChartSVG } from "../shared/heparinRange.ts";

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
  if (!cond) failures++;
};
const near = (a, b, tol) => a !== null && Math.abs(a - b) <= tol;

const RAW = [
  [0.14, 44, 1.1, "P01"], [0.18, 49, 1.0, "P02"], [0.21, 53, 1.2, "P03"], [0.24, 50, 1.1, "P04"], [0.27, 59, 1.0, "P05"],
  [0.29, 54, 1.3, "P06"], [0.31, 63, 1.1, "P07"], [0.33, 58, 1.0, "P08"], [0.36, 68, 1.2, "P09"], [0.38, 64, 1.1, "P10"],
  [0.41, 71, 1.0, "P11"], [0.44, 67, 1.4, "P12"], [0.47, 77, 1.1, "P13"], [0.50, 72, 1.0, "P14"], [0.53, 82, 1.2, "P15"],
  [0.56, 79, 1.1, "P02"], [0.59, 88, 1.0, "P16"], [0.63, 84, 1.3, "P17"], [0.66, 93, 1.1, "P18"], [0.70, 90, 1.0, "P19"],
  [0.74, 99, 1.2, "P20"], [0.81, 104, 1.1, "P21"], [0.46, 112, 1.7, "P22", "INR above 1.5"], [0.58, 41, 1.0, "P23", "sample mismatch"],
];
const sample = ([antiXa, aptt, inr, patientCode, reason], i) => ({
  id: `S-${String(i + 1).padStart(2, "0")}`, patientCode, antiXa, aptt, inr, plasma: "fresh", exclude: !!reason, excludeReason: reason || "",
});
const base = () => ({ reagentLot: "APTT-2026-A", antiXaMethod: "Anti-Xa", targetLow: 0.3, targetHigh: 0.7, samples: RAW.map(sample) });

// 1. Known input
const k = evaluateHeparinRange(base());
check("1a. 22 included, 2 excluded, 24 entered", k.n === 22 && k.excludedCount === 2 && k.entered === 24, `${k.n}/${k.excludedCount}/${k.entered}`);
check("1b. slope 87.6 s per IU/mL", near(k.slope, 87.6, 0.05), k.slope?.toFixed(3));
check("1c. intercept 32.4 s", near(k.intercept, 32.4, 0.05), k.intercept?.toFixed(3));
check("1d. r 0.983", near(k.r, 0.983, 0.0005), k.r?.toFixed(4));
check("1e. aPTT at 0.3 = 58.7 s, at 0.7 = 93.8 s; reported 59 to 94", near(k.rangeLow, 58.7, 0.05) && near(k.rangeHigh, 93.8, 0.05) && k.rangeLowRounded === 59 && k.rangeHighRounded === 94, `${k.rangeLow?.toFixed(2)} ${k.rangeHigh?.toFixed(2)}`);
check("1f. one patient (P02) gives 2 of 22 = 9.1%: under 10%, met", k.maxPatientCount === 2 && near(k.maxPatientPct, 9.09, 0.01) && k.criteria.find((c) => c.key === "patient").met);
check("1g. the excluded INR 1.7 sample does not count against the INR criterion", k.inrAboveLimit === 0 && k.criteria.find((c) => c.key === "inr").met);
check("1h. every criterion met: the sample set meets; overallPass mirrors it", k.meets && k.overallPass);
check("1i. excluded samples carry no residual; included ones do", k.rows.filter((r) => !r.included).every((r) => r.residual === null) && k.rows.filter((r) => r.included).every((r) => r.residual !== null));

// 2. Each criterion fails on its own
const drop = (n) => { const b = base(); b.samples = b.samples.filter((s) => !s.exclude).slice(0, n); return b; };
const t19 = evaluateHeparinRange(drop(19));
check("2a. 19 samples: does not meet (minimum 20)", !t19.meets && !t19.criteria.find((c) => c.key === "n").met);
const t20 = evaluateHeparinRange(drop(20));
check("2b. 20 samples with P02 twice = 10.0%: not under 10%, does not meet", !t20.meets && near(t20.maxPatientPct, 10, 0.001) && !t20.criteria.find((c) => c.key === "patient").met);
const inr = base(); inr.samples[3].inr = 1.6;
const tInr = evaluateHeparinRange(inr);
check("2c. an included sample with INR 1.6: does not meet", !tInr.meets && tInr.inrAboveLimit === 1);
const inrEdge = base(); inrEdge.samples[3].inr = 1.5;
check("2d. INR exactly 1.5 is allowed (limit is above 1.5)", evaluateHeparinRange(inrEdge).meets);
const noReason = base(); noReason.samples[22].excludeReason = "";
const tNr = evaluateHeparinRange(noReason);
check("2e. an excluded sample with no reason: does not meet", !tNr.meets && !tNr.criteria.find((c) => c.key === "excluded").met);
const neg = base(); neg.samples = neg.samples.map((s) => ({ ...s, aptt: s.aptt === null ? null : 150 - s.aptt }));
const tNeg = evaluateHeparinRange(neg);
check("2f. aPTT falling as anti-Xa rises: does not meet (positive slope required)", !tNeg.meets && tNeg.slope < 0);
const blank = base(); blank.samples = blank.samples.map((s) => ({ ...s, patientCode: "" }));
check("2g. no patient codes: counted as one patient, does not meet", !evaluateHeparinRange(blank).meets);

// 3. r reports, never gates; INR is optional
const noisy = base(); noisy.samples = noisy.samples.map((s, i) => ({ ...s, aptt: s.aptt + (i % 2 ? 25 : -25) }));
const tNoisy = evaluateHeparinRange(noisy);
check("3a. a noisy set (r below 0.9) still meets when the sample criteria are met", tNoisy.meets && tNoisy.r < 0.9, `r ${tNoisy.r?.toFixed(3)}`);
const noInr = base(); noInr.samples = noInr.samples.map((s) => (s.exclude ? s : { ...s, inr: null }));
const tNoInr = evaluateHeparinRange(noInr);
check("3b. INR not entered: criterion met, each sample flagged, the count shown", tNoInr.meets && tNoInr.inrMissing === 22 && tNoInr.rows.filter((r) => r.flags.includes("INR not entered")).length === 22 && /INR not entered for 22/.test(tNoInr.criteria.find((c) => c.key === "inr").value));
const flagged = evaluateHeparinRange(base());
check("3c. INR 1.4 is flagged as above 1.3; INR 1.3 is not", flagged.rows[11].flags.includes("INR above 1.3") && !flagged.rows[5].flags.includes("INR above 1.3"));
const custom = base(); custom.targetLow = 0.35; custom.targetHigh = 0.7;
check("3d. targets come from the input (0.35 gives a higher low limit)", evaluateHeparinRange(custom).rangeLow > k.rangeLow);
check("3e. empty input does not throw and does not meet", (() => { try { const e = evaluateHeparinRange({}); return !e.meets && e.n === 0; } catch { return false; } })());

// 4. Narrative and chart
const nPass = heparinRangeNarrative(k, "APTT-2026-A", "Stago STA R Max 3");
const nFail = heparinRangeNarrative(t19, "APTT-2026-A", "Stago STA R Max 3");
check("4a. PASS and FAIL share one sentence; only 'meets' / 'does not meet' changes",
  nPass.determination === "The sample set meets the study criteria for an aPTT heparin therapeutic range."
  && nFail.determination === "The sample set does not meet the study criteria for an aPTT heparin therapeutic range.");
check("4b. the detail gives the range in whole seconds and ends with the director line", /is 59 to 94 seconds\./.test(nPass.detail) && nPass.detail.endsWith("Final approval and clinical determination must be made by the laboratory director or designee."));
check("4c. a FAIL names the unmet criterion and gives no instruction", /Criteria not met: samples from patients on unfractionated heparin \(19 included/.test(nFail.detail) && !/\b(do not|must not|should|repeat)\b/i.test(nFail.detail.replace("Final approval and clinical determination must be made", "")));
const svg = heparinRangeChartSVG(k);
check("4d. chart: 24 points, the fitted line, guides at 59 s and 94 s", (svg.match(/<circle /g) || []).length === 24 && svg.includes('stroke="#14141e"') && svg.includes(">59 s<") && svg.includes(">94 s<"));
check("4e. no em dash in narrative or chart", ![nPass.detail, nFail.detail, svg, ...k.criteria.map((c) => c.value + c.label)].some((t) => t.includes("—")));

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
