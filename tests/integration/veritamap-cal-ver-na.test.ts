// tests/integration/veritamap-cal-ver-na.test.ts
//
// Receipt for parking-lot #77 part B (2026-10-07): a lab can mark one test's
// calibration verification "not applicable" with a required reason, and every
// surface that reports cal ver status honors it. Boots the REAL routes on a
// scratch DB and proves:
//   1. a fresh map reports cal_ver_na 0 on every test
//   2. marking N/A without a reason is refused (400) and nothing changes
//   3. marking N/A with a reason stores it with who and when; the map detail returns it
//   4. the labwide view returns it
//   5. VeritaCheck coverage no longer requires linearity for that analyte (the other analyte still does)
//   6. it survives a tests-save on the instrument (the rebuild path)
//   7. the Excel export still renders (200, spreadsheet content type)
//   8. clearing it (cal_ver_na 0) clears the reason and the stamp
//   9. another lab's token cannot set it (403/404)
//
// Run (Windows, from bash): DB_PATH=.tmp-cvna.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-cal-ver-na.test.ts
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
    const email = `cvna-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `CVNA ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `CVNA Lab ${tag}`, plan: "hospital" }));
    return { token: reg.token as string, labId: prov.labId as number, userId: Number(reg.user?.id ?? reg.userId ?? 0) };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two labs provisioned", !!A.labId && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));

  const map = await j(await call("POST", `/api/labs/${A.labId}/veritamap/maps`, { name: "CVNA Hematology" }, A.token));
  const i1 = await j(await call("POST", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Sysmex XN-1000", role: "Primary", category: "Hematology" }, A.token));
  const tests = [
    { analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 },
    { analyte: "HGB", specialty: "Hematology", complexity: "MODERATE", active: 1 },
  ];
  const t1 = await call("PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments/${i1.id}/tests`, { tests }, A.token);
  check("fixture: map, instrument, two tests", !!map.id && !!i1.id && t1.status === 200, `map=${map.id} inst=${i1.id} ${t1.status}`);

  const detail = async () => j(await call("GET", `/api/labs/${A.labId}/veritamap/maps/${map.id}`, undefined, A.token));
  const hgb = (d: any) => (d.tests || []).find((t: any) => t.analyte === "HGB");
  const row = () => sqlite.prepare("SELECT cal_ver_na, cal_ver_na_reason, cal_ver_na_set_by, cal_ver_na_set_at FROM veritamap_tests WHERE map_id = ? AND analyte = 'HGB'").get(map.id) as any;
  const setNa = (body: any, token = A.token) => call("PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/tests/HGB`, body, token);

  let d = await detail();
  check("1. fresh map: cal_ver_na 0 everywhere", (d.tests || []).length === 2 && (d.tests || []).every((t: any) => !t.cal_ver_na), JSON.stringify((d.tests || []).map((t: any) => [t.analyte, t.cal_ver_na])));

  const r2 = await setNa({ cal_ver_na: 1 });
  check("2. N/A without a reason -> 400, row unchanged", r2.status === 400 && row().cal_ver_na === 0, `status=${r2.status} ${JSON.stringify(row())}`);

  const reason = "Qualitative method; no calibration to verify";
  const r3 = await setNa({ cal_ver_na: 1, cal_ver_na_reason: reason });
  d = await detail();
  const rw = row();
  check("3. N/A with a reason -> 200; stored with who and when; detail returns it", r3.status === 200 && rw.cal_ver_na === 1 && rw.cal_ver_na_reason === reason && Number(rw.cal_ver_na_set_by) === A.userId && !!rw.cal_ver_na_set_at && hgb(d)?.cal_ver_na === 1 && hgb(d)?.cal_ver_na_reason === reason, JSON.stringify({ status: r3.status, rw, detail: [hgb(d)?.cal_ver_na, hgb(d)?.cal_ver_na_reason] }));

  const lw = await j(await call("GET", `/api/labs/${A.labId}/veritamap/labwide`, undefined, A.token));
  const lwHgb = findAll(lw, (o) => o.analyte === "HGB" && "cal_ver_na" in o);
  check("4. labwide view carries cal_ver_na and the reason", lwHgb.length > 0 && lwHgb.every((o) => o.cal_ver_na === 1 && o.cal_ver_na_reason === reason), JSON.stringify(lwHgb.slice(0, 1)));

  const cov = await j(await call("GET", `/api/labs/${A.labId}/veritacheck/coverage`, undefined, A.token));
  const covHgb = findAll(cov, (o) => o.analyte === "HGB" && "linearityRequired" in o);
  const covWbc = findAll(cov, (o) => o.analyte === "WBC" && "linearityRequired" in o);
  check("5. coverage: HGB no longer requires linearity, WBC still does", covHgb.length > 0 && covHgb.every((o) => o.linearityRequired === false) && covWbc.length > 0 && covWbc.every((o) => o.linearityRequired === true), JSON.stringify({ hgb: covHgb.map((o) => o.linearityRequired), wbc: covWbc.map((o) => o.linearityRequired) }));

  const t2 = await call("PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments/${i1.id}/tests`, { tests }, A.token);
  check("6. survives a tests-save on the instrument", t2.status === 200 && row().cal_ver_na === 1 && row().cal_ver_na_reason === reason, JSON.stringify(row()));

  const xl = await call("POST", `/api/labs/${A.labId}/veritamap/maps/${map.id}/excel`, {}, A.token);
  check("7. Excel export still renders", xl.status === 200 && /spreadsheet|octet-stream/i.test(xl.headers.get("content-type") || ""), `status=${xl.status} type=${xl.headers.get("content-type")}`);

  const r8 = await setNa({ cal_ver_na: 0 });
  const rw8 = row();
  check("8. clearing -> 0, reason and stamp cleared", r8.status === 200 && rw8.cal_ver_na === 0 && rw8.cal_ver_na_reason === null && rw8.cal_ver_na_set_by === null && rw8.cal_ver_na_set_at === null, JSON.stringify(rw8));

  const r9 = await setNa({ cal_ver_na: 1, cal_ver_na_reason: reason }, B.token);
  check("9. another lab's token is refused (403/404) and nothing changes", (r9.status === 403 || r9.status === 404) && row().cal_ver_na === 0, `status=${r9.status}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
