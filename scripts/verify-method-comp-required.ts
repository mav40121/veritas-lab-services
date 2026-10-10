// scripts/verify-method-comp-required.ts
//
// Receipt for BUG-018 (Michael, Q54 = 1, 2026-10-10): a correlation / method comparison is required only when 2+
// NONWAIVED instruments run the test lab-wide (42 CFR 493.1281(a)). Boots the REAL routes on a throwaway SQLite DB
// (no prod data). One lab, two maps:
//   Chemistry: Atellica runs Glucose, Magnesium and hCG; Blood Bank: an i-STAT also runs Glucose.
//   Glucose: no dates (needs cal ver AND a comparison).
//   Magnesium: cal ver dated, no comparison date (one instrument: no comparison needed).
//   hCG: no dates, cal ver marked not applicable (one instrument: nothing needed).
// Checks:
//   1. Map list (lab-scoped and legacy routes): Chemistry has 1 gap (Glucose), not 3.
//   2. Excel export: Magnesium's comparison status reads "Not Required (one instrument)"; Glucose's reads "Missing".
//   3. VeritaTrack "Import from VeritaMap": a comparison task for Glucose, none for Magnesium or hCG; cal ver tasks
//      are still created for all three.
//   4. BUG-019: the export's status cells are color-coded (their column numbers used to be off by one).
// Run (from repo root):
//   DB_PATH=.tmp-verify-mc.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy node_modules/.bin/tsx scripts/verify-method-comp-required.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import ExcelJS from "exceljs";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const sqlite = (db as any).$client;
const now = new Date().toISOString();
const today = now.slice(0, 10);
const SECRET = process.env.JWT_SECRET || "localqasecret";
let fails = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${detail})`);
  if (!ok) fails++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const owner = storage.createUser("mc-required-owner@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Lab Owner") as any;
  sqlite.prepare("UPDATE users SET plan = 'hospital', has_completed_onboarding = 1 WHERE id = ?").run(owner.id);
  const tok = jwt.sign({ userId: owner.id }, SECRET, { expiresIn: "1h" });
  const call = async (method: string, p: string, labId?: number, body?: unknown) => {
    const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json", ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r;
  };
  const lab = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, created_at, updated_at, has_completed_onboarding) VALUES (?,?,?,?,?,?,1)").run("MC Lab", owner.id, "hospital", "active", now, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','{}','active',1,?,?,?)").run(lab, owner.id, now, now, now);
  sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab, owner.id);
  const mkMap = (name: string) => Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?,?,?,'[]',?,?)").run(owner.id, lab, name, now, now).lastInsertRowid);
  const mkInst = (mapId: number, name: string, serial: string) => Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, serial_number, created_at) VALUES (?,?,?,?,?,?)").run(mapId, name, "Primary", "Chemistry", serial, now).lastInsertRowid);
  const mkTest = (instId: number, mapId: number, analyte: string, extra: Record<string, unknown> = {}) => {
    sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?,?,?,?,?,1)").run(instId, mapId, analyte, "General Chemistry", "MODERATE");
    sqlite.prepare("INSERT OR IGNORE INTO veritamap_tests (map_id, analyte, specialty, complexity, active, updated_at) VALUES (?,?,?,?,1,?)").run(mapId, analyte, "General Chemistry", "MODERATE", now);
    for (const [k, v] of Object.entries(extra)) sqlite.prepare(`UPDATE veritamap_tests SET ${k} = ? WHERE map_id = ? AND analyte = ?`).run(v, mapId, analyte);
  };
  const chem = mkMap("Chemistry"), bb = mkMap("Blood Bank");
  const atellica = mkInst(chem, "Siemens Atellica CH 930", "A1");
  mkTest(atellica, chem, "Glucose");
  mkTest(atellica, chem, "Magnesium", { last_cal_ver: today });
  mkTest(atellica, chem, "hCG", { cal_ver_na: 1, cal_ver_na_reason: "qualitative" });
  mkTest(mkInst(bb, "Abbott i-STAT 1", "IS1"), bb, "Glucose", { last_cal_ver: today, last_method_comp: today });

  // 1. map list gaps
  const scoped = (await (await call("GET", `/api/labs/${lab}/veritamap/maps`, lab)).json()) as any[];
  const sc = scoped.find((m) => m.id === chem);
  check("1. lab-scoped map list: Chemistry has 1 gap (Glucose), not 3", sc?.gaps === 1 && sc?.totalTests === 3, JSON.stringify({ gaps: sc?.gaps, totalTests: sc?.totalTests }));
  const sbb = scoped.find((m) => m.id === bb);
  check("1. lab-scoped map list: Blood Bank has 0 gaps (dated cal ver and comparison)", sbb?.gaps === 0, JSON.stringify({ gaps: sbb?.gaps }));
  const legacy = (await (await call("GET", `/api/veritamap/maps`)).json()) as any[];
  const lc = Array.isArray(legacy) ? legacy.find((m) => m.id === chem) : null;
  check("1. legacy map list: Chemistry has 1 gap", lc?.gaps === 1, JSON.stringify({ gaps: lc?.gaps }));

  // 2. Excel export status column
  const xr = await call("POST", `/api/labs/${lab}/veritamap/maps/${chem}/excel`, lab, {});
  check("2. Excel export answers", xr.status === 200, `HTTP ${xr.status}`);
  if (xr.status === 200) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await xr.arrayBuffer()) as any);
    let found: Record<string, string> = {};
    const colors: Record<string, string> = {};
    wb.eachSheet((ws) => {
      let col = 0, cvCol = 0;
      ws.getRow(1).eachCell((c, n) => { if (String(c.value) === "Correlation / Method Comparison Status") col = n; if (String(c.value) === "Calibration Verification Status") cvCol = n; });
      if (!col) return;
      ws.eachRow((row, n) => {
        if (n < 2) return;
        const a = String(row.getCell(1).value);
        found[a] = String(row.getCell(col).value ?? "");
        colors[`${a}|mc`] = String((row.getCell(col).font as any)?.color?.argb ?? "");
        colors[`${a}|cv`] = String((row.getCell(cvCol).font as any)?.color?.argb ?? "");
        colors[`${a}|cvText`] = String(row.getCell(cvCol).value ?? "");
      });
    });
    // BUG-019: status cells are color-coded per the Excel standard (Compliant green #437A22, N/A / Not Required gray #7A7974).
    check("4. Magnesium's cal ver status 'Compliant' is green", colors["Magnesium|cvText"] === "Compliant" && colors["Magnesium|cv"] === "FF437A22", JSON.stringify({ text: colors["Magnesium|cvText"], argb: colors["Magnesium|cv"] }));
    check("4. Magnesium's 'Not Required (one instrument)' is gray", colors["Magnesium|mc"] === "FF7A7974", JSON.stringify({ argb: colors["Magnesium|mc"] }));
    check("2. Magnesium (one instrument): 'Not Required (one instrument)'", found["Magnesium"] === "Not Required (one instrument)", JSON.stringify(found));
    check("2. Glucose (Atellica + i-STAT): 'Missing'", found["Glucose"] === "Missing", JSON.stringify(found));
  }

  // 3. VeritaTrack import
  const ir = await call("POST", `/api/veritatrack/import-from-map`, lab, {});
  const ij = await ir.json().catch(() => ({}));
  const names = (sqlite.prepare("SELECT name FROM veritatrack_tasks WHERE lab_id = ? AND active = 1").all(lab) as any[]).map((r) => r.name);
  check("3. VeritaTrack import answers", ir.status === 200, `HTTP ${ir.status} ${JSON.stringify(ij).slice(0, 120)}`);
  check("3. comparison task for Glucose", names.includes("Correlation / Method Comparison - Glucose"), names.filter((n) => n.startsWith("Correlation")).join(", "));
  check("3. no comparison task for Magnesium or hCG (one instrument)", !names.includes("Correlation / Method Comparison - Magnesium") && !names.includes("Correlation / Method Comparison - hCG"), names.filter((n) => n.startsWith("Correlation")).join(", "));
  check("3. cal ver tasks still created for all three", ["Glucose", "Magnesium", "hCG"].every((a) => names.includes(`Calibration Verification - ${a}`)), names.filter((n) => n.startsWith("Calibration")).join(", "));

  server.close();
  console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASS");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
