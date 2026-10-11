// tests/integration/competency-register.test.ts
//
// Receipt for the Testing Personnel Competency Register download (Michael Q74 = 1, plan part C, 2026-10-11).
// Boots the REAL routes on a scratch DB, records competency data through the real save route, downloads
// GET /api/labs/:labId/staff/competency-register.xlsx and reads the workbook back with ExcelJS:
//   1. 200, xlsx content type, attachment filename with the lab name
//   2. sheets in order About, Testing Personnel, Duty-Change Reevaluations; About opens first
//   3. lab identity in three layers: About row 2, every sheet's header and footer
//   4. a new hire's row: hire, recorded as, training date/by/link, initial, cleared, 6-month due, 1st annual due
//   5. an existing staff member's row: cleared as existing staff, annual due, status
//   6. a non-testing employee is not listed
//   7. Duty-Change Reevaluations lists the post-setup addition as Open
//   8. sheets are protected; header row is teal; freeze pane at B2
//   9. another lab's owner gets 403/404, never the workbook
// Run (from bash): DB_PATH=.tmp-creg.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-register.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const mkLab = async (tag: string) => {
    const email = `creg-${tag}-${Date.now()}@example.com`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: `Reg ${tag}`, hipaa_acknowledged: true })).j;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Register Lab ${tag}`, plan: "hospital" })).j.labId;
    return { token: reg.token as string, labId: labId as number };
  };
  const A = await mkLab("A"), B = await mkLab("B");
  const L = `/api/labs/${A.labId}`;
  sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run("22D7777001", A.labId);
  await call("POST", `${L}/staff/lab`, { labName: "Register Lab A", cliaNumber: "22D7777001", accreditationBody: "CLIA_ONLY", complexity: "high" }, A.token);
  const map = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, A.token)).j;
  const xn = (await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "XN-1000", role: "Primary", category: "Hematology" }, A.token)).j.id;
  const diff = (await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Manual Differential", role: "Primary", category: "Hematology" }, A.token)).j.id;
  const mk = async (first: string, last: string, hire: string, testing = true) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "MLS", highestComplexity: "H", performsTesting: testing, hireDate: hire }, A.token)).j.id;
  const nora = await mk("Nora", "Hale", "2026-01-05"), eli = await mk("Eli", "Moss", "2012-06-01"), office = await mk("Pat", "Office", "2020-01-01", false);
  await call("PUT", `${L}/staff/competency/${nora}`, { recordedAs: "new_hire", trainingCompletedAt: "2026-03-20", trainingDocumentedBy: "J. Trainer", trainingRecordUrl: "https://example.sharepoint.com/t/nora.pdf", initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor" }, A.token);
  await call("PUT", `${L}/staff/competency/${eli}`, { recordedAs: "existing", lastAnnualCompletedAt: "2026-03-01", lastAnnualSignedBy: "T. Supervisor" }, A.token);
  // Setup assignment (no event), then after the setup session an addition (a real duty change -> event).
  await call("PUT", `${L}/staff/employees/${nora}/instruments`, { instrumentIds: [xn] }, A.token);
  sqlite.prepare("UPDATE staff_employees SET duties_baseline_at = ? WHERE id = ?").run(new Date(Date.now() - 3 * 86400000).toISOString(), nora);
  await call("PUT", `${L}/staff/employees/${nora}/instruments`, { instrumentIds: [xn, diff] }, A.token);
  check("fixture: 3 employees, 2 test systems, 1 duty-change event", !!nora && !!eli && !!office && !!xn && !!diff && (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_duty_change_events WHERE employee_id = ?").get(nora) as any).n === 1);

  const r = await fetch(`${base}${L}/staff/competency-register.xlsx`, { headers: { Authorization: `Bearer ${A.token}` } });
  const cd = r.headers.get("content-disposition") || "";
  check("1. 200, xlsx, attachment named for the lab", r.status === 200 && /spreadsheetml/.test(r.headers.get("content-type") || "") && /Competency_Register_Register_Lab_A_\d{4}-\d{2}-\d{2}\.xlsx/.test(cd), `${r.status} ${cd}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
  const names = wb.worksheets.map((w) => w.name);
  check("2. sheets: About, Testing Personnel, Duty-Change Reevaluations; About active", names.join("|") === "About|Testing Personnel|Duty-Change Reevaluations" && ((wb.views?.[0] as any)?.activeTab ?? 0) === 0, names.join("|"));
  const about = wb.getWorksheet("About")!, tp = wb.getWorksheet("Testing Personnel")!, dc = wb.getWorksheet("Duty-Change Reevaluations")!;
  const idText = String(about.getCell("A2").value);
  const hf = [about, tp, dc].map((w) => `${w.headerFooter?.oddHeader} / ${w.headerFooter?.oddFooter}`);
  check("3. identity: About row 2 + header and footer on every sheet", /Prepared for: Register Lab A\s+CLIA: 22D7777001/.test(idText) && hf.every((x) => /Register Lab A\s+CLIA: 22D7777001.*\/.*Register Lab A\s+CLIA: 22D7777001/.test(x)), `${idText} | ${hf[1]}`);
  const head = (tp.getRow(1).values as any[]).slice(1).map(String);
  const col = (h: string) => head.indexOf(h) + 1;
  const rowFor = (name: RegExp) => { for (let i = 2; i <= tp.rowCount; i++) if (name.test(String(tp.getRow(i).getCell(1).value))) return tp.getRow(i); return null; };
  const ymd = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
  const n = rowFor(/^Hale, Nora/);
  const link = n?.getCell(col("Training record")).value as any;
  check("4. new hire row: hire, recorded as, training date/by/link, initial, cleared, 6-month and 1st annual due",
    !!n && ymd(n.getCell(col("Hire date")).value) === "2026-01-05" && n.getCell(col("Recorded as")).value === "New hire"
      && ymd(n.getCell(col("Orientation / training completed")).value) === "2026-03-20" && n.getCell(col("Training documented by")).value === "J. Trainer"
      && link?.hyperlink === "https://example.sharepoint.com/t/nora.pdf" && ymd(n.getCell(col("Initial competency")).value) === "2026-04-06"
      && n.getCell(col("Cleared for patient testing")).value === "Yes" && ymd(n.getCell(col("6-month due")).value) === "2026-10-06"
      && ymd(n.getCell(col("1st annual due")).value) === "2027-04-06" && /Manual Differential/.test(String(n.getCell(col("Test systems assigned")).value)) && n.getCell(col("Open reevaluations")).value === 1,
    n ? JSON.stringify((n.values as any[]).slice(1).map(ymd)).slice(0, 400) : "row missing");
  const e = rowFor(/^Moss, Eli/);
  check("5. existing staff row: cleared as existing staff, annual due 2027-03-01, Compliant",
    !!e && e.getCell(col("Recorded as")).value === "Existing staff" && e.getCell(col("Cleared for patient testing")).value === "Existing staff"
      && ymd(e.getCell(col("Next annual due")).value) === "2027-03-01" && e.getCell(col("Status")).value === "Compliant",
    e ? JSON.stringify((e.values as any[]).slice(1).map(ymd)).slice(0, 300) : "row missing");
  check("6. non-testing employee not listed", !rowFor(/^Office, Pat/) && tp.rowCount === 3, `rows ${tp.rowCount}`);
  const d2 = dc.getRow(2);
  check("7. reevaluations: Manual Differential added after setup, Open", String(d2.getCell(1).value).startsWith("Hale, Nora") && d2.getCell(2).value === "Manual Differential" && d2.getCell(4).value === "Open" && dc.rowCount === 2, JSON.stringify((d2.values as any[]).slice(1).map(ymd)));
  const fill = (tp.getRow(1).getCell(1).fill as any)?.fgColor?.argb;
  const frozen = (tp.views?.[0] as any);
  check("8. protected sheets, teal header, frozen at B2", !!(tp as any).sheetProtection && !!(about as any).sheetProtection && fill === "FF01696F" && frozen?.state === "frozen" && frozen?.xSplit === 1 && frozen?.ySplit === 1, `${fill} ${JSON.stringify(frozen)}`);
  const other = await fetch(`${base}${L}/staff/competency-register.xlsx`, { headers: { Authorization: `Bearer ${B.token}` } });
  check("9. another lab's owner cannot download it", other.status === 403 || other.status === 404, String(other.status));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
