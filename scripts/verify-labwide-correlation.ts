// scripts/verify-labwide-correlation.ts
//
// Receipt for BUG-011 part C (Michael, Q43 = 1, 2026-10-09): correlation counts
// every map in the lab. Boots the REAL routes on a throwaway SQLite DB (no prod data):
//   1. Milford's shape: Glucose on the Chemistry map (VITROS) and on the Blood Bank
//      map (StatStrip meter) -> both maps require a correlation, and the reason and
//      tooltip name the other map.
//   2. A copied "Test" map carrying the SAME analyzer (same serial) adds nothing.
//   3. Another lab's maps never count.
//   4. A test only one instrument runs lab-wide stays not required.
//   5. Legacy maps with no lab keep the per-map behavior.
//   8. BUG-016 original shape: a WAIVED-only row is never flagged, even when two nonwaived analyzers run the
//      test on another map (the requirement sits on THOSE rows, and their reason never names the meter).
//   9. A row whose FIRST instrument is the waived meter but which also has a nonwaived i-STAT reads MODERATE
//      (cal ver required), not WAIVED.
// Run (from repo root):
//   DB_PATH=.tmp-verify-labwide.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-labwide-correlation.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const sqlite = (db as any).$client;
const now = new Date().toISOString();
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

  const owner = storage.createUser("labwide-owner@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Lab Owner") as any;
  sqlite.prepare("UPDATE users SET plan = 'hospital', has_completed_onboarding = 1 WHERE id = ?").run(owner.id);
  const tok = jwt.sign({ userId: owner.id }, SECRET, { expiresIn: "1h" });
  const get = async (p: string, labId?: number) => {
    const r = await fetch(base + p, { headers: { Authorization: `Bearer ${tok}`, ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) } });
    return { status: r.status, j: (await r.json()) as any };
  };
  const mkLab = (n: string) => {
    const id = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES (?,?,?,?,?)").run(n, owner.id, "hospital", now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','{}','active',1,?,?,?)").run(id, owner.id, now, now, now);
    return id;
  };
  const mkMap = (labId: number | null, name: string) => Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?,?,?,'[]',?,?)").run(owner.id, labId, name, now, now).lastInsertRowid);
  const mkInst = (mapId: number, name: string, serial: string | null) => Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, serial_number, created_at) VALUES (?,?,?,?,?,?)").run(mapId, name, "Primary", "Chemistry", serial, now).lastInsertRowid);
  const mkTest = (instId: number, mapId: number, analyte: string, cx = "MODERATE") => {
    sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?,?,?,?,?,1)").run(instId, mapId, analyte, "General Chemistry", cx);
    sqlite.prepare("INSERT OR IGNORE INTO veritamap_tests (map_id, analyte, specialty, complexity, active, updated_at) VALUES (?,?,?,?,1,?)").run(mapId, analyte, "General Chemistry", cx, now);
  };

  // Lab A: Chemistry map (VITROS, serial V1) and Blood Bank map (a nonwaived i-STAT plus a WAIVED StatStrip meter).
  // BUG-016 (Michael 2026-10-09): only nonwaived instruments count; including a waived meter is the lab's choice.
  const labA = mkLab("Lab A"), labB = mkLab("Lab B"), labC = mkLab("Lab C");
  for (const l of [labA, labB, labC]) sqlite.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(l);
  const chem = mkMap(labA, "Chemistry"), bb = mkMap(labA, "Blood Bank"), copy = mkMap(labA, "Test");
  const vitros = mkInst(chem, "Ortho VITROS 5600", "V1");
  mkTest(vitros, chem, "Glucose"); mkTest(vitros, chem, "Magnesium");
  const istat = mkInst(bb, "Abbott i-STAT 1", "IS1");
  mkTest(istat, bb, "Glucose", "MODERATE");
  const meter = mkInst(bb, "Nova StatStrip Glucose", null);
  mkTest(meter, bb, "Glucose", "WAIVED");
  // 7. Lab C (Milford's shape): chemistry analyzer glucose + a WAIVED meter on another map, nothing else.
  const chemC = mkMap(labC, "Chemistry C"), bbC = mkMap(labC, "Blood Bank C");
  mkTest(mkInst(chemC, "Siemens Atellica CH 930", "A1"), chemC, "Glucose");
  mkTest(mkInst(bbC, "Nova StatStrip Glucose Hospital Meter", null), bbC, "Glucose", "WAIVED");
  // 8 + 9. Lab D: Atellica + i-STAT on Chemistry D; a POC map with only a WAIVED meter; an ED map whose Glucose
  // row lists the WAIVED meter FIRST and then a nonwaived i-STAT.
  const labD = mkLab("Lab D");
  sqlite.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labD);
  const chemD = mkMap(labD, "Chemistry D"), pocD = mkMap(labD, "POC D"), edD = mkMap(labD, "ED D");
  mkTest(mkInst(chemD, "Siemens Atellica CH 930", "A-D1"), chemD, "Glucose");
  mkTest(mkInst(chemD, "Abbott i-STAT 1", "IS-D1"), chemD, "Glucose");
  mkTest(mkInst(pocD, "Nova StatStrip Glucose Hospital Meter", "SS-D1"), pocD, "Glucose", "WAIVED");
  mkTest(mkInst(edD, "Nova StatStrip Glucose Hospital Meter", "SS-D2"), edD, "Glucose", "WAIVED");
  mkTest(mkInst(edD, "Abbott i-STAT 1", "IS-D2"), edD, "Glucose", "MODERATE");
  // 2. a copied map with the SAME VITROS (same serial) running Magnesium
  const vitrosCopy = mkInst(copy, "Ortho VITROS 5600", "V1");
  mkTest(vitrosCopy, copy, "Magnesium");
  // 3. Lab B also runs Magnesium on its own analyzer
  const chemB = mkMap(labB, "Chemistry B");
  const other = mkInst(chemB, "Roche cobas c 503", "R9");
  mkTest(other, chemB, "Magnesium");
  // 6. two units of the same model on two maps, different serials: two analyzers
  const hemeA = mkMap(labA, "Hematology Main"), hemeB = mkMap(labA, "Hematology ED");
  mkTest(mkInst(hemeA, "Sysmex XN-1000", "XN-A"), hemeA, "WBC");
  mkTest(mkInst(hemeB, "Sysmex XN-1000", "XN-B"), hemeB, "WBC");
  // 5. legacy maps with no lab
  const legacy1 = mkMap(null, "Legacy 1"), legacy2 = mkMap(null, "Legacy 2");
  mkTest(mkInst(legacy1, "Analyzer L1", "L1"), legacy1, "Sodium");
  mkTest(mkInst(legacy2, "Analyzer L2", "L2"), legacy2, "Sodium");

  const intel = await get(`/api/labs/${labA}/veritamap/maps/${chem}/intelligence`, labA);
  check("intelligence route answers", intel.status === 200, `HTTP ${intel.status}`);
  const g = intel.j.intelligence?.Glucose;
  check("1. Chemistry-map Glucose requires a correlation with the Blood Bank i-STAT (nonwaived)", !!g?.correlationRequired, g?.correlationReason || "(none)");
  check("1. the reason names the i-STAT on the other map", /i-STAT 1 \[Primary\] on map "Blood Bank"/.test(g?.correlationReason || ""), g?.correlationReason || "");
  check("7. the WAIVED StatStrip is not counted or listed (2 instruments, no StatStrip)", /^2 instruments/.test(g?.correlationReason || "") && !/StatStrip/.test(g?.correlationReason || ""), g?.correlationReason || "");
  const g2 = (await get(`/api/labs/${labA}/veritamap/maps/${bb}/intelligence`, labA)).j.intelligence?.Glucose;
  check("1. the Blood Bank map's Glucose requires it too", !!g2?.correlationRequired && /on map "Chemistry"/.test(g2?.correlationReason || ""), g2?.correlationReason || "(none)");
  const gc = (await get(`/api/labs/${labC}/veritamap/maps/${chemC}/intelligence`, labC)).j.intelligence?.Glucose;
  check("7. analyzer + a WAIVED meter only: not required (comparing the meter is the lab's choice)", gc && !gc.correlationRequired, JSON.stringify(gc?.correlationReason ?? null));
  const gw = (await get(`/api/labs/${labC}/veritamap/maps/${bbC}/intelligence`, labC)).j.intelligence?.Glucose;
  check("7. the WAIVED meter's own row: not required", gw && !gw.correlationRequired, JSON.stringify(gw?.correlationReason ?? null));
  const gp = (await get(`/api/labs/${labD}/veritamap/maps/${pocD}/intelligence`, labD)).j.intelligence?.Glucose;
  check("8. a WAIVED-only row is not flagged, though two nonwaived analyzers run Glucose on another map", gp && gp.isWaived === true && !gp.correlationRequired, JSON.stringify({ cx: gp?.complexity, req: gp?.correlationRequired }));
  const gd = (await get(`/api/labs/${labD}/veritamap/maps/${chemD}/intelligence`, labD)).j.intelligence?.Glucose;
  check("8. the Chemistry rows are flagged and their reason never names a StatStrip", !!gd?.correlationRequired && !/StatStrip/.test(gd?.correlationReason || ""), gd?.correlationReason || "(none)");
  const ge = (await get(`/api/labs/${labD}/veritamap/maps/${edD}/intelligence`, labD)).j.intelligence?.Glucose;
  check("9. waived meter listed first + nonwaived i-STAT: the row reads MODERATE, cal ver required, correlation required", ge?.complexity === "MODERATE" && ge?.calVerRequired === true && !!ge?.correlationRequired && !/StatStrip/.test(ge?.correlationReason || ""), JSON.stringify({ cx: ge?.complexity, cv: ge?.calVerRequired, req: ge?.correlationRequired }));
  const mg = intel.j.intelligence?.Magnesium;
  check("2+3. Magnesium stays one instrument: the copied map's same analyzer and Lab B's analyzer do not count", mg && !mg.correlationRequired, JSON.stringify(mg?.correlationReason ?? null));

  const detail = await get(`/api/labs/${labA}/veritamap/maps/${chem}`, labA);
  const row = (detail.j.tests || []).find((t: any) => t.analyte === "Glucose");
  check("map detail: Glucose counts 2 nonwaived instruments lab-wide (the waived meter is not one)", row?.correlation_instrument_count === 2, `count=${row?.correlation_instrument_count}`);
  const peers = row?.correlation_peer_instruments || [];
  check("map detail: the tooltip peer is the i-STAT on map Blood Bank, and the StatStrip is not listed", peers.length === 1 && peers[0]?.instrument_name === "Abbott i-STAT 1" && peers[0]?.map_name === "Blood Bank", JSON.stringify(peers));

  const wbc = (await get(`/api/labs/${labA}/veritamap/maps/${hemeA}/intelligence`, labA)).j.intelligence?.WBC;
  check("6. same model, different serials on two maps: two analyzers, correlation required", !!wbc?.correlationRequired && /on map "Hematology ED"/.test(wbc?.correlationReason || ""), wbc?.correlationReason || "(none)");

  const leg = await get(`/api/veritamap/maps/${legacy1}/intelligence`);
  const na = leg.j.intelligence?.Sodium;
  check("5. legacy map without a lab keeps per-map behavior (Sodium on one analyzer, not required)", leg.status === 200 && na && !na.correlationRequired, `HTTP ${leg.status} ${JSON.stringify(na?.correlationReason ?? null)}`);

  server.close();
  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
