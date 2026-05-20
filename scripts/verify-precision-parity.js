// Ad-hoc parity check (2026-05-20). Reproduces the inverse-normal,
// inverse-chi-square, and inverse-Student's-t helpers from
// client/src/lib/calculations.ts and runs them against the Pfizer A-ALT
// dataset (EP Evaluator simple precision report dated 19 May 2026).
// Compare against the EE printed numbers to confirm we match.

function invStandardNormal(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  } else if (p <= pHigh) {
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
}
function invChiSquare(p, df) {
  const z = invStandardNormal(p);
  const a = 2 / (9 * df);
  const t = 1 - a + z * Math.sqrt(a);
  return df * t * t * t;
}
function invStudentT(p, df) {
  const z = invStandardNormal(p);
  const z2 = z * z, z3 = z2 * z, z5 = z3 * z2, z7 = z5 * z2;
  return z + (z3 + z) / (4 * df) + (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df)
    + (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df);
}

// Pfizer dataset from A-ALT Precision.pdf
const v = [21,23,22,22,22,21,23,23,21,21,21,21,22,21,22,22,22,21,23,21,22,22,21,21,22,21,22,19,21,20,19,21,19,19,21];
const n = v.length;
const meanVal = v.reduce((a, b) => a + b, 0) / n;
const variance = v.reduce((s, x) => s + (x - meanVal) ** 2, 0) / (n - 1);
const sdVal = Math.sqrt(variance);
const cvVal = (sdVal / meanVal) * 100;
const df = n - 1;
const chiSmall = invChiSquare(0.025, df); // small chi2 value -> large sigma -> upper CI for SD
const chiLarge = invChiSquare(0.975, df); // large chi2 value -> small sigma -> lower CI for SD
const sdCiLow = sdVal * Math.sqrt(df / chiLarge);
const sdCiHigh = sdVal * Math.sqrt(df / chiSmall);
const tCrit = invStudentT(0.975, df);
const meMargin = tCrit * sdVal / Math.sqrt(n);
const meanCiLow = meanVal - meMargin;
const meanCiHigh = meanVal + meMargin;
const twoSdLow = meanVal - 2 * sdVal;
const twoSdHigh = meanVal + 2 * sdVal;
const vendorSD = 1.57;
let vendorVerdict;
if (sdCiHigh <= vendorSD) vendorVerdict = "Pass";
else if (sdCiLow <= vendorSD) vendorVerdict = "Uncertain";
else vendorVerdict = "Fail";
const targetMean = 23.6;
const bias = meanVal - targetMean;
const pctBias = (bias / targetMean) * 100;

const fmt = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : "NA";
console.log("=== Pfizer A-ALT dataset (35 replicates) ===");
console.log(`N                 : ${n}`);
console.log(`Mean              : ${fmt(meanVal, 1)}    (EE says 21.3)`);
console.log(`SD                : ${fmt(sdVal, 1)}    (EE says 1.1)`);
console.log(`CV%               : ${fmt(cvVal, 1)}    (EE says 5.2)`);
console.log(`chi2(0.025, ${df})    : ${fmt(chiSmall, 3)}    (table: 19.806)`);
console.log(`chi2(0.975, ${df})    : ${fmt(chiLarge, 3)}    (table: 51.966)`);
console.log(`95% CI for SD     : ${fmt(sdCiLow, 1)} to ${fmt(sdCiHigh, 1)}    (EE says 0.9 to 1.4)`);
console.log(`t(0.975, ${df})       : ${fmt(tCrit, 4)}    (table: 2.0322)`);
console.log(`95% CI for Mean   : ${fmt(meanCiLow, 1)} to ${fmt(meanCiHigh, 1)}    (EE says 20.9 to 21.7)`);
console.log(`2 SD Range        : ${fmt(twoSdLow, 1)} to ${fmt(twoSdHigh, 1)}    (EE says 19.1 to 23.5)`);
console.log(`Vendor SD goal    : ${vendorSD}`);
console.log(`Vendor verdict    : ${vendorVerdict}    (EE says Yes / Pass)`);
console.log(`Target mean       : ${targetMean}`);
console.log(`Bias              : ${fmt(bias, 2)}`);
console.log(`% Bias            : ${fmt(pctBias, 2)}%`);
