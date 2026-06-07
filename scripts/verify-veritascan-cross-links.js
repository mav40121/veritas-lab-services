#!/usr/bin/env node
// verify-veritascan-cross-links.js
//
// Receipt for Wave A1.5 (2026-06-06). Cross-link slots between
// VeritaScan documents and other-module entities. Tests POST validation,
// UNIQUE constraint, GET-by-document, reverse lookup, DELETE.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const OWNER_USER_ID = Number(process.env.OWNER_USER_ID || 17);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

const today = new Date().toISOString().slice(0, 10);
const nextYear = (() => {
  const d = new Date(); d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
})();

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function del(path) {
  const r = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Setup: create a fresh document to attach cross-links to.
  const c = await post(`/api/labs/${LAB_ID}/veritascan/documents`, {
    title: "A1.5 cross-link test doc",
    document_type: "policy",
    external_url: "https://example.com/a15-verify",
    storage_provider: "sharepoint",
    effective_date: today,
    review_due_date: nextYear,
    owner_user_id: OWNER_USER_ID,
  });
  if (c.status !== 200 || !c.body?.id) {
    console.error("SETUP FAILED: cannot create source document; halting.");
    console.error(JSON.stringify(c).slice(0, 200));
    process.exit(1);
  }
  const docId = c.body.id;
  const TARGET_MODULE = "veritapolicy";
  const TARGET_ENTITY = 99999; // arbitrary, no consumer required

  // Branch A: POST with bad module returns 400
  const a = await post(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`, {
    target_module: "not_a_module",
    target_entity_id: TARGET_ENTITY,
  });
  check("A. POST bad target_module returns 400",
    a.status === 400 && /target_module/i.test(a.body?.error || ""),
    `status=${a.status} err=${a.body?.error}`);

  // Branch B: POST with missing entity returns 400
  const b = await post(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`, {
    target_module: TARGET_MODULE,
  });
  check("B. POST missing target_entity_id returns 400",
    b.status === 400 && /target_entity_id/i.test(b.body?.error || ""),
    `status=${b.status} err=${b.body?.error}`);

  // Branch C: POST happy path returns 200 + created row
  const c2 = await post(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`, {
    target_module: TARGET_MODULE,
    target_entity_id: TARGET_ENTITY,
    target_entity_label: "Critical Value Reporting policy",
    notes: "Linked via verify script",
  });
  check("C. POST happy path returns 200",
    c2.status === 200 && c2.body?.id && c2.body?.target_module === TARGET_MODULE && c2.body?.target_entity_id === TARGET_ENTITY,
    `status=${c2.status} body=${JSON.stringify(c2.body).slice(0,200)}`);
  const linkId = c2.body?.id;

  // Branch D: duplicate POST returns 400 (UNIQUE constraint)
  const d = await post(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`, {
    target_module: TARGET_MODULE,
    target_entity_id: TARGET_ENTITY,
  });
  check("D. Duplicate cross-link returns 400 (UNIQUE)",
    d.status === 400 && /already exists/i.test(d.body?.error || ""),
    `status=${d.status} err=${d.body?.error}`);

  // Branch E: GET by document returns the link
  const e = await get(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`);
  check("E. GET by document returns array including the new link",
    e.status === 200 && Array.isArray(e.body) && e.body.some((l) => l.id === linkId),
    `status=${e.status} count=${Array.isArray(e.body) ? e.body.length : "?"}`);

  // Branch F: GET reverse by target returns the link (with joined doc data)
  const f = await get(`/api/labs/${LAB_ID}/veritascan/cross-links/by-target/${TARGET_MODULE}/${TARGET_ENTITY}`);
  check("F. GET by target returns the link with joined doc fields",
    f.status === 200 && Array.isArray(f.body) && f.body.some((l) => l.id === linkId && l.document_title === "A1.5 cross-link test doc"),
    `status=${f.status} count=${Array.isArray(f.body) ? f.body.length : "?"}`);

  // Branch G: reverse lookup with bad module returns 400
  const g = await get(`/api/labs/${LAB_ID}/veritascan/cross-links/by-target/not_a_module/1`);
  check("G. Reverse lookup bad module returns 400", g.status === 400, `status=${g.status}`);

  // Branch H: DELETE removes the link
  if (linkId) {
    const h = await del(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links/${linkId}`);
    check("H. DELETE link returns 200", h.status === 200 && h.body?.ok === true, `status=${h.status} body=${JSON.stringify(h.body).slice(0,200)}`);
    const verify = await get(`/api/labs/${LAB_ID}/veritascan/documents/${docId}/cross-links`);
    check("H. After DELETE, link not in GET-by-document list",
      verify.status === 200 && Array.isArray(verify.body) && !verify.body.some((l) => l.id === linkId));
  }

  // Cleanup: archive the test document
  await del(`/api/labs/${LAB_ID}/veritascan/documents/${docId}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
