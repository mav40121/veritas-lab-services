// server/labQualityReport.ts
//
// One laboratory's quality report across all of its indicators, for a month, a quarter or a year (B15; until then the PDF was one
// indicator at a time). GET .../pi/report gives the numbers the screen shows; .../report/pdf and .../report/xlsx print them.
// Reach is the VeritaQA reads' own.
//
// A period's total comes only from numerators and denominators (an organization's indicator); values entered as a percent alone
// are listed month by month and never averaged. A month with nothing entered reads "No entry" and counts as neither met nor
// missed. Account-wide indicators print in their own section, labelled so, since their numbers may not be this laboratory's.
import type { Express } from "express";
import { db } from "./db";
import { labView, qaDepartments, qaMetrics, entryStatus, type QaLabView } from "./veritaqaPi";
import { orgEntryOf } from "./orgQualityStore";
import { storePdfToken } from "./pdfTokens";
import { labReportExcel, labReportFilename, labReportPDF } from "./qualityReportFiles";
import { findingLinksFor, type FindingLink } from "./qualityFindings";
import { labToday } from "./dateLocal";
import { ACCOUNT_WIDE_LABEL, TARGET_CHANGED, entryMonths, expectedEntries, metText, orgUnit, parsePeriod, rollPeriod, targetText, valueText, versionForMonth, type OrgIndicatorVersion, type Period, type PeriodResult } from "@shared/qualityIndicators";

const sqliteOf = () => (db as any).$client;

export interface LabReportMonth { month: number; value: number | null; value_text: string; volume: number | null; numerator: number | null; denominator: number | null; status: "green" | "yellow" | "red" | null; due: boolean; notes: string | null; root_cause: string | null; corrective_action: string | null; findings: FindingLink[] }
export interface LabReportRow {
  metric_id: number; name: string; unit: string; target_text: string; organization: string | null; off_since: string | null; inactive: boolean;
  months: LabReportMonth[]; entered: number; expected: number; met: number; judged: number;
  /** Only from numerators and denominators; null for an indicator whose values were entered alone. */
  period: PeriodResult | null; period_text: string; result_text: string;
}
export interface LabReportSection { title: string; account_wide: boolean; departments: { name: string; rows: LabReportRow[] }[] }
export interface LabReport { lab: { id: number; name: string | null; clia: string | null }; period: Period; sections: LabReportSection[]; counts: { indicators: number; with_entries: number; no_entry: number }; generated: string }

export const STATUS_WORD: Record<string, string> = { green: "Met", yellow: "Watch", red: "Missed" };

