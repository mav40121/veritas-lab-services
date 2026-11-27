// server/orgQuality.ts
//
// An organization's quality indicators and the report across its laboratories (B15).
//
// Who: an active org_owner or org_admin of the organization and nobody else, the rule of the cross-lab findings list
// (GET /api/readiness/rollup/findings). The laboratories are the ones the readiness roll-up gives that person
// (rollupLabsFor) that belong to the organization, so nothing here can show a laboratory the roll-up doesn't. A roll-up group
// only takes laboratories away. Anyone else, a laboratory's own owner and Veritas support included, gets one 403 whatever the
// organization id is.
//
// What: an indicator is defined once (name, definition, what the numerator and denominator count, kind, the organization's own
// target and its direction, how often, department) and turned on for chosen laboratories; nothing is added to a laboratory by
// itself. Each laboratory enters its own numbers in its own VeritaQA (server/veritaqaPi.ts), beside its own indicators. A change
// to the definition is a new version with the month it starts in, this month or later; an entry keeps the kind and target in
// force when it was entered. Turning it off in a laboratory keeps its entries. Nothing here compares an organization with anyone
// outside it, and no target is supplied.
import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { hasOpsAccess, opsPlanOk } from "./veritabench";
import { managedOrganizations, rollupGroupsFor, rollupLabsFor, type RollupLabRow } from "./rollupGroups";
import { labDepartmentNamed } from "./veritaqaPi";
import { orgEntryOf, orgVersions, type StoredVersion } from "./orgQualityStore";
import { storePdfToken } from "./pdfTokens";
import { systemReportExcel, systemReportFilename, systemReportPDF } from "./qualityReportFiles";
import { labToday } from "./dateLocal";
import { detectPhi } from "@shared/phiPatterns";
import {
  DIRECTIONS, ORG_FREQUENCIES, ORG_INDICATOR_KINDS, TARGET_CHANGED, expectedEntries, metText, orgUnit, parsePeriod, rollPeriod, targetText, totalAcross, versionForMonth,
  type OrgIndicatorVersion, type Period, type PeriodResult, type TotalResult,
} from "@shared/qualityIndicators";

const sqliteOf = () => (db as any).$client;
const LIMITS = { name: 160, text: 2000, unit: 40, department: 120 };

class QualityError extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const trialEnded = (l: RollupLabRow) => Number(l.is_trial) === 1 && !!l.subscription_expires_at && new Date() >= new Date(l.subscription_expires_at);

/** This organization's laboratories, as the roll-up gives them to this person. A trial that has ended is closed to everyone. */
export function organizationLabs(sqlite: any, userId: number, organizationId: number): RollupLabRow[] {
  return rollupLabsFor(sqlite, userId).filter((l) => l.organization_id === organizationId && !trialEnded(l));
}

// ── The definition ──────────────────────────────────────────────────────────

const VERSION_FIELDS = ["name", "definition", "numerator_text", "denominator_text", "kind", "unit", "target", "direction", "frequency", "department"] as const;

