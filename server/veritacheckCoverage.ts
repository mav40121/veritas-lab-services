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

import { aliasesForPresetLabel, presetKeyForLabel, analytesShareGroup, sameTestKeys } from "@shared/presetAnalytes";
import { labToday } from "./dateLocal";

export type LinearityStatus = "covered" | "review" | "missing" | "exempt";
// Recurrence-aware cal-ver / linearity status, mirroring method comparison
// (§493.1255: calibration verification at least every 6 months). Exempt and
// review are terminal / data-quality and never carry a next-due date.
export type CalVerStatus = "missing" | "failed" | "completed_unsigned" | "review" | "exempt";

export interface CoverageRow {
  instrumentTestId: number;
  specialty: string;
  analyte: string;
  instrument: string;
  linearityExemptMultical: boolean;
  linearityExemptNoncal: boolean;
  linearityExemptWaived: boolean;
  linearityExemptOther: string;
  linearityRequired: boolean;
  linearityStatus: LinearityStatus; // recurrence-aware bucket: "covered" = satisfied THIS cycle
  studyIds: number[];
  verdict: string;
  signed: boolean;
  status: CalVerStatus;      // granular current-cycle state (mirrors method comparison)
  nextDueOn: string | null;  // YYYY-MM-DD; last signed study + 6 months, else null
  overdue: boolean;          // a concrete next-due date is in the past
  outsideRecord: OutsideRecordRef | null; // set when a study recorded outside VeritaCheck drives the current cycle
}
// A study the lab performed outside VeritaCheck, recorded on the Coverage page (Q16, 2026-10-24).
export interface OutsideRecordRef { id: number; performedOn: string; recordsLocation: string; reviewedBy: string }
export type OutsideRecord = { id: number; kind: "cal_ver" | "method_comparison"; instrument_id: number | null; analyte: string; performed_on: string; records_location: string; reviewed_by: string };
// Recurrence-aware method comparison / correlation status (§493.1281: compare
// twice a year). A signed study banks that cycle and the requirement rolls to
// its next due date; it is never "done forever". Status is the current-cycle
// state; nextDueOn is the date the next signature is due (signed date + 6 mo).
export type MethodComparisonStatus = "missing" | "failed" | "completed_unsigned";
export interface MethodComparisonRow {
  analyte: string;
  instruments: string[];
  hasStudy: boolean;
  studyId: number | null;
  verdict: string;
  signed: boolean;
  status: MethodComparisonStatus;
  nextDueOn: string | null; // YYYY-MM-DD; null = owed now (never signed a passing study)
  overdue: boolean;         // a concrete next-due date is in the past
  outsideRecord: OutsideRecordRef | null; // set when a study recorded outside VeritaCheck drives the current cycle
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
    methodComparisonsDone: number;    // satisfied THIS cycle (signed + next due in the future)
    methodComparisonsOverdue: number; // a next-due date has passed
    bySpecialty: { specialty: string; combos: number; required: number; covered: number; review: number; missing: number; exempt: number }[];
  };
  rows: CoverageRow[];
  methodComparisons: MethodComparisonRow[];
  unmappedStudies: UnmappedStudy[];
  outsideRecords?: OutsideRecordListItem[]; // computeCoverageForLab only: the lab's active outside records
}
export interface OutsideRecordListItem {
  id: number; kind: "cal_ver" | "method_comparison"; analyte: string; instrument: string;
  performedOn: string; recordsLocation: string; reviewedBy: string; notes: string; createdAt: string; createdBy: string;
}

// cal_ver_correlation (2026-10-15) answers both requirements: it is in this set and in MC_STUDY_TYPES.
const LINEARITY_TYPES = new Set(["cal_ver", "linearity", "cal_ver_correlation"]);
const STOP = new Set(["s", "n", "sn", "the", "method", "test", "manual", "system", "analyzer", "laboratory", "instrumentation"]);

