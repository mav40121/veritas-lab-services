// tests/integration/file-backup.test.ts
//
// Michael 2026-11-17 (Leads Q10 = 2): the stored documents go into the nightly off-site backup, and a restore test proves they
// come back. server/fileBackup.ts runs against a folder standing in for the bucket (the same calls R2 gets) and made-up files:
//   1. a run uploads each distinct content once (a duplicate file once), writes a list naming every file, and logs counts
//   2. a second run uploads nothing new; a changed file uploads only its new content; a removed file leaves the list
//   3. the restore test downloads every file the newest list names and passes; it tells files changed or removed on the
//      volume since; a corrupted or missing object fails it
//   4. retention: lists older than 730 days go, and a content no run has seen within them; current files stay
//   5. it skips with no bucket or no document folder, never runs twice at once, and writes nothing to the volume
//   6. the admin routes need the header; status gives counts only
// Run: npm run test:file-backup
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
import { Readable } from "node:stream";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const fb = await import("../../server/fileBackup");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "file-backup-test-"));
  const bucketDir = path.join(work, "bucket"), volume = path.join(work, "policies");
  fs.mkdirSync(bucketDir, { recursive: true });

  // The bucket as a folder: put/get/list/del, an object's time is its file's time.
  const store: import("../../server/fileBackup").FileBackupStore = {
    async put(key, body, _size) {
      const p = path.join(bucketDir, key); fs.mkdirSync(path.dirname(p), { recursive: true });
      if (Buffer.isBuffer(body)) fs.writeFileSync(p, body);
      else await new Promise<void>((res, rej) => body.pipe(fs.createWriteStream(p)).on("finish", () => res()).on("error", rej));
    },
    async get(key) { const p = path.join(bucketDir, key); if (!fs.existsSync(p)) throw new Error("NoSuchKey"); return fs.createReadStream(p) as unknown as Readable; },
    async list(prefix) {
      const out: Array<{ key: string; lastModified: Date }> = [];
      const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) walk(a); else { const key = path.relative(bucketDir, a).split(path.sep).join("/"); if (key.startsWith(prefix)) out.push({ key, lastModified: fs.statSync(a).mtime }); } } };
      walk(bucketDir); return out;
    },
    async del(key) { fs.rmSync(path.join(bucketDir, key), { force: true }); },
  };
  const roots = [{ name: "policies", dir: volume }];
  const write = (rel: string, text: string) => { const p = path.join(volume, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  write("38/410/v1/document.pdf", "made-up document one");
  write("38/411/v1/document.docx", "made-up document two");
  write("39/12/face-page.pdf", "made-up face page");
  write("39/12/copy-of-one.pdf", "made-up document one"); // same bytes as the first: one content
  const contents = () => store.list("files/sha256/");
  const manifests = async () => (await store.list("files-manifest/")).sort((a, b) => a.key.localeCompare(b.key));
  const readManifest = async (key: string) => JSON.parse(require("zlib").gunzipSync(fs.readFileSync(path.join(bucketDir, key))).toString("utf8"));
  const runs = (kind: string) => sqlite.prepare("SELECT * FROM backup_file_runs WHERE kind = ? ORDER BY id").all(kind) as any[];
  const volumeBefore = JSON.stringify(fb.walkRoots(roots));
  const opts = { store, roots, scope: "", alert: false };

  try {
    // ── 1. First run ──────────────────────────────────────────────────────────
    const r1 = await fb.runFileBackup(opts);
    check("1a. the first run lists 4 files and uploads 3 contents (the duplicate once)", r1.ok && r1.files === 4 && r1.uploaded === 3 && (await contents()).length === 3, JSON.stringify(r1));
    const m1 = await readManifest((await manifests())[0].key);
    check("1b. its list names every file with size and SHA-256, under the folder's name", m1.files.length === 4 && m1.files.every((f: any) => /^policies\//.test(f.path) && f.size > 0 && /^[0-9a-f]{64}$/.test(f.sha256)) && m1.files.some((f: any) => f.path === "policies/39/12/face-page.pdf"), JSON.stringify(m1.files.map((f: any) => f.path)));
    check("1c. the index holds the 3 contents; the run is logged with counts", Number((sqlite.prepare("SELECT COUNT(*) AS n FROM backup_files").get() as any).n) === 3 && runs("backup").length === 1 && runs("backup")[0].ok === 1 && runs("backup")[0].uploaded === 3);
    check("1d. the volume is untouched", JSON.stringify(fb.walkRoots(roots)) === volumeBefore);

    // ── 2. Later runs ─────────────────────────────────────────────────────────
    await new Promise((r) => setTimeout(r, 15));
    const r2 = await fb.runFileBackup(opts);
    check("2a. a second run uploads nothing new and writes a second list", r2.ok && r2.uploaded === 0 && (await manifests()).length === 2 && (await contents()).length === 3, JSON.stringify(r2));
    write("38/411/v1/document.docx", "made-up document two, edited");
    fs.rmSync(path.join(volume, "39/12/face-page.pdf"));
    await new Promise((r) => setTimeout(r, 15));
    const r3 = await fb.runFileBackup(opts);
    const m3 = await readManifest((await manifests()).at(-1)!.key);
    check("2b. a changed file uploads only its new content", r3.ok && r3.uploaded === 1 && (await contents()).length === 4, JSON.stringify(r3));
    check("2c. a removed file leaves the newest list, and its content stays for the older lists", m3.files.length === 3 && !m3.files.some((f: any) => f.path.endsWith("face-page.pdf")) && (await contents()).length === 4);

    // ── 3. Restore test ───────────────────────────────────────────────────────
    const t1 = await fb.fileRestoreTest(opts);
    check("3a. the restore test downloads every file in the newest list and passes", t1.verdict === "PASS" && t1.files === 3 && t1.restored === 3 && t1.mismatched === 0 && t1.missing === 0 && t1.liveSame === 3, JSON.stringify(t1));
    write("38/410/v1/document.pdf", "made-up document one, changed after the backup");
    const t2 = await fb.fileRestoreTest(opts);
    check("3b. a file changed on the volume since is still restored as backed up, and counted as changed", t2.verdict === "PASS" && t2.liveChanged === 1 && t2.liveSame === 2, JSON.stringify(t2));
    const docTwoSha = m3.files.find((f: any) => f.path === "policies/38/411/v1/document.docx").sha256;
    const objPath = path.join(bucketDir, "files/sha256", docTwoSha);
    const good = fs.readFileSync(objPath);
    fs.writeFileSync(objPath, "tampered");
    const t3 = await fb.fileRestoreTest(opts);
    check("3c. a corrupted object fails it", t3.verdict === "FAIL" && t3.mismatched === 1, JSON.stringify(t3));
    fs.rmSync(objPath);
    const t4 = await fb.fileRestoreTest(opts);
    check("3d. a missing object fails it", t4.verdict === "FAIL" && t4.missing === 1, JSON.stringify(t4));
    fs.writeFileSync(objPath, good);
    check("3e. each test is logged, PASS or FAIL", runs("restore_test").length === 4 && runs("restore_test").map((x) => x.ok).join("") === "1100");

    // ── 4. Retention ──────────────────────────────────────────────────────────
    const later = new Date(Date.now() + 731 * 86400000);
    const r4 = await fb.runFileBackup({ ...opts, now: later });
    const leftLists = await manifests();
    const leftShas = new Set((await contents()).map((c) => c.key.split("/").pop()));
    const liveShas = new Set((await readManifest(leftLists.at(-1)!.key)).files.map((f: any) => f.sha256));
    check("4a. two years on, the older lists go and the new one stays", r4.ok && r4.prunedManifests === 3 && leftLists.length === 1, JSON.stringify({ r4, left: leftLists.length }));
    check("4b. contents no run has seen in two years go; every content the kept list names stays", r4.prunedContents >= 1 && [...liveShas].every((s) => leftShas.has(s as string)) && leftShas.size === liveShas.size, JSON.stringify({ pruned: r4.prunedContents, left: leftShas.size, live: liveShas.size }));
    const t5 = await fb.fileRestoreTest(opts);
    check("4c. after pruning the restore test still passes", t5.verdict === "PASS" && t5.restored === t5.files, JSON.stringify(t5));

    // ── 5. Guards ─────────────────────────────────────────────────────────────
    const noStore = await fb.runFileBackup({ ...opts, store: null });
    const noDir = await fb.runFileBackup({ ...opts, roots: [{ name: "policies", dir: path.join(work, "absent") }] });
    check("5a. no bucket, or no document folder: it skips and says why", !noStore.ran && /not configured/.test(noStore.skippedReason || "") && !noDir.ran && /no document folder/.test(noDir.skippedReason || ""));
    const [a, b] = await Promise.all([fb.runFileBackup(opts), fb.runFileBackup(opts)]);
    check("5b. two runs at once: the second skips", [a, b].filter((x) => x.ran).length === 1 && [a, b].some((x) => /already running/.test(x.skippedReason || "")));
    const broken = await fb.runFileBackup({ ...opts, store: { ...store, put: async () => { throw new Error("made-up upload failure"); } } });
    check("5c. a failed upload is caught, returned and logged, not thrown", broken.ran && !broken.ok && /made-up upload failure/.test(broken.error || "") && runs("backup").at(-1).ok === 0);

    // ── 6. Admin routes ───────────────────────────────────────────────────────
    const app = express(); app.use(express.json());
    const server = http.createServer(app);
    await registerRoutes(server, app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as any).port;
    const call = async (method: string, p: string, header = true) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: header ? { "x-admin-secret": ADMIN } : {} }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
    const no = await Promise.all([call("GET", "/api/admin/file-backup/status", false), call("POST", "/api/admin/file-backup/run", false), call("POST", "/api/admin/file-backup/restore-test", false)]);
    check("6a. every route refuses without the header", no.every((x) => x.s === 403));
    const st = await call("GET", "/api/admin/file-backup/status");
    check("6b. status: the index count and the runs, counts only", st.s === 200 && typeof st.j.contents?.count === "number" && Array.isArray(st.j.runs) && st.j.runs.length > 0 && !JSON.stringify(st.j).includes("document.pdf"), JSON.stringify(st.j).slice(0, 200));
    const run = await call("POST", "/api/admin/file-backup/run");
    const test = await call("POST", "/api/admin/file-backup/restore-test");
    check("6c. run and restore test start in the background (202)", run.s === 202 && run.j.started === true && test.s === 202 && test.j.started === true, `${run.s} ${test.s}`);
    server.close();
  } catch (e: any) {
    failures++;
    console.log("FAIL  threw: " + (e?.stack || e));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main();
