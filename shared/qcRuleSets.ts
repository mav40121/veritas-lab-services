// shared/qcRuleSets.ts
//
// The QC rules a laboratory chooses (B12 part 2, QC rules mock 4; owner's answers Q1 = 1, Q2 = 1, Q3 = 1). Pure: no database, so the
// screen (client/src/pages/VeritaQCRulesPage.tsx), the server (server/qcRuleSets.ts) and the monthly review PDF read one rule.
//
// Only the app's own rules (1-2s, 1-3s, 2-2s, R-4s, 4-1s, N-x, N-T); none is added. Each is on or off, a warning or a rejection, and
// four of them can also look across the levels of one analyte on one analyzer (off by default). The manufacturer-range policy is not
// here: it stays as Veritas sets it (POST /api/admin/qc/rule-settings).
//
// STARTING_RULES is exactly what the app judged with before this screen: every rule on, 1-2s the only warning, the rest rejections,
// 10-x and 7-T, nothing across levels. Every lab starts there, so nothing changes for anyone until they change it.
//
// Q2: no single rule is required, but at least one rule stays on as a rejection (with none, no run could ever ask for a corrective
// action), so a set with none is refused.

export const QC_RULE_CODES = ["1-2s", "1-3s", "2-2s", "R-4s", "4-1s", "N-x", "N-T"] as const;
export type QcRuleCode = (typeof QC_RULE_CODES)[number];
export type QcSeverity = "warning" | "rejection";

/** The rules that can also look across levels: the ones that read more than one result. 1-2s and 1-3s read one; a trend is one level's. */
export const ACROSS_RULES: readonly QcRuleCode[] = ["2-2s", "R-4s", "4-1s", "N-x"];
/** How many in a row N-x and N-T may count. */
export const COUNT_RANGE = { min: 4, max: 20 } as const;

export interface QcRuleSetting {
  on: boolean;
  severity: QcSeverity;
  across: boolean;
  /** N-x and N-T only: how many in a row. */
  n?: number;
}
export interface QcRuleSet {
  rules: Record<QcRuleCode, QcRuleSetting>;
}

/** What each rule looks for, in the mock's words. {n} is the count. */
export const RULE_TEXT: Record<QcRuleCode, string> = {
  "1-2s": "One result outside 2 SD",
  "1-3s": "One result outside 3 SD",
  "2-2s": "Two in a row outside the same 2 SD limit",
  "R-4s": "One past +2 SD and the next past -2 SD (or the reverse), over 4 SD apart",
  "4-1s": "Four in a row past the same 1 SD limit",
  "N-x": "{n} in a row on one side of the mean",
  "N-T": "{n} in a row rising or falling",
};
export const MFR_RANGE_TEXT = "Outside the manufacturer's range while the lab sets its own mean and SD. Used as set now.";

/** The rules as the app judged before rule settings existed (version 1 for every lab). */
export function startingRules(biasN = 10, trendN = 7): QcRuleSet {
  const b = Number(biasN), t = Number(trendN);
  return {
    rules: {
      "1-2s": { on: true, severity: "warning", across: false },
      "1-3s": { on: true, severity: "rejection", across: false },
      "2-2s": { on: true, severity: "rejection", across: false },
      "R-4s": { on: true, severity: "rejection", across: false },
      "4-1s": { on: true, severity: "rejection", across: false },
      // A count of 0 or less turned the rule off in the old engine (westgardRulesAt: `biasN > 0`).
      "N-x": { on: b > 0, severity: "rejection", across: false, n: b > 0 ? Math.floor(b) : 10 },
      "N-T": { on: t > 0, severity: "rejection", across: false, n: t > 0 ? Math.floor(t) : 7 },
    },
  };
}
export const STARTING_RULES: QcRuleSet = startingRules();

const hasCount = (c: QcRuleCode) => c === "N-x" || c === "N-T";

/** The rule's code as printed: N-x and N-T carry their count (10-x, 7-T). */
export function ruleCodeLabel(code: QcRuleCode, set?: QcRuleSet | null): string {
  if (code === "N-x") return `${set?.rules["N-x"].n ?? 10}-x`;
  if (code === "N-T") return `${set?.rules["N-T"].n ?? 7}-T`;
  return code;
}
export function ruleText(code: QcRuleCode, set?: QcRuleSet | null): string {
  return RULE_TEXT[code].replace("{n}", String(set?.rules[code].n ?? (code === "N-x" ? 10 : 7)));
}

export type NormalizeResult = { ok: true; set: QcRuleSet } | { ok: false; error: string; code: string };

/**
 * Read a rule set sent by the screen. Every rule must be there; a rule that is off keeps its severity and count (so turning it back
 * on restores them) and never looks across levels. Refuses a set with no rule on as a rejection (Q2).
 */
