// scripts/verify-manual-diff-one-row.mjs
//
// Receipt for Michael 2026-11-02 ("these are the same test", "any, all. The manual diff tests are the cell line %
// tests"): a manual differential cell line is the analyzer's percent test, one VeritaMap row with every method on it.
// LOCAL production build + scratch DB only; the lab, maps and every value below are made-up fixtures. The legacy split
// (Neutrophils ... NRBC (manual) beside NEUT% ... NRBC%) is written straight into the scratch DB, the way older maps
// hold it.
//   A. POST /api/admin/veritamap/merge-analyte dry run: finds the six pairs, reports conflicts, changes nothing
//   B. refusals: a pair that is not the same test (Bands into EO%), a name not on the map, another lab's map
//   C. apply: one row per test; the manual instrument rows renamed in place (exemption flags kept); bands moved,
//      filled or kept with the conflict reported; AMR moved; map-row notes filled; the method comparison between the
//      two names becomes the EO% comparison; Bands, Blasts and NEUT# untouched; a second run finds nothing to do
//   D. builder: a menu saved for the manual differential takes the map's names ("NEUT%" on a Sysmex map, "NE%" on a
//      Beckman map, "NRBC" over "NRBC (manual)" on a map with no % name, Q127); absolute counts are never renamed;
//      merged "last done" dates keep the later one (C9b, Q127)
//   E. browser: the map shows EO% once with both instruments (light and dark)
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-manual-diff-one-row.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const merge = (body) => call("POST", "/api/admin/veritamap/merge-analyte", { secret: ADMIN, ...body });

