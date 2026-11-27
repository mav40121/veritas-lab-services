// scripts/verify-lod-cbeta-formula.mts
//
// Math receipt for BUG-190 (owner pick 2026-11-27, option 1): the detection-limit factor. New calculations use the CLSI
// EP17-A2 parametric formula cp = 1.645 / (1 - 1/(4 x (L - K))) with L low-level results and K low-level samples, and
// the SD pooled within samples; a study saved before (no cbetaMethod in its input) reproduces exactly with the
// superseded table. Hardcoded inputs, PASS / FAIL per case, exit 1 on any failure.
//   1. the formula at 5, 20 and 100 results from one sample (1.755, 1.667, 1.649), two cases with two samples, and
//      no factor when L - K is under 1
//   2. the superseded table still gives what it gave (2.063, 1.749, 1.652; interpolation at 12) and runs high
//   3. an input saved before reproduces main 25796039's results exactly (tests/integration/lodFactorFixture.ts)
//   4. a new calculation: cp from the formula, the LoD that follows, K counted from the sample labels, the SD pooled
//      within samples (checked by hand), and the printed working
//   5. the form's builder stamps the formula; a third value on a low-level line is its sample; Edit reads it back
//   6. a low-level entry the formula can't take is refused with a reason
// Run: npx tsx scripts/verify-lod-cbeta-formula.mts
import {
  ep17FormulaFactor, supersededTableFactor, lodFactorWorking, lodFactorMethodOf, lowLevelSamples, pooledSd, lowLevelSampleProblem,
  LOD_FACTOR_FORMULA, LOD_FACTOR_SUPERSEDED_TABLE,
} from "../shared/lodFactor";
import { calculateSensitivity } from "../client/src/lib/calculations";
import { buildSensitivityInput, parseLowLevelText, readStudyForms } from "../client/src/lib/studyFormPayload";
import { MAIN_INPUTS, MAIN_RESULTS, LOW20, LOW_TWO_SAMPLES, BLANKS } from "../tests/integration/lodFactorFixture";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const near = (a: number, b: number, tol = 1e-9) => Math.abs(a - b) <= tol;
const sd = (v: number[]) => { const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };

// ── 1. The formula ──
check("1a. L = 5, K = 1: cp = 1.645 / (1 - 1/16) = 1.75467 (prints 1.755)", near(ep17FormulaFactor(5, 1), 1.645 / 0.9375) && ep17FormulaFactor(5, 1).toFixed(3) === "1.755", String(ep17FormulaFactor(5, 1)));
check("1b. L = 20, K = 1: cp = 1.645 x 76/75 = 1.66693 (prints 1.667)", near(ep17FormulaFactor(20, 1), 1.645 * 76 / 75) && ep17FormulaFactor(20, 1).toFixed(3) === "1.667", String(ep17FormulaFactor(20, 1)));
check("1c. L = 100, K = 1: cp = 1.645 x 396/395 = 1.64916 (prints 1.649)", near(ep17FormulaFactor(100, 1), 1.645 * 396 / 395) && ep17FormulaFactor(100, 1).toFixed(3) === "1.649", String(ep17FormulaFactor(100, 1)));
check("1d. two samples, L = 20, K = 2: cp = 1.645 x 72/71 = 1.66817 (prints 1.668)", near(ep17FormulaFactor(20, 2), 1.645 * 72 / 71) && ep17FormulaFactor(20, 2).toFixed(3) === "1.668", String(ep17FormulaFactor(20, 2)));
check("1e. two samples, L = 10, K = 2: cp = 1.645 x 32/31 = 1.69806", near(ep17FormulaFactor(10, 2), 1.645 * 32 / 31), String(ep17FormulaFactor(10, 2)));
check("1f. no factor when L - K is under 1 (L = K = 3; L = 0)", Number.isNaN(ep17FormulaFactor(3, 3)) && Number.isNaN(ep17FormulaFactor(0, 0)) && Number.isNaN(ep17FormulaFactor(2, 3)));
check("1g. it falls toward 1.645 as L grows (L = 1000: 1.64541)", near(ep17FormulaFactor(1000, 1), 1.645 * 3996 / 3995) && ep17FormulaFactor(1000, 1) > 1.645);

