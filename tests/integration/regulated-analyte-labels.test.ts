// tests/integration/regulated-analyte-labels.test.ts
//
// STANDING integration test for the VeritaCheck label fix (2026-11-05): PDFs printed "no canonical CLIA PT criterion exists" for 47 regulated
// analytes because the check read the startup self-heal's short list. The fix reads the full Subpart I table for labels and leaves that list alone.
//   1. The startup pass does not touch a saved study named for a newly recognized analyte, at any stored criterion. Every column, byte for byte.
//   2. It still heals what it healed before, to the same values, and skips a study with a preset label. Pass 3 still runs. A second run changes nothing.
//   3. The write guard (enforceCanonicalTea) behaves the same way on a new study.
//   4. A re-rendered report labels the same saved row correctly: CLIA TEa with the right section when the study holds that criterion, Lab-Set Internal
//      Goal and the true CLIA criterion when it holds another, and no false "no criterion exists" on a regulated analyte.
//
// Throwaway SQLite DB, made-up rows only. Run: npm run test:regulated-analyte-labels

import { db } from "../../server/db";
import { backfillAbsoluteFloorOnStartup } from "../../server/backfillAbsoluteFloor";
import { enforceCanonicalTea } from "../../server/storage";
import { buildCalVerHTML } from "../../server/pdfReport";
import { studyRowToClient } from "../../server/studyPdf";
import { computeStudyResults } from "../../client/src/lib/studyResults";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const sqlite = (db as any).$client;
const insert = sqlite.prepare(`INSERT INTO studies (user_id, created_by_user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at,
  tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label)
  VALUES (1, 1, @name, 'Made-up Analyzer', 'Made-up Analyst', '2026-01-15', 'cal_ver', @tea, @points, '["Made-up Analyzer"]', @status, '2026-01-15T00:00:00Z', @isPct, @unit, @floor, @floorUnit, @preset)`);
// Recovery within 2%, so every criterion used below reads PASS and the label is the only thing that differs.
const POINTS = JSON.stringify([50, 100, 150, 200, 250].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Made-up Analyzer": v * (i % 2 ? 1.02 : 0.99) } })));
type Shape = { tea: number; isPct?: number | null; unit?: string | null; floor?: number | null; floorUnit?: string | null; preset?: string | null; status?: string };
const add = (name: string, s: Shape): number => Number(insert.run({ name, tea: s.tea, points: POINTS, status: s.status ?? "pass", isPct: s.isPct === undefined ? 1 : s.isPct, unit: s.unit === undefined ? "%" : s.unit, floor: s.floor ?? null, floorUnit: s.floorUnit ?? null, preset: s.preset ?? null }).lastInsertRowid);
const rowJson = (id: number) => JSON.stringify(sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id));
const row = (id: number) => sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id) as any;

// Hard-coded on purpose: a test that read these from the code under test could not see them change.
const NEWLY_RECOGNIZED = [
  "Alpha-1 Antitrypsin", "Alpha-Fetoprotein (AFP, tumor marker)", "Antinuclear Antibody (ANA)", "Antistreptolysin O (ASO)", "Anti-HIV", "Complement C3", "HBsAg (Hepatitis B Surface Antigen)", "Anti-HBc (Hepatitis B Core Antibody)", "HBeAg (Hepatitis B e Antigen)", "Anti-HBs (Hepatitis B Surface Antibody)", "Anti-HCV (Hepatitis C Antibody)",
  "IgA", "IgG", "IgM", "Infectious Mononucleosis", "Rheumatoid Factor (RF)", "Rubella", "Cancer Antigen 125 (CA-125)", "Cortisol", "Estradiol", "Luteinizing Hormone (LH)", "Parathyroid Hormone (PTH)", "Progesterone", "Prolactin", "T3 Uptake", "Triiodothyronine (T3)", "Alcohol, Blood (Ethanol)", "Gentamicin", "Theophylline", "Tobramycin", "Valproic Acid, Total",
  "CBC - WBC (White Blood Cell Count)", "CBC - RBC (Red Blood Cell Count)", "CBC - Hematocrit", "CBC - Platelet Count", "White Blood Cell Differential", "Cell Identification", "Fibrinogen", "Prothrombin Time (PT)", "INR (International Normalized Ratio)", "Partial Thromboplastin Time (PTT/aPTT)", "ABO Group", "Rh Group (D typing)", "Antibody Detection (Unexpected Antibodies)", "Antibody Identification", "Compatibility Testing (Crossmatch)",
  // Everyday spellings.
  "WBC", "RBC", "HCT", "Hematocrit", "PLT", "Platelets", "Platelet Count", "PTT", "aPTT", "INR", "PT", "PT/INR", "Protime", "Prothrombin Time", "VPA", "Valproic Acid", "ETOH", "Ethanol", "E2", "LH", "PTH", "T3", "CA-125", "AFP", "ANA", "RF", "HIV", "Serum Cortisol", "Cortisol, Free", "Urine Free Cortisol", "CMV IgG", "Antibody Screen", "Crossmatch",
];
const SHAPES: Shape[] = [
  { tea: 0.123 }, // no value of any CFR row
  { tea: 0.2 },
  { tea: 7, isPct: 0, unit: "mg/dL", floor: 1.5, floorUnit: "mg/dL", status: "fail" }, // absolute, with a floor that would be cleared if the row were canonical
  { tea: 0.123, isPct: null, unit: null, floor: 3, floorUnit: "U/L" }, // NULL metadata
  { tea: 0.05, preset: "Lab-defined" },
];

