// scripts/restore-files.mjs
//
// Puts the stored documents (VeritaDC versions, carried-over records' face pages and originals) back from the off-site
// backup onto a data folder, for a rebuilt volume or a new host (docs/RESTORE_AND_RUN.md step 4). It reads the layout
// server/fileBackup.ts writes, in the same bucket as the database copies:
//   [<scope>]files-manifest/veritas-files-<iso>.json.gz   one list per night: { version, created_at, roots, files: [{ path, size, sha256 }] }
//   [<scope>]files/sha256/<hex>                         each distinct file content once
// A manifest path is "<root>/<relative path>"; the only root today is "policies", which is POLICY_STORAGE_ROOT
// (/data/policies) on production, so with <data dir> = /data a file lands where the app reads it.
//
// Usage (BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY in the environment):
//   node scripts/restore-files.mjs <data dir>                         dry run: what the newest manifest would write
//   node scripts/restore-files.mjs <data dir> --apply                 write it
//   node scripts/restore-files.mjs <data dir> --before 2026-11-20T00:00:00Z --apply   the newest manifest before that time
//   node scripts/restore-files.mjs <data dir> --manifest <key> --apply                 one named manifest
// Options: --scope <service>/ for another Railway service's copies (VeritaStock: veritastock/); --overwrite to replace a
// file already in place whose content differs (without it such a file is left alone and counted); --from-dir <folder>
// reads the same layout from a local folder instead of the bucket (tests).
// Every download is hashed and must match the manifest's SHA-256 and size, or it isn't written. A file already in place
// with the right content is skipped, so a rerun writes nothing new. Prints counts and keys, never file contents.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (name) => argv.includes(name);
const dataDir = argv[0] && !argv[0].startsWith("--") ? path.resolve(argv[0]) : null;
if (!dataDir) {
  console.error("usage: node scripts/restore-files.mjs <data dir> [--apply] [--before <iso> | --manifest <key>] [--scope <service>/] [--overwrite] [--from-dir <folder>]");
  process.exit(2);
}
const APPLY = flag("--apply"), OVERWRITE = flag("--overwrite");
const scope = opt("--scope") || "";
const MANIFEST_PREFIX = `${scope}files-manifest/veritas-files-`, CONTENT_PREFIX = `${scope}files/sha256/`;

// The two calls the restore makes: list keys under a prefix, and read one key into a Buffer.
function bucketStore() {
  const env = process.env;
  const missing = ["BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
  if (missing.length) { console.error(`missing ${missing.join(", ")} (or pass --from-dir)`); process.exit(2); }
  const require = createRequire(import.meta.url);
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = require("@aws-sdk/client-s3");
  // Same client settings as server/backup.ts (path-style, region auto).
  const client = new S3Client({ region: "auto", endpoint: env.BACKUP_S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY } });
  const Bucket = env.BACKUP_S3_BUCKET;
  return {
    async list(prefix) {
      const out = [];
      let token;
      do {
        const r = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of r.Contents || []) out.push(o.Key);
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
  };
}
function folderStore(dir) {
  const root = path.resolve(dir);
  return {
    async list(prefix) {
      const out = [];
      const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const a = path.join(d, e.name); if (e.isDirectory()) walk(a); else { const key = path.relative(root, a).split(path.sep).join("/"); if (key.startsWith(prefix)) out.push(key); } } };
      walk(root);
      return out;
    },
    async get(key) { return fs.readFileSync(path.join(root, key)); },
  };
}

const store = opt("--from-dir") ? folderStore(opt("--from-dir")) : bucketStore();
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
// A manifest key's time: veritas-files-2026-11-22T04-00-06-408Z.json.gz -> 2026-11-22T04:00:06.408Z
const keyTime = (key) => {
  const m = key.slice(MANIFEST_PREFIX.length).match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
};

let manifestKey = opt("--manifest");
if (!manifestKey) {
  const before = opt("--before") ? Date.parse(opt("--before")) : Infinity;
  if (Number.isNaN(before)) { console.error("--before needs an ISO time, for example 2026-11-20T00:00:00Z"); process.exit(2); }
  const keys = (await store.list(MANIFEST_PREFIX)).filter((k) => keyTime(k) < before).sort((a, b) => keyTime(a) - keyTime(b));
  if (!keys.length) { console.error(`no manifest under ${MANIFEST_PREFIX}${opt("--before") ? ` before ${opt("--before")}` : ""}`); process.exit(1); }
  manifestKey = keys[keys.length - 1];
}
const manifest = JSON.parse(zlib.gunzipSync(await store.get(manifestKey)).toString("utf8"));
const files = Array.isArray(manifest.files) ? manifest.files : [];
console.log(`manifest ${manifestKey} (created ${manifest.created_at}, version ${manifest.version}): ${files.length} files, ${files.reduce((a, f) => a + (f.size || 0), 0)} bytes`);
console.log(`${APPLY ? "APPLY" : "DRY RUN"} into ${dataDir}`);

const counts = { written: 0, wouldWrite: 0, alreadyThere: 0, differsLeftAlone: 0, replaced: 0, badPath: 0, failed: 0 };
for (const f of files) {
  // Never write outside the data folder: a path must stay under it once resolved.
  const dest = path.resolve(dataDir, ...String(f.path || "").split("/"));
  if (!f.path || !f.sha256 || !dest.startsWith(dataDir + path.sep)) { counts.badPath++; continue; }
  const exists = fs.existsSync(dest);
  if (exists && sha256(fs.readFileSync(dest)) === f.sha256) { counts.alreadyThere++; continue; }
  if (exists && !OVERWRITE) { counts.differsLeftAlone++; continue; }
  if (!APPLY) { counts.wouldWrite++; continue; }
  try {
    const body = await store.get(`${CONTENT_PREFIX}${f.sha256}`);
    if (sha256(body) !== f.sha256 || (typeof f.size === "number" && body.length !== f.size)) throw new Error("content does not match the manifest");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.restore-${process.pid}`;
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, dest);
    if (exists) counts.replaced++; else counts.written++;
  } catch (e) {
    counts.failed++;
    console.log(`  FAILED ${f.path}: ${e.message}`);
  }
}
console.log(Object.entries(counts).map(([k, v]) => `${k} ${v}`).join("; "));
process.exit(counts.failed || counts.badPath ? 1 : 0);
