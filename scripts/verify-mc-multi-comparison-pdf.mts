// scripts/verify-mc-multi-comparison-pdf.mts
//
// BUG-056 (2026-10-15): a Correlation / Method Comparison with three analyzers (LW Test Lab Sodium, study 1869:
// Fred primary, Barney and Wilma comparisons) printed only Fred vs Barney on page 1, and the header and
// supporting page named only Fred. BUG-053 class: screens summarizing studies kept a cached answer.
// Builds the report HTML with the same calculation the results page runs and checks:
//   1. page 1 (before "Continued from page 1") names both comparison analyzers
//   2. page 1 key statistics have one row per comparison with its own Deming slope
//   3. the narrative describes each comparison
//   4. the header lists all three analyzers; the supporting page lists each serial number
//   5. Bland-Altman limits for an absolute TEa read ±4 mmol/L, never ±400%
//   6. a percentage-TEa three-analyzer study shows ±X% limits
//   7. a two-analyzer study keeps the single-comparison page 1 (compact key statistics, no per-comparison table)
//   8. the client cache rule re-reads VeritaMap, VeritaCheck Coverage and VeritaTrack, and nothing else
// Usage: npx tsx scripts/verify-mc-multi-comparison-pdf.mts
import { buildMethodCompHTML } from "../server/pdfReport";
import { calculateMethodComparison, type DataPoint } from "../client/src/lib/calculations";
import { isStudyDerivedQuery } from "../client/src/lib/studyDerivedQueries";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };

const FRED = "Fred, Roche cobas 8000 (c702 module)", BARNEY = "Barney, Roche cobas 8000 (c702 module)", WILMA = "Wilma, Roche cobas 8000 (c702 module)";
// Study 1869 as saved on production (LW Test Lab, lab 37).
const rows = [[120, 122, 118], [130, 128, 131], [140, 143, 139]];
function build(names: string[], teaFraction: number, teaIsPct: 0 | 1, unit: string) {
  const dp: DataPoint[] = rows.map((r, i) => ({ level: i + 1, expectedValue: null, instrumentValues: Object.fromEntries(names.map((n, k) => [n, r[k]])) } as any));
  const [primary, ...comps] = names;
  const mapped: DataPoint[] = dp.map((d: any) => ({ ...d, expectedValue: d.instrumentValues[primary], instrumentValues: Object.fromEntries(comps.map((n) => [n, d.instrumentValues[n]])) }));
  const results = calculateMethodComparison(mapped, comps, teaFraction, teaIsPct !== 0, null);
  const study: any = {
    testName: "Sodium", studyType: "method_comparison", instrument: names.join(", "), instruments: JSON.stringify(names),
    analyst: "Michael Veri", date: "2026-10-14", cliaAllowableError: teaFraction, teaIsPercentage: teaIsPct, tea_is_percentage: teaIsPct,
    teaUnit: unit, tea_unit: unit, dataPoints: dp, status: "pass", lifecycle_state: "finalized",
    _instrumentDisplay: Object.fromEntries(names.map((n, k) => [String(k), { model: "Roche cobas 8000 (c702 module)", nickname: n.split(", ")[0], serial_number: ["1234", "4321", "789"][k] }])),
  };
  const html = buildMethodCompHTML(study, results as any);
  const page1 = html.split("Continued from page 1")[0];
  return { html, page1, results };
}

const a = build([FRED, BARNEY, WILMA], 4, 0, "mmol/L");
const keyStats = a.page1.slice(a.page1.indexOf("Key Statistics Summary"), a.page1.indexOf("STUDY NARRATIVE") > 0 ? a.page1.indexOf("STUDY NARRATIVE") : undefined);
check("1. page 1 names both comparison analyzers", a.page1.includes("(Barney)") && a.page1.includes("(Wilma)") && a.page1.includes("Wilma"), "");
const slopeB = (a.results.regression as any)[`${BARNEY} vs. Primary (Deming)`].slope, slopeW = (a.results.regression as any)[`${WILMA} vs. Primary (Deming)`].slope;
check("2. page 1 key statistics have a row per comparison with its own Deming slope",
  keyStats.includes("Barney") && keyStats.includes("Wilma") && keyStats.includes(slopeB.toFixed(4)) && keyStats.includes(slopeW.toFixed(4)),
  `slopes ${slopeB.toFixed(4)} / ${slopeW.toFixed(4)}`);
check("3. the narrative describes each comparison", /2 comparison analyzers were each compared/.test(a.page1) && /Barney: R [^;]*Deming slope/.test(a.page1) && /Wilma: R [^;]*Deming slope/.test(a.page1));
check("4. header lists all three analyzers; supporting page lists each serial",
  a.html.includes("Instruments: Roche cobas 8000 (c702 module) (Fred, Barney, Wilma)") && ["S/N: 1234", "S/N: 4321", "S/N: 789"].every((sn) => a.html.includes(sn)));
check("5. absolute TEa Bland-Altman limits read ±4 mmol/L, never ±400%", a.html.includes("limits ±4 mmol/L") && !a.html.includes("400%"));

const b = build([FRED, BARNEY, WILMA], 0.05, 1, "%");
check("6. percentage TEa three-analyzer study shows ±5% limits", b.html.includes("limits ±5%") && b.page1.includes("Wilma"));

const c = build([FRED, BARNEY], 4, 0, "mmol/L");
check("7. a two-analyzer study keeps the single-comparison page 1",
  c.page1.includes("Deming Slope") && !c.page1.includes("Comparison vs.") && /Pearson correlation coefficient/.test(c.page1) && c.html.includes("Instruments: Roche cobas 8000 (c702 module) (Fred, Barney)"));

const derived = ["/api/labs/37/veritamap/maps/145", "/api/labs/37/veritamap/maps", "/api/labs/37/veritacheck/coverage", "/api/veritamap/correlations/due-soon", "/api/labs/37/veritatrack/tasks"];
const notDerived = ["/api/labs/37/studies", "/api/auth/me", "/api/labs/37/competency/programs", "/api/labs/37/veritalab/registry"];
check("8. cache rule re-reads VeritaMap, Coverage and VeritaTrack only",
  derived.every((k) => isStudyDerivedQuery([k])) && notDerived.every((k) => !isStudyDerivedQuery([k])),
  JSON.stringify({ derived: derived.map((k) => isStudyDerivedQuery([k])), other: notDerived.map((k) => isStudyDerivedQuery([k])) }));

console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
