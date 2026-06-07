#!/usr/bin/env node
// verify-policy-audit-trail.js
//
// Receipt for Wave A2.2 (2026-06-07). GET /audit-trail merges
// policy_audit_log + policy_signoffs into one chronological stream.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT> \
//   LAB_ID=3 \
//   DOC_ID=<any policy_documents.id you can read> \
//   node scripts/verify-policy-audit-trail.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const DOC_ID = Number(process.env.DOC_ID || 0);

if (!TOKEN || !LAB_ID || !DOC_ID) {
  console.error("ERROR: TOKEN, LAB_ID, DOC_ID env vars required"); process.exit(2);
}

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Branch A: happy path
  const r = await get(`/api/labs/${LAB_ID}/veritapolicy/documents/${DOC_ID}/audit-trail`);
  check("A. endpoint returns 200", r.status === 200, `status=${r.status} body=${JSON.stringify(r.body).slice(0, 200)}`);
  check("A. payload has events array", Array.isArray(r.body?.events));
  check("A. payload reports total matching events.length",
    r.body?.total === r.body?.events?.length);

  const events = r.body?.events || [];
  if (events.length === 0) {
    console.log("SKIP B-E. Document has no audit_log / signoff history yet.");
    console.log("");
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }

  // Branch B: every event carries kind + ts + action
  const allShapeOk = events.every((e) => (e.kind === "audit_log" || e.kind === "signoff")
    && typeof e.ts === "string" && typeof e.action === "string");
  check("B. every event carries kind + ts + action", allShapeOk);

  // Branch C: ascending chronological order
  let lastTs = -Infinity;
  let inOrder = true;
  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (t < lastTs) { inOrder = false; break; }
    lastTs = t;
  }
  check("C. events sorted ascending by ts", inOrder);

  // Branch D: signoff events carry Part 11 fields
  const signoffs = events.filter((e) => e.kind === "signoff");
  if (signoffs.length > 0) {
    const allHaveSig = signoffs.every((s) => typeof s.typed_signature === "string");
    check("D. signoff events carry typed_signature", allHaveSig);
    const allHaveHash = signoffs.every((s) => typeof s.signed_document_hash === "string"
      && s.signed_document_hash.length >= 32);
    check("D. signoff events carry signed_document_hash", allHaveHash);
  } else {
    console.log("SKIP D. No signoff events on this document.");
  }

  // Branch E: cross-lab attempt returns 403
  // Try a foreign lab id; assume 999999 doesn't exist OR isn't ours. Server
  // first checks doc existence (404) then lab match (403). To get 403 we'd
  // need a real doc in another lab; just check unauth = 401 instead.
  const unauth = await fetch(`${BASE}/api/labs/${LAB_ID}/veritapolicy/documents/${DOC_ID}/audit-trail`);
  check("E. unauthenticated request returns 401", unauth.status === 401, `status=${unauth.status}`);

  // Branch F: nonexistent doc id returns 404
  const ghost = await get(`/api/labs/${LAB_ID}/veritapolicy/documents/999999999/audit-trail`);
  check("F. nonexistent doc returns 404", ghost.status === 404, `status=${ghost.status}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
