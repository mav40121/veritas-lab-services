// Nightly off-site backup of the production SQLite database to a
// Google Drive folder owned by the operator. Env-gated: when
// GOOGLE_DRIVE_SA_JSON or GOOGLE_DRIVE_BACKUP_FOLDER_ID is unset,
// runNightlyBackup() logs a skip and returns without throwing.
//
// Operator setup (Michael):
//   1. Create a Google Cloud project, enable the Drive API
//   2. Create a service account, download its JSON key
//   3. Create a Drive folder named "VeritaAssure Backups"
//   4. Share the folder with the service account email (Editor access)
//   5. Set GOOGLE_DRIVE_SA_JSON to the JSON key contents (single line)
//      and GOOGLE_DRIVE_BACKUP_FOLDER_ID to the folder ID from the URL
//
// Schedule: server/index.ts wires runNightlyBackup() into the same
// 24-hour scheduler shape as the existing snapshot + reminder jobs,
// at 04:00 UTC (clear of the midnight-UTC snapshot work).

import { google } from "googleapis";
import * as fs from "fs";
import * as zlib from "zlib";
import { Resend } from "resend";
import { db } from "./db";

const BACKUP_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
const SA_JSON = process.env.GOOGLE_DRIVE_SA_JSON;
const RETENTION_DAYS = 30;
const FAILURE_NOTIFY_TO = "info@veritaslabservices.com";

let driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (driveClient) return driveClient;
  if (!SA_JSON || !BACKUP_FOLDER_ID) return null;

  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(SA_JSON);
  } catch {
    console.error("[backup] GOOGLE_DRIVE_SA_JSON is not valid JSON; backups disabled until fixed");
    return null;
  }
  if (!creds.client_email || !creds.private_key) {
    console.error("[backup] GOOGLE_DRIVE_SA_JSON missing client_email or private_key; backups disabled");
    return null;
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });

  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
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
             <p>Check Railway logs and the Drive folder. The on-demand <code>/api/admin/backup-db</code> endpoint is unaffected and can be used as a fallback.</p>`,
    });
  } catch (emailErr: any) {
    console.error("[backup] Failure notification email also failed:", emailErr?.message || emailErr);
  }
}

export async function runNightlyBackup() {
  const drive = getDriveClient();
  if (!drive) {
    console.log("[backup] Skipped: GOOGLE_DRIVE_SA_JSON or GOOGLE_DRIVE_BACKUP_FOLDER_ID not set");
    return;
  }

  const startedAt = Date.now();
  console.log("[backup] Starting nightly off-site backup to Google Drive");

  try {
    const sqlite = (db as any).$client;
    // WAL checkpoint so all WAL-pending writes land in the main DB file
    // before we read it. Matches the on-demand /api/admin/backup-db flow.
    sqlite.pragma("wal_checkpoint(TRUNCATE)");
    const dbPath: string = sqlite.name;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `veritas-backup-${timestamp}.db.gz`;
    const tmpPath = `/tmp/${filename}`;

    // Gzip the SQLite file to /tmp so the network upload is smaller and so
    // we can stream from disk rather than holding the whole DB in memory.
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

    const uploadResult = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [BACKUP_FOLDER_ID!],
      },
      media: {
        mimeType: "application/gzip",
        body: fs.createReadStream(tmpPath),
      },
      fields: "id, name, size, createdTime",
    });

    try { fs.unlinkSync(tmpPath); } catch {}

    const elapsedMs = Date.now() - startedAt;
    console.log(`[backup] Uploaded ${uploadResult.data.name} (${compressedBytes} bytes gzipped) to Drive in ${elapsedMs}ms`);

    // Retention: delete files older than RETENTION_DAYS from the backup
    // folder. Uses drive.files.list query with a createdTime filter, then
    // issues delete calls per stale file. drive.file scope only sees files
    // the service account created, so this never touches anything else
    // the operator stores in Drive.
    const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const oldFiles = await drive.files.list({
      q: `'${BACKUP_FOLDER_ID}' in parents and createdTime < '${cutoffIso}' and trashed = false`,
      fields: "files(id, name, createdTime)",
      pageSize: 100,
    });

    let pruned = 0;
    for (const file of oldFiles.data.files || []) {
      try {
        await drive.files.delete({ fileId: file.id! });
        pruned++;
      } catch (err: any) {
        console.error(`[backup] Failed to prune ${file.name}: ${err?.message || err}`);
      }
    }
    if (pruned > 0) console.log(`[backup] Pruned ${pruned} backup(s) older than ${RETENTION_DAYS} days`);

  } catch (err: any) {
    console.error("[backup] FAILED:", err?.message || err);
    if (err?.stack) console.error(err.stack);
    await notifyFailure(err instanceof Error ? err : new Error(String(err)));
  }
}
