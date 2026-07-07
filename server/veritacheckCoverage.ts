// server/veritacheckCoverage.ts
//
// VeritaCheck Coverage: cross-references a lab's VeritaMap (what verification is
// required) against their studies (what they have). Powers the Coverage page
// and GET /api/labs/:labId/veritacheck/coverage.
//
// Two recurring requirements are modeled:
//   1. Method comparison: an analyte reported off 2+ instruments needs the
//      instruments correlated (biannual instrument comparison).
//   2. Cal Ver / Linearity: per analyte x instrument, verifies the reportable
//      range, UNLESS the method is exempt. Two exemptions (per the lab director):
//        - 3+ calibrators: a calibration spanning the AMR verifies linearity
//          through the calibration itself, so no separate study is required.
//        - Not calibratable: an analyzer with no operator calibration (e.g. the
//          GEM Premier 5000 blood-gas analyzer) has no linearity to verify.
//      Either exemption drops the combo from the required cal-ver set.
//
// Instrument matching uses the map's registered nickname first (the map knows
// "Bonnie" is the Ortho VITROS 5600), then falls back to model-token overlap.

export type LinearityStatus = "covered" | "review" | "missing" | "exempt";

export interface CoverageRow {
  instrumentTestId: number;
  specialty: string;
  analyte: string;
  instrument: string;
  linearityExemptMultical: boolean;
  linearityExemptNoncal: boolean;
  linearityRequired: boolean;
  linearityStatus: LinearityStatus;
  studyIds: number[];
  verdict: string;
  signed: boolean;
}
export interface MethodComparisonRow {
  analyte: string;
  instruments: string[];
  hasStudy: boolean;
  studyId: number | null;
  verdict: string;
  signed: boolean;
}
export interface UnmappedStudy {
  id: number;
  testName: string;
  studyType: string;
  instrument: string;
  date: string;
  verdict: string;
  signed: boolean;
}
export interface CoverageResult {
  hasMap: boolean;
  summary: {
    combos: number;
    instruments: number;
    analytes: number;
    studies: number;
    linearityRequired: number;
    linearityCovered: number;
    linearityReview: number;
    linearityMissing: number;
    linearityExempt: number;
    methodComparisonsNeeded: number;
    methodComparisonsDone: number;
    bySpecialty: { specialty: string; combos: number; required: number; covered: number; review: number; missing: number; exempt: number }[];
  };
  rows: CoverageRow[];
  methodComparisons: MethodComparisonRow[];
  unmappedStudies: UnmappedStudy[];
}

const LINEARITY_TYPES = new Set(["cal_ver", "linearity"]);
const STOP = new Set(["s", "n", "sn", "the", "method", "test", "manual", "system", "analyzer", "laboratory", "instrumentation"]);

