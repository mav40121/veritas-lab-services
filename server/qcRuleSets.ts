// server/qcRuleSets.ts
//
// QC rule settings a laboratory chooses (B12 part 2; QC rules mock 4; the owner picked the recommended answer on all three
// questions). The rules themselves, their wording and the checks on a set are in shared/qcRuleSets.ts; this file keeps them.
//
//   Versions. Every set the laboratory (analyte NULL) or one analyte has had is a row of qc_rule_versions, never updated. A change
//   applies to runs dated from the lab's today and entered after it: effective_from is the day it was saved, and a run already
//   judged is never judged again. A run is judged under the set in force on its own date, so a late entry (dated before a change,
//   entered after it) is judged under the rules of its date and says so. qc_results.rule_version_id keeps which version judged it.
//   An analyte's own set replaces the laboratory's, as the N-x and N-T counts did before; 'lab' rows send an analyte back.
//   Every lab starts on exactly today's rules: the starting row (kind 'start') is made the first time a lab's rules are read or a
//   run is judged, from its qc_rule_settings row (the 10 and 7). A read that must not write (the PDF, the Veritas re-score dry
//   run) uses the same starting rules without a row.
//
//   qc_rule_settings.enabled_rules_json was stored for every lab and never read: every rule always ran. It is read when the starting
//   row is made; a list that isn't the full seven is written into the row's note (it was never applied, so applying it now would
//   change what a lab's runs get), and the row's rules are today's. It isn't written again: the versions are the record now.
//
//   Lock (Q1 = 1). Unlocked, any VeritaQC editor saves a change with a reason. Locked, only the medical director, or a technical
//   consultant (moderate complexity) or technical supervisor whose signed, active Letter of Delegation names "Establish and maintain
//   the QA and QC programs" (directorDelegation.ts gate qc_program), changes the rules, with their name and password; turning the
//   lock on or off takes the same signature. Who counts is decided the way the monthly QC co-sign decides it
//   (delegationGate.ts mayAttestAsDirectorOrDesignee): the laboratory's set by the lab's highest complexity, an analyte's by its own.
//   No owner override here: the lock is the director's.
//
//   Across levels (Q3 = 1). A rule turned on across levels pairs a run with the latest accepted run of each other level of the same
//   analyte on the same analyzer that day, entered before it, each judged against its own level's mean and SD. The flag lands on
//   the later run and names the other, so one corrective action covers both. 4-1s and N-x across count back day by day, taking the
//   latest accepted run of each level on each day. A run with no analyzer recorded isn't paired: nobody can tell it is the same one.
//
//   Signatures: S0's one check (server/eSignature.ts verifySigner, purpose qc_rules): the typed name and the signer's own password,
//   or, where their email domain signs in through their hospital, that sign-in asked for again at signing. A wrong password counts
//   toward the sign-in lockout. A signed row keeps how it was signed (signed_with, signed_with_provider).

import type { Express } from "express";
import { db } from "./db";
import { labToday, labLocalDate } from "./dateLocal";
import { logAudit } from "./audit";
import { mayAttestAsDirectorOrDesignee, complexityForAnalyte, labHighestComplexity } from "./delegationGate";
import { positionLabel, type DelegationPosition } from "./directorDelegation";
import { moduleEditInLab } from "./labAccessGuard";
import { staffOwnScope } from "./competencySelfEntry";
import { evaluateQcRun, usesManufacturerRange, type LotRuns, type WestgardViolation } from "./qcWestgard";
import { resolveBasis, loadBasisLot, basisConfig, type QcBasis } from "./qcBasis";
import { verifySigner, signedWithValues } from "./eSignature";
import {
  ACROSS_SUFFIX, QC_RULE_CODES, STARTING_DAY, judgedUnderLabel, mdy, normalizeRuleSet, ruleChanges, ruleCodeLabel, ruleSetSummary,
  startingRules, type QcRuleCode, type QcRuleSet, type RuleChange,
} from "../shared/qcRuleSets";
import { signedWithText } from "../shared/eSignature";

type Sqlite = any;

export type RuleVersionKind = "start" | "change" | "own" | "lab";
export interface RuleVersion {
  /** null: the starting rules of a lab with no row yet (a read that writes nothing). */
  id: number | null;
  lab_id: number;
  analyte: string | null;
  kind: RuleVersionKind;
  uses_lab: boolean;
  rules: QcRuleSet | null;
  changes: RuleChange[];
  effective_from: string;
  reason: string | null;
  note: string | null;
  changed_by_user_id: number | null;
  changed_by_name: string | null;
  capacity: string | null;
  capacity_label: string | null;
  signed: boolean;
  signed_with: string | null;
  signed_with_provider: string | null;
  created_at: string | null;
}

const parse = <T>(s: any, dflt: T): T => { try { return s == null ? dflt : (JSON.parse(String(s)) as T); } catch { return dflt; } };

