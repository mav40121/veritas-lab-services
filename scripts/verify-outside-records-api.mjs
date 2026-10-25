// scripts/verify-outside-records-api.mjs
//
// Q16 (2026-10-24, Lifepoint Georgetown REQ-103): record studies performed outside VeritaCheck. Boots the built server
// on a COPY of a production backup (deleted at the end) and drives the real routes:
//   POST /api/labs/:labId/veritacheck/coverage/outside-records, POST .../outside-records/:id/void,
//   GET  /api/labs/:labId/veritacheck/coverage and /coverage/export.
// Usage: node scripts/verify-outside-records-api.mjs <production-backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ExcelJS = require("exceljs");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5185, SECRET = "outside-records-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-outside-records-api.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outside-records-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const cleanup = async () => { await new Promise((r) => setTimeout(r, 500)); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };

const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy", CONTINUOUS_BACKUP: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start; last log lines:\n" + log.split("\n").slice(-15).join("\n")); child.kill(); await cleanup(); process.exit(2); }
const B = `http://localhost:${PORT}`;
const send = (method, url, body, headers = {}) => fetch(B + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare(sql).get(...a); d.close(); return r; };
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const plus6mo = (iso) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCMonth(dt.getUTCMonth() + 6); return dt.toISOString().slice(0, 10); };