export function normalizeRuleSet(raw: any): NormalizeResult {
  const src = raw && typeof raw === "object" ? (raw.rules && typeof raw.rules === "object" ? raw.rules : raw) : null;
  if (!src) return { ok: false, error: "Send the rules.", code: "RULES_REQUIRED" };
  const rules = {} as Record<QcRuleCode, QcRuleSetting>;
  for (const code of QC_RULE_CODES) {
    const r = src[code];
    if (!r || typeof r !== "object") return { ok: false, error: `The ${code} rule is missing.`, code: "RULE_MISSING" };
    if (typeof r.on !== "boolean") return { ok: false, error: `Say whether ${code} is used.`, code: "BAD_RULE" };
    if (r.severity !== "warning" && r.severity !== "rejection") return { ok: false, error: `A ${code} failure must be a warning or a rejection.`, code: "BAD_RULE" };
    const across = r.across === true;
    if (across && !ACROSS_RULES.includes(code)) return { ok: false, error: `${code} can't look across levels.`, code: "BAD_RULE" };
    const setting: QcRuleSetting = { on: r.on, severity: r.severity, across: r.on ? across : false };
    if (hasCount(code)) {
      const n = Number(r.n);
      if (!Number.isInteger(n) || n < COUNT_RANGE.min || n > COUNT_RANGE.max) {
        return { ok: false, error: `${code}: how many in a row must be a whole number from ${COUNT_RANGE.min} to ${COUNT_RANGE.max}.`, code: "BAD_COUNT" };
      }
      setting.n = n;
    }
    rules[code] = setting;
  }
  const set: QcRuleSet = { rules };
  if (!hasRejectionRule(set)) {
    return { ok: false, error: "At least one rule must stay on as a rejection, or no run could ever ask for a corrective action.", code: "NO_REJECTION_RULE" };
  }
  return { ok: true, set };
}

export function hasRejectionRule(set: QcRuleSet): boolean {
  return QC_RULE_CODES.some((c) => set.rules[c].on && set.rules[c].severity === "rejection");
}

/** One rule as a phrase: "Off", or "Rejection, 10 in a row, within and across levels". */
export function describeRule(code: QcRuleCode, set: QcRuleSet): string {
  const r = set.rules[code];
  if (!r.on) return "Off";
  const parts = [r.severity === "rejection" ? "Rejection" : "Warning"];
  if (hasCount(code)) parts.push(`${r.n} in a row`);
  if (ACROSS_RULES.includes(code)) parts.push(r.across ? "within and across levels" : "within a level");
  return parts.join(", ");
}

export interface RuleChange { code: QcRuleCode; rule: string; was: string; willBe: string }

/** The rows of "Saving a change": every rule whose meaning differs. A rule that stays off is unchanged whatever else it holds. */
export function ruleChanges(before: QcRuleSet, after: QcRuleSet): RuleChange[] {
  const out: RuleChange[] = [];
  for (const code of QC_RULE_CODES) {
    const was = describeRule(code, before), willBe = describeRule(code, after);
    if (was !== willBe) out.push({ code, rule: code, was, willBe });
  }
  return out;
}

export const sameRules = (a: QcRuleSet, b: QcRuleSet) => ruleChanges(a, b).length === 0;

/** The printed one-line summary: "1-2s W, 1-3s R, 2-2s W across, R-4s R across, 4-1s R, 10-x R. Off: N-T." */
export function ruleSetSummary(set: QcRuleSet): string {
  const on: string[] = [], off: string[] = [];
  for (const code of QC_RULE_CODES) {
    const r = set.rules[code];
    if (!r.on) { off.push(code); continue; }
    on.push(`${ruleCodeLabel(code, set)} ${r.severity === "rejection" ? "R" : "W"}${r.across ? " across" : ""}`);
  }
  return `${on.join(", ")}.${off.length ? ` Off: ${off.join(", ")}.` : ""}`;
}

/** MM/DD/YYYY from YYYY-MM-DD (the screens' and the PDF's date). */
export function mdy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[2]}/${m[3]}/${m[1]}` : "";
}

/** The day a starting set applies from: before any run, so a run of any date has rules. */
export const STARTING_DAY = "0001-01-01";

/** What a run says it was judged under. A run judged before rule settings has no version. */
export function judgedUnderLabel(v: { kind?: string | null; effective_from?: string | null; analyte?: string | null } | null | undefined): string {
  if (!v) return "Before rule settings";
  if (v.kind === "start" || v.effective_from === STARTING_DAY) return v.analyte ? `Starting rules (${v.analyte})` : "Starting rules";
  return `Rules of ${mdy(v.effective_from)}${v.analyte ? ` (${v.analyte})` : ""}`;
}

/** A rule code as stored on a violation; across-levels flags end in " across". */
export const ACROSS_SUFFIX = " across";
export const isAcrossCode = (code: string) => code.endsWith(ACROSS_SUFFIX);
