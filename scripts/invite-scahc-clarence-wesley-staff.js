#!/usr/bin/env node
/**
 * invite-scahc-clarence-wesley-staff.js
 *
 * Mints 3 edit_all invites on John Hall's SCAHC - Clarence Wesley lab
 * (lab_id=6) and prints the invite URLs. Recipients are:
 *
 *   1. yauweh.daniels@scahealth.org   (writer, edit_all)
 *   2. cindy.hinton@scahealth.org     (writer, edit_all)
 *   3. verilabguy@gmail.com           (writer, edit_all) - operator's
 *      test account for exercising the multi-lab switcher.
 *
 * Calls /api/admin/create-lab-invite on production with ADMIN_SECRET
 * pulled from Railway env at run time. The endpoint creates a pending
 * user_seats row carrying lab_id=6, generates a UUID invite_token, and
 * (when the email maps to an existing user) also creates a lab_members
 * row so the user sees the new lab on next login.
 *
 * Re-running is safe: the endpoint returns 409 on duplicate seat email
 * under the lab owner, so a second run reports each address as already
 * invited rather than minting a fresh token.
 *
 * Run with:
 *   node scripts/invite-scahc-clarence-wesley-staff.js
 */
import { execSync } from "child_process";

const LAB_ID = 6;
const ROLE = "staff";
const PERMISSIONS_MODE = "edit_all";
const RECIPIENTS = [
  "yauweh.daniels@scahealth.org",
  "cindy.hinton@scahealth.org",
  "verilabguy@gmail.com",
];
const PROD_BASE = "https://www.veritaslabservices.com";

const PROJECT_ID = "29c628f1-7860-4fca-8fee-227159bb86e8";
const ENVIRONMENT_ID = "cd669f7c-23f3-434c-895d-ca40ac504e91";
const SERVICE_ID = "170f5560-8cf0-4341-9c87-294062ebedd1";

function pullAdminSecret() {
  const railwayToken = process.env.RAILWAY_TOKEN;
  if (!railwayToken) {
    throw new Error("RAILWAY_TOKEN env var not set.");
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

async function createInvite(adminSecret, email) {
  const body = {
    secret: adminSecret,
    labId: LAB_ID,
    email,
    role: ROLE,
    permissionsMode: PERMISSIONS_MODE,
  };
  const res = await fetch(`${PROD_BASE}/api/admin/create-lab-invite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { ok: res.ok, status: res.status, body: json };
}

(async () => {
  console.log(`--- Mint edit_all invites for SCAHC - Clarence Wesley (lab_id=${LAB_ID}) ---`);
  console.log("");

  console.log("[1/2] Pulling ADMIN_SECRET from Railway env...");
  const adminSecret = pullAdminSecret();
  console.log("      ok");
  console.log("");

  const results = [];
  for (const email of RECIPIENTS) {
    process.stdout.write(`[2/2] ${email} ... `);
    const r = await createInvite(adminSecret, email);
    if (r.ok) {
      console.log(`ok (${r.body.preexistingUser ? "existing user, also added as lab_members row" : "pending invite"})`);
      results.push({ email, ok: true, inviteUrl: r.body.inviteUrl, preexistingUser: r.body.preexistingUser });
    } else {
      console.log(`FAIL ${r.status} ${JSON.stringify(r.body)}`);
      results.push({ email, ok: false, error: r.body });
    }
  }

  console.log("");
  console.log("=== INVITE LINKS (edit_all) ===");
  console.log("");
  for (const r of results) {
    if (r.ok) {
      console.log(`${r.email}`);
      console.log(`  ${r.inviteUrl}`);
      if (r.preexistingUser) {
        console.log(`  (already has an account, lab will appear in their NavBar switcher on next login)`);
      }
      console.log("");
    } else {
      console.log(`${r.email}`);
      console.log(`  ERROR: ${JSON.stringify(r.error)}`);
      console.log("");
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
