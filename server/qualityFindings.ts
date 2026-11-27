// server/qualityFindings.ts
//
// VeritaResponse findings beside a laboratory's quality indicators (B15). When a month missed its target, a VeritaQA editor can
// link a VeritaResponse entry of the same laboratory to it. A link only: nothing is opened by itself, and unlinking leaves both
// as they are. It shows on the indicator's month and on the finding (GET /api/labs/:labId/findings/:id/indicators, to someone
// who may read VeritaQA there). The finding's history and the VeritaQA audit trail both get a row.
import type { Express } from "express";
import { db } from "./db";
import { logAudit } from "./audit";
import { labView, qaRow, entryStatus } from "./veritaqaPi";
import { orgMetricStates, withOrgDefinition } from "./orgQualityStore";
import { labToday } from "./dateLocal";
import { monthKey, targetText, valueText } from "@shared/qualityIndicators";

const sqliteOf = () => (db as any).$client;

export interface FindingLink { link_id: number; entry_id: number; finding_id: number; finding_number: string | null; accreditor: string; source_type: string; standard_ref: string | null; status: string; label: string }

/** How a finding is named in a list: its number and standard, else its type and id. */
export const findingLabel = (f: any): string => {
  const by = f.accreditor && f.accreditor !== "Other" ? (f.accreditor === "ISO" ? "ISO 15189" : f.accreditor) : "";
  return [by, f.finding_number, f.standard_ref].filter(Boolean).join(" ") || `Entry ${f.finding_id ?? f.id}`;
};

/** The links of each of these entries, by entry id. A finding that is gone shows nothing. */
export function findingLinksFor(sqlite: any, labId: number, entryIds: number[]): Map<number, FindingLink[]> {
  const out = new Map<number, FindingLink[]>();
  if (!entryIds.length) return out;
  const rows = sqlite.prepare(
    `SELECT l.id AS link_id, l.entry_id, f.id AS finding_id, f.finding_number, f.accreditor, f.source_type, f.standard_ref, f.status
       FROM pi_finding_links l JOIN findings f ON f.id = l.finding_id AND f.lab_id = l.lab_id
      WHERE l.lab_id = ? AND l.entry_id IN (SELECT value FROM json_each(?)) ORDER BY l.id`
  ).all(labId, JSON.stringify(entryIds)) as any[];
  for (const r of rows) {
    const link = { ...r, label: findingLabel(r) };
    const list = out.get(Number(r.entry_id));
    if (list) list.push(link); else out.set(Number(r.entry_id), [link]);
  }
  return out;
}