function toVersion(r: any): RuleVersion {
  return {
    id: Number(r.id), lab_id: Number(r.lab_id), analyte: r.analyte ?? null, kind: r.kind, uses_lab: Number(r.uses_lab) === 1,
    rules: parse<QcRuleSet | null>(r.rules_json, null), changes: parse<RuleChange[]>(r.changes_json, []), effective_from: r.effective_from,
    reason: r.reason ?? null, note: r.note ?? null, changed_by_user_id: r.changed_by_user_id ?? null, changed_by_name: r.changed_by_name ?? null,
    capacity: r.capacity ?? null, capacity_label: r.capacity_label ?? null, signed: Number(r.signed) === 1,
    signed_with: r.signed_with ?? null, signed_with_provider: r.signed_with_provider ?? null, created_at: r.created_at ?? null,
  };
}

// ── Starting rules ──────────────────────────────────────────────────────────────────────────────────────────────────

const FULL_LIST = ["1-2s", "1-3s", "2-2s", "R-4s", "4-1s", "N-x", "N-T"];

function settingsRow(sqlite: Sqlite, labId: number, analyte: string | null): any {
  try {
    return analyte == null
      ? sqlite.prepare("SELECT bias_consecutive_count, trend_consecutive_count, enabled_rules_json FROM qc_rule_settings WHERE lab_id = ? AND analyte IS NULL ORDER BY id LIMIT 1").get(labId)
      : sqlite.prepare("SELECT bias_consecutive_count, trend_consecutive_count, enabled_rules_json FROM qc_rule_settings WHERE lab_id = ? AND analyte = ? ORDER BY id LIMIT 1").get(labId, analyte);
  } catch { return undefined; }
}

/** What a stored enabled_rules_json says, when it isn't the full list every lab was given (it was never applied). */
export function storedListNote(json: unknown): string | null {
  if (json == null) return null;
  const list = parse<unknown>(json, undefined);
  if (!Array.isArray(list)) return `A list of rules to use was stored for this lab that can't be read (${String(json).slice(0, 120)}). It was never applied; these starting rules are what the app judged with.`;
  const got = new Set(list.map(String));
  if (got.size === FULL_LIST.length && FULL_LIST.every((c) => got.has(c))) return null;
  return `A list of rules to use was stored for this lab (${list.map(String).join(", ") || "none"}). It was never applied; these starting rules are what the app judged with.`;
}

function startingFor(sqlite: Sqlite, labId: number, analyte: string | null): { set: QcRuleSet; note: string | null } | null {
  const row = settingsRow(sqlite, labId, analyte);
  if (analyte != null && !row) return null; // an analyte without its own counts uses the laboratory's
  return { set: startingRules(row?.bias_consecutive_count ?? 10, row?.trend_consecutive_count ?? 7), note: storedListNote(row?.enabled_rules_json) };
}

function synthetic(labId: number, analyte: string | null, start: { set: QcRuleSet; note: string | null }): RuleVersion {
  return {
    id: null, lab_id: labId, analyte, kind: "start", uses_lab: false, rules: start.set, changes: [], effective_from: STARTING_DAY, reason: null,
    note: start.note, changed_by_user_id: null, changed_by_name: null, capacity: null, capacity_label: null, signed: false,
    signed_with: null, signed_with_provider: null, created_at: null,
  };
}

/** Make the lab's starting row (and an analyte's, when it had its own counts) if there is none yet. Today's rules, exactly. */
export function ensureStartingRules(sqlite: Sqlite, labId: number, analyte: string | null = null): void {
  const ins = sqlite.prepare(
    `INSERT OR IGNORE INTO qc_rule_versions (lab_id, analyte, kind, uses_lab, rules_json, changes_json, effective_from, note, created_at)
     VALUES (?, ?, 'start', 0, ?, '[]', ?, ?, ?)`
  );
  const now = new Date().toISOString();
  if (!sqlite.prepare("SELECT 1 FROM qc_rule_versions WHERE lab_id = ? AND analyte IS NULL LIMIT 1").get(labId)) {
    const st = startingFor(sqlite, labId, null)!;
    ins.run(labId, null, JSON.stringify(st.set), STARTING_DAY, st.note, now);
  }
  if (analyte != null && !sqlite.prepare("SELECT 1 FROM qc_rule_versions WHERE lab_id = ? AND analyte = ? LIMIT 1").get(labId, analyte)) {
    const st = startingFor(sqlite, labId, analyte);
    if (st) ins.run(labId, analyte, JSON.stringify(st.set), STARTING_DAY, st.note, now);
  }
}

// ── Which rules are in force ────────────────────────────────────────────────────────────────────────────────────────

export interface InForce { version: RuleVersion; own: boolean }

/**
 * The set in force for an analyte (or the laboratory, analyte null) on a day: the analyte's own newest version dated on or before
 * the day, unless it sends the analyte back to the laboratory's; else the laboratory's. Same-day changes: the later one.
 * create false writes nothing (the starting rules come back with id null). upToId: as it stood right after that version was saved.
 */
