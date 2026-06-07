#!/usr/bin/env node
// verify-veritascan-storage-provider.js
//
// Receipt for Wave A1.2 (2026-06-06). storage_provider is now required
// on POST and cannot be cleared on PATCH; ?filter=needs-review surfaces
// existing NULL-storage_provider rows for cleanup.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for an owner-tier lab member> \
//   LAB_ID=2 \
//   node scripts/verify-veritascan-storage-provider.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

const today = new Date().toISOString().slice(0, 10);
const nextYear = (() => {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
})();

async function post(body) {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function patch(id, body) {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function del(id) {
  await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  const baseBody = {
    title: "A1.2 verify - happy path",
    document_type: "policy",
    external_url: "https://example.com/a12-verify",
    effective_date: today,
    review_due_date: nextYear,
  };

  // Branch A: POST without storage_provider returns 400
  const a = await post({ ...baseBody });
  check("A. POST missing storage_provider returns 400",
    a.status === 400 && /storage_provider/i.test(a.body?.error || ""),
    `status=${a.status} err=${a.body?.error}`);

  // Branch B: POST with invalid storage_provider returns 400
  const b = await post({ ...baseBody, storage_provider: "not_a_real_provider" });
  check("B. POST invalid storage_provider returns 400",
    b.status === 400 && /storage_provider/i.test(b.body?.error || ""),
    `status=${b.status} err=${b.body?.error}`);

  // Branch C: POST with valid storage_provider returns 200
  const c = await post({ ...baseBody, storage_provider: "sharepoint" });
  check("C. POST valid storage_provider returns 200",
    c.status === 200 && c.body?.id && c.body?.storage_provider === "sharepoint",
    `status=${c.status} body=${JSON.stringify(c.body).slice(0,200)}`);
  const docId = c.body?.id;

  // Branch D: PATCH clearing storage_provider returns 400
  if (docId) {
    const d = await patch(docId, { storage_provider: "" });
    check("D. PATCH clearing storage_provider returns 400",
      d.status === 400 && /cannot be cleared/i.test(d.body?.error || ""),
      `status=${d.status} err=${d.body?.error}`);
  }

  // Branch E: PATCH switching storage_provider returns 200
  if (docId) {
    const e = await patch(docId, { storage_provider: "google_drive" });
    check("E. PATCH switching storage_provider returns 200",
      e.status === 200 && e.body?.storage_provider === "google_drive",
      `status=${e.status} body=${JSON.stringify(e.body).slice(0,200)}`);
  }

  // Cleanup
  if (docId) await del(docId);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
