// tests/integration/admin-attach-lab-to-org.test.ts
//
// Michael 2026-11-10 ("Create a lab for jesse wilson and put it into my lab group ... Make him the owner"):
// POST /api/admin/labs/attach-to-org links one lab with no organization to an organization and changes nothing else.
// Made-up users, labs and an org on a fresh database. It checks:
//   1. the route refuses without the admin header
//   2. bad ids are 400; an unknown lab or organization is 404
//   3. without confirm it is a dry run: it answers the plan and writes nothing
//   4. with confirm a lab owned by someone other than the org's billing owner joins the org; owner, memberships and
//      seats are unchanged
//   5. a lab already in that org answers alreadyAttached and writes nothing; a lab in another org is 409
// Run: rm -f .tmp-attachorg.db && DB_PATH=.tmp-attachorg.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/admin-attach-lab-to-org.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const orgOwner = insert("users", { email: "orgowner-attach@example.test", name: "Made-up Org Owner", plan: "enterprise", seat_count: 0 });
  const labOwner = insert("users", { email: "labowner-attach@example.test", name: "Made-up Lab Owner", plan: "enterprise", seat_count: 0 });
  const org = insert("organizations", { name: "Made-up QA System", billing_owner_user_id: orgOwner });
  const other = insert("organizations", { name: "Made-up Other System", billing_owner_user_id: labOwner });
  const lab = insert("labs", { lab_name: "Made-up Test Lab", owner_user_id: labOwner, plan: "enterprise", organization_id: null });
  const inOrg = insert("labs", { lab_name: "Made-up Linked Lab", owner_user_id: orgOwner, plan: "enterprise", organization_id: org });
  const inOther = insert("labs", { lab_name: "Made-up Elsewhere Lab", owner_user_id: labOwner, plan: "enterprise", organization_id: other });
  insert("lab_members", { lab_id: lab, user_id: labOwner, role: "owner", status: "active", is_primary_lab: 1 });
  insert("lab_members", { lab_id: lab, user_id: orgOwner, role: "admin", status: "active", is_primary_lab: 0 });
  insert("user_seats", { owner_user_id: labOwner, lab_id: lab, seat_email: "orgowner-attach@example.test", seat_user_id: orgOwner, seat_type: "active", status: "active" });

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const post = async (body: unknown, hdr = true) => {
    const r = await fetch(`${base}/api/admin/labs/attach-to-org`, { method: "POST", headers: { "Content-Type": "application/json", ...(hdr ? { "x-admin-secret": process.env.ADMIN_SECRET || "" } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) as any };
  };
  const snapshot = () => JSON.stringify([
    sqlite.prepare("SELECT id, owner_user_id, organization_id, plan FROM labs ORDER BY id").all(),
    sqlite.prepare("SELECT lab_id, user_id, role, status, is_primary_lab FROM lab_members ORDER BY id").all(),
    sqlite.prepare("SELECT owner_user_id, lab_id, seat_user_id, status FROM user_seats ORDER BY id").all(),
  ]);
  const membersAndSeats = () => JSON.stringify(JSON.parse(snapshot()).slice(1));
  try {
    const no = await post({ labId: lab, organizationId: org, confirm: true }, false);
    check("1. refuses without the admin header", no.status === 403, String(no.status));
    const bad = await post({ labId: "x", organizationId: org });
    const noLab = await post({ labId: 999999, organizationId: org });
    const noOrg = await post({ labId: lab, organizationId: 999999 });
    check("2. bad ids 400; unknown lab or org 404", bad.status === 400 && noLab.status === 404 && noOrg.status === 404, `${bad.status} ${noLab.status} ${noOrg.status}`);
    const before = snapshot();
    const dry = await post({ labId: lab, organizationId: org });
    check("3. without confirm: a dry run with the plan, nothing written", dry.status === 200 && dry.j.dryRun === true && dry.j.plan?.organizationId === org && dry.j.plan?.ownerIsBillingOwner === false && snapshot() === before, JSON.stringify(dry.j));
    const ms = membersAndSeats();
    const go = await post({ labId: lab, organizationId: org, confirm: true });
    const row = sqlite.prepare("SELECT owner_user_id, organization_id, plan FROM labs WHERE id = ?").get(lab) as any;
    check("4. with confirm the lab joins the org", go.status === 200 && go.j.ok === true && row.organization_id === org, JSON.stringify(go.j));
    check("4. ... its owner and plan are unchanged", row.owner_user_id === labOwner && row.plan === "enterprise", JSON.stringify(row));
    check("4. ... memberships and seats are unchanged", membersAndSeats() === ms);
    const mid = snapshot();
    const again = await post({ labId: inOrg, organizationId: org, confirm: true });
    check("5. a lab already in that org answers alreadyAttached and writes nothing", again.status === 200 && again.j.alreadyAttached === true && snapshot() === mid, JSON.stringify(again.j));
    const clash = await post({ labId: inOther, organizationId: org, confirm: true });
    const otherRow = sqlite.prepare("SELECT organization_id FROM labs WHERE id = ?").get(inOther) as any;
    check("5. a lab in another org is 409 and stays there", clash.status === 409 && otherRow.organization_id === other, `${clash.status} ${otherRow.organization_id}`);
  } finally {
    server.close();
  }
  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
