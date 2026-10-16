// server/exportAll.ts
//
// "Download all of this lab's records" (exit terms; Michael 2026-10-16, Q47 = 1 and Q50 = 1, version 1).
// The lab OWNER starts a background job that builds one zip:
//   Index.xlsx                     what is in the zip, and what is not
//   Records/<Module> records.xlsx  every row the lab owns, one sheet per table (server/exportAllTables.ts)
//   Records/JSON/<table>.json      the same rows, full fidelity, for moving the data into another system
//   Files/...                      stored files: policy documents (every version) and uploaded attachments
//   Reports/<Module>/...           the app's own exports (maps, coverage, scans, competency bundle, QC reviews,
//                                  IQCP plans, delegations, registers, policy master list), fetched over loopback
// It works after a subscription ends or a trial expires (BUG-067): the job's own loopback requests pass the plan
// gates (server/exportAllContext.ts). The finished zip is kept on the volume for 24 hours. VeritaCheck study PDFs
// are version 2 (they are built in the browser today).

import fs from "fs";
import path from "path";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { EXPORT_TABLES, TRANSIENT_TABLE, DROPPED_COLUMN } from "./exportAllTables";
import { registerExportSecret, revokeExportSecret } from "./exportAllContext";
import { resolveVersionFilePath } from "./veritapolicyApproval";
import { SCAN_ITEMS } from "../client/src/lib/veritaScanData";
import { logAudit } from "./audit";
import { issuePurposeToken, verifyPurposeToken } from "./sessionAuth";

export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function exportDir(): string {
  if (process.env.EXPORT_ALL_DIR) return process.env.EXPORT_ALL_DIR;
  if (process.env.DB_PATH) return path.join(path.dirname(path.resolve(process.env.DB_PATH)), "exports");
  return fs.existsSync("/data") ? "/data/exports" : path.resolve("exports");
}

export interface ExportCtx {
  labId: number;
  ownerUserId: number;
  staffLabId: number;
  lab: any;
}

// staff_labs resolution mirrors staffLabByLabId in routes.ts: the staff lab paired to this lab, else the owner's
// only staff lab. -1 when there is none (matches no rows).
export function exportContext(sqlite: any, labId: number): ExportCtx | null {
  const lab = sqlite.prepare("SELECT * FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const ownerUserId = Number(lab.owner_user_id);
  let staffLab = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
  if (!staffLab) {
    const rows = sqlite.prepare("SELECT id FROM staff_labs WHERE user_id = ?").all(ownerUserId) as any[];
    staffLab = rows.length === 1 ? rows[0] : null;
  }
  return { labId, ownerUserId, staffLabId: staffLab ? Number(staffLab.id) : -1, lab };
}

/** Tables in the database that exportAllTables.ts does not classify (must be empty; pinned by the test). */
export function unclassifiedTables(sqlite: any): string[] {
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((r) => r.name);
  return names.filter((n) => !EXPORT_TABLES[n] && !TRANSIENT_TABLE.test(n)).sort();
}

function whereFor(table: string, depth = 0): string {
  const spec = EXPORT_TABLES[table];
  if (!spec) throw new Error(`export-all: table ${table} is not classified`);
  if (depth > 6) throw new Error(`export-all: parent chain too deep at ${table}`);
  const s = spec.scope;
  switch (s.kind) {
    case "lab": return "lab_id = @labId";
    case "labOrOwner": return `(lab_id = @labId OR (lab_id IS NULL AND "${s.ownerColumn}" = @ownerUserId))`;
    case "owner": return `"${s.ownerColumn}" = @ownerUserId`;
    case "staffLab": return "lab_id = @staffLabId";
    case "child": return `"${s.column}" IN (SELECT id FROM "${s.parent}" WHERE ${whereFor(s.parent, depth + 1)})`;
    case "sql": return `(${s.where})`;
    case "exclude": throw new Error(`export-all: ${table} is excluded`);
  }
}

function paramsFor(sql: string, ctx: ExportCtx): Record<string, number> {
  const all: Record<string, number> = { labId: ctx.labId, ownerUserId: ctx.ownerUserId, staffLabId: ctx.staffLabId };
  const used: Record<string, number> = {};
  for (const m of sql.matchAll(/@(\w+)/g)) used[m[1]] = all[m[1]];
  return used;
}

// Removes sign-in secrets that older audit rows may carry inside JSON text (e.g. an invite_token in a membership snapshot).
function scrubJsonText(v: any): any {
  if (typeof v !== "string" || v.length < 2 || (v[0] !== "{" && v[0] !== "[")) return v;
  let parsed: any;
  try { parsed = JSON.parse(v); } catch { return v; }
  let changed = false;
  const walk = (x: any): any => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const o: any = {};
      for (const [k, val] of Object.entries(x)) {
        if (DROPPED_COLUMN.test(k)) { o[k] = "[removed]"; changed = true; } else o[k] = walk(val);
      }
      return o;
    }
    return x;
  };
  const out = walk(parsed);
  return changed ? JSON.stringify(out) : v;
}