export function versionInForce(sqlite: Sqlite, labId: number, analyte: string | null, day: string, opts: { create?: boolean; upToId?: number } = {}): InForce {
  if (opts.create !== false) ensureStartingRules(sqlite, labId, analyte);
  const upTo = Number(opts.upToId) > 0 ? Number(opts.upToId) : Number.MAX_SAFE_INTEGER;
  if (analyte != null) {
    const r = sqlite.prepare(
      "SELECT * FROM qc_rule_versions WHERE lab_id = ? AND analyte = ? AND effective_from <= ? AND id <= ? ORDER BY effective_from DESC, id DESC LIMIT 1"
    ).get(labId, analyte, day, upTo) as any;
    if (r && Number(r.uses_lab) !== 1) return { version: toVersion(r), own: true };
    if (!r && opts.create === false) {
      const st = sqlite.prepare("SELECT 1 FROM qc_rule_versions WHERE lab_id = ? AND analyte = ? LIMIT 1").get(labId, analyte) ? null : startingFor(sqlite, labId, analyte);
      if (st) return { version: synthetic(labId, analyte, st), own: true };
    }
  }
  const l = sqlite.prepare(
    "SELECT * FROM qc_rule_versions WHERE lab_id = ? AND analyte IS NULL AND effective_from <= ? AND id <= ? ORDER BY effective_from DESC, id DESC LIMIT 1"
  ).get(labId, day, upTo) as any;
  if (l) return { version: toVersion(l), own: false };
  return { version: synthetic(labId, null, startingFor(sqlite, labId, null)!), own: false };
}

export function versionById(sqlite: Sqlite, labId: number, id: number | null | undefined): RuleVersion | null {
  if (!(Number(id) > 0)) return null;
  const r = sqlite.prepare("SELECT * FROM qc_rule_versions WHERE id = ? AND lab_id = ?").get(Number(id), labId);
  return r ? toVersion(r) : null;
}

/** "Rules of 12/01/2026" (or "Starting rules", "Before rule settings") for each version id. */
export function judgedUnderLabels(sqlite: Sqlite, labId: number, ids: Array<number | null | undefined>): Map<number, string> {
  const out = new Map<number, string>();
  const want = Array.from(new Set(ids.filter((x): x is number => Number(x) > 0).map(Number)));
  if (!want.length) return out;
  const rows = sqlite.prepare(
    "SELECT id, kind, effective_from, analyte FROM qc_rule_versions WHERE lab_id = ? AND id IN (SELECT value FROM json_each(?))"
  ).all(labId, JSON.stringify(want)) as any[];
  for (const r of rows) out.set(Number(r.id), judgedUnderLabel(r));
  return out;
}

// ── Across levels ───────────────────────────────────────────────────────────────────────────────────────────────────

interface Run {
  id: number; control_lot_id: number; result_value: number; result_date: string; run_time: string | null;
  instrument: string | null; map_instrument_id: number | null; basis_mean: number | null; basis_sd: number | null; level: string;
}

function sameAnalyzer(a: Run, b: Run): boolean {
  if (a.map_instrument_id && b.map_instrument_id) return Number(a.map_instrument_id) === Number(b.map_instrument_id);
  const ta = String(a.instrument ?? "").trim().toLowerCase(), tb = String(b.instrument ?? "").trim().toLowerCase();
  return !!ta && ta === tb;
}

function time12(t: string | null): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}
const signed = (z: number) => `${z >= 0 ? "+" : ""}${z.toFixed(2)}`;
const runName = (r: Run) => `${r.level}, ${time12(r.run_time) ?? mdy(r.result_date)}`;

function sdiOf(sqlite: Sqlite, labId: number, r: Run): number | null {
  let mean = r.basis_mean == null ? NaN : Number(r.basis_mean), sd = r.basis_sd == null ? NaN : Number(r.basis_sd);
  if (!(Number.isFinite(mean) && Number.isFinite(sd) && sd > 0)) {
    const b = resolveBasis(sqlite, labId, r.control_lot_id, { beforeResultId: r.id });
    if (!b) return null;
    mean = b.mean; sd = b.sd;
  }
  return sd > 0 ? (Number(r.result_value) - mean) / sd : null;
}

/**
 * The across-levels flags for one run, judged at its SDI z (against its own level's basis), under `set`. Only rules turned on across
 * levels; each flag names the other run(s). Runs entered after this one don't count (the flag lands on the later run).
 */
