// scripts/measure-readiness-150-labs.mts
//
// How long the multi-lab readiness roll-up takes for a 150-lab system (server/labReadiness.ts), on a scratch database
// with made-up labs. Each lab has 8 instruments, 120 tests on two instruments each (240 map rows), 350 studies, 150
// documents, 12 findings, 30 instruments under maintenance, 25 testing staff, 40 PT events, 20 QC lots and 400 QC results.
// Never point DB_PATH at anything real: the script refuses a database that already holds labs (REUSE=1 times again on
// the scratch database it built).
// Run: rm -f .tmp-readiness150.db && DB_PATH=.tmp-readiness150.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/measure-readiness-150-labs.mts
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

const LABS = Number(process.env.LABS || 150);
const ANALYTES = ("Sodium|Potassium|Chloride|Carbon Dioxide (CO2)|Glucose|Urea Nitrogen (BUN)|Creatinine|Calcium|Albumin|Total Protein|Alkaline Phosphatase (ALP)|"
  + "Alanine aminotransferase (ALT) (SGPT)|Aspartate aminotransferase (AST) (SGOT)|Bilirubin, total|Bilirubin, direct|Magnesium|Phosphorus|Uric Acid|Lactate|Ammonia|Amylase|Lipase|"
  + "Lactate Dehydrogenase (LDH)|Creatine Kinase (CK)|CK-MB|Troponin I|BNP|NT-proBNP|Cholesterol, total|HDL Cholesterol|LDL Cholesterol|Triglycerides|Iron|TIBC|Ferritin|Transferrin|"
  + "Vitamin B12|Folate|Vitamin D, 25-OH|TSH|Free T4|Total T3|Free T3|Cortisol|Prolactin|LH|FSH|Estradiol|Progesterone|Testosterone|hCG, quantitative|PSA, total|CEA|CA 125|CA 19-9|AFP|"
  + "Hemoglobin A1c|C-Reactive Protein|Rheumatoid Factor|Haptoglobin|IgG|IgA|IgM|Complement C3|Complement C4|Prealbumin|Microalbumin, urine|Creatinine, urine|Protein, urine|Sodium, urine|"
  + "Potassium, urine|Chloride, urine|Osmolality|Osmolality, urine|Acetaminophen|Salicylate|Ethanol|Digoxin|Phenytoin|Valproic Acid|Carbamazepine|Lithium|Vancomycin|Gentamicin|Tobramycin|"
  + "Theophylline|WBC|RBC|Hemoglobin|Hematocrit|MCV|MCH|MCHC|RDW|Platelets|MPV|Neutrophils|Lymphocytes|Monocytes|Eosinophils|Basophils|Reticulocytes|Prothrombin Time|INR|APTT|Fibrinogen|"
  + "D-dimer|Anti-Xa|pH|pCO2|pO2|Ionized Calcium|Carboxyhemoglobin|Methemoglobin|Procalcitonin|Beta-Hydroxybutyrate|Amphetamine|Benzodiazepines|Cocaine metabolite|Opiates|Barbiturates").split("|");
const INSTRUMENTS = [["Ortho VITROS 5600", "Bonnie"], ["Ortho VITROS 5600", "Clyde"], ["Sysmex XN-1000", "Hemi"], ["Sysmex XN-550", "Little Hemi"], ["Stago STA Compact Max", ""], ["Stago STA Satellite", ""], ["GEM Premier 5000", "Gas 1"], ["Beckman DxI 600", ""]];

