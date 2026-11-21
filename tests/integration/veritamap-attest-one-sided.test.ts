// tests/integration/veritamap-attest-one-sided.test.ts
//
// Heywood (2026-11-21): 13 of its 147 Chemistry reference range bands are one-sided (cholesterol <200, LDL <100,
// ethanol <10, RF, two ALP bands), stored as a high with no low. POST .../attest-ref refused them with 400 "an empty
// range cannot be attested", and the map page offered no Attest link, so they could never be attested. Boots the REAL
// Express routes against a throwaway SQLite DB and drives real HTTP:
//   1. a high-only band attests: 200, locked, attested_by kept
//   2. a low-only band attests
//   3. a band with neither end still answers 400, nothing locked
//   4. the lock holds on a one-sided band: a PUT changing its high is 409; re-sending the same values saves
//   5. a two-sided band still attests (unchanged)
//
// Run: npm run test:veritamap-attest-one-sided, or on Windows from bash:
//   DB_PATH=.tmp-attest-one-sided.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-attest-one-sided.test.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";

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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 200), _status: r.status }; } };
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });

  try {
    const email = `attest-one-sided-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Attest One Sided IT", hipaa_acknowledged: true }));
    const token = reg.token;
    check("registered", !!token);
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Attest One Sided Lab", plan: "hospital", isWarehouse: true }));
    const labId = prov.labId;
    check("lab provisioned", !!labId, JSON.stringify(prov).slice(0, 120));
    const L = `/api/labs/${labId}/veritamap`;
    const map = await j(await call("POST", `${L}/maps`, { name: "Chemistry" }, token));
    const inst = await j(await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, token));
    const analytes = ["Cholesterol", "HDL cholesterol", "Glucose", "Sodium"];
    await j(await call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: analytes.map((a) => ({ analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) }, token));
    const av = (a: string, tail = "") => `${L}/maps/${map.id}/analyte-values/${encodeURIComponent(a)}${tail}`;
    const rows = async () => (await j(await call("GET", `${L}/maps/${map.id}/analyte-values`, undefined, token))) as any[];
    const row = (rs: any[], a: string) => rs.find((r) => r.analyte === a);

    const w = await Promise.all([
      call("PUT", av("Cholesterol"), { ref_range_low: "", ref_range_high: "200", units: "mg/dL" }, token),
      call("PUT", av("HDL cholesterol"), { ref_range_low: "40", ref_range_high: "", units: "mg/dL" }, token),
      call("PUT", av("Glucose"), { ref_range_low: "", ref_range_high: "", critical_low: "40", critical_high: "450", units: "mg/dL" }, token),
      call("PUT", av("Sodium"), { ref_range_low: "136", ref_range_high: "145", units: "mmol/L" }, token),
    ]);
    check("four bands written", w.every((r) => r.status === 200), w.map((r) => r.status).join("/"));

    const attest = (a: string) => call("POST", av(a, "/attest-ref"), { attested_by: "Dr. Director", attested_title: "Medical Director" }, token);

    // 1. high only
    const a1 = await attest("Cholesterol");
    let rs = await rows();
    check("1. high-only band (<200) attests: 200", a1.status === 200, String(a1.status));
    check("1. high-only band locked with its attester", row(rs, "Cholesterol").ref_locked === 1 && row(rs, "Cholesterol").ref_attested_by === "Dr. Director");

    // 2. low only
    const a2 = await attest("HDL cholesterol");
    rs = await rows();
    check("2. low-only band (>40) attests: 200 and locked", a2.status === 200 && row(rs, "HDL cholesterol").ref_locked === 1, String(a2.status));

    // 3. neither end
    const a3 = await attest("Glucose");
    const a3b = await j(a3);
    rs = await rows();
    check("3. band with no range still refused: 400", a3.status === 400 && /empty range cannot be attested/.test(a3b.error || ""), `${a3.status} ${a3b.error}`);
    check("3. nothing locked on the empty band", row(rs, "Glucose").ref_locked === 0 && !row(rs, "Glucose").ref_attested_by);

    // 4. the lock holds on a one-sided band
    const p1 = await call("PUT", av("Cholesterol"), { ref_range_low: "", ref_range_high: "190", units: "mg/dL" }, token);
    check("4. changing a locked one-sided range: 409", p1.status === 409, String(p1.status));
    const p2 = await call("PUT", av("Cholesterol"), { ref_range_low: "", ref_range_high: "200", units: "mg/dL", critical_high: "" }, token);
    rs = await rows();
    check("4. re-sending the same range saves and stays locked", p2.status === 200 && row(rs, "Cholesterol").ref_locked === 1 && row(rs, "Cholesterol").ref_range_high === "200", String(p2.status));

    // 5. two-sided unchanged
    const a5 = await attest("Sodium");
    rs = await rows();
    check("5. two-sided band still attests", a5.status === 200 && row(rs, "Sodium").ref_locked === 1, String(a5.status));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
