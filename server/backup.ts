// Nightly off-site backup of the production SQLite database to an
// S3-compatible bucket. Env-gated: when any of the four BACKUP_S3_*
// vars is missing, runNightlyBackup() logs a skip and returns without
// throwing.
//
// Today's target is Cloudflare R2 (S3-compatible, free 10 GB tier),
// but any S3-compatible endpoint works: AWS S3, Backblaze B2, Wasabi,
// MinIO, etc. The code only depends on the standard PutObject /
// ListObjectsV2 / DeleteObject calls.
//
// Operator setup (Cloudflare R2):
//   1. Sign up at cloudflare.com, subscribe to R2 (free tier)
//   2. Create a bucket (default storage class, automatic region)
//   3. Create an R2 API token scoped to the bucket with Object
//      Read & Write permission
//   4. Note the S3 endpoint (https://<account-id>.r2.cloudflarestorage.com)
//      and the bucket name, Access Key ID, Secret Access Key
//   5. Set 4 env vars in Railway:
//        BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET,
//        BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
//
// Schedule: server/index.ts wires runNightlyBackup() at 04:00 UTC.
//
// Integrity verification: each run records a 5-point health check on the
// production DB to backup_integrity_log. Resend alert fires on any
// failed check. See checkBackupIntegrity() below.

import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as zlib from "zlib";
import { Resend } from "resend";
import { db } from "./db";

const S3_ENDPOINT = process.env.BACKUP_S3_ENDPOINT;
const S3_BUCKET = process.env.BACKUP_S3_BUCKET;
const S3_ACCESS_KEY_ID = process.env.BACKUP_S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
const RETENTION_DAYS = 730;
const FAILURE_NOTIFY_TO = "info@veritaslabservices.com";

// Integrity verification thresholds. These are conservative floors,
// not exact-match expectations. The schema can add tables without
// alerting; what we catch is "this backup is structurally broken"
// or "the database lost a meaningful amount of data".
const MIN_BACKUP_FILE_SIZE_BYTES = 100 * 1024;  // 100 KB compressed; anything smaller is suspect
const MIN_TABLE_COUNT = 40;                     // floor; the live schema has well over this

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return null;
  }
  s3Client = new S3Client({
    region: "auto",
    endpoint: S3_ENDPOINT,
    // Use path-style addressing (account-id.r2.cloudflarestorage.com/bucket/key)
    // rather than the SDK's default virtual-hosted style
    // (bucket.account-id.r2.cloudflarestorage.com). Cloudflare R2's TLS cert
    // doesn't always cover the virtual-hosted subdomain pattern, causing
    // sslv3 handshake failures. Path-style matches R2's documented endpoint
    // shape and works across all S3-compatible providers we'd realistically
    // swap to (AWS S3, Backblaze B2, MinIO, Wasabi).
    forcePathStyle: true,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

async function notifyFailure(err: Error) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: "VeritaAssure System <info@veritaslabservices.com>",
      to: FAILURE_NOTIFY_TO,
      subject: "[VeritaAssure] Nightly backup FAILED",
      html: `<p>The nightly off-site backup job failed at ${new Date().toISOString()}.</p>
             <p><strong>Error:</strong> ${err.message}</p>
             <pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:11px;overflow:auto;">${err.stack || "no stack"}</pre>
             <p>Check Railway logs and the R2 bucket. The on-demand <code>/api/admin/backup-db</code> endpoint is unaffected and can be used as a fallback.</p>`,
    });
  } catch (emailErr: any) {
    console.error("[backup] Failure notification email also failed:", emailErr?.message || emailErr);
  }
}