// ---------- fixture ----------
const email = `one-row-${Date.now()}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "One Row Owner", hipaa_acknowledged: true })).body;
const T = owner.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "One Row Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
const L = `/api/labs/${labId}`;
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Hematology" }, T)).body.id;
const h = (analyte, complexity = "MODERATE") => ({ analyte, specialty: "Hematology", complexity, active: 1 });
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Sysmex XN-1000", category: "Hematology", tests: ["NEUT%", "LYMPH%", "MONO%", "EO%", "BASO%", "NRBC%", "NEUT#"].map((a) => h(a)) },
  { name: "Manual Differential", category: "Hematology", tests: [h("Bands", "HIGH"), h("Blasts", "HIGH")] },
] });
const LEGACY = ["Neutrophils", "Lymphocytes", "Monocytes", "Eosinophils", "Basophils", "NRBC (manual)"];
const db = new Database(process.env.SCRATCH_DB);
const instId = (name) => db.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND instrument_name = ?").get(mapId, name).id;
const XN = instId("Sysmex XN-1000"), MAN = instId("Manual Differential");
const now = new Date().toISOString();
for (const a of LEGACY) {
  db.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'Hematology', 'HIGH', 1)").run(MAN, mapId, a);
  db.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, updated_at) VALUES (?, ?, 'Hematology', 'HIGH', 1, 'Manual Differential', ?)").run(mapId, a, now);
}
db.prepare("UPDATE veritamap_instrument_tests SET linearity_exempt_noncal = 1 WHERE instrument_id = ? AND analyte = 'Eosinophils'").run(MAN);
const band = "INSERT INTO veritamap_analyte_values (map_id, analyte, ref_range_low, ref_range_high, critical_low, critical_high, units) VALUES (?, ?, ?, ?, ?, ?, ?)";
db.prepare(band).run(mapId, "EO%", "0", "5", null, null, "%");
db.prepare(band).run(mapId, "Eosinophils", "0", "7", null, "20", "%");
db.prepare(band).run(mapId, "Neutrophils", "40", "75", null, null, "%");
db.prepare("INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high) VALUES (?, ?, 'Basophils', '0', '10')").run(mapId, MAN);
const testId = (a) => db.prepare("SELECT id FROM veritamap_tests WHERE map_id = ? AND analyte = ?").get(mapId, a)?.id;
db.prepare("UPDATE veritamap_tests SET notes = 'Manual diff reviewed with pathologist' WHERE map_id = ? AND analyte = 'Monocytes'").run(mapId);
db.prepare("UPDATE veritamap_tests SET notes = 'XN primary' WHERE map_id = ? AND analyte = 'EO%'").run(mapId);
db.prepare("UPDATE veritamap_tests SET notes = 'Manual backup' WHERE map_id = ? AND analyte = 'Eosinophils'").run(mapId);
// Q127 (SCAHC dry run): "last done" dates keep the later one. EO% has the later cal ver, Eosinophils the later method comparison.
db.prepare("UPDATE veritamap_tests SET last_cal_ver = '2026-07-01', last_method_comp = '2026-06-20' WHERE map_id = ? AND analyte = 'EO%'").run(mapId);
db.prepare("UPDATE veritamap_tests SET last_cal_ver = '2026-06-19', last_method_comp = '2026-07-03' WHERE map_id = ? AND analyte = 'Eosinophils'").run(mapId);
const [ca, cb] = [testId("Eosinophils"), testId("EO%")].sort((x, y) => x - y);
db.prepare("INSERT INTO veritamap_test_correlations (test_a_id, test_b_id, correlation_method, pass_fail, signoff_by_name, created_at, updated_at) VALUES (?, ?, 'Manual vs analyzer', 'Pass', 'Test Director', ?, ?)").run(ca, cb, now, now);
const corrId = db.prepare("SELECT id FROM veritamap_test_correlations WHERE test_a_id = ? AND test_b_id = ?").get(ca, cb).id;
const manEoRowId = db.prepare("SELECT id FROM veritamap_instrument_tests WHERE instrument_id = ? AND analyte = 'Eosinophils'").get(MAN).id;
const mapNames = () => db.prepare("SELECT analyte FROM veritamap_tests WHERE map_id = ? ORDER BY analyte").all(mapId).map((r) => r.analyte);
const before = mapNames();
check("0. fixture: the legacy split (15 map rows: 7 analyzer, 6 manual cell lines, Bands, Blasts)", before.length === 15 && LEGACY.every((a) => before.includes(a)), before.join(", "));

// ---------- A. dry run ----------
let r = await merge({ labId, mapId });
const rep = r.body.report || [];
const pairStr = rep.map((p) => `${p.from}>${p.into}`).sort().join(" ");
check("A1. dry run finds the six pairs, each into the analyzer's % name",
  r.status === 200 && r.body.dryRun === true && r.body.pairs === 6 && pairStr === "Basophils>BASO% Eosinophils>EO% Lymphocytes>LYMPH% Monocytes>MONO% NRBC (manual)>NRBC% Neutrophils>NEUT%", `${r.status} ${pairStr}`);
const eo = rep.find((p) => p.from === "Eosinophils") || {};
check("A2. dry run reports the EO% conflicts (reference high 5 vs 7, notes) and the critical high it would fill",
  eo.conflicts?.some((c) => /ref_range_high: kept EO% "5", Eosinophils had "7"/.test(c)) && eo.conflicts?.some((c) => /notes/.test(c)) && eo.bands?.some((b) => /filled critical_high/.test(b)) && eo.correlations === 1, JSON.stringify(eo));
check("A2b. dry run says EO% will read HIGH on the map (the manual method is high complexity; highest wins)", eo.complexityBefore === "MODERATE" && eo.complexityAfter === "HIGH", `${eo.complexityBefore} -> ${eo.complexityAfter}`);
check("A3. dry run changes nothing", JSON.stringify(mapNames()) === JSON.stringify(before) && !!db.prepare("SELECT 1 FROM veritamap_analyte_values WHERE map_id = ? AND analyte = 'Eosinophils'").get(mapId));

// ---------- B. refusals ----------
r = await merge({ labId, mapId, pairs: [{ from: "Bands", into: "EO%" }] });
check("B1. Bands into EO% is refused: not the same test", r.status === 400 && /not the same differential test/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await merge({ labId, mapId, pairs: [{ from: "Eos", into: "EO%" }] });
check("B2. a name not on the map is refused", r.status === 400 && /must both be on map/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await merge({ labId: labId + 999, mapId });
check("B3. a map from another lab is refused", r.status === 400 && /is not one of lab/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await call("POST", "/api/admin/veritamap/merge-analyte", { secret: "wrong", labId, mapId });
check("B4. a wrong admin secret is refused (403)", r.status === 403, String(r.status));

// ---------- C. apply ----------
r = await merge({ labId, mapId, dryRun: false });
check("C1. apply merges six pairs", r.status === 200 && r.body.dryRun === false && r.body.pairs === 6, `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
const after = mapNames();
check("C2. one row per test: 9 map rows, none of the six manual names left; Bands, Blasts, NEUT# untouched",
  after.length === 9 && LEGACY.every((a) => !after.includes(a)) && ["Bands", "Blasts", "NEUT#", "EO%", "NRBC%"].every((a) => after.includes(a)), after.join(", "));
