// tests/integration/veritamap-method-comp-na.test.ts
//
// Receipt for BUG-015 (Michael Q65 = 1, 2026-10-10): a lab can mark one test's correlation / method comparison
// "not applicable" with a required reason (tests that share only a generic CMS analyte name, e.g. ANTIMICROBIAL
// across MicroScan panels that cover different organism groups), and every surface that decides "correlation
// required" honors it. Boots the REAL routes on a scratch DB and proves:
//   1. fixture: ANTIMICROBIAL on two panels (map 1) and a third panel (map 2) is required on both maps; the control
//      analyte (Organism ID) is required too
//   2. marking N/A without a reason is refused (400) and nothing changes
//   3. N/A with a reason is stored with who and when; map detail returns it and counts 0 instruments
//   4. intelligence: ANTIMICROBIAL no longer required, the control still is
//   5. map list gaps drop by one (both analytes have a cal ver date, so only the comparison counts)
//   6. map 2: the third panel no longer pairs with map 1's N/A panels (lab-wide count)
//   7. labwide view carries the flag and the reason
//   8. VeritaCheck coverage: no method comparison row for ANTIMICROBIAL; the control row remains
//   9. Excel export shows "N/A (<reason>)" in the Correlation status column
//  10. survives a tests-save on the instrument (the rebuild path)
//  11. clearing it restores the requirement and clears the reason and stamp
//  12. another lab's token is refused (403/404)
//
// Run (Windows, from bash): DB_PATH=.tmp-mcna.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-method-comp-na.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
function findAll(obj: any, pred: (o: any) => boolean, out: any[] = []): any[] {
  if (Array.isArray(obj)) { for (const x of obj) findAll(x, pred, out); }
  else if (obj && typeof obj === "object") { if (pred(obj)) out.push(obj); for (const v of Object.values(obj)) findAll(v, pred, out); }
  return out;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { default: ExcelJS } = await import("exceljs");
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
    const email = `mcna-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `MCNA ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `MCNA Lab ${tag}`, plan: "hospital" }));
    return { token: reg.token as string, labId: prov.labId as number, userId: Number(reg.user?.id ?? reg.userId ?? 0) };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  const L = `/api/labs/${A.labId}/veritamap`;

  const tests = [
    { analyte: "ANTIMICROBIAL", specialty: "Microbiology", complexity: "HIGH", active: 1 },
    { analyte: "Organism ID", specialty: "Microbiology", complexity: "HIGH", active: 1 },
  ];
  const m1 = await j(await call("POST", `${L}/maps`, { name: "MCNA Micro" }, A.token));
  const gn = await j(await call("POST", `${L}/maps/${m1.id}/instruments`, { instrument_name: "MicroScan Dried Gram-Negative MIC/Combo", role: "Primary", category: "Microbiology" }, A.token));
  const gp = await j(await call("POST", `${L}/maps/${m1.id}/instruments`, { instrument_name: "MicroScan Dried Gram-Positive MIC/Combo", role: "Primary", category: "Microbiology" }, A.token));
  for (const i of [gn, gp]) await call("PUT", `${L}/maps/${m1.id}/instruments/${i.id}/tests`, { tests }, A.token);
  const m2 = await j(await call("POST", `${L}/maps`, { name: "MCNA Micro 2" }, A.token));
  const st = await j(await call("POST", `${L}/maps/${m2.id}/instruments`, { instrument_name: "MicroScan MICroSTREP plus", role: "Primary", category: "Microbiology" }, A.token));
  await call("PUT", `${L}/maps/${m2.id}/instruments/${st.id}/tests`, { tests: [tests[0]] }, A.token);
  // Cal ver dated on both map-1 analytes, so the map-list gap count reflects only the comparison.
  for (const a of ["ANTIMICROBIAL", "Organism ID"]) await call("PUT", `${L}/maps/${m1.id}/tests/${encodeURIComponent(a)}`, { last_cal_ver: new Date().toISOString().slice(0, 10) }, A.token);

  const detail = async (id: number) => j(await call("GET", `${L}/maps/${id}`, undefined, A.token));
  const rowOf = (d: any, a: string) => (d.tests || []).find((t: any) => t.analyte === a);
  const intel = async () => j(await call("GET", `${L}/maps/${m1.id}/intelligence`, undefined, A.token));
  const gaps = async () => { const list = await j(await call("GET", `${L}/maps`, undefined, A.token)); return (Array.isArray(list) ? list : []).find((m: any) => m.id === m1.id)?.gaps; };
  const dbRow = () => sqlite.prepare("SELECT method_comp_na, method_comp_na_reason, method_comp_na_set_by, method_comp_na_set_at FROM veritamap_tests WHERE map_id = ? AND analyte = 'ANTIMICROBIAL'").get(m1.id) as any;
  const setNa = (body: any, token = A.token) => call("PUT", `${L}/maps/${m1.id}/tests/ANTIMICROBIAL`, body, token);

  let d1 = await detail(m1.id), d2 = await detail(m2.id), it = await intel();
  const gaps0 = await gaps();
  check("1. fixture: ANTIMICROBIAL required on map 1 (3 panels lab-wide) and map 2; Organism ID required",
    rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count === 3 && rowOf(d2, "ANTIMICROBIAL")?.correlation_instrument_count === 3 &&
    it.intelligence?.ANTIMICROBIAL?.correlationRequired === true && it.intelligence?.["Organism ID"]?.correlationRequired === true && gaps0 === 2,
    JSON.stringify({ m1: rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count, m2: rowOf(d2, "ANTIMICROBIAL")?.correlation_instrument_count, gaps0 }));

  const r2 = await setNa({ method_comp_na: 1 });
  check("2. N/A without a reason -> 400, row unchanged", r2.status === 400 && dbRow().method_comp_na === 0, `status=${r2.status} ${JSON.stringify(dbRow())}`);

  const reason = "Panels cover different organism groups";
  const r3 = await setNa({ method_comp_na: 1, method_comp_na_reason: reason });
  d1 = await detail(m1.id);
  const rw = dbRow();
  check("3. N/A with a reason -> 200; stored with who and when; detail returns it and counts 0 instruments",
    r3.status === 200 && rw.method_comp_na === 1 && rw.method_comp_na_reason === reason && Number(rw.method_comp_na_set_by) === A.userId && !!rw.method_comp_na_set_at &&
    rowOf(d1, "ANTIMICROBIAL")?.method_comp_na === 1 && rowOf(d1, "ANTIMICROBIAL")?.method_comp_na_reason === reason && rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count === 0,
    JSON.stringify({ status: r3.status, rw, count: rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count }));

  it = await intel();
  check("4. intelligence: ANTIMICROBIAL not required, Organism ID still required",
    it.intelligence?.ANTIMICROBIAL?.correlationRequired === false && it.intelligence?.["Organism ID"]?.correlationRequired === true,
    JSON.stringify({ amr: it.intelligence?.ANTIMICROBIAL?.correlationRequired, org: it.intelligence?.["Organism ID"]?.correlationRequired }));

  const gaps1 = await gaps();
  check("5. map list gaps drop from 2 to 1", gaps1 === 1, `gaps ${gaps0} -> ${gaps1}`);

  d2 = await detail(m2.id);
  check("6. map 2: the third panel no longer pairs with map 1's N/A panels", rowOf(d2, "ANTIMICROBIAL")?.correlation_instrument_count === 1, `count=${rowOf(d2, "ANTIMICROBIAL")?.correlation_instrument_count}`);

  const lw = await j(await call("GET", `${L}/labwide`, undefined, A.token));
  const lwRows = findAll(lw, (o) => o.analyte === "ANTIMICROBIAL" && "method_comp_na" in o && o.map_id === m1.id);
  check("7. labwide view carries method_comp_na and the reason", lwRows.length > 0 && lwRows.every((o) => o.method_comp_na === 1 && o.method_comp_na_reason === reason), JSON.stringify(lwRows.slice(0, 1)));

  const cov = await j(await call("GET", `/api/labs/${A.labId}/veritacheck/coverage`, undefined, A.token));
  const mcRows = Array.isArray(cov.methodComparisons) ? cov.methodComparisons : findAll(cov, (o) => "instruments" in o && "hasStudy" in o);
  check("8. coverage: no comparison row for ANTIMICROBIAL; Organism ID row remains",
    !mcRows.some((m: any) => m.analyte === "ANTIMICROBIAL") && mcRows.some((m: any) => m.analyte === "Organism ID"), JSON.stringify(mcRows.map((m: any) => m.analyte)));

  const xl = await call("POST", `${L}/maps/${m1.id}/excel`, {}, A.token);
  let xlCell = "";
  if (xl.status === 200) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xl.arrayBuffer()) as any);
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { const v = String(c.value ?? ""); if (v.startsWith("N/A (") && v.includes(reason)) xlCell = v; })));
  }
  check("9. Excel export shows the N/A reason in the correlation status", xl.status === 200 && xlCell === `N/A (${reason})`, `status=${xl.status} cell=${xlCell}`);

  await call("PUT", `${L}/maps/${m1.id}/instruments/${gn.id}/tests`, { tests }, A.token);
  check("10. survives a tests-save on the instrument", dbRow().method_comp_na === 1 && dbRow().method_comp_na_reason === reason, JSON.stringify(dbRow()));

  const r11 = await setNa({ method_comp_na: 0 });
  const rw11 = dbRow();
  d1 = await detail(m1.id);
  check("11. clearing -> requirement back (3 instruments), reason and stamp cleared",
    r11.status === 200 && rw11.method_comp_na === 0 && rw11.method_comp_na_reason === null && rw11.method_comp_na_set_by === null && rw11.method_comp_na_set_at === null && rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count === 3,
    JSON.stringify({ rw11, count: rowOf(d1, "ANTIMICROBIAL")?.correlation_instrument_count }));

  const r12 = await setNa({ method_comp_na: 1, method_comp_na_reason: reason }, B.token);
  check("12. another lab's token is refused (403/404) and nothing changes", (r12.status === 403 || r12.status === 404) && dbRow().method_comp_na === 0, `status=${r12.status}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
