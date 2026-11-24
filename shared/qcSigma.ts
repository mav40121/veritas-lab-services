// shared/qcSigma.ts
//
// The sigma metric of one control lot (B12, 2026-11-24): (allowable error % - bias %) / CV %, where bias is the size of the
// difference between the lab's mean and the target, whichever side it falls on. Worked out on the server (server/qcSigma.ts) and
// pinned by scripts/verify-qc-sigma.mts. The number only: no grade, no color, no suggested rules.
//
// The target is the peer group mean the lab entered for the lot, else the manufacturer's mean on the lot. Never the lab's own mean.

import { CLIA_PRESETS } from "./cliaPresets";

export const SIGMA_FEW_RUNS = 20;
export const SIGMA_FORMULA = "Sigma = (allowable error % - bias %) / CV %";

/** What the lab set for a test: one of the app's regulatory criteria by its label, a percent, or an amount in the test's units. */
export interface AllowableErrorSetting { preset_label: string | null; percent: number | null; units_value: number | null; unit: string | null }
export interface SigmaTarget { value: number; source: "peer" | "manufacturer"; note: string | null }
export interface SigmaInput { values: number[]; target: SigmaTarget | null; allowable: AllowableErrorSetting | null }

export interface SigmaResult {
  sigma: number | null;
  missing: string[];            // what isn't there to compute it, in plain words
  n: number;
  from_few_runs: boolean;       // fewer than 20 runs: the number is shown with "from N runs"
  mean: number | null; sd: number | null; cv_percent: number | null;
  target: SigmaTarget | null;
  bias_percent: number | null;  // with its sign; the formula uses its size
  allowable_percent: number | null;
  allowable_how: string | null; // where the allowable error percent came from
}

const num = (x: number): string => (Number.isInteger(x) ? String(x) : String(Number(x.toPrecision(6))));
const pct = (x: number): string => num(Number(x.toFixed(2)));

/** The allowable error as a percent of the target, and how it was worked out. An amount in units, or a criterion's floor, needs the target. */
export function allowablePercent(a: AllowableErrorSetting, target: number | null): { percent: number; how: string } | { missing: string } {
  const at = (amount: number) => (target !== null && target !== 0 ? (Math.abs(amount) / Math.abs(target)) * 100 : null);
  if (a.preset_label) {
    const p = CLIA_PRESETS.find((x) => x.label === a.preset_label && x.value > 0) as any;
    if (!p) return { missing: "an allowable error (the criterion chosen isn't in the app any more)" };
    if (p.isPercentage === false) {
      const percent = at(p.value);
      return percent === null ? { missing: "a target to turn the criterion's units into a percent" } : { percent, how: `${p.label}, ${p.cfr}: ${num(p.value)} ${p.unit} at a target of ${num(target!)} is ${pct(percent)}%` };
    }
    const own = p.value * 100;
    if (!p.absoluteFloor) return { percent: own, how: `${p.label}, ${p.cfr}` };
    const floor = at(p.absoluteFloor);
    if (floor === null) return { missing: "a target to read the criterion's units as a percent" };
    return floor > own
      ? { percent: floor, how: `${p.label}, ${p.cfr}: the greater is ${num(p.absoluteFloor)} ${p.absoluteUnit}, which at a target of ${num(target!)} is ${pct(floor)}%` }
      : { percent: own, how: `${p.label}, ${p.cfr}: the greater is ${pct(own)}% at a target of ${num(target!)}` };
  }
  if (a.percent !== null) return { percent: a.percent, how: `${num(a.percent)}%, entered by the laboratory` };
  if (a.units_value !== null) {
    const percent = at(a.units_value);
    const what = `${num(a.units_value)}${a.unit ? ` ${a.unit}` : ""}`;
    return percent === null ? { missing: "a target to turn the allowable error's units into a percent" } : { percent, how: `${what}, entered by the laboratory: at a target of ${num(target!)} that is ${pct(percent)}%` };
  }
  return { missing: "an allowable error for this test" };
}

export function computeSigma(input: SigmaInput): SigmaResult {
  const { values, target, allowable } = input;
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : null;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, x) => s + (x - mean!) ** 2, 0) / (n - 1)) : null;
  const cv = sd !== null && mean !== null && mean !== 0 ? (sd / Math.abs(mean)) * 100 : null;
  const usable = target && Number.isFinite(target.value) && target.value !== 0 ? target : null;
  const bias = usable && mean !== null ? ((mean - usable.value) / Math.abs(usable.value)) * 100 : null;
  const tea = allowable ? allowablePercent(allowable, usable?.value ?? null) : { missing: "an allowable error for this test" };
  const missing: string[] = [];
  if (!usable) missing.push(target ? "a target other than 0 (bias is a percent of the target)" : "a target mean (the manufacturer's on the lot, or a peer mean)");
  if ("missing" in tea && !(usable === null && /^a target /.test(tea.missing))) missing.push(tea.missing);
  if (n < 2) missing.push(n === 0 ? "runs (there are none)" : "a second run (there is 1)");
  else if (mean === 0) missing.push("a mean other than 0 (CV is a percent of the mean)");
  else if (sd === 0) missing.push("runs that differ (every run has the same value, so CV is 0)");
  const percent = "percent" in tea ? tea.percent : null;
  const ok = !missing.length && percent !== null && bias !== null && cv !== null && cv > 0;
  return {
    sigma: ok ? (percent! - Math.abs(bias!)) / cv! : null,
    missing, n, from_few_runs: n < SIGMA_FEW_RUNS, mean, sd, cv_percent: cv, target: usable ?? target, bias_percent: bias,
    allowable_percent: percent, allowable_how: "how" in tea ? tea.how : null,
  };
}
