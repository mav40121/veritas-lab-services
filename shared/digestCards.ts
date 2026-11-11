// shared/digestCards.ts
//
// The compliance digest's cards (Michael 2026-11-11, Q281 = 1; PR 4 of 5, the screens; the approved screen mock of
// 2026-11-10). One card per section an issue includes: its title, its module and mark, the big number, the detail line,
// the change line and the module screen it links to. Every number comes from the issue's own counts (frozen for a
// published issue, live for a draft); nothing here invents one. A section whose count came back null reads "Not
// available", never 0.
//
// The change line (decided 2026-11-11): each card's headline number against the lab's previous published, non-withdrawn
// issue of the same frequency, from the counts that issue stored at publish (GET issues/:id `previous`, server/digestIssues.ts).
// No prior issue, or a prior issue without the section (or with that section null), and the card has no change line. A
// past period is never recomputed. New tests added is information only (no better or worse). For every other card the
// headline counts things that need attention, so fewer is better. Wording: "Down from N in September", "Up from N in
// September", "Same as September (N)"; colors better #437A22, worse #A12C7B, same and info #7A7974.
//
// Counts only. Test and analyzer names appear on the new tests card (they are the lab's menu, not people); no person's
// name is ever on a card. Kept in shared/ so PR 5's PDF prints the same cards.

export const DIGEST_CARD_KEYS = [
  "competencies", "studies", "newTests", "pt", "documents", "certificates", "maintenance", "qc", "stock", "tasks", "findings", "scan",
] as const;
export type DigestCardKey = typeof DIGEST_CARD_KEYS[number];

type Section = Record<string, any> | null | undefined;
export type DigestCountsLike = Record<string, any> & { monthStart?: string; monthEnd?: string; asOf?: string; timeZone?: string };

export interface DigestCardMeta {
  key: DigestCardKey;
  title: string;
  module: string; // with its mark: ® only on VeritaAssure, VeritaCheck, VeritaMap and VeritaScan
  path: string; // the module's screen, under /labs/:labId
  wide?: boolean;
  optional?: boolean;
}

export const DIGEST_CARDS: Record<DigestCardKey, DigestCardMeta> = {
  competencies: { key: "competencies", title: "Competencies due or overdue", module: "VeritaComp™", path: "/veritacomp-app" },
  studies: { key: "studies", title: "Studies due", module: "VeritaCheck®", path: "/veritacheck/coverage" },
  newTests: { key: "newTests", title: "New tests added", module: "VeritaMap®", path: "/veritamap-app", wide: true },
  pt: { key: "pt", title: "PT results and corrective actions", module: "VeritaPT™", path: "/veritapt/app" },
  documents: { key: "documents", title: "Documents past review and read-and-sign", module: "VeritaDC™", path: "/veritapolicy-app" },
  certificates: { key: "certificates", title: "Certificates expiring", module: "VeritaLab™", path: "/veritalab-app" },
  maintenance: { key: "maintenance", title: "Maintenance overdue", module: "VeritaMaintain™", path: "/equipment-app" },
  qc: { key: "qc", title: "QC rejections without a corrective action", module: "VeritaQC™", path: "/veritaqc-app" },
  stock: { key: "stock", title: "Expired stock and recalls", module: "VeritaStock™", path: "/veritastock" },
  tasks: { key: "tasks", title: "Tasks overdue", module: "VeritaTrack™", path: "/veritatrack-app" },
  findings: { key: "findings", title: "Open findings", module: "VeritaResponse™", path: "/veritaresponse" },
  scan: { key: "scan", title: "Survey readiness", module: "VeritaScan®", path: "/veritascan-app", optional: true },
};

// ── Periods ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ymd = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), day: Number(d.slice(8, 10)) });
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type DigestFrequencyLike = "monthly" | "quarterly";

/** A month's or a calendar quarter's period from its stored first and last day; null for a range that is neither. */
export function periodFrequency(start: string, end: string): DigestFrequencyLike | null {
  const s = ymd(start);
  if (s.day !== 1) return null;
  if (end === iso(s.y, s.m, lastDay(s.y, s.m))) return "monthly";
  if ((s.m - 1) % 3 === 0) {
    const em = s.m + 2;
    if (end === iso(s.y, em, lastDay(s.y, em))) return "quarterly";
  }
  return null;
}

