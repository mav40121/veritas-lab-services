// tests/integration/veritamap-amr-export-columns.test.ts
//
// Lindsay Webber (Redington-Fairview), 2026-10-19: "When you export the excel spreadsheet all AMR info is displaying
// in the AMR low column. It does not separate out into the AMR high column." The VeritaMap Excel export wrote
// "<instrument>: <low> - <high>" into AMR Low and left AMR High blank on purpose. This pins the split:
//   1. one instrument: AMR Low holds the low value alone and AMR High the high value alone
//   2. two instruments: each column lists each instrument's own value, in the same order
//   3. no AMR entered: both columns say Not established, never a guessed value
// Run (Windows, from bash): DB_PATH=.tmp-amrcols.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-amr-export-columns.test.ts
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
  const { default: ExcelJS } = await import("exceljs");
  void db;
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

  const email = `amrcols-${Date.now()}@example.com`;
  const reg = await j(await call("POST", "/api/auth/register", { email, password: ["Zq", "amr", "7x!"].join("-"), name: "AMR Cols", hipaa_acknowledged: true }));
  const lab = (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "AMR Columns Lab", plan: "hospital" }))).labId as number;
  const T = reg.token as string;
  const L = `/api/labs/${lab}/veritamap`;

  const map = await j(await call("POST", `${L}/maps`, { name: "AMR Chemistry" }, T));
  const v1 = await j(await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, T));
  const v2 = await j(await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 350", role: "Backup", category: "Chemistry" }, T));
  const t = (analyte: string) => ({ analyte, specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 });
  await call("PUT", `${L}/maps/${map.id}/instruments/${v1.id}/tests`, { tests: [t("Calcium"), t("Sodium"), t("Lipase")] }, T);
  await call("PUT", `${L}/maps/${map.id}/instruments/${v2.id}/tests`, { tests: [t("Sodium")] }, T);
  const amr = (inst: number, analyte: string, lo: string, hi: string) => call("PUT", `${L}/maps/${map.id}/amr-values/${inst}/${encodeURIComponent(analyte)}`, { amr_low: lo, amr_high: hi }, T);
  const s1 = await amr(v1.id, "Calcium", "1.0", "14.0");
  const s2 = await amr(v1.id, "Sodium", "75", "250");
  const s3 = await amr(v2.id, "Sodium", "80", "200");
  check("0. fixture: two instruments, AMRs entered", !!map.id && !!v1.id && !!v2.id && [s1, s2, s3].every((r) => r.status === 200), [s1.status, s2.status, s3.status].join(","));

  const xl = await call("POST", `${L}/maps/${map.id}/excel`, {}, T);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xl.arrayBuffer()) as any);
  let lowCol = 0, highCol = 0, analyteCol = 0, headerRow = 0;
  const rows: Record<string, { low: string; high: string }> = {};
  for (const ws of wb.worksheets) {
    ws.eachRow((row, rn) => {
      const vals = Array.from(row.values as any[], (v) => (v && typeof v === "object" && "richText" in v ? v.richText.map((x: any) => x.text).join("") : String(v ?? "")));
      if (!headerRow) {
        const lo = vals.findIndex((v) => v.startsWith("AMR Low")), hi = vals.findIndex((v) => v.startsWith("AMR High"));
        if (lo > 0 && hi > 0) { headerRow = rn; lowCol = lo; highCol = hi; analyteCol = vals.findIndex((v) => /^(Analyte|Test)$/i.test(v)); }
        return;
      }
      if (ws.name && rn > headerRow && analyteCol > 0 && vals[analyteCol]) rows[vals[analyteCol]] = { low: vals[lowCol], high: vals[highCol] };
    });
    if (headerRow) break;
  }
  check("1. the export has AMR Low and AMR High columns", xl.status === 200 && lowCol > 0 && highCol === lowCol + 1, `status=${xl.status} low=${lowCol} high=${highCol} analyteCol=${analyteCol}`);
  check("2. one instrument: low alone in AMR Low, high alone in AMR High", rows.Calcium?.low === "1.0" && rows.Calcium?.high === "14.0", JSON.stringify(rows.Calcium));
  check("3. two instruments: each column lists each instrument's own value, same order",
    rows.Sodium?.low === "Vitros 5600: 75; Vitros 350: 80" && rows.Sodium?.high === "Vitros 5600: 250; Vitros 350: 200", JSON.stringify(rows.Sodium));
  check("4. no AMR entered: both say Not established", /Not established/i.test(rows.Lipase?.low || "") && /Not established/i.test(rows.Lipase?.high || ""), JSON.stringify(rows.Lipase));

  server.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
