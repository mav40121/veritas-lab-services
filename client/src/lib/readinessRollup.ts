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