export interface TableRecords { table: string; module: string; columns: string[]; rows: any[] }

/** Every row of one table that belongs to the lab, with secret columns dropped. null for excluded tables. */
export function selectRecords(sqlite: any, table: string, ctx: ExportCtx): TableRecords | null {
  const spec = EXPORT_TABLES[table];
  if (!spec || spec.scope.kind === "exclude") return null;
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) return null;
  let columns = (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any[]).map((c) => c.name as string);
  const only = spec.scope.kind === "sql" ? spec.scope.columns : undefined;
  if (only) columns = columns.filter((c) => only.includes(c));
  columns = columns.filter((c) => !DROPPED_COLUMN.test(c));
  const where = whereFor(table);
  const sql = `SELECT ${columns.map((c) => `"${c}"`).join(", ")} FROM "${table}" WHERE ${where} ORDER BY 1`;
  const rows = (sqlite.prepare(sql).all(paramsFor(sql, ctx)) as any[]).map((r) => {
    for (const c of columns) r[c] = scrubJsonText(r[c]);
    return r;
  });
  return { table, module: spec.module, columns, rows };
}

const safeName = (s: string, max = 80) =>
  String(s || "").replace(/[\\/:*?"<>|\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) || "file";

// ── Reports fetched from the app's own export routes ──────────────────────────────────────────────────────

interface ReportCall { module: string; what: string; method: "GET" | "POST"; path: string; body?: any; fallbackName: string }

function reportCalls(sqlite: any, ctx: ExportCtx): ReportCall[] {
  const L = ctx.labId;
  const calls: ReportCall[] = [];
  const ids = (sql: string, ...p: any[]) => (sqlite.prepare(sql).all(...p) as any[]);
  const referenceItems = (SCAN_ITEMS as any[]).map((it) => ({ id: it.id, domain: it.domain, question: it.question, tjc: it.tjc, cap: it.cap, cfr: it.cfr, aabb: it.aabb, cola: it.cola }));

  calls.push({ module: "VeritaMap", what: "Coverage report", method: "GET", path: `/api/labs/${L}/veritamap/coverage-report.xlsx`, fallbackName: "VeritaMap_Coverage_Report.xlsx" });
  for (const m of ids("SELECT id, name FROM veritamap_maps WHERE lab_id = ?", L)) {
    calls.push({ module: "VeritaMap", what: `Map: ${m.name || m.id}`, method: "POST", path: `/api/labs/${L}/veritamap/maps/${m.id}/excel`, body: {}, fallbackName: `VeritaMap_${safeName(m.name || String(m.id), 40)}.xlsx` });
  }
  calls.push({ module: "VeritaCheck", what: "Coverage", method: "GET", path: `/api/labs/${L}/veritacheck/coverage/export`, fallbackName: "VeritaCheck_Coverage.xlsx" });
  calls.push({ module: "VeritaScan", what: "Document library", method: "GET", path: `/api/labs/${L}/veritascan/documents/export.xlsx`, fallbackName: "VeritaScan_Document_Library.xlsx" });
  for (const s of ids("SELECT id, name FROM veritascan_scans WHERE lab_id = ?", L)) {
    calls.push({ module: "VeritaScan", what: `Scan workbook: ${s.name || s.id}`, method: "POST", path: `/api/labs/${L}/veritascan/excel/${s.id}`, body: { referenceItems }, fallbackName: `VeritaScan_${safeName(s.name || String(s.id), 40)}.xlsx` });
    calls.push({ module: "VeritaScan", what: `Scan report: ${s.name || s.id}`, method: "POST", path: `/api/labs/${L}/veritascan/pdf/${s.id}/full`, body: { referenceItems }, fallbackName: `VeritaScan_${safeName(s.name || String(s.id), 40)}.pdf` });
  }
  calls.push({ module: "VeritaComp", what: "Survey Bundle (all signed competencies)", method: "POST", path: `/api/labs/${L}/competency/survey-bundle`, body: { periodMonths: null }, fallbackName: "VeritaComp_Survey_Bundle.zip" });
  for (const d of ids("SELECT id, delegate_name FROM director_delegations WHERE lab_id = ?", L)) {
    calls.push({ module: "VeritaComp", what: `Letter of Delegation: ${d.delegate_name || d.id}`, method: "GET", path: `/api/labs/${L}/director-delegations/${d.id}/pdf`, fallbackName: `Letter_of_Delegation_${d.id}.pdf` });
  }
  calls.push({ module: "VeritaStaff", what: "Testing personnel competency register", method: "GET", path: `/api/labs/${L}/staff/competency-register.xlsx`, fallbackName: "VeritaStaff_Competency_Register.xlsx" });
  calls.push({ module: "VeritaPolicy", what: "Policy master list", method: "GET", path: `/api/labs/${L}/veritapolicy/master-list/excel`, fallbackName: "VeritaPolicy_Master_List.xlsx" });
  for (const r of ids("SELECT DISTINCT control_lot_id, period_year, period_month FROM qc_period_reviews WHERE lab_id = ?", L)) {
    calls.push({ module: "VeritaQC", what: `Monthly review ${r.period_year}-${String(r.period_month).padStart(2, "0")}, lot ${r.control_lot_id}`, method: "GET", path: `/api/labs/${L}/qc/period-reviews/pdf?control_lot_id=${r.control_lot_id}&year=${r.period_year}&month=${r.period_month}`, fallbackName: `VeritaQC_Review_${r.control_lot_id}_${r.period_year}-${r.period_month}.pdf` });
  }
  for (const p of ids("SELECT id FROM iqcp_plans WHERE lab_id = ?", L)) {
    calls.push({ module: "VeritaQC", what: `IQCP plan ${p.id}`, method: "GET", path: `/api/labs/${L}/iqcp/plans/${p.id}/pdf`, fallbackName: `IQCP_Plan_${p.id}.pdf` });
  }
  if (ids("SELECT id FROM cms116_drafts WHERE lab_id = ?", L).length) {
    calls.push({ module: "VeritaLab", what: "CMS-116 draft", method: "GET", path: `/api/labs/${L}/veritalab/cms116-draft/pdf`, fallbackName: "CMS-116_Draft.pdf" });
  }
  return calls;
}

function filenameFrom(res: Response, fallback: string): string {
  const cd = res.headers.get("content-disposition") || "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) { try { return safeName(decodeURIComponent(star[1]), 120); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return safeName(plain ? plain[1] : fallback, 120);
}

async function fetchReport(base: string, headers: Record<string, string>, call: ReportCall): Promise<{ name: string; buf: Buffer } | { error: string }> {
  try {
    const res = await fetch(base + call.path, {
      method: call.method,
      headers: { ...headers, ...(call.body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: call.body !== undefined ? JSON.stringify(call.body) : undefined,
      signal: AbortSignal.timeout(180_000),
    });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) {
      const j: any = await res.json().catch(() => ({}));
      // 404 from these routes means the lab has nothing of that kind yet (e.g. no signed competencies).
      if (res.status === 404) return { error: `NONE:${j.error || "nothing to include"}` };
      return { error: `${res.status} ${j.error || ""}`.trim() };
    }
    if (type.includes("application/json")) {
      // Routes that hand the browser a one-time download token.
      const j: any = await res.json().catch(() => ({}));
      if (!j.token) return { error: "no file returned" };
      const f = await fetch(`${base}/api/pdf/${encodeURIComponent(j.token)}`, { signal: AbortSignal.timeout(180_000) });
      if (!f.ok) return { error: `download ${f.status}` };
      return { name: j.filename ? safeName(j.filename, 120) : filenameFrom(f, call.fallbackName), buf: Buffer.from(await f.arrayBuffer()) };
    }
    return { name: filenameFrom(res, call.fallbackName), buf: Buffer.from(await res.arrayBuffer()) };
  } catch (e: any) {
    return { error: e?.name === "TimeoutError" ? "timed out" : (e?.message || "failed") };
  }
}

// ── Workbooks ─────────────────────────────────────────────────────────────────────────────────────────────

const TEAL = "FF01696F", TINT = "FFE6F2F2", ACCENT = "FF0A3A3D", INK = "FF28251D", ALT = "FFEBF3F8";
const thin: any = { style: "thin", color: { argb: "FFD0D0D0" } };
const BORDER: any = { top: thin, bottom: thin, left: thin, right: thin };
const PROTECT: any = {
  selectLockedCells: true, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false,
  insertRows: false, insertColumns: false, insertHyperlinks: false, deleteRows: false, deleteColumns: false,
  sort: true, autoFilter: true, pivotTables: false,
};
const CELL_MAX = 32000;

// What each records workbook holds, written per module.
const MODULE_ABOUT: Record<string, string> = {
  "Lab and members": "The lab's profile, its members and seats (name, email, role, status), and onboarding checks. Sign-in secrets and invite links are not included.",
  "Audit trail": "The change history: the lab's own audit log, the account audit log for the lab owner's account, and any Veritas support access to this lab.",
  "VeritaCheck": "Every study (data points, settings, verdicts, sign-offs, amendments), instrument verifications and their analytes, sign-off groups, and CUMSUM trackers.",
  "VeritaMap": "Every map: instruments, the test menu with complexity, reference ranges and critical values by age and sex band, reportable ranges, correlations, and instrument requests.",
  "VeritaScan": "Every readiness scan and its answers, custom questions, the document library, and the links between documents and checklist items.",
  "VeritaComp": "Competency programs, assessments and every element entry, checklists, method groups, method sign-offs, quizzes and results, reminders, and letters of delegation.",
  "VeritaStaff": "The testing personnel roster, roles and specialties, assigned test systems, documents, competency schedules, duty changes, position descriptions, Staff Portal signatures, and continuing-education profiles.",
  "VeritaPolicy": "Manuals, documents and every version, approval workflows and steps, sign-offs, read attestations, quizzes, notes, links, surveyor links, review reminders, and the policy master list status.",
  "VeritaQC": "Control lots, every QC result, rule violations, corrective actions, notes, monthly reviews, rule settings, import mappings, and IQCP plans with their risk, QC plan and QA items.",
  "VeritaPT": "PT enrollments, events and results, corrective actions, reminders, and alternative assessment records.",
  "VeritaLab": "Certificates and their uploaded documents, reminders, the CMS-116 draft, director history, site contacts, test menu changes, and CLIA fee payments.",
  "VeritaTrack": "Tracked tasks, every sign-off, the task audit trail, and reminder settings.",
  "VeritaResponse": "Findings and investigations, attachments, history, extension requests, effectiveness checks, and reminders.",
  "VeritaMaintain": "Equipment, maintenance events, reminders, temperature-monitored units, and every temperature reading.",
  "VeritaStock": "Items, lots, counts, receipts, consumption, waste, monthly snapshots, lots in use, transfers, scans, vendors and contacts, recalls, and the export configuration.",
  "VeritaBench": "Productivity months and forecasts, staffing studies with their hourly data, and staffing grid lines.",
  "VeritaOps": "Cost-per-reportable-test studies.",
  "VeritaQA": "Performance-improvement departments, metrics, monthly entries, and the PI plan with priorities and reviews.",
  "VeritaShift": "Scheduler settings, shift definitions, department requirements, schedule periods, and assignments.",
};

function stampSheet(ws: any, idLine: string) {
  ws.headerFooter = { oddHeader: `&R${idLine}`, oddFooter: `&L${idLine}&RPage &P of &N` };
}

function addAbout(wb: any, title: string, idLine: string, paras: Array<[string, "h" | "p"]>) {
  const about = wb.addWorksheet("About");
  stampSheet(about, idLine);
  about.getColumn(1).width = 110;
  let r = 1;
  const put = (text: string, kind: "title" | "id" | "h" | "p") => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    if (kind === "title") {
      c.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
      c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      about.getRow(r).height = 30;
    } else if (kind === "id" || kind === "h") {
      c.font = { name: "Calibri", bold: true, size: kind === "id" ? 11 : 12, color: { argb: ACCENT } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TINT } };
      about.getRow(r).height = 22;
    } else {
      c.font = { name: "Calibri", size: 11, color: { argb: INK } };
      about.getRow(r).height = Math.max(1, Math.ceil(text.length / 92)) * 16 + 4;
    }
    r += 1;
  };
  put(title, "title");
  put(idLine, "id");
  for (const [t, k] of paras) put(t, k);
  return about;
}

function addTableSheet(wb: any, name: string, columns: string[], rows: any[], idLine: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 1 }] });
  stampSheet(ws, idLine);
  ws.columns = columns.map((c) => ({ header: c, key: c, width: Math.min(40, Math.max(10, c.length + 2)) }));
  const hr = ws.getRow(1);
  hr.height = 20;
  hr.eachCell((c: any) => {
    c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.alignment = { vertical: "middle", wrapText: true };
    c.border = BORDER;
  });
  rows.forEach((row, i) => {
    const vals = columns.map((c) => {
      const v = row[c];
      if (v === null || v === undefined) return null;
      if (typeof v === "string" && v.length > CELL_MAX) return v.slice(0, CELL_MAX) + " [continues in the JSON copy]";
      return v;
    });
    const xr = ws.addRow(vals);
    xr.eachCell({ includeEmpty: true }, (c: any) => {
      c.font = { name: "Calibri", size: 10, color: { argb: INK } };
      c.alignment = { vertical: "middle", wrapText: true };
      c.border = BORDER;
      if (i % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT } };
    });
  });
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
}