/** The period as the issue's title: "October 2026", or "Q3 2026 (July to September)". */
export function periodTitle(start: string, end: string): string {
  const s = ymd(start), e = ymd(end);
  if (periodFrequency(start, end) === "quarterly") return `Q${Math.floor((s.m - 1) / 3) + 1} ${s.y} (${MONTHS[s.m - 1]} to ${MONTHS[e.m - 1]})`;
  if (periodFrequency(start, end) === "monthly") return `${MONTHS[s.m - 1]} ${s.y}`;
  return `${formatDay(start)} to ${formatDay(end)}`;
}

/** The period inside a sentence ("6 completed in October", "in the quarter"). */
export function periodPhrase(start: string, end: string): string {
  const f = periodFrequency(start, end);
  if (f === "monthly") return MONTHS[ymd(start).m - 1];
  if (f === "quarterly") return "the quarter";
  return "the period";
}

/** A prior period named from the current one: "September" in the same year, "December 2025" across a year; "Q2 2026" for a quarter. */
export function priorPeriodLabel(prior: { period_start: string; period_end: string }, current: { period_start: string }): string {
  const p = ymd(prior.period_start);
  const sameYear = p.y === ymd(current.period_start).y;
  if (periodFrequency(prior.period_start, prior.period_end) === "quarterly") return `Q${Math.floor((p.m - 1) / 3) + 1} ${p.y}`;
  return sameYear ? MONTHS[p.m - 1] : `${MONTHS[p.m - 1]} ${p.y}`;
}

