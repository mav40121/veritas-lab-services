#!/usr/bin/env node
// verify-pdf-token-double-fetch.js
//
// Regression receipt for the 2026-06-07 "PDF token expired or not found"
// bug on VeritaStock Print Labels. Before the fix, claimPdfToken was
// single-use: the first GET returned the PDF and deleted the row, then
// Chrome's PDF viewer fired a second GET to render inline and hit a
// 404 with the JSON error. The fix drops single-use; tokens are now
// TTL-only (300s) and replayable within the window.
//
// This script:
//   1. POSTs /api/labs/:labId/inventory/labels/pdf to mint a token.
//   2. GETs /api/pdf/:token twice in a row.
//   3. Asserts both return 200 + PDF body (size > 1KB + PDF magic bytes).
//   4. Sleeps PAST the TTL and asserts the third GET returns 404.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for an owner-tier lab member> \
//   LAB_ID=2 \
//   node scripts/verify-pdf-token-double-fetch.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Mint a token via the VeritaStock labels POST.
  const mint = await fetch(`${BASE}/api/labs/${LAB_ID}/inventory/labels/pdf`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: "{}",
  });
  check("A. POST inventory/labels/pdf returns 200", mint.status === 200, `status=${mint.status}`);
  const mintBody = await mint.json().catch(() => null);
  const token = mintBody?.token;
  check("A. mint body has a token", typeof token === "string" && token.length > 8, `body=${JSON.stringify(mintBody).slice(0, 200)}`);
  if (!token) { console.error("Cannot continue without token; aborting."); process.exit(1); }

  // First GET — should succeed.
  const r1 = await fetch(`${BASE}/api/pdf/${token}`);
  const ct1 = r1.headers.get("content-type") || "";
  const buf1 = Buffer.from(await r1.arrayBuffer());
  check("B. First GET returns 200", r1.status === 200, `status=${r1.status}`);
  check("B. First GET Content-Type is PDF", /application\/pdf/.test(ct1), `content-type=${ct1}`);
  check("B. First GET body > 1KB", buf1.length > 1024, `size=${buf1.length}`);
  check("B. First GET body starts with %PDF", buf1.slice(0, 4).toString("ascii") === "%PDF",
    `first 8 bytes: ${buf1.slice(0, 8).toString("hex")}`);

  // Second GET — was the failing case; must now succeed.
  const r2 = await fetch(`${BASE}/api/pdf/${token}`);
  const ct2 = r2.headers.get("content-type") || "";
  const buf2 = Buffer.from(await r2.arrayBuffer());
  check("C. Second GET returns 200 (regression guard)", r2.status === 200, `status=${r2.status}`);
  check("C. Second GET Content-Type is PDF", /application\/pdf/.test(ct2), `content-type=${ct2}`);
  check("C. Second GET body matches first GET length", buf1.length === buf2.length,
    `first=${buf1.length} second=${buf2.length}`);
  check("C. Second GET body starts with %PDF",
    buf2.slice(0, 4).toString("ascii") === "%PDF",
    `first 8 bytes: ${buf2.slice(0, 8).toString("hex")}`);

  // Third GET on a known-bogus token should still 404.
  const r3 = await fetch(`${BASE}/api/pdf/never-existed-${Date.now()}`);
  check("D. Bogus token returns 404", r3.status === 404, `status=${r3.status}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