function instrTokens(s: string): Set<string> {
  const cleaned = (s || "").toLowerCase().replace(/s\/n\s*\S+/g, " ").replace(/[^a-z0-9]+/g, " ");
  return new Set(cleaned.split(" ").filter((x) => x && !STOP.has(x)));
}
function normAnalyte(s: string): string {
  return (s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
export function analyteMatch(a: string, b: string): boolean {
  const na = normAnalyte(a), nb = normAnalyte(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  // Curated synonyms bridge spelled-out study names to abbreviated map codes the
  // string matcher can't reach (e.g. "Eosinophils" -> "EO#"/"EO%", "Hemoglobin"
  // -> "HGB"). Only curated groups match, so no fuzzy false positives. 2026-07-09.
  return analytesShareGroup(a, b);
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

type Study = { id: number; test_name: string; instrument: string; study_type: string; status: string; lifecycle_state: string; date?: string; finalized_at?: string | null; coverage_analyte?: string | null; outside?: OutsideRecordRef };

// An outside record takes part in the same "most recent wins" comparison as a study: it reads as a signed, passing
// study dated performed_on, so it banks the cycle and the requirement recurs 6 months later. Its id is never mixed
// into studyIds (it is not a study); the row carries it as outsideRecord instead.
const realStudies = (xs: Study[]): Study[] => xs.filter((s) => !s.outside);
function outsideAsStudy(o: OutsideRecord): Study {
  return {
    id: 0, test_name: o.analyte, instrument: "", study_type: o.kind, status: "pass", lifecycle_state: "finalized",
    date: o.performed_on, finalized_at: o.performed_on, coverage_analyte: o.analyte,
    outside: { id: o.id, performedOn: o.performed_on, recordsLocation: o.records_location, reviewedBy: o.reviewed_by },
  };
}

// Method comparison / correlation recurrence interval (CLIA §493.1281: at least
// twice a year). Both study types satisfy the requirement.
const MC_INTERVAL_MONTHS = 6;
// Cal-ver / linearity recurs at least every 6 months (CLIA §493.1255).
const LINEARITY_INTERVAL_MONTHS = 6;
const MC_STUDY_TYPES = new Set(["method_comparison", "correlation", "cal_ver_correlation"]);
function addMonthsIso(iso: string, months: number): string {
  const parts = String(iso).slice(0, 10).split("-").map((n) => parseInt(n, 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return String(iso).slice(0, 10);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}
// The lab's calendar day (per-lab time zone, 2026-10-27): the request's lab clock, not the UTC day.
function todayIso(): string { return labToday(); }
// A study "failed" when its verdict is a fail; "completed"/"pass" are not failures.
function isFailVerdict(status: string): boolean {
  const s = (status || "").toLowerCase();
  return s.includes("fail") || s.includes("not accept") || s === "rejected";
}

// A study counts toward a map analyte when its name matches (the automatic path)
// OR the director has explicitly aligned it to that analyte (coverage_analyte).
// The override keeps the study's own name; it only supplies the analyte identity
// the strict name matcher could not infer. Instrument matching still applies
// downstream, so an aligned study credits only its own instrument's combos.
function matchesAnalyte(s: Study, analyte: string): boolean {
  return (!!s.coverage_analyte && s.coverage_analyte === analyte) || analyteMatch(s.test_name, analyte);
}
type Instrument = { id: number; instrument_name: string; nickname: string | null; serial_number?: string | null };
type Combo = { id: number; analyte: string; specialty: string; instrument_id: number; complexity?: string | null; test_cal_ver_na?: number; test_method_comp_na?: number; linearity_exempt_multical?: number; linearity_exempt_noncal?: number; linearity_exempt_waived?: number; linearity_exempt_other?: string | null };

// Display label that distinguishes two units of the same model. A lab can run
// the same analyzer twice (e.g. two Ortho VITROS 5600 named Bonnie and Clyde);
// those still need a method comparison between them, so the label carries the
// nickname (or serial) to make the pair legible instead of collapsing to one name.
function instLabel(i?: Instrument): string {
  if (!i) return "(unknown)";
  const extra = (i.nickname || "").trim() || (i.serial_number || "").trim();
  return extra ? `${i.instrument_name} (${extra})` : i.instrument_name;
}

export function computeCoverageFrom(instruments: Instrument[], combos: Combo[], studies: Study[], outside: OutsideRecord[] = []): CoverageResult {
  const instrById = new Map<number, Instrument>();
  for (const i of instruments) instrById.set(i.id, i);

  const rows: CoverageRow[] = [];
  const bySpec = new Map<string, { combos: number; required: number; covered: number; review: number; missing: number; exempt: number }>();
  let linRequired = 0, linCovered = 0, linReview = 0, linMissing = 0, linExempt = 0;
  const today = todayIso();

  for (const c of combos) {
    const inst = instrById.get(c.instrument_id);
    const instName = inst?.instrument_name || "";
    const multical = !!c.linearity_exempt_multical;
    const noncal = !!c.linearity_exempt_noncal;
    // BUG-016 (2026-10-09): a WAIVED test is exempt by its complexity (cal ver 493.1255 and comparison 493.1281
    // are Subpart K, nonwaived only), not only when someone ticked the manual 'waived' exemption.
    const waived = !!c.linearity_exempt_waived || String(c.complexity || "").toUpperCase() === "WAIVED";
    const other = (c.linearity_exempt_other || "").trim();
    // A per-test "cal ver not applicable" on the map (veritamap_tests.cal_ver_na,
    // parking lot #77 part B) exempts the combo the same way the row flags do.
    const exempt = multical || noncal || waived || !!other || !!c.test_cal_ver_na;

    // Only cal-ver / linearity studies count toward the linearity requirement.
    const linCands = studies.filter((s) => LINEARITY_TYPES.has(s.study_type) && matchesAnalyte(s, c.analyte));
    const onInst = inst ? linCands.filter((s) => studyMatchesInstrument(s.instrument, instName, inst.nickname)) : [];
    // Studies recorded outside VeritaCheck are kept per instrument + analyte, so they match exactly (no name matching).
    const outsideHere = outside.filter((o) => o.kind === "cal_ver" && o.instrument_id === c.instrument_id && o.analyte === c.analyte).map(outsideAsStudy);
    // Recurrence: the MOST RECENT on-instrument study (or outside record) drives the current cycle.
    const onInstSorted = onInst.concat(outsideHere).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const latest = onInstSorted[0] || null;

    let linStatus: LinearityStatus;   // recurrence-aware bucket (covered = satisfied this cycle)
    let calStatus: CalVerStatus;      // granular current-cycle state
    let matched: Study[];
    let nextDueOn: string | null = null;
    let overdue = false;
    if (exempt) {
      linStatus = "exempt"; calStatus = "exempt"; matched = onInstSorted;
    } else if (!latest) {
      // no ON-INSTRUMENT study: either a study exists for the analyte elsewhere
      // (align it) or nothing at all.
      if (linCands.length) { linStatus = "review"; calStatus = "review"; matched = linCands; }
      else { linStatus = "missing"; calStatus = "missing"; matched = []; }
    } else if (isFailVerdict(latest.status)) {
      linStatus = "missing"; calStatus = "failed"; matched = onInstSorted;
    } else if (latest.lifecycle_state !== "finalized") {
      linStatus = "missing"; calStatus = "completed_unsigned"; matched = onInstSorted;
    } else {
      // signed + passing on-instrument study: banked this cycle, recurs at +6mo.
      const signedDate = String(latest.finalized_at || latest.date || "").slice(0, 10);
      nextDueOn = signedDate ? addMonthsIso(signedDate, LINEARITY_INTERVAL_MONTHS) : null;
      overdue = !!nextDueOn && nextDueOn < today;
      matched = onInstSorted;
      calStatus = "missing"; // signed resets to "missing" (banked); nextDueOn carries the date
      // Satisfied this cycle when the next-due is still ahead, OR when no date is
      // recorded (legacy study) so recurrence cannot be computed -- do not regress
      // a signed passing study to "missing" just for a missing date.
      linStatus = (!nextDueOn || !overdue) ? "covered" : "missing";
    }

    if (linStatus !== "exempt") linRequired++;
    if (linStatus === "covered") linCovered++;
    else if (linStatus === "review") linReview++;
    else if (linStatus === "missing") linMissing++;
    else linExempt++;

    const sp = bySpec.get(c.specialty) || { combos: 0, required: 0, covered: 0, review: 0, missing: 0, exempt: 0 };
    sp.combos++;
    if (linStatus !== "exempt") sp.required++;
    (sp as any)[linStatus]++;
    bySpec.set(c.specialty, sp);

    rows.push({
      instrumentTestId: c.id,
      specialty: c.specialty,
      analyte: c.analyte,
      instrument: inst ? instLabel(inst) : "(unknown)",
      linearityExemptMultical: multical,
      linearityExemptNoncal: noncal,
      linearityExemptWaived: waived,
      linearityExemptOther: other,
      linearityRequired: !exempt,
      linearityStatus: linStatus,
      studyIds: realStudies(matched).slice(0, 8).map((s) => s.id),
      verdict: Array.from(new Set(realStudies(matched).map((s) => (s.status || "").toLowerCase()).filter(Boolean))).sort().join(", "),
      signed: realStudies(matched).length > 0 && realStudies(matched).every((s) => s.lifecycle_state === "finalized"),
      status: calStatus,
      nextDueOn,
      overdue,
      outsideRecord: !exempt && latest?.outside ? latest.outside : null,
    });
  }

  // Method comparisons: analytes running on 2+ instruments need a correlation.
  // Count DISTINCT instrument_ids (two units of the same model still count as
  // two, and both are shown via instLabel so the pair is legible).
  // Group by the test's identity keys (sameTestKeys), not the raw analyte string, so
  // a manual differential percentage ("Lymphs") and the analyzer's percentage point
  // ("Lymph%"/"LY%") collapse into ONE correlation requirement. Each group keeps its
  // member analyte strings (for study matching, which still runs the full fuzzy
  // matcher) and a stable display label.
  // BUG-011 (2026-10-09): one identity function for the map and coverage
  // (sameTestKeys): capital letters, a whole differential, NRBC, urine sediment,
  // blood bank method suffixes and drug-screen spellings no longer split a test.
  // A whole differential carries several keys, so it joins each class's group.
  const groups = new Map<string, { instIds: Set<number>; analytes: Set<string> }>();
  // BUG-016 (Michael 2026-10-09): only nonwaived instruments make a comparison required; including a waived
  // device is the lab's choice, not a CLIA requirement.
  for (const c of combos) {
    if (String(c.complexity || "").toUpperCase() === "WAIVED") continue;
    if (c.test_method_comp_na) continue; // BUG-015: the lab marked this test's comparison not applicable
    for (const key of sameTestKeys(c.analyte)) {
      let g = groups.get(key);
      if (!g) { g = { instIds: new Set(), analytes: new Set() }; groups.set(key, g); }
      g.instIds.add(c.instrument_id);
      g.analytes.add(c.analyte);
    }
  }
  const methodComparisons: MethodComparisonRow[] = [];
  let mcNeeded = 0, mcDone = 0, mcOverdue = 0;
  for (const g of groups.values()) {
    const instIds = g.instIds;
    if (instIds.size < 2) continue;
    // Stable display label for the correlation row: the alphabetically first member
    // analyte (e.g. "Lymph%" or "Lymphs"). The instruments column shows both units.
    const analyte = [...g.analytes].sort()[0];
    mcNeeded++;
    // Recurrence: look at the MOST RECENT matching study (method comparison OR
    // correlation). A signed passing study banks the current cycle and sets the
    // next due date (signed date + 6 mo); it does not satisfy the requirement
    // forever. Failed / unsigned / never-done all read as owed now.
    const cands = studies
      .filter((s) => MC_STUDY_TYPES.has(s.study_type) && [...g.analytes].some((a) => matchesAnalyte(s, a)))
      .concat(outside.filter((o) => o.kind === "method_comparison" && g.analytes.has(o.analyte)).map(outsideAsStudy))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const latest = cands[0] || null;
    let status: MethodComparisonStatus = "missing";
    let nextDueOn: string | null = null;
    let signed = false;
    if (latest) {
      if (isFailVerdict(latest.status)) {
        status = "failed";
      } else if (latest.lifecycle_state !== "finalized") {
        status = "completed_unsigned";
      } else {
        signed = true;
        const signedDate = String(latest.finalized_at || latest.date || "").slice(0, 10);
        nextDueOn = signedDate ? addMonthsIso(signedDate, MC_INTERVAL_MONTHS) : null;
        status = "missing"; // banked this cycle; recurs on nextDueOn
      }
    }
    const satisfiedNow = signed && !!nextDueOn && nextDueOn >= today;
    const overdue = !!nextDueOn && nextDueOn < today;
    if (satisfiedNow) mcDone++;
    if (overdue) mcOverdue++;
    methodComparisons.push({
      analyte,
      instruments: Array.from(instIds).map((id) => instLabel(instrById.get(id))).sort(),
      hasStudy: !!latest,
      studyId: latest && !latest.outside ? latest.id : null,
      verdict: latest ? (latest.status || "").toLowerCase() : "",
      signed,
      status,
      nextDueOn,
      overdue,
      outsideRecord: latest?.outside ?? null,
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
  const COVERAGE_STUDY_TYPES = new Set(["method_comparison", "correlation", "cal_ver", "linearity", "cal_ver_correlation"]);
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
      analytes: new Set(combos.map((c) => c.analyte)).size,
      studies: studies.length,
      linearityRequired: linRequired,
      linearityCovered: linCovered,
      linearityReview: linReview,
      linearityMissing: linMissing,
      linearityExempt: linExempt,
      methodComparisonsNeeded: mcNeeded,
      methodComparisonsDone: mcDone,
      methodComparisonsOverdue: mcOverdue,
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
    `SELECT it.id, it.analyte, it.specialty, it.instrument_id, it.complexity,
            it.linearity_exempt_multical, it.linearity_exempt_noncal,
            it.linearity_exempt_waived, it.linearity_exempt_other,
            t.cal_ver_na AS test_cal_ver_na, t.method_comp_na AS test_method_comp_na
     FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     LEFT JOIN veritamap_tests t ON t.map_id = it.map_id AND t.analyte = it.analyte
     WHERE m.lab_id = ? AND (it.active = 1 OR it.active IS NULL)`
  ).all(labId) as Combo[];
  const studies = sqlite.prepare(
    `SELECT id, test_name, instrument, study_type, status, lifecycle_state, date, finalized_at, coverage_analyte
     FROM studies WHERE lab_id = ? AND archived_at IS NULL`
  ).all(labId) as Study[];
  const outside = listOutsideRecords(sqlite, labId);
  const result = computeCoverageFrom(instruments, combos, studies, outside);
  const instById = new Map<number, Instrument>(instruments.map((i) => [i.id, i]));
  const people = new Map<number, string>();
  const nameOf = (uid: number | null): string => {
    if (!uid) return "";
    if (!people.has(uid)) people.set(uid, String((sqlite.prepare("SELECT name FROM users WHERE id = ?").get(uid) as any)?.name || ""));
    return people.get(uid) || "";
  };
  const full = sqlite.prepare(
    `SELECT id, kind, instrument_id, analyte, performed_on, records_location, reviewed_by, notes, created_at, created_by_user_id
     FROM veritacheck_outside_records WHERE lab_id = ? AND voided_at IS NULL ORDER BY performed_on DESC, id DESC`
  ).all(labId) as any[];
  result.outsideRecords = full.map((o) => ({
    id: o.id, kind: o.kind, analyte: o.analyte, instrument: o.instrument_id ? instLabel(instById.get(o.instrument_id)) : "",
    performedOn: o.performed_on, recordsLocation: o.records_location, reviewedBy: o.reviewed_by, notes: o.notes || "",
    createdAt: o.created_at, createdBy: nameOf(o.created_by_user_id),
  }));
  return result;
}

// ── Studies performed outside VeritaCheck (Q16, 2026-10-24) ─────────────────────────────────────────────────────
// The lab records, by date, a calibration verification / linearity (per instrument + analyte) or a correlation /
// method comparison (per analyte) it performed outside VeritaCheck, with where the records are kept and who reviewed
// them. Coverage credits each like a signed passing study until 6 months after the date. Records are voided with a
// reason, never deleted.
export function listOutsideRecords(sqlite: any, labId: number): OutsideRecord[] {
  return sqlite.prepare(
    `SELECT id, kind, instrument_id, analyte, performed_on, records_location, reviewed_by
     FROM veritacheck_outside_records WHERE lab_id = ? AND voided_at IS NULL`
  ).all(labId) as OutsideRecord[];
}

const OUTSIDE_KINDS = new Set(["cal_ver", "method_comparison"]);
const OUTSIDE_MAP_FIELD: Record<string, string> = { cal_ver: "last_cal_ver", method_comparison: "last_method_comp" };
function validIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type OutsideRecordInput = {
  kind: string; performedOn: string; recordsLocation: string; reviewedBy: string; notes?: string;
  instrumentTestIds?: number[]; // cal_ver: the Coverage rows (VeritaMap analyte x instrument)
  analytes?: string[];          // method_comparison: the Coverage method-comparison rows
};
export function recordOutsideStudies(sqlite: any, labId: number, userId: number | null, input: OutsideRecordInput):
  { ok: true; created: number; skipped: number; ids: number[] } | { ok: false; error: string } {
  const kind = String(input?.kind || "");
  if (!OUTSIDE_KINDS.has(kind)) return { ok: false, error: "Choose calibration verification / linearity or correlation / method comparison." };
  const performedOn = String(input?.performedOn || "").trim();
  if (!validIsoDate(performedOn)) return { ok: false, error: "Enter the date the study was performed." };
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // one day of slack for time zones
  if (performedOn > tomorrow) return { ok: false, error: "The date performed cannot be in the future." };
  if (performedOn < "2000-01-01") return { ok: false, error: "Check the date performed." };
  const recordsLocation = String(input?.recordsLocation || "").trim();
  const reviewedBy = String(input?.reviewedBy || "").trim();
  const notes = String(input?.notes || "").trim();
  if (!recordsLocation || recordsLocation.length > 300) return { ok: false, error: "Say where the study records are kept (up to 300 characters)." };
  if (!reviewedBy || reviewedBy.length > 120) return { ok: false, error: "Enter who reviewed and accepted the study (up to 120 characters)." };
  if (notes.length > 1000) return { ok: false, error: "Notes can be up to 1000 characters." };

  // Resolve what is being recorded to (instrument_id, analyte) pairs on THIS lab's VeritaMap.
  const items: { instrumentId: number | null; analyte: string }[] = [];
  if (kind === "cal_ver") {
    const ids = Array.from(new Set((Array.isArray(input?.instrumentTestIds) ? input.instrumentTestIds : []).map(Number)));
    if (ids.length === 0 || ids.length > 1000 || ids.some((n) => !Number.isInteger(n) || n <= 0)) return { ok: false, error: "Pick the tests to record (1 to 1000)." };
    const q = sqlite.prepare("SELECT it.instrument_id, it.analyte FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id WHERE it.id = ? AND m.lab_id = ?");
    for (const id of ids) {
      const r = q.get(id, labId) as any;
      if (!r) return { ok: false, error: "One of the tests is not on this lab's VeritaMap. Refresh the page and try again." };
      items.push({ instrumentId: r.instrument_id, analyte: r.analyte });
    }
  } else {
    const names = Array.from(new Set((Array.isArray(input?.analytes) ? input.analytes : []).map((a) => String(a || "").trim()).filter(Boolean)));
    if (names.length === 0 || names.length > 1000) return { ok: false, error: "Pick the tests to record (1 to 1000)." };
    const q = sqlite.prepare("SELECT 1 FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id WHERE m.lab_id = ? AND it.analyte = ? LIMIT 1");
    for (const a of names) {
      if (!q.get(labId, a)) return { ok: false, error: `${a} is not on this lab's VeritaMap. Refresh the page and try again.` };
      items.push({ instrumentId: null, analyte: a });
    }
  }

  const now = new Date().toISOString();
  const dup = sqlite.prepare(
    "SELECT 1 FROM veritacheck_outside_records WHERE lab_id = ? AND kind = ? AND analyte = ? AND performed_on = ? AND voided_at IS NULL AND COALESCE(instrument_id, 0) = ? LIMIT 1"
  );
  const ins = sqlite.prepare(
    `INSERT INTO veritacheck_outside_records (lab_id, kind, instrument_id, analyte, performed_on, records_location, reviewed_by, notes, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const field = OUTSIDE_MAP_FIELD[kind]; // allowlisted above; never user input
  const stamp = sqlite.prepare(
    `UPDATE veritamap_tests SET ${field} = ?, updated_at = ? WHERE map_id IN (SELECT id FROM veritamap_maps WHERE lab_id = ?)
       AND analyte = ? AND (${field} IS NULL OR ${field} = '' OR ${field} < ?)`
  );
  const ids: number[] = [];
  let skipped = 0;
  sqlite.transaction(() => {
    for (const it of items) {
      if (dup.get(labId, kind, it.analyte, performedOn, it.instrumentId ?? 0)) { skipped++; continue; }
      ids.push(Number(ins.run(labId, kind, it.instrumentId, it.analyte, performedOn, recordsLocation, reviewedBy, notes || null, userId, now).lastInsertRowid));
    }
    // The VeritaMap grid date shows when it was last done; only ever moved later, never earlier.
    for (const a of new Set(items.map((i) => i.analyte))) stamp.run(performedOn, now, labId, a, performedOn);
  })();
  return { ok: true, created: ids.length, skipped, ids };
}

export function voidOutsideRecord(sqlite: any, labId: number, userId: number | null, id: number, reason: string):
  { ok: true; record: any } | { ok: false; status: number; error: string } {
  const why = String(reason || "").trim();
  if (!why || why.length > 300) return { ok: false, status: 400, error: "Give a reason for removing this record (up to 300 characters)." };
  const rec = sqlite.prepare("SELECT * FROM veritacheck_outside_records WHERE id = ? AND lab_id = ? AND voided_at IS NULL").get(id, labId) as any;
  if (!rec) return { ok: false, status: 404, error: "Record not found in this lab" };
  const now = new Date().toISOString();
  const field = OUTSIDE_MAP_FIELD[rec.kind];
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE veritacheck_outside_records SET voided_at = ?, voided_by_user_id = ?, void_reason = ? WHERE id = ?").run(now, userId, why, id);
    if (field) {
      // If the VeritaMap date came from this record, fall back to the newest remaining record for the test (or blank);
      // real studies then re-stamp their own dates (stampMapDatesFromStudies only ever moves a date later).
      const next = sqlite.prepare(
        "SELECT MAX(performed_on) AS d FROM veritacheck_outside_records WHERE lab_id = ? AND kind = ? AND analyte = ? AND voided_at IS NULL"
      ).get(labId, rec.kind, rec.analyte) as any;
      sqlite.prepare(
        `UPDATE veritamap_tests SET ${field} = ?, updated_at = ? WHERE map_id IN (SELECT id FROM veritamap_maps WHERE lab_id = ?) AND analyte = ? AND ${field} = ?`
      ).run(next?.d || null, now, labId, rec.analyte, rec.performed_on);
    }
  })();
  stampMapDatesFromStudies(sqlite, labId);
  return { ok: true, record: { ...rec, voided_at: now, void_reason: why } };
}

// The three VeritaMap grid date columns a VeritaCheck study can stamp. Allowlisted
// BEFORE any name is interpolated into SQL, so only these columns are ever written.
export const MAP_STUDY_DATE_FIELDS = ["last_cal_ver", "last_method_comp", "last_precision"];

// Stamp the VeritaMap grid's per-analyte date columns (last_cal_ver / last_method_comp
// / last_precision) from the lab's VeritaCheck studies, so the map reflects the work
// the Coverage Report already counts instead of staying blank. cal_ver + linearity ->
// last_cal_ver and method_comparison -> last_method_comp are taken straight from
// computeCoverageFrom() (the SAME computation the Coverage Report uses, so the two
// surfaces cannot disagree); precision -> last_precision is matched here by the same
// matchesAnalyte() the engine uses (the coverage engine does not model precision).
// ADVANCE-ONLY: never overwrites a newer date already on the map (a manual entry or a
// VeritaTrack sign-off). dryRun computes the same counts and writes nothing. `sqlite`
// is a better-sqlite3 handle.
export function stampMapDatesFromStudies(
  sqlite: any,
  labId: number,
  opts: { dryRun?: boolean } = {},
): { stamped: number; byField: Record<string, number>; samples: Array<{ analyte: string; field: string; date: string; rows: number }> } {
  const maps = sqlite.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(labId) as Array<{ id: number }>;
  if (maps.length === 0) return { stamped: 0, byField: {}, samples: [] };
  const mapIds = maps.map((m) => m.id);
  const ph = mapIds.map(() => "?").join(",");
  const instruments = sqlite.prepare(
    `SELECT i.id, i.instrument_name, i.nickname, i.serial_number FROM veritamap_instruments i WHERE i.map_id IN (${ph})`
  ).all(...mapIds) as Instrument[];
  const combos = sqlite.prepare(
    `SELECT it.id, it.analyte, it.specialty, it.instrument_id, it.complexity,
            it.linearity_exempt_multical, it.linearity_exempt_noncal,
            it.linearity_exempt_waived, it.linearity_exempt_other
     FROM veritamap_instrument_tests it WHERE it.map_id IN (${ph}) AND (it.active = 1 OR it.active IS NULL)`
  ).all(...mapIds) as Combo[];
  const studies = sqlite.prepare(
    `SELECT id, test_name, instrument, study_type, status, lifecycle_state, date, coverage_analyte
     FROM studies WHERE lab_id = ? AND archived_at IS NULL`
  ).all(labId) as Study[];
  const cov = computeCoverageFrom(instruments, combos, studies);
  const dateById = new Map<number, string>();
  for (const s of studies) if (s.date) dateById.set(s.id, String(s.date).slice(0, 10));

  // analyte -> field -> latest date to write
  const want: Record<string, Record<string, string>> = {};
  const put = (analyte: string, field: string, date?: string) => {
    if (!date) return;
    const d = String(date).slice(0, 10);
    (want[analyte] ||= {});
    if (!want[analyte][field] || want[analyte][field] < d) want[analyte][field] = d;
  };
  const studyById = new Map<number, Study>(studies.map((s) => [s.id, s]));
  for (const r of cov.rows) {
    // Stamp last_cal_ver from the signed passing on-instrument studies, whether the
    // cycle is still satisfied or now recurrence-due; the map date reflects when
    // cal-ver was last performed and signed. BUG-061 (2026-10-15): this used to need
    // r.signed, which is true only when EVERY matched study is signed, so one
    // abandoned unsigned draft for the same analyte and analyzer kept the map blank
    // while the Coverage Report counted the signed study. Exempt rows and "review"
    // rows (studies only on other analyzers) still stamp nothing.
    if (r.status === "exempt" || r.status === "review") continue;
    for (const sid of r.studyIds) {
      const s = studyById.get(sid);
      if (s && s.lifecycle_state === "finalized" && !isFailVerdict(s.status)) put(r.analyte, "last_cal_ver", dateById.get(sid));
    }
  }
  for (const mc of cov.methodComparisons) {
    if (mc.hasStudy && mc.studyId != null) put(mc.analyte, "last_method_comp", dateById.get(mc.studyId));
  }
  const mapAnalytes = Array.from(new Set(combos.map((c) => c.analyte)));
  for (const s of studies) {
    if (s.study_type !== "precision") continue;
    for (const a of mapAnalytes) if (matchesAnalyte(s, a)) put(a, "last_precision", s.date);
  }

  let stamped = 0;
  const byField: Record<string, number> = {};
  const samples: Array<{ analyte: string; field: string; date: string; rows: number }> = [];
  const countStale = (analyte: string, field: string, date: string): number =>
    (sqlite.prepare(
      `SELECT COUNT(*) AS c FROM veritamap_tests WHERE map_id IN (${ph}) AND analyte = ? AND (${field} IS NULL OR ${field} = '' OR ${field} < ?)`
    ).get(...mapIds, analyte, date) as { c: number }).c;
  const apply = sqlite.transaction(() => {
    for (const [analyte, fields] of Object.entries(want)) {
      for (const [field, date] of Object.entries(fields)) {
        if (!MAP_STUDY_DATE_FIELDS.includes(field)) continue; // guard before interpolation
        const n = countStale(analyte, field, date);
        if (n > 0 && !opts.dryRun) {
          sqlite.prepare(
            `UPDATE veritamap_tests SET ${field} = ?, updated_at = datetime('now') WHERE map_id IN (${ph}) AND analyte = ? AND (${field} IS NULL OR ${field} = '' OR ${field} < ?)`
          ).run(date, ...mapIds, analyte, date);
        }
        if (n > 0) {
          stamped += n;
          byField[field] = (byField[field] || 0) + n;
          if (samples.length < 25) samples.push({ analyte, field, date, rows: n });
        }
      }
    }
  });
  apply();
  return { stamped, byField, samples };
}

// Sets the four linearity-exemption fields on one instrument_test, scoped to the
// lab (the test must belong to a map owned by this lab). Returns false when the
// test is not found in the lab. "other" is trimmed; empty -> stored NULL so a
// blank reason never counts as an exemption.
export function setLinearityExemption(sqlite: any, labId: number, instrumentTestId: number, multical: boolean, noncal: boolean, waived: boolean, other: string): boolean {
  const owns = sqlite.prepare(
    `SELECT it.id FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE it.id = ? AND m.lab_id = ?`
  ).get(instrumentTestId, labId);
  if (!owns) return false;
  const otherClean = (other || "").trim();
  sqlite.prepare(
    "UPDATE veritamap_instrument_tests SET linearity_exempt_multical = ?, linearity_exempt_noncal = ?, linearity_exempt_waived = ?, linearity_exempt_other = ? WHERE id = ?"
  ).run(multical ? 1 : 0, noncal ? 1 : 0, waived ? 1 : 0, otherClean || null, instrumentTestId);
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

// True when a just-saved study still has no coverage attribution the system can
// stand behind: it is a coverage-relevant type, has no coverage_analyte, and its
// name matches no active map analyte. The client uses this to fire the Phase 2
// soft challenge (pick the map point, or "not on our map yet"). Name-matched or
// already-attributed studies, and non-coverage types, return false (no prompt).
const ATTRIBUTABLE_TYPES = new Set(["method_comparison", "correlation", "cal_ver", "linearity", "cal_ver_correlation"]);
export function studyNeedsAttribution(sqlite: any, labId: number, studyType: string, testName: string, coverageAnalyte: string | null): boolean {
  if (!labId) return false;
  if (!ATTRIBUTABLE_TYPES.has(studyType)) return false;
  if (coverageAnalyte && String(coverageAnalyte).trim()) return false;
  const mapAnalytes = (sqlite.prepare(
    `SELECT DISTINCT it.analyte FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id
     WHERE m.lab_id = ? AND (it.active = 1 OR it.active IS NULL)`
  ).all(labId) as Array<{ analyte: string }>).map((r) => r.analyte).filter(Boolean);
  if (mapAnalytes.length === 0) return false; // no map yet -> nothing to attribute to
  return !mapAnalytes.some((a) => analyteMatch(testName, a));
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