/** "Nov 3, 2026" for a YYYY-MM-DD day. */
export function formatDay(day: string | null | undefined): string {
  const s = String(day ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = ymd(s);
  return `${MONTHS_SHORT[d.m - 1]} ${d.day}, ${d.y}`;
}

/** A stored moment's day on the lab's clock, as "Nov 3, 2026". SQLite's "YYYY-MM-DD HH:MM:SS" is UTC. */
export function formatMomentDay(stamp: string | null | undefined, timeZone?: string | null): string {
  const s = String(stamp ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDay(s);
  const at = new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s.replace(" ", "T")}Z` : s);
  if (Number.isNaN(at.getTime())) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return formatDay(`${g("year")}-${g("month")}-${g("day")}`);
  } catch {
    return formatDay(at.toISOString().slice(0, 10));
  }
}

/** The finished periods an owner can draft, newest first: the last finished one (the server's default) and the ones before it. */
export function draftablePeriods(lastFinished: { start: string; end: string }, frequency: DigestFrequencyLike, count = frequency === "quarterly" ? 8 : 24): Array<{ start: string; end: string; label: string }> {
  const out: Array<{ start: string; end: string; label: string }> = [];
  const step = frequency === "quarterly" ? 3 : 1;
  let { y, m } = ymd(lastFinished.start);
  for (let i = 0; i < count; i++) {
    const em = m + step - 1;
    const start = iso(y, m, 1), end = iso(y, em, lastDay(y, em));
    out.push({ start, end, label: periodTitle(start, end) });
    m -= step;
    if (m < 1) { m += 12; y -= 1; }
  }
  return out;
}

// ── Cards ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const has = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** The number a card shows big, and the one its change line compares. Null when the section has no count. */
export function headlineNumber(key: DigestCardKey, s: Section): number | null {
  if (!s || typeof s !== "object") return null;
  switch (key) {
    case "competencies": return n(s.overdue);
    case "studies": return n(s.overdue);
    case "newTests": return n(s.count);
    case "pt": return n(s.unacceptableInMonth);
    case "documents": return n(s.pastReview);
    case "certificates": return n(s.expiringIn90);
    case "maintenance": return n(s.overdue);
    case "qc": return n(s.withoutCorrectiveAction);
    case "stock": return n(s.expiredLots);
    case "tasks": return n(s.overdue);
    case "findings": return n(s.open);
    case "scan": {
      const a = n(s.needsAttention), b = n(s.immediateAction);
      return a == null || b == null ? null : a + b;
    }
  }
  return null;
}

export interface DigestCardBody { available: boolean; big: number | null; unit: string; detail: string }

/** The big number, its words and the detail line for one section of an issue. */
export function cardBody(key: DigestCardKey, s: Section, period: { start: string; end: string; asOf?: string | null }): DigestCardBody {
  const big = headlineNumber(key, s);
  if (big == null || !s) {
    const detail = key === "scan"
      ? "No VeritaScan® survey readiness scan is on file, or the count couldn't be taken."
      : "This count couldn't be taken when the numbers were gathered.";
    return { available: false, big: null, unit: "", detail };
  }
  const inP = periodPhrase(period.start, period.end);
  const asOfMonth = period.asOf && /^\d{4}-\d{2}/.test(period.asOf) ? MONTHS[Number(period.asOf.slice(5, 7)) - 1] : null;
  const endMonth = MONTHS[ymd(period.end).m - 1];
  const parts: string[] = [];
  switch (key) {
    case "competencies": {
      parts.push(`${n(s.dueIn30) ?? 0} due in the next 30 days; ${n(s.dueIn90) ?? 0} more within 90 days`);
      if (s.nontechnical && typeof s.nontechnical === "object") parts.push(`Non-technical: ${n(s.nontechnical.overdue) ?? 0} overdue, ${n(s.nontechnical.dueSoon) ?? 0} due within 90 days`);
      return { available: true, big, unit: "overdue", detail: parts.join(". ") };
    }
    case "studies": {
      const done = n(s.completedInMonth) ?? 0;
      parts.push(`${n(s.dueSoon) ?? 0} due in the next 30 days; ${done} completed in ${inP}${done ? ` (${n(s.passedInMonth) ?? 0} passed, ${n(s.failedInMonth) ?? 0} failed)` : ""}`);
      if (n(s.openDrafts)) parts.push(plural(s.openDrafts, "draft is open", "drafts are open"));
      if (s.hasMap === false) parts.push("No VeritaMap® test menu is on file, so no study comes due here yet");
      return { available: true, big, unit: "overdue", detail: parts.join(". ") };
    }
    case "newTests": {
      const items: Array<{ analyte: string; instrumentName: string; studyOnFile: boolean }> = Array.isArray(s.items) ? s.items : [];
      const byInstrument = new Map<string, string[]>();
      for (const i of items) {
        const k = String(i.instrumentName || "an analyzer");
        byInstrument.set(k, [...(byInstrument.get(k) || []), String(i.analyte)]);
      }
      const listed = Array.from(byInstrument.entries()).slice(0, 8).map(([inst, tests]) => `${joinNames(tests)} on ${inst}`);
      if (listed.length) parts.push(listed.join("; ") + (byInstrument.size > 8 ? `; and ${byInstrument.size - 8} more analyzers` : ""));
      if (items.length) {
        const onFile = items.filter((i) => i.studyOnFile).length;
        const missing = items.filter((i) => !i.studyOnFile).map((i) => i.analyte);
        parts.push(`VeritaCheck® study on file: ${onFile} of ${items.length}` + (missing.length ? `. None yet: ${joinNames(Array.from(new Set(missing)).slice(0, 10))}${missing.length > 10 ? " and more" : ""}` : ""));
      }
      const built = (Array.isArray(s.maps) ? s.maps : []).filter((m: any) => m?.mapBuiltThisMonth).length;
      if (built) parts.push(`${built === 1 ? "A test menu was" : `${built} test menus were`} built in VeritaMap® in ${inP}; a first build isn't counted as new tests`);
      if (!items.length && !built) parts.push(`No test was switched on in ${inP}`);
      return { available: true, big, unit: `${big === 1 ? "test" : "tests"} added in ${inP}`, detail: parts.join(". ") };
    }
    case "pt": {
      const year = ymd(period.start).y;
      parts.push(`${plural(n(s.openCorrectiveActions) ?? 0, "corrective action", "corrective actions")} open; ${n(s.acceptableYearToDate) ?? 0} of ${n(s.gradedYearToDate) ?? 0} acceptable in ${year} through ${endMonth}`);
      return { available: true, big, unit: `unacceptable ${big === 1 ? "result" : "results"} in ${inP}`, detail: parts.join(". ") };
    }
    case "documents": {
      const owed = n(s.signaturesOwed) ?? 0, people = n(s.peopleOwingSignatures) ?? 0;
      parts.push(`${plural(owed, "read-and-sign signature", "read-and-sign signatures")} owed${owed ? ` by ${plural(people, "person", "people")}` : ""}`);
      const changed = n(s.changedInMonth) ?? 0;
      parts.push(changed ? `${plural(changed, "document", "documents")} changed in ${inP} (${n(s.newInMonth) ?? 0} new, ${n(s.revisedInMonth) ?? 0} revised)` : `No document changed in ${inP}`);
      return { available: true, big, unit: "past review", detail: parts.join(". ") };
    }
    case "certificates":
      return { available: true, big, unit: "expiring within 90 days", detail: `${n(s.expired) ?? 0} expired` };
    case "maintenance": {
      parts.push(`${n(s.dueIn30) ?? 0} due in the next 30 days`);
      const probs = n(s.reviewProblems) ?? 0;
      parts.push(probs ? `${plural(probs, "problem", "problems")} on ${plural(n(s.recordsWithProblems) ?? 0, "record", "records")} in ${inP}'s monthly review` : `No problems in ${inP}'s monthly review`);
      return { available: true, big, unit: "overdue", detail: parts.join(". ") };
    }
    case "qc": {
      const runs = n(s.rejectedRunsInMonth) ?? 0;
      return { available: true, big, unit: "without a corrective action", detail: `${plural(runs, "rejected run", "rejected runs")} in ${inP}, ${Math.max(0, runs - big)} documented` };
    }
    case "stock": {
      parts.push(`${plural(n(s.expiredProducts) ?? 0, "product", "products")} affected`);
      parts.push(`${plural(n(s.openRecalls) ?? 0, "open recall", "open recalls")}, ${n(s.overdueRecalls) ?? 0} past due`);
      return { available: true, big, unit: `expired ${big === 1 ? "lot" : "lots"} on the shelf`, detail: parts.join("; ") };
    }
    case "tasks":
      return { available: true, big, unit: "overdue", detail: `${n(s.notStarted) ?? 0} not started; ${n(s.dueThisMonth) ?? 0} more due in ${asOfMonth ?? "the month"}` };
    case "findings":
      return { available: true, big, unit: "open", detail: `${n(s.pastDue) ?? 0} past the due date` };
    case "scan": {
      const auto = s.automatic || {}, staff = s.staff || {};
      parts.push(`${n(s.immediateAction) ?? 0} need immediate action; ${n(s.compliant) ?? 0} compliant and ${n(s.notAssessed) ?? 0} not assessed, of ${n(s.total) ?? 0} items`);
      parts.push(`Marked by VeritaCheck® and VeritaComp™: ${n(auto.compliant) ?? 0} compliant. Marked by staff: ${n(staff.compliant) ?? 0} compliant`);
      if (s.updatedOn) parts.push(`Scan last saved ${formatDay(s.updatedOn)}`);
      return { available: true, big, unit: `${big === 1 ? "item needs" : "items need"} attention`, detail: parts.join(". ") };
    }
  }
  return { available: true, big, unit: "", detail: "" };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export type DigestChangeKind = "better" | "worse" | "same" | "info";
