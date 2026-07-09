// shared/presetAnalytes.ts
//
// Crosswalk from a CLIA TEa preset (the "bottom tea list" in the study-create
// form) to the analyte name(s) that identify it on a lab's VeritaMap. This is
// the anchor for "allocation at time of running assay": when a tech picks a
// canonical preset, we know the analyte identity, so a study can self-attribute
// to its map point (coverage_analyte) instead of relying on the free-text test
// name matching by luck.
//
// The preset LABEL (frozen on the study as clia_preset_label) is the stable
// identity we key off. presetKeyForLabel() reduces a label like
// "AST (±15% or ±6 U/L)" to the slug "ast"; PRESET_ANALYTE_ALIASES maps that
// slug to the full analyte name(s) that will match the map (the server matcher
// strips parentheticals and needs 4+ chars, so aliases carry the SPELLED-OUT
// name, plus the bare abbreviation for labs whose map uses it verbatim).
//
// A missing or ambiguous crosswalk resolves to nothing (no guess) — that study
// falls to the Phase 2 custom/challenge path. Custom TEa (no preset label) never
// reaches here.

// "AST (±15% or ±6 U/L)" -> "ast" ; "Cholesterol, HDL (±20% or ±6 mg/dL)" ->
// "cholesterol_hdl". Take the analyte part (before the TEa parenthetical) and
// slugify. Both the client (when it wants the key) and the server derive it the
// same way, so the key is stable without a hand-maintained id per preset.
export function presetKeyForLabel(label: string): string {
  const analytePart = String(label || "").split(" (")[0];
  return analytePart.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// slug -> analyte aliases. Aliases include the spelled-out name (matches map
// entries like "Aspartate aminotransferase (AST) (SGOT)" after paren-stripping)
// AND the bare abbreviation (exact-matches maps that store just "RBC"/"HGB"). A
// preset intentionally left out (or a total-vs-free ambiguity) resolves to null.
export const PRESET_ANALYTE_ALIASES: Record<string, string[]> = {
  // ── Routine Chemistry §493.931 ──
  alt_sgpt: ["Alanine aminotransferase", "ALT/SGPT"],
  albumin: ["Albumin"],
  alkaline_phosphatase: ["Alkaline phosphatase"],
  amylase: ["Amylase"],
  ast: ["Aspartate aminotransferase"],
  bilirubin_total: ["Bilirubin, total", "Total bilirubin"],
  probnp: ["pro brain natriuretic peptide", "N-Terminal pro brain natriuretic peptide", "ProBNP"],
  carbon_dioxide_serum_co2_bicarbonate: ["Carbon dioxide"],
  pco2_blood_gas_analyzer: ["PCO2"],
  blood_gas_po2: ["PO2"],
  calcium_total: ["Calcium, total"],
  chloride: ["Chloride"],
  cholesterol_hdl: ["HDL cholesterol"],
  cholesterol_ldl_direct: ["LDL cholesterol"],
  ck: ["Creatine kinase"],
  creatinine: ["Creatinine"],
  ferritin: ["Ferritin"],
  ggt: ["Gamma glutamyl transferase", "Gamma-glutamyl transferase"],
  glucose: ["Glucose"],
  hemoglobin_a1c: ["A1C", "Hemoglobin A1c", "HbA1c"],
  iron_total: ["Iron"],
  ldh: ["Lactate dehydrogenase"],
  magnesium: ["Magnesium"],
  phosphorus: ["Phosphorus"],
  potassium: ["Potassium"],
  psa_total: ["Prostatic specific antigen", "Prostate-specific antigen"],
  sodium: ["Sodium"],
  tibc_direct: ["Iron binding capacity, total", "Total iron binding capacity"],
  total_protein: ["Protein, total"],
  triglycerides: ["Triglyceride"],
  troponin_i: ["Troponin-I", "Troponin I"],
  urea_nitrogen_bun: ["Urea", "BUN"],
  uric_acid: ["Uric acid"],
  // ── Endocrinology §493.933 ──
  folate_serum: ["Folate", "Folic acid"],
  free_t4: ["Thyroxine, free", "Free T4"],
  parathyroid_hormone: ["Parathyroid hormone"],
  testosterone: ["Testosterone"],
  t3_uptake: ["Triiodothyronine uptake", "T3 uptake"],
  tsh: ["Thyroid stimulating hormone"],
  vitamin_b12: ["Vitamin B12"],
  // ── Toxicology §493.935 ──
  acetaminophen: ["Acetaminophen"],
  alcohol_blood: ["Ethanol", "Blood alcohol"],
  salicylate: ["Salicylate"],
  // ── Hematology §493.941 ──
  erythrocyte_count_rbc: ["RBC", "Erythrocyte count", "Red blood cell count"],
  hematocrit: ["HCT", "Hematocrit"],
  hemoglobin: ["HGB", "Hemoglobin"],
  leukocyte_count_wbc: ["WBC", "Leukocyte count"],
  partial_thromboplastin_time: ["Activated partial thromboplastin time", "Partial thromboplastin time"],
  platelet_count: ["PLT", "Platelet count"],
  prothrombin_time_pt: ["Prothrombin time"],
  // Intentionally NOT crosswalked (ambiguous or no distinct map analyte, so they
  // fall to the Phase 2 challenge instead of risking a wrong auto-attribution):
  //   cholesterol_total (matches HDL/LDL/total), hcg (urine/serum/qual variants),
  //   t3_total, t4_thyroxine (total vs free), bnp (vs proBNP), blood_gas_ph.
};

// Convenience: aliases for a full preset label (empty array when uncrosswalked).
export function aliasesForPresetLabel(label: string): string[] {
  return PRESET_ANALYTE_ALIASES[presetKeyForLabel(label)] || [];
}

// Synonym groups used ONLY by the coverage name-matcher (analytesShareGroup),
// never by preset -> analyte resolution above. These carry the identities the
// preset table does not: the CBC 5-part differential and the RBC/platelet
// indices, where the map commonly stores a short code (EO#, EO%, MCV) while a
// study is named in full ("Eosinophils", "Mean corpuscular volume"). The bare
// Sysmex-style codes normalize to the same token, so the absolute (#) and
// percent (%) points share one group: one differential correlation credits both
// (they are the same measurand reported two ways).
export const ANALYTE_SYNONYM_GROUPS: Record<string, string[]> = {
  eosinophils: ["EO#", "EO%", "Eosinophils", "Absolute eosinophils", "Eosinophil count"],
  basophils: ["BA#", "BA%", "Basophils", "Absolute basophils", "Basophil count"],
  neutrophils: ["NE#", "NE%", "Neutrophils", "Absolute neutrophils", "Neutrophil count"],
  lymphocytes: ["LY#", "LY%", "Lymphocytes", "Absolute lymphocytes", "Lymphocyte count"],
  monocytes: ["MO#", "MO%", "Monocytes", "Absolute monocytes", "Monocyte count"],
  immature_granulocytes: ["IG#", "IG%", "Immature granulocytes"],
  mcv: ["MCV", "Mean corpuscular volume"],
  mch: ["MCH", "Mean corpuscular hemoglobin"],
  mchc: ["MCHC", "Mean corpuscular hemoglobin concentration"],
  rdw: ["RDW", "Red cell distribution width", "Red blood cell distribution width"],
  mpv: ["MPV", "Mean platelet volume"],
};

// Normalized alias token -> group slug, built once from BOTH the preset aliases
// (so "HGB" ~ "Hemoglobin" comes for free) and the synonym-only groups above.
// Normalization mirrors the coverage matcher: strip parentheticals, drop every
// non-alphanumeric, lowercase. "EO#"/"EO%" -> "eo"; "Mean corpuscular volume" ->
// "meancorpuscularvolume".
const _normSyn = (s: string) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "");
let _synIndex: Map<string, string> | null = null;
function synIndex(): Map<string, string> {
  if (_synIndex) return _synIndex;
  const idx = new Map<string, string>();
  for (const [slug, aliases] of [...Object.entries(PRESET_ANALYTE_ALIASES), ...Object.entries(ANALYTE_SYNONYM_GROUPS)]) {
    for (const a of aliases) { const k = _normSyn(a); if (k) idx.set(k, slug); }
  }
  _synIndex = idx;
  return idx;
}

// True when two analyte labels resolve to the SAME curated synonym group (e.g.
// "HGB" and "Hemoglobin"; "EO#"/"EO%" and "Eosinophils"). Only curated groups
// match, so this cannot introduce a fuzzy false positive. The coverage matcher
// falls through to this so a spelled-out study credits an abbreviated map point.
export function analytesShareGroup(a: string, b: string): boolean {
  const idx = synIndex();
  const ga = idx.get(_normSyn(a));
  const gb = idx.get(_normSyn(b));
  return !!ga && ga === gb;
}