export function acrossLevelViolations(sqlite: Sqlite, labId: number, resultId: number, z: number, set: QcRuleSet): WestgardViolation[] {
  const wanted = (["2-2s", "R-4s", "4-1s", "N-x"] as QcRuleCode[]).filter((c) => set.rules[c].on && set.rules[c].across);
  if (!wanted.length || !Number.isFinite(z)) return [];
  const cols = "r.id, r.control_lot_id, r.result_value, r.result_date, r.run_time, r.instrument, r.map_instrument_id, r.basis_mean, r.basis_sd, l.level, l.analyte";
  const me = sqlite.prepare(`SELECT ${cols} FROM qc_results r JOIN qc_control_lots l ON l.id = r.control_lot_id WHERE r.id = ? AND r.lab_id = ?`).get(resultId, labId) as (Run & { analyte: string }) | undefined;
  if (!me || (!me.map_instrument_id && !String(me.instrument ?? "").trim())) return [];
  const others = (sqlite.prepare(
    `SELECT ${cols} FROM qc_results r JOIN qc_control_lots l ON l.id = r.control_lot_id
      WHERE r.lab_id = ? AND l.lab_id = ? AND l.analyte = ? AND r.accepted_for_reporting = 1 AND r.voided_at IS NULL
        AND r.id < ? AND r.result_date <= ?
      ORDER BY r.result_date DESC, r.id DESC LIMIT 2000`
  ).all(labId, labId, me.analyte, me.id, me.result_date) as Run[]).filter((r) => sameAnalyzer(me, r));

  // Day by day, newest first: the latest accepted run of each level that day (this run stands for its level on its own day).
  const days: Run[][] = [];
  const byDay = new Map<string, Map<string, Run>>();
  for (const r of others) {
    if (r.result_date === me.result_date && r.level === me.level) continue;
    let d = byDay.get(r.result_date);
    if (!d) { d = new Map(); byDay.set(r.result_date, d); }
    if (!d.has(r.level)) d.set(r.level, r); // rows come newest first within a day
  }
  const today = [me, ...Array.from(byDay.get(me.result_date)?.values() ?? [])];
  days.push(today);
  for (const day of Array.from(byDay.keys()).filter((d) => d < me.result_date).sort().reverse()) days.push(Array.from(byDay.get(day)!.values()));

  const sdi = new Map<number, number | null>([[me.id, z]]);
  const zOf = (r: Run) => { if (!sdi.has(r.id)) sdi.set(r.id, sdiOf(sqlite, labId, r)); return sdi.get(r.id)!; };
  const partners = today.slice(1).filter((p) => zOf(p) != null);
  const out: WestgardViolation[] = [];
  const sev = (c: QcRuleCode) => set.rules[c].severity;

  if (wanted.includes("2-2s")) {
    const p = partners.find((q) => { const s = zOf(q)!; return Math.abs(z) > 2 && Math.abs(s) > 2 && z * s > 0; });
    if (p) out.push({ rule_code: `2-2s${ACROSS_SUFFIX}`, severity: sev("2-2s"), detail: `with ${runName(p)} (SDI ${signed(zOf(p)!)}); this run ${signed(z)}`, related_result_ids: [p.id, me.id] });
  }
  if (wanted.includes("R-4s")) {
    const p = partners.find((q) => { const s = zOf(q)!; return Math.abs(z - s) > 4 && ((z > 2 && s < -2) || (z < -2 && s > 2)); });
    if (p) out.push({ rule_code: `R-4s${ACROSS_SUFFIX}`, severity: sev("R-4s"), detail: `with ${runName(p)} (SDI ${signed(zOf(p)!)}); this run ${signed(z)}, ${Math.abs(z - zOf(p)!).toFixed(2)} SD apart on opposite sides`, related_result_ids: [p.id, me.id] });
  }
  const windowOf = (k: number): Run[] | null => {
    const pts: Run[] = [];
    for (const day of days) for (const r of day) { if (pts.length < k && zOf(r) != null) pts.push(r); }
    return pts.length === k && new Set(pts.map((r) => r.level)).size >= 2 ? pts : null;
  };
  const windowDetail = (pts: Run[]) => {
    const levels = Array.from(new Set(pts.map((r) => r.level)));
    const dates = pts.map((r) => r.result_date).sort();
    return `${pts.length} results across ${levels.join(" and ")}, ${mdy(dates[0])} to ${mdy(dates[dates.length - 1])}`;
  };
  if (wanted.includes("4-1s")) {
    const pts = windowOf(4);
    if (pts) {
      const s = pts.map((r) => zOf(r)!);
      if (s.every((v) => Math.abs(v) > 1) && s.every((v) => v * s[0] > 0)) {
        out.push({ rule_code: `4-1s${ACROSS_SUFFIX}`, severity: sev("4-1s"), detail: `${windowDetail(pts)}, all past the same 1 SD limit`, related_result_ids: pts.map((r) => r.id).reverse() });
      }
    }
  }
  if (wanted.includes("N-x")) {
    const n = Number(set.rules["N-x"].n);
    const pts = windowOf(n);
    if (pts) {
      const s = pts.map((r) => zOf(r)!);
      if (s.every((v) => v * s[0] > 0)) {
        out.push({ rule_code: `${ruleCodeLabel("N-x", set)}${ACROSS_SUFFIX}`, severity: sev("N-x"), detail: `${windowDetail(pts)}, all on one side of the mean`, related_result_ids: pts.map((r) => r.id).reverse() });
      }
    }
  }
  return out;
}

// ── Judging a run ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface JudgedRun {
  violations: WestgardViolation[];
  basis: QcBasis | null;
  version: RuleVersion;
  /** True when the run's date has other rules than today's: a late entry judged under the rules of its own date. */
  ownDate: boolean;
  judgedUnder: string;
}

const countOf = (set: QcRuleSet, c: "N-x" | "N-T") => (set.rules[c].on ? Number(set.rules[c].n) : 0);

/**
 * The rules a stored run is judged under: the version in force on its date (made if the lab has none yet). `loaded` is a file import's
 * lot history in hand (server/qcFileImport.ts), so its runs don't re-read the lot each.
 */
