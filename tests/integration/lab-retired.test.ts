// tests/integration/lab-retired.test.ts
//
// Receipt for the reversible "retired" lab status (2026-10-12, Michael Q102 = 1; first use: lab 20 "ery", an abandoned
// sign-up that showed in Michael's Client labs list). Boots the REAL routes on a scratch DB and proves:
//   1. before: Veritas support lists the client lab (viaVlsSupport) and can open a lab route
//   2. POST /api/admin/labs/:labId/retire guards: 403 without the secret, 400 without a reason, dryRun changes nothing
//   3. retired: gone from Veritas support's lab list, and Veritas support is refused on the lab's routes
//   4. retired: the lab's own owner still lists it and opens it (nothing taken from the client)
//   5. restored (retired:false): Veritas support lists and opens it again
// Run (from bash): DB_PATH=.tmp-lr.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/lab-retired.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, lab?: number) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const stamp = Date.now();
  const reg = async (tag: string) => (await call("POST", "/api/auth/register", { email: `lr-${tag}-${stamp}@example.com`, password: "Testpass123", name: `LR ${tag}`, hipaa_acknowledged: true })).j;
  const owner = await reg("owner"), vls = await reg("vls");
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `lr-owner-${stamp}@example.com`, labName: "Abandoned Signup Lab", plan: "hospital" })).j.labId;
  const flag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `lr-vls-${stamp}@example.com`, enabled: true });
  const L = `/api/labs/${labId}`;
  const lists = async (token: string) => { const r = await call("GET", "/api/labs/me", undefined, token); const rows = Array.isArray(r.j) ? r.j : r.j.labs || []; return rows.find((m: any) => m.labId === labId) || null; };
  const opens = async (token: string) => (await call("GET", `${L}/veritamap/maps`, undefined, token, labId)).s;

  const v0 = await lists(vls.token);
  check("1. before: Veritas support lists the client lab and opens it", flag.s === 200 && v0?.viaVlsSupport === true && (await opens(vls.token)) === 200, JSON.stringify(v0 && { viaVlsSupport: v0.viaVlsSupport }));

  const noSecret = await call("POST", `/api/admin/labs/${labId}/retire`, { reason: "x" });
  const noReason = await call("POST", `/api/admin/labs/${labId}/retire`, { secret: ADMIN });
  const dry = await call("POST", `/api/admin/labs/${labId}/retire`, { secret: ADMIN, reason: "Abandoned sign-up", dryRun: true });
  const stillNull = (sqlite.prepare("SELECT retired_at FROM labs WHERE id = ?").get(labId) as any)?.retired_at == null;
  check("2. guards: 403 without the secret, 400 without a reason, dryRun changes nothing", noSecret.s === 403 && noReason.s === 400 && dry.s === 200 && dry.j.dryRun === true && stillNull, `${noSecret.s} ${noReason.s} ${dry.s} null=${stillNull}`);

  const ret = await call("POST", `/api/admin/labs/${labId}/retire`, { secret: ADMIN, reason: "Abandoned sign-up" });
  const v1 = await lists(vls.token);
  const v1open = await opens(vls.token);
  check("3. retired: gone from Veritas support's list and refused on its routes", ret.s === 200 && !!ret.j.after?.retired_at && v1 === null && v1open === 403, `${ret.s} listed=${!!v1} open=${v1open}`);
  const o1 = await lists(owner.token);
  check("4. retired: the owner still lists and opens the lab", !!o1 && (await opens(owner.token)) === 200);

  const rest = await call("POST", `/api/admin/labs/${labId}/retire`, { secret: ADMIN, retired: false });
  const v2 = await lists(vls.token);
  check("5. restored: Veritas support lists and opens it again", rest.s === 200 && rest.j.after?.retired_at === null && v2?.viaVlsSupport === true && (await opens(vls.token)) === 200, `${rest.s}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
