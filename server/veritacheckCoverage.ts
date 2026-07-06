// server/veritacheckCoverage.ts
//
// VeritaCheck Coverage: cross-references a lab's VeritaMap (what they need to
// verify) against their studies (what they have). Powers the Coverage page and
// GET /api/labs/:labId/veritacheck/coverage.
//
// "Need" = every active analyte-by-instrument combination in the lab's map(s).
// "Have" = the lab's non-archived studies. A combo is COVERED when a study
// matches the analyte AND that instrument, REVIEW when a study exists for the
// analyte but not clearly on that instrument (nickname or naming mismatch that
// a human should confirm), and MISSING when there is no study for the analyte.
//
// Instrument matching uses the map's registered nickname first (the map knows
// "Bonnie" is the Ortho VITROS 5600), then falls back to model-token overlap.

export type CoverageStatus = "covered" | "review" | "missing";
export interface CoverageRow {
  specialty: string;
  analyte: string;
  instrument: string;
  status: CoverageStatus;
  studyIds: number[];
  studyTypes: string[];
  verdicts: string[];
  signed: "yes" | "no" | "partial" | "";
}
export interface MethodComparisonRow {
  analyte: string;
  instruments: string[];
  hasStudy: boolean;
  studyId: number | null;
  verdict: string;
  signed: boolean;
}
export interface CoverageResult {
  hasMap: boolean;
  summary: {
    combos: number;
    covered: number;
    review: number;
    missing: number;
    instruments: number;
    analytes: number;
    studies: number;
    methodComparisonsNeeded: number;
    methodComparisonsDone: number;
    bySpecialty: { specialty: string; combos: number; covered: number; review: number; missing: number }[];
  };
  rows: CoverageRow[];
  methodComparisons: MethodComparisonRow[];
}

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
// A study's free-text instrument matches a map instrument when it contains the
// registered nickname, or shares >=60% of the model's significant tokens.
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

type Study = { id: number; test_name: string; instrument: string; study_type: string; status: string; lifecycle_state: string };
type Instrument = { id: number; instrument_name: string; nickname: string | null };
type Combo = { analyte: string; specialty: string; instrument_id: number };

export function computeCoverageFrom(instruments: Instrument[], combos: Combo[], studies: Study[]): CoverageResult {
  const instrById = new Map<number, Instrument>();
  for (const i of instruments) instrById.set(i.id, i);

  const signedOf = (matched: Study[]): CoverageRow["signed"] => {
    if (!matched.length) return "";
    const fin = matched.filter((s) => s.lifecycle_state === "finalized").length;
    return fin === matched.length ? "yes" : fin > 0 ? "partial" : "no";
  };

  const rows: CoverageRow[] = [];
  const bySpec = new Map<string, { combos: number; covered: number; review: number; missing: number }>();
  let covered = 0, review = 0, missing = 0;

  for (const c of combos) {
    const inst = instrById.get(c.instrument_id);
    const instName = inst?.instrument_name || "";
    const cands = studies.filter((s) => analyteMatch(s.test_name, c.analyte));
    const onInst = inst ? cands.filter((s) => studyMatchesInstrument(s.instrument, instName, inst.nickname)) : [];
    let status: CoverageStatus; let matched: Study[];
    if (onInst.length) { status = "covered"; matched = onInst; }
    else if (cands.length) { status = "review"; matched = cands; }
    else { status = "missing"; matched = []; }

    if (status === "covered") covered++; else if (status === "review") review++; else missing++;
    const sp = bySpec.get(c.specialty) || { combos: 0, covered: 0, review: 0, missing: 0 };
    sp.combos++; (sp as any)[status]++; bySpec.set(c.specialty, sp);

    rows.push({
      specialty: c.specialty,
      analyte: c.analyte,
      instrument: instName || "(unknown)",
      status,
      studyIds: matched.slice(0, 8).map((s) => s.id),
      studyTypes: Array.from(new Set(matched.map((s) => s.study_type))).sort(),
      verdicts: Array.from(new Set(matched.map((s) => (s.status || "").toLowerCase()).filter(Boolean))).sort(),
      signed: signedOf(matched),
    });
  }

  // Method comparisons: analytes running on 2+ instruments need a correlation.
  const instByAnalyte = new Map<string, Set<number>>();
  const instNameByAnalyte = new Map<string, Set<string>>();
  for (const c of combos) {
    if (!instByAnalyte.has(c.analyte)) { instByAnalyte.set(c.analyte, new Set()); instNameByAnalyte.set(c.analyte, new Set()); }
    instByAnalyte.get(c.analyte)!.add(c.instrument_id);
    const nm = instrById.get(c.instrument_id)?.instrument_name;
    if (nm) instNameByAnalyte.get(c.analyte)!.add(nm);
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
      instruments: Array.from(instNameByAnalyte.get(analyte) || []).sort(),
      hasStudy: !!mc,
      studyId: mc ? mc.id : null,
      verdict: mc ? (mc.status || "").toLowerCase() : "",
      signed: !!(mc && mc.lifecycle_state === "finalized"),
    });
  }
  methodComparisons.sort((a, b) => a.analyte.localeCompare(b.analyte));

  const statusOrder: Record<CoverageStatus, number> = { missing: 0, review: 1, covered: 2 };
  rows.sort((a, b) => a.specialty.localeCompare(b.specialty) || statusOrder[a.status] - statusOrder[b.status] || a.analyte.localeCompare(b.analyte));

  return {
    hasMap: combos.length > 0,
    summary: {
      combos: combos.length,
      covered, review, missing,
      instruments: instruments.length,
      analytes: instByAnalyte.size,
      studies: studies.length,
      methodComparisonsNeeded: mcNeeded,
      methodComparisonsDone: mcDone,
      bySpecialty: Array.from(bySpec.entries()).map(([specialty, v]) => ({ specialty, ...v })).sort((a, b) => a.specialty.localeCompare(b.specialty)),
    },
    rows,
    methodComparisons,
  };
}

// DB-backed entry point used by the route. `sqlite` is the better-sqlite3 client.
export function computeCoverageForLab(sqlite: any, labId: number): CoverageResult {
  const instruments = sqlite.prepare(
    `SELECT i.id, i.instrument_name, i.nickname
     FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id
     WHERE m.lab_id = ?`
  ).all(labId) as Instrument[];
  const combos = sqlite.prepare(
    `SELECT it.analyte, it.specialty, it.instrument_id
     FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE m.lab_id = ? AND (it.active = 1 OR it.active IS NULL)`
  ).all(labId) as Combo[];
  const studies = sqlite.prepare(
    `SELECT id, test_name, instrument, study_type, status, lifecycle_state
     FROM studies WHERE lab_id = ? AND archived_at IS NULL`
  ).all(labId) as Study[];
  return computeCoverageFrom(instruments, combos, studies);
}