export function judgeRunWithRules(sqlite: Sqlite, labId: number, lotId: number, resultId: number, loaded?: LotRuns): JudgedRun {
  const run = sqlite.prepare("SELECT id, result_value, result_date FROM qc_results WHERE id = ? AND lab_id = ?").get(resultId, labId) as any;
  const lot = loadBasisLot(sqlite, labId, lotId);
  const analyte = lot?.analyte ?? null;
  const inForce = versionInForce(sqlite, labId, analyte, run.result_date);
  const set = inForce.version.rules!;
  const { violations, basis } = evaluateQcRun(sqlite, labId, lotId, resultId, countOf(set, "N-x"), countOf(set, "N-T"), loaded, set);
  let across: WestgardViolation[] = [];
  if (basis && lot && !usesManufacturerRange(basis, { low: lot.mfr_range_low ?? null, high: lot.mfr_range_high ?? null }, basisConfig(sqlite, labId, analyte))) {
    across = acrossLevelViolations(sqlite, labId, resultId, (Number(run.result_value) - basis.mean) / basis.sd, set);
  }
  const today = labToday();
  const now = run.result_date < today ? versionInForce(sqlite, labId, analyte, today) : inForce;
  return { violations: [...violations, ...across], basis, version: inForce.version, ownDate: now.version.id !== inForce.version.id, judgedUnder: judgedUnderLabel(inForce.version) };
}

/**
 * The Veritas re-score (POST /api/admin/qc/rescore): a run is judged again under the version that judged it, or the set in force on
 * its date when none was kept. Writes nothing.
 */
export function ruleSetForRescore(sqlite: Sqlite, labId: number, analyte: string | null, run: { result_date: string; rule_version_id?: number | null }): { set: QcRuleSet; versionId: number | null } {
  const kept = versionById(sqlite, labId, run.rule_version_id);
  if (kept?.rules) return { set: kept.rules, versionId: kept.id };
  const v = versionInForce(sqlite, labId, analyte, run.result_date, { create: false }).version;
  return { set: v.rules!, versionId: v.id };
}

// ── Who may change the rules, and the signature ─────────────────────────────────────────────────────────────────────

export type RulesCapacity = { capacity: "medical_director" | "designee"; label: string; delegationId: number | null };

/** The medical director, or a TC/TS designee with the QA and QC programs duty for this complexity (as QC co-sign decides). */
export function rulesSignerCapacity(labId: number, userId: number, analyte: string | null): RulesCapacity | null {
  const complexity = analyte ? complexityForAnalyte(labId, analyte) : labHighestComplexity(labId);
  const a = mayAttestAsDirectorOrDesignee(labId, userId, "qc_program", complexity);
  if (!a.ok) return null;
  if (a.via === "medical_director") return { capacity: "medical_director", label: "Medical director", delegationId: null };
  return { capacity: "designee", label: `Designee, ${positionLabel(a.position as DelegationPosition)}`, delegationId: a.delegationId ?? null };
}

/** Sign through S0's check: the typed name, and the password or the hospital sign-in proof (sso_proof). */
async function signRules(sqlite: Sqlite, userId: number, body: any, ip: string | null) {
  const typed = typeof body?.typed_signature === "string" ? body.typed_signature.trim() : "";
  if (typed.length > 200) return { ok: false as const, status: 400, body: { error: "The typed name is too long." } };
  const verdict = await verifySigner(sqlite, userId, { typedName: body?.typed_signature, password: body?.password, ssoProof: body?.sso_proof, purpose: "qc_rules" }, { ip: ip ?? undefined });
  if (!verdict.ok) return verdict;
  const [signedWith, provider] = signedWithValues(verdict.signedWith);
  return { ok: true as const, typed, signedWith, provider };
}

/** How a signed row was signed, in words (S0's signedWithText): "signed with name and password", "signed with Example Hospital sign-in". */
const signedWithWords = (method: string | null | undefined, provider: string | null | undefined) => {
  const t = signedWithText(method, provider) || signedWithText("password", null);
  return t.charAt(0).toLowerCase() + t.slice(1);
};

export interface LockState { locked: boolean; by: string | null; at: string | null; at_label: string | null; reason: string | null; capacity_label: string | null; signed_with: string | null }

export function currentLock(sqlite: Sqlite, labId: number): LockState {
  const r = sqlite.prepare("SELECT * FROM qc_rule_lock_events WHERE lab_id = ? ORDER BY id DESC LIMIT 1").get(labId) as any;
  if (!r || Number(r.locked) !== 1) return { locked: false, by: null, at: null, at_label: null, reason: null, capacity_label: null, signed_with: null };
  return { locked: true, by: r.changed_by_name ?? null, at: r.created_at, at_label: momentLabel(r.created_at), reason: r.reason, capacity_label: r.capacity_label, signed_with: signedWithWords(r.signed_with, r.signed_with_provider) };
}

/** "12/01/2026 10:15 AM" on the lab's clock. */
export function momentLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = labLocalDate(String(iso), true);
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(s);
  return m ? `${mdy(m[1])} ${time12(m[2])}` : mdy(s);
}

// ── What the screen reads ───────────────────────────────────────────────────────────────────────────────────────────

/** The analytes this lab keeps QC on (its control lots'). */
export function labAnalytes(sqlite: Sqlite, labId: number): string[] {
  return (sqlite.prepare("SELECT DISTINCT analyte FROM qc_control_lots WHERE lab_id = ? ORDER BY analyte COLLATE NOCASE").all(labId) as any[]).map((r) => String(r.analyte));
}

