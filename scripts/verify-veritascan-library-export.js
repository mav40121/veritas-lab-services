#!/usr/bin/env node
// verify-veritascan-library-export.js
//
// Receipt for Wave A1.4 (2026-06-06). VeritaScan document-library
// xlsx export endpoint. Verifies size, Content-Type, and a smoke
// signature in the buffer (zip magic bytes for xlsx).

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

  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/export.xlsx`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  check("A. Export endpoint returns 200", r.status === 200, `status=${r.status}`);

  const ct = r.headers.get("content-type") || "";
  check("B. Content-Type is xlsx", /spreadsheetml/.test(ct), `content-type=${ct}`);

  const cd = r.headers.get("content-disposition") || "";
  check("C. Content-Disposition attachment + .xlsx filename", /attachment/.test(cd) && /\.xlsx/.test(cd), `content-disposition=${cd}`);

  const buf = Buffer.from(await r.arrayBuffer());
  check("D. Body size > 4KB (workbook + About + Documents sheets)", buf.length > 4096, `size=${buf.length}`);

  // xlsx is a zip — should start with PK..
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B;
  check("E. Body starts with ZIP magic bytes (PK..)", isZip);

  // Auth gate: same endpoint without token returns 401
  const ng = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/export.xlsx`);
  check("F. Endpoint requires auth (401 without token)", ng.status === 401, `status=${ng.status}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
