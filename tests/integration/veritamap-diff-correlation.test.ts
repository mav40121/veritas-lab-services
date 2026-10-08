// tests/integration/veritamap-diff-correlation.test.ts
//
// Receipt for parking lot #76 (2026-10-08). VeritaMap decided "correlation
// required" by counting instruments on the EXACT analyte string, so a manual
// differential's "Lymphocytes" and the analyzer's "LYMPH%" (the same measurand
// run two ways, 42 CFR 493.1281) were two one-instrument tests and the
// requirement never appeared. Boots the REAL routes on a scratch DB, builds a map
// through the map routes (Sysmex XN-1000 + Manual Differential + two chemistry
// analyzers) and proves:
//   1. map detail: "Lymphocytes" and "LYMPH%" each count 2 instruments and name
//      each other as peers; same for Neutrophils / NEUT%
//   2. absolute counts never pair with the manual percent: LYMPH# stays at 1
//   3. non-differential tests are unchanged: Glucose on two analyzers = 2 (exact
//      name, as before), Sodium on one = 1, Bands and HGB = 1
//   4. intelligence: correlationRequired for exactly Lymphocytes, LYMPH%,
//      Neutrophils, NEUT%, Glucose; the reason names the paired line
//   5. Excel export: "Correlation Required" reads Yes for the paired lines and No
//      for LYMPH#, Bands, Sodium
//
// Run (Windows, from bash): DB_PATH=.tmp-vdc.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-diff-correlation.test.ts
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
  const { registerRoutes } = await import("../../server/routes");
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const email = `vdc-${Date.now()}@example.com`;
  const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: "VDC Owner", hipaa_acknowledged: true }));
  const token = reg.token as string;
  const labId = Number((await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "VDC Lab", plan: "hospital" }))).labId);
  const L = `/api/labs/${labId}/veritamap`;
  const map = await j(await call("POST", `${L}/maps`, { name: "VDC Map" }, token));
  const M = `${L}/maps/${map.id}`;
  const addInstrument = async (instrument_name: string, role: string, category: string, specialty: string, complexity: string, analytes: string[]) => {
    const inst = await j(await call("POST", `${M}/instruments`, { instrument_name, role, category }, token));
    const r = await call("PUT", `${M}/instruments/${inst.id}/tests`, { tests: analytes.map((analyte) => ({ analyte, specialty, complexity, active: 1 })) }, token);
    return { id: inst.id, status: r.status };
  };
  const sysmex = await addInstrument("Sysmex XN-1000", "Primary", "Hematology", "Hematology", "MODERATE", ["LYMPH%", "LYMPH#", "NEUT%", "HGB"]);
  const manual = await addInstrument("Manual Differential", "Primary", "Hematology", "Hematology", "HIGH", ["Lymphocytes", "Neutrophils", "Bands"]);
  const chemA = await addInstrument("Beckman DxC 700 AU", "Primary", "Chemistry", "General Chemistry", "MODERATE", ["Glucose", "Sodium"]);
  const chemB = await addInstrument("Beckman DxC 700 AU", "Backup", "Chemistry", "General Chemistry", "MODERATE", ["Glucose"]);
  check("setup: lab, map and four instruments built through the map routes", labId > 0 && !!map.id && [sysmex, manual, chemA, chemB].every((x) => x.id && x.status === 200),
    JSON.stringify({ labId, map: map.id, statuses: [sysmex, manual, chemA, chemB].map((x) => x.status) }));

  // 1-3. map detail
  const detail = await j(await call("GET", M, undefined, token));
  const t = (a: string) => (detail.tests || []).find((x: any) => x.analyte === a) || {};
  const cnt = (a: string) => t(a).correlation_instrument_count;
  const peers = (a: string) => JSON.stringify(t(a).correlation_peers || []);
  check("1. Lymphocytes <-> LYMPH% and Neutrophils <-> NEUT% count 2 instruments and name each other",
    cnt("Lymphocytes") === 2 && cnt("LYMPH%") === 2 && peers("Lymphocytes") === '["LYMPH%"]' && peers("LYMPH%") === '["Lymphocytes"]' && cnt("Neutrophils") === 2 && cnt("NEUT%") === 2,
    JSON.stringify({ Lymphocytes: [cnt("Lymphocytes"), peers("Lymphocytes")], "LYMPH%": [cnt("LYMPH%"), peers("LYMPH%")], Neutrophils: cnt("Neutrophils"), "NEUT%": cnt("NEUT%") }));
  check("2. the absolute count LYMPH# does not pair with the manual percent", cnt("LYMPH#") === 1 && peers("LYMPH#") === "[]", JSON.stringify([cnt("LYMPH#"), peers("LYMPH#")]));
  check("3. non-differential tests unchanged: Glucose 2 (exact name), Sodium, Bands, HGB 1",
    cnt("Glucose") === 2 && cnt("Sodium") === 1 && cnt("Bands") === 1 && cnt("HGB") === 1, JSON.stringify({ Glucose: cnt("Glucose"), Sodium: cnt("Sodium"), Bands: cnt("Bands"), HGB: cnt("HGB") }));

  // 4. intelligence
  const intel = await j(await call("GET", `${M}/intelligence`, undefined, token));
  const req = Object.entries(intel.intelligence || {}).filter(([, v]: any) => v.correlationRequired).map(([a]) => a).sort();
  const want = ["Glucose", "LYMPH%", "Lymphocytes", "NEUT%", "Neutrophils"].sort();
  const reason = String(intel.intelligence?.Lymphocytes?.correlationReason || "");
  check("4. intelligence requires correlation for exactly the paired lines and Glucose; the reason names the analyzer line",
    JSON.stringify(req) === JSON.stringify(want) && intel.correlationCount === 5 && reason.includes("Sysmex XN-1000") && reason.includes("as LYMPH%"),
    `required=${JSON.stringify(req)} count=${intel.correlationCount} reason="${reason.slice(0, 160)}"`);

  // 5. Excel export
  const xr = await call("POST", `${M}/excel`, {}, token);
  let excelOk = false, excelDetail = `status=${xr.status}`;
  if (xr.ok) {
    const { default: ExcelJS } = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()));
    const ws = wb.getWorksheet("Compliance Map");
    const head = (ws?.getRow(1).values as any[]) || [];
    const colA = head.indexOf("Analyte"), colC = head.indexOf("Correlation Required");
    const seen: Record<string, string> = {};
    ws?.eachRow((row, n) => { if (n > 1) { const a = String(row.getCell(colA).value ?? ""); if (a && !(a in seen)) seen[a] = String(row.getCell(colC).value ?? ""); } });
    excelOk = seen["Lymphocytes"] === "Yes" && seen["LYMPH%"] === "Yes" && seen["Neutrophils"] === "Yes" && seen["Glucose"] === "Yes"
      && seen["LYMPH#"] === "No" && seen["Bands"] === "No" && seen["Sodium"] === "No";
    excelDetail = JSON.stringify(seen);
  }
  check("5. Excel 'Correlation Required' is Yes for the paired lines and Glucose, No for LYMPH#, Bands, Sodium", excelOk, excelDetail);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
