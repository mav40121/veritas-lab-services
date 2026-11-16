// Pure aggregation for the multi-lab readiness "command center" (the roll-up on
// ReadinessDashboardPage). Kept dependency-free and side-effect-free so
// scripts/verify-readiness-rollup.mts exercises the exact logic the UI renders.
//
// The /api/readiness/rollup endpoint returns one entry per lab the user is a
// member of, each with per-module status and an `overall` summary. This turns
// that array into the numbers + orderings the command center needs: a network
// summary band, a worst-first "where to look" action feed, the stable set of
// module columns for the heatmap, and severity-sorted rows.

export type RollupStatus = "ok" | "attention" | "overdue";

export interface RollupModule {
  key: string;
  label: string;
  status: RollupStatus;
  overdue: number;
  due_soon: number;
  total?: number;
  headline?: string;
}

export interface RollupLab {
  lab_id: number;
  lab_name: string | null;
  clia_number: string | null;
  modules: RollupModule[];
  overall: {
    modules_total: number;
    modules_ok: number;
    attention_items: number;
    overdue_items: number;
    status: RollupStatus;
  };
}

// Sort weight: overdue is worst, then attention, then ok.
export const sev = (s: string): number => (s === "overdue" ? 2 : s === "attention" ? 1 : 0);

export interface RollupSummary {
  sites: number;
  ready: number;
  attention: number;
  overdueSites: number;
  totalOverdue: number;
  totalDueSoon: number;
  readinessPct: number;
  cols: { key: string; label: string }[];
  feed: RollupLab[];
  rows: RollupLab[];
}

export function summarizeRollup(rollup: RollupLab[]): RollupSummary {
  const sites = rollup.length;
  const ready = rollup.filter((l) => l.overall.status === "ok").length;
  const attention = rollup.filter((l) => l.overall.status === "attention").length;
  const overdueSites = rollup.filter((l) => l.overall.status === "overdue").length;
  const totalOverdue = rollup.reduce((s, l) => s + (l.overall.overdue_items || 0), 0);
  const totalAttention = rollup.reduce((s, l) => s + (l.overall.attention_items || 0), 0);
  // attention_items includes overdue_items; due-soon is the non-overdue remainder.
  const totalDueSoon = Math.max(0, totalAttention - totalOverdue);
  const okModules = rollup.reduce((s, l) => s + (l.overall.modules_ok || 0), 0);
  const totalModules = rollup.reduce((s, l) => s + (l.overall.modules_total || 0), 0);
  const readinessPct = totalModules ? Math.round((okModules / totalModules) * 100) : 100;

  // Stable union of module columns across all labs, first-seen order.
  const colMap = new Map<string, string>();
  rollup.forEach((l) => (l.modules || []).forEach((m) => { if (!colMap.has(m.key)) colMap.set(m.key, m.label); }));
  const cols = [...colMap.entries()].map(([key, label]) => ({ key, label }));

  // Action feed: only labs with something outstanding, worst-first.
  const feed = rollup
    .filter((l) => (l.overall.overdue_items || 0) > 0 || (l.overall.attention_items || 0) > 0)
    .slice()
    .sort((a, b) => (b.overall.overdue_items - a.overall.overdue_items) || (b.overall.attention_items - a.overall.attention_items));

  // Heatmap rows: worst status first, then by overdue count.
  const rows = rollup
    .slice()
    .sort((a, b) => (sev(b.overall.status) - sev(a.overall.status)) || (b.overall.overdue_items - a.overall.overdue_items));

  return { sites, ready, attention, overdueSites, totalOverdue, totalDueSoon, readinessPct, cols, feed, rows };
}

// Bad modules for one lab, worst-first (used by the action feed chips).
export function badModules(lab: RollupLab): RollupModule[] {
  return (lab.modules || []).filter((m) => m.status !== "ok").slice().sort((a, b) => sev(b.status) - sev(a.status));
}

// ── Roll-up groups (Michael 2026-11-16, Phase 1; server/rollupGroups.ts) ─────────────────────────────────────────────
// A group is a named set of lab ids (a region, a consultant's labs). The server already cut each group's lab ids to the
// labs the reader sees; these helpers only arrange the roll-up the reader was given.

export interface RollupGroupRef {
  id: number;
  name: string;
  kind: string;
  lab_ids: number[];
}

export interface RollupSection {
  group: RollupGroupRef | null; // null = the labs in none of the groups shown
  labs: RollupLab[];            // worst-first, as the heatmap orders rows
  summary: RollupSummary;
}

/** Groups holding at least one lab of this roll-up, in the order given (the server sorts by name). */
export function groupsInRollup(rollup: RollupLab[], groups: RollupGroupRef[]): RollupGroupRef[] {
  const ids = new Set(rollup.map((l) => l.lab_id));
  return groups.filter((g) => g.lab_ids.some((id) => ids.has(id)));
}

/** The roll-up cut to one group ("none" = the labs in none of the groups). */
export function filterRollupByGroup(rollup: RollupLab[], groups: RollupGroupRef[], filter: number | "none"): RollupLab[] {
  if (filter === "none") {
    const grouped = new Set(groupsInRollup(rollup, groups).flatMap((g) => g.lab_ids));
    return rollup.filter((l) => !grouped.has(l.lab_id));
  }
  const g = groups.find((x) => x.id === filter);
  if (!g) return rollup;
  const ids = new Set(g.lab_ids);
  return rollup.filter((l) => ids.has(l.lab_id));
}

/**
 * The heatmap broken out by group: one section per group that holds a lab of this roll-up, each with its own subtotals,
 * then "Not in a group" for the rest. A lab in two groups shows in both. No groups, no sections.
 */
export function groupSections(rollup: RollupLab[], groups: RollupGroupRef[]): RollupSection[] {
  const byId = new Map(rollup.map((l) => [l.lab_id, l]));
  const sections: RollupSection[] = [];
  const grouped = new Set<number>();
  for (const g of groupsInRollup(rollup, groups)) {
    const labs = g.lab_ids.map((id) => byId.get(id)).filter((l): l is RollupLab => !!l);
    labs.forEach((l) => grouped.add(l.lab_id));
    const summary = summarizeRollup(labs);
    sections.push({ group: g, labs: summary.rows, summary });
  }
  if (!sections.length) return sections;
  const rest = rollup.filter((l) => !grouped.has(l.lab_id));
  if (rest.length) {
    const summary = summarizeRollup(rest);
    sections.push({ group: null, labs: summary.rows, summary });
  }
  return sections;
}

export const ROLLUP_GROUP_KIND_LABEL: Record<string, string> = { region: "Region", consultant: "Consultant", other: "Group" };
