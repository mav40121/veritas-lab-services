// tests/integration/org-attach-lab.test.ts
//
// POST /api/admin/organizations/:orgId/attach-lab (Michael 2026-10-15: "add LW Test Lab to my demo
// system"). Links ONE lab, including one with no CLIA, to an organization whose billing owner owns it;
// refuses another owner's lab and a lab in another organization; dryRun writes nothing; the owner's
// other unlinked labs stay unlinked (the backfill path would have swept them in).
// Run: DB_PATH=.tmp-attach.db JWT_SECRET=t ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/org-attach-lab.test.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const pw = ["Zq", "attach", "7x!"].join("-");
  const post = async (p: string, body: any) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const ownerEmail = `it-attach-owner-${Date.now()}@example.com`;
    const otherEmail = `it-attach-other-${Date.now()}@example.com`;
    await post("/api/auth/register", { email: ownerEmail, password: pw, name: "Owner", hipaa_acknowledged: true });
    await post("/api/auth/register", { email: otherEmail, password: pw, name: "Other", hipaa_acknowledged: true });
    const owner = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail) as any;
    const sys = await post("/api/admin/organizations/provision-system", { secret: ADMIN, organization: { name: "IT Demo System", billingOwnerUserId: owner.id, plan: "enterprise" }, labs: [{ labName: "IT Member Lab", cliaNumber: "99D9990001" }] });
    const orgId = Number(sys.body?.organization?.id);
    check("0. organization provisioned", Number.isInteger(orgId) && orgId > 0, JSON.stringify(sys.body).slice(0, 120));
    const noClia = await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "IT Test Lab (no CLIA)", plan: "hospital" });
    const spare = await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "IT Prospect Lab", plan: "hospital" });
    const foreign = await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: otherEmail, labName: "IT Foreign Lab", plan: "hospital" });
    const labId = Number(noClia.body?.labId), spareId = Number(spare.body?.labId), foreignId = Number(foreign.body?.labId);
    const orgOf = (id: number) => (sqlite.prepare("SELECT organization_id FROM labs WHERE id = ?").get(id) as any)?.organization_id ?? null;

    const dry = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId, dryRun: true });
    check("1. dryRun returns the plan and writes nothing", dry.status === 200 && dry.body.action === "attach" && orgOf(labId) === null, JSON.stringify(dry.body));
    const bad = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: "wrong", labId });
    check("2. a wrong secret is refused", bad.status === 403 && orgOf(labId) === null);
    const ok = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId });
    check("3. a lab with no CLIA is attached", ok.status === 200 && ok.body.action === "attached" && orgOf(labId) === orgId, JSON.stringify(ok.body));
    check("4. the owner's other unlinked lab stays unlinked", orgOf(spareId) === null);
    const again = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId });
    check("5. attaching again is a no-op", again.status === 200 && again.body.action === "already_attached");
    const fr = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId: foreignId });
    check("6. another owner's lab is refused", fr.status === 409 && orgOf(foreignId) === null, JSON.stringify(fr.body).slice(0, 120));
    const otherOwner = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(otherEmail) as any;
    const sys2 = await post("/api/admin/organizations/provision-system", { secret: ADMIN, organization: { name: "IT Other System", billingOwnerUserId: otherOwner.id }, labs: [{ labName: "IT Other Lab", cliaNumber: "99D9990002" }] });
    const org2 = Number(sys2.body?.organization?.id);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(org2, spareId);
    const cross = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId: spareId });
    check("7. a lab already in another organization is refused", cross.status === 409 && orgOf(spareId) === org2);
    const missing = await post(`/api/admin/organizations/${orgId}/attach-lab`, { secret: ADMIN, labId: 999999 });
    check("8. an unknown lab is 404", missing.status === 404);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
