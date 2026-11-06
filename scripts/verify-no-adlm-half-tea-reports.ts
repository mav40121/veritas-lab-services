// scripts/verify-no-adlm-half-tea-reports.ts
//
// Receipt for Q210 = 1 (Michael 2026-11-06): no source exists for an "ADLM recommends half of CLIA TEa" goal, so VeritaCheck
// reports drop that sentence and its +/-X% with no substitute. Runs every narrative branch that used to carry it, through the
// same builders and the same calculations the PDF route uses, on made-up data:
//   calibration verification, one analyzer and several; calibration verification + correlation; precision, simple and advanced;
//   a percentage TEa with the worst error inside half, between half and full, and failing; an absolute TEa passing and failing.
// Each report must: carry no ADLM wording and no half value, keep its PASS or FAIL determination, end the narrative on the
// closing sentence, and read cleanly where the sentence came out. The FAIL branches name the same structure as the PASS ones.
//
// Run: npx tsx scripts/verify-no-adlm-half-tea-reports.ts        (exit 1 on any FAIL)
//      Add --print to see every narrative. RENDER_DIR=<dir> also writes each case as a real PDF.
import fs from "node:fs";
import path from "node:path";
import { buildCalVerHTML, buildCalVerCorrelationHTML, buildPrecisionHTML, generatePDFBuffer } from "../server/pdfReport";
import { calculateCalVer, calculateCalVerCorrelation, calculatePrecision } from "../client/src/lib/calculations";

const CLOSING = "Final approval and clinical determination must be made by the laboratory director or designee.";
const A = "Made-up Analyzer A", B = "Made-up Analyzer B";
const LEVELS = [50, 100, 150, 200, 250];

type Case = { name: string; study: any; results: any; html: string; pass: boolean; half: string | null };
const base = (over: any) => ({ id: 99000, userId: 1, analyst: "Made-up Analyst", date: "2026-11-06", _labName: "Made-up Laboratory", _cliaNumber: "99D9999999", _preferredStandards: ["TJC"], ...over });
const tea = (t: number, pct: boolean, unit: string) => ({ cliaAllowableError: t, teaIsPercentage: pct ? 1 : 0, tea_is_percentage: pct ? 1 : 0, teaUnit: unit, tea_unit: unit, cliaAbsoluteFloor: null, clia_absolute_floor: null });

const cases: Case[] = [];

