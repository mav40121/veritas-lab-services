// scripts/verify-restore-files.mts
//
// Receipt for scripts/restore-files.mjs (docs/RESTORE_AND_RUN.md step 4). The app's own document backup
// (server/fileBackup.ts runFileBackup) writes a folder standing in for the bucket from made-up files; the restore script
// then has to put them back exactly. No production data, no network.
//   1. dry run lists every file and writes nothing
//   2. --apply writes every file byte for byte, a duplicate content to both paths
//   3. a rerun writes nothing; a changed file is left alone without --overwrite and put back with it
//   4. --before picks an earlier night's manifest and brings back that night's content
//   5. a corrupted content object is refused (exit 1) and not written
//   6. --scope reads another service's copies (veritastock/)
//   7. a manifest path that climbs out of the data folder is refused
// Run: npm run verify:restore-files
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const { db } = await import("../server/db");
const fb = await import("../server/fileBackup");
const sqlite = (db as any).$client;
const work = fs.mkdtempSync(path.join(os.tmpdir(), "restore-files-verify-"));
const bucketDir = path.join(work, "bucket"), volume = path.join(work, "volume", "policies");
fs.mkdirSync(bucketDir, { recursive: true });

const store = {
  async put(key: string, body: Buffer | fs.ReadStream) {
    const p = path.join(bucketDir, key); fs.mkdirSync(path.dirname(p), { recursive: true });
    if (Buffer.isBuffer(body)) fs.writeFileSync(p, body);
    else await new Promise<void>((res, rej) => body.pipe(fs.createWriteStream(p)).on("finish", () => res()).on("error", rej));
  },
  async get(key: string) { const p = path.join(bucketDir, key); if (!fs.existsSync(p)) throw new Error("NoSuchKey"); return fs.createReadStream(p) as unknown as Readable; },
  async list(prefix: string) {
    const out: Array<{ key: string; lastModified: Date }> = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) walk(a); else { const key = path.relative(bucketDir, a).split(path.sep).join("/"); if (key.startsWith(prefix)) out.push({ key, lastModified: fs.statSync(a).mtime }); } } };
    walk(bucketDir); return out;
  },
  async del(key: string) { fs.rmSync(path.join(bucketDir, key), { force: true }); },
};
const write = (root: string, rel: string, text: string) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
const script = path.resolve("scripts/restore-files.mjs");
const restore = (dest: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [script, dest, "--from-dir", bucketDir, ...args], { encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const countOf = (out: string, name: string) => Number((out.match(new RegExp(`${name} (\\d+)`)) || [])[1] ?? NaN);

// Night 1: four files, two with the same bytes.
write(volume, "38/410/v1/document.pdf", "made-up document one");
write(volume, "38/411/v1/document.docx", "made-up document two");
write(volume, "39/12/face-page.pdf", "made-up face page");
write(volume, "39/12/copy-of-one.pdf", "made-up document one");
const roots = [{ name: "policies", dir: volume }];
const night1 = new Date("2026-11-20T04:00:06.408Z"), night2 = new Date("2026-11-21T04:00:05.722Z");
const r1 = await fb.runFileBackup({ store, roots, now: night1, sqlite, alert: false });
check("1a  the app's backup ran on the made-up files", r1.ok && r1.files === 4, `files ${r1.files}, uploaded ${r1.uploaded}`);

// 1. dry run
const out1 = path.join(work, "restore1");
const d = restore(out1);
check("1b  dry run lists 4 to write", countOf(d.out, "wouldWrite") === 4 && d.code === 0, d.out.trim().split("\n").pop());
check("1c  dry run writes nothing", !fs.existsSync(out1));

// 2. apply
const a = restore(out1, "--apply");
check("2a  apply writes 4 files", countOf(a.out, "written") === 4 && a.code === 0, a.out.trim().split("\n").pop());
const same = ["38/410/v1/document.pdf", "38/411/v1/document.docx", "39/12/face-page.pdf", "39/12/copy-of-one.pdf"]
  .every((rel) => read(path.join(out1, "policies", rel)) === read(path.join(volume, rel)));
check("2b  every file matches the volume byte for byte, at <data dir>/policies/<path>", same);

// 3. rerun, changed file, overwrite
const again = restore(out1, "--apply");
check("3a  a rerun writes nothing and finds 4 already there", countOf(again.out, "written") === 0 && countOf(again.out, "alreadyThere") === 4);
fs.writeFileSync(path.join(out1, "policies", "39/12/face-page.pdf"), "changed after the restore");
const keep = restore(out1, "--apply");
check("3b  without --overwrite a differing file is left alone", countOf(keep.out, "differsLeftAlone") === 1 && read(path.join(out1, "policies", "39/12/face-page.pdf")) === "changed after the restore");
const over = restore(out1, "--apply", "--overwrite");
check("3c  with --overwrite it is put back", countOf(over.out, "replaced") === 1 && read(path.join(out1, "policies", "39/12/face-page.pdf")) === "made-up face page");

// 4. a later night changes a file; --before brings back night 1
write(volume, "38/410/v1/document.pdf", "made-up document one, revised");
const r2 = await fb.runFileBackup({ store, roots, now: night2, sqlite, alert: false });
check("4a  second night backed up", r2.ok && r2.uploaded === 1, `uploaded ${r2.uploaded}`);
const out4 = path.join(work, "restore4"), out4b = path.join(work, "restore4b");
const newest = restore(out4, "--apply");
check("4b  newest manifest gives the revised file", read(path.join(out4, "policies", "38/410/v1/document.pdf")) === "made-up document one, revised" && newest.out.includes("2026-11-21T04-00-05-722Z"));
const older = restore(out4b, "--apply", "--before", "2026-11-21T00:00:00Z");
check("4c  --before gives night 1's file", read(path.join(out4b, "policies", "38/410/v1/document.pdf")) === "made-up document one" && older.out.includes("2026-11-20T04-00-06-408Z"));

// 5. corrupted content
const sha = crypto.createHash("sha256").update("made-up document two").digest("hex");
const objPath = path.join(bucketDir, "files", "sha256", sha);
const good = fs.readFileSync(objPath);
fs.writeFileSync(objPath, "tampered");
const out5 = path.join(work, "restore5");
const bad = restore(out5, "--apply");
check("5a  a corrupted object fails the run (exit 1)", bad.code === 1 && countOf(bad.out, "failed") === 1, bad.out.trim().split("\n").pop());
check("5b  and its file is not written", !fs.existsSync(path.join(out5, "policies", "38/411/v1/document.docx")));
fs.writeFileSync(objPath, good);

// 6. another service's copies
const stockVol = path.join(work, "stock", "policies");
write(stockVol, "7/1/v1/sds.pdf", "made-up stock document");
const r6 = await fb.runFileBackup({ store, roots: [{ name: "policies", dir: stockVol }], now: night2, sqlite, scope: "veritastock/", alert: false });
const out6 = path.join(work, "restore6");
const s = restore(out6, "--apply", "--scope", "veritastock/");
check("6a  --scope veritastock/ restores that service's file only", r6.ok && countOf(s.out, "written") === 1 && read(path.join(out6, "policies", "7/1/v1/sds.pdf")) === "made-up stock document");

// 7. a path that climbs out
const evilKey = "files-manifest/veritas-files-2026-11-22T04-00-00-000Z.json.gz";
fs.writeFileSync(path.join(bucketDir, evilKey), zlib.gzipSync(Buffer.from(JSON.stringify({ version: 1, created_at: "2026-11-22T04:00:00.000Z", roots: ["policies"], files: [{ path: "../outside.txt", size: 20, sha256: sha }] }))));
const out7 = path.join(work, "restore7");
const e = restore(out7, "--apply", "--manifest", evilKey);
check("7a  a path outside the data folder is refused", e.code === 1 && countOf(e.out, "badPath") === 1 && !fs.existsSync(path.join(work, "outside.txt")));

fs.rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall PASS");
process.exit(failures ? 1 : 0);
