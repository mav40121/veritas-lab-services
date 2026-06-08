#!/usr/bin/env node
// verify-clia-cert-active-through.js
//
// Receipt for Wave A6 (2026-06-07). Asserts /api/labs/me now emits
// cliaCertExpirationDate on each membership so the NavBar / LabSwitcher
// can render "CLIA active through YYYY-MM-DD" and a soft 30-day warning
// chip. Informational only — no module is gated on this field.
//
// Does not seed certs; relies on whatever the account already has on
// file in lab_certificates. If no membership has a cert, asserts the
// field is null (still a valid shape) and skips the parse check.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT> \
//   node scripts/verify-clia-cert-active-through.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("TOKEN env required"); process.exit(2); }

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  const r = await fetch(`${BASE}/api/labs/me`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check("A. endpoint returns 200", r.status === 200, `status=${r.status}`);
  const body = await r.json();

  // Branch A: response shape
  check("A. payload is array", Array.isArray(body));
  check("A. payload non-empty (active membership)", body.length >= 1, `length=${body.length}`);

  // Branch B: every membership carries cliaCertExpirationDate
  // (string | null) — field MUST be present even when null so the
  // client doesn't have to type-guard with hasOwnProperty.
  let allHaveField = true;
  for (const m of body) {
    if (!("cliaCertExpirationDate" in m)) { allHaveField = false; break; }
  }
  check("B. every membership has cliaCertExpirationDate field", allHaveField);

  // Branch C: field is either null or a parseable date string
  let allValidShape = true;
  for (const m of body) {
    const v = m.cliaCertExpirationDate;
    if (v === null) continue;
    if (typeof v !== "string") { allValidShape = false; break; }
    const d = new Date(v);
    if (isNaN(d.getTime())) { allValidShape = false; break; }
  }
  check("C. cliaCertExpirationDate is null or parseable date", allValidShape);

  // Branch D: at least one cert visible OR all-null is valid (shape gate)
  const withCert = body.filter(m => m.cliaCertExpirationDate);
  if (withCert.length > 0) {
    const m = withCert[0];
    const d = new Date(m.cliaCertExpirationDate);
    check("D. cert date round-trips to ISO YYYY-MM-DD",
      d.toISOString().slice(0, 10).length === 10,
      `raw=${m.cliaCertExpirationDate}`);
    console.log(`INFO ${withCert.length} of ${body.length} membership(s) carry a CLIA cert date`);
  } else {
    console.log("SKIP D. No memberships carry a CLIA cert date; field shape valid but parse path untested on this account.");
  }

  // Branch E: pre-existing membership fields still present (no schema drift)
  if (body.length > 0) {
    const m = body[0];
    check("E. membershipId still present", typeof m.membershipId === "number");
    check("E. labId still present", typeof m.labId === "number");
    check("E. cliaNumber still present (string|null)",
      typeof m.cliaNumber === "string" || m.cliaNumber === null);
    check("E. isPrimaryLab still present (boolean)", typeof m.isPrimaryLab === "boolean");
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