function cleanDefinition(b: any, before: OrgIndicatorVersion | null): Omit<OrgIndicatorVersion, "version" | "effective_from"> {
  const raw = (k: (typeof VERSION_FIELDS)[number]) => (b?.[k] !== undefined ? b[k] : before ? (before as any)[k] : undefined);
  const text = (k: "name" | "definition" | "numerator_text" | "denominator_text" | "unit" | "department", max: number): string | null => {
    const s = String(raw(k) ?? "").replace(/\r\n/g, "\n").trim();
    if (!s) return null;
    if (s.length > max) throw new QualityError(400, "TOO_LONG", `That text is too long (${max} characters at most).`, { field: k });
    const phi = detectPhi(s);
    if (phi.length) throw new QualityError(400, "PHI_REFUSED", "That looks like patient information. Describe the indicator without it.", { field: k, labels: phi });
    return s;
  };
  const name = text("name", LIMITS.name);
  if (!name) throw new QualityError(400, "NAME_REQUIRED", "Give the indicator a name.");
  const department = text("department", LIMITS.department);
  if (!department) throw new QualityError(400, "DEPARTMENT_REQUIRED", "Say which department it belongs to.");
  const pick = <T extends string>(k: "kind" | "direction" | "frequency", allowed: readonly T[]): T => {
    const s = String(raw(k) ?? "") as T;
    if (!allowed.includes(s)) throw new QualityError(400, "BAD_VALUE", `${k} must be one of: ${allowed.join(", ")}.`, { field: k });
    return s;
  };
  const kind = pick("kind", ORG_INDICATOR_KINDS), direction = pick("direction", DIRECTIONS), frequency = pick("frequency", ORG_FREQUENCIES);
  const numerator_text = text("numerator_text", LIMITS.text), denominator_text = kind === "count" ? null : text("denominator_text", LIMITS.text);
  if (!numerator_text) throw new QualityError(400, "NUMERATOR_REQUIRED", kind === "count" ? "Say what is counted." : "Say what the numerator counts.");
  if (kind !== "count" && !denominator_text) throw new QualityError(400, "DENOMINATOR_REQUIRED", "Say what the denominator counts.");
  const t = raw("target");
  const target = t == null || t === "" ? null : Number(t);
  if (target != null && !Number.isFinite(target)) throw new QualityError(400, "BAD_VALUE", "The target must be a number, or blank.", { field: "target" });
  return { name, definition: text("definition", LIMITS.text), numerator_text, denominator_text, kind, unit: kind === "percent" || kind === "per_1000" ? null : text("unit", LIMITS.unit), target, direction, frequency, department };
}

const thisMonth = () => labToday().slice(0, 7);

function insertVersion(sqlite: any, indicatorId: number, version: number, effectiveFrom: string, d: ReturnType<typeof cleanDefinition>, userId: number) {
  sqlite.prepare(
    `INSERT INTO org_quality_indicator_versions (indicator_id, version, effective_from, ${VERSION_FIELDS.join(", ")}, changed_by_user_id, changed_at) VALUES (?, ?, ?, ${VERSION_FIELDS.map(() => "?").join(", ")}, ?, ?)`
  ).run(indicatorId, version, effectiveFrom, ...VERSION_FIELDS.map((f) => (d as any)[f]), userId, new Date().toISOString());
}

/** A laboratory's own row carries the definition in force now, for the screens that read it without its versions. */
function syncLabRows(sqlite: any, indicatorId: number, versions: OrgIndicatorVersion[]) {
  const v = versionForMonth(versions, thisMonth());
  if (!v) return;
  sqlite.prepare("UPDATE pi_metrics SET name = ?, unit = ?, direction = ?, benchmark_green = ?, benchmark_yellow = NULL, benchmark_red = NULL, measurement_methodology = ? WHERE org_indicator_id = ?")
    .run(v.name, orgUnit(v.kind, v.unit), v.direction, v.target, v.definition, indicatorId);
}

function loadIndicator(sqlite: any, userId: number, id: unknown): { indicator: any; versions: StoredVersion[] } {
  const n = Number(id);
  const indicator = Number.isInteger(n) && n > 0 ? (sqlite.prepare("SELECT * FROM org_quality_indicators WHERE id = ?").get(n) as any) : null;
  // The same answer for an id outside one's organizations as for one that doesn't exist.
  if (!indicator || !managedOrganizations(sqlite, userId).some((o) => o.id === indicator.organization_id)) throw new QualityError(404, "NOT_FOUND", "Indicator not found.");
  return { indicator, versions: orgVersions(sqlite, [n]).get(n) ?? [] };
}

const ownerOfOrg = (sqlite: any, organizationId: number, userId: number) => Number((sqlite.prepare("SELECT billing_owner_user_id AS u FROM organizations WHERE id = ?").get(organizationId) as any)?.u ?? userId);