// ── The job ───────────────────────────────────────────────────────────────────────────────────────────────

export interface ExportJob {
  id: string;
  labId: number;
  userId: number;
  status: "running" | "done" | "failed";
  step: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  filename?: string;
  size?: number;
}

const jobs = new Map<string, ExportJob>();
const runningByLab = new Map<number, string>();

export function cleanupExports(now = Date.now()): number {
  const dir = exportDir();
  let removed = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const sub of fs.readdirSync(dir)) {
    const p = path.join(dir, sub);
    if (!fs.statSync(p).isDirectory()) continue;
    for (const f of fs.readdirSync(p)) {
      const fp = path.join(p, f);
      try { if (now - fs.statSync(fp).mtimeMs > EXPORT_RETENTION_MS) { fs.unlinkSync(fp); removed++; } } catch { /* ignore */ }
    }
  }
  return removed;
}

export function readyExports(labId: number): Array<{ id: string; filename: string; size: number; createdAt: string; expiresAt: string }> {
  const p = path.join(exportDir(), `lab-${labId}`);
  if (!fs.existsSync(p)) return [];
  const out: any[] = [];
  for (const f of fs.readdirSync(p)) {
    if (!f.endsWith(".json")) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(p, f), "utf-8"));
      const zip = path.join(p, `${meta.id}.zip`);
      if (!fs.existsSync(zip)) continue;
      const created = new Date(meta.createdAt).getTime();
      if (Date.now() - created > EXPORT_RETENTION_MS) continue;
      out.push({ id: meta.id, filename: meta.filename, size: fs.statSync(zip).size, createdAt: meta.createdAt, expiresAt: new Date(created + EXPORT_RETENTION_MS).toISOString() });
    } catch { /* ignore a bad sidecar */ }
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function zipPathFor(labId: number, jobId: string): string {
  if (!/^[a-f0-9]{24}$/.test(jobId)) throw new Error("bad export id");
  return path.join(exportDir(), `lab-${labId}`, `${jobId}.zip`);
}

