// tests/integration/veritamap-menu-save-keeps-ifu.test.ts
//
// 2026-11-21: saving an analyzer's test menu (PUT .../instruments/:instId/tests, replaceInstrumentTests) deletes and
// re-inserts its veritamap_instrument_tests rows. It carried over the linearity exemptions and active_since, but not
// the lab-entered IFU link (ifu_url), so every menu save dropped the analyzer's saved links and the page fell back to
// the manufacturer's portal link. Boots the REAL routes against a throwaway DB and drives real HTTP:
//   1. an IFU link set on Sodium survives a menu save that adds a test
//   2. it survives a save that switches Sodium off (the row stays, inactive)
//   3. a test with no link stays without one; the added test has none
//   4. clearing the link (empty ifuUrl) then saving keeps it cleared
//
// Run: npm run test:veritamap-menu-save-keeps-ifu, or on Windows from bash:
//   DB_PATH=.tmp-menu-ifu.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-menu-save-keeps-ifu.test.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";

(globalThis as any).require ??= createRequire(import.meta.url);
const Database = createRequire(import.meta.url)("better-sqlite3");

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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200), _status: r.status }; } };
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const db = new Database(process.env.DB_PATH);

  try {
    const email = `menu-ifu-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Menu IFU IT", hipaa_acknowledged: true }));
    const token = reg.token;
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Menu IFU Lab", plan: "hospital", isWarehouse: true }));
    const L = `/api/labs/${prov.labId}/veritamap`;
    const map = await j(await call("POST", `${L}/maps`, { name: "Chemistry" }, token));
    const inst = await j(await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Roche cobas c 501", role: "Primary", category: "Chemistry" }, token));
    const menu = (rows: Array<[string, number]>) => call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: rows.map(([a, active]) => ({ analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active })) }, token);
    const m0 = await menu([["Sodium", 1], ["Potassium", 1]]);
    check("menu saved with Sodium and Potassium", m0.status === 200 && !!prov.labId, String(m0.status));
    const rowOf = (a: string) => db.prepare("SELECT id, active, ifu_url FROM veritamap_instrument_tests WHERE instrument_id = ? AND analyte = ?").get(inst.id, a) as any;

    const URL = "https://example.com/ifu/sodium-c501.pdf";
    const s = await call("PUT", `${L}/maps/${map.id}/tests/${rowOf("Sodium").id}/ifu`, { ifuUrl: URL }, token);
    check("IFU link set on Sodium", s.status === 200 && rowOf("Sodium").ifu_url === URL, String(s.status));

    // 1. a save that adds a test
    const m1 = await menu([["Sodium", 1], ["Potassium", 1], ["Chloride", 1]]);
    check("1. menu save adding Chloride: 200", m1.status === 200, String(m1.status));
    check("1. Sodium keeps its IFU link after the save", rowOf("Sodium")?.ifu_url === URL, String(rowOf("Sodium")?.ifu_url));

    // 2. a save that switches Sodium off
    const m2 = await menu([["Sodium", 0], ["Potassium", 1], ["Chloride", 1]]);
    check("2. Sodium switched off keeps its row and its IFU link", m2.status === 200 && rowOf("Sodium")?.active === 0 && rowOf("Sodium")?.ifu_url === URL, `${rowOf("Sodium")?.active} ${rowOf("Sodium")?.ifu_url}`);

    // 3. no link stays no link
    check("3. Potassium and the added Chloride have no link", !rowOf("Potassium")?.ifu_url && !rowOf("Chloride")?.ifu_url);

    // 4. a cleared link stays cleared
    await menu([["Sodium", 1], ["Potassium", 1], ["Chloride", 1]]);
    const c = await call("PUT", `${L}/maps/${map.id}/tests/${rowOf("Sodium").id}/ifu`, { ifuUrl: "" }, token);
    await menu([["Sodium", 1], ["Potassium", 1], ["Chloride", 1]]);
    check("4. a cleared link stays cleared after a save", c.status === 200 && !rowOf("Sodium")?.ifu_url, String(rowOf("Sodium")?.ifu_url));
  } finally {
    db.close();
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