const manNames = db.prepare("SELECT analyte FROM veritamap_instrument_tests WHERE instrument_id = ? ORDER BY analyte").all(MAN).map((x) => x.analyte).join(", ");
check("C3. the manual differential now runs BASO%, Bands, Blasts, EO%, LYMPH%, MONO%, NEUT%, NRBC%", manNames === "BASO%, Bands, Blasts, EO%, LYMPH%, MONO%, NEUT%, NRBC%", manNames);
const eoRow = db.prepare("SELECT id, linearity_exempt_noncal FROM veritamap_instrument_tests WHERE instrument_id = ? AND analyte = 'EO%'").get(MAN);
check("C4. the manual EO% is the same row as before (id kept), with its linearity exemption", eoRow?.id === manEoRowId && eoRow?.linearity_exempt_noncal === 1, JSON.stringify(eoRow));
const eoBand = db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id = ? AND analyte = 'EO%'").all(mapId);
check("C5. EO% keeps its reference high (5) and takes the manual row's critical high (20); one band", eoBand.length === 1 && eoBand[0].ref_range_high === "5" && eoBand[0].critical_high === "20", JSON.stringify(eoBand));
const neut = db.prepare("SELECT ref_range_low, ref_range_high FROM veritamap_analyte_values WHERE map_id = ? AND analyte = 'NEUT%'").get(mapId);
check("C6. the Neutrophils band moved to NEUT% (40-75)", neut?.ref_range_low === "40" && neut?.ref_range_high === "75", JSON.stringify(neut));
const amr = db.prepare("SELECT analyte, amr_low, amr_high FROM veritamap_amr_values WHERE map_id = ? AND instrument_id = ?").all(mapId, MAN);
check("C7. the manual Basophils AMR moved to BASO%", amr.length === 1 && amr[0].analyte === "BASO%" && amr[0].amr_high === "10", JSON.stringify(amr));
const mono = db.prepare("SELECT notes FROM veritamap_tests WHERE map_id = ? AND analyte = 'MONO%'").get(mapId);
const eoNotes = db.prepare("SELECT notes FROM veritamap_tests WHERE map_id = ? AND analyte = 'EO%'").get(mapId);
check("C8. MONO% takes the manual notes; EO% keeps its own notes (the difference was reported)", mono?.notes === "Manual diff reviewed with pathologist" && eoNotes?.notes === "XN primary", `${mono?.notes} / ${eoNotes?.notes}`);
const corr = db.prepare("SELECT test_a_id, test_b_id, signoff_by_name FROM veritamap_test_correlations WHERE id = ?").get(corrId);
const eoTestId = testId("EO%");
check("C9. the manual-vs-analyzer comparison is now the EO% comparison (both ends on the EO% row), sign-off kept", corr?.test_a_id === eoTestId && corr?.test_b_id === eoTestId && corr?.signoff_by_name === "Test Director", JSON.stringify(corr));
const eoDates = db.prepare("SELECT last_cal_ver, last_method_comp FROM veritamap_tests WHERE map_id = ? AND analyte = 'EO%'").get(mapId);
check("C9b. EO% keeps the later of each date: its own cal ver 2026-07-01, and the manual row's later method comparison 2026-07-03", eoDates?.last_cal_ver === "2026-07-01" && eoDates?.last_method_comp === "2026-07-03", JSON.stringify(eoDates));
const orphans = db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values WHERE map_id = ? AND analyte IN (" + LEGACY.map(() => "?").join(",") + ")").get(mapId, ...LEGACY).n;
check("C10. no reference bands left under the old names", orphans === 0, String(orphans));
const audit = db.prepare("SELECT entity_label FROM audit_log WHERE module = 'veritamap' AND entity_label LIKE '%admin merge-analyte%' ORDER BY id DESC LIMIT 1").get();
check("C11. the merge is in the lab's audit log", /Eosinophils into EO%/.test(audit?.entity_label || ""), audit?.entity_label);
r = await merge({ labId, mapId });
check("C12. a second run finds nothing to merge", r.status === 200 && r.body.pairs === 0, JSON.stringify(r.body));
const mapView = (await call("GET", `${L}/veritamap/maps/${mapId}`, undefined, T)).body;
const eoTest = (mapView.tests || []).find((t) => t.analyte === "EO%") || {};
const eoInst = (eoTest.instruments || []).map((i) => i.instrument_name).sort().join(", ");
check("C13. the map API shows EO% once, run on the manual differential and the XN-1000", (mapView.tests || []).filter((t) => t.analyte === "EO%").length === 1 && eoInst === "Manual Differential, Sysmex XN-1000", eoInst);

