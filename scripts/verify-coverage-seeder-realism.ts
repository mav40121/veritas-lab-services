// scripts/verify-coverage-seeder-realism.ts
//
// Receipt for BUG-023 (Michael Q70 = 1, 2026-10-10): the VeritaCheck coverage seeder writes values a lab director
// would recognize. Boots the REAL routes on a scratch DB, builds a map (hematology, coagulation, chemistry, blood
// bank, urinalysis, plus one analyte with no known profile), runs POST /api/admin/veritacheck/seed-coverage-studies,
// then the real boot recompute (recomputeAllStudyStatuses), and checks:
//   1. Hemoglobin correlation and cal ver values sit in 5-20 g/dL with units g/dL and the CLIA criterion +-4%
//   2. PT values sit in 10-45 sec (lab-set 10% goal: no CLIA criterion in teaData)
//   3. Sodium uses the absolute CLIA criterion +-4 mmol/L, Potassium +-0.3 mmol/L, Glucose +-8% or 6 mg/dL
//   4. ABO is a qualitative study (categories include O) on exactly two methods; urine Protein is graded
//   5. every seeded study carries the signer's name (no more "Signed Off by on")
//   6. dates are spread over the past ~5 months, none in the future
//   7. after the boot recompute every seeded study is still PASS
//   8. the analyte with no profile is reported in genericScale, and no known analyte is
// Run (Windows, from bash): DB_PATH=.tmp-seed.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-coverage-seeder-realism.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../server/db");
  const routes = await import("../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await routes.registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    try { return await r.json(); } catch { return {}; }
  };

  const email = `seed-real-${Date.now()}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Dana Whitfield", hipaa_acknowledged: true });
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Seed Realism Lab", plan: "hospital" })).labId;
  const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Core Lab" }, reg.token);
  const t = (analyte: string, specialty: string, complexity = "MODERATE") => ({ analyte, specialty, complexity, active: 1 });
  const seeded = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [
    { name: "Sysmex XN-1000", tests: [t("Hemoglobin", "Hematology"), t("Platelet Count", "Hematology")] },
    { name: "Sysmex XN-450", tests: [t("Hemoglobin", "Hematology"), t("Platelet Count", "Hematology")] },
    { name: "Sysmex CA-660 Primary", tests: [t("PT", "Coagulation"), t("PTT", "Coagulation")] },
    { name: "Sysmex CA-660 Backup", tests: [t("PT", "Coagulation"), t("PTT", "Coagulation")] },
    { name: "Ortho VITROS 5600 Primary", tests: [t("Sodium", "General Chemistry"), t("Potassium", "General Chemistry"), t("Glucose", "General Chemistry"), t("Zebra Factor", "General Chemistry")] },
    { name: "Ortho VITROS 5600 Backup", tests: [t("Sodium", "General Chemistry"), t("Potassium", "General Chemistry"), t("Glucose", "General Chemistry"), t("Zebra Factor", "General Chemistry")] },
    { name: "Ortho Echo Lumena", tests: [t("ABO", "Blood Bank", "HIGH"), t("Antibody Screen", "Blood Bank", "HIGH")] },
    { name: "Tube Method", tests: [t("ABO", "Blood Bank", "HIGH"), t("Antibody Screen", "Blood Bank", "HIGH")] },
    { name: "Beckman iChem Velocity", tests: [t("Protein", "Urinalysis")] },
    { name: "Siemens Clinitek Novus", tests: [t("Protein", "Urinalysis")] },
  ] });
  check("fixture map seeded", (seeded?.totals?.inserted ?? 0) >= 20, JSON.stringify(seeded?.totals));

  const res = await call("POST", "/api/admin/veritacheck/seed-coverage-studies", { secret: ADMIN, labId, calVerTargetPct: 0.999, mcTargetPct: 0.999 });
  const rows = sqlite.prepare("SELECT * FROM studies WHERE lab_id = ? AND comment = 'COVERAGE_SEED v1' AND archived_at IS NULL").all(labId) as any[];
  check("seeder ran and wrote studies", res?.ok === true && rows.length >= 10, `ok=${res?.ok} studies=${rows.length} mc=${JSON.stringify(res?.methodComparison)} cal=${JSON.stringify(res?.calVer)}`);
  const pick = (name: string, type: string) => rows.find((r) => r.test_name === name && r.study_type === type);
  const nums = (r: any) => { const dp = JSON.parse(r?.data_points || "[]"); const pts = Array.isArray(dp) ? dp : []; return pts.flatMap((p: any) => [p.expectedValue, ...Object.values(p.instrumentValues || {})]).filter((v: any) => typeof v === "number"); };
  const inRange = (r: any, lo: number, hi: number) => { const v = nums(r); return v.length > 0 && v.every((x: number) => x >= lo && x <= hi); };

  const hgbMc = pick("Hemoglobin", "method_comparison"), hgbCv = pick("Hemoglobin", "cal_ver");
  check("1. Hemoglobin correlation and cal ver in 5-20 g/dL, units g/dL, CLIA +-4%", inRange(hgbMc, 5, 20) && inRange(hgbCv, 5, 20) && hgbMc?.result_units === "g/dL" && hgbMc?.clia_allowable_error === 0.04 && hgbMc?.tea_is_percentage === 1,
    `mc ${Math.min(...nums(hgbMc))}-${Math.max(...nums(hgbMc))} ${hgbMc?.result_units} tea ${hgbMc?.clia_allowable_error}; cv ${Math.min(...nums(hgbCv))}-${Math.max(...nums(hgbCv))}`);
  const pt = pick("PT", "method_comparison");
  check("2. PT values in 10-45 sec, lab-set 10% goal", inRange(pt, 10, 45) && pt?.result_units === "sec" && pt?.clia_allowable_error === 0.1, `${Math.min(...nums(pt))}-${Math.max(...nums(pt))} ${pt?.result_units} tea ${pt?.clia_allowable_error}`);
  const na = pick("Sodium", "method_comparison"), k = pick("Potassium", "method_comparison"), glu = pick("Glucose", "method_comparison");
  check("3. Sodium +-4 mmol/L absolute, Potassium +-0.3 absolute, Glucose +-8% or 6 mg/dL",
    na?.tea_is_percentage === 0 && na?.clia_allowable_error === 4 && k?.tea_is_percentage === 0 && k?.clia_allowable_error === 0.3 && glu?.tea_is_percentage === 1 && glu?.clia_allowable_error === 0.08 && glu?.clia_absolute_floor === 6 && inRange(na, 110, 170) && inRange(k, 2, 8),
    JSON.stringify({ na: [na?.clia_allowable_error, na?.tea_is_percentage], k: [k?.clia_allowable_error, k?.tea_is_percentage], glu: [glu?.clia_allowable_error, glu?.clia_absolute_floor] }));
  const abo = pick("ABO", "method_comparison"), prot = pick("Protein", "method_comparison");
  const aboDp = JSON.parse(abo?.data_points || "{}"), protDp = JSON.parse(prot?.data_points || "{}");
  check("4. ABO qualitative on two methods (categories include O); urine Protein graded", aboDp.assayType === "qualitative" && aboDp.categories?.includes("O") && JSON.parse(abo.instruments).length === 2 && protDp.assayType === "semi_quantitative" && protDp.gradeScale?.includes("Trace"),
    `abo ${aboDp.assayType} ${JSON.stringify(aboDp.categories)} on ${abo?.instruments}; protein ${protDp.assayType}`);
  check("5. every seeded study carries the signer's name", rows.every((r) => r.finalized_signature === "Dana Whitfield"), [...new Set(rows.map((r) => r.finalized_signature))].join(" | "));
  const today = new Date().toISOString().slice(0, 10);
  const dates = rows.map((r) => r.date);
  const ageDays = (d: string) => (Date.parse(today) - Date.parse(d)) / 86400000;
  check("6. dates spread over the past ~5 months, none in the future", new Set(dates).size >= 5 && dates.every((d) => ageDays(d) >= 1 && ageDays(d) <= 170), `${new Set(dates).size} distinct, oldest ${Math.max(...dates.map(ageDays))} days`);
  routes.recomputeAllStudyStatuses();
  const after = sqlite.prepare("SELECT id, test_name, study_type, status FROM studies WHERE lab_id = ? AND comment = 'COVERAGE_SEED v1' AND archived_at IS NULL").all(labId) as any[];
  const notPass = after.filter((r) => r.status !== "pass");
  check("7. after the boot recompute every seeded study is still PASS", after.length === rows.length && notPass.length === 0, notPass.map((r) => `${r.id} ${r.test_name} ${r.study_type} ${r.status}`).join("; ") || `${after.length} pass`);
  const gs: string[] = res?.genericScale || [];
  check("8. only the unknown analyte is reported on the generic scale", gs.length > 0 && gs.every((x) => /Zebra Factor/.test(x)), JSON.stringify(gs));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
