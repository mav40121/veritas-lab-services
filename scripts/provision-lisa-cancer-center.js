#!/usr/bin/env node
/**
 * provision-lisa-cancer-center.js
 *
 * Provisions a comped (free) Clinic-tier secondary lab for Lisa Veri
 * (user_id=33, lisa.veri@umassmemorial.org). The new lab is linked via
 * lab_members with is_primary_lab=0 so Lisa does NOT burn a paid seat on
 * it — her one paid seat continues to sit on her primary lab (UMass
 * Memorial Health - Milford Regional Medical Center, lab_id=4).
 *
 * Placeholders are used for lab name and CLIA number; the operator will
 * swap them in via the lab settings UI before any report is generated
 * under this lab (CLAUDE.md §5 — CLIA freezes on first report).
 *
 * Calls /api/admin/provision-comp-lab on production. ADMIN_SECRET is
 * pulled from Railway env at run time and never written to a file or
 * echoed (CLAUDE.md §12).
 *
 * Run with:
 *   node scripts/provision-lisa-cancer-center.js
 *
 * Re-running is safe: the endpoint refuses to insert a duplicate CLIA,
 * so the second run returns a 409 and exits non-zero rather than
 * creating a second lab.
 */
import { execSync } from "child_process";

const TARGET_USER_ID = 33;
const TARGET_EMAIL = "lisa.veri@umassmemorial.org";
const PRIMARY_LAB_ID = 4;
const LAB_NAME = "Lisa Veri Cancer Center Lab (placeholder)";
const CLIA_NUMBER = "PENDING-CC-2026";
const PLAN = "clinic";
const PROD_BASE = "https://www.veritaslabservices.com";

// Project / service / environment IDs are public-ish (they appear in
// Railway dashboard URLs). The Railway API TOKEN is the only secret,
// and it MUST come from the environment at run time — never hardcoded
// here, per CLAUDE.md §12 CREDENTIAL HANDLING.
const PROJECT_ID = "29c628f1-7860-4fca-8fee-227159bb86e8";
const ENVIRONMENT_ID = "cd669f7c-23f3-434c-895d-ca40ac504e91";
const SERVICE_ID = "170f5560-8cf0-4341-9c87-294062ebedd1";

function pullAdminSecret() {
  const railwayToken = process.env.RAILWAY_TOKEN;
  if (!railwayToken) {
    throw new Error("RAILWAY_TOKEN env var not set. Export it before running: $env:RAILWAY_TOKEN='...'");
  }
  const query = `query { variables(projectId: "${PROJECT_ID}", environmentId: "${ENVIRONMENT_ID}", serviceId: "${SERVICE_ID}") }`;
  const body = JSON.stringify({ query });
  const cmd = `curl -s -X POST https://backboard.railway.com/graphql/v2 -H "Authorization: Bearer ${railwayToken}" -H "Content-Type: application/json" -d ${JSON.stringify(body)}`;
  const out = execSync(cmd, { encoding: "utf8" });
  const json = JSON.parse(out);
  const secret = json?.data?.variables?.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET not found in Railway env response");
  return secret;
}

async function provisionLab(adminSecret) {
  const body = {
    secret: adminSecret,
    userId: TARGET_USER_ID,
    labName: LAB_NAME,
    cliaNumber: CLIA_NUMBER,
    plan: PLAN,
  };
  const res = await fetch(`${PROD_BASE}/api/admin/provision-comp-lab`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`provision-comp-lab failed: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function verifyReport(adminSecret) {
  const res = await fetch(`${PROD_BASE}/api/admin/report`, {
    headers: { "x-admin-secret": adminSecret },
  });
  if (!res.ok) throw new Error(`/api/admin/report failed: ${res.status}`);
  const rows = await res.json();
  const lisaRows = rows.filter(
    (r) => r.id === TARGET_USER_ID || (r.email || "").toLowerCase() === TARGET_EMAIL,
  );
  return lisaRows;
}

(async () => {
  console.log("--- Provision Lisa Veri cancer center secondary lab ---");
  console.log(`Target user:      id=${TARGET_USER_ID} ${TARGET_EMAIL}`);
  console.log(`Lab name:         ${LAB_NAME}`);
  console.log(`CLIA placeholder: ${CLIA_NUMBER}`);
  console.log(`Plan:             ${PLAN} (free, no Stripe)`);
  console.log("");

  console.log("[1/3] Pulling ADMIN_SECRET from Railway env...");
  const adminSecret = pullAdminSecret();
  console.log("      ok");

  console.log("[2/3] Calling /api/admin/provision-comp-lab...");
  const result = await provisionLab(adminSecret);
  console.log(`      ok — new lab_id=${result.lab.id}, is_primary_lab=${result.membership.is_primary_lab}, role=${result.membership.role}`);

  console.log("[3/3] Verifying via /api/admin/report...");
  const lisaRows = await verifyReport(adminSecret);
  console.log(`      Lisa now has ${lisaRows.length} lab_members row(s):`);
  for (const r of lisaRows) {
    const flag = r.is_primary_lab === 1 ? "PRIMARY " : "secondary";
    console.log(`        - lab_id=${r.lab_id}  [${flag}]  ${r.lab_name}  (role=${r.lab_role}, plan=${r.plan}, seats=${r.seat_count})`);
  }

  // Invariants
  const fails = [];
  const primaryRows = lisaRows.filter((r) => r.is_primary_lab === 1);
  const secondaryRows = lisaRows.filter((r) => r.is_primary_lab === 0 && r.lab_id != null);
  const milfordRow = lisaRows.find((r) => r.lab_id === PRIMARY_LAB_ID);
  const newRow = lisaRows.find((r) => r.lab_id === result.lab.id);

  if (primaryRows.length !== 1) fails.push(`expected exactly 1 primary lab, got ${primaryRows.length}`);
  if (!milfordRow || milfordRow.is_primary_lab !== 1) fails.push(`Milford (lab_id=${PRIMARY_LAB_ID}) is not flagged is_primary_lab=1`);
  if (!newRow) fails.push(`new lab (lab_id=${result.lab.id}) not visible in admin report`);
  if (newRow && newRow.is_primary_lab !== 0) fails.push(`new lab is_primary_lab=${newRow.is_primary_lab}, expected 0`);
  if (newRow && newRow.lab_role !== "owner") fails.push(`new lab role=${newRow.lab_role}, expected owner`);
  if (secondaryRows.length < 1) fails.push(`expected at least 1 secondary lab, got ${secondaryRows.length}`);

  console.log("");
  if (fails.length === 0) {
    console.log("PASS — all invariants hold. Lisa's seat math is unchanged on Milford; she is a free owner on the new cancer center lab.");
    console.log("");
    console.log("Next step: have Lisa update lab name and CLIA number via the lab settings UI before generating any report under this lab.");
    process.exit(0);
  } else {
    console.log("FAIL — invariants violated:");
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
