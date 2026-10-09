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

// Correlation grouping for VeritaMap (parking lot #76, 2026-10-08; BUG-011,
// 2026-10-09). 42 CFR 493.1281: the same test run on two instruments or by two
// methods needs a comparison twice a year. The map used to decide "same test" by
// the EXACT analyte string, so the requirement never appeared when two instruments
// (or a manual method) named one test differently. Michael: "Manual diff counts
// lymph % same as the hematology analyzers do and does trigger correlation
// requirements ... that is just an example of this class of bug." A production
// audit of 37 maps found the class on six client labs: capital letters only
// ("Antibody screen" vs "Antibody Screen"), a differential entered as one test
// ("Manual Diff", CellaVision "White blood cell differential (WBC diff)"), NRBC,
// urine sediment (manual vs UF-5000/UD-10), blood bank method suffixes ("(tube)"),
// drug-screen spellings across devices.
//
// sameTestKeys() returns the identity keys of a map analyte. Two analytes are the
// same test when they share a key. Rules, in order (first family that applies wins):
//   1. WBC differential class, percent and absolute kept apart (diffCorrelationKey).
//   2. A whole differential ("Manual Diff", "Differential", "WBC diff") carries the
//      five percent keys, so it pairs with each class percentage the analyzer reports.
//   3. NRBC, reticulocytes (percent / absolute), body fluid counts and differential.
//   4. Urine sediment elements; specimen stays part of the identity, so a urine RBC
//      never meets the CBC RBC. Dipstick chemistry is not sediment.
//   5. Blood bank by test and phase; method words (tube, gel) do not split a test,
//      and crossmatch IS, AHG and electronic stay separate.
//   6. Drug classes (urine drug screens), so "Amphetamine" and "Amphetamines",
//      "Cannabinoids (THC)" and "Cannabinoids" are one test. Morphine is not Opiates.
//   7. Curated FDA / library name variants (PT, aPTT, FDA spellings).
//   8. Otherwise the name itself, ignoring capital letters, spacing, punctuation,
//      word order and a trailing plural ("Bilirubin, total" = "Total bilirubin").
//   5b. Blood gas and point-of-care whole blood vs the chemistry or hematology
//      analyzer for the same measurand ("cNa+" = "Sodium", "ctHb" = "HGB", "cGlu" =
//      "Glucose"): Michael, BUG-011 part B (Q42 = 1, 2026-10-09). Ionized calcium
//      stays apart from total calcium; any specimen word (urine, CSF) stays apart.
// Kept apart by Michael's decision (Q42): urine dipstick vs quantitative urine
// chemistry (a semi-quantitative screen is not the same test), Opiates vs Morphine
// (different targets and cutoffs).