async function main() {
  if (!process.env.DB_PATH || !/tmp|scratch/i.test(process.env.DB_PATH)) throw new Error("Set DB_PATH to a scratch file (a name with tmp or scratch in it).");
  const { db } = await import("../server/db");
  const { computeLabReadiness } = await import("../server/labReadiness");
  const { computeCoverageForLab } = await import("../server/veritacheckCoverage");
  const sqlite = (db as any).$client;
  if ((sqlite.prepare("SELECT COUNT(*) AS n FROM labs").get() as any).n > 0 && !process.env.REUSE) throw new Error("This database already has labs.");
  sqlite.pragma("foreign_keys = OFF");
  const cache = new Map<string, any>();
  const prep = (sql: string) => { if (!cache.has(sql)) cache.set(sql, sqlite.prepare(sql)); return cache.get(sql); };
  const tableCols = new Map<string, any[]>();
  const colsOf = (t: string) => { if (!tableCols.has(t)) tableCols.set(t, sqlite.prepare(`PRAGMA table_info(${t})`).all()); return tableCols.get(t)!; };
  const insert = (table: string, values: Record<string, unknown>) => {
    const known = new Set(colsOf(table).map((c: any) => c.name));
    const row: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([k]) => known.has(k)));
    for (const c of colsOf(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_|clia_allowable|value|mean|sd$/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(prep(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const pad = "x".repeat(3000);
  const labIds: number[] = [];
  const t0 = performance.now();
  if (process.env.REUSE) labIds.push(...(sqlite.prepare("SELECT id FROM labs ORDER BY id").all() as any[]).map((r) => r.id));
  else sqlite.transaction(() => {
    const owner = insert("users", { email: "bench-owner@example.test", name: "Made-up owner", plan: "enterprise", seat_count: 0 });
    for (let i = 0; i < LABS; i++) {
      const lab = insert("labs", { lab_name: `Made-up Lab ${i + 1}`, owner_user_id: owner, plan: "hospital" });
      labIds.push(lab);
      insert("lab_members", { lab_id: lab, user_id: owner, role: "owner", status: "active" });
      const map = insert("veritamap_maps", { user_id: owner, lab_id: lab, name: "Map" });
      const inst = INSTRUMENTS.map(([n, nick]) => insert("veritamap_instruments", { map_id: map, instrument_name: n, nickname: nick || null, role: "Primary", category: "Chemistry" }));
      ANALYTES.slice(0, 120).forEach((a, k) => {
        insert("veritamap_tests", { map_id: map, analyte: a, specialty: "Chemistry", complexity: "MODERATE" });
        for (const x of [k % 8, (k + 1) % 8]) {
          insert("veritamap_instrument_tests", { map_id: map, instrument_id: inst[x], analyte: a, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
          insert("studies", { user_id: owner, lab_id: lab, test_name: a, instrument: `${INSTRUMENTS[x][0]} ${INSTRUMENTS[x][1]}`, study_type: "cal_ver", status: "pass", lifecycle_state: "finalized", date: day(-((k * 3) % 240)), finalized_at: day(-((k * 3) % 240)), data_points: pad, instruments: "[]" });
        }
        if (k < 110) insert("studies", { user_id: owner, lab_id: lab, test_name: k % 9 ? a : `${a} compare`, instrument: "", study_type: "method_comparison", status: "pass", lifecycle_state: k % 5 ? "finalized" : "draft", date: day(-k), finalized_at: day(-k), data_points: pad, instruments: "[]" });
      });
      for (let k = 0; k < 150; k++) insert("policy_documents", { lab_id: lab, title: `Doc ${k}`, status: k % 10 === 0 ? "in_review" : k % 17 === 0 ? "expired" : "approved", next_review_date: day(k * 5 - 60), owner_user_id: owner });
      for (let k = 0; k < 12; k++) insert("findings", { user_id: owner, lab_id: lab, accreditor: ["CAP", "TJC", "CMS", "COLA"][k % 4], status: k % 3 ? "open" : "closed", due_date: day(k * 9 - 30) });
      for (let k = 0; k < 30; k++) insert("lab_equipment", { lab_id: lab, user_id: owner, name: `E${k}`, status: "active", next_due_date: day(k * 12 - 20) });
      for (let k = 0; k < 40; k++) insert("pt_events", { lab_id: lab, enrollment_id: 1, user_id: owner, event_date: day(-k), analyte: "Glucose", pass_fail: k % 4 ? "pass" : "pending", submission_due_date: day(k) });
      for (let k = 0; k < 25; k++) insert("staff_employees", { user_id: owner, tier2_lab_id: lab, lab_id: lab, first_name: "F", last_name: `L${k}`, status: "active", performs_testing: 1, hire_date: day(-400), created_at: day(-400) });
      for (let k = 0; k < 20; k++) { const lot = insert("qc_control_lots", { lab_id: lab, status: "active", analyte: "Glucose", lot_number: `L${k}` }); for (let r = 0; r < 20; r++) insert("qc_results", { lab_id: lab, control_lot_id: lot, result_date: day(-r) }); }
    }
  })();
  console.log(`labs ${labIds.length}, built in ${Math.round(performance.now() - t0)} ms`);
  const time = (name: string, fn: () => void) => { const t = performance.now(); fn(); const ms = performance.now() - t; console.log(`${name}: ${ms.toFixed(0)} ms (${(ms / labIds.length).toFixed(1)} ms a lab)`); };
  time("computeLabReadiness, every lab, first pass", () => { for (const id of labIds) computeLabReadiness(sqlite, id); });
  time("computeLabReadiness, every lab, second pass", () => { for (const id of labIds) computeLabReadiness(sqlite, id); });
  time("computeCoverageForLab alone, every lab", () => { for (const id of labIds) computeCoverageForLab(sqlite, id); });
  console.log(JSON.stringify(computeLabReadiness(sqlite, labIds[0])));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
