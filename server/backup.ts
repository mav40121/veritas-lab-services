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

import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as zlib from "zlib";
import { Resend } from "resend";
import { db } from "./db";

const S3_ENDPOINT = process.env.BACKUP_S3_ENDPOINT;
const S3_BUCKET = process.env.BACKUP_S3_BUCKET;
const S3_ACCESS_KEY_ID = process.env.BACKUP_S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
const RETENTION_DAYS = 30;
const FAILURE_NOTIFY_TO = "info@veritaslabservices.com";

let s3Client: S3Client | null = null;

function getS3Client() {
  if (s3Client) return s3Client;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return null;
  }
  s3Client = new S3Client({
    region: "auto",
    endpoint: S3_ENDPOINT,
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
