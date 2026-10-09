// scripts/verify-merge-specialty.ts
//
// Receipt for the BUG-005 admin routes (2026-10-09): electrolytes return to
// General Chemistry on maps labs already saved, and the read-only lookup that
// finds every saved instrument by name. Boots the REAL routes on a throwaway
// SQLite DB (no prod data):
//   1. dryRun (the default) reports the rows per lab/map and writes nothing.
//   2. Applying relabels both stores; complexity, analyte names, dates and notes
//      are untouched; the map rollup stays consistent.
//   3. labId limits the change to one lab.
//   4. Bad input is refused; the admin secret is required.
//   5. instruments-by-name lists the saved VITROS 4600 rows with their complexity.
// Run (from repo root):
//   DB_PATH=.tmp-verify-merge.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-merge-specialty.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const sqlite = (db as any).$client;
const now = new Date().toISOString();
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
  const post = async (body: any) => { const r = await fetch(`${base}/api/admin/veritamap/merge-specialty`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() as any }; };

  const owner = storage.createUser("owner@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Owner") as any;
  const mkLab = (n: string) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES (?,?,?,?,?)").run(n, owner.id, "hospital", now, now).lastInsertRowid);
  const mkMap = (labId: number) => Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?,?,?,'[]',?,?)").run(owner.id, labId, "Chemistry", now, now).lastInsertRowid);
  const mkInst = (mapId: number, name: string) => Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?,?,?,?,?)").run(mapId, name, "Primary", "Chemistry", now).lastInsertRowid);
  const mkTest = (instId: number, mapId: number, analyte: string, specialty: string, cx: string) =>
    sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?,?,?,?,?,1)").run(instId, mapId, analyte, specialty, cx);
  const mkMapTest = (mapId: number, analyte: string, specialty: string, cx: string) =>
    sqlite.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, last_cal_ver, notes, updated_at) VALUES (?,?,?,?,1,'2026-09-01','keep me',?)").run(mapId, analyte, specialty, cx, now);

  const labA = mkLab("Lab A"), labB = mkLab("Lab B");
  const mapA = mkMap(labA), mapB = mkMap(labB);
  const instA = mkInst(mapA, "Ortho VITROS 4600"), instB = mkInst(mapB, "Roche cobas c 501");
  for (const [a, cx] of [["Sodium", "MODERATE"], ["Potassium", "MODERATE"], ["Calcium, total", "HIGH"]] as const) { mkTest(instA, mapA, a, "Electrolytes", cx); mkMapTest(mapA, a, "Electrolytes", cx); }
  mkTest(instA, mapA, "Glucose", "General Chemistry", "MODERATE"); mkMapTest(mapA, "Glucose", "General Chemistry", "MODERATE");
  mkTest(instB, mapB, "Sodium", "Electrolytes/Routine Chemistry", "MODERATE"); mkMapTest(mapB, "Sodium", "Electrolytes/Routine Chemistry", "MODERATE");
  const count = (lbl: string) => (sqlite.prepare("SELECT COUNT(*) AS n FROM veritamap_instrument_tests WHERE specialty = ?").get(lbl) as any).n + (sqlite.prepare("SELECT COUNT(*) AS n FROM veritamap_tests WHERE specialty = ?").get(lbl) as any).n;

  // 4. guards
  check("admin secret required", (await post({ secret: "wrong", from: "Electrolytes", to: "General Chemistry" })).status === 403, "");
  check("from and to required", (await post({ secret: "localadmin", from: [], to: "General Chemistry" })).status === 400, "");

  // 1. dry run (default)
  const dry = await post({ secret: "localadmin", from: ["Electrolytes", "Electrolytes/Routine Chemistry"], to: "General Chemistry" });
  check("dry run is the default and reports both labs", dry.j.dryRun === true && dry.j.instrumentRows === 4 && dry.j.mapRows === 4 && dry.j.maps.length === 2, JSON.stringify({ dry: dry.j.dryRun, i: dry.j.instrumentRows, m: dry.j.mapRows, maps: dry.j.maps.length }));
  check("dry run wrote nothing", count("Electrolytes") === 6 && count("Electrolytes/Routine Chemistry") === 2, `Electrolytes rows=${count("Electrolytes")}`);

  // 3. labId limits the change
  const onlyB = await post({ secret: "localadmin", from: ["Electrolytes/Routine Chemistry"], to: "General Chemistry", labId: labB, dryRun: false });
  check("labId limits the change to that lab", onlyB.j.instrumentRows === 1 && count("Electrolytes") === 6 && count("Electrolytes/Routine Chemistry") === 0, JSON.stringify({ i: onlyB.j.instrumentRows, left: count("Electrolytes") }));

  // 2. apply
  const live = await post({ secret: "localadmin", from: "Electrolytes", to: "General Chemistry", dryRun: false });
  check("apply relabels every Electrolytes row", live.j.dryRun === false && count("Electrolytes") === 0, JSON.stringify({ i: live.j.instrumentRows, m: live.j.mapRows }));
  const ca = sqlite.prepare("SELECT specialty, complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND analyte = 'Calcium, total'").get(instA) as any;
  check("complexity untouched (Calcium stays as saved)", ca.specialty === "General Chemistry" && ca.complexity === "HIGH", JSON.stringify(ca));
  const mt = sqlite.prepare("SELECT specialty, last_cal_ver, notes FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'").get(mapA) as any;
  check("map rollup relabeled; dates and notes kept", mt.specialty === "General Chemistry" && mt.last_cal_ver === "2026-09-01" && mt.notes === "keep me", JSON.stringify(mt));
  const again = await post({ secret: "localadmin", from: "Electrolytes", to: "General Chemistry", dryRun: false });
  check("re-running is a no-op", again.j.instrumentRows === 0 && again.j.mapRows === 0, JSON.stringify({ i: again.j.instrumentRows }));

  // 5. lookup
  const look = await (await fetch(`${base}/api/admin/veritamap/instruments-by-name?secret=localadmin&like=VITROS%204600`)).json() as any;
  check("instruments-by-name finds the saved 4600 with its tests", look.count === 1 && look.instruments[0].lab_id === labA && look.instruments[0].tests.length === 4, JSON.stringify({ count: look.count, tests: look.instruments?.[0]?.tests?.length }));
  check("instruments-by-name requires the secret", (await fetch(`${base}/api/admin/veritamap/instruments-by-name?secret=no&like=VITROS`)).status === 403, "");

  server.close();
  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
