/**
 * One-shot: upload the local SCAHC_Policies_Bundle_<date>.zip to John's lab
 * via the admin route POST /api/admin/veritapolicy/labs/:labId/artifacts/bulk.
 *
 * Usage:
 *   ADMIN_SECRET=... SCAHC_LAB_ID=<labId> node scripts/upload-scahc-bundle.js
 *
 * ADMIN_SECRET should be pulled from Railway env at call time, not committed.
 * SCAHC_LAB_ID is John's lab record id; query the admin DB endpoint or pull
 * from the labs table to find it.
 *
 * Looks for the most-recent SCAHC bundle in the Verita Products desktop folder.
 */

import fs from "node:fs";
import path from "node:path";

const ADMIN_SECRET = process.env.ADMIN_SECRET;
const LAB_ID = Number(process.env.SCAHC_LAB_ID || 0);
const PROD_HOST = process.env.PROD_HOST || "https://www.veritaslabservices.com";

if (!ADMIN_SECRET) { console.error("ADMIN_SECRET env var is required"); process.exit(1); }
if (!LAB_ID) { console.error("SCAHC_LAB_ID env var is required"); process.exit(1); }

const BUNDLE_DIR = "C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products";

function findLatestBundle() {
  const candidates = fs.readdirSync(BUNDLE_DIR)
    .filter((f) => /^SCAHC_Policies_Bundle_.*\.zip$/i.test(f))
    .map((f) => ({ f, mtime: fs.statSync(path.join(BUNDLE_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates[0] ? path.join(BUNDLE_DIR, candidates[0].f) : null;
}

async function main() {
  const bundlePath = findLatestBundle();
  if (!bundlePath) { console.error(`No SCAHC bundle found in ${BUNDLE_DIR}`); process.exit(1); }
  const buf = fs.readFileSync(bundlePath);
  console.log(`Uploading: ${bundlePath}  (${(buf.length / 1024).toFixed(1)} KB)`);
  console.log(`           to lab ${LAB_ID} on ${PROD_HOST}`);

  // multipart/form-data body construction
  const boundary = `----VPBoundary${Date.now()}`;
  const filename = path.basename(bundlePath);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="bundle"; filename="${filename}"\r\n` +
    `Content-Type: application/zip\r\n\r\n`,
    "utf-8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");
  const body = Buffer.concat([head, buf, tail]);

  const url = `${PROD_HOST}/api/admin/veritapolicy/labs/${LAB_ID}/artifacts/bulk?secret=${encodeURIComponent(ADMIN_SECRET)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try { console.log(JSON.stringify(JSON.parse(text), null, 2)); } catch { console.log(text); }
  process.exit(res.ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