function instrTokens(s: string): Set<string> {
  const cleaned = (s || "").toLowerCase().replace(/s\/n\s*\S+/g, " ").replace(/[^a-z0-9]+/g, " ");
  return new Set(cleaned.split(" ").filter((x) => x && !STOP.has(x)));
}
function normAnalyte(s: string): string {
  return (s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function analyteMatch(a: string, b: string): boolean {
  const na = normAnalyte(a), nb = normAnalyte(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na));
}
function studyMatchesInstrument(studyInstr: string, mapName: string, mapNick: string | null): boolean {
  const si = (studyInstr || "").toLowerCase();
  const nick = (mapNick || "").trim().toLowerCase();
  if (nick && si.includes(nick)) return true;
  const st = instrTokens(studyInstr), mt = instrTokens(mapName);
  if (mt.size === 0) return false;
  let common = 0;
  for (const x of mt) if (st.has(x)) common++;
  return common / mt.size >= 0.6;
}

type Study = { id: number; test_name: string; instrument: string; study_type: string; status: string; lifecycle_state: string; date?: string };
type Instrument = { id: number; instrument_name: string; nickname: string | null; serial_number?: string | null };
type Combo = { id: number; analyte: string; specialty: string; instrument_id: number; linearity_exempt_multical?: number; linearity_exempt_noncal?: number };

// Display label that distinguishes two units of the same model. A lab can run
// the same analyzer twice (e.g. two Ortho VITROS 5600 named Bonnie and Clyde);
// those still need a method comparison between them, so the label carries the
// nickname (or serial) to make the pair legible instead of collapsing to one name.
function instLabel(i?: Instrument): string {
  if (!i) return "(unknown)";
  const extra = (i.nickname || "").trim() || (i.serial_number || "").trim();
  return extra ? `${i.instrument_name} (${extra})` : i.instrument_name;
}

export function computeCoverageFrom(instruments: Instrument[], combos: Combo[], studies: Study[]): CoverageResult {
  const instrById = new Map<number, Instrument>();
  for (const i of instruments) instrById.set(i.id, i);

  const rows: CoverageRow[] = [];
  const bySpec = new Map<string, { combos: number; required: number; covered: number; review: number; missing: number; exempt: number }>();
  let linRequired = 0, linCovered = 0, linReview = 0, linMissing = 0, linExempt = 0;

  for (const c of combos) {
    const inst = instrById.get(c.instrument_id);
    const instName = inst?.instrument_name || "";
    const multical = !!c.linearity_exempt_multical;
    const noncal = !!c.linearity_exempt_noncal;
    const exempt = multical || noncal;

    // Only cal-ver / linearity studies count toward the linearity requirement.
    const linCands = studies.filter((s) => LINEARITY_TYPES.has(s.study_type) && analyteMatch(s.test_name, c.analyte));
    const onInst = inst ? linCands.filter((s) => studyMatchesInstrument(s.instrument, instName, inst.nickname)) : [];

    let status: LinearityStatus; let matched: Study[];
    if (exempt) { status = "exempt"; matched = onInst; }
    else if (onInst.length) { status = "covered"; matched = onInst; }
    else if (linCands.length) { status = "review"; matched = linCands; }
    else { status = "missing"; matched = []; }

    if (status !== "exempt") linRequired++;
    if (status === "covered") linCovered++;
    else if (status === "review") linReview++;
    else if (status === "missing") linMissing++;
    else linExempt++;

    const sp = bySpec.get(c.specialty) || { combos: 0, required: 0, covered: 0, review: 0, missing: 0, exempt: 0 };
    sp.combos++;
    if (status !== "exempt") sp.required++;
    (sp as any)[status]++;
    bySpec.set(c.specialty, sp);

    rows.push({
      instrumentTestId: c.id,
      specialty: c.specialty,
      analyte: c.analyte,
      instrument: inst ? instLabel(inst) : "(unknown)",
      linearityExemptMultical: multical,
      linearityExemptNoncal: noncal,
      linearityRequired: !exempt,
      linearityStatus: status,
      studyIds: matched.slice(0, 8).map((s) => s.id),
      verdict: Array.from(new Set(matched.map((s) => (s.status || "").toLowerCase()).filter(Boolean))).sort().join(", "),
      signed: matched.length > 0 && matched.every((s) => s.lifecycle_state === "finalized"),
    });
  }

  // Method comparisons: analytes running on 2+ instruments need a correlation.
  // Count DISTINCT instrument_ids (two units of the same model still count as
  // two, and both are shown via instLabel so the pair is legible).
  const instByAnalyte = new Map<string, Set<number>>();
  for (const c of combos) {
    if (!instByAnalyte.has(c.analyte)) instByAnalyte.set(c.analyte, new Set());
    instByAnalyte.get(c.analyte)!.add(c.instrument_id);
  }
  const methodComparisons: MethodComparisonRow[] = [];
  let mcNeeded = 0, mcDone = 0;
  for (const [analyte, instIds] of instByAnalyte) {
    if (instIds.size < 2) continue;
    mcNeeded++;
    const mc = studies.find((s) => s.study_type === "method_comparison" && analyteMatch(s.test_name, analyte)) || null;
    if (mc) mcDone++;
    methodComparisons.push({
      analyte,
      instruments: Array.from(instIds).map((id) => instLabel(instrById.get(id))).sort(),
      hasStudy: !!mc,
      studyId: mc ? mc.id : null,
      verdict: mc ? (mc.status || "").toLowerCase() : "",
      signed: !!(mc && mc.lifecycle_state === "finalized"),
    });
  }
  methodComparisons.sort((a, b) => a.analyte.localeCompare(b.analyte));

  const statusOrder: Record<LinearityStatus, number> = { missing: 0, review: 1, covered: 2, exempt: 3 };
  rows.sort((a, b) => a.specialty.localeCompare(b.specialty) || statusOrder[a.linearityStatus] - statusOrder[b.linearityStatus] || a.analyte.localeCompare(b.analyte));

  // Verification studies on file whose name matches NO map analyte, so they are
  // credited to no coverage row and the required point still reads "Missing".
  // Usually a naming-convention gap (e.g. study "AST" vs map "Aspartate
  // aminotransferase (AST) (SGOT)") or a typo. Surfaced so the director can align
  // them instead of the work going uncounted.
  const COVERAGE_STUDY_TYPES = new Set(["method_comparison", "correlation", "cal_ver", "linearity"]);
  const mapAnalytes = combos.map((c) => c.analyte);
  const unmappedStudies: UnmappedStudy[] = studies
    .filter((s) => COVERAGE_STUDY_TYPES.has(s.study_type) && !mapAnalytes.some((a) => analyteMatch(s.test_name, a)))
    .map((s) => ({
      id: s.id,
      testName: s.test_name,
      studyType: s.study_type,
      instrument: s.instrument || "",
      date: s.date || "",
      verdict: (s.status || "").toLowerCase(),
      signed: s.lifecycle_state === "finalized",
    }))
    .sort((a, b) => a.testName.localeCompare(b.testName));

  return {
    hasMap: combos.length > 0,
    summary: {
      combos: combos.length,
      instruments: instruments.length,
      analytes: instByAnalyte.size,
      studies: studies.length,
      linearityRequired: linRequired,
      linearityCovered: linCovered,
      linearityReview: linReview,
      linearityMissing: linMissing,
      linearityExempt: linExempt,
      methodComparisonsNeeded: mcNeeded,
      methodComparisonsDone: mcDone,
      bySpecialty: Array.from(bySpec.entries()).map(([specialty, v]) => ({ specialty, ...v })).sort((a, b) => a.specialty.localeCompare(b.specialty)),
    },
    rows,
    methodComparisons,
    unmappedStudies,
  };
}

export function computeCoverageForLab(sqlite: any, labId: number): CoverageResult {
  const instruments = sqlite.prepare(
    `SELECT i.id, i.instrument_name, i.nickname, i.serial_number
     FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id
     WHERE m.lab_id = ?`
  ).all(labId) as Instrument[];
  const combos = sqlite.prepare(
    `SELECT it.id, it.analyte, it.specialty, it.instrument_id,
            it.linearity_exempt_multical, it.linearity_exempt_noncal
     FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE m.lab_id = ? AND (it.active = 1 OR it.active IS NULL)`
  ).all(labId) as Combo[];
  const studies = sqlite.prepare(
    `SELECT id, test_name, instrument, study_type, status, lifecycle_state, date
     FROM studies WHERE lab_id = ? AND archived_at IS NULL`
  ).all(labId) as Study[];
  return computeCoverageFrom(instruments, combos, studies);
}

// Sets the two linearity-exemption flags on one instrument_test, scoped to the
// lab (the test must belong to a map owned by this lab). Returns false when the
// test is not found in the lab.
export function setLinearityExemption(sqlite: any, labId: number, instrumentTestId: number, multical: boolean, noncal: boolean): boolean {
  const owns = sqlite.prepare(
    `SELECT it.id FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE it.id = ? AND m.lab_id = ?`
  ).get(instrumentTestId, labId);
  if (!owns) return false;
  sqlite.prepare(
    "UPDATE veritamap_instrument_tests SET linearity_exempt_multical = ?, linearity_exempt_noncal = ? WHERE id = ?"
  ).run(multical ? 1 : 0, noncal ? 1 : 0, instrumentTestId);
  return true;
}