async function main() {
  // ── 1 ──
  const untouched: [string, number, string][] = [];
  for (const name of NEWLY_RECOGNIZED) for (const s of SHAPES) { const id = add(name, s); untouched.push([name, id, rowJson(id)]); }

  // ── 2 ── What the pass did before the fix, with the values written out.
  const heals: { name: string; from: Shape; to: Partial<Record<"clia_allowable_error" | "tea_is_percentage" | "tea_unit" | "clia_absolute_floor" | "clia_absolute_unit", number | string | null>> }[] = [
    { name: "Creatinine", from: { tea: 0.5 }, to: { clia_allowable_error: 0.1, tea_is_percentage: 1, tea_unit: "%", clia_absolute_floor: 0.2, clia_absolute_unit: "mg/dL" } },
    { name: "CREATININE", from: { tea: 0.5 }, to: { clia_allowable_error: 0.1, clia_absolute_floor: 0.2, clia_absolute_unit: "mg/dL" } },
    { name: "GC1 CREAT", from: { tea: 0.5 }, to: { clia_allowable_error: 0.1, clia_absolute_floor: 0.2 } },
    { name: "Glucose", from: { tea: 0.08 }, to: { clia_allowable_error: 0.08, clia_absolute_floor: 6, clia_absolute_unit: "mg/dL" } },
    { name: "Hemoglobin", from: { tea: 0.08, floor: 1, floorUnit: "g/dL" }, to: { clia_allowable_error: 0.04, clia_absolute_floor: null, clia_absolute_unit: null } },
    { name: "Hemoglobin A1c", from: { tea: 0.5 }, to: { clia_allowable_error: 0.08, clia_absolute_floor: null } },
    { name: "Sodium", from: { tea: 0.5 }, to: { clia_allowable_error: 4, tea_is_percentage: 0, tea_unit: "mmol/L", clia_absolute_floor: null } },
    { name: "Potassium", from: { tea: 0.5 }, to: { clia_allowable_error: 0.3, tea_is_percentage: 0, tea_unit: "mmol/L" } },
    { name: "Thyroxine", from: { tea: 0.5 }, to: { clia_allowable_error: 0.2, clia_absolute_floor: 1, clia_absolute_unit: "mcg/dL" } },
    { name: "FREE T4", from: { tea: 0.5 }, to: { clia_allowable_error: 0.15, clia_absolute_floor: 0.3, clia_absolute_unit: "ng/dL" } },
    { name: "Vancomycin", from: { tea: 0.5 }, to: { clia_allowable_error: 0.15, clia_absolute_floor: 2, clia_absolute_unit: "mcg/mL" } },
    // Two things the pass still does to a row with NO preset label (saved before 2026-06-04) that are not what anyone would choose. Fixing them
    // would change saved studies, so they stay until someone decides that. Pinned so a change here is a decision, not an accident.
    { name: "Urine Creatinine", from: { tea: 0.5 }, to: { clia_allowable_error: 0.1, clia_absolute_floor: 0.2 } }, // free text collapses onto serum creatinine
    { name: "IgE", from: { tea: 0.2 }, to: { clia_allowable_error: 0.2, clia_absolute_floor: 0.2, clia_absolute_unit: "ng/mL" } }, // "ige" is inside "antigen": the PSA row
  ];
  const healIds = heals.map((h) => add(h.name, h.from));
  const skipped = [
    // BUG-139 (Q241 = 1, 2026-11-08): Pass 1 skips a row with a preset label, as Pass 2 does. These four gained a floor here before.
    add("Creatinine", { tea: 0.05, preset: "Lab-defined" }),
    add("IgE", { tea: 0.2, preset: "Lab-defined" }),
    add("Creatinine Clearance", { tea: 0.15, preset: "Lab-defined" }),
    add("Urine Creatinine", { tea: 0.1, preset: "Lab-defined" }),
    add("Creatinine", { tea: 0.05, floor: 1, floorUnit: "mg/dL", preset: "Lab-defined" }),
    add("Hemoglobin", { tea: 0.04, preset: "Hemoglobin (±4%)" }),
    add("Glucose", { tea: 0.15, floor: 6, floorUnit: "U/L", preset: "ALT/SGPT (±15% or ±6 U/L)" }),
    add("Lipase", { tea: 0.3 }),
    add("LIPASE", { tea: 0.3 }),
    add("MICROALBUMIN (MALB)", { tea: 0.15 }),
    add("Custom Analyte X", { tea: 0.3 }),
    add("BILIRUBIN, DIRECT", { tea: 0.3 }),
  ].map((id) => [id, rowJson(id)] as [number, string]);
  sqlite.prepare("INSERT INTO studies (id, user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, tea_is_percentage, tea_unit, result) VALUES (425, 1, 'MICROALBUMIN (MALB)', 'Made-up Analyzer', 'Made-up Analyst', '2026-01-15', 'cal_ver', 0.08, '[]', '[]', 'fail', '2026-01-15T00:00:00Z', 1, '%', 'fail')").run();

  backfillAbsoluteFloorOnStartup();

  const changed = untouched.filter(([, id, before]) => rowJson(id) !== before);
  check(`the startup pass left all ${untouched.length} rows on newly recognized analytes byte-identical`, changed.length === 0, changed.slice(0, 5).map(([n]) => n).join(", "));
  heals.forEach((h, i) => {
    const r = row(healIds[i]);
    const bad = Object.entries(h.to).filter(([k, v]) => {
      const got = r[k];
      return typeof v === "number" ? Math.abs(got - v) > 1e-9 : got !== v;
    });
    check(`the pass still corrects no-preset "${h.name}"`, bad.length === 0, bad.map(([k, v]) => `${k}: want ${v}, got ${r[k]}`).join("; "));
  });
  for (const [id, before] of skipped) check(`the pass leaves ${JSON.parse(before).test_name} (${JSON.parse(before).clia_preset_label ?? "no preset, not a self-heal analyte"}) alone`, rowJson(id) === before);
  const pass3 = row(425);
  check("Pass 3 still corrects study 425", pass3.clia_allowable_error === 0.15 && pass3.status === "pass");

  const everything = () => JSON.stringify(sqlite.prepare("SELECT * FROM studies ORDER BY id").all());
  const afterFirst = everything();
  backfillAbsoluteFloorOnStartup();
  check("a second run changes nothing", everything() === afterFirst);

  // ── 3 ──
  const guard = (s: any) => enforceCanonicalTea({ teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, ...s }) as any;
  check("the write guard leaves a new no-preset Cortisol at the lab's number", guard({ testName: "Cortisol", cliaAllowableError: 0.15 }).cliaAllowableError === 0.15);
  check("the write guard leaves a new no-preset WBC at the lab's number", guard({ testName: "WBC", cliaAllowableError: 0.05 }).cliaAllowableError === 0.05);
  const guarded = guard({ testName: "Creatinine", cliaAllowableError: 0.5 });
  check("the write guard still corrects a new no-preset Creatinine", guarded.cliaAllowableError === 0.1 && guarded.cliaAbsoluteFloor === 0.2);
  check("the write guard leaves a preset study alone", guard({ testName: "Creatinine", cliaAllowableError: 0.05, cliaPresetLabel: "Lab-defined" }).cliaAllowableError === 0.05);

  // ── 4 ── The same builder the PDF route runs, on the saved row, through the same shaping as the records export.
  const render = (name: string, s: Shape) => {
    const study = studyRowToClient(row(add(name, s)));
    return buildCalVerHTML(study, computeStudyResults(study) as any).replace(/\s+/g, " ");
  };
  const FALSE_CLAIM = "no canonical CLIA PT criterion exists";
  const FALSE_CLAIM_ROW = "No CLIA PT criterion exists";
  const clia = (name: string, s: Shape, section: string) => {
    const html = render(name, s);
    check(`${name} holding its CFR criterion reads CLIA TEa`, html.includes("(CLIA TEa)") && !html.includes("Lab-Set"), "");
    check(`${name} cites ${section}`, html.includes(`per ${section}`) && html.includes(`>${section}</a>`));
    check(`${name} prints no "no criterion" claim`, !html.includes(FALSE_CLAIM) && !html.includes(FALSE_CLAIM_ROW));
    check(`${name} carries the supporting-page row`, html.includes("Adopted Acceptance Criterion (TEa)") && html.includes("CFR Reference (PT TEa, adopted)"));
  };
  clia("Cortisol", { tea: 0.2 }, "42 CFR §493.933");
  clia("WBC", { tea: 0.1 }, "42 CFR §493.941");
  clia("Fibrinogen", { tea: 0.2 }, "42 CFR §493.941");
  clia("PTT", { tea: 0.15 }, "42 CFR §493.941");
  clia("INR", { tea: 0.15 }, "42 CFR §493.941");
  clia("Gentamicin", { tea: 0.25 }, "42 CFR §493.937");
  clia("IgG", { tea: 0.2, preset: "Lab-defined" }, "42 CFR §493.927");
  clia("Glucose", { tea: 0.08, floor: 6, floorUnit: "mg/dL", preset: "Glucose (±8% or ±6 mg/dL)" }, "42 CFR §493.931");
  clia("Hemoglobin", { tea: 0.04, preset: "Hemoglobin (±4%)" }, "42 CFR §493.941");
  clia("PT", { tea: 0.15, preset: "Prothrombin Time / PT (±15%)" }, "42 CFR §493.941");
  clia("AST", { tea: 0.15, floor: 6, floorUnit: "U/L" }, "42 CFR §493.931");
  check("AST no longer cites §493.911 (Bacteriology)", !render("AST", { tea: 0.15, floor: 6, floorUnit: "U/L" }).includes("§493.911"));

  const labSetRegulated = (name: string, s: Shape, cfrText: string, section: string) => {
    const html = render(name, s);
    check(`${name} holding the lab's own number reads Lab-Set Internal Goal`, html.includes("(Lab-Set Internal Goal)") && !html.includes("(CLIA TEa)"));
    check(`${name} states the true CLIA criterion and section`, html.includes(`the CLIA PT criterion for this analyte is ${cfrText} under ${section}`) && html.includes(`CLIA PT criterion for this analyte: ${cfrText}`));
    check(`${name} prints no "no criterion" claim, because one exists`, !html.includes(FALSE_CLAIM) && !html.includes(FALSE_CLAIM_ROW) && !html.includes("(no CLIA TEa)"));
    check(`${name} is not cited "per" the section it does not meet`, !html.includes(`per ${section}`) && html.includes("per laboratory director or designee policy"));
  };
  labSetRegulated("Cortisol", { tea: 0.15, preset: "Lab-defined" }, "±20%", "42 CFR §493.933");
  labSetRegulated("Cortisol", { tea: 0.15 }, "±20%", "42 CFR §493.933"); // a saved row with no preset, which the startup pass does not touch
  labSetRegulated("Glucose", { tea: 0.05, preset: "Lab-defined" }, "±8% or ±6 mg/dL (greater)", "42 CFR §493.931");
  labSetRegulated("Creatinine", { tea: 0.15, floor: 6, floorUnit: "U/L", preset: "ALT/SGPT (±15% or ±6 U/L)" }, "±10% or ±0.2 mg/dL (greater)", "42 CFR §493.931"); // the stale default preset
  labSetRegulated("Antinuclear Antibody (ANA)", { tea: 0.2, preset: "Lab-defined" }, "±2 dilutions or positive or negative", "42 CFR §493.927");

  const lipase = render("Lipase", { tea: 0.3, preset: "Lab-defined" });
  check("Lipase is told it has no CLIA criterion, as before", lipase.includes("(Lab-Set Internal Goal)") && lipase.includes(FALSE_CLAIM) && lipase.includes(`Lab-Set Internal Goal (no CLIA TEa)`) && lipase.includes(FALSE_CLAIM_ROW));
  check("Lipase cites no Subpart I section as its authority", lipase.includes("per laboratory director or designee policy") && !lipase.includes("per 42 CFR §493.931"));
  for (const name of ["Custom Analyte X", "Urine Glucose", "Direct Bilirubin", "Glucose-6-Phosphate Dehydrogenase"]) {
    const html = render(name, { tea: 0.3 });
    check(`${name} reads Lab-Set Internal Goal and says only that the name was not matched`, html.includes("(Lab-Set Internal Goal)") && html.includes("was not matched to a CLIA PT criterion"));
    check(`${name} claims neither a criterion nor the absence of one`, !html.includes(FALSE_CLAIM) && !html.includes(FALSE_CLAIM_ROW) && !html.includes("per 42 CFR §493.931") && !html.includes("(no CLIA TEa)"));
  }
  const urinalysis = render("Urine Protein, total", { tea: 0.3 });
  check("A urinalysis test cites no §493.931 authority", !urinalysis.includes("per 42 CFR §493.931") && urinalysis.includes(FALSE_CLAIM));

  const stamped = render("Glucose", { tea: 0.08 });
  check("Every report prints the day the table was compared with the eCFR", stamped.includes("Canonical TEa list verified against 42 CFR §493 on 2026-11-05."));
  check("The label never touches the verdict: same data reads PASS under either label", render("Cortisol", { tea: 0.2 }).includes("PASS") && render("Cortisol", { tea: 0.15, preset: "Lab-defined" }).includes("PASS"));

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
