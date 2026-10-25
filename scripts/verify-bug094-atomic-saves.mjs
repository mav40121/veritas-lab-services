// scripts/verify-bug094-atomic-saves.mjs
//
// BUG-094 (2026-10-23, Lifepoint Georgetown): a VeritaMap test-menu save failed with "database is locked". Two defects:
// the app waited only 5 seconds for a lock that Litestream (continuous backup) held for about 10, and the save deleted the
// instrument's whole menu in one statement and re-inserted it afterward, so a failure in between left no tests.
// Boots the built server on a COPY of a production backup (deleted at the end) and checks:
//   1. a normal menu save stores the menu (lab-scoped route)
//   2. a save that fails partway (a bad value on the second test) returns an error and leaves the saved menu intact
//   3. the same on the older non-lab route
//   4. a save made while another connection holds the write lock for 8 seconds waits and succeeds
//   5. the same sweep fix on a VeritaComp record: a failed item replace leaves the record's items intact
// Usage: node scripts/verify-bug094-atomic-saves.mjs <production-backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5184, SECRET = "bug094-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-bug094-atomic-saves.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug094-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);

const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy", CONTINUOUS_BACKUP: "0" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start; last log lines:\n" + log.split("\n").slice(-15).join("\n")); child.kill(); process.exit(2); }
const B = `http://localhost:${PORT}`;
const send = (method, url, body, headers = {}) => fetch(B + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const all = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare(sql).all(...a); d.close(); return r; };
const menu = (instId) => all("SELECT analyte FROM veritamap_instrument_tests WHERE instrument_id = ? ORDER BY analyte", instId).map((r) => r.analyte).join(",");

try {
  const stamp = Date.now();
  const prov = await send("POST", "/api/admin/provision-owner-lab", { secret: SECRET, ownerEmail: `bug094-${stamp}@example.invalid`, ownerName: "BUG-094 Owner", labName: `BUG-094 Lab ${stamp}`, plan: "hospital" });
  const pj = await prov.json();
  const labId = pj.lab_id, ownerId = pj.owner_user_id;
  if (prov.status !== 200 || !labId) throw new Error("provision failed " + prov.status + " " + JSON.stringify(pj));
  const H = { Authorization: `Bearer ${jwt.sign({ svc: true, userId: ownerId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(labId) };
  const map = await (await send("POST", `/api/labs/${labId}/veritamap/maps`, { name: "BUG-094" }, H)).json();
  const inst = await (await send("POST", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Test Analyzer", category: "Chemistry" }, H)).json();
  const lab = `/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${inst.id}/tests`;
  const legacy = `/api/veritamap/maps/${map.id}/instruments/${inst.id}/tests`;
  const good = ["Albumin", "Calcium", "Sodium"].map((a) => ({ analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active: true }));
  // A bad value on the second test makes the insert throw after the first row: the exact "failure in between".
  const bad = [{ analyte: "Glucose", specialty: "General Chemistry", complexity: "MODERATE", active: true }, { analyte: "Potassium", specialty: "General Chemistry", complexity: "MODERATE", active: { not: "a number" } }];

  // 1. Normal save.
  const s1 = await send("PUT", lab, { tests: good }, H);
  check("1. a normal menu save stores the menu", s1.status === 200 && menu(inst.id) === "Albumin,Calcium,Sodium", `${s1.status} ${menu(inst.id)}`);

  // 2. Failed save, lab-scoped route.
  const s2 = await send("PUT", lab, { tests: bad }, H);
  check("2. a save that fails partway returns an error and leaves the saved menu intact", s2.status >= 400 && menu(inst.id) === "Albumin,Calcium,Sodium", `${s2.status} menu now [${menu(inst.id)}]`);

  // 3. Failed save, older non-lab route.
  const s3 = await send("PUT", legacy, { tests: bad }, H);
  check("3. the same on the older non-lab route", s3.status >= 400 && menu(inst.id) === "Albumin,Calcium,Sodium", `${s3.status} menu now [${menu(inst.id)}]`);

  // 4. A save while another connection holds the write lock for 8 seconds (longer than the old 5-second wait).
  const holder = new Database(dbPath);
  holder.exec("BEGIN IMMEDIATE");
  const t0 = Date.now();
  const pending = send("PUT", lab, { tests: good.slice(0, 2) }, H);
  await new Promise((r) => setTimeout(r, 8000));
  holder.exec("COMMIT"); holder.close();
  const s4 = await pending;
  const waited = Math.round((Date.now() - t0) / 1000);
  check("4. a save made during an 8-second lock waits for it and succeeds", s4.status === 200 && menu(inst.id) === "Albumin,Calcium", `${s4.status} after ${waited}s ${s4.status !== 200 ? (await s4.text()).slice(0, 120) : ""} menu [${menu(inst.id)}]`);

  // 5. VeritaComp: a failed item replace leaves the record's items intact.
  const prog = await (await send("POST", `/api/labs/${labId}/competency/programs`, { name: "BUG-094 Program", department: "Chemistry", type: "nontechnical", checklistItems: [{ label: "Safety", description: "Safety review" }] }, H)).json();
  const emp = await (await send("POST", `/api/labs/${labId}/competency/employees`, { name: "Pat Tester", title: "MLT" }, H)).json();
  const asmt = await (await send("POST", `/api/labs/${labId}/competency/assessments`, { programId: prog.id, employeeId: emp.id, assessmentType: "annual", assessmentDate: "2026-10-01", competencyType: "nontechnical" }, H)).json();
  const aUrl = `/api/labs/${labId}/competency/assessments/${asmt.id}`;
  const items = () => all("SELECT nt_item_label FROM competency_assessment_items WHERE assessment_id = ? ORDER BY id", asmt.id).map((r) => r.nt_item_label).join(",");
  const c1 = await send("PUT", aUrl, { items: [{ ntItemLabel: "Safety", ntDateMet: "2026-10-01" }] }, H);
  const c2 = await send("PUT", aUrl, { items: [{ ntItemLabel: "Fire" }, { ntItemLabel: "Spill", evidence: { not: "text" } }] }, H);
  check("5. VeritaComp: a failed item replace leaves the record's items intact", asmt.id && c1.status === 200 && c2.status >= 400 && items() === "Safety", `create ${JSON.stringify(asmt).slice(0, 80)} save ${c1.status} bad ${c2.status} items [${items()}]`);
} catch (e) {
  console.error("ERROR", e.message); fails++;
} finally {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