const _stripParens = (s: string) => s.replace(/\([^)]*\)/g, " ");
const _words = (s: string) => s.toLowerCase().replace(/[^a-z0-9#%+]+/g, " ").trim().split(/\s+/).filter(Boolean);
const _fold = (w: string) => (w.length > 4 && /s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w);

// %-vs-# for the hematology families that are not differential classes. "count"
// alone does not mean absolute here: a manual reticulocyte count is a percentage.
function _pctOrAbs(raw: string): "pct" | "abs" {
  const l = raw.toLowerCase();
  if (/%|percent|\bpct\b/.test(l)) return "pct";
  if (/#|absolute|\babs\b|x\s*10|10\^|\/\s*u?l\b|\/\s*mc?l\b|k\/u?l/.test(l)) return "abs";
  return "pct";
}

const _DIFF_CLASSES = ["lymphocyte", "neutrophil", "monocyte", "eosinophil", "basophil"];
const _SPECIMEN_WORDS = /\b(urine|urinary|csf|cerebrospinal|body fluid|synovial|pleural|peritoneal|pericardial|stool|fecal|wet prep|wet mount|vaginal|semen|amniotic|sweat|saliva)\b/;

const _BLOOD_BANK: Array<[RegExp, string]> = [
  [/^(red cell |unexpected )?(antibody|ab) (screen|screening|detection)$|^(unexpected antibody detection|indirect antiglobulin test|iat)$/, "abscreen"],
  [/^(antibody|ab) (identification|id|panel|identification panel)$/, "abid"],
  [/^abo( group| grouping| typing| type| forward grouping| reverse grouping| forward type| reverse type)?$|^(forward|reverse) (grouping|type|typing)$/, "abo"],
  [/^(rh|rhd|d|rho|rh d)( type| typing| factor)?$/, "rh"],
  [/^(dat|direct antiglobulin( test)?|direct coombs( test)?)$/, "dat"],
  [/^(antigen|antigen typing|red cell antigen typing|rbc antigen typing|phenotyping|phenotype|antigen screen)$/, "antigen"],
  [/^(antibody titer|antibody titration|titer)$/, "titer"],
];

// Blood gas and point-of-care names for a chemistry or hematology measurand, matched
// on the name without parentheses (so "Glucose (POC)" and "cCa2+(7.4)" qualify).
// Anchored, so "Hemoglobin A1c", "Calcium, total" and "Sodium, urine" never match.
const _WHOLE_BLOOD: Array<[RegExp, string]> = [
  [/^(sodium|na|na\+|cna\+|whole blood sodium|sodium whole blood)$/, "sodium"],
  [/^(potassium|k|k\+|ck\+|whole blood potassium|potassium whole blood)$/, "potassium"],
  [/^(chloride|cl|ccl|whole blood chloride|chloride whole blood)$/, "chloride"],
  [/^(ionized calcium|calcium ionized|ionised calcium|ica|ca\+\+|ca2\+|cca2\+|free calcium)$/, "ionized calcium"],
  [/^(glucose|glu|cglu|blood glucose|whole blood glucose|glucose whole blood|poc glucose|glucose poc|glucose meter|capillary glucose|fingerstick glucose)$/, "glucose"],
  [/^(lactate|lactic acid|lactic acid lactate|clac|lac|whole blood lactate)$/, "lactate"],
  [/^(hemoglobin|haemoglobin|hgb|hb|thb|cthb|total hemoglobin|hemoglobin total)$/, "hemoglobin"],
  [/^(hematocrit|haematocrit|hct|hct calc|calculated hematocrit|hematocrit calculated)$/, "hematocrit"],
];

// Urine drug screen classes. Specimen words (urine) are ignored inside this family.
const _DRUGS: Array<[RegExp, string]> = [
  [/^(amphetamines?|amp)$/, "amphetamine"],
  [/^(methamphetamines?|mamp|met)$/, "methamphetamine"],
  [/^(cannabinoids?|thc|marijuana|cannabinoid thc)$/, "cannabinoid"],
  [/^(cocaine|cocaine metabolites?|benzoylecgonine|coc)$/, "cocaine"],
  [/^(phencyclidine|pcp)$/, "phencyclidine"],
  [/^(opiates?|opi)$/, "opiate"],
  [/^(barbiturates?|bar)$/, "barbiturate"],
  [/^(benzodiazepines?|bzo)$/, "benzodiazepine"],
  [/^(methadone|mtd)$/, "methadone"],
  [/^(eddp|methadone metabolites?( eddp)?|eddp methadone metabolite)$/, "eddp"],
  [/^(oxycodone|oxy)$/, "oxycodone"],
  [/^(buprenorphine|bup)$/, "buprenorphine"],
  [/^(mdma|ecstasy|methylenedioxymethamphetamine)$/, "mdma"],
  [/^(tricyclic antidepressants?|tca)$/, "tca"],
  [/^(propoxyphene|ppx)$/, "propoxyphene"],
  [/^(fentanyl|fyl)$/, "fentanyl"],
  [/^(6 acetylmorphine|6 monoacetylmorphine|6 mam)$/, "6mam"],
];

// Curated same-test names (FDA spelling variants and common short forms) found in
// the BUG-009 library review and the BUG-011 production audit. Compared on _words.
const _SAME_TEST: Array<[string, string[]]> = [
  ["pt", ["pt", "prothrombin time", "pt inr", "protime"]],
  ["inr", ["inr", "pt inr", "international normalized ratio"]],
  ["aptt", ["aptt", "ptt", "activated partial thromboplastin time", "partial thromboplastin time"]],
  ["pth", ["parathyroid hormone", "parathyroid hormone intact", "intact pth", "pth"]],
  ["cystatin c", ["cystatin c", "cystacin c"]],
  ["hba1c", ["glycosylated hemoglobin", "hemoglobin a1c", "hba1c", "a1c", "hgb a1c"]],
  ["urine albumin", ["microalbumin", "albumin urinary", "urine albumin", "urine microalbumin"]],
  ["stfr", ["soluble transferrin receptor", "transferrin receptor"]],
  ["igg subclasses", ["igg subclasses 1 2 3 4", "immunoglobulins igg subclasses", "igg subclasses"]],
  ["platelet estimate", ["platelet estimate", "plt estimate"]],
];

function _wordKey(s: string): string {
  return _words(s).map(_fold).sort().join(" ");
}

let _sameIdx: Map<string, string> | null = null;
function _sameTestIndex(): Map<string, string> {
  if (_sameIdx) return _sameIdx;
  const m = new Map<string, string>();
  for (const [key, names] of _SAME_TEST) for (const n of names) m.set(_wordKey(n), key);
  _sameIdx = m;
  return m;
}

export function sameTestKeys(analyte: string): string[] {
  const raw = String(analyte ?? "").normalize("NFKC").trim();
  if (!raw) return [""];
  const lower = raw.toLowerCase();
  const base = _words(_stripParens(raw)).join(" ");

  // 3a. Body fluid counts and differential (before the blood families).
  if (/\b(body fluid|bf)\b|-bf\b/.test(lower) || /^(pmn|mn)\s*[#%]?$/i.test(raw.replace(/\s+/g, ""))) {
    if (/pmn|polymorpho|neutro/.test(lower)) return [`bf:pmn:${_pctOrAbs(raw)}`];
    if (/\bmn\b|mononuc/.test(lower)) return [`bf:mn:${_pctOrAbs(raw)}`];
    if (/differential|\bdiff\b/.test(lower)) return ["bf:pmn:pct", "bf:mn:pct"];
    if (/\btc\b|tc-bf|total nucleated|nucleated cell|tnc/.test(lower)) return ["bf:tnc"];
    if (/\bwbc\b|white|leuko/.test(lower)) return ["bf:wbc"];
    if (/\brbc\b|red|erythro/.test(lower)) return ["bf:rbc"];
  }
  // 4. Urine sediment. Whole words: "Erythrocyte Sedimentation Rate" is not urine sediment.
  const urineCtx = /\b(urine|urinary|sediment|urinalysis)\b|\bmicroscop/.test(lower);
  if (!/dipstick|esterase|occult|qualitative|nitrite|ketone|specific gravity|\bph\b|sedimentation|\besr\b/.test(lower)) {
    const el: Array<[RegExp, string, boolean]> = [
      [/\bcasts?\b/, "casts", true], [/\bcrystals?\b/, "crystals", true], [/\bepithel|\bsquamous\b/, "epithelial", true],
      [/\bmucus\b/, "mucus", true], [/\b(rbc|red blood cells?|erythrocytes?)\b/, "rbc", false],
      [/\b(wbc|white blood cells?|leukocytes?)\b/, "wbc", false], [/\bbacteria\b/, "bacteria", false],
      [/\byeast\b|budding/, "yeast", false], [/\bsperm/, "sperm", false],
    ];
    for (const [re, name, bareOk] of el) {
      if (!re.test(lower)) continue;
      const otherSpecimen = _SPECIMEN_WORDS.test(lower) && !/\b(urine|urinary)\b/.test(lower);
      if (urineCtx && !otherSpecimen) return [`urine:${name}`];
      if (bareOk && !otherSpecimen && base.split(" ").length <= 3) return [`urine:${name}`];
      break;
    }
  }
  // 1. Differential class.
  const dk = diffCorrelationKey(raw);
  if (dk && !_SPECIMEN_WORDS.test(lower)) return [dk];
  // 2. Whole differential.
  if (!_SPECIMEN_WORDS.test(lower) &&
      /^(manual |automated |digital |cbc |peripheral )?(wbc |white blood cell |white cell |leukocyte )?((5|five) part |(5|five) )?(diff|differential)( count| with smear review)?$/.test(base)) {
    return _DIFF_CLASSES.map((c) => `diff:${c}:pct`);
  }
  // 3b. NRBC and reticulocytes.
  if (/\bnrbc\b|nucleated red( blood)? cells?|nucleated rbc/.test(lower) && !_SPECIMEN_WORDS.test(lower)) return [`nrbc:${_pctOrAbs(raw)}`];
  if (/\bretic(ulocyte)?s?\b|^ret\s*[#%]?$/.test(lower) && !/\bhe\b|ret-he|hemoglobin|\bhgb\b|\birf\b|immature|\bmrv\b|mean/.test(lower)) {
    return [`retic:${_pctOrAbs(raw)}`];
  }
  // 5. Blood bank by test and phase (method words dropped).
  const bb = base.replace(/\b(tube|gel|manual|automated|column|solid phase|card|cat|method|testing|test)\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^(crossmatch|cross match|xm|compatibility testing|crossmatch compatibility testing)\b/.test(bb)) {
    const phase = /\b(is|immediate spin)\b/.test(lower) ? "is" : /\b(ahg|antiglobulin|iat|coombs)\b/.test(lower) ? "ahg" : /electronic|computer/.test(lower) ? "electronic" : "unspecified";
    return [`bb:crossmatch:${phase}`];
  }
  for (const [re, key] of _BLOOD_BANK) if (re.test(bb)) return [`bb:${key}`];
  // 5b. Blood gas / point-of-care whole blood vs chemistry and hematology (Q42 = 1).
  // Device and setting words do not change the test: "i-STAT Sodium-POC" is sodium.
  if (!_SPECIMEN_WORDS.test(lower)) {
    const wb = base.replace(/\b(i stat|istat|epoc|piccolo|hemocue|statstrip|nova|accu chek|abl\d*|gem|poc|point of care|bedside|wb|meter)\b/g, " ").replace(/\s+/g, " ").trim();
    for (const [re, key] of _WHOLE_BLOOD) if (re.test(base) || (wb && re.test(wb))) return [`same:${key}`];
  }
  // 6. Drug classes.
  const drug = _words(_stripParens(raw)).filter((w) => !/^(urine|screen|ua|drug|qualitative|test|immunoassay)$/.test(w)).join(" ");
  const drugFull = _words(raw).filter((w) => !/^(urine|screen|ua|drug|qualitative|test|immunoassay)$/.test(w)).join(" ");
  for (const [re, key] of _DRUGS) if (re.test(drug) || re.test(drugFull)) return [`drug:${key}`];
  // 7. Curated name variants (PT/INR carries both keys).
  const idx = _sameTestIndex();
  if (/^pt\s*\/\s*inr$/i.test(raw)) return ["same:pt", "same:inr"];
  for (const cand of [_wordKey(raw), _wordKey(_stripParens(raw))]) {
    const k = idx.get(cand);
    if (k && (cand === _wordKey(raw) || !_SPECIMEN_WORDS.test(lower))) return [`same:${k}`];
  }
  // 8. The name, ignoring case, spacing, punctuation, word order, trailing plural.
  return [`name:${_wordKey(raw)}`];
}

// First identity key (kept for callers that need one string).
export function correlationGroupKey(analyte: string): string {
  return sameTestKeys(analyte)[0];
}

export interface CorrelationGroupInfo {
  /** Distinct instruments running this test under any name on the map. */
  instrumentCount: number;
  /** The OTHER analytes on the map that are the same test (e.g. "LYMPH%" for "Lymphocytes"). */
  peers: string[];
}

/**
 * For every analyte, the distinct instruments running the same test under any name,
 * and those other names. Input: analyte -> instruments running it (each with an id,
 * or instrument_id, or at least an instrument_name). Not transitive: a whole
 * differential ("Manual Diff") pairs with LYMPH% and with NEUT%, but LYMPH% does not
 * pair with NEUT%.
 */
export function correlationGroupsFor(
  instrByAnalyte: Record<string, Array<{ id?: number | string; instrument_id?: number | string; instrument_name?: string; name?: string }>>,
): Record<string, CorrelationGroupInfo> {
  const keysOf = new Map<string, string[]>();
  const byKey = new Map<string, string[]>();
  for (const analyte of Object.keys(instrByAnalyte)) {
    const ks = sameTestKeys(analyte);
    keysOf.set(analyte, ks);
    for (const k of ks) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(analyte);
    }
  }
  const instrKey = (i: any) => String(i?.id ?? i?.instrument_id ?? i?.instrument_name ?? i?.name ?? "");
  const out: Record<string, CorrelationGroupInfo> = {};
  for (const [analyte, ks] of keysOf) {
    const members = new Set<string>();
    for (const k of ks) for (const m of byKey.get(k) ?? []) members.add(m);
    const ids = new Set<string>();
    for (const m of members) for (const i of instrByAnalyte[m] ?? []) { const k = instrKey(i); if (k) ids.add(k); }
    out[analyte] = { instrumentCount: ids.size, peers: [...members].filter((x) => x !== analyte).sort() };
  }
  return out;
}