export function registerQualityFindingRoutes(app: Express, deps: { base: string; read: any[]; edit: any[]; findingRead: any[] }) {
  const { base, read, edit, findingRead } = deps;

  /** An entry of one of THIS laboratory's indicators. An account-wide one has to be assigned first. */
  const labEntry = (req: any, res: any): { metric: any; entry: any } | null => {
    const sqlite = sqliteOf(), v = labView(req);
    const entry = qaRow(sqlite, v, "pi_entries", req.params.id);
    const metric = entry ? qaRow(sqlite, v, "pi_metrics", entry.metric_id) : null;
    if (!entry || !metric) { res.status(404).json({ error: "Entry not found" }); return null; }
    if (metric.lab_id == null) { res.status(409).json({ error: "This indicator is account-wide. Assign it to this laboratory before linking a finding.", code: "NOT_ASSIGNED" }); return null; }
    return { metric: withOrgDefinition(metric, orgMetricStates(sqlite, [metric]).get(Number(metric.id)), labToday().slice(0, 7)), entry };
  };
  const missed = (res: any, metric: any, entry: any): boolean => {
    const s = entryStatus(metric, entry);
    if (s === "yellow" || s === "red") return true;
    res.status(409).json({ error: "A finding is linked to a month that missed its target.", code: "TARGET_NOT_MISSED" });
    return false;
  };
  const findingInLab = (labId: number, id: unknown) => {
    const n = Number(id);
    return Number.isInteger(n) && n > 0 ? (sqliteOf().prepare("SELECT id, finding_number, accreditor, source_type, standard_ref, status FROM findings WHERE id = ? AND lab_id = ?").get(n, labId) as any) : null;
  };
  const history = (findingId: number, event: string, userId: number, payload: any) =>
    sqliteOf().prepare("INSERT INTO finding_history (finding_id, event, by_user_id, payload) VALUES (?, ?, ?, ?)").run(findingId, event, userId, JSON.stringify(payload));

  // Every link in this laboratory for a year, for the Data Entry screen.
  app.get(`${base}/finding-links`, ...read, (req: any, res: any) => {
    const year = Number(req.query.year);
    if (!Number.isInteger(year)) return res.status(400).json({ error: "year is required" });
    const ids = (sqliteOf().prepare("SELECT DISTINCT l.entry_id AS id FROM pi_finding_links l JOIN pi_entries e ON e.id = l.entry_id WHERE l.lab_id = ? AND e.year = ?").all(req.scope.labId, year) as any[]).map((r) => Number(r.id));
    res.json([...findingLinksFor(sqliteOf(), req.scope.labId, ids).values()].flat());
  });

  // What an editor can link: this laboratory's VeritaResponse entries, newest first.
  app.get(`${base}/entries/:id/finding-options`, ...edit, (req: any, res: any) => {
    const found = labEntry(req, res);
    if (!found) return;
    const term = String(req.query.q ?? "").trim();
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = sqliteOf().prepare(
      `SELECT f.id, f.finding_number, f.accreditor, f.source_type, f.standard_ref, f.status, f.due_date FROM findings f
        WHERE f.lab_id = @lab AND f.id NOT IN (SELECT finding_id FROM pi_finding_links WHERE entry_id = @entry)
          ${term ? "AND (f.finding_number LIKE @like ESCAPE '\\' OR f.standard_ref LIKE @like ESCAPE '\\' OR f.description LIKE @like ESCAPE '\\')" : ""}
        ORDER BY f.id DESC LIMIT 100`
    ).all(term ? { lab: req.scope.labId, entry: found.entry.id, like } : { lab: req.scope.labId, entry: found.entry.id }) as any[];
    res.json(rows.map((f) => ({ id: f.id, label: findingLabel(f), source_type: f.source_type, status: f.status, due_date: f.due_date ? String(f.due_date).slice(0, 10) : null })));
  });

  app.post(`${base}/entries/:id/findings`, ...edit, (req: any, res: any) => {
    const found = labEntry(req, res);
    if (!found || !missed(res, found.metric, found.entry)) return;
    const { metric, entry } = found;
    const f = findingInLab(req.scope.labId, req.body?.finding_id);
    if (!f) return res.status(404).json({ error: "That finding isn't in this laboratory." });
    const sqlite = sqliteOf();
    try {
      const id = sqlite.transaction(() => {
        const n = Number(sqlite.prepare("INSERT INTO pi_finding_links (lab_id, metric_id, entry_id, finding_id, linked_by_user_id, linked_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(req.scope.labId, metric.id, entry.id, f.id, req.userId, new Date().toISOString()).lastInsertRowid);
        history(f.id, "indicator_linked", req.userId, { metric_id: metric.id, name: metric.name, year: entry.year, month: entry.month });
        logAudit({ userId: req.userId, ownerUserId: labView(req).ownerId, module: "veritaqa", action: "create", entityType: "pi_finding_link", entityId: n, entityLabel: `${metric.name}, ${monthKey(entry.year, entry.month)} -> finding ${f.id}`, after: { metric_id: metric.id, entry_id: entry.id, finding_id: f.id, lab_id: req.scope.labId }, ipAddress: req.ip });
        return n;
      })();
      res.status(201).json({ link_id: id, entry_id: entry.id, finding_id: f.id, finding_number: f.finding_number ?? null, accreditor: f.accreditor, source_type: f.source_type, standard_ref: f.standard_ref ?? null, status: f.status, label: findingLabel(f) });
    } catch (err: any) {
      if (String(err?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "That finding is already linked to this month.", code: "ALREADY_LINKED" });
      throw err;
    }
  });

  app.delete(`${base}/entries/:id/findings/:linkId`, ...edit, (req: any, res: any) => {
    const found = labEntry(req, res);
    if (!found) return;
    const { metric, entry } = found;
    const sqlite = sqliteOf();
    const link = sqlite.prepare("SELECT * FROM pi_finding_links WHERE id = ? AND entry_id = ? AND lab_id = ?").get(Number(req.params.linkId), entry.id, req.scope.labId) as any;
    if (!link) return res.status(404).json({ error: "Link not found" });
    sqlite.transaction(() => {
      logAudit({ userId: req.userId, ownerUserId: labView(req).ownerId, module: "veritaqa", action: "delete", entityType: "pi_finding_link", entityId: link.id, entityLabel: `${metric.name}, ${monthKey(entry.year, entry.month)} -> finding ${link.finding_id}`, before: link, ipAddress: req.ip });
      sqlite.prepare("DELETE FROM pi_finding_links WHERE id = ?").run(link.id);
      if (findingInLab(req.scope.labId, link.finding_id)) history(link.finding_id, "indicator_unlinked", req.userId, { metric_id: metric.id, name: metric.name, year: entry.year, month: entry.month });
    })();
    res.json({ ok: true });
  });

  // The finding's side: the indicators' months linked to it.
  app.get("/api/labs/:labId/findings/:id/indicators", ...findingRead, (req: any, res: any) => {
    const f = findingInLab(req.scope.labId, req.params.id);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    const sqlite = sqliteOf();
    const rows = sqlite.prepare(
      `SELECT l.id AS link_id, l.linked_at, e.id AS entry_id, e.year, e.month, e.metric_id, d.name AS department
         FROM pi_finding_links l JOIN pi_entries e ON e.id = l.entry_id JOIN pi_metrics m ON m.id = e.metric_id AND m.lab_id = l.lab_id LEFT JOIN pi_departments d ON d.id = m.department_id
        WHERE l.lab_id = ? AND l.finding_id = ? ORDER BY e.year DESC, e.month DESC, l.id`
    ).all(req.scope.labId, f.id) as any[];
    const ym = labToday().slice(0, 7);
    res.json({
      indicators: rows.map((r) => {
        const raw = sqlite.prepare("SELECT * FROM pi_metrics WHERE id = ?").get(r.metric_id) as any;
        const m = withOrgDefinition(raw, orgMetricStates(sqlite, [raw]).get(Number(raw.id)), ym);
        const e = sqlite.prepare("SELECT * FROM pi_entries WHERE id = ?").get(r.entry_id) as any;
        const org = raw.org_indicator_id != null;
        return {
          link_id: r.link_id, linked_at: r.linked_at, metric_id: r.metric_id, entry_id: r.entry_id, name: m.name, department: r.department ?? null, year: r.year, month: r.month,
          value_text: valueText(e.value, org ? e.entry_unit : m.unit), target_text: org ? targetText(e.target_value, e.target_direction, e.entry_unit) : targetText(m.benchmark_green, m.direction, m.unit), status: entryStatus(m, e),
        };
      }),
    });
  });
}