// ── 2. The superseded table ──
check("2a. superseded table as it was: 2.063 at 5, 1.749 at 20, 1.652 at 100, 1.645 at 1000", supersededTableFactor(5) === 2.063 && supersededTableFactor(20) === 1.749 && supersededTableFactor(100) === 1.652 && supersededTableFactor(1000) === 1.645);
check("2b. ... interpolates (12 results: 1.831 + 0.4 x (1.766 - 1.831) = 1.805) and clamps below 5 (3 results: 2.063)", near(supersededTableFactor(12), 1.805) && supersededTableFactor(3) === 2.063);
check("2c. ... it runs high against the formula at 5, 20 and 100 results from one sample", [5, 20, 100].every((n) => supersededTableFactor(n) > ep17FormulaFactor(n, 1)),
  [5, 20, 100].map((n) => `${n}: ${supersededTableFactor(n)} vs ${ep17FormulaFactor(n, 1).toFixed(3)}`).join("; "));
check("2d. an input with no cbetaMethod reads as the table; only 'ep17_formula' reads as the formula",
  lodFactorMethodOf({}) === LOD_FACTOR_SUPERSEDED_TABLE && lodFactorMethodOf(null) === LOD_FACTOR_SUPERSEDED_TABLE && lodFactorMethodOf({ cbetaMethod: "other" }) === LOD_FACTOR_SUPERSEDED_TABLE && lodFactorMethodOf({ cbetaMethod: "ep17_formula" }) === LOD_FACTOR_FORMULA);

// ── 3. A study saved before reproduces exactly ──
for (const k of Object.keys(MAIN_INPUTS) as (keyof typeof MAIN_INPUTS)[]) {
  const now = calculateSensitivity(JSON.parse(JSON.stringify(MAIN_INPUTS[k])));
  check(`3. ${k}: saved before (no method) gives main 25796039's results exactly, every field and the summary`, JSON.stringify(now) === JSON.stringify(MAIN_RESULTS[k]), JSON.stringify(now.lod));
}

// ── 4. A new calculation ──
const est20 = calculateSensitivity({ ...MAIN_INPUTS.est20, cbetaMethod: LOD_FACTOR_FORMULA });
const sdLow = sd(LOW20.map((r) => r.value));
check("4a. one sample, 20 results: cp = 1.667, K = 1, the SD is the ordinary SD (bit for bit), method recorded",
  near(est20.lod.cBeta, 1.645 * 76 / 75) && est20.lod.nLowLevel === 20 && est20.lod.nLowLevelSamples === 1 && est20.lod.sdLowLevel === MAIN_RESULTS.est20.lod.sdLowLevel && est20.lod.cbetaMethod === "ep17_formula", JSON.stringify(est20.lod));
check("4b. ... LoD = LoB + cp x SD = 0.0073869 + 1.66693 x 0.0020229 = 0.0107590, lower than the table's 0.0109250",
  near(est20.lod.value, MAIN_RESULTS.est20.lob.parametric + (1.645 * 76 / 75) * sdLow, 1e-15) && near(est20.lod.value, 0.010759, 1e-6) && est20.lod.value < MAIN_RESULTS.est20.lod.value, String(est20.lod.value));
const ver20 = calculateSensitivity({ ...MAIN_INPUTS.ver20, cbetaMethod: LOD_FACTOR_FORMULA });
check("4c. the verification fixture: FAIL with the table (0.010925 > claim 0.0108), PASS with the formula (0.010759)", MAIN_RESULTS.ver20.overallPass === false && ver20.overallPass === true);
const est5 = calculateSensitivity({ ...MAIN_INPUTS.est5, cbetaMethod: LOD_FACTOR_FORMULA });
check("4d. 5 results: cp = 1.755 where the table gave 2.063", est5.lod.cBeta.toFixed(3) === "1.755" && MAIN_RESULTS.est5.lod.cBeta === 2.063);
const two = calculateSensitivity({ mode: "establishment", blanks: BLANKS, lowLevel: LOW_TWO_SAMPLES, cvThreshold: 0.2, biasThreshold: 0.25, cbetaMethod: LOD_FACTOR_FORMULA });
const s1 = LOW_TWO_SAMPLES.filter((r) => r.sample === "S1").map((r) => r.value), s2 = LOW_TWO_SAMPLES.filter((r) => r.sample === "S2").map((r) => r.value);
const pooledByHand = Math.sqrt(((s1.length - 1) * sd(s1) ** 2 + (s2.length - 1) * sd(s2) ** 2) / (s1.length + s2.length - 2));
check("4e. two samples (S1, S2): K = 2, L = 20, cp = 1.668", two.lod.nLowLevelSamples === 2 && two.lod.nLowLevel === 20 && near(two.lod.cBeta, 1.645 * 72 / 71), JSON.stringify(two.lod));
check("4f. ... SD pooled within samples = sqrt((9 s1^2 + 9 s2^2) / 18), by hand, not the SD of all 20 (which mixes the two levels)",
  near(two.lod.sdLowLevel, pooledByHand, 1e-15) && two.lod.sdLowLevel < sd([...s1, ...s2]) && near(pooledSd(lowLevelSamples(LOW_TWO_SAMPLES)), pooledByHand, 1e-15), `${two.lod.sdLowLevel} ${pooledByHand} ${sd([...s1, ...s2])}`);
