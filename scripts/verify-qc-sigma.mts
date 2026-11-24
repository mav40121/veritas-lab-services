// scripts/verify-qc-sigma.mts
//
// Math receipt for the VeritaQC sigma metric (B12; shared/qcSigma.ts). Hand-worked numbers, made-up runs.
// Run: npx tsx scripts/verify-qc-sigma.mts
import { allowablePercent, computeSigma, SIGMA_FORMULA, type AllowableErrorSetting } from "../shared/qcSigma";
import { CLIA_PRESETS } from "../shared/cliaPresets";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const near = (a: number | null, b: number, e = 1e-9) => a !== null && Math.abs(a - b) < e;
const A = (o: Partial<AllowableErrorSetting>): AllowableErrorSetting => ({ preset_label: null, percent: null, units_value: null, unit: null, ...o });
const peer = (value: number) => ({ value, source: "peer" as const, note: null });
const mfr = (value: number) => ({ value, source: "manufacturer" as const, note: null });

// Mean 102, SD 2 (values 100, 102, 104): CV 1.9607843137...%, bias against 100 is +2%, allowable 10%: (10 - 2) / 1.96078 = 4.08
const r = computeSigma({ values: [100, 102, 104], target: peer(100), allowable: A({ percent: 10 }) });
check("sigma = (10 - 2) / 1.9607843 = 4.08", near(r.sigma, 4.08) && near(r.bias_percent, 2) && near(r.cv_percent, 200 / 102) && r.n === 3 && r.from_few_runs && !r.missing.length, r);
// The same size of bias below the target gives the same sigma
const below = computeSigma({ values: [96, 98, 100], target: peer(100), allowable: A({ percent: 10 }) });
check("a bias below the target counts by its size", near(below.bias_percent, -2) && near(below.sigma, 8 / (200 / 98)), below);
check("a bias past the allowable error gives a number below 0, not a word", (computeSigma({ values: [110, 112, 114], target: peer(100), allowable: A({ percent: 10 }) }).sigma ?? 0) < 0);
check("20 runs isn't few, 19 is", !computeSigma({ values: Array.from({ length: 20 }, (_x, i) => 100 + (i % 2)), target: mfr(100), allowable: A({ percent: 8 }) }).from_few_runs
  && computeSigma({ values: Array.from({ length: 19 }, (_x, i) => 100 + (i % 2)), target: mfr(100), allowable: A({ percent: 8 }) }).from_few_runs);

// Allowable error: a percent criterion, the greater of two, units
const pre = (label: string) => CLIA_PRESETS.find((p) => p.label.startsWith(label))!.label;
const gl = allowablePercent(A({ preset_label: pre("Glucose") }), 100) as any, glLow = allowablePercent(A({ preset_label: pre("Glucose") }), 50) as any;
check("Glucose, the greater of 8% and 6 mg/dL: 8% at 100, 12% at 50", near(gl.percent, 8) && near(glLow.percent, 12) && /6 mg\/dL/.test(glLow.how), { gl, glLow });
const na = allowablePercent(A({ preset_label: pre("Sodium") }), 140) as any;
check("Sodium, 4 mmol/L at 140 is 2.857%", near(na.percent, 400 / 140) && /4 mmol\/L at a target of 140 is 2.86%/.test(na.how), na);
check("a percent criterion needs no target", near((allowablePercent(A({ preset_label: pre("Albumin") }), null) as any).percent, 8));
check("units need a target", "missing" in allowablePercent(A({ preset_label: pre("Sodium") }), null) && "missing" in allowablePercent(A({ units_value: 4, unit: "mmol/L" }), null));
check("the laboratory's own units: 4 mmol/L at 140", near((allowablePercent(A({ units_value: 4, unit: "mmol/L" }), 140) as any).percent, 400 / 140));
check("a criterion no longer in the app isn't guessed", "missing" in allowablePercent(A({ preset_label: "Gone (±5%)" }), 100));

// Not enough to compute, and what is missing
const miss = (i: any) => computeSigma({ values: [100, 101, 102], target: peer(100), allowable: A({ percent: 10 }), ...i });
check("no allowable error", miss({ allowable: null }).sigma === null && miss({ allowable: null }).missing.join() === "an allowable error for this test", miss({ allowable: null }).missing);
check("no target", miss({ target: null }).sigma === null && /target mean/.test(miss({ target: null }).missing[0]));
check("a target of 0", miss({ target: mfr(0) }).sigma === null && /other than 0/.test(miss({ target: mfr(0) }).missing[0]));
check("no runs, and one run", /there are none/.test(miss({ values: [] }).missing[0]) && /second run/.test(miss({ values: [100] }).missing[0]));
check("runs all the same", miss({ values: [100, 100, 100] }).sigma === null && /CV is 0/.test(miss({ values: [100, 100, 100] }).missing[0]));
check("everything missing is listed once each", miss({ allowable: null, target: null, values: [] }).missing.length === 3, miss({ allowable: null, target: null, values: [] }).missing);
check("a units criterion with no target lists the target once", miss({ allowable: A({ units_value: 4, unit: "mmol/L" }), target: null }).missing.length === 1, miss({ allowable: A({ units_value: 4, unit: "mmol/L" }), target: null }).missing);
check("the lab's own mean is never the target", miss({ target: null }).bias_percent === null);
check("the formula is stated", SIGMA_FORMULA === "Sigma = (allowable error % - bias %) / CV %");

// No grading words and no suggested rules anywhere the metric is worked out or shown
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const f of ["shared/qcSigma.ts", "server/qcSigma.ts", "client/src/pages/VeritaQCSigmaPage.tsx"]) {
  const s = fs.readFileSync(path.join(root, f), "utf8").toLowerCase();
  const hit = ["world class", "world-class", "excellent", "good", "marginal", "poor", "unacceptable", "suggested rule", "recommended"].find((w) => new RegExp(`\\b${w}\\b`).test(s));
  check(`no grading word in ${f}`, !hit, hit);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