async function notifyIntegrityIssue(checks: Record<string, any>, filename: string) {
  if (!process.env.RESEND_API_KEY) return;
  const failed = Object.entries(checks).filter(([_, c]: [string, any]) => !c.ok);
  if (failed.length === 0) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const rows = failed
      .map(
        ([name, c]: [string, any]) =>
          `<tr><td style="padding:6px 12px;border:1px solid #ddd"><strong>${name}</strong></td><td style="padding:6px 12px;border:1px solid #ddd"><code>${JSON.stringify(c)}</code></td></tr>`,
      )
      .join("");
    await resend.emails.send({
      from: "VeritaAssure System <info@veritaslabservices.com>",
      to: FAILURE_NOTIFY_TO,
      subject: "[VeritaAssure] Backup integrity check ANOMALY",
      html: `<p>The nightly off-site backup uploaded successfully (${filename}), but one or more integrity checks did not pass at ${new Date().toISOString()}.</p>
             <p>The backup file is in R2 and recoverable. This alert is so you can investigate whether the anomaly reflects a real data issue or an expected operational change (e.g., a test account intentionally deleted).</p>
             <table style="border-collapse:collapse;font-size:12px">
               <tr style="background:#f0f0f0"><th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Check</th><th style="padding:6px 12px;border:1px solid #ddd;text-align:left">Detail</th></tr>
               ${rows}
             </table>
             <p style="margin-top:16px;color:#666">Full results logged to the <code>backup_integrity_log</code> table.</p>`,
    });
  } catch (emailErr: any) {
    console.error("[backup] Integrity anomaly email failed:", emailErr?.message || emailErr);
  }
}