function indicatorList(sqlite: any, organizationId: number, labs: RollupLabRow[]) {
  const rows = sqlite.prepare("SELECT id, created_at FROM org_quality_indicators WHERE organization_id = ? ORDER BY id").all(organizationId) as any[];
  const versions = orgVersions(sqlite, rows.map((r) => r.id));
  const visible = new Set(labs.map((l) => l.id));
  const links = sqlite.prepare(
    `SELECT ol.indicator_id, ol.lab_id, ol.turned_on_at, ol.turned_off_at, (SELECT COUNT(*) FROM pi_entries e WHERE e.metric_id = ol.metric_id) AS entries
       FROM org_quality_indicator_labs ol WHERE ol.organization_id = ?`
  ).all(organizationId) as any[];
  return rows.map((r) => {
    const all = versions.get(r.id) ?? [];
    return {
      id: r.id, organization_id: organizationId, created_at: r.created_at, current: versionForMonth(all, thisMonth()), versions: all.map(({ changed_by_user_id: _u, ...v }) => v),
      labs: links.filter((l) => l.indicator_id === r.id && visible.has(l.lab_id)).map((l) => ({ lab_id: l.lab_id, on: l.turned_off_at == null, turned_on_at: l.turned_on_at, turned_off_at: l.turned_off_at, entries: Number(l.entries) })),
    };
  }).sort((a, b) => String(a.current?.department).localeCompare(String(b.current?.department)) || String(a.current?.name).localeCompare(String(b.current?.name)) || a.id - b.id);
}

// ── The report across laboratories ───────────────────────────────────────────

export interface SystemReportRow { lab_id: number; lab_name: string; clia_number: string | null; off_since: string | null; result: PeriodResult; result_text: string; target_text: string }
export interface SystemReportIndicator {
  id: number; name: string; department: string; definition: string | null; numerator_text: string | null; denominator_text: string | null; kind: string; unit: string; frequency: string; version: number;
  changes: { version: number; effective_from: string }[]; rows: SystemReportRow[]; total: TotalResult; labs_on: number;
}
export interface SystemReport { organization: { id: number; name: string }; period: Period; group: { id: number; name: string } | null; department: string | null; labs: { lab_id: number; lab_name: string; clia_number: string | null }[]; departments: string[]; indicators: SystemReportIndicator[]; generated: string }

export function buildSystemReport(sqlite: any, o: { organization: { id: number; name: string }; labs: RollupLabRow[]; period: Period; department: string | null; group: { id: number; name: string } | null }): SystemReport {
  const ids = sqlite.prepare("SELECT id FROM org_quality_indicators WHERE organization_id = ? ORDER BY id").all(o.organization.id) as { id: number }[];
  const versions = orgVersions(sqlite, ids.map((r) => r.id));
  const links = sqlite.prepare("SELECT indicator_id, lab_id, metric_id, turned_off_at FROM org_quality_indicator_labs WHERE organization_id = ?").all(o.organization.id) as any[];
  const entries = sqlite.prepare(
    `SELECT e.metric_id, e.month, e.numerator, e.denominator, e.entry_kind, e.entry_unit, e.target_value, e.target_direction
       FROM pi_entries e JOIN org_quality_indicator_labs ol ON ol.metric_id = e.metric_id
      WHERE ol.organization_id = ? AND e.year = ? AND e.month IN (SELECT value FROM json_each(?))`
  ).all(o.organization.id, o.period.year, JSON.stringify(o.period.months)) as any[];
  const byMetric = new Map<number, any[]>();
  for (const e of entries) { const l = byMetric.get(e.metric_id); if (l) l.push(e); else byMetric.set(e.metric_id, [e]); }
  const labName = (l: RollupLabRow) => l.lab_name || l.clia_number || `Laboratory ${l.id}`;

  const indicators: SystemReportIndicator[] = [];
  const departments = new Set<string>();
  for (const { id } of ids) {
    const all = versions.get(id) ?? [];
    const v = versionForMonth(all, o.period.to);
    if (!v) continue;
    const rows: SystemReportRow[] = [];
    let labsOn = 0;
    for (const lab of o.labs) {
      const link = links.find((l) => l.indicator_id === id && l.lab_id === lab.id);
      if (!link) continue;
      const own = byMetric.get(link.metric_id) ?? [];
      const on = link.turned_off_at == null;
      if (!on && !own.length) continue;
      if (on) labsOn++;
      const result = rollPeriod(own.map(orgEntryOf), expectedEntries(v.frequency, o.period.months));
      rows.push({
        lab_id: lab.id, lab_name: labName(lab), clia_number: lab.clia_number ?? null, off_since: on ? null : String(link.turned_off_at).slice(0, 10), result,
        result_text: metText(result.met, result.state),
        // The target the numbers were entered under; with no entry, the one in force at the period's end.
        target_text: result.state === "no_entry" ? targetText(v.target, v.direction, orgUnit(v.kind, v.unit)) : result.note === TARGET_CHANGED ? "Changed" : targetText(result.target, result.direction, result.unit),
      });
    }
    if (!rows.length) continue;
    departments.add(v.department);
    if (o.department && v.department !== o.department) continue;
    indicators.push({
      id, name: v.name, department: v.department, definition: v.definition, numerator_text: v.numerator_text, denominator_text: v.denominator_text, kind: v.kind, unit: orgUnit(v.kind, v.unit), frequency: v.frequency, version: v.version,
      changes: all.filter((x) => x.version > 1 && x.effective_from >= o.period.from && x.effective_from <= o.period.to).map((x) => ({ version: x.version, effective_from: x.effective_from })),
      rows, total: totalAcross(rows.map((r) => r.result)), labs_on: labsOn,
    });
  }
  indicators.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name) || a.id - b.id);
  return {
    organization: o.organization, period: o.period, group: o.group, department: o.department,
    labs: o.labs.map((l) => ({ lab_id: l.id, lab_name: labName(l), clia_number: l.clia_number ?? null })), departments: [...departments].sort(), indicators, generated: labToday(),
  };
}