export interface DigestChangeLine { kind: DigestChangeKind; label: string | null; text: string }
export const DIGEST_CHANGE_COLORS: Record<DigestChangeKind, string> = { better: "#437A22", worse: "#A12C7B", same: "#7A7974", info: "#7A7974" };

/**
 * One card's change line against the prior issue, or null for none. `prior` is GET issues/:id's `previous` (null when there
 * is no prior issue, or it doesn't reach this reader); its counts hold only the sections that issue stored.
 */
export function changeLine(
  key: DigestCardKey,
  current: Section,
  prior: { period_start: string; period_end: string; counts?: Record<string, any> | null } | null | undefined,
  currentPeriod: { period_start: string },
): DigestChangeLine | null {
  if (!prior || !prior.counts || !has(prior.counts, key)) return null;
  const now = headlineNumber(key, current), then = headlineNumber(key, prior.counts[key]);
  if (now == null || then == null) return null;
  const when = priorPeriodLabel(prior, currentPeriod);
  if (key === "newTests") return { kind: "info", label: null, text: `${when}: ${then} added` };
  if (now < then) return { kind: "better", label: "Better:", text: `Down from ${then} in ${when}` };
  if (now > then) return { kind: "worse", label: "Worse:", text: `Up from ${then} in ${when}` };
  return { kind: "same", label: "No change:", text: `Same as ${when} (${then})` };
}

/** The sections an issue includes, in the digest's order. */
export function issueCardKeys(sections: unknown): DigestCardKey[] {
  const set = new Set(Array.isArray(sections) ? sections.map(String) : []);
  return DIGEST_CARD_KEYS.filter((k) => set.has(k));
}

export const DIGEST_AUDIENCE_LABELS: Record<string, string> = {
  leadership: "Leadership",
  staff: "Everyone in the lab",
  groups: "Chosen lab groups",
};
/** The header's eyebrow: the leadership version, or the staff version (everyone, or chosen groups). */
export const digestVersionLabel = (audience: string) => (audience === "leadership" ? "Leadership version" : "Staff version");
