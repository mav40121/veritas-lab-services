// shared/lodFactor.ts
//
// BUG-190 (owner pick 2026-11-27, option 1): the factor a detection limit (LoD) multiplies the low-level SD by,
// LoD = LoB + cp x SD(low level). It is worked out here and nowhere else: calculateSensitivity (the form, the results
// page, the records export and the demo PDF all reach it), the PDF's printed working, and the admin change list.
//
// New calculations use the CLSI EP17-A2 parametric formula with the study's own numbers:
//   cp = 1.645 / (1 - 1/(4 x (L - K)))   L = low-level results, K = distinct low-level samples
// Until this change VeritaCheck read a table (labelled "EP17-A2 Table A1") whose values no source carries and which runs
// high (2.063 at 5 results where the formula gives 1.755), so LoD came out high. That table stays below, named as
// superseded, only to reproduce results saved with it: a saved study's input carries no cbetaMethod, and
// lodFactorMethodOf reads that as the table, so a study saved before keeps its numbers and its pass/fail until someone
// runs it again from Edit (buildSensitivityInput stamps the formula). Relative imports only: the server bundles this.

export type LodFactorMethod = "table_2026_05" | "ep17_formula";
export const LOD_FACTOR_FORMULA: LodFactorMethod = "ep17_formula";
export const LOD_FACTOR_SUPERSEDED_TABLE: LodFactorMethod = "table_2026_05";

/** The method a saved sensitivity input was worked out with. An input saved before BUG-190 names none: the table. */
export function lodFactorMethodOf(input: unknown): LodFactorMethod {
  return input && typeof input === "object" && (input as any).cbetaMethod === LOD_FACTOR_FORMULA ? LOD_FACTOR_FORMULA : LOD_FACTOR_SUPERSEDED_TABLE;
}

// SUPERSEDED 2026-11-27 (BUG-190). The factor table VeritaCheck used from its first sensitivity release until BUG-190,
// with linear interpolation between entries and 1.645 from 1000 results. No source could be traced for these values.
// Kept only so a study saved with it reproduces exactly; never use it for a new calculation.
const SUPERSEDED_TABLE_2026_05: ReadonlyArray<{ n: number; c: number }> = [
  { n: 5,    c: 2.063 }, { n: 10,   c: 1.831 }, { n: 15,   c: 1.766 },
  { n: 20,   c: 1.749 }, { n: 25,   c: 1.717 }, { n: 30,   c: 1.704 },
  { n: 40,   c: 1.683 }, { n: 50,   c: 1.671 }, { n: 60,   c: 1.660 },
  { n: 80,   c: 1.654 }, { n: 100,  c: 1.652 }, { n: 1000, c: 1.645 },
];
export function supersededTableFactor(n: number): number {
  const t = SUPERSEDED_TABLE_2026_05;
  if (n <= t[0].n) return t[0].c;
  if (n >= t[t.length - 1].n) return 1.645;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i], b = t[i + 1];
    if (n === a.n) return a.c;
    if (n > a.n && n < b.n) {
      const w = (n - a.n) / (b.n - a.n);
      return a.c + w * (b.c - a.c);
    }
  }
  return 1.645;
}

/** CLSI EP17-A2: cp = 1.645 / (1 - 1/(4 x (L - K))). NaN when L - K is under 1 (no degrees of freedom). */
export function ep17FormulaFactor(L: number, K: number): number {
  const df = L - K;
  if (!Number.isFinite(df) || df < 1) return NaN;
  return 1.645 / (1 - 1 / (4 * df));
}

/** A low-level result's sample. Lines with no sample label are one sample together. */
export const sampleLabelOf = (r: { sample?: unknown }): string => (typeof r?.sample === "string" ? r.sample.trim() : "");

/** The low-level results grouped by sample, in the order each sample first appears. */
export function lowLevelSamples<T extends { value: number; sample?: unknown }>(reps: T[]): { label: string; values: number[] }[] {
  const groups = new Map<string, number[]>();
  for (const r of reps) {
    const label = sampleLabelOf(r);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(r.value);
  }
  return Array.from(groups, ([label, values]) => ({ label, values }));
}

/** SD pooled within samples, on L - K degrees of freedom (one sample: the ordinary sample SD). 0 with none to spare. */
export function pooledSd(groups: { values: number[] }[]): number {
  let ss = 0, L = 0;
  for (const g of groups) {
    const n = g.values.length;
    if (n === 0) continue;
    const m = g.values.reduce((a, b) => a + b, 0) / n;
    ss += g.values.reduce((s, x) => s + (x - m) ** 2, 0);
    L += n;
  }
  const df = L - groups.filter((g) => g.values.length > 0).length;
  return df >= 1 ? Math.sqrt(ss / df) : 0;
}

/** What the report prints beside a formula factor. Null for the superseded table, whose printout stays as it was. */
export function lodFactorWorking(lod: { cbetaMethod?: unknown; cBeta?: unknown; nLowLevel?: unknown; nLowLevelSamples?: unknown } | null | undefined): string | null {
  if (!lod || lod.cbetaMethod !== LOD_FACTOR_FORMULA) return null;
  const cp = Number(lod.cBeta), L = Number(lod.nLowLevel), K = Number(lod.nLowLevelSamples);
  if (!Number.isFinite(cp) || !Number.isFinite(L) || !Number.isFinite(K)) return null;
  return `cp = 1.645 / (1 - 1/(4 x (L - K))) = ${cp.toFixed(3)} (L = ${L} result${L === 1 ? "" : "s"}, K = ${K} sample${K === 1 ? "" : "s"}; CLSI EP17-A2)`;
}

/** Why a low-level entry can't be run with the formula, or null. Every sample needs 2 results so L - K is at least 1. */
export function lowLevelSampleProblem<T extends { value: number; sample?: unknown }>(reps: T[]): string | null {
  const groups = lowLevelSamples(reps);
  if (groups.length > 1 && groups.some((g) => g.label === "")) return "Give every low-level line a sample label, or leave them all without one.";
  const short = groups.filter((g) => g.values.length < 2).map((g) => g.label || "the low-level sample");
  if (short.length > 0) return `Each low-level sample needs at least 2 results (${short.join(", ")} ${short.length === 1 ? "has" : "have"} fewer).`;
  return null;
}