// Recovery pattern: offs[i] is added as a fraction (percent TEa) or in units (absolute TEa).
function calVer(name: string, testName: string, names: string[], t: number, pct: boolean, unit: string, offs: number[], assigned = LEVELS) {
  const dp: any[] = assigned.map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: Object.fromEntries(names.map((n, k) => [n, +(pct ? v * (1 + offs[i] * (k === 0 ? 1 : 0.8)) : v + offs[i] * (k === 0 ? 1 : 0.8)).toFixed(3)])) }));
  const results = calculateCalVer(dp, names, t, pct, null) as any;
  const study: any = base({ testName, studyType: "cal_ver", instrument: names.join(", "), instruments: JSON.stringify(names), dataPoints: JSON.stringify(dp), status: results.overallPass ? "pass" : "fail", ...tea(t, pct, unit) });
  cases.push({ name, study, results, html: buildCalVerHTML(study, results), pass: results.overallPass, half: pct ? (t * 50).toFixed(1) : null });
}
function calVerCorr(name: string, testName: string, t: number, pct: boolean, unit: string, offs: number[], assigned = LEVELS) {
  const names = [A, B];
  const dp: any[] = assigned.map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: Object.fromEntries(names.map((n, k) => [n, +(pct ? v * (1 + offs[i] * (k === 0 ? 1 : 0.8)) : v + offs[i] * (k === 0 ? 1 : 0.8)).toFixed(3)])) }));
  const results = calculateCalVerCorrelation(dp, names, t, pct, null) as any;
  const study: any = base({ testName, studyType: "cal_ver_correlation", material: "Made-up linearity set", instrument: names.join(", "), instruments: JSON.stringify(names), dataPoints: JSON.stringify(dp), status: results.overallPass ? "pass" : "fail", ...tea(t, pct, unit) });
  cases.push({ name, study, results, html: buildCalVerCorrelationHTML(study, results), pass: results.overallPass, half: pct ? (t * 50).toFixed(1) : null });
}
function precision(name: string, testName: string, t: number, spread: number, advanced = false) {
  // Two levels, twenty replicates; the spread sets the CV.
  const rep = (mean: number) => Array.from({ length: 20 }, (_, i) => +(mean * (1 + spread * (i % 2 ? 1 : -1))).toFixed(3));
  const day = (mean: number, d: number) => Array.from({ length: 5 }, (_, i) => +(mean * (1 + spread * (i % 2 ? 1 : -1) + d * 0.0005)).toFixed(3));
  const dp: any[] = advanced
    ? [50, 200].map((m, k) => ({ level: k + 1, levelName: `Level ${k + 1}`, values: [], days: [0, 1, 2, 3, 4].map((d) => day(m, d)), numDays: 5, runsPerDay: 1, replicatesPerRun: 5 }))
    : [50, 200].map((m, k) => ({ level: k + 1, levelName: `Level ${k + 1}`, values: rep(m) }));
  const results = calculatePrecision(dp, t, advanced ? "advanced" : "simple", {}) as any;
  const study: any = base({ testName, studyType: "precision", instrument: A, instruments: JSON.stringify([A]), dataPoints: JSON.stringify(dp), status: results.overallPass ? "pass" : "fail", ...tea(t, true, "%") });
  cases.push({ name, study, results, html: buildPrecisionHTML(study, results), pass: results.overallPass, half: (t * 50).toFixed(1) });
}

const INSIDE_HALF = [0.01, -0.012, 0.008, -0.01, 0.005];    // worst error 1.2% against the 8% TEa; half is 4.0%
const BETWEEN = [0.07, -0.06, 0.03, -0.02, 0.05];           // worst 7%: inside the 8% TEa, outside half of it
const FAILING = [0.15, -0.02, 0.03, -0.02, 0.05];           // worst 15%: outside the 8% TEa
const ABS_PASS = [1, -1, 0.5, -0.5, 0.2];                   // within 4 mmol/L
const ABS_FAIL = [9, -1, 0.5, -0.5, 0.2];                   // one level outside 4 mmol/L
const SODIUM = [118, 130, 142, 153, 165];

