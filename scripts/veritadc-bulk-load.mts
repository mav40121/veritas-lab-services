// scripts/veritadc-bulk-load.mts
//
// Bulk load of a lab's current documents from its prior system's export into VeritaDC, one document at a time, through
// POST /api/admin/veritadc/bulk-load/document (server/veritadcBulkLoad.ts). Step E of Heywood's move out of MediaLab.
//
// Dry run (the default): reads the local export, converts what needs converting into the work folder, and reads production
// through ADMIN_SECRET GET routes only. It has no code path to a POST. It prints counts; document numbers, titles and
// per-document results go only to the files in the work folder. It never prints document contents.
//
// Real load: add --apply, and against production --go "<who gave the go, when>". A preflight refuses to start if the status
// route isn't live, a lab name or owner doesn't match, or the volume can't hold the load. A failure on one document is
// recorded and the run goes on; only a full volume stops it. Run it again at any time: documents already loaded are
// recognized by number and left alone. The result file is written after every document.
//
//   tsx scripts/veritadc-bulk-load.mts --manifest <csv> --export-root <dir> --config <json> --work-dir <dir> --confirm-labs 38,39
//     [--apply] [--go "..."] [--include-past-due] [--clear-phi "A 1,B 2"] [--only "A 1,B 2"] [--limit N] [--no-convert]
//     [--reminders-start-on YYYY-MM-DD] [--base-url URL] [--min-free-mb 100] [--pause-ms 150]
//     [--volume-size-mb N --volume-used-mb N] [--db-bytes-per-placement N]
// ADMIN_SECRET comes from the environment and is never printed.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
(globalThis as any).require ??= createRequire(import.meta.url);

import { canonicalFormatFromMimeAndName } from "../server/veritapolicyApproval";
import { checkUploadForPhi, documentText } from "../server/phiUploadCheck";
import { cleanCarriedTitle, titleLooksUnclear, validateCarriedMeta } from "../shared/policyCarriedOver";
import { csvCell, datesFor, parseCsv, placementsFor, reviewGapMonths, selectByStatus, splitPaths, titleFromFacePage, type LoadConfig } from "./veritadc-load-plan.mts";

// ── Arguments ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const need = (name: string) => {
  const v = opt(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
};

// Database growth per placement, manual and audit rows included. Measured at 2,265 bytes with long made-up titles and paths
// (scripts/measure-veritadc-load-db-growth.mts); rounded up.
const DEFAULT_DB_BYTES_PER_PLACEMENT = 2400;
const CONVERT_STALL_MS = 180_000;

const L = (p: string) => (process.platform === "win32" && !p.startsWith("\\\\?\\") ? "\\\\?\\" + path.resolve(p) : p);
const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const MB = (n: number) => Number((n / 1048576).toFixed(1));
const log = (s: string) => console.log(s);

// ── Network ────────────────────────────────────────────────────────────────
function makeHttp(baseUrl: string) {
  const secret = process.env.ADMIN_SECRET || "";
  const get = async (p: string) => {
    const r = await fetch(baseUrl + p, { headers: secret ? { "x-admin-secret": secret } : {} });
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* an HTML page means the route isn't there */ }
    return { status: r.status, body };
  };
  return { get };
}

// ── Conversion ─────────────────────────────────────────────────────────────
type Conversion = { ok: boolean; reason?: string; outPath?: string; before?: any; after?: any; differs?: string[] };

const COMPARED = ["pages", "words", "characters", "paragraphs", "tables", "inlineShapes", "shapes", "comments", "revisions", "footnotes", "sections"];
const differences = (before: any, after: any) =>
  COMPARED.filter((k) => before?.[k] !== undefined && after?.[k] !== undefined && before[k] !== after[k]).map((k) => `${k} ${before[k]} to ${after[k]}`);

async function pdfPageCount(file: string): Promise<number | null> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.load(fs.readFileSync(L(file)), { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return null;
  }
}