// Runs the 5-point integrity check against the live production database,
// records the result in backup_integrity_log, and returns the per-check
// breakdown. Does NOT throw on failure (backup upload continues regardless;
// integrity issues alert separately via notifyIntegrityIssue).
function checkBackupIntegrity(gzippedFileBytes: number): { ok: boolean; checks: Record<string, any> } {
  const sqlite = (db as any).$client;
  const prior = sqlite
    .prepare(
      "SELECT user_count, real_user_count, study_count, table_count FROM backup_integrity_log WHERE all_ok = 1 ORDER BY id DESC LIMIT 1",
    )
    .get() as any;

  // 1. File size: catches corrupt/empty uploads
  const fileSizeOk = gzippedFileBytes >= MIN_BACKUP_FILE_SIZE_BYTES;

  // 2. SQLite structural integrity: PRAGMA integrity_check returns 'ok' or a list of errors
  let integrityResult: string;
  try {
    integrityResult = String(sqlite.pragma("integrity_check", { simple: true }) ?? "");
  } catch (err: any) {
    integrityResult = `error: ${err?.message ?? err}`;
  }
  const integrityOk = integrityResult === "ok";

  // 3. User count: stable or increasing vs prior successful run.
  // The OK decision is based on REAL users only. Internal/test accounts live
  // solely on Michael-owned domains (veritaslabservices.com, veritaslab.com);
  // no external customer uses them. QA/Playwright accounts (qa-*@veritaslabservices.com)
  // are created and torn down constantly, which used to false-trip this check
  // (e.g. 32 -> 28) with no real customer loss. We keep the all-accounts total
  // for continuity but gate the alert on the real-user count.
  const REAL_USER_PREDICATE = "email NOT LIKE '%@veritaslabservices.com' AND email NOT LIKE '%@veritaslab.com'";
  const userCount = (sqlite.prepare("SELECT COUNT(*) as cnt FROM users").get() as any).cnt as number;
  const realUserCount = (sqlite.prepare(`SELECT COUNT(*) as cnt FROM users WHERE ${REAL_USER_PREDICATE}`).get() as any).cnt as number;
  // Legacy rows have real_user_count = NULL; treat that as "no real-user baseline
  // yet" so the first post-deploy run does not false-alarm on the population change.
  const priorReal = prior?.real_user_count ?? null;
  const userCountOk = realUserCount > 0 && (priorReal == null || realUserCount >= priorReal);

  // 4. Study count: stable or increasing vs prior successful run
  const studyCount = (sqlite.prepare("SELECT COUNT(*) as cnt FROM studies").get() as any).cnt as number;
  const studyCountOk = studyCount >= 0 && (!prior || studyCount >= prior.study_count);

  // 5. Table count: matches expected schema floor
  const tableCount = (sqlite.prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'").get() as any).cnt as number;
  const tableCountOk = tableCount >= MIN_TABLE_COUNT;

  const checks: Record<string, any> = {
    fileSize: { value: gzippedFileBytes, threshold: MIN_BACKUP_FILE_SIZE_BYTES, ok: fileSizeOk },
    sqliteIntegrity: { value: integrityResult, ok: integrityOk },
    userCount: { value: realUserCount, totalAccounts: userCount, prior: priorReal, ok: userCountOk },
    studyCount: { value: studyCount, prior: prior?.study_count ?? null, ok: studyCountOk },
    tableCount: { value: tableCount, threshold: MIN_TABLE_COUNT, prior: prior?.table_count ?? null, ok: tableCountOk },
  };

  const allOk = Object.values(checks).every((c: any) => c.ok);

  sqlite
    .prepare(
      `INSERT INTO backup_integrity_log (file_size_bytes, sqlite_integrity_check, user_count, real_user_count, study_count, table_count, all_ok, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(gzippedFileBytes, integrityResult, userCount, realUserCount, studyCount, tableCount, allOk ? 1 : 0, JSON.stringify(checks));

  return { ok: allOk, checks };
}

export async function runNightlyBackup() {
  const client = getS3Client();
  if (!client) {
    console.log("[backup] Skipped: one or more of BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY is not set");
    return;
  }

  const startedAt = Date.now();
  console.log(`[backup] Starting nightly off-site backup to S3 bucket ${S3_BUCKET}`);

  try {
    const sqlite = (db as any).$client;
    // WAL checkpoint so all WAL-pending writes land in the main DB file
    // before we read it. Matches the on-demand /api/admin/backup-db flow.
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    const dbPath: string = sqlite.name;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `veritas-backup-${timestamp}.db.gz`;
    const tmpPath = `/tmp/${filename}`;

    // Gzip the SQLite file to /tmp so the upload is smaller and so we can
    // stream from disk rather than holding the whole DB in memory.
    await new Promise<void>((resolve, reject) => {
      const source = fs.createReadStream(dbPath);
      const dest = fs.createWriteStream(tmpPath);
      const gzip = zlib.createGzip();
      source.on("error", reject);
      dest.on("error", reject);
      gzip.on("error", reject);
      dest.on("finish", resolve);
      source.pipe(gzip).pipe(dest);
    });

    const compressedBytes = fs.statSync(tmpPath).size;

    await client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: filename,
      Body: fs.createReadStream(tmpPath),
      ContentType: "application/gzip",
      ContentLength: compressedBytes,
    }));

    try { fs.unlinkSync(tmpPath); } catch {}

    const elapsedMs = Date.now() - startedAt;
    console.log(`[backup] Uploaded ${filename} (${compressedBytes} bytes gzipped) to ${S3_BUCKET} in ${elapsedMs}ms`);

    // Integrity verification: 5-point check on the production DB, logged
    // to backup_integrity_log, alert on any failure. The upload above is
    // unaffected; integrity issues do not block the backup, they surface
    // it so the operator can investigate.
    try {
      const integrity = checkBackupIntegrity(compressedBytes);
      if (integrity.ok) {
        console.log("[backup] Integrity check passed: 5/5");
      } else {
        const failed = Object.entries(integrity.checks).filter(([_, c]: [string, any]) => !c.ok).map(([k]) => k);
        console.error(`[backup] Integrity check ANOMALY: ${failed.join(", ")} failed. See backup_integrity_log.`);
        await notifyIntegrityIssue(integrity.checks, filename);
      }
    } catch (intErr: any) {
      console.error("[backup] Integrity check itself threw:", intErr?.message || intErr);
    }

    // Retention: list all backups in the bucket, delete ones older than
    // RETENTION_DAYS. The API token is bucket-scoped so this only sees
    // files in this bucket, not anything else in the operator's account.
    const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      MaxKeys: 1000,
    }));

    let pruned = 0;
    for (const obj of listed.Contents || []) {
      if (!obj.Key || !obj.LastModified) continue;
      if (obj.LastModified.getTime() < cutoffMs) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: obj.Key }));
          pruned++;
        } catch (err: any) {
          console.error(`[backup] Failed to prune ${obj.Key}: ${err?.message || err}`);
        }
      }
    }
    if (pruned > 0) console.log(`[backup] Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days`);

  } catch (err: any) {
    console.error("[backup] FAILED:", err?.message || err);
    if (err?.stack) console.error(err.stack);
    await notifyFailure(err instanceof Error ? err : new Error(String(err)));
  }
}