check("4g. ... LoD = LoB + 1.66817 x pooled SD", near(two.lod.value, two.lob.parametric + (1.645 * 72 / 71) * pooledByHand, 1e-15));
check("4h. the printed working, one sample", lodFactorWorking(est20.lod) === "cp = 1.645 / (1 - 1/(4 x (L - K))) = 1.667 (L = 20 results, K = 1 sample; CLSI EP17-A2)", String(lodFactorWorking(est20.lod)));
check("4i. ... two samples", lodFactorWorking(two.lod) === "cp = 1.645 / (1 - 1/(4 x (L - K))) = 1.668 (L = 20 results, K = 2 samples; CLSI EP17-A2)", String(lodFactorWorking(two.lod)));
check("4j. ... a result saved with the table prints no working (its printout stays as it was)", lodFactorWorking(MAIN_RESULTS.est20.lod) === null && lodFactorWorking(null) === null);
check("4k. the summary names L, K and cp for a new calculation", est20.summary.includes("LoD = 0.011 (L = 20 low-level results, K = 1 sample, cp = 1.667)"), est20.summary);
check("4l. no 'Table A1' anywhere in a new result", !/Table A1/i.test(JSON.stringify([est20, two, ver20, est5])));

// ── 5. The form ──
const form = { mode: "establishment" as const, analyteName: "Made-up", units: "ng/mL", blanksText: BLANKS.map((b) => `${b.value},${b.lot}`).join("\n"),
  lowLevelText: "0.019,LotA,S1\n0.023,,S1\n0.020,LotB,S1\n0.031,,S2\n0.029,LotA,S2\n0.033,,S2", loqLevels: [], cvThreshold: 20, biasThreshold: 25, mfgLob: "", mfgLod: "", mfgLoq: "" };
const built = buildSensitivityInput(form);
check("5a. the builder stamps the EP17-A2 formula", built.cbetaMethod === "ep17_formula");
check("5b. a low-level line's third value is its sample, with or without a lot", JSON.stringify(built.lowLevel.slice(0, 2)) === JSON.stringify([{ value: 0.019, lot: "LotA", sample: "S1" }, { value: 0.023, sample: "S1" }]) && lowLevelSamples(built.lowLevel).length === 2, JSON.stringify(built.lowLevel));
check("5c. one or two values per line read exactly as before", JSON.stringify(parseLowLevelText("0.02\n0.025,LotA\n,0.03\nx\n")) === JSON.stringify([{ value: 0.02 }, { value: 0.025, lot: "LotA" }, { value: 0.03 }]), JSON.stringify(parseLowLevelText("0.02\n0.025,LotA\n,0.03\nx\n")));
const back = readStudyForms({ studyType: "sensitivity", dataPoints: JSON.stringify({ input: built, results: calculateSensitivity(built) }), teaUnit: "ng/mL" }).sensitivity!;
check("5d. Edit reads the sample back, and a re-run gives the same input", JSON.stringify(buildSensitivityInput({ ...back, mfgLob: "", mfgLod: "", mfgLoq: "" }).lowLevel) === JSON.stringify(built.lowLevel), back.lowLevelText);
const legacyBack = readStudyForms({ studyType: "sensitivity", dataPoints: JSON.stringify({ input: MAIN_INPUTS.est20, results: MAIN_RESULTS.est20 }), teaUnit: "ng/mL" }).sensitivity!;
check("5e. a study saved before, opened in Edit and run again, is recalculated with the formula (a person's act)", buildSensitivityInput(legacyBack).cbetaMethod === "ep17_formula" && calculateSensitivity(buildSensitivityInput(legacyBack)).lod.cBeta.toFixed(3) === "1.667");

// ── 6. What the formula can't take ──
check("6a. labeled and unlabeled lines mixed: refused", /every low-level line a sample label/.test(lowLevelSampleProblem([{ value: 1, sample: "S1" }, { value: 2, sample: "S1" }, { value: 3 }, { value: 4 }]) || ""));
check("6b. a sample with one result: refused, named", /needs at least 2 results \(S2 has fewer\)/.test(lowLevelSampleProblem([{ value: 1, sample: "S1" }, { value: 2, sample: "S1" }, { value: 3, sample: "S2" }]) || ""));
check("6c. one unlabeled sample of 5, and two labeled samples of 10: accepted", lowLevelSampleProblem(LOW20.slice(0, 5)) === null && lowLevelSampleProblem(LOW_TWO_SAMPLES) === null);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
