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

import { aliasesForPresetLabel, presetKeyForLabel } from "@shared/presetAnalytes";

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
  // Director's explicit alignment: the map analyte this study is credited to,
  // set via the Align action (keeps the study's own name). "" = not yet aligned.
  coverageAnalyte: string;
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

type Study = { id: number; test_name: string; instrument: string; study_type: string; status: string; lifecycle_state: string; date?: string; coverage_analyte?: string | null };

// A study counts toward a map analyte when its name matches (the automatic path)
// OR the director has explicitly aligned it to that analyte (coverage_analyte).
// The override keeps the study's own name; it only supplies the analyte identity
// the strict name matcher could not infer. Instrument matching still applies
// downstream, so an aligned study credits only its own instrument's combos.
function matchesAnalyte(s: Study, analyte: string): boolean {
  return (!!s.coverage_analyte && s.coverage_analyte === analyte) || analyteMatch(s.test_name, analyte);
}
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
    const linCands = studies.filter((s) => LINEARITY_TYPES.has(s.study_type) && matchesAnalyte(s, c.analyte));
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
    const mc = studies.find((s) => s.study_type === "method_comparison" && matchesAnalyte(s, analyte)) || null;
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
  // The list is by study NAME not matching (a stable property), so an aligned
  // study stays visible here with its target shown, giving the director a handle
  // to change or clear the alignment. Unaligned rows sort first.
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
      coverageAnalyte: s.coverage_analyte || "",
    }))
    .sort((a, b) => (a.coverageAnalyte ? 1 : 0) - (b.coverageAnalyte ? 1 : 0) || a.testName.localeCompare(b.testName));

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
    `SELECT id, test_name, instrument, study_type, status, lifecycle_state, date, coverage_analyte
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

// Resolves a CLIA preset (its frozen label) to the single VeritaMap analyte it
// identifies, given the lab's active map-analyte names. Exact case-insensitive
// equality wins first (so "RBC" picks map "RBC", not "RBC (urine micro)", and
// "Creatinine" picks serum "Creatinine", not "Creatinine, urine"); otherwise the
// paren-stripping fuzzy matcher must land on exactly ONE analyte. Anything
// ambiguous or unmatched returns null (no guess) so the study falls to the
// custom/challenge path. Pure + testable.
export function resolvePresetAnalyteFrom(mapAnalytes: string[], presetLabel: string): string | null {
  const aliases = aliasesForPresetLabel(presetLabel);
  if (!aliases.length) return null;
  const lc = (s: string) => (s || "").trim().toLowerCase();
  const aliasLc = new Set(aliases.map(lc));
  const exact = Array.from(new Set(mapAnalytes.filter((a) => aliasLc.has(lc(a)))));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const fuzzy = Array.from(new Set(mapAnalytes.filter((a) => aliases.some((al) => analyteMatch(al, a)))));
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

// Safety gate against a STALE/DEFAULT preset. The study-create form defaults the
// TEa dropdown to index 0 (ALT/SGPT), and studies get saved without changing it
// (e.g. toxicology drug screens with no canonical TEa), so clia_preset_label is
// an unreliable identity on its own — auto-attributing from it alone would credit
// a Buprenorphine study to ALT. We only trust the preset when the study's OWN
// test_name corroborates it: the name slugs to the same preset key, or matches a
// preset alias by exact-lc/paren-stripping. A name that clearly names a different
// analyte (Buprenorphine vs ALT) fails this and the study falls to the challenge.
export function presetCorroboratesName(presetLabel: string, testName: string): boolean {
  const tn = (testName || "").trim();
  if (!tn) return false;
  const key = presetKeyForLabel(presetLabel);
  if (key && key === presetKeyForLabel(tn)) return true;
  const tnLc = tn.toLowerCase();
  return aliasesForPresetLabel(presetLabel).some((a) => a.trim().toLowerCase() === tnLc || analyteMatch(a, tn));
}

// DB-backed wrapper: pulls the lab's active map analytes and resolves the preset.
export function resolvePresetMapAnalyte(sqlite: any, labId: number, presetLabel: string): string | null {
  if (!presetLabel) return null;
  const mapAnalytes = (sqlite.prepare(
    `SELECT DISTINCT it.analyte FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE m.lab_id = ? AND (it.active = 1 OR it.active IS NULL)`
  ).all(labId) as Array<{ analyte: string }>).map((r) => r.analyte).filter(Boolean);
  return resolvePresetAnalyteFrom(mapAnalytes, presetLabel);
}

// Aligns one study to a map analyte (or clears it when analyte is empty). Both
// the study and the analyte are validated against THIS lab: the study must
// belong to the lab, and a non-empty analyte must be a real analyte on the lab's
// VeritaMap (so a typo or a foreign analyte cannot be stored). This keeps the
// study's name; Coverage credits it to the analyte via matchesAnalyte.
export function alignStudyToAnalyte(
  sqlite: any,
  labId: number,
  studyId: number,
  analyte: string,
): { ok: boolean; reason?: "study_not_found" | "unknown_analyte" } {
  const owns = sqlite.prepare("SELECT id FROM studies WHERE id = ? AND lab_id = ?").get(studyId, labId);
  if (!owns) return { ok: false, reason: "study_not_found" };
  const clean = (analyte || "").trim();
  if (clean) {
    const known = sqlite.prepare(
      `SELECT 1 FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
       WHERE m.lab_id = ? AND it.analyte = ? AND (it.active = 1 OR it.active IS NULL) LIMIT 1`
    ).get(labId, clean);
    if (!known) return { ok: false, reason: "unknown_analyte" };
  }
  sqlite.prepare("UPDATE studies SET coverage_analyte = ? WHERE id = ? AND lab_id = ?")
    .run(clean || null, studyId, labId);
  return { ok: true };
}
