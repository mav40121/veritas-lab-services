// tests/integration/lodFactorFixture.ts
//
// BUG-190: made-up sensitivity inputs and what origin/main 25796039 (before the change) computed from them, so the
// receipts can show a study saved before reproduces exactly. MAIN_RESULTS was captured by running main's own
// calculateSensitivity on these inputs, before any BUG-190 code existed. Not a test by itself; used by
// scripts/verify-lod-cbeta-formula.mts and tests/integration/lod-cbeta-formula.test.ts.

export const BLANKS = [0.004, 0.006, 0.005, 0.007, 0.005, 0.004, 0.006, 0.005, 0.008, 0.005, 0.006, 0.004, 0.005, 0.007, 0.006, 0.005, 0.004, 0.006, 0.005, 0.007]
  .map((v, i) => ({ value: v, lot: i < 10 ? "LotA" : "LotB" }));
export const LOW20 = [0.019, 0.023, 0.020, 0.025, 0.021, 0.018, 0.022, 0.024, 0.020, 0.021, 0.023, 0.019, 0.022, 0.020, 0.024, 0.021, 0.018, 0.023, 0.022, 0.020].map((value) => ({ value }));
export const LOW5 = LOW20.slice(0, 5);

/** The inputs as main saved them: no cbetaMethod and no sample labels. */
export const MAIN_INPUTS = {
  est20: { mode: "establishment" as const, blanks: BLANKS, lowLevel: LOW20, cvThreshold: 0.2, biasThreshold: 0.25 },
  est5: { mode: "establishment" as const, blanks: BLANKS, lowLevel: LOW5, cvThreshold: 0.2, biasThreshold: 0.25 },
  // The claim sits between the formula's LoD (0.010759) and the table's (0.010925): FAIL as saved, PASS with the formula.
  ver20: { mode: "verification" as const, blanks: BLANKS, lowLevel: LOW20, cvThreshold: 0.2, biasThreshold: 0.25, manufacturerClaim: { lob: 0.009, lod: 0.0108 } },
};

const LOB = { parametric: 0.007386944411085372, nonParametric: 0.007050000000000001, meanBlank: 0.005500000000000001, sdBlank: 0.001147078669352809, nBlank: 20,
  byLot: { LotA: { mean: 0.0055, sd: 0.0012692955176439847, n: 10, lobParametric: 0.007587991126524354, lobNonParametric: 0.007549999999999999 },
    LotB: { mean: 0.005499999999999999, sd: 0.0010801234497346433, n: 10, lobParametric: 0.007276803074813487, lobNonParametric: 0.007 } } };

/** calculateSensitivity on origin/main 25796039, exactly as it returned (JSON). */
export const MAIN_RESULTS: Record<keyof typeof MAIN_INPUTS, any> = {
  est20: { type: "sensitivity", mode: "establishment", lob: LOB,
    lod: { value: 0.010924988233892725, lobUsed: 0.007386944411085372, cBeta: 1.749, sdLowLevel: 0.0020228952674713283, nLowLevel: 20 }, loq: null, overallPass: true,
    summary: "Analytical sensitivity established per CLSI EP17-A2. LoB = 0.007 (parametric, n=20); LoD = 0.011 (n=20 low-level replicates, Cβ=1.749). PASSED the establishment criterion." },
  est5: { type: "sensitivity", mode: "establishment", lob: LOB,
    lod: { value: 0.012355306334295074, lobUsed: 0.007386944411085372, cBeta: 2.063, sdLowLevel: 0.0024083189157584595, nLowLevel: 5 }, loq: null, overallPass: true,
    summary: "Analytical sensitivity established per CLSI EP17-A2. LoB = 0.007 (parametric, n=20); LoD = 0.012 (n=5 low-level replicates, Cβ=2.063). PASSED the establishment criterion." },
  ver20: { type: "sensitivity", mode: "verification", lob: LOB,
    lod: { value: 0.010924988233892725, lobUsed: 0.007386944411085372, cBeta: 1.749, sdLowLevel: 0.0020228952674713283, nLowLevel: 20 }, loq: null,
    manufacturerClaim: { lob: 0.009, lod: 0.0108 }, overallPass: false,
    summary: "Manufacturer's analytical sensitivity claim verification per CLSI EP17-A2. Observed LoB = 0.007 (claim: 0.009); Observed LoD = 0.011 (claim: 0.0108). FAILED the verification criterion." },
};

/** The PDF's key figures and narrative on main 25796039 (PyMuPDF text, whitespace folded), for a study named
 *  "Made-up Troponin" in ng/mL: from "ANALYTE" to the regulatory box. Β is the capital beta the label's uppercase
 *  style prints; β the summary's own. */
export const MAIN_PDF_STATS = {
  est20: "ANALYTE Made-up Troponin (ng/mL) STUDY MODE Establishment (full EP17-A2) LOB (PARAMETRIC) 0.0074 ng/mL LOB (NON-PARAMETRIC) 0.0071 ng/mL LOD 0.0109 ng/mL LOQ Not assessed BLANK REPLICATES (N) 20 LOW-LEVEL REPLICATES (N) 20 CΒ (FINITE-SAMPLE CORRECTION) 1.749 RESULT Meets CLSI EP17-A2 establishment criteria STUDY NARRATIVE SUMMARY Analytical sensitivity established per CLSI EP17-A2. LoB = 0.007 (parametric, n=20); LoD = 0.011 (n=20 low-level replicates, Cβ=1.749). PASSED the establishment criterion. The analytical sensitivity for Made-up Troponin meets the criteria for establishment of performance specifications per 42 CFR §493.1253(b)(2)(iii) and CLSI EP17-A2. Final approval and clinical determination must be made by the laboratory director or designee.",
  ver20: "ANALYTE Made-up Troponin (ng/mL) STUDY MODE Verification (mfg claim) LOB (PARAMETRIC) 0.0074 ng/mL LOB (NON-PARAMETRIC) 0.0071 ng/mL LOD 0.0109 ng/mL LOQ Not assessed BLANK REPLICATES (N) 20 LOW-LEVEL REPLICATES (N) 20 CΒ (FINITE-SAMPLE CORRECTION) 1.749 CLAIMED LOB 0.0090 ng/mL CLAIMED LOD 0.0108 ng/mL RESULT Does not verify manufacturer's sensitivity claims per CLSI EP17-A2 STUDY NARRATIVE SUMMARY Manufacturer's analytical sensitivity claim verification per CLSI EP17-A2. Observed LoB = 0.007 (claim: 0.009); Observed LoD = 0.011 (claim: 0.0108). FAILED the verification criterion. The analytical sensitivity for Made-up Troponin does not verify the manufacturer's published claims per 42 CFR §493.1253(b)(1) and CLSI EP17-A2. Final approval and clinical determination must be made by the laboratory director or designee.",
};

/** Two made-up low-level samples, 10 results each, for the K = 2 case (L = 20, L - K = 18). */
export const LOW_TWO_SAMPLES = [
  ...[0.019, 0.023, 0.020, 0.025, 0.021, 0.018, 0.022, 0.024, 0.020, 0.021].map((value) => ({ value, sample: "S1" })),
  ...[0.031, 0.029, 0.033, 0.030, 0.028, 0.032, 0.030, 0.034, 0.029, 0.031].map((value) => ({ value, sample: "S2" })),
];