calVer("cal ver, one analyzer, % TEa, inside half", "Albumin", [A], 0.08, true, "%", INSIDE_HALF);
calVer("cal ver, one analyzer, % TEa, between half and full", "Albumin", [A], 0.08, true, "%", BETWEEN);
calVer("cal ver, one analyzer, % TEa, fails", "Albumin", [A], 0.08, true, "%", FAILING);
calVer("cal ver, one analyzer, the lab's own number, inside half", "Albumin", [A], 0.1, true, "%", INSIDE_HALF);
calVer("cal ver, one analyzer, absolute TEa, passes", "Sodium", [A], 4, false, "mmol/L", ABS_PASS, SODIUM);
calVer("cal ver, one analyzer, absolute TEa, fails", "Sodium", [A], 4, false, "mmol/L", ABS_FAIL, SODIUM);
calVer("cal ver, two analyzers, % TEa, inside half", "Albumin", [A, B], 0.08, true, "%", INSIDE_HALF);
calVer("cal ver, two analyzers, % TEa, between half and full", "Albumin", [A, B], 0.08, true, "%", BETWEEN);
calVer("cal ver, two analyzers, % TEa, fails", "Albumin", [A, B], 0.08, true, "%", FAILING);
calVer("cal ver, two analyzers, absolute TEa, passes", "Sodium", [A, B], 4, false, "mmol/L", ABS_PASS, SODIUM);
calVer("cal ver, two analyzers, absolute TEa, fails", "Sodium", [A, B], 4, false, "mmol/L", ABS_FAIL, SODIUM);
calVerCorr("cal ver + correlation, % TEa, inside half", "Albumin", 0.08, true, "%", INSIDE_HALF);
calVerCorr("cal ver + correlation, % TEa, between half and full", "Albumin", 0.08, true, "%", BETWEEN);
calVerCorr("cal ver + correlation, % TEa, fails", "Albumin", 0.08, true, "%", FAILING);
calVerCorr("cal ver + correlation, absolute TEa, passes", "Sodium", 4, false, "mmol/L", ABS_PASS, SODIUM);
calVerCorr("cal ver + correlation, absolute TEa, fails", "Sodium", 4, false, "mmol/L", ABS_FAIL, SODIUM);
precision("precision, simple, inside half", "Albumin", 0.08, 0.02);
precision("precision, simple, between half and full", "Albumin", 0.08, 0.07);
precision("precision, simple, fails", "Albumin", 0.08, 0.15);
precision("precision, advanced, inside half", "Albumin", 0.08, 0.02, true);
precision("precision, advanced, between half and full", "Albumin", 0.08, 0.07, true);

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `  :: ${detail}`}`); if (!ok) fails++; };
const narrativeOf = (html: string) => (html.match(/Study Narrative Summary<\/div>\s*<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
const plain = (s: string) => s.replace(/<[^>]+>/g, "");
const PRINT = process.argv.includes("--print");
const CLAIM = /ADLM|half of (?:the )?CLIA|half[- ]TEa|internal (?:precision )?goal of|internal precision goal|enhanced quality assurance|well above the/i;

(async () => {
  // The cases mean what their names say, or the rest proves nothing.
  const expectPass = (name: string, want: boolean) => check(`${name}: reads ${want ? "PASS" : "FAIL"}`, cases.find((c) => c.name === name)!.pass === want);
  for (const c of cases) expectPass(c.name, !c.name.includes("fails"));

  for (const c of cases) {
    const n = narrativeOf(c.html);
    const text = plain(n);
    if (PRINT) console.log(`\n--- ${c.name}\n${text}\n`);
    check(`${c.name}: has a narrative`, text.length > 0);
    const hit = c.html.match(CLAIM);
    check(`${c.name}: no ADLM or half-TEa wording anywhere in the report`, !hit, hit ? hit[0] : "");
    if (c.half) {
      const halfSign = [`±${c.half}%`, `&plusmn;${c.half}%`];
      check(`${c.name}: the half value ±${c.half}% is not in the narrative`, !halfSign.some((h) => n.includes(h)), text);
    }
    check(`${c.name}: narrative ends on the closing sentence`, text.trim().endsWith(CLOSING), text.slice(-120));
    check(`${c.name}: determination is in bold and matches the outcome`,
      /<b>[^<]*(?:evaluated against)[^<]*<\/b>/.test(n) && (c.pass ? /satisfied this criterion/ : /did not satisfy this criterion/).test(n) && !(c.pass ? /did not satisfy/ : /All levels (?:on every analyzer )?satisfied/).test(n));
    const seam = text.match(/ {2,}|\s[.,;]|\.\.|; \.|, \./);
    check(`${c.name}: reads cleanly where the sentence came out`, !seam, seam ? JSON.stringify(text.slice(Math.max(0, seam.index! - 40), seam.index! + 40)) : "");
    check(`${c.name}: no em dash in the narrative`, !text.includes("—"));
  }

  if (process.env.RENDER_DIR) {
    fs.mkdirSync(process.env.RENDER_DIR, { recursive: true });
    for (const c of cases) {
      const file = path.join(process.env.RENDER_DIR, c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() + ".pdf");
      fs.writeFileSync(file, await generatePDFBuffer(c.study, c.results, "99D9999999", ["TJC"] as any, null));
      console.log(`wrote ${file}`);
    }
  }

  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