export async function buildExportZip(sqlite: any, ctx: ExportCtx, opts: { base: string; job: ExportJob }): Promise<{ file: string; filename: string; size: number }> {
  const { default: ExcelJS } = await import("exceljs");
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const job = opts.job;
  const labName = ctx.lab.lab_name || "Laboratory";
  const clia = ctx.lab.clia_number || "Not on file";
  const idLine = `${labName}    CLIA: ${clia}`;
  const today = new Date().toISOString().slice(0, 10);
  const protectPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const manifest: Array<{ folder: string; file: string; what: string; count: string; status: string }> = [];

  // 1) Records
  job.step = "Collecting records";
  const byModule = new Map<string, TableRecords[]>();
  for (const table of Object.keys(EXPORT_TABLES).sort()) {
    const rec = selectRecords(sqlite, table, ctx);
    if (!rec) continue;
    if (!byModule.has(rec.module)) byModule.set(rec.module, []);
    byModule.get(rec.module)!.push(rec);
  }

  // Uploaded files stored inside rows (BLOB columns) go to Files/, and the cell names the file.
  job.step = "Writing uploaded files";
  for (const [module, recs] of byModule) {
    for (const rec of recs) {
      for (const col of rec.columns) {
        for (const row of rec.rows) {
          const v = row[col];
          if (!Buffer.isBuffer(v)) continue;
          const nm = safeName(row.original_filename || row.file_name || row.filename || `${col}.bin`, 80);
          const rel = `Files/${module}/${rec.table}/${row.id ?? "row"} ${nm}`;
          zip.file(rel, v);
          manifest.push({ folder: `Files/${module}`, file: rel.split("/").pop()!, what: `Uploaded file (${rec.table})`, count: `${v.length} bytes`, status: "Included" });
          row[col] = `See ${rel}`;
        }
      }
    }
  }

  // Policy documents: every version's stored file.
  job.step = "Adding policy documents";
  const versions = sqlite.prepare(`
    SELECT v.id, v.version_number, v.file_path, v.file_format, d.id AS doc_id, d.title
    FROM policy_versions v JOIN policy_documents d ON d.id = v.document_id
    WHERE d.lab_id = ? ORDER BY d.id, v.version_number`).all(ctx.labId) as any[];
  for (const v of versions) {
    const rel = `Files/VeritaPolicy/${v.doc_id} ${safeName(v.title, 60)}/v${v.version_number}.${safeName(v.file_format || "bin", 8)}`;
    let status = "Included";
    try {
      const abs = v.file_path ? resolveVersionFilePath(v.file_path) : "";
      if (abs && fs.existsSync(abs)) zip.file(rel, fs.readFileSync(abs));
      else status = "File not found in storage";
    } catch { status = "File could not be read"; }
    manifest.push({ folder: "Files/VeritaPolicy", file: rel.split("/").slice(2).join("/"), what: `Policy document version ${v.version_number}`, count: "", status });
  }

  job.step = "Writing records workbooks";
  for (const [module, allRecs] of [...byModule.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Only tables with rows get a sheet; the About sheet names the empty ones.
    const recs = allRecs.filter((r) => r.rows.length > 0);
    const empty = allRecs.filter((r) => r.rows.length === 0).map((r) => r.table);
    if (!recs.length) {
      manifest.push({ folder: "Records", file: "", what: `${module}: no records`, count: "0 rows", status: "Nothing to include" });
      continue;
    }
    const wb = new ExcelJS.Workbook();
    wb.creator = "Perplexity Computer";
    wb.created = new Date();
    const total = recs.reduce((a, r) => a + r.rows.length, 0);
    const about = addAbout(wb, `VeritaAssure™ | ${module} records`, `Prepared for: ${labName}    CLIA: ${clia}    Exported: ${today}`, [
      [MODULE_ABOUT[module] || "The laboratory's records for this module.", "p"],
      ["How to use it", "h"],
      [`One sheet per table, ${recs.length} sheets, ${total} rows in all. Column names are the database field names, so the rows can be loaded into another system; Records/JSON in the zip holds the same rows at full length. Dates are as stored (ISO format, UTC where a time is shown).`, "p"],
      ...(empty.length ? [[`Tables with no records for this lab (no sheet): ${empty.join(", ")}.`, "p"] as [string, "p"]] : []),
      ["Source", "h"],
      ["Exported from VeritaAssure™ by the lab owner with Download all records. Each row is the lab's own record as stored at the time of the export.", "p"],
      ["Not included", "h"],
      ["Passwords, sign-in codes, invite links and billing-processor identifiers are never exported. Questions or anything missing: info@veritaslabservices.com", "p"],
    ]);
    await about.protect(protectPwd, { ...PROTECT, sort: false, autoFilter: false });
    const used = new Set<string>(["About"]);
    for (const rec of recs) {
      let name = rec.table.slice(0, 31);
      for (let k = 2; used.has(name); k++) name = `${rec.table.slice(0, 28)}_${k}`;
      used.add(name);
      const ws = addTableSheet(wb, name, rec.columns, rec.rows, idLine);
      await ws.protect(protectPwd, PROTECT);
      zip.file(`Records/JSON/${rec.table}.json`, JSON.stringify(rec.rows, (_k, v) => (v && v.type === "Buffer" ? undefined : v), 1));
    }
    wb.views = [{ activeTab: 0 } as any];
    const file = `Records/${module} records.xlsx`;
    zip.file(file, Buffer.from(await wb.xlsx.writeBuffer()));
    manifest.push({ folder: "Records", file: `${module} records.xlsx`, what: `${recs.length} tables`, count: `${total} rows`, status: "Included" });
  }

  // 2) Reports from the app's own export routes, over loopback with the export context.
  const secret = registerExportSecret(ctx.labId);
  try {
    const token = jwt.sign({ svc: true, userId: ctx.ownerUserId }, process.env.JWT_SECRET!, { expiresIn: "60m" });
    const headers = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(ctx.labId), "X-Export-All-Job": secret };
    const calls = reportCalls(sqlite, ctx);
    let n = 0;
    const usedNames = new Set<string>();
    for (const call of calls) {
      n++;
      job.step = `Building reports (${n} of ${calls.length})`;
      const r = await fetchReport(opts.base, headers, call);
      if ("error" in r) {
        const none = r.error.startsWith("NONE:");
        manifest.push({ folder: `Reports/${call.module}`, file: "", what: call.what, count: "", status: none ? `Nothing to include: ${r.error.slice(5)}` : `Not included: ${r.error}` });
        continue;
      }
      let name = r.name;
      for (let k = 2; usedNames.has(`${call.module}/${name}`); k++) name = r.name.replace(/(\.[a-z0-9]+)?$/i, `_${k}$1`);
      usedNames.add(`${call.module}/${name}`);
      zip.file(`Reports/${call.module}/${name}`, r.buf);
      manifest.push({ folder: `Reports/${call.module}`, file: name, what: call.what, count: `${r.buf.length} bytes`, status: "Included" });
    }
  } finally {
    revokeExportSecret(secret);
  }

  // 3) Index.xlsx
  job.step = "Writing the index";
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  const about = addAbout(wb, "VeritaAssure™ | All laboratory records", `Prepared for: ${labName}    CLIA: ${clia}    Exported: ${today}`, [
    ["This zip holds the laboratory's records from VeritaAssure™ as of the export date. It is the lab's own data; VeritaAssure™ does not make regulatory determinations, and the laboratory director or designee is responsible for the records.", "p"],
    ["How to use it", "h"],
    ["Records: one workbook per module with every row the lab owns, one sheet per table, plus a JSON copy of each table for loading into another system.", "p"],
    ["Files: stored documents, including every version of each policy document and uploaded attachments.", "p"],
    ["Reports: the same exports the app produces (maps, coverage, scans, the competency Survey Bundle, QC monthly reviews, IQCP plans, letters of delegation, the personnel register, the policy master list).", "p"],
    ["The Contents sheet lists every file and anything that could not be included.", "p"],
    ["Source", "h"],
    ["Built by VeritaAssure™ when the lab owner chose Download all records. The download link is kept for 24 hours.", "p"],
    ["Coverage gaps", "h"],
    ["Not in this version: VeritaCheck study PDFs (study data is in the VeritaCheck records workbook). Never exported: passwords, sign-in codes, invite links, billing-processor identifiers, and organization-level documents of a multi-lab system. Records saved before multi-lab support carry no lab and are included under the owner's account. Anything missing: info@veritaslabservices.com", "p"],
  ]);
  await about.protect(protectPwd, { ...PROTECT, sort: false, autoFilter: false });
  const contents = addTableSheet(wb, "Contents", ["Folder", "File", "What it is", "Size or rows", "Status"],
    manifest.map((m) => ({ Folder: m.folder, File: m.file, "What it is": m.what, "Size or rows": m.count, Status: m.status })), idLine);
  contents.columns = [{ width: 28 }, { width: 48 }, { width: 44 }, { width: 16 }, { width: 34 }] as any;
  contents.eachRow((row: any, i: number) => {
    if (i === 1) return;
    const c = row.getCell(5);
    if (String(c.value || "").startsWith("Not included") || String(c.value || "").startsWith("File not")) c.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FF964219" } };
  });
  await contents.protect(protectPwd, PROTECT);
  wb.views = [{ activeTab: 0 } as any];
  zip.file("Index.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));

  // 4) Write the zip to the volume.
  job.step = "Compressing";
  const dir = path.join(exportDir(), `lab-${ctx.labId}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = zipPathFor(ctx.labId, job.id);
  await new Promise<void>((resolve, reject) => {
    zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 6 } })
      .pipe(fs.createWriteStream(file))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  const safeLab = labName.replace(/[^a-zA-Z0-9_\- ]/g, "").trim().replace(/\s+/g, "_") || "Lab";
  const filename = `${safeLab}_VeritaAssure_Records_${today}.zip`;
  const size = fs.statSync(file).size;
  fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify({ id: job.id, filename, createdAt: new Date().toISOString(), userId: job.userId, files: manifest.length }));
  return { file, filename, size };
}

export function startExportJob(sqlite: any, labId: number, userId: number, base: string): ExportJob {
  const running = runningByLab.get(labId);
  if (running && jobs.get(running)?.status === "running") return jobs.get(running)!;
  cleanupExports();
  const job: ExportJob = { id: crypto.randomBytes(12).toString("hex"), labId, userId, status: "running", step: "Starting", startedAt: new Date().toISOString() };
  jobs.set(job.id, job);
  runningByLab.set(labId, job.id);
  const ctx = exportContext(sqlite, labId);
  (async () => {
    try {
      if (!ctx) throw new Error("Lab not found");
      const out = await buildExportZip(sqlite, ctx, { base, job });
      Object.assign(job, { status: "done", step: "Ready", finishedAt: new Date().toISOString(), filename: out.filename, size: out.size });
    } catch (e: any) {
      console.error(`[export-all] lab ${labId} job ${job.id} failed:`, e?.message || e);
      Object.assign(job, { status: "failed", step: "Failed", finishedAt: new Date().toISOString(), error: "The download could not be built. Please try again, or contact info@veritaslabservices.com." });
    } finally {
      if (runningByLab.get(labId) === job.id) runningByLab.delete(labId);
    }
  })();
  return job;
}

export function latestJob(labId: number): ExportJob | null {
  let latest: ExportJob | null = null;
  for (const j of jobs.values()) if (j.labId === labId && (!latest || j.startedAt > latest.startedAt)) latest = j;
  return latest;
}

// ── Routes ────────────────────────────────────────────────────────────────────────────────────────────────

export function registerExportAllRoutes(app: any, deps: { sqlite: any; authMiddleware: any; httpServer: any }) {
  const { sqlite, authMiddleware, httpServer } = deps;
  const base = () => {
    const a = httpServer.address();
    return `http://127.0.0.1:${typeof a === "object" && a ? a.port : Number(process.env.PORT || 5000)}`;
  };

  // Owner only. Deliberately NOT labScopeMiddleware: an ended trial or subscription must not stop the owner
  // taking the lab's records.
  const ownerOnly = (req: any, res: any, next: any) => {
    const labId = Number(req.params.labId);
    if (!Number.isFinite(labId) || labId <= 0) return res.status(400).json({ error: "Invalid lab id" });
    if (req.isDemo) return res.status(403).json({ error: "Not available in the live demo." });
    const lab = sqlite.prepare("SELECT id, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
    if (!lab) return res.status(404).json({ error: "Lab not found" });
    if (Number(lab.owner_user_id) !== Number(req.userId)) return res.status(403).json({ error: "Only the lab owner can download all of the lab's records." });
    next();
  };

  app.post("/api/labs/:labId/export-all", authMiddleware, ownerOnly, (req: any, res: any) => {
    const labId = Number(req.params.labId);
    const job = startExportJob(sqlite, labId, req.userId, base());
    try {
      logAudit({ userId: req.userId, ownerUserId: req.userId, module: "account", action: "create", entityType: "export_all", entityId: labId, entityLabel: "Download all records", after: { jobId: job.id } });
    } catch { /* audit failure does not block */ }
    res.status(202).json({ job });
  });

  app.get("/api/labs/:labId/export-all", authMiddleware, ownerOnly, (req: any, res: any) => {
    const labId = Number(req.params.labId);
    cleanupExports();
    res.json({ job: latestJob(labId), ready: readyExports(labId) });
  });

  // A short-lived link the browser follows with a plain anchor download (no fetch + blob; see downloadPdfToken).
  // Purpose tokens (server/sessionAuth.ts) open nothing else: checkAuthToken refuses any token with a purpose.
  app.post("/api/labs/:labId/export-all/:exportId/download-token", authMiddleware, ownerOnly, (req: any, res: any) => {
    const labId = Number(req.params.labId);
    const ready = readyExports(labId).find((r) => r.id === req.params.exportId);
    if (!ready) return res.status(404).json({ error: "That download has expired. Build a new one." });
    const token = issuePurposeToken(req.userId, "export_all_download", { labId, exportId: ready.id });
    res.json({ url: `/api/export-all/file/${token}`, filename: ready.filename });
  });

  app.get("/api/export-all/file/:token", (req: any, res: any) => {
    const p = verifyPurposeToken(req.params.token, "export_all_download");
    if (!p) return res.status(404).json({ error: "This download link has expired." });
    const lab = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(Number(p.labId)) as any;
    if (!lab || Number(lab.owner_user_id) !== Number(p.userId)) return res.status(403).json({ error: "Only the lab owner can download all of the lab's records." });
    const ready = readyExports(Number(p.labId)).find((r) => r.id === p.exportId);
    if (!ready) return res.status(404).json({ error: "That download has expired. Build a new one." });
    const file = zipPathFor(Number(p.labId), ready.id);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${ready.filename}"; filename*=UTF-8''${encodeURIComponent(ready.filename)}`);
    res.setHeader("Content-Length", fs.statSync(file).size);
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(res);
  });

  const t = setInterval(() => { try { cleanupExports(); } catch { /* ignore */ } }, 60 * 60 * 1000);
  (t as any).unref?.();
}
