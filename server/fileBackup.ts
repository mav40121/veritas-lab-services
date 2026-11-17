// Off-site backup of the stored documents (Michael 2026-11-17, Leads Q10 = 2: "add the stored documents to the existing
// Cloudflare R2 nightly backup, then run a restore test that proves documents come back").
//
// What: every file under POLICY_STORAGE_ROOT (/data/policies): VeritaDC document versions, carried-over records' face
// pages and originals. The database backups (server/backup.ts, server/continuousBackup.ts) hold the rows that point at
// these files but never the files, so until this job a lost volume lost every lab's documents. /data/exports (the
// "Download all records" archives, rebuilt on request) and the app folder's legacy uploads (not on the volume) are left out.
//
// How, in the same bucket as the database copies:
//   files/sha256/<hex>                    each distinct file content once, uploaded the first night it's seen
//   files-manifest/veritas-files-<iso>.json.gz   one list per run: every file's path, size and SHA-256
// A night's documents are its manifest plus the contents it names. backup_files records each content's first upload and
// the last run that saw it. Retention matches the nightly database copies (RETENTION_DAYS): a manifest older than that is
// deleted, and so is a content no run has seen within it, which no kept manifest can name. A file removed from the
// volume (a customer purge included) stays restorable until then, as the database copies do.
//
// The restore test downloads every file the newest manifest names, server-side and in memory (nothing is written to
// disk or leaves the server), hashes it, and checks it against the manifest and against the file on the volume today.
// Each run and each test is a backup_file_runs row (counts only, no paths or names).
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as crypto from "crypto";
import { Readable } from "stream";
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "./db";
import { POLICY_STORAGE_ROOT } from "./veritapolicyApproval";
import { backupBucket, backupScope, sendSystemAlert } from "./backup";

export const FILE_BACKUP_RETENTION_DAYS = 730;

/** The few calls the job makes; R2 in production (s3Store), a folder in the tests. */
export interface FileBackupStore {
  put(key: string, body: Buffer | fs.ReadStream, size: number, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  list(prefix: string): Promise<Array<{ key: string; lastModified: Date }>>;
  del(key: string): Promise<void>;
}

export function s3Store(): FileBackupStore | null {
  const b = backupBucket();
  if (!b) return null;
  const { client, bucket } = b;
  return {
    async put(key, body, size, contentType) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentLength: size, ContentType: contentType })); },
    async get(key) { return (await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))).Body as unknown as Readable; },
    async list(prefix) {
      const out: Array<{ key: string; lastModified: Date }> = [];
      let token: string | undefined;
      do {
        const page: any = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000, ContinuationToken: token }));
        for (const o of page.Contents || []) if (o.Key) out.push({ key: o.Key, lastModified: o.LastModified ?? new Date(0) });
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async del(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
  };
}

export interface FileRoot { name: string; dir: string }
export const defaultRoots = (): FileRoot[] => [{ name: "policies", dir: POLICY_STORAGE_ROOT }];
const prefixes = (scope = backupScope()) => ({ content: `${scope}files/sha256/`, manifest: `${scope}files-manifest/veritas-files-` });