// ---------- D. builder ----------
const save = (m, inst, tests) => call("PUT", `${L}/veritamap/maps/${m}/instruments/${inst}/tests`, { tests }, T);
const MAN2 = (await call("POST", `${L}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Manual Differential (backup bench)", category: "Hematology" }, T)).body.id;
r = await save(mapId, MAN2, ["Neutrophils", "Eosinophils", "Bands", "NEUT#"].map((a) => h(a, "HIGH")));
const man2 = db.prepare("SELECT analyte FROM veritamap_instrument_tests WHERE instrument_id = ? ORDER BY analyte").all(MAN2).map((x) => x.analyte).join(", ");
check("D1. on the Sysmex map, a manual menu of Neutrophils, Eosinophils, Bands, NEUT# saves as NEUT%, EO%, Bands, NEUT#", r.status === 200 && man2 === "Bands, EO%, NEUT#, NEUT%", man2);
const map2 = (await call("POST", `${L}/veritamap/maps`, { name: "Second campus" }, T)).body.id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map2, defaultActive: 1, instruments: [
  { name: "Beckman Coulter DxH 900", category: "Hematology", tests: ["NE%", "LY%", "MO%", "EO%", "BA%", "NE#"].map((a) => h(a)) },
  { name: "Manual Differential", category: "Hematology", tests: ["NEUT%", "LYMPH%", "MONO%", "EO%", "BASO%", "Bands"].map((a) => h(a, "HIGH")) },
] });
const man3 = db.prepare("SELECT it.analyte FROM veritamap_instrument_tests it JOIN veritamap_instruments i ON i.id = it.instrument_id WHERE i.map_id = ? AND i.instrument_name = 'Manual Differential' ORDER BY it.analyte").all(map2).map((x) => x.analyte).join(", ");
check("D2. on a Beckman map the library's NEUT%/LYMPH%/MONO%/BASO% take the map's NE%/LY%/MO%/BA%", man3 === "BA%, Bands, EO%, LY%, MO%, NE%", man3);
const rows2 = db.prepare("SELECT analyte FROM veritamap_tests WHERE map_id = ? ORDER BY analyte").all(map2).map((x) => x.analyte).join(", ");
check("D3. the Beckman map has one row per test (no NEUT%, LYMPH%, MONO%, BASO% rows)", rows2 === "BA%, Bands, EO%, LY%, MO%, NE#, NE%", rows2);
// D4-D6. Naming (Michael Q127, lab 17 dry run): with no "%" name on the map, the analyzer's name wins over "... (manual)".
const map3 = (await call("POST", `${L}/veritamap/maps`, { name: "DxH campus" }, T)).body.id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map3, defaultActive: 1, instruments: [
  { name: "Beckman Coulter DxH 690T", category: "Hematology", tests: [h("NRBC")] },
  { name: "Manual Differential", category: "Hematology", tests: [h("Bands", "HIGH")] },
] });
const man3Id = db.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND instrument_name = 'Manual Differential'").get(map3).id;
db.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, 'NRBC (manual)', 'Hematology', 'HIGH', 1)").run(man3Id, map3);
db.prepare("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, updated_at) VALUES (?, 'NRBC (manual)', 'Hematology', 'HIGH', 1, 'Manual Differential', ?)").run(map3, now);
r = await merge({ labId, mapId: map3 });
const p3 = (r.body.report || []).map((p) => `${p.from}>${p.into}`).join(" ");
check("D4. with no % name, the dry run folds 'NRBC (manual)' into the analyzer's 'NRBC' (not the reverse)", p3 === "NRBC (manual)>NRBC", p3);
r = await merge({ labId, mapId: map3, dryRun: false });
const rows3 = db.prepare("SELECT it.analyte, i.instrument_name FROM veritamap_instrument_tests it JOIN veritamap_instruments i ON i.id = it.instrument_id WHERE it.map_id = ? ORDER BY i.instrument_name, it.analyte").all(map3).map((x) => `${x.instrument_name}:${x.analyte}`).join(", ");
check("D5. after apply both instruments carry 'NRBC'", rows3 === "Beckman Coulter DxH 690T:NRBC, Manual Differential:Bands, Manual Differential:NRBC", rows3);
const MAN4 = (await call("POST", `${L}/veritamap/maps/${map3}/instruments`, { instrument_name: "Manual Differential (bench 2)", category: "Hematology" }, T)).body.id;
await save(map3, MAN4, [h("NRBC (manual)", "HIGH")]);
const man4 = db.prepare("SELECT analyte FROM veritamap_instrument_tests WHERE instrument_id = ?").all(MAN4).map((x) => x.analyte).join(", ");
check("D6. on that map, a manual menu's 'NRBC (manual)' saves as 'NRBC'", man4 === "NRBC", man4);

// ---------- E. browser ----------
db.close();
const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${mapId}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(`E1. [${scheme}] the map page lists EO% and no Eosinophils row`, /EO%/.test(text) && !/\bEosinophils\b/.test(text), text.slice(0, 160));
  await page.screenshot({ path: `${OUT}/one_row_map_${scheme}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
