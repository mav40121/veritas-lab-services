#!/usr/bin/env node
// verify-veritapt-trends.js
//
// Receipt for Wave A5 (2026-06-07). Hits GET /api/veritapt/trends
// against prod and asserts the response shape + framing strings.
// Does not seed PT events (no admin write path); relies on whatever
// graded events the account already has. If the account has 0 graded
// events, asserts the trends array is empty (still a valid shape).
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT> \
//   node scripts/verify-veritapt-trends.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("TOKEN env required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  const r = await fetch(`${BASE}/api/veritapt/trends`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check("A. endpoint returns 200", r.status === 200, `status=${r.status}`);
  const body = await r.json();

  // Branch A: response shape
  check("A. payload has counts object", typeof body?.counts === "object");
  check("A. counts has OK + WATCH + AT_RISK fields",
    typeof body?.counts?.OK === "number" &&
    typeof body?.counts?.WATCH === "number" &&
    typeof body?.counts?.AT_RISK === "number");
  check("A. payload has trends array", Array.isArray(body?.trends));
  check("A. payload has framing object", typeof body?.framing === "object");

  // Branch B: framing strings carry the §493.803 reference (the CLIA hook)
  check("B. AT-RISK framing cites §493.803",
    (body.framing?.["AT-RISK"] || "").includes("493.803"));
  check("B. WATCH framing cites §493.803",
    (body.framing?.WATCH || "").includes("493.803"));

  // Branch C: trend rows have expected shape
  if (body.trends && body.trends.length > 0) {
    const t = body.trends[0];
    check("C. trend row has analyte string", typeof t.analyte === "string");
    check("C. trend row has state in {OK, WATCH, AT-RISK}",
      ["OK", "WATCH", "AT-RISK"].includes(t.state),
      `state=${t.state}`);
    check("C. trend row carries last3 array",
      Array.isArray(t.last3) && t.last3.length <= 3,
      `last3=${JSON.stringify(t.last3)}`);
    check("C. trend row carries fails_in_last_3 number",
      typeof t.fails_in_last_3 === "number");
    // Engine consistency: state should match fails_in_last_3
    let expected = "OK";
    if (t.fails_in_last_3 >= 2) expected = "AT-RISK";
    else if (t.fails_in_last_3 === 1) expected = "WATCH";
    check("C. state matches fails_in_last_3", t.state === expected,
      `state=${t.state} expected=${expected} fails=${t.fails_in_last_3}`);
  } else {
    console.log("SKIP C. No graded PT events on this account; engine path untested but shape valid.");
  }

  // Branch D: counts sum equals trends.length
  if (body.trends) {
    const sum = (body.counts?.OK || 0) + (body.counts?.WATCH || 0) + (body.counts?.AT_RISK || 0);
    check("D. counts sum equals trends.length", sum === body.trends.length,
      `sum=${sum} length=${body.trends.length}`);
  }

  // Branch E: sort order (AT-RISK first, then WATCH, then OK)
  if (body.trends && body.trends.length > 1) {
    const rank = { "AT-RISK": 0, "WATCH": 1, "OK": 2 };
    let ordered = true;
    for (let i = 1; i < body.trends.length; i++) {
      if (rank[body.trends[i].state] < rank[body.trends[i-1].state]) {
        ordered = false; break;
      }
    }
    check("E. trends sorted by state severity DESC", ordered);
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