/** Every regular file under the roots, as "<root name>/<path inside it>" with forward slashes, sorted. */
export function walkRoots(roots: FileRoot[]): Array<{ rel: string; abs: string; size: number }> {
  const out: Array<{ rel: string; abs: string; size: number }> = [];
  for (const root of roots) {
    if (!fs.existsSync(root.dir)) continue;
    const stack = [root.dir];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) stack.push(abs);
        else if (ent.isFile()) out.push({ rel: `${root.name}/${path.relative(root.dir, abs).split(path.sep).join("/")}`, abs, size: fs.statSync(abs).size });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const sha256File = (abs: string) => new Promise<string>((resolve, reject) => {
  const h = crypto.createHash("sha256");
  fs.createReadStream(abs).on("error", reject).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex")));
});
const sha256Stream = (s: Readable) => new Promise<{ sha: string; bytes: number }>((resolve, reject) => {
  const h = crypto.createHash("sha256");
  let bytes = 0;
  s.on("error", reject).on("data", (c: Buffer) => { h.update(c); bytes += c.length; }).on("end", () => resolve({ sha: h.digest("hex"), bytes }));
});
const readAll = async (s: Readable) => { const parts: Buffer[] = []; for await (const c of s) parts.push(Buffer.from(c)); return Buffer.concat(parts); };

function logRun(sqlite: any, row: Record<string, any>): number {
  return Number(sqlite.prepare(
    `INSERT INTO backup_file_runs (kind, started_at, finished_at, ok, files, bytes, uploaded, uploaded_bytes, pruned, manifest_key, detail_json, error)
     VALUES (@kind, @started_at, @finished_at, @ok, @files, @bytes, @uploaded, @uploaded_bytes, @pruned, @manifest_key, @detail_json, @error)`
  ).run({ files: null, bytes: null, uploaded: null, uploaded_bytes: null, pruned: null, manifest_key: null, detail_json: null, error: null, ...row }).lastInsertRowid);
}

export interface FileBackupResult {
  ran: boolean; ok: boolean; skippedReason?: string; error?: string;
  files: number; bytes: number; uploaded: number; uploadedBytes: number; prunedContents: number; prunedManifests: number;
  manifestKey?: string; elapsedMs: number;
}

let running = false;

/** One backup run. Never throws: a failure is logged, alerted and returned. */
export async function runFileBackup(opts: { store?: FileBackupStore | null; roots?: FileRoot[]; now?: Date; sqlite?: any; scope?: string; alert?: boolean } = {}): Promise<FileBackupResult> {
  const sqlite = opts.sqlite ?? (db as any).$client;
  const startedAt = new Date();
  const now = opts.now ?? startedAt;
  const empty: FileBackupResult = { ran: false, ok: false, files: 0, bytes: 0, uploaded: 0, uploadedBytes: 0, prunedContents: 0, prunedManifests: 0, elapsedMs: 0 };
  const store = opts.store === undefined ? s3Store() : opts.store;
  if (!store) return { ...empty, skippedReason: "backup storage (BACKUP_S3_*) is not configured" };
  const roots = opts.roots ?? defaultRoots();
  if (!roots.some((r) => fs.existsSync(r.dir))) return { ...empty, skippedReason: "no document folder on this service" };
  if (running) return { ...empty, skippedReason: "a document backup is already running" };
  running = true;
  const P = prefixes(opts.scope);
  let result: FileBackupResult = { ...empty, ran: true };
  try {
    const files = walkRoots(roots);
    const nowIso = now.toISOString();
    const known = new Set((sqlite.prepare("SELECT sha256 FROM backup_files").all() as any[]).map((r) => r.sha256));
    const manifest: Array<{ path: string; size: number; sha256: string }> = [];
    const seen = new Set<string>();
    let uploaded = 0, uploadedBytes = 0, bytes = 0;
    for (const f of files) {
      const sha = await sha256File(f.abs);
      manifest.push({ path: f.rel, size: f.size, sha256: sha });
      bytes += f.size;
      if (!known.has(sha) && !seen.has(sha)) {
        await store.put(`${P.content}${sha}`, fs.createReadStream(f.abs), f.size, "application/octet-stream");
        sqlite.prepare("INSERT OR IGNORE INTO backup_files (sha256, size_bytes, first_uploaded_at, last_seen_at) VALUES (?, ?, ?, ?)").run(sha, f.size, nowIso, nowIso);
        uploaded++; uploadedBytes += f.size;
      }
      seen.add(sha);
    }
    const touch = sqlite.prepare("UPDATE backup_files SET last_seen_at = ? WHERE sha256 = ?");
    sqlite.transaction(() => { for (const sha of seen) touch.run(nowIso, sha); })();
    // The list goes up last, so a manifest only ever names contents already in the bucket.
    const body = zlib.gzipSync(Buffer.from(JSON.stringify({ version: 1, created_at: nowIso, roots: roots.map((r) => r.name), files: manifest })));
    const manifestKey = `${P.manifest}${nowIso.replace(/[:.]/g, "-")}.json.gz`;
    await store.put(manifestKey, body, body.length, "application/gzip");

    // Retention: manifests older than the cutoff, then contents no run has seen since it.
    const cutoffMs = now.getTime() - FILE_BACKUP_RETENTION_DAYS * 86400000;
    let prunedManifests = 0, prunedContents = 0;
    for (const m of await store.list(P.manifest)) {
      if (m.lastModified.getTime() < cutoffMs && m.key !== manifestKey) { await store.del(m.key); prunedManifests++; }
    }
    const stale = sqlite.prepare("SELECT sha256 FROM backup_files WHERE last_seen_at < ?").all(new Date(cutoffMs).toISOString()) as any[];
    for (const s of stale) {
      await store.del(`${P.content}${s.sha256}`);
      sqlite.prepare("DELETE FROM backup_files WHERE sha256 = ?").run(s.sha256);
      prunedContents++;
    }
    result = { ran: true, ok: true, files: files.length, bytes, uploaded, uploadedBytes, prunedContents, prunedManifests, manifestKey, elapsedMs: Date.now() - startedAt.getTime() };
    console.log(`[file-backup] ${files.length} files (${bytes} bytes); uploaded ${uploaded} new (${uploadedBytes} bytes); pruned ${prunedManifests} lists and ${prunedContents} contents; ${manifestKey}`);
  } catch (err: any) {
    result = { ...result, ok: false, error: String(err?.message || err), elapsedMs: Date.now() - startedAt.getTime() };
    console.error("[file-backup] FAILED:", result.error);
    if (opts.alert !== false) {
      await sendSystemAlert("[VeritaAssure] Document backup FAILED",
        `<p>The nightly off-site backup of the stored documents failed at ${new Date().toISOString()}.</p><p><strong>Error:</strong> ${result.error}</p><p>The database backups are separate and unaffected. GET /api/admin/file-backup/status shows the runs.</p>`);
    }
  } finally {
    running = false;
    logRun(sqlite, {
      kind: "backup", started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), ok: result.ok ? 1 : 0,
      files: result.files, bytes: result.bytes, uploaded: result.uploaded, uploaded_bytes: result.uploadedBytes,
      pruned: result.prunedContents + result.prunedManifests, manifest_key: result.manifestKey ?? null,
      detail_json: JSON.stringify({ prunedContents: result.prunedContents, prunedManifests: result.prunedManifests }), error: result.error ?? null,
    });
  }
  return result;
}

