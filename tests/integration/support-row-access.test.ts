// tests/integration/support-row-access.test.ts
//
// Receipt for BUG-038 (2026-10-11). The userCanAccess* row helpers (map, finding, scan, policy, study, lab row,
// certificate) accepted the row's owner or an active lab member only. Veritas support reaches a client lab through
// labScopeMiddleware with no membership, so lab-scoped routes built on those helpers answered "not found" (first seen:
// VeritaMap Excel export on Sampson). Now a row in the lab the request is scoped to is in reach. Boots the REAL routes
// on a scratch DB and proves:
//   1. Veritas support exports a client lab's VeritaMap Excel (lab-scoped route): 200 workbook
//   2. Veritas support exports a client lab's VeritaScan Excel (lab-scoped route): 200 workbook
//   3. the owner still exports both (unchanged)
//   4. an outsider is refused on the lab-scoped routes
//   5. the legacy unscoped map export stays closed to an outsider AND to Veritas support (no membership, so the
//      authMiddleware fallback never scopes them to the client lab)
// Run (from bash): DB_PATH=.tmp-sra.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/support-row-access.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string, lab?: number) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get("content-type") || "";
    let j: any = {}; if (/json/.test(ct)) { try { j = await r.json(); } catch {} } else { await r.arrayBuffer(); }
    return { s: r.status, ct, j };
  };
  const stamp = Date.now();
  const reg = async (tag: string) => (await call("POST", "/api/auth/register", { email: `sra-${tag}-${stamp}@example.com`, password: "Testpass123", name: `SRA ${tag}`, hipaa_acknowledged: true })).j;
  const owner = await reg("owner"), vls = await reg("vls"), outsider = await reg("outsider");
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `sra-owner-${stamp}@example.com`, labName: "Client Lab", plan: "hospital" })).j.labId;
  const flag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `sra-vls-${stamp}@example.com`, enabled: true });
  const L = `/api/labs/${labId}`;
  const map = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token, labId)).j;
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [{ name: "Sysmex XN-1000", tests: [{ analyte: "Hemoglobin", specialty: "Hematology", complexity: "MODERATE", active: 1 }] }] });
  const scan = (await call("POST", `${L}/veritascan/scans`, { name: "Self-inspection" }, owner.token, labId)).j;
  check("fixture: client lab with a map and a scan; Veritas support flagged", !!labId && !!map.id && !!scan.id && flag.s === 200, `lab=${labId} map=${map.id} scan=${scan.id} flag=${flag.s}`);

  const xlsx = (r: any) => r.s === 200 && /spreadsheetml/.test(r.ct);
  const vMap = await call("POST", `${L}/veritamap/maps/${map.id}/excel`, {}, vls.token, labId);
  check("1. Veritas support exports the client's VeritaMap Excel", xlsx(vMap), `${vMap.s} ${vMap.ct} ${JSON.stringify(vMap.j)}`);
  const vScan = await call("POST", `${L}/veritascan/excel/${scan.id}`, { referenceItems: [{ id: 1, domain: "Test Management & Procedures", question: "Written SOPs exist for every test performed?", tjc: "", cap: "", cfr: "42 CFR §493.1251(a)", aabb: "", cola: "" }] }, vls.token, labId);
  check("2. Veritas support exports the client's VeritaScan Excel", xlsx(vScan), `${vScan.s} ${vScan.ct} ${JSON.stringify(vScan.j)}`);
  const oMap = await call("POST", `${L}/veritamap/maps/${map.id}/excel`, {}, owner.token, labId);
  const oScan = await call("POST", `${L}/veritascan/excel/${scan.id}`, { referenceItems: [{ id: 1, domain: "Test Management & Procedures", question: "Written SOPs exist for every test performed?", tjc: "", cap: "", cfr: "42 CFR §493.1251(a)", aabb: "", cola: "" }] }, owner.token, labId);
  check("3. the owner still exports both", xlsx(oMap) && xlsx(oScan), `${oMap.s} ${oScan.s}`);
  const xMap = await call("POST", `${L}/veritamap/maps/${map.id}/excel`, {}, outsider.token, labId);
  const xScan = await call("POST", `${L}/veritascan/excel/${scan.id}`, { referenceItems: [{ id: 1, domain: "Test Management & Procedures", question: "Written SOPs exist for every test performed?", tjc: "", cap: "", cfr: "42 CFR §493.1251(a)", aabb: "", cola: "" }] }, outsider.token, labId);
  check("4. an outsider is refused on the lab-scoped routes", [403, 404].includes(xMap.s) && [403, 404].includes(xScan.s), `${xMap.s} ${xScan.s}`);
  const xLegacy = await call("POST", `/api/veritamap/maps/${map.id}/excel`, {}, outsider.token, labId);
  const vLegacy = await call("POST", `/api/veritamap/maps/${map.id}/excel`, {}, vls.token, labId);
  check("5. the legacy unscoped export stays closed to an outsider and to Veritas support", [403, 404].includes(xLegacy.s) && [403, 404].includes(vLegacy.s), `outsider ${xLegacy.s} support ${vLegacy.s}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
