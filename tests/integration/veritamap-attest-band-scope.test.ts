// tests/integration/veritamap-attest-band-scope.test.ts
//
// Receipt for parking-lot #68 (2026-10-07): VeritaMap director attestation,
// MEC review and unlock were keyed on (map_id, analyte) only, so attesting the
// adult reference range also attested and LOCKED every pediatric band, and an
// unlock unlocked all of them. Boots the REAL Express routes against a
// throwaway SQLite DB (DB_PATH from the runner) and drives real HTTP:
//   1. two bands on one analyte (All ages + 0-18 y)
//   2. attest-ref with the pediatric band locks ONLY that band (pre-fix: both)
//   3. attest-ref without a band addresses the All-ages band (old-client path)
//   4. unlock-ref with the pediatric band unlocks ONLY that band (pre-fix: both)
//   5. mec-review with the pediatric band stamps ONLY that band
//   6. each response is the addressed band's row
//
// Run: npm run test:veritamap-attest-band (Linux/CI) or, on Windows, from bash:
//   DB_PATH=.tmp-attest-band.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-attest-band-scope.test.ts

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
    const email = `attest-band-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Attest Band IT", hipaa_acknowledged: true }));
    const token = reg.token;
    check("registered", !!token);
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Attest Band Lab", plan: "hospital", isWarehouse: true }));
    const labId = prov.labId;
    check("lab provisioned (owner, active plan)", !!labId, JSON.stringify(prov).slice(0, 120));
    const map = await j(await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token));
    const mapId = map.id;
    const inst = await j(await call("POST", `/api/labs/${labId}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Roche cobas c 501", role: "Primary", category: "Chemistry" }, token));
    await j(await call("PUT", `/api/labs/${labId}/veritamap/maps/${mapId}/instruments/${inst.id}/tests`, { tests: [{ analyte: "Sodium", specialty: "General Chemistry", complexity: "MODERATE", active: 1 }] }, token));
    const av = (b?: unknown) => `/api/labs/${labId}/veritamap/maps/${mapId}/analyte-values/Sodium${b ?? ""}`;
    const PED = { age_min_days: 0, age_max_days: 6570, sex: "A" }; // 0-18 y

    // 1. two bands
    const r1 = await call("PUT", av(), { ref_range_low: "136", ref_range_high: "145", critical_low: "120", critical_high: "160" }, token);
    const r2 = await call("PUT", av(), { ...PED, ref_range_low: "130", ref_range_high: "140", critical_low: "115", critical_high: "155" }, token);
    check("two bands written", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);
    const rows = async () => (await j(await call("GET", `/api/labs/${labId}/veritamap/maps/${mapId}/analyte-values`, undefined, token))) as any[];
    const adult = (rs: any[]) => rs.find((r) => r.analyte === "Sodium" && r.age_max_days === 999999);
    const ped = (rs: any[]) => rs.find((r) => r.analyte === "Sodium" && r.age_max_days === 6570);
    let rs = await rows();
    check("both bands present and unlocked", !!adult(rs) && !!ped(rs) && !adult(rs).ref_locked && !ped(rs).ref_locked);

    // 2. attest the pediatric band only
    const a1 = await call("POST", av("/attest-ref"), { attested_by: "Dr. Director", attested_title: "Medical Director", ...PED }, token);
    const a1row = await j(a1);
    rs = await rows();
    check("attest-ref (pediatric) -> 200 and response is the pediatric row", a1.status === 200 && a1row.age_max_days === 6570, `${a1.status} age_max_days=${a1row.age_max_days}`);
    check("pediatric band locked", ped(rs).ref_locked === 1 && ped(rs).ref_attested_by === "Dr. Director");
    check("All-ages band NOT locked by the pediatric attestation", adult(rs).ref_locked === 0 && !adult(rs).ref_attested_by, `adult ref_locked=${adult(rs).ref_locked}`);

    // 3. old-client path: no band fields -> All ages
    const a2 = await call("POST", av("/attest-ref"), { attested_by: "Dr. Director", attested_title: "Medical Director" }, token);
    const a2row = await j(a2);
    rs = await rows();
    check("attest-ref without band addresses All ages", a2.status === 200 && a2row.age_max_days === 999999 && adult(rs).ref_locked === 1, `${a2.status} age_max_days=${a2row.age_max_days}`);

    // 4. unlock the pediatric band only
    const u1 = await call("POST", av("/unlock-ref"), { reason: "re-verification", ...PED }, token);
    rs = await rows();
    check("unlock-ref (pediatric) -> 200", u1.status === 200, String(u1.status));
    check("pediatric band unlocked", ped(rs).ref_locked === 0 && !ped(rs).ref_attested_by);
    check("All-ages band STILL locked after the pediatric unlock", adult(rs).ref_locked === 1, `adult ref_locked=${adult(rs).ref_locked}`);

    // 5. MEC review on the pediatric band only
    const m1 = await call("POST", av("/mec-review"), { reviewed_at: "2026-10-01", recorded_by: "MEC Secretary", ...PED }, token);
    rs = await rows();
    check("mec-review (pediatric) -> 200", m1.status === 200, String(m1.status));
    check("pediatric band carries the MEC review", ped(rs).mec_reviewed_at === "2026-10-01");
    check("All-ages band has NO MEC review", !adult(rs).mec_reviewed_at, `adult mec_reviewed_at=${adult(rs).mec_reviewed_at}`);

    // 6. a band that does not exist is a clean 400, not a silent stamp elsewhere
    const bad = await call("POST", av("/attest-ref"), { attested_by: "x", attested_title: "y", age_min_days: 0, age_max_days: 365, sex: "A" }, token);
    check("attesting a band that has no row -> 400", bad.status === 400, String(bad.status));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