/** Convert with Word and PowerPoint, cached in the work folder by the source file's hash. */
async function convertAll(items: { sha: string; source: string; kind: "doc" | "ppt" }[], workDir: string, allowConvert: boolean): Promise<Map<string, Conversion>> {
  const out = new Map<string, Conversion>();
  const dir = path.join(workDir, "converted");
  fs.mkdirSync(L(dir), { recursive: true });
  const todo: typeof items = [];
  for (const it of items) {
    const ext = it.kind === "doc" ? "docx" : "pdf";
    const file = path.join(dir, `${it.sha}.${ext}`);
    const meta = path.join(dir, `${it.sha}.json`);
    if (fs.existsSync(L(file)) && fs.existsSync(L(meta))) {
      out.set(it.sha, { ...JSON.parse(fs.readFileSync(L(meta), "utf8")), ok: true, outPath: file });
    } else todo.push(it);
  }
  if (!todo.length) return out;
  if (!allowConvert || process.platform !== "win32") {
    for (const it of todo) out.set(it.sha, { ok: false, reason: "converter_unavailable" });
    return out;
  }
  // Private short-path copies: Office can't open the export's long paths, and this way it never touches an export file.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vdc-conv-"));
  try {
    const list = todo.map((it) => {
      const ext = it.kind === "doc" ? "docx" : "pdf";
      const inPath = path.join(tmp, `${it.sha.slice(0, 16)}.${it.kind}`);
      fs.copyFileSync(L(it.source), inPath);
      return { id: it.sha, in: inPath, out: path.join(tmp, `${it.sha.slice(0, 16)}.${ext}`), kind: it.kind };
    });
    let remaining = list;
    while (remaining.length) {
      const listPath = path.join(tmp, `list-${Date.now()}.json`);
      fs.writeFileSync(listPath, JSON.stringify(remaining));
      const script = fileURLToPath(new URL("./veritadc-convert-office.ps1", import.meta.url));
      const finished = new Set<string>();
      const stalled = await new Promise<string | null>((resolve) => {
        const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ListPath", listPath], { stdio: ["ignore", "pipe", "pipe"] });
        const officePids: number[] = [];
        let buf = "";
        let timer: NodeJS.Timeout;
        const arm = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            // Stop only the Office process this run started, never a person's own Word.
            for (const pid of officePids) { try { process.kill(pid); } catch { /* already gone */ } }
            try { child.kill(); } catch { /* already gone */ }
            resolve(remaining.find((r) => !finished.has(r.id))?.id ?? null);
          }, CONVERT_STALL_MS);
        };
        arm();
        child.stdout.on("data", (d) => {
          buf += d.toString("utf8");
          let at: number;
          while ((at = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, at).trim();
            buf = buf.slice(at + 1);
            if (!line) continue;
            let msg: any;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.officePid) { officePids.push(Number(msg.officePid)); continue; }
            const it = list.find((x) => x.id === msg.id);
            if (!it) continue;
            finished.add(it.id);
            arm();
            if (msg.ok && fs.existsSync(it.out)) {
              const ext = it.kind === "doc" ? "docx" : "pdf";
              const dest = path.join(dir, `${it.id}.${ext}`);
              fs.copyFileSync(it.out, L(dest));
              const rec: any = { kind: it.kind, before: msg.before, after: msg.after };
              fs.writeFileSync(L(path.join(dir, `${it.id}.json`)), JSON.stringify(rec));
              out.set(it.id, { ok: true, outPath: dest, before: msg.before, after: msg.after });
            } else {
              out.set(it.id, { ok: false, reason: String(msg.error || "conversion failed").slice(0, 160) });
            }
          }
        });
        child.stderr.on("data", () => { /* Office chatter can carry a file name; nothing here is printed */ });
        child.on("close", () => { clearTimeout(timer); resolve(null); });
        child.on("error", () => { clearTimeout(timer); resolve(null); });
      });
      if (stalled) out.set(stalled, { ok: false, reason: "conversion hung and was stopped" });
      remaining = remaining.filter((r) => !out.has(r.id) && r.id !== stalled);
      if (!stalled) {
        for (const r of remaining) out.set(r.id, { ok: false, reason: "converter stopped before this file" });
        remaining = [];
      }
    }
  } finally {
    // Nothing of the customer's stays in the temp folder.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return out;
}