export interface FileRestoreTestResult {
  ran: boolean; verdict: "PASS" | "FAIL" | "SKIP"; skippedReason?: string; error?: string;
  manifestKey?: string; manifestAt?: string;
  files: number; bytes: number; restored: number; restoredBytes: number; mismatched: number; missing: number;
  liveSame: number; liveChanged: number; liveGone: number; elapsedMs: number;
}

/** Download every file the newest manifest names and check each one. Reads only; writes one backup_file_runs row. */
export async function fileRestoreTest(opts: { store?: FileBackupStore | null; roots?: FileRoot[]; sqlite?: any; scope?: string } = {}): Promise<FileRestoreTestResult> {
  const sqlite = opts.sqlite ?? (db as any).$client;
  const started = Date.now();
  const base: FileRestoreTestResult = { ran: false, verdict: "SKIP", files: 0, bytes: 0, restored: 0, restoredBytes: 0, mismatched: 0, missing: 0, liveSame: 0, liveChanged: 0, liveGone: 0, elapsedMs: 0 };
  const store = opts.store === undefined ? s3Store() : opts.store;
  if (!store) return { ...base, skippedReason: "backup storage (BACKUP_S3_*) is not configured" };
  const roots = opts.roots ?? defaultRoots();
  const P = prefixes(opts.scope);
  let r: FileRestoreTestResult = { ...base, ran: true, verdict: "FAIL" };
  try {
    const lists = (await store.list(P.manifest)).sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime() || b.key.localeCompare(a.key));
    if (!lists.length) { r = { ...r, error: "no document backup list in the bucket yet" }; return r; }
    const newest = lists[0];
    const m = JSON.parse(zlib.gunzipSync(await readAll(await store.get(newest.key))).toString("utf8"));
    const live = new Map(walkRoots(roots).map((f) => [f.rel, f.abs]));
    r = { ...r, manifestKey: newest.key, manifestAt: m.created_at, files: m.files.length, bytes: m.files.reduce((n: number, f: any) => n + f.size, 0) };
    for (const f of m.files as Array<{ path: string; size: number; sha256: string }>) {
      let got: { sha: string; bytes: number } | null = null;
      try { got = await sha256Stream(await store.get(`${P.content}${f.sha256}`)); } catch { r.missing++; continue; }
      if (got.sha !== f.sha256 || got.bytes !== f.size) { r.mismatched++; continue; }
      r.restored++; r.restoredBytes += got.bytes;
      const abs = live.get(f.path);
      if (!abs) r.liveGone++;
      else if ((await sha256File(abs)) === f.sha256) r.liveSame++;
      else r.liveChanged++;
    }
    r.verdict = r.files > 0 && r.restored === r.files ? "PASS" : "FAIL";
  } catch (err: any) {
    r = { ...r, verdict: "FAIL", error: String(err?.message || err) };
  } finally {
    r.elapsedMs = Date.now() - started;
    if (r.ran) logRun(sqlite, {
      kind: "restore_test", started_at: new Date(started).toISOString(), finished_at: new Date().toISOString(), ok: r.verdict === "PASS" ? 1 : 0,
      files: r.files, bytes: r.bytes, manifest_key: r.manifestKey ?? null,
      detail_json: JSON.stringify({ restored: r.restored, restoredBytes: r.restoredBytes, mismatched: r.mismatched, missing: r.missing, liveSame: r.liveSame, liveChanged: r.liveChanged, liveGone: r.liveGone }),
      error: r.error ?? null,
    });
  }
  return r;
}

/** Counts for the admin status route: the index and the last runs. */
export function fileBackupStatus(sqlite: any = (db as any).$client, limit = 10) {
  const idx = sqlite.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b, MAX(last_seen_at) AS last FROM backup_files").get() as any;
  const runs = sqlite.prepare(
    "SELECT id, kind, started_at, finished_at, ok, files, bytes, uploaded, uploaded_bytes, pruned, manifest_key, detail_json, error FROM backup_file_runs ORDER BY id DESC LIMIT ?"
  ).all(limit) as any[];
  return {
    contents: { count: Number(idx.n), bytes: Number(idx.b), lastSeen: idx.last },
    running,
    runs: runs.map((x) => ({ ...x, ok: x.ok === 1, detail: x.detail_json ? JSON.parse(x.detail_json) : null, detail_json: undefined })),
  };
}
