// server/ptBiasRoutes.ts
//
// Bias and trend per analyte for one lab (B11, 2026-11-24): every quantitative result against its peer group, oldest first, the
// two review flags and the analyte's two-of-three history. The numbers are shared/ptBias.ts on what was entered; the screen
// works nothing out. Read by any member but a limited Staff login, which gets the event list alone.
import type { Express } from "express";
import { PT_FLAG_RULES, ptBias, ptEventRuns, ptSameEventFlag, type PtBias, type PtSide } from "@shared/ptBias";
import type { PtEvent, PtResult } from "@shared/ptEvents";
import { ptEventsOfLab, ptStaffOwn, type PtDeps } from "./ptEvents";
import { ptTrendsForLab, type PtTrend } from "./ptTrends";

export type PtBiasPoint = Pick<PtResult, "id" | "your_result" | "peer_mean" | "peer_sd" | "peer_n" | "acceptable_low" | "acceptable_high" | "status" | "your_method"> & PtBias & { event_key: string; event: string; event_date: string; program: string };
export interface PtBiasFlag { rule: keyof typeof PT_FLAG_RULES; side: PtSide; text: string; event_keys: string[] }
export interface PtBiasAnalyte { analyte: string; points: PtBiasPoint[]; flags: PtBiasFlag[]; trend: PtTrend | null }

const oldestFirst = (a: PtEvent, b: PtEvent) => a.event_date.localeCompare(b.event_date) || a.id - b.id;

/** Every analyte with a quantitative result, and the events whose results are all on one side. */
export function ptBiasForLab(sqlite: any, labId: number): { analytes: PtBiasAnalyte[]; event_flags: Array<PtBiasFlag & { event: string; event_date: string; program: string }> } {
  const events = ptEventsOfLab(sqlite, labId).sort(oldestFirst);
  const trends = new Map(ptTrendsForLab(sqlite, labId).trends.map((t) => [t.analyte, t]));
  const byAnalyte = new Map<string, Array<{ event: PtEvent; results: PtBiasPoint[] }>>();
  const event_flags: ReturnType<typeof ptBiasForLab>["event_flags"] = [];
  for (const e of events) {
    const points = e.results.filter((r) => r.your_result != null).map((r): PtBiasPoint => ({
      id: r.id, your_result: r.your_result, peer_mean: r.peer_mean, peer_sd: r.peer_sd, peer_n: r.peer_n, acceptable_low: r.acceptable_low, acceptable_high: r.acceptable_high,
      status: r.status, your_method: r.your_method, ...ptBias(r), event_key: e.key, event: e.name, event_date: r.event_date, program: e.program,
    }));
    const analyteOf = new Map(e.results.map((r) => [r.id, r.analyte]));
    for (const p of points) {
      const a = analyteOf.get(p.id)!;
      const list = byAnalyte.get(a) ?? [];
      const last = list[list.length - 1];
      if (last?.event === e) last.results.push(p); else list.push({ event: e, results: [p] });
      byAnalyte.set(a, list);
    }
    const whole = ptSameEventFlag(points);
    if (whole && new Set(points.map((p) => analyteOf.get(p.id))).size > 1) {
      event_flags.push({ rule: "same_event", side: whole.side, event_keys: [e.key], event: e.name, event_date: e.event_date, program: e.program, text: `Flag for review: all ${whole.count} results of ${e.name} are ${whole.side} their peer mean.` });
    }
  }
  const analytes = Array.from(byAnalyte.entries()).map(([analyte, list]): PtBiasAnalyte => {
    const flags: PtBiasFlag[] = [];
    for (const g of list) {
      const f = ptSameEventFlag(g.results);
      if (f) flags.push({ rule: "same_event", side: f.side, event_keys: [g.event.key], text: `Flag for review: all ${f.count} ${analyte} results of ${g.event.name} are ${f.side} the peer mean.` });
    }
    for (const run of ptEventRuns(list)) {
      flags.push({ rule: "three_events", side: run.side, event_keys: run.events.map((g) => g.event.key), text: `Flag for review: ${analyte} is ${run.side} the peer mean in ${run.events.length} events in a row (${run.events.map((g) => `${g.event.name}, ${g.event.event_date}`).join("; ")}).` });
    }
    return { analyte, points: list.flatMap((g) => g.results), flags, trend: trends.get(analyte) ?? null };
  }).sort((a, b) => a.analyte.localeCompare(b.analyte));
  return { analytes, event_flags: event_flags.reverse() };
}

export function registerPtBiasRoutes(app: Express, deps: PtDeps) {
  const { sqlite, authMiddleware, labScopeMiddleware, hasPTAccess } = deps;
  app.get("/api/labs/:labId/pt/bias", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!hasPTAccess(req.user, req.scope?.lab)) return res.status(403).json({ error: "VeritaPT™ subscription required" });
    if (ptStaffOwn(sqlite(), req)) return res.status(403).json({ error: "A staff login reads the event list only.", code: "STAFF_OWN_ONLY" });
    res.json({ ...ptBiasForLab(sqlite(), req.scope.labId), rules: PT_FLAG_RULES });
  });
}
