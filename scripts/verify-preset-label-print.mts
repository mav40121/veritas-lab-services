// scripts/verify-preset-label-print.mts
//
// Receipt for Q275 = 1 (Michael 2026-11-10) and BUG-159: the preset name printed beside a VeritaCheck study's criterion, on
// the results screen and the PDF, comes from shared/studyCriterion.ts printedPresetLabel. Production had 25 saved studies
// whose label names a preset that isn't their stored criterion (16 at SCAHC and 3 at Troy labeled ALT/SGPT on other tests,
// a signed HbA1c study printing "±8.0% (ALT/SGPT (±15% or ±6 U/L))"); every verdict was the same under either criterion,
// so only the printed name was wrong. Made-up studies in memory, no database:
//   1. printedPresetLabel: a matching preset, Lab-defined and a form's own label (manual differential) print; a preset whose
//      criterion isn't the stored one, no label, and a type that sets its own criterion (PT/INR) don't.
//   2. The PDF: method comparison's supporting page, linearity's stat and supporting page, calibration verification's
//      supporting page print the stored criterion alone when the label doesn't describe it, and the label when it does.
//   3. Nothing else on the page changes: the criterion value still prints.
// Run: npx tsx scripts/verify-preset-label-print.mts
import * as studyCriterion from "../shared/studyCriterion";
import { CLIA_PRESETS } from "../shared/cliaPresets";
// Read through the module so the script runs (and reports FAIL) on code from before the helper existed.
const printedPresetLabel: (row: any, presets: any[]) => string | null = (studyCriterion as any).printedPresetLabel ?? (() => "printedPresetLabel missing");
import { buildCalVerHTML, buildMethodCompHTML, buildLinearityHTML } from "../server/pdfReport";
import { computeStudyResults } from "../client/src/lib/studyResults";

let failures = 0, passes = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const supportingOf = (html: string) => { const at = html.indexOf('class="supporting-page"'); return at < 0 ? "" : text(html.slice(html.lastIndexOf("<", at))); };
const ALT = "ALT/SGPT (±15% or ±6 U/L)", GLUCOSE = "Glucose (±8% or ±6 mg/dL)", ALBUMIN = "Albumin (±8%)";
const study = (over: Record<string, unknown>) => ({
  id: 1, testName: "Made-up", instrument: "Analyzer A", analyst: "Test Analyst", date: "2026-11-10",
  studyType: "cal_ver", cliaAllowableError: 0.15, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null,
  cliaPresetLabel: null, instruments: JSON.stringify(["Analyzer A"]), dataPoints: "[]", status: "pass", createdAt: "2026-11-10T12:00:00Z", ...over,
}) as any;
const label = (over: Record<string, unknown>) => printedPresetLabel(study(over), CLIA_PRESETS);