function versionView(v: RuleVersion, hideNames: boolean) {
  return {
    id: v.id, kind: v.kind, analyte: v.analyte, uses_lab: v.uses_lab, rules: v.rules, changes: v.changes, effective_from: v.effective_from,
    label: judgedUnderLabel(v), reason: v.reason, note: v.note, changed_by_name: hideNames ? null : v.changed_by_name, capacity_label: v.capacity_label,
    signed: v.signed, signed_with: v.signed ? signedWithWords(v.signed_with, v.signed_with_provider) : null, created_at: v.created_at, at_label: momentLabel(v.created_at),
  };
}

function versionText(v: RuleVersion): string {
  if (v.kind === "start") return `Starting rules, as the app judged before this screen.${v.note ? ` ${v.note}` : ""}`;
  if (v.kind === "lab") return "Uses the laboratory's rules from this day.";
  const changes = v.changes.map((c) => `${c.rule} ${c.was} to ${c.willBe}`).join(". ");
  return `${v.kind === "own" ? "Own rules. " : ""}${changes ? `${changes}.` : "Same rules as the laboratory's."}`;
}

export function settingsView(sqlite: Sqlite, labId: number, userId: number) {
  const analytes = labAnalytes(sqlite, labId);
  ensureStartingRules(sqlite, labId, null);
  for (const a of analytes) ensureStartingRules(sqlite, labId, a);
  const today = labToday();
  // A limited Staff login reads the rules, not a coworker's name (as the VeritaMaintain record does).
  const hideNames = !!staffOwnScope(sqlite, userId, labId, "veritaqc");
  const lock = currentLock(sqlite, labId);
  if (hideNames) lock.by = null;
  const editor = moduleEditInLab(sqlite, labId, userId, "veritaqc");
  const capLab = rulesSignerCapacity(labId, userId, null);
  const scopeView = (analyte: string | null) => {
    const f = versionInForce(sqlite, labId, analyte, today);
    const cap = analyte ? rulesSignerCapacity(labId, userId, analyte) : capLab;
    return {
      analyte, own: analyte ? f.own : true, version: versionView(f.version, hideNames),
      can_change: lock.locked ? !!cap : editor || !!cap, sign_as: cap?.label ?? null,
    };
  };
  const versions = (sqlite.prepare("SELECT * FROM qc_rule_versions WHERE lab_id = ?").all(labId) as any[]).map(toVersion);
  const locks = sqlite.prepare("SELECT * FROM qc_rule_lock_events WHERE lab_id = ?").all(labId) as any[];
  const history = [
    ...versions.map((v) => ({
      type: "rules" as const, id: v.id, at: v.created_at, at_label: v.kind === "start" ? null : momentLabel(v.created_at), scope: v.analyte ?? "Laboratory",
      kind: v.kind, effective_from: v.effective_from, text: versionText(v), reason: v.reason, who: hideNames ? null : v.changed_by_name,
      capacity_label: v.capacity_label, signed: v.signed, signed_with: v.signed ? signedWithWords(v.signed_with, v.signed_with_provider) : null,
    })),
    ...locks.map((l) => ({
      type: (Number(l.locked) === 1 ? "lock" : "unlock") as "lock" | "unlock", id: Number(l.id), at: l.created_at, at_label: momentLabel(l.created_at), scope: "Laboratory",
      kind: null, effective_from: null, text: Number(l.locked) === 1 ? "Locked." : "Unlocked.", reason: l.reason, who: hideNames ? null : l.changed_by_name,
      capacity_label: l.capacity_label, signed: true, signed_with: signedWithWords(l.signed_with, l.signed_with_provider),
    })),
  ].sort((a, b) => {
    // The starting rows first in time; the rest by when they were saved.
    const ka = a.type === "rules" && a.kind === "start" ? "" : String(a.at ?? ""), kb = b.type === "rules" && b.kind === "start" ? "" : String(b.at ?? "");
    return ka === kb ? Number(b.id) - Number(a.id) : ka < kb ? 1 : -1;
  });
  return {
    today, lock,
    you: { can_edit: editor, can_lock: !!capLab, sign_as: capLab?.label ?? null },
    laboratory: scopeView(null),
    analytes: analytes.map((a) => scopeView(a)),
    history,
    establishing_rules: basisConfig(sqlite, labId, null).establishingRules ?? "westgard",
  };
}

// ── The monthly review PDF ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The "Rules in force" lines for one analyte over a period (first and last day, inclusive): the set in force as the period began, then
 * each set as it took effect for this analyte, in the order they were saved. A set replaced on the same day it started is left out
 * unless it judged one of the period's runs (usedVersionIds). Writes nothing.
 */
