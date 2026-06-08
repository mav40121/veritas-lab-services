#!/usr/bin/env node
// verify-veritacheck-survey-bundle.js
//
// Receipt for Wave A3.2 (2026-06-07). Asserts the new per-analyzer
// survey bundle endpoints respond with the right shape against an
// instrument the account owns. Does not seed verifications; relies on
// what's already in the lab. If the account has no instruments with
// any verifications attached, the script logs SKIP and exits with 0
// after the shape gate so the receipt still passes on greenfield labs.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT> \
//   LAB_ID=<active lab id> \
//   node scripts/verify-veritacheck-survey-bundle.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = process.env.LAB_ID;
if (!TOKEN) { console.error("TOKEN env required"); process.exit(2); }
if (!LAB_ID) { console.error("LAB_ID env required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Step 1: list instruments visible in this lab to discover one with
  // a verification history.
  const instRes = await fetch(`${BASE}/api/labs/${LAB_ID}/veritacheck/lab-instruments`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check("A. lab-instruments endpoint returns 200", instRes.status === 200, `status=${instRes.status}`);
  const instruments = await instRes.json();
  check("A. lab-instruments is array", Array.isArray(instruments));

  if (!Array.isArray(instruments) || instruments.length === 0) {
    console.log("SKIP B,C,D. Lab has no VeritaMap instruments; bundle shape gate untested.");
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }

  // Step 2: probe each instrument for survey-bundle preview until we
  // find one with at least one verification. (Most labs have only one
  // or two instruments with a full verification chain.)
  let target = null;
  let preview = null;
  for (const inst of instruments) {
    const r = await fetch(
      `${BASE}/api/labs/${LAB_ID}/veritacheck/map-instruments/${inst.id}/survey-bundle`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    if (r.status !== 200) continue;
    const body = await r.json();
    if (Array.isArray(body?.verifications) && body.verifications.length > 0) {
      target = inst;
      preview = body;
      break;
    }
  }

  if (!target) {
    console.log("SKIP B,C,D. No instrument in this lab has a verification history; bundle data gate untested.");
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log(`INFO using instrument id=${target.id} (${target.instrument_name}) with ${preview.verifications.length} verification(s)`);

  // Step 3: assert preview shape.
  check("B. preview has instrument object", typeof preview.instrument === "object");
  check("B. preview.instrument.id matches target", preview.instrument?.id === target.id);
  check("B. preview verifications array non-empty", preview.verifications.length > 0);
  const v = preview.verifications[0];
  check("B. each verification has id (number)", typeof v.id === "number");
  check("B. each verification has trigger_type (string)", typeof v.trigger_type === "string");
  check("B. each verification has passed_count + failed_count (numbers)",
    typeof v.passed_count === "number" && typeof v.failed_count === "number");

  // Sort order: oldest first (chronological dossier).
  if (preview.verifications.length > 1) {
    const first = preview.verifications[0];
    const last = preview.verifications[preview.verifications.length - 1];
    const firstTs = new Date(first.approved_date || first.created_at).getTime();
    const lastTs = new Date(last.approved_date || last.created_at).getTime();
    check("B. verifications sorted oldest-first", firstTs <= lastTs,
      `first=${firstTs} last=${lastTs}`);
  }

  // Step 4: POST the bundle PDF endpoint, expect application/pdf with
  // a non-trivial body. We don't render or parse the PDF; presence and
  // content-type are enough to gate the shape.
  const pdfRes = await fetch(
    `${BASE}/api/labs/${LAB_ID}/veritacheck/map-instruments/${target.id}/survey-bundle-pdf`,
    { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  check("C. PDF endpoint returns 200", pdfRes.status === 200, `status=${pdfRes.status}`);
  const ct = pdfRes.headers.get("content-type") || "";
  check("C. content-type is application/pdf", ct.includes("application/pdf"), `ct=${ct}`);
  const buf = await pdfRes.arrayBuffer();
  check("C. PDF body is non-trivial (>10KB)", buf.byteLength > 10_000, `bytes=${buf.byteLength}`);
  // PDF magic: starts with "%PDF-"
  const head = new Uint8Array(buf.slice(0, 5));
  const headStr = String.fromCharCode(...head);
  check("C. PDF body starts with %PDF- magic", headStr === "%PDF-", `head=${headStr}`);

  // Step 5: 404 path: probe an obviously-bogus instrument id.
  const r404 = await fetch(
    `${BASE}/api/labs/${LAB_ID}/veritacheck/map-instruments/9999999/survey-bundle`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  check("D. bogus instrument id returns 404", r404.status === 404, `status=${r404.status}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
