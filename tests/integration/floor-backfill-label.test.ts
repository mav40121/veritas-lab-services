// tests/integration/floor-backfill-label.test.ts
//
// Receipt for BUG-139 (Michael 2026-11-08, Q241 = 1). Pass 1 of backfillAbsoluteFloorOnStartup gave an absolute floor to
// any study with none whose name loosely matched a floor analyte, whatever criterion the lab picked: a lab-defined
// Creatinine at 5% gained ±0.2 mg/dL on the next deploy, which can turn a FAIL into a PASS. Boots the REAL routes against a
// throwaway SQLite DB (DB_PATH from the runner) with made-up studies and proves:
//   1. the pass skips a study with a preset label ("Lab-defined" included) and still backfills a legacy row with none
//   2. GET /api/admin/veritacheck/floor-backfill-counts refuses without the secret, finds the labeled rows that look changed
//      by the pass before (a floor their own criterion doesn't carry, equal to the one the pass gives), counts how many
//      verdicts that floor decides, answers counts, lab ids, preset labels and floor values only, and writes nothing
//
// Run: rm -f .tmp-floor.db && DB_PATH=.tmp-floor.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/floor-backfill-label.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const cal = (pairs: Array<[number, number]>) =>
  JSON.stringify(pairs.map(([e, m], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { "Made-up Analyzer": m } })));