try {
  const stamp = Date.now();
  const prov = await send("POST", "/api/admin/provision-owner-lab", { secret: SECRET, ownerEmail: `outside-${stamp}@example.invalid`, ownerName: "Outside Owner", labName: `Outside Records Lab ${stamp}`, plan: "hospital" });
  const pj = await prov.json();
  const labId = pj.lab_id, ownerId = pj.owner_user_id;
  if (prov.status !== 200 || !labId) throw new Error("provision failed " + prov.status + " " + JSON.stringify(pj));
  const H = { Authorization: `Bearer ${jwt.sign({ svc: true, userId: ownerId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(labId) };
  const map = await (await send("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, H)).json();
  const instA = await (await send("POST", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Analyzer One", category: "Chemistry" }, H)).json();
  const instB = await (await send("POST", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Benchtop Two", category: "Chemistry" }, H)).json();
  const t = (a) => ({ analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active: true });
  await send("PUT", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${instA.id}/tests`, { tests: [t("Sodium"), t("Potassium")] }, H);
  await send("PUT", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${instB.id}/tests`, { tests: [t("Sodium")] }, H);
  const cov = async () => (await send("GET", `/api/labs/${labId}/veritacheck/coverage`, undefined, H)).json();
  let c = await cov();
  const rowOf = (cc, analyte, inst) => cc.rows.find((r) => r.analyte === analyte && r.instrument.startsWith(inst));
  const naA = rowOf(c, "Sodium", "Analyzer One"), naB = rowOf(c, "Sodium", "Benchtop Two"), kA = rowOf(c, "Potassium", "Analyzer One");
  check("0. setup: Sodium and Potassium on Analyzer One, Sodium on Benchtop Two, all missing", naA?.linearityStatus === "missing" && naB?.linearityStatus === "missing" && kA?.linearityStatus === "missing", JSON.stringify(c.rows?.map((r) => [r.analyte, r.instrument, r.linearityStatus])));
  const url = `/api/labs/${labId}/veritacheck/coverage/outside-records`;
  const base = { recordsLocation: "Chemistry cal ver binder, August 2026", reviewedBy: "Dr. Pat Director" };

  // 1. Record the August cal ver for Sodium on Analyzer One.
  const aug = daysAgo(60);
  const r1 = await send("POST", url, { kind: "cal_ver", performedOn: aug, ...base, instrumentTestIds: [naA.instrumentTestId] }, H);
  const j1 = await r1.json();
  c = await cov();
  const naA2 = rowOf(c, "Sodium", "Analyzer One"), naB2 = rowOf(c, "Sodium", "Benchtop Two");
  check("1. recording an outside cal ver returns created 1", r1.status === 200 && j1.created === 1, `${r1.status} ${JSON.stringify(j1)}`);
  check("2. Coverage shows that row covered by the outside record until 6 months later", naA2.linearityStatus === "covered" && naA2.outsideRecord?.reviewedBy === "Dr. Pat Director" && naA2.nextDueOn === plus6mo(aug), JSON.stringify(naA2));
  check("3. the same analyte on the other instrument stays missing", naB2.linearityStatus === "missing" && !naB2.outsideRecord, JSON.stringify(naB2));
  check("4. the VeritaMap Cal Verification date is filled in", one("SELECT last_cal_ver AS d FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'", map.id)?.d === aug, JSON.stringify(one("SELECT last_cal_ver AS d FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'", map.id)));
  check("5. the list on Coverage shows who recorded it and where the records are", (c.outsideRecords || []).length === 1 && c.outsideRecords[0].recordsLocation === base.recordsLocation && c.outsideRecords[0].createdBy === "Outside Owner", JSON.stringify(c.outsideRecords));

  // 6. The same record again is skipped, not duplicated.
  const j6 = await (await send("POST", url, { kind: "cal_ver", performedOn: aug, ...base, instrumentTestIds: [naA.instrumentTestId] }, H)).json();
  check("6. recording the same test and date again is skipped, not duplicated", j6.created === 0 && j6.skipped === 1, JSON.stringify(j6));

  // 7. Validation.
  const foreign = one("SELECT it.id FROM veritamap_instrument_tests it JOIN veritamap_maps m ON m.id = it.map_id WHERE m.lab_id != ? LIMIT 1", labId);
  const tomorrow2 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const bad = await Promise.all([
    send("POST", url, { kind: "cal_ver", performedOn: aug, recordsLocation: base.recordsLocation, instrumentTestIds: [naA.instrumentTestId] }, H),
    send("POST", url, { kind: "cal_ver", performedOn: tomorrow2, ...base, instrumentTestIds: [naA.instrumentTestId] }, H),
    send("POST", url, { kind: "cal_ver", performedOn: aug, ...base, instrumentTestIds: [foreign?.id ?? 999999999] }, H),
    send("POST", url, { kind: "precision", performedOn: aug, ...base, instrumentTestIds: [naA.instrumentTestId] }, H),
    send("POST", url, { kind: "method_comparison", performedOn: aug, ...base, analytes: ["Not On This Map"] }, H),
  ]);
  check("7. refused: no reviewer, a future date, another lab's test, an unknown type, an analyte not on the map", bad.every((x) => x.status === 400), bad.map((x) => x.status).join(","));

  // 8. An outside record older than 6 months reads overdue.
  const feb = daysAgo(240);
  await send("POST", url, { kind: "cal_ver", performedOn: feb, ...base, instrumentTestIds: [kA.instrumentTestId] }, H);
  c = await cov();
  const kA2 = rowOf(c, "Potassium", "Analyzer One");
  check("8. a record older than 6 months reads missing and overdue", kA2.linearityStatus === "missing" && kA2.overdue === true, JSON.stringify(kA2));

  // 9. Outside correlation for Sodium (two instruments).
  const r9 = await send("POST", url, { kind: "method_comparison", performedOn: daysAgo(30), ...base, analytes: ["Sodium"] }, H);
  c = await cov();
  const mc = c.methodComparisons.find((m) => m.analyte === "Sodium");
  check("9. an outside correlation satisfies the Sodium method comparison", r9.status === 200 && mc?.outsideRecord && mc.nextDueOn === plus6mo(daysAgo(30)) && !mc.overdue && mc.studyId === null, JSON.stringify(mc));
  check("10. the VeritaMap Method Comparison date is filled in", one("SELECT last_method_comp AS d FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'", map.id)?.d === daysAgo(30), "");

  // 11. Export carries the outside records.
  const ex = await send("GET", `/api/labs/${labId}/veritacheck/coverage/export`, undefined, H);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await ex.arrayBuffer()));
  const sheetNames = wb.worksheets.map((w) => w.name);
  let calCell = false; wb.getWorksheet("Cal Ver Linearity")?.eachRow((row) => { row.eachCell((cell) => { if (String(cell.value || "").startsWith(`Outside record, performed ${aug}`)) calCell = true; }); });
  check("11. the Excel export lists the outside records and names them on the Cal Ver sheet", ex.status === 200 && sheetNames.includes("Outside Records") && calCell, `${ex.status} ${sheetNames.join("|")} calCell=${calCell}`);

  // 12. Void: needs a reason; another lab's record is not found; voiding puts the row back to missing and clears the map date.
  const recId = c.outsideRecords.find((o) => o.kind === "cal_ver" && o.analyte === "Sodium").id;
  const v0 = await send("POST", `${url}/${recId}/void`, { reason: "" }, H);
  { const w = new Database(dbPath); w.prepare("INSERT INTO veritacheck_outside_records (lab_id, kind, instrument_id, analyte, performed_on, records_location, reviewed_by, created_at) VALUES (?, 'cal_ver', 1, 'X', ?, 'x', 'x', ?)").run(labId + 100000, aug, new Date().toISOString()); w.close(); }
  const otherId = one("SELECT id FROM veritacheck_outside_records WHERE lab_id = ?", labId + 100000).id;
  const vOther = await send("POST", `${url}/${otherId}/void`, { reason: "test" }, H);
  const v1 = await send("POST", `${url}/${recId}/void`, { reason: "entered for the wrong instrument" }, H);
  c = await cov();
  check("12. void needs a reason (400) and cannot reach another lab's record (404)", v0.status === 400 && vOther.status === 404, `${v0.status} ${vOther.status}`);
  check("13. voiding puts Sodium on Analyzer One back to missing and clears the map date it set", v1.status === 200 && rowOf(c, "Sodium", "Analyzer One").linearityStatus === "missing" && !one("SELECT last_cal_ver AS d FROM veritamap_tests WHERE map_id = ? AND analyte = 'Sodium'", map.id)?.d, `${v1.status} ${JSON.stringify(rowOf(c, "Sodium", "Analyzer One"))}`);
  check("14. the voided record is kept with its reason", one("SELECT void_reason FROM veritacheck_outside_records WHERE id = ?", recId)?.void_reason === "entered for the wrong instrument" && !(c.outsideRecords || []).some((o) => o.id === recId), "");
} catch (e) {
  console.error("ERROR", e.message); fails++;
} finally {
  child.kill();
  await cleanup();
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
