// server/rumke.ts
//
// Rümke confidence limits for MANUAL DIFFERENTIAL verification (CLSI H20).
//
// The acceptable spread of a differential percentage is not a fixed total
// allowable error: it is the BINOMIAL sampling error of counting a finite number
// of cells. Rümke's published tables are the exact (Clopper-Pearson) binomial
// 95% confidence limits for a proportion at N cells counted. We compute them
// analytically here — the exact interval reproduces Rümke's printed values — so
// there is no lookup table to maintain and any N is supported.
//
// Comparator model (Michael's Option 1): manual vs automated reference. The
// analyzer counts thousands of cells, so its percentage is treated as the target;
// a cell class is acceptable when the reference percentage falls within the
// binomial 95% CI of the MANUAL count (x of N). This is the standard "verify the
// manual differential / a tech against the automated differential." Low-frequency
// classes (eosinophils, basophils) get wide limits at N=100 that tighten at
// N=200 — the whole reason a percent TEa is the wrong tool for a manual diff.
//
// Pure + dependency-free (the production server has no scipy). Verified against
// published Rümke table values in scripts/verify-rumke.mts.

// --- Log-gamma (Lanczos approximation) -------------------------------------
function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

// --- Continued fraction for the incomplete beta (Numerical Recipes betacf) ---
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a,b).
function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// Inverse regularized incomplete beta: find x in (0,1) with I_x(a,b) = p, by
// bisection. 100 iterations gives ~1e-30 bracketing, far tighter than the 0.1%
// we report. I_x is monotone in x, so bisection is exact and robust.
function ibetaInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (ibeta(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Exact (Clopper-Pearson) binomial confidence interval for x successes in n
 * trials. Returns the interval as FRACTIONS in [0,1]. This is the Rümke limit.
 */
export function clopperPearson(x: number, n: number, alpha = 0.05): { lo: number; hi: number } {
  if (n <= 0 || x < 0 || x > n) return { lo: 0, hi: 0 };
  const lo = x === 0 ? 0 : ibetaInv(alpha / 2, x, n - x + 1);
  const hi = x === n ? 1 : ibetaInv(1 - alpha / 2, x + 1, n - x);
  return { lo, hi };
}

export interface DiffClassInput {
  name: string;
  manualCount: number; // cells of this class in the manual count (x of N)
  referencePct: number; // automated / reference percentage for this class
}
export interface DiffInput {
  cellsCounted: number; // N
  referenceSource?: string;
  classes: DiffClassInput[];
}
export interface DiffClassResult {
  name: string;
  manualCount: number;
  manualPct: number;
  referencePct: number;
  ciLoPct: number;
  ciHiPct: number;
  within: boolean;
}
export interface DiffResult {
  cellsCounted: number;
  referenceSource: string;
  classes: DiffClassResult[];
  overallPass: boolean;
  countSum: number; // sum of manual counts; should equal N for a valid 100/200-cell diff
}

const EPS = 1e-9;

/**
 * Evaluate a manual differential against an automated reference using Rümke 95%
 * limits. A class is "within" when the reference percentage falls inside the
 * binomial 95% CI of the manual count. Overall passes when every class is within.
 */
export function evaluateManualDiff(input: DiffInput): DiffResult {
  const N = Math.max(0, Math.floor(input.cellsCounted || 0));
  const classes: DiffClassResult[] = (input.classes || []).map((c) => {
    const x = Math.max(0, Math.floor(c.manualCount || 0));
    const { lo, hi } = clopperPearson(x, N);
    const manualPct = N > 0 ? (x / N) * 100 : 0;
    const ciLoPct = lo * 100;
    const ciHiPct = hi * 100;
    const ref = Number(c.referencePct);
    const within = Number.isFinite(ref) && ref >= ciLoPct - EPS && ref <= ciHiPct + EPS;
    return { name: c.name, manualCount: x, manualPct, referencePct: ref, ciLoPct, ciHiPct, within };
  });
  const countSum = classes.reduce((s, c) => s + c.manualCount, 0);
  return {
    cellsCounted: N,
    referenceSource: input.referenceSource || "",
    classes,
    overallPass: classes.length > 0 && classes.every((c) => c.within),
    countSum,
  };
}
