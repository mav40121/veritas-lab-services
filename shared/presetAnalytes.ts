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

// Correlation-grouping key for the 5-part WBC differential. The method-comparison
// requirement groups analytes by EXACT string, so a manual differential (reported
// as PERCENTAGES, e.g. a lab labels the line "Lymphs") never pairs with the
// analyzer's percentage point ("Lymph%", "LY%") even though they are the same
// measurand on the same patient, measured two ways. This returns a canonical key
// so like-with-like differential points collapse into one correlation requirement.
//
// It is deliberately %-vs-# AWARE: a percentage never shares a key with an absolute
// count. Pairing a manual % against an analyzer # would be wrong (different
// measurand), and the owner flagged that over-match explicitly. Returns null for
// anything that is not one of the standard WBC differential classes, so every
// non-differential analyte falls through to exact-string grouping, unchanged.
const _DIFF_CLASS_PATTERNS: Array<[RegExp, string]> = [
  [/^(ly|lymph|lymphs|lymphocyte|lymphocytes)$/, "lymphocyte"],
  [/^(ne|neut|neuts|neutrophil|neutrophils|seg|segs|segmented|poly|polys)$/, "neutrophil"],
  [/^(mo|mono|monos|monocyte|monocytes)$/, "monocyte"],
  [/^(eo|eos|eosinophil|eosinophils)$/, "eosinophil"],
  [/^(ba|baso|basos|basophil|basophils)$/, "basophil"],
];
export function diffCorrelationKey(raw: string): string | null {
  const lower = String(raw || "").toLowerCase();
  // Read the %-vs-# marker BEFORE stripping non-alphanumerics.
  const isPct = /%|percent|\bpct\b/.test(lower);
  const isAbs = /#|absolute|\babs\b|count|x\s*10|10\^|cells?\b|\/\s*u?l\b|\/\s*mc?l\b|k\/u?l|k\/mc?l/.test(lower);
  // Reduce to a letters-only class token, then drop marker words so spelled-out
  // forms ("Absolute lymphocytes", "Lymphocyte count") still resolve to the class.
  let token = lower.replace(/\([^)]*\)/g, "").replace(/[^a-z]/g, "");
  token = token.replace(/absolute|percent|count|abs|pct|total|cells?/g, "");
  let cls: string | null = null;
  for (const [re, c] of _DIFF_CLASS_PATTERNS) if (re.test(token)) { cls = c; break; }
  if (!cls) return null;
  // A bare differential class with no marker is a PERCENT by convention: manual
  // diffs are reported as %, so a line labeled just "Lymphs" means lymph percent.
  const kind = isPct ? "pct" : isAbs ? "abs" : "pct";
  return `diff:${cls}:${kind}`;
}

// Correlation grouping for VeritaMap (parking lot #76, 2026-10-08). The map
// decided "correlation required" by counting instruments on the EXACT analyte
// string, so a manual differential's "Lymphocytes" and the analyzer's "LYMPH%"
// (the same measurand, two methods; 42 CFR 493.1281 comparability) were two
// unrelated one-instrument tests and the requirement never appeared. The map now
// groups with the same differential key VeritaCheck coverage already uses:
// percent with percent, absolute with absolute, everything else by exact name.
export function correlationGroupKey(analyte: string): string {
  return diffCorrelationKey(analyte) ?? String(analyte ?? "");
}

export interface CorrelationGroupInfo {
  /** Distinct instruments running any analyte in this analyte's correlation group. */
  instrumentCount: number;
  /** The OTHER analytes on the map that share the group (e.g. "LYMPH%" for "Lymphocytes"). */
  peers: string[];
}

/**
 * For every analyte, the correlation group's distinct instrument count and peer
 * analytes. Input: analyte -> instruments running it (each with an id, or
 * instrument_id, or at least an instrument_name).
 */
export function correlationGroupsFor(
  instrByAnalyte: Record<string, Array<{ id?: number | string; instrument_id?: number | string; instrument_name?: string; name?: string }>>,
): Record<string, CorrelationGroupInfo> {
  const byKey = new Map<string, string[]>();
  for (const analyte of Object.keys(instrByAnalyte)) {
    const k = correlationGroupKey(analyte);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(analyte);
  }
  const instrKey = (i: any) => String(i?.id ?? i?.instrument_id ?? i?.instrument_name ?? i?.name ?? "");
  const out: Record<string, CorrelationGroupInfo> = {};
  for (const members of byKey.values()) {
    const ids = new Set<string>();
    for (const m of members) for (const i of instrByAnalyte[m] ?? []) { const k = instrKey(i); if (k) ids.add(k); }
    for (const m of members) out[m] = { instrumentCount: ids.size, peers: members.filter((x) => x !== m).sort() };
  }
  return out;
}