export function buildLabReport(sqlite: any, view: QaLabView, lab: { id: number; name: string | null; clia: string | null }, period: Period): LabReport {
  // The laboratory's rows, and its owner's account-wide ones when the reader sees them; never another account's.
  const v: QaLabView = { ...view, wide: view.wide.filter((id) => id === view.ownerId) };
  const departments = new Map(qaDepartments(sqlite, v).map((d) => [Number(d.id), d]));
  const metrics = qaMetrics(sqlite, v, "all", false);
  const entries = sqlite.prepare("SELECT * FROM pi_entries WHERE metric_id IN (SELECT value FROM json_each(?)) AND year = ? AND month IN (SELECT value FROM json_each(?))")
    .all(JSON.stringify(metrics.map((m) => m.id)), period.year, JSON.stringify(period.months)) as any[];
  const links = findingLinksFor(sqlite, view.labId, entries.map((e) => Number(e.id)));
  const sections: LabReportSection[] = [{ title: "This laboratory's indicators", account_wide: false, departments: [] }, { title: ACCOUNT_WIDE_LABEL, account_wide: true, departments: [] }];
  let indicators = 0, withEntries = 0;
  for (const m of metrics) {
    const own = entries.filter((e) => e.metric_id === m.id);
    const offSince = m.org && !m.org.on ? String(m.org.turned_off_at ?? "").slice(0, 10) || "an earlier date" : null;
    if (!m.active && !own.length) continue;
    const isOrg = !!m.org;
    // An organization's indicator by the version in force at the period's end.
    const v = isOrg ? versionForMonth(m.org.versions as OrgIndicatorVersion[], period.to) : null;
    const due = new Set(v ? entryMonths(v.frequency) : period.months);
    const months: LabReportMonth[] = period.months.map((month) => {
      const e = own.find((x) => x.month === month);
      return {
        month, value: e?.value ?? null, value_text: e?.value == null ? "" : valueText(e.value, isOrg ? e.entry_unit : m.unit === "%" ? "%" : null), volume: e?.volume ?? null, numerator: e?.numerator ?? null, denominator: e?.denominator ?? null,
        status: e ? entryStatus(m, e) : null, due: due.has(month), notes: e?.notes ?? null, root_cause: e?.root_cause ?? null, corrective_action: e?.corrective_action ?? null, findings: e ? links.get(Number(e.id)) ?? [] : [],
      };
    });
    const entered = months.filter((x) => x.value != null).length;
    const judged = months.filter((x) => x.status != null).length;
    const met = months.filter((x) => x.status === "green").length;
    const expected = v ? expectedEntries(v.frequency, period.months) : period.months.length;
    const roll = isOrg ? rollPeriod(own.map(orgEntryOf), expected) : null;
    // The target the numbers were entered under; with no entry, the one in force at the period's end.
    const target_text = roll && v ? (roll.state === "no_entry" ? targetText(v.target, v.direction, orgUnit(v.kind, v.unit)) : roll.note === TARGET_CHANGED ? "Changed" : targetText(roll.target, roll.direction, roll.unit))
      : m.benchmark_green == null ? "Not set" : targetText(m.benchmark_green, m.direction, m.unit);
    const single = period.kind === "month" ? months[0] : null;
    const result_text = single ? (single.value == null ? "No entry" : single.status ? STATUS_WORD[single.status] : "Not judged")
      : roll ? metText(roll.met, roll.state) : entered === 0 ? "No entry" : judged === 0 ? "Not judged" : `Met ${met} of ${judged}`;
    const dept = departments.get(Number(m.department_id));
    const section = sections[m.lab_id == null ? 1 : 0];
    let group = section.departments.find((d) => d.name === (dept?.name ?? "Other"));
    if (!group) { group = { name: dept?.name ?? "Other", rows: [] }; section.departments.push(group); }
    group.rows.push({
      metric_id: m.id, name: v?.name ?? m.name, unit: v ? orgUnit(v.kind, v.unit) : m.unit ?? "", target_text, organization: isOrg ? m.org.organization_name ?? "Organization" : null,
      off_since: offSince, inactive: !m.active, months, entered, expected, met, judged,
      period: roll, period_text: roll && roll.value != null ? valueText(roll.value, roll.unit) : "", result_text,
    });
    indicators++;
    if (entered) withEntries++;
  }
  return { lab, period, sections: sections.filter((s) => s.departments.length), counts: { indicators, with_entries: withEntries, no_entry: indicators - withEntries }, generated: labToday() };
}

export function registerLabQualityReportRoutes(app: Express, deps: { base: string; read: any[] }) {
  const { base, read } = deps;
  const make = (req: any, res: any, q: any): LabReport | null => {
    const p = parsePeriod(q, ["month", "quarter", "year"]);
    if ("error" in p) { res.status(400).json({ error: p.error, code: "BAD_PERIOD" }); return null; }
    const lab = sqliteOf().prepare("SELECT id, lab_name, clia_number FROM labs WHERE id = ?").get(req.scope.labId) as any;
    return buildLabReport(sqliteOf(), labView(req), { id: lab.id, name: lab.lab_name ?? null, clia: lab.clia_number ?? null }, p.period);
  };
  app.get(`${base}/report`, ...read, (req: any, res: any) => {
    const r = make(req, res, req.query);
    if (r) res.json(r);
  });
  for (const [kind, render] of [["pdf", labReportPDF], ["xlsx", labReportExcel]] as const) {
    app.post(`${base}/report/${kind}`, ...read, async (req: any, res: any) => {
      const r = make(req, res, req.body);
      if (!r) return;
      try {
        const filename = labReportFilename(r, kind);
        res.json({ token: storePdfToken(await render(r), filename), filename });
      } catch (err: any) {
        console.error(`[veritaqa] lab report ${kind} failed:`, err?.message || err);
        res.status(500).json({ error: "The report could not be made. Try again." });
      }
    });
  }
}
