#!/usr/bin/env node
// verify-policy-summary-coverage.js
//
// Receipt for Wave A2.3 scaffold (2026-06-07). New endpoint
// GET /api/veritapolicy/templates/coverage returns every system
// policy template with CFR-block count + plain_language_summary
// status. Sorted descending by CFR-block count so the priority
// "what to author next" list surfaces the highest-exposure templates.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   node scripts/verify-policy-summary-coverage.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Branch A: endpoint responds + shape
  const r = await fetch(`${BASE}/api/veritapolicy/templates/coverage`);
  check("A. endpoint returns 200 (no auth required)", r.status === 200, `status=${r.status}`);
  const body = await r.json();
  check("A. payload has templates array", Array.isArray(body?.templates));
  check("A. payload reports total matching templates.length",
    body?.total === body?.templates?.length);
  check("A. payload reports authored count",
    typeof body?.authored === "number");
  check("A. payload reports outstanding = total - authored",
    body?.outstanding === body?.total - body?.authored);

  // Branch B: row shape
  const rows = body?.templates || [];
  if (rows.length === 0) {
    console.error("FAIL B. No templates discovered — template loader broken?");
    process.exit(1);
  }
  const sample = rows[0];
  check("B. row carries policy_id + policy_name", typeof sample.policy_id === "string" && typeof sample.policy_name === "string");
  check("B. row carries cfr_block_count", typeof sample.cfr_block_count === "number");
  check("B. row carries has_summary boolean", typeof sample.has_summary === "boolean");
  check("B. row carries summary_length", typeof sample.summary_length === "number");

  // Branch C: at least the 59 known templates are discovered
  check("C. discovered at least 50 templates (catalog ~59)", rows.length >= 50,
    `count=${rows.length}`);

  // Branch D: rows sorted ascending? no — descending by cfr_block_count
  let monotone = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].cfr_block_count > rows[i-1].cfr_block_count) { monotone = false; break; }
  }
  check("D. rows sorted DESC by cfr_block_count", monotone);

  // Branch E: top_10_to_author is the head of the unsummarized rows
  check("E. top_10_to_author is at most 10 items", Array.isArray(body?.top_10_to_author) && body.top_10_to_author.length <= 10);
  // Initial state: every row should be unsummarized, so top 10 = first 10 rows
  if (body.outstanding === body.total) {
    const expectedTop = rows.slice(0, 10).map((r) => r.policy_id);
    const actualTop = body.top_10_to_author.map((r) => r.policy_id);
    check("E. top_10_to_author matches sorted head (all unauthored)",
      JSON.stringify(expectedTop) === JSON.stringify(actualTop),
      `expected=${expectedTop} actual=${actualTop}`);
  } else {
    console.log("SKIP E. some templates already authored; top_10 head ordering not strictly comparable");
  }

  // Branch F: pretty-print the top 5 for human eyeball
  console.log("");
  console.log("Top 5 templates by CFR-block count (priority for authoring):");
  rows.slice(0, 5).forEach((r) => {
    console.log(`  #${r.policy_id} ${r.policy_name} — ${r.cfr_block_count} blocks, summary=${r.has_summary ? "authored" : "missing"}`);
  });

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  console.log(`Catalog: ${body.total} templates, ${body.authored} with summaries, ${body.outstanding} outstanding.`);
  process.exit(fail === 0 ? 0 : 1);
})();
