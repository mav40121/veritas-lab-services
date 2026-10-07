// tests/integration/veritamap-cal-ver-exempt.test.ts
//
// Receipt for parking-lot #77 (Lisa, 2026-10-07, Milford CCL Hematology): a test
// whose instrument rows carry a linearity / cal ver exemption flag must come
// back from the map detail as cal_ver_exempt, so the map page stops showing it
// as "cal ver required". Boots the REAL routes on a scratch DB and proves:
//   1. a fresh map reports cal_ver_exempt=false on every test and every instrument row
//   2. flagging the only instrument carrying an analyte (real PATCH .../coverage/exemption)
//      flips that test to cal_ver_exempt=true and the instrument row to 1
//   3. an analyte on two instruments stays false while only one is flagged, and
//      flips to true once both are
//   4. clearing the flags flips it back to false
//   5. the "other reason" text alone counts as an exemption
//   6. another lab's token cannot read the map (403/404)
//
// Run (Windows, from bash): DB_PATH=.tmp-cve.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-cal-ver-exempt.test.ts
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
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const mkLab = async (tag: string) => {
    const email = `cve-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `CVE ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `CVE Lab ${tag}`, plan: "hospital" }));
    return { token: reg.token as string, labId: prov.labId as number };
  };
  const A = await mkLab("A");
  const B = await mkLab("B");
  check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));

  // Map on lab A: XN-1000 carries WBC + HGB; XN-2000 carries WBC only.
  const map = await j(await call("POST", `/api/labs/${A.labId}/veritamap/maps`, { name: "CVE Hematology" }, A.token));
  const i1 = await j(await call("POST", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Sysmex XN-1000", role: "Primary", category: "Hematology" }, A.token));
  const i2 = await j(await call("POST", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Sysmex XN-2000", role: "Backup", category: "Hematology" }, A.token));
  const t1 = await call("PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments/${i1.id}/tests`, { tests: [
    { analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 },
    { analyte: "HGB", specialty: "Hematology", complexity: "MODERATE", active: 1 },
  ] }, A.token);
  const t2 = await call("PUT", `/api/labs/${A.labId}/veritamap/maps/${map.id}/instruments/${i2.id}/tests`, { tests: [
    { analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 },
  ] }, A.token);
  check("fixture: map, two instruments, tests saved", !!map.id && !!i1.id && !!i2.id && t1.status === 200 && t2.status === 200, `map=${map.id} statuses ${t1.status}/${t2.status}`);

  const detail = async () => j(await call("GET", `/api/labs/${A.labId}/veritamap/maps/${map.id}`, undefined, A.token));
  const byAnalyte = (d: any, a: string) => (d.tests || []).find((t: any) => t.analyte === a);
  const rowId = (d: any, a: string, inst: number) => (byAnalyte(d, a)?.instruments || []).find((x: any) => x.id === inst)?.instrument_test_id;

  let d = await detail();
  check("1. fresh map: every test cal_ver_exempt=false", (d.tests || []).length === 2 && (d.tests || []).every((t: any) => t.cal_ver_exempt === false), JSON.stringify((d.tests || []).map((t: any) => [t.analyte, t.cal_ver_exempt])));
  check("1. fresh map: every instrument row cal_ver_exempt=0", (d.tests || []).every((t: any) => (t.instruments || []).every((x: any) => x.cal_ver_exempt === 0)));

  const exempt = (instrumentTestId: number, patch: Partial<{ multical: boolean; noncal: boolean; waived: boolean; otherReason: string }>) =>
    call("PATCH", `/api/labs/${A.labId}/veritacheck/coverage/exemption`, { instrumentTestId, multical: false, noncal: false, waived: false, otherReason: "", ...patch }, A.token);

  // 2. HGB lives only on XN-1000: flag it there.
  const hgbOn1 = rowId(d, "HGB", i1.id);
  const r2 = await exempt(hgbOn1, { noncal: true });
  d = await detail();
  check("2. exemption PATCH accepted (real route)", r2.status === 200, `status=${r2.status}`);
  check("2. HGB (only instrument flagged) -> cal_ver_exempt=true", byAnalyte(d, "HGB")?.cal_ver_exempt === true, JSON.stringify(byAnalyte(d, "HGB")?.instruments));
  check("2. HGB instrument row reports cal_ver_exempt=1", (byAnalyte(d, "HGB")?.instruments || [])[0]?.cal_ver_exempt === 1);

  // 3. WBC is on both instruments: one flag is not enough.
  const wbcOn1 = rowId(d, "WBC", i1.id);
  const wbcOn2 = rowId(d, "WBC", i2.id);
  await exempt(wbcOn1, { multical: true });
  d = await detail();
  check("3. WBC flagged on one of two instruments -> still false", byAnalyte(d, "WBC")?.cal_ver_exempt === false, JSON.stringify((byAnalyte(d, "WBC")?.instruments || []).map((x: any) => [x.instrument_name, x.cal_ver_exempt])));
  await exempt(wbcOn2, { waived: true });
  d = await detail();
  check("3. WBC flagged on both -> true", byAnalyte(d, "WBC")?.cal_ver_exempt === true);

  // 4. Clearing the flags flips it back.
  await exempt(hgbOn1, {});
  d = await detail();
  check("4. HGB flags cleared -> false", byAnalyte(d, "HGB")?.cal_ver_exempt === false);

  // 5. Other-reason text alone counts.
  await exempt(hgbOn1, { otherReason: "Qualitative method, no calibration" });
  d = await detail();
  check("5. other-reason text alone -> true", byAnalyte(d, "HGB")?.cal_ver_exempt === true);

  // 6. Lab B cannot read lab A's map.
  const rb = await call("GET", `/api/labs/${A.labId}/veritamap/maps/${map.id}`, undefined, B.token);
  check("6. another lab's token is refused (403/404)", rb.status === 403 || rb.status === 404, `status=${rb.status}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
