#!/usr/bin/env node
/**
 * provision-scahc-clarence-wesley.js
 *
 * Provisions a comped (1 year free) Clinic-tier secondary lab for John Hall
 * (user_id=15, john.hall@scahealth.org) under the San Carlos Apache
 * Healthcare Corporation system.
 *
 * New lab identity:
 *   Lab name:  "SCAHC - Clarence Wesley"
 *   CLIA:      "03D0907018"
 *   Address:   9a Clarence Wesley Health Center Loop, Bylas, AZ 88530
 *              (not stored in DB; recorded here for audit. The labs
 *              schema has no address column. John can capture this in
 *              VeritaLab certificate notes if needed.)
 *
 * Plan:        Clinic tier ($999/yr published, 2 active seats included,
 *              add-on seats $500/seat). Comped for 1 year free; the
 *              subscription_expires_at + plan_expires_at columns are
 *              set to (today + 365 days) so the system stops allowing
 *              usage at the year mark and forces a renewal decision.
 *
 * Seat math:   John's owner row carries is_primary_lab=0 here (his
 *              primary stays SCAHC main, lab_id=2). He gets a free
 *              owner row on this lab; the 3 staff seats are NOT
 *              created by this script — John invites them via the
 *              LabMembers UI on the new lab after provisioning.
 *
 * Calls /api/admin/provision-comp-lab on production with the new
 * expiresAt parameter (added in PR alongside this script). ADMIN_SECRET
 * is pulled from Railway env at run time and never echoed (CLAUDE.md
 * section 12).
 *
 * Run with:
 *   node scripts/provision-scahc-clarence-wesley.js
 *
 * Re-running is safe: the endpoint refuses to insert a duplicate CLIA,
 * so the second run returns a 409 and exits non-zero rather than
 * creating a second lab.
 */
import { execSync } from "child_process";

const TARGET_USER_ID = 15;
const TARGET_EMAIL = "john.hall@scahealth.org";
const PRIMARY_LAB_ID = 2; // SCAHC main
const LAB_NAME = "SCAHC - Clarence Wesley";
const CLIA_NUMBER = "03D0907018";
const PLAN = "clinic";
const ACCREDITATION_BODY = "TJC"; // SCAHC's accreditor matches the main lab
const PROD_BASE = "https://www.veritaslabservices.com";

// 1 year free comp: subscription + plan both expire 365 days from today.
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const EXPIRES_AT = new Date(Date.now() + ONE_YEAR_MS).toISOString();

// Project / service / environment IDs are public-ish (they appear in
// Railway dashboard URLs). The Railway API TOKEN is the only secret,
// and it MUST come from the environment at run time, never hardcoded.
const PROJECT_ID = "29c628f1-7860-4fca-8fee-227159bb86e8";
const ENVIRONMENT_ID = "cd669f7c-23f3-434c-895d-ca40ac504e91";
const SERVICE_ID = "170f5560-8cf0-4341-9c87-294062ebedd1";

function pullAdminSecret() {
  const railwayToken = process.env.RAILWAY_TOKEN;
  if (!railwayToken) {
    throw new Error("RAILWAY_TOKEN env var not set. Export it before running.");
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
    accreditationBody: ACCREDITATION_BODY,
    expiresAt: EXPIRES_AT,
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
  const data = await res.json();
  const rows = data.labs || data.users || (Array.isArray(data) ? data : []);
  return rows.filter(
    (r) => r.id === TARGET_USER_ID || (r.email || "").toLowerCase() === TARGET_EMAIL,
  );
}

(async () => {
  console.log("--- Provision SCAHC Clarence Wesley secondary lab for John Hall ---");
  console.log(`Target user:      id=${TARGET_USER_ID} ${TARGET_EMAIL}`);
  console.log(`Lab name:         ${LAB_NAME}`);
  console.log(`CLIA:             ${CLIA_NUMBER}`);
  console.log(`Plan:             ${PLAN} (free, no Stripe)`);
  console.log(`Expires:          ${EXPIRES_AT}  (~365 days)`);
  console.log("");

  console.log("[1/3] Pulling ADMIN_SECRET from Railway env...");
  const adminSecret = pullAdminSecret();
  console.log("      ok");

  console.log("[2/3] Calling /api/admin/provision-comp-lab...");
  const result = await provisionLab(adminSecret);
  console.log(
    `      ok - new lab_id=${result.lab.id}, plan=${result.lab.plan}, is_primary_lab=${result.membership.is_primary_lab}, role=${result.membership.role}`,
  );
  console.log(`      subscription_expires_at=${result.lab.subscription_expires_at}`);
  console.log(`      plan_expires_at=${result.lab.plan_expires_at}`);

  console.log("[3/3] Verifying via /api/admin/report...");
  const johnRows = await verifyReport(adminSecret);
  console.log(`      John now has ${johnRows.length} lab membership row(s):`);
  for (const r of johnRows) {
    const flag = r.is_primary_lab === 1 ? "PRIMARY  " : "secondary";
    console.log(
      `        - lab_id=${r.lab_id}  [${flag}]  ${r.lab_name || r.effective_lab_name || "?"}  (role=${r.lab_role || "?"}, plan=${r.plan}, seats=${r.seat_count ?? "?"})`,
    );
  }

  // Invariants
  const fails = [];
  const primaryRows = johnRows.filter((r) => r.is_primary_lab === 1);
  const newRow = johnRows.find((r) => r.lab_id === result.lab.id);
  const mainRow = johnRows.find((r) => r.lab_id === PRIMARY_LAB_ID);

  if (primaryRows.length !== 1) fails.push(`expected exactly 1 primary lab, got ${primaryRows.length}`);
  if (!mainRow || mainRow.is_primary_lab !== 1) fails.push(`SCAHC main (lab_id=${PRIMARY_LAB_ID}) is not flagged is_primary_lab=1`);
  if (!newRow) fails.push(`new lab (lab_id=${result.lab.id}) not visible in admin report`);
  if (newRow && newRow.is_primary_lab !== 0) fails.push(`new lab is_primary_lab=${newRow.is_primary_lab}, expected 0`);
  if (newRow && newRow.lab_role !== "owner") fails.push(`new lab role=${newRow.lab_role}, expected owner`);

  // Expiration check: parseable to a date 350-380 days from now (rounding).
  const expiresMs = Date.parse(result.lab.subscription_expires_at);
  const nowMs = Date.now();
  const daysOut = (expiresMs - nowMs) / (24 * 60 * 60 * 1000);
  if (daysOut < 350 || daysOut > 380) {
    fails.push(`subscription_expires_at ${result.lab.subscription_expires_at} is ${daysOut.toFixed(1)} days out, expected ~365`);
  }
  if (result.lab.plan_expires_at !== result.lab.subscription_expires_at) {
    fails.push(`plan_expires_at and subscription_expires_at out of sync`);
  }

  console.log("");
  if (fails.length === 0) {
    console.log("PASS - all invariants hold.");
    console.log(`  John's primary stays SCAHC main (lab_id=${PRIMARY_LAB_ID}).`);
    console.log(`  New lab id=${result.lab.id} is John's secondary (Clinic, free for 1 year).`);
    console.log(`  Expires: ${result.lab.subscription_expires_at}`);
    console.log("");
    console.log("Next step: John invites his 3 staff via the LabMembers UI on the new lab.");
    process.exit(0);
  } else {
    console.log("FAIL - invariants violated:");
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