async function main() {
  const { db } = await import("../../server/db");
  const { backfillAbsoluteFloorOnStartup } = await import("../../server/backfillAbsoluteFloor");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ins = sqlite.prepare(
    `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit,
       clia_absolute_floor, clia_absolute_unit, clia_preset_label, data_points, instruments, status, lifecycle_state, created_at)
     VALUES (1, @lab, @name, 'Made-up Analyzer', 'made-up', '2026-11-08', 'cal_ver', @tea, 1, '%', @floor, @floorUnit, @preset, @points,
       '["Made-up Analyzer"]', @status, @life, '2026-11-08T00:00:00Z')`
  );
  const add = (o: { lab?: number; name: string; tea: number; floor?: number | null; floorUnit?: string | null; preset?: string | null; points?: string; status?: string; life?: string }) =>
    Number(ins.run({ lab: o.lab ?? 910, name: o.name, tea: o.tea, floor: o.floor ?? null, floorUnit: o.floorUnit ?? null, preset: o.preset ?? null,
      points: o.points ?? cal([[1, 1.01], [2, 2.02], [4, 4.04]]), status: o.status ?? "pass", life: o.life ?? "draft" }).lastInsertRowid);
  const row = (id: number) => sqlite.prepare("SELECT clia_absolute_floor AS floor, clia_absolute_unit AS unit, status FROM studies WHERE id = ?").get(id) as any;
  // Made-up lab ids 910 to 913 have no labs row on this throwaway DB; the counts read only groups by the number.
  sqlite.pragma("foreign_keys = OFF");

  // ── 1: the startup pass ──
  const labeled = [
    add({ name: "Creatinine", tea: 0.05, preset: "Lab-defined" }),
    add({ name: "IgE", tea: 0.2, preset: "Lab-defined" }),
    add({ name: "Urine Creatinine", tea: 0.1, preset: "Urine Creatinine (±10%)" }),
    add({ name: "Free Testosterone", tea: 0.2, preset: "Lab-defined" }),
  ];
  const legacy = add({ name: "Creatinine", tea: 0.1 });
  backfillAbsoluteFloorOnStartup();
  check("the pass leaves all 4 labeled rows with no floor (Lab-defined Creatinine, IgE, Free Testosterone; a no-floor preset on Urine Creatinine)",
    labeled.every((id) => row(id).floor === null && row(id).unit === null), JSON.stringify(labeled.map(row)));
  check("the pass still gives a legacy row with no label its floor (Creatinine ±0.2 mg/dL)", row(legacy).floor === 0.2 && row(legacy).unit === "mg/dL", JSON.stringify(row(legacy)));

  // ── 2: the counts read ──
  // a) a no-floor preset holding the floor the pass gives; the floor decides the verdict (0.15 mg/dL off at 0.5 is outside 10% but within 0.2).
  const a = add({ lab: 911, name: "URINE CREATININE", tea: 0.1, floor: 0.2, floorUnit: "mg/dL", preset: "Urine Creatinine (±10%)",
    points: cal([[0.5, 0.65], [1.0, 1.12], [2.0, 2.15]]), status: "pass", life: "finalized" });
  // b) Lab-defined Creatinine 5% with the pass's floor; every level within 5%, so the floor decides nothing.
  const b = add({ lab: 912, name: "Creatinine", tea: 0.05, floor: 0.2, floorUnit: "mg/dL", preset: "Lab-defined", status: "pass" });
  // c) a Lab-defined draft with the pass's floor.
  const c = add({ lab: 912, name: "Creatinine", tea: 0.05, floor: 0.2, floorUnit: "mg/dL", preset: "Lab-defined", status: "draft" });
  // Not candidates: a preset that carries its own floor, a Lab-defined floor the pass would not give, and a legacy row with no label.
  const notA = add({ lab: 913, name: "Glucose", tea: 0.08, floor: 6, floorUnit: "mg/dL", preset: "Glucose (±8% or ±6 mg/dL)" });
  const notB = add({ lab: 913, name: "Creatinine", tea: 0.05, floor: 1, floorUnit: "mg/dL", preset: "Lab-defined" });
  const before = JSON.stringify(sqlite.prepare("SELECT * FROM studies ORDER BY id").all());
  sqlite.pragma("foreign_keys = ON");

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const url = `${base}/api/admin/veritacheck/floor-backfill-counts`;
  const noSecret = await fetch(url);
  check("counts read refuses without the secret (403)", noSecret.status === 403, String(noSecret.status));
  const r = await fetch(url, { headers: { "x-admin-secret": process.env.ADMIN_SECRET! } });
  const j: any = await r.json();
  check("counts read answers 200", r.status === 200, String(r.status));
  check("3 labeled rows look changed by the pass (the two non-candidates and the legacy row are not counted)", j.studies === 3, JSON.stringify(j));
  check("no-floor preset: 1 row, its floor decides the verdict (PASS only with it), finalized",
    j.byKind?.presetWithoutFloor?.total === 1 && j.byKind.presetWithoutFloor.floorDecides === 1 && j.byKind.presetWithoutFloor.passOnlyWithFloor === 1
      && j.byKind.presetWithoutFloor.finalizedFloorDecides === 1, JSON.stringify(j.byKind?.presetWithoutFloor));
  check("Lab-defined: 2 rows, 1 a draft, the floor decides neither",
    j.byKind?.labDefined?.total === 2 && j.byKind.labDefined.drafts === 1 && j.byKind.labDefined.floorDecides === 0, JSON.stringify(j.byKind?.labDefined));
  check("by lab id: 911 has 1 decided by the floor, 912 has 2 and none decided; 913 absent",
    j.byLab?.["911"]?.floorDecides === 1 && j.byLab?.["912"]?.total === 2 && j.byLab["912"].floorDecides === 0 && !j.byLab?.["913"], JSON.stringify(j.byLab));
  check("by floor: 0.2 mg/dL x3; by preset: Lab-defined x2, Urine Creatinine (±10%) x1",
    j.byFloor?.["0.2 mg/dL"] === 3 && j.byPreset?.["Lab-defined"] === 2 && j.byPreset?.["Urine Creatinine (±10%)"] === 1, JSON.stringify([j.byFloor, j.byPreset]));
  const text = JSON.stringify(j);
  check("counts read carries no study id, test name typed by the lab, analyst or values", !text.includes(`"id"`) && !text.includes("URINE CREATININE") && !text.includes("made-up") && !text.includes("0.65"), text);
  check("the counts read wrote nothing", JSON.stringify(sqlite.prepare("SELECT * FROM studies ORDER BY id").all()) === before);
  void a; void b; void c; void notA; void notB;
  server.close();

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