// 1. The rule
check("1a. a matching preset prints (Glucose ±8% or ±6 mg/dL)", label({ cliaAllowableError: 0.08, cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL", cliaPresetLabel: GLUCOSE }) === GLUCOSE);
check("1b. ALT/SGPT over ±15% with no floor (the 16 SCAHC rows' shape) prints nothing", label({ cliaPresetLabel: ALT }) === null);
check("1c. ALT/SGPT over ±8% (the signed HbA1c row) prints nothing", label({ cliaAllowableError: 0.08, cliaPresetLabel: ALT }) === null);
check("1d. ALT/SGPT over its own criterion (±15% or ±6 U/L) prints", label({ cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "U/L", cliaPresetLabel: ALT }) === ALT);
check("1e. Lab-defined prints", label({ cliaAllowableError: 0.05, cliaPresetLabel: "Lab-defined" }) === "Lab-defined");
check("1f. no label prints nothing", label({}) === null);
check("1g. PT/INR (sets its own criterion) prints nothing, even with ALT/SGPT saved (BUG-147, BUG-159)", label({ studyType: "pt_coag", cliaAllowableError: 0.2, cliaPresetLabel: ALT }) === null);
check("1h. a form's own label (manual differential, Rümke) prints as saved", label({ studyType: "manual_diff", cliaPresetLabel: "Rümke 95% CI (CLSI H20)" }) === "Rümke 95% CI (CLSI H20)");
check("1i. a database row (snake_case) reads the same", printedPresetLabel({ study_type: "method_comparison", clia_allowable_error: 0.15, tea_is_percentage: 1, clia_preset_label: ALT }, CLIA_PRESETS) === null);

// 2. The PDF
const mcPts = [5, 20, 45, 80, 120].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Analyzer B": +(v * 1.03).toFixed(2) } }));
const mc = (over: Record<string, unknown>) => { const s = study({ studyType: "method_comparison", instruments: JSON.stringify(["Analyzer A", "Analyzer B"]), dataPoints: JSON.stringify(mcPts), ...over }); return supportingOf(buildMethodCompHTML(s, computeStudyResults(s) as any)); };
const t3 = mc({ testName: "T3 UPTAKE (T3U-2)", cliaPresetLabel: ALT });
check("2a. method comparison, T3 Uptake labeled ALT/SGPT at ±15%: the criterion prints without ALT/SGPT", t3.length > 0 && !t3.includes("ALT/SGPT") && /±15(\.0)?%/.test(t3), t3.slice(0, 500));
const glu = mc({ testName: "Glucose", cliaAllowableError: 0.08, cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL", cliaPresetLabel: GLUCOSE });
check("2b. method comparison, Glucose with its own preset: the preset name still prints", glu.includes(`(${GLUCOSE})`), glu.slice(0, 500));

const linData = JSON.stringify({ analyte: "HbA1c", units: "%", levels: [5, 7, 9, 11].map((a, i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [a * 1.01, a, a * 0.99] })) });
const lin = (over: Record<string, unknown>) => { const s = study({ studyType: "linearity", dataPoints: linData, ...over }); return text(buildLinearityHTML(s, computeStudyResults(s) as any)); };
const a1c = lin({ testName: "HbA1c", cliaAllowableError: 0.08, cliaPresetLabel: ALT });
check("2c. linearity, HbA1c stored ±8% labeled ALT/SGPT (signed at SCAHC): no ALT/SGPT on any page, ±8 still printed", a1c.length > 0 && !a1c.includes("ALT/SGPT") && /±8(\.0)?%/.test(a1c), a1c.slice(0, 400));
const alb = lin({ testName: "Albumin", cliaAllowableError: 0.08, cliaPresetLabel: ALBUMIN });
check("2d. linearity, Albumin with its own preset: the preset name prints", alb.includes(`(${ALBUMIN})`), alb.slice(0, 400));

const cvPts = [50, 100, 150, 200, 250].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Analyzer A": +(v * 1.01).toFixed(1) } }));
const cv = (over: Record<string, unknown>) => { const s = study({ dataPoints: JSON.stringify(cvPts), ...over }); return supportingOf(buildCalVerHTML(s, computeStudyResults(s) as any)); };
const labDef = cv({ testName: "Made-up analyte", cliaAllowableError: 0.05, cliaPresetLabel: "Lab-defined" });
check("2e. calibration verification, Lab-defined: still prints (Lab-defined)", labDef.includes("(Lab-defined)"), labDef.slice(0, 400));
const altCv = cv({ testName: "PROBNP2", cliaPresetLabel: ALT });
check("2f. calibration verification, proBNP labeled ALT/SGPT at ±15% (SCAHC shape): no ALT/SGPT", altCv.length > 0 && !altCv.includes("ALT/SGPT"), altCv.slice(0, 400));
const none = cv({ testName: "Made-up analyte" });
check("2g. no label: the criterion alone, no empty parentheses", none.length > 0 && !none.includes("()") && /±15(\.0)?%/.test(none), none.slice(0, 400));

console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