// ── Routes ──────────────────────────────────────────────────────────────────

export function registerOrgQualityRoutes(app: Express, deps: { authMiddleware: any; requireWriteAccess: any }) {
  const { authMiddleware, requireWriteAccess } = deps;

  const run = (fn: (sqlite: any, req: any) => any, status = 200) => async (req: any, res: any) => {
    try {
      const out = await fn(sqliteOf(), req);
      res.status(status).json(out);
    } catch (err: any) {
      if (err instanceof QualityError) return res.status(err.status).json({ error: err.message, code: err.code, ...err.extra });
      console.error("[org-quality] failed:", err?.message || err);
      res.status(500).json({ error: "That didn't work. Try again." });
    }
  };

  /** The organization in the request, when this person runs it and its plan (or theirs) includes VeritaQA. */
  function leader(sqlite: any, req: any, raw: unknown): { organization: { id: number; name: string }; labs: RollupLabRow[] } {
    const id = Number(raw);
    const organization = managedOrganizations(sqlite, req.userId).find((o) => o.id === id);
    if (!organization) throw new QualityError(403, "SYSTEM_LEADER_ONLY", "This is for the owner or an admin of a system of laboratories.");
    requirePlan(sqlite, req, organization.id);
    return { organization, labs: organizationLabs(sqlite, req.userId, organization.id) };
  }
  function requirePlan(sqlite: any, req: any, organizationId: number) {
    const plan = (sqlite.prepare("SELECT plan FROM organizations WHERE id = ?").get(organizationId) as any)?.plan ?? null;
    if (!hasOpsAccess(req.user, req.scope?.lab) && !opsPlanOk(plan)) throw new QualityError(403, "PLAN_REQUIRED", "VeritaQA™ requires a suite subscription");
  }

  // The organizations this person runs, with their laboratories and indicators.
  app.get("/api/org-quality/overview", authMiddleware, run((sqlite, req) => {
    const orgs = managedOrganizations(sqlite, req.userId);
    if (!orgs.length) throw new QualityError(403, "SYSTEM_LEADER_ONLY", "This is for the owner or an admin of a system of laboratories.");
    const retired = new Set((sqlite.prepare("SELECT id FROM labs WHERE retired_at IS NOT NULL").all() as { id: number }[]).map((r) => r.id));
    return {
      organizations: orgs.map((o) => {
        requirePlan(sqlite, req, o.id);
        const labs = organizationLabs(sqlite, req.userId, o.id);
        return { id: o.id, name: o.name, labs: labs.map((l) => ({ lab_id: l.id, lab_name: l.lab_name, clia_number: l.clia_number, can_turn_on: !retired.has(l.id) })), indicators: indicatorList(sqlite, o.id, labs) };
      }),
    };
  }));

  app.post("/api/org-quality/indicators", authMiddleware, requireWriteAccess, run((sqlite, req) => {
    const { organization } = leader(sqlite, req, req.body?.organizationId);
    const d = cleanDefinition(req.body, null);
    const id = sqlite.transaction(() => {
      const n = Number(sqlite.prepare("INSERT INTO org_quality_indicators (organization_id, created_by_user_id, created_at) VALUES (?, ?, ?)").run(organization.id, req.userId, new Date().toISOString()).lastInsertRowid);
      insertVersion(sqlite, n, 1, thisMonth(), d, req.userId);
      logAudit({ userId: req.userId, ownerUserId: ownerOfOrg(sqlite, organization.id, req.userId), module: "veritaqa", action: "create", entityType: "org_quality_indicator", entityId: n, entityLabel: d.name, after: { organization_id: organization.id, version: 1, effective_from: thisMonth(), ...d }, ipAddress: req.ip });
      return n;
    })();
    return { id };
  }, 201));

  // A change is a new version. It starts this month or later, never before the newest one.
  app.put("/api/org-quality/indicators/:id", authMiddleware, requireWriteAccess, run((sqlite, req) => {
    const { indicator, versions } = loadIndicator(sqlite, req.userId, req.params.id);
    requirePlan(sqlite, req, indicator.organization_id);
    const last = versions[versions.length - 1];
    const d = cleanDefinition(req.body, last);
    const from = String(req.body?.effective_from ?? thisMonth());
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from)) throw new QualityError(400, "BAD_MONTH", "Pick the month the change starts in.", { field: "effective_from" });
    if (from < thisMonth()) throw new QualityError(400, "MONTH_PAST", "A change starts this month or later, so months already entered keep the target they were entered under.", { field: "effective_from" });
    if (from < last.effective_from) throw new QualityError(400, "MONTH_BEFORE_LAST", `The newest version starts in ${last.effective_from}. Pick that month or a later one.`, { field: "effective_from" });
    if (VERSION_FIELDS.every((f) => ((last as any)[f] ?? null) === ((d as any)[f] ?? null))) throw new QualityError(400, "NO_CHANGE", "Nothing changed.");
    sqlite.transaction(() => {
      insertVersion(sqlite, indicator.id, last.version + 1, from, d, req.userId);
      syncLabRows(sqlite, indicator.id, orgVersions(sqlite, [indicator.id]).get(indicator.id) ?? []);
      const { indicator_id: _i, changed_at: _c, changed_by_user_id: _u, ...before } = last;
      logAudit({ userId: req.userId, ownerUserId: ownerOfOrg(sqlite, indicator.organization_id, req.userId), module: "veritaqa", action: "update", entityType: "org_quality_indicator", entityId: indicator.id, entityLabel: `${d.name}, version ${last.version + 1} from ${from}`, before, after: { version: last.version + 1, effective_from: from, ...d }, ipAddress: req.ip });
    })();
    return { id: indicator.id, version: last.version + 1, effective_from: from };
  }));

  // Which of the organization's laboratories it is on in. Labs this person doesn't see are left as they are.
  app.put("/api/org-quality/indicators/:id/labs", authMiddleware, requireWriteAccess, run((sqlite, req) => {
    const { indicator, versions } = loadIndicator(sqlite, req.userId, req.params.id);
    const { labs } = leader(sqlite, req, indicator.organization_id);
    if (!Array.isArray(req.body?.labIds)) throw new QualityError(400, "LAB_IDS_REQUIRED", "labIds must be a list of laboratory ids.");
    const wanted = new Set<number>(req.body.labIds.map(Number));
    const eligible = new Map(labs.map((l) => [l.id, l]));
    const bad = [...wanted].filter((id) => !eligible.has(id));
    if (bad.length) throw new QualityError(400, "LAB_NOT_ELIGIBLE", "An indicator is turned on only in laboratories of its own organization.", { labIds: bad });
    const links = new Map((sqlite.prepare("SELECT * FROM org_quality_indicator_labs WHERE indicator_id = ?").all(indicator.id) as any[]).map((l) => [Number(l.lab_id), l]));
    const v = versionForMonth(versions, thisMonth())!;
    const turnedOn: number[] = [], turnedOff: number[] = [];
    const now = new Date().toISOString();
    sqlite.transaction(() => {
      for (const lab of labs) {
        const link = links.get(lab.id);
        const on = !!link && link.turned_off_at == null;
        const row = sqlite.prepare("SELECT owner_user_id, retired_at FROM labs WHERE id = ?").get(lab.id) as any;
        const trail = (action: "create" | "update", label: string, before: unknown, after: unknown) => logAudit({ userId: req.userId, ownerUserId: Number(row.owner_user_id ?? req.userId), module: "veritaqa", action, entityType: "org_quality_indicator_lab", entityId: indicator.id, entityLabel: label, before, after, ipAddress: req.ip });
        if (wanted.has(lab.id) && !on) {
          if (row.retired_at) throw new QualityError(400, "LAB_NOT_ELIGIBLE", "A retired laboratory can't be turned on.", { labIds: [lab.id] });
          let metricId = link ? Number(link.metric_id) : 0;
          if (link) {
            sqlite.prepare("UPDATE org_quality_indicator_labs SET turned_on_at = ?, turned_on_by_user_id = ?, turned_off_at = NULL, turned_off_by_user_id = NULL WHERE id = ?").run(now, req.userId, link.id);
            sqlite.prepare("UPDATE pi_metrics SET active = 1 WHERE id = ?").run(metricId);
          } else {
            const departmentId = labDepartmentNamed(sqlite, lab.id, Number(row.owner_user_id ?? req.userId), v.department, 0);
            metricId = Number(sqlite.prepare(
              "INSERT INTO pi_metrics (department_id, account_id, lab_id, org_indicator_id, name, unit, direction, benchmark_green, sort_order, active, created_at, measurement_methodology, is_tat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, 0)"
            ).run(departmentId, Number(row.owner_user_id ?? req.userId), lab.id, indicator.id, v.name, orgUnit(v.kind, v.unit), v.direction, v.target, now, v.definition).lastInsertRowid);
            sqlite.prepare("INSERT INTO org_quality_indicator_labs (indicator_id, organization_id, lab_id, metric_id, turned_on_at, turned_on_by_user_id) VALUES (?, ?, ?, ?, ?, ?)").run(indicator.id, indicator.organization_id, lab.id, metricId, now, req.userId);
          }
          turnedOn.push(lab.id);
          trail(link ? "update" : "create", `${v.name}: turned on`, { on: false }, { on: true, lab_id: lab.id, metric_id: metricId });
        } else if (!wanted.has(lab.id) && on) {
          sqlite.prepare("UPDATE org_quality_indicator_labs SET turned_off_at = ?, turned_off_by_user_id = ? WHERE id = ?").run(now, req.userId, link.id);
          sqlite.prepare("UPDATE pi_metrics SET active = 0 WHERE id = ?").run(link.metric_id);
          turnedOff.push(lab.id);
          trail("update", `${v.name}: turned off, its entries are kept`, { on: true }, { on: false, lab_id: lab.id, metric_id: Number(link.metric_id) });
        }
      }
    })();
    return { id: indicator.id, turned_on: turnedOn, turned_off: turnedOff };
  }));

  function report(sqlite: any, req: any, q: any): SystemReport {
    const { organization, labs } = leader(sqlite, req, q?.organizationId);
    const p = parsePeriod(q);
    if ("error" in p) throw new QualityError(400, "BAD_PERIOD", p.error);
    let group: { id: number; name: string } | null = null;
    let shown = labs;
    if (q?.groupId != null && q.groupId !== "") {
      const g = rollupGroupsFor(sqlite, req.userId).groups.find((x) => x.id === Number(q.groupId));
      if (!g) throw new QualityError(404, "NOT_FOUND", "Group not found.");
      const ids = new Set(g.lab_ids);
      shown = labs.filter((l) => ids.has(l.id));
      group = { id: g.id, name: g.name };
    }
    return buildSystemReport(sqlite, { organization, labs: shown, period: p.period, department: q?.department ? String(q.department) : null, group });
  }
  app.get("/api/org-quality/report", authMiddleware, run((sqlite, req) => report(sqlite, req, req.query)));
  app.post("/api/org-quality/report/pdf", authMiddleware, run(async (sqlite, req) => {
    const r = report(sqlite, req, req.body);
    return { token: storePdfToken(await systemReportPDF(r), systemReportFilename(r, "pdf")), filename: systemReportFilename(r, "pdf") };
  }));
  app.post("/api/org-quality/report/xlsx", authMiddleware, run(async (sqlite, req) => {
    const r = report(sqlite, req, req.body);
    return { token: storePdfToken(await systemReportExcel(r), systemReportFilename(r, "xlsx")), filename: systemReportFilename(r, "xlsx") };
  }));
}