export function rulesInForceLines(sqlite: Sqlite, labId: number, analyte: string, first: string, last: string, usedVersionIds: Set<number> = new Set()): string[] {
  const seq: { v: RuleVersion; from: string }[] = [];
  const keyOf = (v: RuleVersion) => `${v.id ?? "start"}|${v.analyte ?? ""}`;
  const push = (v: RuleVersion, from: string) => {
    if (!v.rules || (seq.length && keyOf(seq[seq.length - 1].v) === keyOf(v))) return;
    seq.push({ v, from });
  };
  const dayBefore = new Date(Date.parse(`${first}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  push(versionInForce(sqlite, labId, analyte, dayBefore, { create: false }).version, first);
  const saved = sqlite.prepare(
    "SELECT id, effective_from FROM qc_rule_versions WHERE lab_id = ? AND (analyte IS NULL OR analyte = ?) AND effective_from >= ? AND effective_from <= ? ORDER BY id"
  ).all(labId, analyte, first, last) as any[];
  for (const r of saved) push(versionInForce(sqlite, labId, analyte, r.effective_from, { create: false, upToId: Number(r.id) }).version, String(r.effective_from));
  const kept = seq.filter((s, i) => i === seq.length - 1 || seq[i + 1].from !== s.from || (s.v.id != null && usedVersionIds.has(s.v.id)));
  const out: string[] = [];
  for (const { v } of kept) {
    if (!v.rules) continue;
    const whose = v.analyte ? ` (${v.analyte}'s own rules)` : "";
    if (v.kind === "start") { out.push(`Starting rules, as the app judged before rule settings${whose}: ${ruleSetSummary(v.rules)}`); continue; }
    const by = [v.changed_by_name, v.capacity_label ? v.capacity_label.charAt(0).toLowerCase() + v.capacity_label.slice(1) : null].filter(Boolean).join(", ");
    out.push(`From ${mdy(v.effective_from)}${whose}: ${ruleSetSummary(v.rules)} Changed ${momentLabel(v.created_at)}${by ? ` by ${by}` : ""}.`);
  }
  return out;
}

// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function registerQcRuleSettingsRoutes(app: Express, authMiddleware: any, requireWriteAccess: any) {
  const labScopeMiddleware = (app as any).locals?.labScopeMiddleware;
  if (!labScopeMiddleware) throw new Error("registerQcRuleSettingsRoutes: labScopeMiddleware not registered");
  const sqlite = () => (db as any).$client;
  const ipOf = (req: any) => (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().split(",")[0].trim() || null;
  const nameOf = (userId: number) => ((sqlite().prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as any)?.name || null);
  const REASON_MAX = 1000;
  const LOCKED_WHO = "Only the medical director, or a technical consultant or technical supervisor whose signed Letter of Delegation names \"Establish and maintain the QA and QC programs\", can do this.";

  // Any member reads the rules; a limited Staff login sees no names.
  app.get("/api/labs/:labId/qc/rule-settings", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    res.json(settingsView(sqlite(), Number(req.scope.labId), Number(req.userId)));
  });

  // Save a change to the laboratory's rules or one analyte's: a new version from today. Body { analyte, rules | use_lab, reason,
  // expect_version_id?, typed_signature?, password? }. Veritas support is refused before this runs (vlsSupport.ts).
  app.put("/api/labs/:labId/qc/rule-settings", authMiddleware, labScopeMiddleware, requireWriteAccess, async (req: any, res: any) => {
    const db0 = sqlite();
    const labId = Number(req.scope.labId), userId = Number(req.userId);
    if (req.scope?.viaVlsSupport) return res.status(403).json({ error: "Veritas support can't change a lab's QC rules.", code: "VLS_SUPPORT_CANNOT_SIGN" });
    const body = req.body || {};
    const analyte = body.analyte == null || String(body.analyte).trim() === "" ? null : String(body.analyte);
    if (analyte != null && !labAnalytes(db0, labId).includes(analyte)) return res.status(404).json({ error: "No control lot for that analyte in this lab.", code: "NO_SUCH_ANALYTE" });

    const lock = currentLock(db0, labId);
    const cap = rulesSignerCapacity(labId, userId, analyte);
    const editor = moduleEditInLab(db0, labId, userId, "veritaqc");
    if (lock.locked && !cap) return res.status(403).json({ error: `The QC rules are locked. ${LOCKED_WHO}`, code: "RULES_LOCKED" });
    if (!lock.locked && !editor && !cap) return res.status(403).json({ error: "You have view-only access to VeritaQC™. Ask the account owner to grant edit access.", code: "EDIT_REQUIRED" });

    const reason = String(body.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Give the reason for the change.", code: "REASON_REQUIRED" });
    if (reason.length > REASON_MAX) return res.status(400).json({ error: `The reason is too long (${REASON_MAX} characters at most).`, code: "REASON_TOO_LONG" });

    ensureStartingRules(db0, labId, analyte);
    const today = labToday();
    const current = versionInForce(db0, labId, analyte, today);
    if (body.expect_version_id != null && Number(body.expect_version_id) !== current.version.id) {
      return res.status(409).json({ error: "The rules changed since this screen was opened. Reload to see them.", code: "MOVED" });
    }
    let kind: RuleVersionKind, rules: QcRuleSet | null = null, changes: RuleChange[];
    if (body.use_lab === true) {
      if (analyte == null || !current.own) return res.status(400).json({ error: "This already uses the laboratory's rules.", code: "ALREADY_LAB" });
      kind = "lab";
      changes = ruleChanges(current.version.rules!, versionInForce(db0, labId, null, today).version.rules!);
    } else {
      const n = normalizeRuleSet(body.rules);
      if (!n.ok) return res.status(400).json({ error: n.error, code: n.code });
      rules = n.set;
      kind = analyte != null && !current.own ? "own" : "change";
      changes = ruleChanges(current.version.rules!, rules);
      if (kind === "change" && changes.length === 0) return res.status(400).json({ error: "Nothing changed.", code: "NO_CHANGE" });
    }
    let sig: { typed: string; signedWith: string; provider: string | null } | null = null;
    if (lock.locked) {
      const signed = await signRules(db0, userId, body, ipOf(req));
      if (!signed.ok) return res.status(signed.status).json(signed.body);
      sig = signed;
    }

    const now = new Date().toISOString();
    const typed = sig ? sig.typed : null;
    const id = Number(db0.prepare(
      `INSERT INTO qc_rule_versions (lab_id, analyte, kind, uses_lab, rules_json, changes_json, effective_from, reason, changed_by_user_id, changed_by_name,
         capacity, capacity_label, signed, typed_signature, signed_with, signed_with_provider, delegation_id, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      labId, analyte, kind, kind === "lab" ? 1 : 0, rules ? JSON.stringify(rules) : null, JSON.stringify(changes), today, reason, userId,
      typed ?? nameOf(userId), cap ? cap.capacity : "editor", cap ? cap.label : "Editor", sig ? 1 : 0, typed, sig?.signedWith ?? null, sig?.provider ?? null,
      cap?.delegationId ?? null, ipOf(req), now,
    ).lastInsertRowid);
    logAudit({
      userId, ownerUserId: req.scope?.lab?.owner_user_id ?? userId, module: "veritaqc", action: "update", entityType: "qc_rule_set", entityId: id,
      entityLabel: `${analyte ?? "Laboratory"}: QC rules ${kind === "lab" ? "back to the laboratory's" : "changed"}, runs dated ${today} on`,
      before: { version_id: current.version.id, rules: current.version.rules },
      after: { version_id: id, kind, rules, uses_lab: kind === "lab", effective_from: today, changes, reason, locked: lock.locked, signed: !!sig, signed_with: sig?.signedWith ?? null, capacity: cap?.capacity ?? "editor", lab_id: labId },
      ipAddress: ipOf(req) ?? undefined,
    });
    res.json({ ok: true, version_id: id, effective_from: today, settings: settingsView(db0, labId, userId) });
  });

  // Turn the lock on or off. Body { locked, reason, typed_signature, password }. The director or a designee, signed.
  app.post("/api/labs/:labId/qc/rule-settings/lock", authMiddleware, labScopeMiddleware, requireWriteAccess, async (req: any, res: any) => {
    const db0 = sqlite();
    const labId = Number(req.scope.labId), userId = Number(req.userId);
    if (req.scope?.viaVlsSupport) return res.status(403).json({ error: "Veritas support can't lock a lab's QC rules.", code: "VLS_SUPPORT_CANNOT_SIGN" });
    const want = req.body?.locked === true ? true : req.body?.locked === false ? false : null;
    if (want === null) return res.status(400).json({ error: "Say whether to lock or unlock.", code: "LOCKED_REQUIRED" });
    const cap = rulesSignerCapacity(labId, userId, null);
    if (!cap) return res.status(403).json({ error: LOCKED_WHO, code: "NOT_DIRECTOR_OR_DESIGNEE" });
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) return res.status(400).json({ error: "Give the reason.", code: "REASON_REQUIRED" });
    if (reason.length > REASON_MAX) return res.status(400).json({ error: `The reason is too long (${REASON_MAX} characters at most).`, code: "REASON_TOO_LONG" });
    const lock = currentLock(db0, labId);
    if (lock.locked === want) return res.status(409).json({ error: want ? "The rules are already locked." : "The rules aren't locked.", code: want ? "ALREADY_LOCKED" : "NOT_LOCKED" });
    const signed = await signRules(db0, userId, req.body, ipOf(req));
    if (!signed.ok) return res.status(signed.status).json(signed.body);
    const typed = signed.typed;
    const now = new Date().toISOString();
    const id = Number(db0.prepare(
      `INSERT INTO qc_rule_lock_events (lab_id, locked, reason, changed_by_user_id, changed_by_name, capacity, capacity_label, typed_signature, signed_with, signed_with_provider, delegation_id, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(labId, want ? 1 : 0, reason, userId, typed, cap.capacity, cap.label, typed, signed.signedWith, signed.provider, cap.delegationId, ipOf(req), now).lastInsertRowid);
    logAudit({
      userId, ownerUserId: req.scope?.lab?.owner_user_id ?? userId, module: "veritaqc", action: "update", entityType: "qc_rule_lock", entityId: id,
      entityLabel: `QC rules ${want ? "locked" : "unlocked"}`, before: { locked: lock.locked }, after: { locked: want, reason, capacity: cap.capacity, signed_with: signed.signedWith, lab_id: labId },
      ipAddress: ipOf(req) ?? undefined,
    });
    res.json({ ok: true, locked: want, settings: settingsView(db0, labId, userId) });
  });
}

export { QC_RULE_CODES };
