// server/orgQualityStore.ts
//
// Reading an organization's quality indicators (B15): their versions, and a laboratory's metric with the definition in force.
// server/orgQuality.ts owns the writes and the routes; server/veritaqaPi.ts (the laboratory's side) reads through here.
import { orgUnit, versionForMonth, type OrgEntry, type OrgIndicatorKind, type OrgIndicatorVersion } from "@shared/qualityIndicators";

export interface StoredVersion extends OrgIndicatorVersion { indicator_id: number; changed_at: string; changed_by_user_id: number | null }

/** Every version of each indicator, oldest first. */
export function orgVersions(sqlite: any, indicatorIds: number[]): Map<number, StoredVersion[]> {
  const out = new Map<number, StoredVersion[]>();
  if (!indicatorIds.length) return out;
  const rows = sqlite.prepare(
    `SELECT indicator_id, version, effective_from, name, definition, numerator_text, denominator_text, kind, unit, target, direction, frequency, department, changed_at, changed_by_user_id
       FROM org_quality_indicator_versions WHERE indicator_id IN (SELECT value FROM json_each(?)) ORDER BY indicator_id, version`
  ).all(JSON.stringify([...new Set(indicatorIds)])) as StoredVersion[];
  for (const r of rows) { const list = out.get(r.indicator_id); if (list) list.push(r); else out.set(r.indicator_id, [r]); }
  return out;
}

export interface OrgMetricState { indicator_id: number; organization_name: string | null; versions: StoredVersion[]; on: boolean; turned_on_at: string | null; turned_off_at: string | null }

/** The organization side of a laboratory's metrics: the versions, and whether it is on in that laboratory today. */
export function orgMetricStates(sqlite: any, metrics: any[]): Map<number, OrgMetricState> {
  const out = new Map<number, OrgMetricState>();
  const linked = metrics.filter((m) => m.org_indicator_id != null);
  if (!linked.length) return out;
  const versions = orgVersions(sqlite, linked.map((m) => Number(m.org_indicator_id)));
  const links = sqlite.prepare(
    `SELECT ol.metric_id, ol.turned_on_at, ol.turned_off_at, o.name AS organization_name,
            CASE WHEN ol.turned_off_at IS NULL AND l.organization_id = ol.organization_id THEN 1 ELSE 0 END AS is_on
       FROM org_quality_indicator_labs ol LEFT JOIN organizations o ON o.id = ol.organization_id LEFT JOIN labs l ON l.id = ol.lab_id
      WHERE ol.metric_id IN (SELECT value FROM json_each(?))`
  ).all(JSON.stringify(linked.map((m) => m.id))) as any[];
  const byMetric = new Map(links.map((l) => [Number(l.metric_id), l]));
  for (const m of linked) {
    const l = byMetric.get(Number(m.id));
    out.set(Number(m.id), {
      indicator_id: Number(m.org_indicator_id), organization_name: l?.organization_name ?? null, versions: versions.get(Number(m.org_indicator_id)) ?? [],
      on: !!l && Number(l.is_on) === 1, turned_on_at: l?.turned_on_at ?? null, turned_off_at: l?.turned_off_at ?? null,
    });
  }
  return out;
}

/** A metric as the laboratory sees it: an organization's carries the definition in force in `ym`, and what the screen needs. */
export function withOrgDefinition(metric: any, state: OrgMetricState | undefined, ym: string): any {
  if (!state) return metric;
  const v = versionForMonth(state.versions, ym);
  if (!v) return metric;
  return {
    ...metric, name: v.name, unit: orgUnit(v.kind, v.unit), direction: v.direction, benchmark_green: v.target, benchmark_yellow: null, benchmark_red: null,
    measurement_methodology: v.definition,
    org: {
      indicator_id: state.indicator_id, organization_name: state.organization_name, on: state.on, turned_on_at: state.turned_on_at, turned_off_at: state.turned_off_at,
      kind: v.kind, frequency: v.frequency, numerator_text: v.numerator_text, denominator_text: v.denominator_text, version: v.version, effective_from: v.effective_from,
      versions: state.versions.map(({ indicator_id: _i, changed_by_user_id: _c, ...rest }) => rest),
    },
  };
}

/** A stored entry as the period rules read it: what was counted, with the kind and target in force when it was entered. */
export const orgEntryOf = (e: any): OrgEntry => ({
  month: Number(e.month), numerator: e.numerator ?? null, denominator: e.denominator ?? null, kind: (e.entry_kind ?? null) as OrgIndicatorKind | null, unit: e.entry_unit ?? null,
  target: e.target_value ?? null, direction: e.target_direction ?? null,
});
