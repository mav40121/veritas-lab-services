// server/ptTrends.ts
//
// The VeritaPT trend flags (42 CFR §493.803, two of three), moved out of routes.ts so GET /api/veritapt/trends, the period
// report and the analyte screen read one answer (B11, 2026-11-24). The rule is unchanged: for each analyte, the last three
// GRADED results, 'pass' or 'fail' only. An ungraded or pending result is neither, so it takes no place in the three and
// never clears or raises a flag.
//   OK       no fail in the last three
//   WATCH    one
//   AT-RISK  two or more
// `history` is every graded result of the analyte, newest first, each with the state it left the analyte in, and the
// ungraded results between them with no state.

export type PtTrendState = "OK" | "WATCH" | "AT-RISK";
export interface PtTrendHistory { event_date: string; event: string | null; pass_fail: string; state: PtTrendState | null }
export interface PtTrend {
  analyte: string;
  state: PtTrendState;
  last3: Array<{ event_date: string; pass_fail: string }>;
  fails_in_last_3: number;
  history: PtTrendHistory[];
}

const stateOf = (fails: number): PtTrendState => (fails >= 2 ? "AT-RISK" : fails === 1 ? "WATCH" : "OK");

/** Every analyte's flag, through a day (inclusive) when one is given. */
export function ptTrendsForLab(sqlite: any, labId: number | null, through?: string): { counts: { OK: number; WATCH: number; AT_RISK: number }; trends: PtTrend[] } {
  const cut = through ? " AND substr(event_date, 1, 10) <= ?" : "";
  const args = through ? [labId, through] : [labId];
  const events = sqlite.prepare(
    `SELECT analyte, event_date, pass_fail, event_id, event_name
       FROM pt_events
      WHERE lab_id = ?
        AND pass_fail IN ('pass', 'fail')${cut}
      ORDER BY analyte ASC, event_date DESC`
  ).all(...args) as Array<{ analyte: string; event_date: string; pass_fail: string; event_id: string | null; event_name: string | null }>;
  const label = (e: { event_id: string | null; event_name: string | null }) => String(e.event_id || e.event_name || "").trim() || null;
  const byAnalyte = new Map<string, typeof events>();
  for (const e of events) byAnalyte.set(e.analyte, [...(byAnalyte.get(e.analyte) ?? []), e]);
  const ungraded = sqlite.prepare(
    `SELECT analyte, event_date, pass_fail, event_id, event_name FROM pt_events WHERE lab_id = ? AND pass_fail = 'ungraded'${cut} ORDER BY event_date DESC`
  ).all(...args) as typeof events;

  const trends: PtTrend[] = Array.from(byAnalyte.entries()).map(([analyte, list]) => {
    const last3 = list.slice(0, 3).map((e) => ({ event_date: e.event_date, pass_fail: e.pass_fail }));
    const fails = last3.filter((e) => e.pass_fail === "fail").length;
    const history: PtTrendHistory[] = list.map((e, i) => ({
      event_date: e.event_date, event: label(e), pass_fail: e.pass_fail, state: stateOf(list.slice(i, i + 3).filter((x) => x.pass_fail === "fail").length),
    }));
    for (const u of ungraded.filter((x) => x.analyte === analyte)) {
      const at = history.findIndex((h) => h.event_date <= u.event_date);
      history.splice(at < 0 ? history.length : at, 0, { event_date: u.event_date, event: label(u), pass_fail: u.pass_fail, state: null });
    }
    return { analyte, state: stateOf(fails), last3, fails_in_last_3: fails, history };
  });
  // AT-RISK first, then WATCH, then OK; within each state by analyte name.
  const rank: Record<PtTrendState, number> = { "AT-RISK": 0, WATCH: 1, OK: 2 };
  trends.sort((a, b) => rank[a.state] - rank[b.state] || a.analyte.localeCompare(b.analyte));
  return {
    counts: {
      OK: trends.filter((t) => t.state === "OK").length,
      WATCH: trends.filter((t) => t.state === "WATCH").length,
      AT_RISK: trends.filter((t) => t.state === "AT-RISK").length,
    },
    trends,
  };
}
