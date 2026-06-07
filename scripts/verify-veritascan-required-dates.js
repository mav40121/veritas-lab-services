#!/usr/bin/env node
// verify-veritascan-required-dates.js
//
// Receipt for Wave A1.1 (2026-06-06). VeritaScan POST /documents now
// requires effective_date (YYYY-MM-DD); review_due_date is required
// after the lab_document_type_defaults auto-fill resolution. PATCH
// rejects clearing either field once set. GET ?filter=needs-review
// surfaces rows that predate the gate (NULL or past due) so the lab
// can clean up without a destructive DB-level NOT NULL constraint.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for an owner-tier lab member> \
//   LAB_ID=2 \
//   node scripts/verify-veritascan-required-dates.js
//
// Read-mostly. Creates one test document (then archives it) to exercise
// PATCH; otherwise non-destructive.

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
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return r.status;
}
async function listNeedsReview() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/veritascan/documents?filter=needs-review&include_archived=1`, {
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

  // Branch A: POST without effective_date → 400
  const a = await post({
    title: "A1.1 verify - missing effective_date",
    document_type: "policy",
    external_url: "https://example.com/test",
    review_due_date: nextYear,
  });
  check("A. POST missing effective_date returns 400", a.status === 400 && /effective_date/i.test(a.body?.error || ""), `status=${a.status} err=${a.body?.error}`);

  // Branch B: POST with malformed effective_date → 400
  const b = await post({
    title: "A1.1 verify - bad effective_date",
    document_type: "policy",
    external_url: "https://example.com/test",
    effective_date: "not-a-date",
    review_due_date: nextYear,
  });
  check("B. POST bad effective_date format returns 400", b.status === 400 && /effective_date/i.test(b.body?.error || ""), `status=${b.status} err=${b.body?.error}`);

  // Branch C: POST with valid effective_date + review_due_date → 200
  const c = await post({
    title: "A1.1 verify - happy path",
    document_type: "policy",
    external_url: "https://example.com/a11-verify",
    effective_date: today,
    review_due_date: nextYear,
  });
  check("C. POST with valid dates returns 200", c.status === 200 && c.body?.id && c.body?.effective_date === today, `status=${c.status} body=${JSON.stringify(c.body).slice(0,200)}`);
  const docId = c.body?.id;

  // Branch D: POST missing review_due_date with NO type default → 400
  const d = await post({
    title: "A1.1 verify - missing review",
    document_type: "other",
    external_url: "https://example.com/test2",
    effective_date: today,
  });
  // Note: this may pass if a default exists for "other" in this lab.
  // We accept either 400 (no default) or 200 (default auto-filled).
  if (d.status === 400 && /review_due_date/i.test(d.body?.error || "")) {
    check("D. POST missing review_due_date with no default returns 400", true);
  } else if (d.status === 200 && d.body?.review_due_date) {
    check("D. POST missing review_due_date with type default auto-fills (200)", true);
    // Clean up
    if (d.body?.id) await del(d.body.id);
  } else {
    check("D. POST missing review_due_date behaves correctly", false, `status=${d.status} body=${JSON.stringify(d.body).slice(0,200)}`);
  }

  // Branch E: PATCH cannot clear effective_date
  if (docId) {
    const e = await patch(docId, { effective_date: "" });
    check("E. PATCH clearing effective_date returns 400", e.status === 400 && /cannot be cleared/i.test(e.body?.error || ""), `status=${e.status} err=${e.body?.error}`);
  }

  // Branch F: PATCH can move effective_date forward
  if (docId) {
    const newEffective = "2026-07-01";
    const f = await patch(docId, { effective_date: newEffective });
    check("F. PATCH moving effective_date forward returns 200", f.status === 200 && f.body?.effective_date === newEffective, `status=${f.status} body=${JSON.stringify(f.body).slice(0,200)}`);
  }

  // Branch G: GET ?filter=needs-review returns array
  const g = await listNeedsReview();
  check("G. GET ?filter=needs-review returns 200 + array", g.status === 200 && Array.isArray(g.body), `status=${g.status}`);
  // Our just-created doc has today's effective_date + nextYear review — should NOT be in the needs-review list
  if (g.status === 200 && Array.isArray(g.body) && docId) {
    const inList = g.body.some((d) => d.id === docId);
    check("G. Our just-created compliant doc is NOT in needs-review", !inList, `docId ${docId} present in list of ${g.body.length}`);
  }

  // Cleanup: archive the test doc
  if (docId) await del(docId);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
