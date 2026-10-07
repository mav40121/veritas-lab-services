// tests/integration/finding-due-window.test.ts
//
// Receipt for the corrective-action due-window override (2026-10-07, Lifepoint:
// 30 days on every PT-triggered corrective action network-wide). Boots the REAL
// routes on a scratch DB and proves:
//   1. a TJC finding gets the accreditor default (anchor + 60 days)
//   2. the admin endpoint refuses a bad body (both ids, out-of-range days, bad secret)
//   3. dryRun reports before/after without writing
//   4. a lab override of 30 makes the next finding anchor + 30; existing findings untouched
//   5. an organization override applies to a lab in that organization; the lab value wins when both are set
//   6. clearing (null) restores the accreditor default
//   7. the change is audit-logged
//
// Run (Windows, from bash): DB_PATH=.tmp-fdw.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/finding-due-window.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const mkLab = async (tag: string) => {
    const email = `fdw-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `FDW ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `FDW Lab ${tag}`, plan: "hospital" }));
    await call("POST", "/api/admin/update-lab", { secret: ADMIN, labId: prov.labId, accTjc: true });
    return { token: reg.token as string, labId: prov.labId as number };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two TJC labs provisioned", !!A.labId && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));

  const mkFinding = async (lab: { token: string; labId: number }, n: number) =>
    j(await call("POST", `/api/labs/${lab.labId}/findings`, { accreditor: "TJC", anchor_date: "2026-10-01", description: `FDW finding ${n}`, status: "open" }, lab.token));
  const due = (id: number) => (sqlite.prepare("SELECT due_date FROM findings WHERE id = ?").get(id) as any)?.due_date;

  // 1. accreditor default
  const f1 = await mkFinding(A, 1);
  check("1. TJC finding defaults to anchor + 60 days", !!f1.id && due(f1.id) === "2026-11-30", `id=${f1.id} due=${due(f1.id)}`);

  // 2. validation
  const bad1 = await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: A.labId, organizationId: 1, days: 30 });
  const bad2 = await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: A.labId, days: 0 });
  const bad3 = await call("POST", "/api/admin/finding-due-days", { secret: "nope", labId: A.labId, days: 30 });
  check("2. both ids -> 400; days 0 -> 400; bad secret -> 403", bad1.status === 400 && bad2.status === 400 && bad3.status === 403, `${bad1.status}/${bad2.status}/${bad3.status}`);

  // 3. dryRun
  const dry = await j(await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: A.labId, days: 30, dryRun: true }));
  const stillNull = (sqlite.prepare("SELECT finding_due_days AS d FROM labs WHERE id = ?").get(A.labId) as any)?.d;
  check("3. dryRun reports before null / after 30 and writes nothing", dry.dryRun === true && dry.before === null && dry.after === 30 && stillNull === null, JSON.stringify(dry));

  // 4. lab override
  const set = await j(await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: A.labId, days: 30 }));
  const f2 = await mkFinding(A, 2);
  check("4. lab override 30 -> next finding anchor + 30; earlier finding untouched", set.ok === true && due(f2.id) === "2026-10-31" && due(f1.id) === "2026-11-30", `f2=${due(f2.id)} f1=${due(f1.id)}`);

  // 5. organization override (lab B in an org), lab value wins
  const now = new Date().toISOString();
  const orgId = Number(sqlite.prepare("INSERT INTO organizations (name, created_at, updated_at) VALUES ('FDW Network', ?, ?)").run(now, now).lastInsertRowid);
  sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(orgId, B.labId);
  const setOrg = await j(await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, organizationId: orgId, days: 45 }));
  const f3 = await mkFinding(B, 3);
  check("5a. organization override 45 applies to a lab in the organization", setOrg.ok === true && setOrg.affectedLabs === 1 && due(f3.id) === "2026-11-15", `due=${due(f3.id)} ${JSON.stringify(setOrg)}`);
  await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: B.labId, days: 14 });
  const f4 = await mkFinding(B, 4);
  check("5b. lab value wins over the organization value", due(f4.id) === "2026-10-15", `due=${due(f4.id)}`);

  // 6. clear restores the default
  await call("POST", "/api/admin/finding-due-days", { secret: ADMIN, labId: A.labId, days: null });
  const f5 = await mkFinding(A, 5);
  check("6. clearing the lab override restores anchor + 60", due(f5.id) === "2026-11-30", `due=${due(f5.id)}`);

  // 7. audit
  const audits = (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'admin.finding_due_days'").get() as any)?.n ?? -1;
  check("7. changes are audit-logged", audits >= 4, `rows=${audits}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
