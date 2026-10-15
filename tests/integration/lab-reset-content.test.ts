// tests/integration/lab-reset-content.test.ts
//
// POST /api/admin/labs/reset-content (Michael 2026-10-15: "Reset the LW test lab as an empty lab"):
// empties a lab IN PLACE (owner, membership and organization kept), dry-run by default, never touches
// another lab, and clears the CLIA/name locks. Also the CLIA fill-in rule: a locked lab with NO CLIA
// can get its first one; a locked lab with a CLIA still cannot change it.
// Run: DB_PATH=.tmp-reset-content.db JWT_SECRET=t ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/lab-reset-content.test.ts

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
  const post = async (p: string, body: any) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const email = `it-reset-${Date.now()}@example.com`;
    await post("/api/auth/register", { email, password: ["Zq", "reset", "7x!"].join("-"), name: "Reset Owner", hipaa_acknowledged: true });
    const owner = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any;
    const L = Number((await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Lab To Empty", plan: "hospital" })).body.labId);
    const M = Number((await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Lab To Keep", plan: "hospital" })).body.labId);
    const now = new Date().toISOString();
    const ins = sqlite.prepare("INSERT INTO policy_manuals (lab_id, name, display_order, created_at, updated_at) VALUES (?, ?, 0, ?, ?)");
    ins.run(L, "Chemistry", now, now); ins.run(L, "Hematology", now, now); ins.run(M, "Safety", now, now);
    sqlite.prepare("UPDATE labs SET clia_locked = 1, lab_name_locked = 1 WHERE id IN (?, ?)").run(L, M);
    const count = (lab: number) => (sqlite.prepare("SELECT COUNT(*) AS n FROM policy_manuals WHERE lab_id = ?").get(lab) as any).n;

    const dry = await post("/api/admin/labs/reset-content", { secret: ADMIN, labIds: [L] });
    const pm = (dry.body.manifest || []).find((m: any) => m.table === "policy_manuals");
    check("1. without confirm it is a dry run: plan lists the rows, nothing deleted", dry.status === 200 && dry.body.dryRun === true && pm?.rows === 2 && count(L) === 2, JSON.stringify(pm));
    const bad = await post("/api/admin/labs/reset-content", { secret: "wrong", labIds: [L], confirm: true });
    check("2. a wrong secret is refused", bad.status === 403 && count(L) === 2);
    const go = await post("/api/admin/labs/reset-content", { secret: ADMIN, labIds: [L], confirm: true });
    check("3. confirm empties the lab", go.status === 200 && go.body.ok === true && count(L) === 0, JSON.stringify({ s: go.status, deleted: go.body.deleted, err: go.body.error }));
    check("4. the other lab is untouched", count(M) === 1);
    const lab = sqlite.prepare("SELECT owner_user_id, lab_name, clia_locked, lab_name_locked FROM labs WHERE id = ?").get(L) as any;
    const mem = sqlite.prepare("SELECT role, status FROM lab_members WHERE lab_id = ? AND user_id = ?").get(L, owner.id) as any;
    check("5. the lab shell, owner and membership stay", lab?.owner_user_id === owner.id && lab?.lab_name === "IT Lab To Empty" && mem?.role === "owner" && mem?.status === "active");
    check("6. the CLIA and name locks are cleared on the emptied lab only", lab.clia_locked === 0 && lab.lab_name_locked === 0 && (sqlite.prepare("SELECT clia_locked FROM labs WHERE id = ?").get(M) as any).clia_locked === 1);

    // CLIA fill-in: M is locked with no CLIA -> first CLIA allowed; then locked with a CLIA -> refused.
    const fill = await post("/api/admin/update-lab", { secret: ADMIN, labId: M, cliaNumber: "20D0999998" });
    check("7. a locked lab with no CLIA can get its first one", fill.status === 200 && (sqlite.prepare("SELECT clia_number FROM labs WHERE id = ?").get(M) as any).clia_number === "20D0999998", JSON.stringify(fill.body).slice(0, 120));
    const change = await post("/api/admin/update-lab", { secret: ADMIN, labId: M, cliaNumber: "20D0999997" });
    check("8. a locked lab with a CLIA still cannot change it", change.status === 409 && (sqlite.prepare("SELECT clia_number FROM labs WHERE id = ?").get(M) as any).clia_number === "20D0999998");
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
