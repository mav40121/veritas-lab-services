#!/usr/bin/env node
// verify-veritapolicy-signature-block.js
//
// Receipt for Wave A2.1 (2026-06-07). Strengthened signature block on
// every VeritaPolicy per-policy DOCX. Hits the lab-scoped DOCX route,
// downloads the buffer, and asserts the new strings are present
// (Title line, Annual review due, §493.1251(b)(13) citation).
//
// The DOCX is a zip; we unzip in memory and look in word/document.xml
// for the literal strings the builder emits.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const POLICY_ID = process.env.POLICY_ID || "11";  // Critical Value Reporting (Phase 2 sample)

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  const url = `${BASE}/api/labs/${LAB_ID}/veritapolicy/templates/${POLICY_ID}/docx`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  check("A. DOCX endpoint returns 200", r.status === 200, `status=${r.status} url=${url}`);
  const ct = r.headers.get("content-type") || "";
  check("B. Content-Type is DOCX", /wordprocessingml/.test(ct), `content-type=${ct}`);

  const buf = Buffer.from(await r.arrayBuffer());
  check("C. Body size > 4KB", buf.length > 4096, `size=${buf.length}`);

  // The DOCX is a zip. The docx library packs document content inside
  // word/document.xml. We decompress with the createRequire pattern so
  // this script runs under the repo's "type":"module" without TS.
  const { createRequire } = await import("module");
  const req = createRequire(`${process.cwd()}/package.json`);
  let jszip;
  try { jszip = req("jszip"); }
  catch { console.error("jszip not in node_modules; falling back to substring scan over raw buffer"); }

  let documentXml = "";
  if (jszip) {
    const zip = await jszip.loadAsync(buf);
    const entry = zip.file("word/document.xml");
    if (!entry) {
      check("D. word/document.xml present", false, "missing in zip");
      process.exit(1);
    }
    documentXml = await entry.async("string");
    check("D. word/document.xml extracted", documentXml.length > 1000, `size=${documentXml.length}`);
  } else {
    // Fallback: scan the raw decompressed buffer. Less reliable but
    // catches the literal strings if they're stored uncompressed.
    documentXml = buf.toString("utf8");
    check("D. raw scan path active (jszip not installed)", true);
  }

  // Wave A2.1 assertions — the new strings the signatureBlock now emits.
  check("E. Title line present", /Title/.test(documentXml) && /Laboratory Director or designee/.test(documentXml),
    "missing 'Title' or 'Laboratory Director or designee'");
  check("F. Annual review due line present", /Annual review due/.test(documentXml),
    "missing 'Annual review due'");
  check("G. §493.1251(b)(13) CFR citation present", /493\.1251\(b\)\(13\)/.test(documentXml),
    "missing CFR §493.1251(b)(13) citation");

  // Existing block content still present (regression guard)
  check("H. LABORATORY DIRECTOR OR DESIGNEE REVIEW header preserved",
    /LABORATORY DIRECTOR OR DESIGNEE REVIEW/.test(documentXml), "missing review header");
  check("I. Accepted / Not Accepted checkboxes preserved",
    /Accepted/.test(documentXml) && /Not Accepted/.test(documentXml), "missing accept checkboxes");

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
