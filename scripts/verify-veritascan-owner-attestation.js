#!/usr/bin/env node
// verify-veritascan-owner-attestation.js
//
// Receipt for Wave A1.3 (2026-06-06). lab_documents now requires
// owner_user_id at POST + cannot be cleared on PATCH. Server
// auto-fills owner_name from the users row and stamps
// owner_attested_at on every change. needs-review filter surfaces
// rows with NULL owner_user_id.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const OWNER_USER_ID = Number(process.env.OWNER_USER_ID || 17);
const OTHER_USER_ID = Number(process.env.OTHER_USER_ID || 0);

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
    title: "A1.3 verify - happy path",
    document_type: "policy",
    external_url: "https://example.com/a13-verify",
    storage_provider: "sharepoint",
    effective_date: today,
    review_due_date: nextYear,
  };

  // Branch A: POST without owner_user_id returns 400
  const a = await post({ ...baseBody });
  check("A. POST missing owner_user_id returns 400",
    a.status === 400 && /owner_user_id/i.test(a.body?.error || ""),
    `status=${a.status} err=${a.body?.error}`);

  // Branch B: POST with bogus owner_user_id (not a lab member) returns 400
  const b = await post({ ...baseBody, owner_user_id: 999999 });
  check("B. POST owner_user_id not in lab returns 400",
    b.status === 400 && /active member/i.test(b.body?.error || ""),
    `status=${b.status} err=${b.body?.error}`);

  // Branch C: POST with valid owner_user_id returns 200 + stamps name/attested
  const c = await post({ ...baseBody, owner_user_id: OWNER_USER_ID });
  check("C. POST valid owner_user_id returns 200",
    c.status === 200 && c.body?.id && c.body?.owner_user_id === OWNER_USER_ID,
    `status=${c.status} body=${JSON.stringify(c.body).slice(0,200)}`);
  check("C. owner_name stamped from users row",
    c.status === 200 && typeof c.body?.owner_name === "string" && c.body.owner_name.length > 0,
    `owner_name=${c.body?.owner_name}`);
  check("C. owner_attested_at stamped as ISO",
    c.status === 200 && typeof c.body?.owner_attested_at === "string" && /^\d{4}-\d{2}-\d{2}T/.test(c.body.owner_attested_at),
    `owner_attested_at=${c.body?.owner_attested_at}`);
  const docId = c.body?.id;
  const firstAttested = c.body?.owner_attested_at;

  // Branch D: PATCH clearing owner_user_id returns 400
  if (docId) {
    const d = await patch(docId, { owner_user_id: null });
    check("D. PATCH owner_user_id=null returns 400",
      d.status === 400 && /owner_user_id/i.test(d.body?.error || ""),
      `status=${d.status} err=${d.body?.error}`);
  }

  // Branch E: PATCH changing owner_user_id refreshes owner_attested_at
  if (docId && OTHER_USER_ID && OTHER_USER_ID !== OWNER_USER_ID) {
    await new Promise(r => setTimeout(r, 50)); // ensure clock moves
    const e = await patch(docId, { owner_user_id: OTHER_USER_ID });
    check("E. PATCH switching owner returns 200",
      e.status === 200 && e.body?.owner_user_id === OTHER_USER_ID,
      `status=${e.status} body=${JSON.stringify(e.body).slice(0,200)}`);
    check("E. owner_attested_at refreshed on switch",
      e.status === 200 && e.body?.owner_attested_at && e.body.owner_attested_at !== firstAttested,
      `before=${firstAttested} after=${e.body?.owner_attested_at}`);
  } else {
    console.log("SKIP E. owner switch (set OTHER_USER_ID env to a 2nd active lab member to enable)");
  }

  // Cleanup
  if (docId) await del(docId);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
