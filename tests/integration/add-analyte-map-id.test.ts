// tests/integration/add-analyte-map-id.test.ts
//
// Receipt for the mapId option on POST /api/admin/veritamap/add-analyte (2026-10-12). Redington-Fairview (lab 34)
// keeps one map per department (9 maps), and the route refused any lab with more than one map, so a single missing
// test (procalcitonin and TSH on their VITROS XT 7600, REQ-040) could not be added without the build page's
// full replace. Boots the REAL routes on a scratch DB and proves:
//   1. a lab with two maps and no mapId is still refused (ambiguous) and the reply lists its map ids
//   2. a mapId that belongs to another lab is refused
//   3. dryRun with mapId reports would-insert with the copied specialty/complexity and writes nothing
//   4. run with mapId inserts on that map's instrument only (the same-named instrument on the lab's other map is
//      untouched) and the map's veritamap_tests rollup lists the analyte
//   5. a repeat is skipped-exists (no duplicate)
//   6. a single-map lab without mapId works as before
// Run (from bash): DB_PATH=.tmp-aa.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/add-analyte-map-id.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const stamp = Date.now();
  const now = new Date().toISOString();
  const lab = async (tag: string) => {
    await post("/api/auth/register", { email: `aa-${tag}-${stamp}@example.com`, password: "testpass123", name: `AA ${tag}`, hipaa_acknowledged: true });
    const labId = (await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `aa-${tag}-${stamp}@example.com`, labName: `AA ${tag} Lab`, plan: "hospital" })).j.labId;
    const owner = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any).owner_user_id;
    return { labId, owner };
  };
  const addMap = (labId: number, owner: number, name: string) =>
    Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(owner, labId, name, now, now).lastInsertRowid);
  const addInst = (mapId: number, name: string, tests: Array<[string, string, string]>) => {
    const id = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, created_at) VALUES (?, ?, ?)").run(mapId, name, now).lastInsertRowid);
    for (const [a, sp, cx] of tests) sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, 1)").run(id, mapId, a, sp, cx);
    return id;
  };
  const rows = (instId: number, analyte: string) => sqlite.prepare("SELECT specialty, complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND analyte = ?").all(instId, analyte) as any[];

  // Two-map lab: a VITROS on each map, as a department-per-map lab would have.
  const A = await lab("multi");
  const mapPoc = addMap(A.labId, A.owner, "Point of Care");
  const mapChem = addMap(A.labId, A.owner, "Chemistry");
  const pocVitros = addInst(mapPoc, "Ortho VITROS XT 3400", [["Lipase", "General Chemistry", "MODERATE"]]);
  const chemVitros = addInst(mapChem, "Ortho VITROS XT 7600", [["Lipase", "General Chemistry", "MODERATE"], ["Thyroxine, free (FT4)", "Endocrinology", "MODERATE"]]);
  const other = await lab("other");
  const otherMap = addMap(other.labId, other.owner, "Chemistry");
  addInst(otherMap, "Ortho VITROS XT 7600", [["Lipase", "General Chemistry", "MODERATE"]]);

  const body = { secret: ADMIN, labId: A.labId, instrumentNameLike: "VITROS", analyte: "Procalcitonin (PCT)", copyFromAnalyte: "Lipase" };
  const amb = await post("/api/admin/veritamap/add-analyte", { ...body, dryRun: true });
  check("1. two maps and no mapId: refused as ambiguous, map ids listed", amb.s === 400 && /ambiguous/.test(amb.j.error) && [mapPoc, mapChem].every((m) => amb.j.mapIds?.includes(m)), `${amb.s} ${JSON.stringify(amb.j)}`);

  const foreign = await post("/api/admin/veritamap/add-analyte", { ...body, mapId: otherMap, dryRun: true });
  check("2. a mapId from another lab is refused", foreign.s === 400 && /not one of lab/.test(foreign.j.error), `${foreign.s} ${foreign.j.error}`);

  const dry = await post("/api/admin/veritamap/add-analyte", { ...body, mapId: mapChem, dryRun: true });
  const dr = dry.j.results || [];
  check("3. dryRun with mapId: would-insert on the Chemistry VITROS with copied specialty/complexity; nothing written",
    dry.s === 200 && dry.j.mapId === mapChem && dr.length === 1 && dr[0].instrumentId === chemVitros && dr[0].action === "would-insert" && dr[0].specialty === "General Chemistry" && dr[0].complexity === "MODERATE" && rows(chemVitros, "Procalcitonin (PCT)").length === 0,
    JSON.stringify(dry.j));

  const run = await post("/api/admin/veritamap/add-analyte", { ...body, mapId: mapChem });
  const tsh = await post("/api/admin/veritamap/add-analyte", { ...body, mapId: mapChem, analyte: "Thyroid stimulating hormone (TSH)", copyFromAnalyte: "Thyroxine, free (FT4)" });
  const rollup = sqlite.prepare("SELECT analyte, specialty, complexity FROM veritamap_tests WHERE map_id = ? AND analyte IN ('Procalcitonin (PCT)', 'Thyroid stimulating hormone (TSH)') ORDER BY analyte").all(mapChem) as any[];
  check("4. run with mapId: PCT and TSH on the Chemistry VITROS only; the Point of Care VITROS untouched; map rollup lists both",
    run.s === 200 && run.j.inserted === 1 && tsh.j.inserted === 1 &&
    JSON.stringify(rows(chemVitros, "Procalcitonin (PCT)")) === JSON.stringify([{ specialty: "General Chemistry", complexity: "MODERATE" }]) &&
    JSON.stringify(rows(chemVitros, "Thyroid stimulating hormone (TSH)")) === JSON.stringify([{ specialty: "Endocrinology", complexity: "MODERATE" }]) &&
    rows(pocVitros, "Procalcitonin (PCT)").length === 0 && rollup.length === 2,
    `${JSON.stringify(run.j.results)} | ${JSON.stringify(tsh.j.results)} | rollup ${JSON.stringify(rollup)}`);

  const again = await post("/api/admin/veritamap/add-analyte", { ...body, mapId: mapChem });
  check("5. repeat: skipped-exists, still one row", again.s === 200 && again.j.inserted === 0 && again.j.results?.[0]?.action === "skipped-exists" && rows(chemVitros, "Procalcitonin (PCT)").length === 1, JSON.stringify(again.j.results));

  const single = await post("/api/admin/veritamap/add-analyte", { secret: ADMIN, labId: other.labId, instrumentNameLike: "VITROS", analyte: "Procalcitonin (PCT)", copyFromAnalyte: "Lipase", dryRun: true });
  check("6. single-map lab without mapId works as before", single.s === 200 && single.j.mapId === otherMap && single.j.results?.[0]?.action === "would-insert", `${single.s} ${JSON.stringify(single.j)}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
