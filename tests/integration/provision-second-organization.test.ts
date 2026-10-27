// tests/integration/provision-second-organization.test.ts
//
// Receipt for provision-system organization.newOrganization (2026-10-27, Michael Q14 = 1: a three-site demo system he
// owns must not fold into his existing "A - Veritas QA System"). Boots the REAL routes on a scratch DB and proves:
//   1. without the option, a second provision for the same billing owner reuses (and renames) their organization,
//      exactly as before
//   2. with newOrganization: true the dry run reports a new organization and writes nothing
//   3. the real run creates a separate organization: its labs carry the new organization id, the owner is its
//      org_owner, and the first organization keeps its name and labs
//   4. the owner's seat cap still reads the pool of the organization holding their oldest lab (deterministic)
// Run (from bash): DB_PATH=.tmp-org2.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/provision-second-organization.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { orgSeatCapForOwner } = await import("../../server/organizationSeats");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const email = `org2-${Date.now()}@example.com`;
  await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Org Two Owner", hipaa_acknowledged: true });
  await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Owner Home Lab", plan: "enterprise", isWarehouse: true });
  const ownerId = (sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id as number;
  const provision = (body: any) => call("POST", "/api/admin/organizations/provision-system", { secret: ADMIN, ...body });

  const first = await provision({ organization: { name: "Owner QA System", billingOwnerUserId: ownerId, activeSeatPool: 25 }, labs: [{ labName: "QA Lab One", cliaNumber: "11D9000001" }] });
  const orgA = first.j.organizationId ?? first.j.org?.id ?? (sqlite.prepare("SELECT id FROM organizations WHERE billing_owner_user_id = ? ORDER BY id LIMIT 1").get(ownerId) as any)?.id;
  check("fixture: the owner bills one organization with one lab", first.s === 200 && !!orgA, JSON.stringify(first.j).slice(0, 200));

  const reuseDry = await provision({ dryRun: true, organization: { name: "Renamed", billingOwnerUserId: ownerId }, labs: [{ labName: "QA Lab Two", cliaNumber: "11D9000002" }] });
  check("1. without newOrganization the dry run reuses the owner's organization (unchanged behavior)", reuseDry.j.org?.reuseExisting === true && reuseDry.j.org?.existingOrgId === orgA && reuseDry.j.org?.newOrganization === false, JSON.stringify(reuseDry.j.org));

  const orgCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM organizations WHERE billing_owner_user_id = ?").get(ownerId) as any).n;
  const demoLabs = [
    { labName: "Demo Hospital A", cliaNumber: "11D9000101", accreditation: "TJC" },
    { labName: "Demo Hospital B", cliaNumber: "11D9000102", accreditation: "CAP" },
    { labName: "Demo Hospital C", cliaNumber: "11D9000103", accreditation: "COLA" },
  ];
  const newDry = await provision({ dryRun: true, organization: { name: "Demo Health System", billingOwnerUserId: ownerId, newOrganization: true }, labs: demoLabs });
  check("2. with newOrganization the dry run reports a new organization and writes nothing",
    newDry.j.org?.newOrganization === true && newDry.j.org?.reuseExisting === false && orgCount() === 1 && newDry.j.labs?.every((l: any) => l.action === "create"),
    JSON.stringify(newDry.j.org));

  const made = await provision({ organization: { name: "Demo Health System", billingOwnerUserId: ownerId, newOrganization: true }, labs: demoLabs });
  const orgB = (sqlite.prepare("SELECT id FROM organizations WHERE billing_owner_user_id = ? AND name = 'Demo Health System'").get(ownerId) as any)?.id;
  const labsB = sqlite.prepare("SELECT lab_name, organization_id, owner_user_id, accreditation_tjc, accreditation_cap, accreditation_cola FROM labs WHERE clia_number IN ('11D9000101','11D9000102','11D9000103') ORDER BY lab_name").all() as any[];
  const orgARow = sqlite.prepare("SELECT name FROM organizations WHERE id = ?").get(orgA) as any;
  const orgALabs = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE organization_id = ?").get(orgA) as any).n;
  const ownerRole = (sqlite.prepare("SELECT org_role FROM organization_members WHERE organization_id = ? AND user_id = ? AND status = 'active'").get(orgB, ownerId) as any)?.org_role;
  check("3a. a separate organization is created and its three labs carry its id, owned by the owner",
    made.s === 200 && !!orgB && orgB !== orgA && orgCount() === 2 && labsB.length === 3 && labsB.every((l) => l.organization_id === orgB && l.owner_user_id === ownerId),
    JSON.stringify({ s: made.s, orgA, orgB, labsB }));
  check("3b. accreditation flags follow each lab (A TJC, B CAP, C COLA)", labsB[0].accreditation_tjc === 1 && labsB[1].accreditation_cap === 1 && labsB[2].accreditation_cola === 1, JSON.stringify(labsB));
  check("3c. the owner is org_owner of the new organization", ownerRole === "org_owner", String(ownerRole));
  check("3d. the first organization keeps its name and its lab", orgARow?.name === "Owner QA System" && orgALabs === 1, JSON.stringify({ name: orgARow?.name, labs: orgALabs }));

  const cap = orgSeatCapForOwner(sqlite, ownerId, null, 1);
  check("4. the seat cap still reads the pool of the organization holding the owner's oldest lab (25)", cap === 25, String(cap));

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