function conversionDiffers(kind: string, c: Conversion): string[] {
  if (kind === "doc") return differences(c.before, c.after);
  if (kind === "ppt" && c.before?.slides !== c.after?.pages) return [`slides ${c.before?.slides} to PDF pages ${c.after?.pages}`];
  return [];
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const apply = flag("apply");
  const baseUrl = (opt("base-url", "https://www.veritaslabservices.com") as string).replace(/\/$/, "");
  const isProd = /veritaslabservices\.com/.test(baseUrl);
  const includePastDue = flag("include-past-due");
  const allowConvert = !flag("no-convert");
  // VeritaAssure holds no patient information, so a document the patient-information check flags waits until a person has
  // looked at it and named it here. It costs nothing to hold one: a later run loads it, and the rest aren't affected.
  const clearedPhi = new Set((opt("clear-phi", "") as string).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const minFreeBytes = Number(opt("min-free-mb", "100")) * 1048576;
  const pauseMs = Number(opt("pause-ms", "150"));
  const only = new Set((opt("only", "") as string).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
  const limit = Number(opt("limit", "0"));
  const manifestPath = need("manifest");
  const exportRoot = need("export-root");
  const workDir = need("work-dir");
  const config = JSON.parse(fs.readFileSync(need("config"), "utf8")) as LoadConfig;
  const confirmed = need("confirm-labs").split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
  const configured = Object.keys(config.labs).map(Number).sort((a, b) => a - b);
  const mapped = [...new Set(Object.values(config.topLevel).flat())].sort((a, b) => a - b);
  if (confirmed.join() !== configured.join() || !mapped.every((l) => configured.includes(l))) {
    throw new Error(`--confirm-labs ${confirmed.join()} doesn't match the labs in the config (${configured.join()}, mapped ${mapped.join()})`);
  }
  if (apply && isProd && !opt("go")) throw new Error('--apply against production needs --go "<who gave the go, when>"');
  if (apply && !process.env.ADMIN_SECRET) throw new Error("ADMIN_SECRET is not set");
  fs.mkdirSync(L(workDir), { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const mode = apply ? "load" : "dryrun";
  const resultsPath = path.join(workDir, `${mode}_results_${stamp}.csv`);
  const startedAt = Date.now();

  // The day after the load, unless told otherwise, so the owner hears nothing while the load runs.
  const etToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const dayAfter = new Date(Date.parse(`${etToday}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const remindersStartOn = opt("reminders-start-on", dayAfter) as string;

  // ── 1. Choose rows ──
  const rows = parseCsv(fs.readFileSync(L(manifestPath), "utf8"));
  const tally: Record<string, number> = {};
  const bump = (t: Record<string, number>, k: string, by = 1) => { t[k] = (t[k] || 0) + by; };
  const notLoaded: { number: string; title: string; status: string; why: string }[] = [];
  const chosen: Record<string, string>[] = [];
  for (const r of rows) {
    const sel = selectByStatus(r.status, includePastDue);
    bump(tally, `manifest_${sel}`);
    if (sel !== "load") {
      if (sel !== "retired") notLoaded.push({ number: r.number, title: r.title, status: r.status, why: sel });
      continue;
    }
    if (only.size && !only.has(String(r.number).toLowerCase())) continue;
    chosen.push(r);
    if (limit && chosen.length >= limit) break;
  }

  // ── 2. Read the local files (no contents reach the screen) ──
  type Doc = {
    row: Record<string, string>;
    title: string; rawTitle: string; titleChanged: boolean; unclear: string | null;
    sourcePath: string | null; sourceExt: string; sourceSha: string | null; copiesDiffer: boolean;
    faceBytes: number; facePath: string | null; dates: ReturnType<typeof datesFor>;
    placements: ReturnType<typeof placementsFor>["placements"]; unmapped: string[];
    problems: string[];
  };
  const docs: Doc[] = [];
  for (const r of chosen) {
    const dates = datesFor(r);
    const { placements, unmapped } = placementsFor(r.manual_paths, config);
    const problems: string[] = [];
    if (!dates.versionOk) problems.push("bad_version");
    if (!dates.effectiveDate) problems.push("no_effective_date");
    if (dates.badDates.length) problems.push(`bad_date:${dates.badDates.join("+")}`);
    if (unmapped.length) problems.push(`unmapped_manual:${unmapped.join("; ")}`);

    let facePath: string | null = r.face_page ? path.join(exportRoot, r.face_page) : null;
    let faceBytes = 0;
    let rawTitle = "";
    if (facePath && fs.existsSync(L(facePath))) {
      const html = fs.readFileSync(L(facePath), "utf8");
      faceBytes = fs.statSync(L(facePath)).size;
      rawTitle = titleFromFacePage(html, r.number);
    } else {
      facePath = null;
      problems.push("missing_face_page");
    }
    if (!rawTitle) rawTitle = r.title;
    const clean = cleanCarriedTitle(rawTitle);

    const names = [...new Set(String(r.files ?? "").split(" || ").map((s) => s.trim()).filter(Boolean))];
    const copies: string[] = [];
    for (const p of splitPaths(r.manual_paths)) for (const n of names) {
      const full = path.join(exportRoot, ...p, n);
      if (fs.existsSync(L(full))) copies.push(full);
    }
    let sourcePath: string | null = null;
    let sourceSha: string | null = null;
    let copiesDiffer = false;
    if (copies.length) {
      const hashes = new Set(copies.map((c) => sha256(fs.readFileSync(L(c)))));
      sourcePath = copies[0];
      sourceSha = sha256(fs.readFileSync(L(sourcePath)));
      copiesDiffer = hashes.size > 1;
      if (copiesDiffer) problems.push("copies_differ");
    } else {
      problems.push("missing_file");
    }
    docs.push({
      row: r, title: clean.title, rawTitle, titleChanged: clean.changed, unclear: titleLooksUnclear(clean.title),
      sourcePath, sourceExt: sourcePath ? path.extname(sourcePath).toLowerCase() : "", sourceSha, copiesDiffer,
      faceBytes, facePath, dates, placements, unmapped, problems,
    });
  }

  // ── 3. Convert ──
  const toConvert = new Map<string, { sha: string; source: string; kind: "doc" | "ppt" }>();
  for (const d of docs) {
    if (d.sourceSha && (d.sourceExt === ".doc" || d.sourceExt === ".ppt")) {
      toConvert.set(d.sourceSha, { sha: d.sourceSha, source: d.sourcePath!, kind: d.sourceExt === ".doc" ? "doc" : "ppt" });
    }
  }
  const conversions = await convertAll([...toConvert.values()], workDir, allowConvert);
  // PowerPoint: slides against PDF pages. Here so a conversion reused from the work folder is counted too.
  for (const it of toConvert.values()) {
    const c = conversions.get(it.sha);
    if (c?.ok && it.kind === "ppt") c.after = { ...(c.after || {}), pages: await pdfPageCount(c.outPath!) };
  }

  // ── 4. Check each file the way the server will, and add up the bytes ──
  const stats = {
    documents: docs.length,
    withFile: 0,
    placements: 0,
    perLab: {} as Record<string, number>,
    perManual: {} as Record<string, number>,
    perFileType: {} as Record<string, number>,
    perLoadedType: {} as Record<string, number>,
    wouldLoad: 0,
    wouldNotLoad: {} as Record<string, number>,
    convert: { asked: toConvert.size, ok: 0, clean: 0, differs: 0, failed: 0 },
    bytes: { documents: 0, facePages: 0, originals: 0 },
    datesCarried: { effective: 0, lastApprovalOrReview: 0, nextReviewDue: 0, noLastDate: 0, noNextReview: 0, noSignaturesOnFacePage: 0 },
    phi: { checkedFiles: 0, notReadable: 0, filesWithALabel: 0 },
    previewEmpty: 0,
    reviewGapNot12: 0,
    titlesChanged: 0,
    titlesUnclear: 0,
  };
  type Row = {
    number: string; title: string; lab: number | string; manual: string; also_filed_in: string; version: string;
    effective_date: string; last_approval_or_review: string; next_review_due: string; signatures_on_face_page: string;
    file_in: string; file_loaded: string; document_bytes: number; face_page_bytes: number; original_bytes: number;
    convert_check: string; phi_labels: string; preview: string; result: string; detail: string; document_id: string;
  };
  const columns: (keyof Row)[] = ["number", "title", "lab", "manual", "also_filed_in", "version", "effective_date", "last_approval_or_review", "next_review_due", "signatures_on_face_page", "file_in", "file_loaded", "document_bytes", "face_page_bytes", "original_bytes", "convert_check", "phi_labels", "preview", "result", "detail", "document_id"];
  fs.writeFileSync(L(resultsPath), "﻿" + columns.join(",") + "\n");
  const writeRow = (r: Row) => fs.appendFileSync(L(resultsPath), columns.map((c) => csvCell(r[c])).join(",") + "\n");

  type Work = Doc & { loadPath: string | null; loadName: string; format: string | null; originalPath: string | null; convertedFrom: "doc" | "ppt" | null; convertCheck: string; phi: string; preview: string; blockers: string[]; sizes: { doc: number; orig: number } };
  const work: Work[] = [];
  for (const d of docs) {
    const blockers = [...d.problems];
    let loadPath = d.sourcePath;
    let originalPath: string | null = null;
    let convertedFrom: "doc" | "ppt" | null = null;
    let convertCheck = "";
    if (d.sourceExt) bump(stats.perFileType, d.sourceExt);
    if (d.sourcePath) stats.withFile++;
    if (d.sourceSha && toConvert.has(d.sourceSha)) {
      const c = conversions.get(d.sourceSha)!;
      const kind = toConvert.get(d.sourceSha)!.kind;
      if (c?.ok) {
        loadPath = c.outPath!;
        originalPath = d.sourcePath;
        convertedFrom = kind;
        const diff = conversionDiffers(kind, c);
        convertCheck = diff.length ? `differs: ${diff.join(", ")}` : "clean";
      } else {
        loadPath = null;
        convertCheck = `failed: ${c?.reason ?? "unknown"}`;
        blockers.push("conversion_failed");
      }
    }
    let format: string | null = null;
    let sizes = { doc: 0, orig: 0 };
    let phi = "";
    let preview = "";
    if (loadPath) {
      const buf = fs.readFileSync(L(loadPath));
      format = canonicalFormatFromMimeAndName("", path.basename(loadPath), buf);
      sizes = { doc: buf.length, orig: originalPath ? fs.statSync(L(originalPath)).size : 0 };
      if (!format) blockers.push("bad_format");
      else {
        const check = await checkUploadForPhi(buf, format);
        if (check.checked) stats.phi.checkedFiles++; else stats.phi.notReadable++;
        if (check.found.length) {
          stats.phi.filesWithALabel++;
          phi = check.found.join("+");
          if (!clearedPhi.has(String(d.row.number).toLowerCase())) blockers.push("phi_flag_held");
        }
        if (format === "docx") {
          const t = await documentText(buf, format);
          if (t === null) preview = "could not read";
          else if (!t.trim()) preview = "no text";
          if (preview) stats.previewEmpty++;
        }
      }
    }
    work.push({ ...d, loadPath, loadName: loadPath ? path.basename(loadPath) : "", format, originalPath, convertedFrom, convertCheck, phi, preview, blockers, sizes });
  }
  for (const it of toConvert.values()) {
    const c = conversions.get(it.sha);
    if (!c?.ok) { stats.convert.failed++; continue; }
    stats.convert.ok++;
    if (conversionDiffers(it.kind, c).length) stats.convert.differs++; else stats.convert.clean++;
  }

  // ── 5. Production, read-only ──
  const http = makeHttp(baseUrl);
  const health = await http.get("/api/health").catch(() => ({ status: 0, body: null as any }));
  const prod: any = { commit: String(health.body?.commit || "unknown").slice(0, 8), labs: {} };
  const access = process.env.ADMIN_SECRET ? await http.get("/api/admin/labs-access-audit").catch(() => null) : null;
  const disk = process.env.ADMIN_SECRET ? await http.get("/api/admin/disk-usage").catch(() => null) : null;
  prod.diskUsageMB = disk?.body?.totalMB ?? null;
  let statusLive = true;
  const stopReasons: string[] = [];
  for (const id of configured) {
    const wanted = config.labs[String(id)].expectedLabName;
    const row = (access?.body?.all || []).find((l: any) => l.id === id);
    const st = process.env.ADMIN_SECRET ? await http.get(`/api/admin/veritadc/bulk-load/status?labId=${id}`).catch(() => null) : null;
    const live = st?.status === 200 && !!st.body?.labId;
    if (!live) statusLive = false;
    prod.labs[id] = {
      labName: row?.lab_name ?? st?.body?.labName ?? null,
      nameMatches: (row?.lab_name ?? st?.body?.labName) === wanted,
      ownerUserId: row?.owner_user_id ?? st?.body?.ownerUserId ?? null,
      ownerMatches: (row?.owner_user_id ?? st?.body?.ownerUserId) === config.ownerUserId,
      statusRouteLive: live,
      documentsActive: live ? st!.body.documents.active : null,
      carriedAlready: live ? st!.body.documents.carried : null,
      manualsActive: live ? st!.body.manuals.active : null,
    };
    prod.labs[id].freeBytes = live ? st!.body.volume?.freeBytes ?? null : null;
    if (!prod.labs[id].nameMatches) stopReasons.push(`lab ${id}: name doesn't match the config`);
    if (!prod.labs[id].ownerMatches) stopReasons.push(`lab ${id}: owner isn't user ${config.ownerUserId}`);
  }
  const already = new Map<number, Set<string>>();
  for (const id of configured) {
    const st = statusLive ? await http.get(`/api/admin/veritadc/bulk-load/status?labId=${id}`).catch(() => null) : null;
    already.set(id, new Set((st?.body?.carriedNumbers || []).map((s: string) => s.toLowerCase())));
  }

  // ── 6. Plan, and in a real load send each document ──
  const planned: { w: Work; p: Doc["placements"][number] }[] = [];
  for (const w of work) {
    const sigCount = Number(w.row.signature_rows || 0);
    const places = w.placements.length ? w.placements : [];
    if (w.titleChanged) stats.titlesChanged++;
    if (w.unclear) stats.titlesUnclear++;
    if (w.dates.effectiveDate) stats.datesCarried.effective++;
    if (w.dates.lastApprovalOrReview) stats.datesCarried.lastApprovalOrReview++; else stats.datesCarried.noLastDate++;
    if (w.dates.nextReviewDue) stats.datesCarried.nextReviewDue++; else stats.datesCarried.noNextReview++;
    if (!sigCount) stats.datesCarried.noSignaturesOnFacePage++;
    const gap = reviewGapMonths(w.dates.lastApprovalOrReview, w.dates.nextReviewDue);
    if (gap !== null && gap !== (config.reviewIntervalMonths || 12)) stats.reviewGapNot12++;
    for (const b of w.blockers) bump(stats.wouldNotLoad, b.split(":")[0]);
    if (!places.length) {
      // In no manual: reported against the lab its number points to.
      const prefix = Object.entries(config.noManualLabByPrefix || {}).find(([k]) => String(w.row.number).startsWith(k));
      writeRow(baseRow(w, prefix ? prefix[1] : "", "", [], w.blockers.length ? "not_loaded" : "not_loaded", [...w.blockers, "in_no_manual"].join("; ")));
      continue;
    }
    for (const p of places) {
      if (w.blockers.length) {
        writeRow(baseRow(w, p.labId, p.manualPath.join(" / "), p.alsoFiledIn, "not_loaded", w.blockers.join("; ")));
        continue;
      }
      planned.push({ w, p });
      stats.placements++;
      stats.wouldLoad++;
      bump(stats.perLab, String(p.labId));
      bump(stats.perManual, `${p.labId} | ${p.manualPath.slice(0, 2).join(" / ")}`);
      bump(stats.perLoadedType, w.format || "?");
      stats.bytes.documents += w.sizes.doc;
      stats.bytes.facePages += w.faceBytes;
      stats.bytes.originals += w.sizes.orig;
    }
  }

  function baseRow(w: Work, lab: number | string, manual: string, also: string[], result: string, detail: string, documentId = ""): Row {
    return {
      number: w.row.number, title: w.title, lab, manual, also_filed_in: also.join("; "), version: w.dates.version,
      effective_date: w.dates.effectiveDate || "", last_approval_or_review: w.dates.lastApprovalOrReview || "", next_review_due: w.dates.nextReviewDue || "",
      signatures_on_face_page: w.row.signature_rows || "0", file_in: w.sourceExt, file_loaded: w.format || "",
      document_bytes: w.sizes.doc, face_page_bytes: w.faceBytes, original_bytes: w.sizes.orig,
      convert_check: w.convertCheck, phi_labels: w.phi, preview: w.preview, result, detail, document_id: documentId,
    };
  }

  const metaFor = (w: Work, p: Doc["placements"][number]) => ({
    labId: p.labId,
    expectedLabName: config.labs[String(p.labId)].expectedLabName,
    ownerUserId: config.ownerUserId,
    batch: config.batch,
    loadedBy: config.loadedBy,
    sourceSystem: config.sourceSystem,
    sourceStatus: w.row.status,
    docNumber: w.row.number,
    title: w.title,
    titleAsExported: w.rawTitle,
    version: w.dates.version,
    effectiveDate: w.dates.effectiveDate,
    lastApprovalOrReview: w.dates.lastApprovalOrReview,
    nextReviewDue: w.dates.nextReviewDue,
    reviewIntervalMonths: w.dates.nextReviewDue ? config.reviewIntervalMonths || 12 : 0,
    remindersStartOn,
    author: w.row.author || null,
    approvalRows: Number(w.row.approval_rows || 0),
    reviewRows: Number(w.row.review_rows || 0),
    versionCount: Number(w.row.versions || 0),
    manualPath: p.manualPath,
    alsoFiledIn: p.alsoFiledIn,
    convertedFrom: w.convertedFrom,
    originalFilename: w.originalPath ? path.basename(w.originalPath) : null,
    minFreeBytes,
  });

  // The whole plan checked against the same rule the server uses, so a bad record shows up in the dry run.
  for (const { w, p } of planned) {
    const v = validateCarriedMeta(metaFor(w, p));
    if (!v.ok) bump(stats.wouldNotLoad, `meta:${v.problems[0]}`);
  }

  const bytesPerPlacement = Number(opt("db-bytes-per-placement", String(DEFAULT_DB_BYTES_PER_PLACEMENT)));
  const dbGrowth = planned.length * bytesPerPlacement;
  const totalBytes = stats.bytes.documents + stats.bytes.facePages + stats.bytes.originals + dbGrowth;
  const volSize = opt("volume-size-mb") ? Number(opt("volume-size-mb")) : null;
  const volUsed = opt("volume-used-mb") ? Number(opt("volume-used-mb")) : null;
  const liveFree = configured.map((id) => prod.labs[id].freeBytes).find((x) => x != null) ?? null;
  const space = {
    addMB: MB(totalBytes),
    documentsMB: MB(stats.bytes.documents),
    facePagesMB: MB(stats.bytes.facePages),
    originalsMB: MB(stats.bytes.originals),
    databaseGrowthMB: MB(dbGrowth),
    volumeSizeMB: volSize,
    usedByRailwayMB: volUsed,
    usedByFileWalkMB: prod.diskUsageMB,
    afterByRailwayMB: volUsed !== null ? Number((volUsed + MB(totalBytes)).toFixed(1)) : null,
    afterByFileWalkMB: prod.diskUsageMB !== null ? Number((prod.diskUsageMB + MB(totalBytes)).toFixed(1)) : null,
    freeNowOnServerMB: liveFree !== null ? MB(liveFree) : null,
  };
  if (apply) {
    if (!statusLive) stopReasons.push("the status route isn't live, so the code isn't deployed");
    if (liveFree !== null && liveFree < totalBytes + minFreeBytes) {
      stopReasons.push(`the volume has ${MB(liveFree)} MB free and the load needs ${MB(totalBytes)} MB plus ${MB(minFreeBytes)} MB to spare`);
    }
    if (liveFree === null && isProd) stopReasons.push("the server couldn't report its free space");
  }

  let stoppedEarly = "";
  const outcome: Record<string, number> = {};
  if (apply) {
    if (stopReasons.length) {
      for (const s of stopReasons) log(`STOP: ${s}`);
      throw new Error("Preflight refused the load. Nothing was sent.");
    }
    const secret = process.env.ADMIN_SECRET as string;
    let done = 0;
    for (const { w, p } of planned) {
      const fd = new FormData();
      fd.append("meta", JSON.stringify(metaFor(w, p)));
      fd.append("document", new Blob([fs.readFileSync(L(w.loadPath!))]), w.loadName);
      fd.append("face_page", new Blob([fs.readFileSync(L(w.facePath!))], { type: "text/html" }), "face-page.html");
      if (w.originalPath) fd.append("original", new Blob([fs.readFileSync(L(w.originalPath))]), path.basename(w.originalPath));
      let result = "failed";
      let detail = "";
      let documentId = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const r = await fetch(`${baseUrl}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": secret }, body: fd });
          const body: any = await r.json().catch(() => ({}));
          if (r.status === 507) { result = "failed"; detail = "VOLUME_LOW"; stoppedEarly = "volume low"; break; }
          if (r.status >= 500 && attempt < 3) { await new Promise((ok) => setTimeout(ok, attempt * 5000)); continue; }
          result = body.result || "failed";
          detail = body.code ? `${body.code}${body.problems ? `: ${body.problems.join(", ")}` : ""}` : (body.phiFound?.length ? `phi label: ${body.phiFound.join("+")}` : "");
          documentId = body.documentId ? String(body.documentId) : "";
          break;
        } catch (err: any) {
          detail = `network: ${String(err?.code || err?.name || "error")}`;
          if (attempt < 3) await new Promise((ok) => setTimeout(ok, attempt * 5000));
        }
      }
      bump(outcome, result);
      writeRow(baseRow(w, p.labId, p.manualPath.join(" / "), p.alsoFiledIn, result, detail, documentId));
      done++;
      if (done % 50 === 0) log(`${done} of ${planned.length} sent, ${JSON.stringify(outcome)}`);
      if (stoppedEarly) break;
      if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
    }
    // Whatever a stop left unsent is still accounted for, one row each.
    if (stoppedEarly) {
      const sent = Object.values(outcome).reduce((a, b) => a + b, 0);
      for (const { w, p } of planned.slice(sent)) {
        bump(outcome, "not_sent");
        writeRow(baseRow(w, p.labId, p.manualPath.join(" / "), p.alsoFiledIn, "not_sent", stoppedEarly));
      }
    }
  } else {
    for (const { w, p } of planned) {
      const isThere = already.get(p.labId)?.has(String(w.row.number).toLowerCase());
      const result = isThere ? "would_skip_already_loaded" : "would_load";
      bump(outcome, result);
      writeRow(baseRow(w, p.labId, p.manualPath.join(" / "), p.alsoFiledIn, result, ""));
    }
  }

  // ── 7. Side files and the summary ──
  const titlesPath = path.join(workDir, `${mode}_titles_changed_${stamp}.csv`);
  fs.writeFileSync(L(titlesPath), "﻿number,title_in_prior_system,title_loaded\n" + work.filter((w) => w.titleChanged).map((w) => [w.row.number, w.rawTitle, w.title].map(csvCell).join(",")).join("\n") + "\n");
  const unclearPath = path.join(workDir, `${mode}_titles_unclear_${stamp}.csv`);
  fs.writeFileSync(L(unclearPath), "﻿number,title_loaded,why\n" + work.filter((w) => w.unclear).map((w) => [w.row.number, w.title, w.unclear].map(csvCell).join(",")).join("\n") + "\n");
  const notLoadedPath = path.join(workDir, `${mode}_left_out_${stamp}.csv`);
  fs.writeFileSync(L(notLoadedPath), "﻿number,title,status,why\n" + notLoaded.map((n) => [n.number, n.title, n.status, n.why].map(csvCell).join(",")).join("\n") + "\n");

  const summary = {
    mode,
    baseUrl,
    remindersStartOn,
    includePastDue,
    tally,
    stats: { ...stats, perManual: undefined },
    perManual: Object.fromEntries(Object.entries(stats.perManual).sort()),
    space,
    production: prod,
    outcome,
    stoppedEarly,
    stopReasons,
    minutes: Number(((Date.now() - startedAt) / 60000).toFixed(1)),
    files: { results: resultsPath, titlesChanged: titlesPath, titlesUnclear: unclearPath, leftOut: notLoadedPath },
  };
  const summaryPath = path.join(workDir, `${mode}_summary_${stamp}.json`);
  fs.writeFileSync(L(summaryPath), JSON.stringify(summary, null, 2));
  log(JSON.stringify({ ...summary, perManual: `${Object.keys(summary.perManual).length} rows in ${summaryPath}` }, null, 2));
  log(`mode ${mode}: ${JSON.stringify(outcome)}`);
  const anyFailed = apply && (outcome.failed || outcome.not_sent);
  process.exit(anyFailed ? 2 : 0);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
