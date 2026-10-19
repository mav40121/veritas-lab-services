// tests/integration/veritamap-specimen-reportable.test.ts
//
// Lindsay Webber (Redington-Fairview), 2026-10-19, REQ-079 / REQ-080: "Take calcium for example. With a Vitros we run
// urine and serum/plasma using the same reagent. The fluid types have different reference ranges and AMRs ... could
// you make it so that you could add another fluid band?" and "add reportable range in addition to reference and AMR
// ... that incorporates the highest possible dilution factor". Michael Q = 1. This pins:
//   1. migration: a database in the old shape (no specimen type) keeps every row, attestation and lock; old rows
//      become "all specimen types"; the new unique keys hold
//   2. a urine band is its own reference-range band beside the all-specimen band; attesting one locks only it
//   3. an AMR per specimen type, with the reportable range and maximum dilution; a save that leaves out the reportable
//      fields keeps them; attesting the urine AMR locks only the urine AMR
//   4. specimen names are normalized ("All" = all specimen types) and an overlong name is refused
//   5. the Excel export has Specimen Type and the reportable columns, a urine row with urine values, and a row for a
//      specimen type that has an AMR but no reference-range band
//   6. the legacy (non-lab-scoped) PUT still writes the all-specimen band
// Run (Windows, from bash): DB_PATH=.tmp-specimen.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-specimen-reportable.test.ts
import http from "node:http";
import fs from "node:fs";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
const require_ = createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// 1) Seed the scratch DB in the OLD shape before the server's db module opens it, so its migration runs on real rows.
const DBP = process.env.DB_PATH!;
for (const f of [DBP, `${DBP}-wal`, `${DBP}-shm`]) { try { fs.unlinkSync(f); } catch { /* none */ } }
{
  const Database = require_("better-sqlite3");
  const old = new Database(DBP);
  old.exec(`
    CREATE TABLE veritamap_analyte_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, analyte TEXT NOT NULL,
      age_min_days INTEGER NOT NULL DEFAULT 0, age_max_days INTEGER NOT NULL DEFAULT 999999, sex TEXT NOT NULL DEFAULT 'A',
      band_label TEXT, ref_range_low TEXT, ref_range_high TEXT, critical_low TEXT, critical_high TEXT, units TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), mec_reviewed_at TEXT, mec_reviewed_by TEXT,
      ref_attested_at TEXT, ref_attested_by TEXT, ref_attested_title TEXT, ref_locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(map_id, analyte, age_min_days, age_max_days, sex));
    CREATE TABLE veritamap_amr_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, instrument_id INTEGER NOT NULL, analyte TEXT NOT NULL,
      amr_low TEXT, amr_high TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      amr_attested_at TEXT, amr_attested_by TEXT, amr_attested_title TEXT, amr_locked INTEGER NOT NULL DEFAULT 0,
      UNIQUE(map_id, instrument_id, analyte));
    INSERT INTO veritamap_analyte_values (map_id, analyte, band_label, ref_range_low, ref_range_high, units, ref_attested_at, ref_attested_by, ref_attested_title, ref_locked)
      VALUES (9001, 'Sodium', 'All ages', '136', '145', 'mmol/L', '2026-09-01T00:00:00Z', 'Pat Director', 'Medical Director', 1);
    INSERT INTO veritamap_analyte_values (map_id, analyte, age_min_days, age_max_days, sex, band_label, ref_range_low, ref_range_high)
      VALUES (9001, 'Sodium', 0, 6570, 'A', '0 to 18 y', '135', '144');
    INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high, amr_attested_at, amr_attested_by, amr_attested_title, amr_locked)
      VALUES (9001, 77, 'Sodium', '75', '250', '2026-09-02T00:00:00Z', 'Pat Director', 'Medical Director', 1);
  `);
  old.close();
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  // 1) migration
  const migratedAv = sqlite.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id = 9001 ORDER BY age_max_days DESC").all() as any[];
  const migratedAmr = sqlite.prepare("SELECT * FROM veritamap_amr_values WHERE map_id = 9001").all() as any[];
  check("1a. migration keeps both reference-range bands, each now all specimen types, with the attestation and lock",
    migratedAv.length === 2 && migratedAv.every((r) => r.specimen_type === "") && migratedAv[0].ref_locked === 1 && migratedAv[0].ref_attested_by === "Pat Director" && migratedAv[1].ref_range_low === "135",
    JSON.stringify(migratedAv.map((r) => [r.band_label, r.specimen_type, r.ref_locked])));
  check("1b. migration keeps the attested AMR, all specimen types, reportable fields blank",
    migratedAmr.length === 1 && migratedAmr[0].specimen_type === "" && migratedAmr[0].amr_locked === 1 && migratedAmr[0].amr_low === "75" && migratedAmr[0].reportable_low === null && migratedAmr[0].max_dilution === null,
    JSON.stringify(migratedAmr[0]));
  const idxCols = (t: string) => {
    const idx = (sqlite.prepare(`PRAGMA index_list(${t})`).all() as any[]).find((i) => i.unique && i.origin === "u");
    return idx ? (sqlite.prepare(`PRAGMA index_info(${idx.name})`).all() as any[]).map((c) => c.name).join(",") : "";
  };
  check("1c. the unique keys now include specimen_type",
    idxCols("veritamap_analyte_values") === "map_id,analyte,age_min_days,age_max_days,sex,specimen_type" && idxCols("veritamap_amr_values") === "map_id,instrument_id,analyte,specimen_type",
    `${idxCols("veritamap_analyte_values")} | ${idxCols("veritamap_amr_values")}`);

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, r, body: await r.clone().json().catch(() => ({})) as any };
  };

  const email = `specimen-${Date.now()}@example.com`;
  const reg = (await call("POST", "/api/auth/register", { email, password: ["Zq", "spec", "7x!"].join("-"), name: "Spec Test", hipaa_acknowledged: true })).body;
  const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Specimen Lab", plan: "hospital" })).body.labId;
  const T = reg.token as string;
  const L = `/api/labs/${lab}/veritamap`;
  const map = (await call("POST", `${L}/maps`, { name: "Specimen Chemistry" }, T)).body;
  const v1 = (await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, T)).body;
  const t = (analyte: string) => ({ analyte, specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 });
  await call("PUT", `${L}/maps/${map.id}/instruments/${v1.id}/tests`, { tests: [t("Calcium"), t("Microalbumin")] }, T);
  const M = `${L}/maps/${map.id}`;

  // 2) reference ranges by specimen type
  const serum = await call("PUT", `${M}/analyte-values/Calcium`, { ref_range_low: "8.6", ref_range_high: "10.3", units: "mg/dL" }, T);
  const urine = await call("PUT", `${M}/analyte-values/Calcium`, { ref_range_low: "100", ref_range_high: "300", units: "mg/24 h", specimen_type: "Urine, 24-hour" }, T);
  const bands = (await call("GET", `${M}/analyte-values`, undefined, T)).body.filter((r: any) => r.analyte === "Calcium");
  check("2a. the urine band saves beside the all-specimen band, each with its own values",
    serum.status === 200 && urine.status === 200 && bands.length === 2 &&
    bands.find((b: any) => b.specimen_type === "")?.ref_range_low === "8.6" && bands.find((b: any) => b.specimen_type === "Urine, 24-hour")?.ref_range_low === "100",
    JSON.stringify(bands.map((b: any) => [b.specimen_type, b.ref_range_low, b.units])));
  const attest = await call("POST", `${M}/analyte-values/Calcium/attest-ref`, { attested_by: "Pat Director", attested_title: "Medical Director", specimen_type: "Urine, 24-hour" }, T);
  const editUrine = await call("PUT", `${M}/analyte-values/Calcium`, { ref_range_low: "99", ref_range_high: "300", units: "mg/24 h", specimen_type: "Urine, 24-hour" }, T);
  const editSerum = await call("PUT", `${M}/analyte-values/Calcium`, { ref_range_low: "8.5", ref_range_high: "10.3", units: "mg/dL" }, T);
  check("2b. attesting the urine band locks only the urine band", attest.status === 200 && editUrine.status === 409 && editSerum.status === 200,
    `${attest.status} ${editUrine.status} ${editSerum.status}`);

  // 3) AMR and reportable range by specimen type
  const amrAll = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "1.0", amr_high: "14.0", reportable_low: "1.0", reportable_high: "28.0", max_dilution: "1:2" }, T);
  const amrUrine = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "0.5", amr_high: "20", reportable_low: "0.5", reportable_high: "200", max_dilution: "1:10", specimen_type: "Urine, 24-hour" }, T);
  const amrOld = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "1.0", amr_high: "15.0" }, T); // an older client: no reportable fields
  const rows = sqlite.prepare("SELECT specimen_type, amr_low, amr_high, reportable_low, reportable_high, max_dilution FROM veritamap_amr_values WHERE map_id = ? AND analyte = 'Calcium' ORDER BY specimen_type").all(map.id) as any[];
  check("3a. one AMR row per specimen type, each with its reportable range and maximum dilution",
    amrAll.status === 200 && amrUrine.status === 200 && rows.length === 2 && rows[1].specimen_type === "Urine, 24-hour" && rows[1].reportable_high === "200" && rows[1].max_dilution === "1:10",
    JSON.stringify(rows));
  check("3b. a save that leaves out the reportable fields keeps them", amrOld.status === 200 && rows[0].amr_high === "15.0" && rows[0].reportable_high === "28.0" && rows[0].max_dilution === "1:2", JSON.stringify(rows[0]));
  const noop = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "0.5", amr_high: "20", reportable_low: "0.5", reportable_high: "200", max_dilution: "1:10", specimen_type: "Urine, 24-hour" }, T);
  check("3c. an unchanged save writes nothing", noop.status === 200 && noop.body.noop === true);
  const attestAmr = await call("POST", `${M}/amr-values/${v1.id}/Calcium/attest`, { attested_by: "Pat Director", attested_title: "Medical Director", specimen_type: "Urine, 24-hour" }, T);
  const editAmrUrine = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "0.4", amr_high: "20", specimen_type: "Urine, 24-hour" }, T);
  const editAmrAll = await call("PUT", `${M}/amr-values/${v1.id}/Calcium`, { amr_low: "1.1", amr_high: "15.0" }, T);
  check("3d. attesting the urine AMR locks only the urine AMR", attestAmr.status === 200 && attestAmr.body.specimen_type === "Urine, 24-hour" && editAmrUrine.status === 409 && editAmrAll.status === 200,
    `${attestAmr.status} ${editAmrUrine.status} ${editAmrAll.status}`);
  const unlock = await call("POST", `${M}/amr-values/${v1.id}/Calcium/unlock`, { specimen_type: "Urine, 24-hour" }, T);
  check("3e. unlock addresses the urine AMR", unlock.status === 200 && unlock.body.amr_locked === 0 && unlock.body.specimen_type === "Urine, 24-hour", `${unlock.status} ${JSON.stringify(unlock.body).slice(0, 120)}`);

  // 4) names
  const allWord = await call("PUT", `${M}/analyte-values/Microalbumin`, { ref_range_low: "0", ref_range_high: "30", specimen_type: "  All  " }, T);
  const tooLong = await call("PUT", `${M}/analyte-values/Microalbumin`, { ref_range_low: "0", ref_range_high: "30", specimen_type: "x".repeat(41) }, T);
  const longReportable = await call("PUT", `${M}/amr-values/${v1.id}/Microalbumin`, { amr_low: "1", amr_high: "2", reportable_high: "9".repeat(31) }, T);
  check("4a. 'All' means all specimen types; an overlong specimen name or reportable value is refused",
    allWord.status === 200 && allWord.body.specimen_type === "" && tooLong.status === 400 && longReportable.status === 400, `${allWord.status}/${allWord.body.specimen_type} ${tooLong.status} ${longReportable.status}`);
  await call("PUT", `${M}/amr-values/${v1.id}/Microalbumin`, { amr_low: "5", amr_high: "300", reportable_high: "3000", max_dilution: "1:10", specimen_type: "Urine" }, T);

  // 5) export
  const xl = await call("POST", `${M}/excel`, {}, T);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xl.r.arrayBuffer()) as any);
  let head: string[] = [];
  const out: Record<string, string>[] = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => {
      const v = Array.from(row.values as any[], (x) => (x && typeof x === "object" && "richText" in x ? x.richText.map((y: any) => y.text).join("") : String(x ?? "")));
      if (!head.length) { if (v.includes("Specimen Type")) head = v; return; }
      out.push(Object.fromEntries(head.map((h, i) => [h, v[i]])));
    });
    if (head.length) break;
  }
  const ca = out.filter((r) => r.Analyte === "Calcium");
  const caUrine = ca.find((r) => r["Specimen Type"] === "Urine, 24-hour");
  const caAll = ca.find((r) => r["Specimen Type"] === "All specimen types");
  check("5a. the export has Specimen Type and the reportable-range columns", head.includes("Specimen Type") && head.includes("Reportable Range Low (per instrument)") && head.includes("Reportable Range High (per instrument)") && head.includes("Maximum Dilution (per instrument)"),
    head.filter((h) => /Specimen|Reportable|Dilution/.test(h)).join(" | "));
  check("5b. Calcium: an all-specimen row and a urine row, each with its own reference range, AMR and reportable range",
    ca.length === 2 && caAll?.["Reference Range Low"] === "8.5" && caAll?.["AMR High (per instrument)"] === "15.0" && caAll?.["Reportable Range High (per instrument)"] === "28.0" &&
    caUrine?.["Reference Range Low"] === "100" && caUrine?.["AMR High (per instrument)"] === "20" && caUrine?.["Reportable Range High (per instrument)"] === "200" && caUrine?.["Maximum Dilution (per instrument)"] === "1:10",
    JSON.stringify(ca.map((r) => [r["Specimen Type"], r["Reference Range Low"], r["AMR High (per instrument)"], r["Reportable Range High (per instrument)"], r["Maximum Dilution (per instrument)"]])));
  const mi = out.filter((r) => r.Analyte === "Microalbumin");
  const miUrine = mi.find((r) => r["Specimen Type"] === "Urine");
  check("5c. a specimen type with an AMR but no reference-range band still gets its own row", mi.length === 2 && miUrine?.["AMR High (per instrument)"] === "300" && miUrine?.["Reference Range Low"] === "Not established" && miUrine?.["Reportable Range High (per instrument)"] === "3000",
    JSON.stringify(mi.map((r) => [r["Specimen Type"], r["Reference Range Low"], r["AMR High (per instrument)"]])));

  // 6) legacy PUT
  const legacy = await call("PUT", `/api/veritamap/maps/${map.id}/analyte-values/Microalbumin`, { ref_range_low: "0", ref_range_high: "29" }, T);
  check("6a. the legacy PUT still writes the all-specimen band", legacy.status === 200 && legacy.body.specimen_type === "" && legacy.body.ref_range_high === "29", `${legacy.status} ${JSON.stringify(legacy.body).slice(0, 120)}`);

  server.close();
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
