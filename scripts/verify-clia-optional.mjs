// scripts/verify-clia-optional.mjs
//
// CLIA number optional (Michael 2026-10-14: "I have been bitten multiple times by labs that don't have a CLIA number
// and me not being able to work in them in a demo. Lets remove that requirment."). Boots the built server on a COPY of
// a production backup (never written) and checks that a lab with no CLIA number can be worked in end to end:
//   1. admin provision-owner-lab without a CLIA creates the lab (clia_number NULL)
//   2. a second CLIA-less lab can be created too (labs.clia_number is UNIQUE only when non-null)
//   3. a CLIA that is already in use is still refused (409): uniqueness is kept
//   4. a FINALIZED VeritaCheck study saves on the CLIA-less lab (was 400 CLIA_REQUIRED)
//   5. VeritaStaff lab setup saves without a CLIA (stored blank)
//   6. a read-and-sign staff invite works on a CLIA-less lab with no VeritaStaff setup yet (the roster record seeds
//      itself from the lab name alone; was "Add the lab's name and CLIA number before adding read-and-sign staff")
//   7. the VeritaStaff roster loads for that lab
// Usage: node scripts/verify-clia-optional.mjs <production-backup.db>   (after npm run build)
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
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5177, SECRET = "clia-optional-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-clia-optional.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clia-optional-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const B = `http://localhost:${PORT}`;
const post = (url, body, headers = {}) => fetch(B + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const db = () => new Database(dbPath, { readonly: true });

const stamp = Date.now();
const provision = (n, cliaNumber) => post("/api/admin/provision-owner-lab", { secret: SECRET, ownerEmail: `clia-optional-${n}-${stamp}@example.invalid`, ownerName: `CLIA Optional ${n}`, labName: `No-CLIA Demo Lab ${n}`, cliaNumber, plan: "hospital" });
const labFor = (n) => { const d = db(); const r = d.prepare("SELECT l.id, l.clia_number, l.owner_user_id FROM labs l JOIN users u ON u.id = l.owner_user_id WHERE u.email = ?").get(`clia-optional-${n}-${stamp}@example.invalid`); d.close(); return r; };

const p1 = await provision(1);
const lab1 = labFor(1);
check("1. a lab can be created without a CLIA (stored NULL)", p1.status === 200 && !!lab1 && lab1.clia_number === null, `${p1.status} ${JSON.stringify(lab1)} ${p1.status !== 200 ? await p1.text() : ""}`);
const p2 = await provision(2);
const lab2 = labFor(2);
check("2. a second CLIA-less lab can be created", p2.status === 200 && !!lab2 && lab2.clia_number === null, `${p2.status} ${JSON.stringify(lab2)}`);
const taken = (() => { const d = db(); const r = d.prepare("SELECT clia_number FROM labs WHERE clia_number IS NOT NULL AND TRIM(clia_number) <> '' LIMIT 1").get(); d.close(); return r?.clia_number; })();
const p3 = await provision(3, taken);
check("3. a CLIA already in use is still refused", p3.status === 409, `${p3.status} for ${taken}`);

if (!lab1 || !lab2) { console.error("labs not created; stopping"); child.kill(); process.exit(1); }
const H = (lab) => ({ Authorization: `Bearer ${jwt.sign({ svc: true, userId: lab.owner_user_id }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(lab.id) });

// A finalized study: the inputs of an existing completed precision study in the backup, saved on the CLIA-less lab.
const src = (() => { const d = db(); const r = d.prepare("SELECT * FROM studies WHERE status <> 'draft' AND study_type = 'precision' ORDER BY id DESC LIMIT 1").get(); d.close(); return r; })();
const study = {
  testName: src.test_name, instrument: src.instrument, analyst: src.analyst, date: src.date, studyType: src.study_type,
  cliaAllowableError: src.clia_allowable_error, dataPoints: src.data_points, instruments: src.instruments, status: "completed",
  teaIsPercentage: src.tea_is_percentage, teaUnit: src.tea_unit, createdAt: new Date().toISOString(),
};
const s4 = await post(`/api/labs/${lab1.id}/studies`, study, H(lab1));
const s4j = await s4.json().catch(() => ({}));
check("4. a finalized VeritaCheck study saves on the CLIA-less lab", (s4.status === 200 || s4.status === 201) && s4j.status !== "draft" && !s4j.code, `${s4.status} ${JSON.stringify(s4j).slice(0, 200)}`);

const s5 = await post(`/api/labs/${lab1.id}/staff/lab`, { labName: "No-CLIA Demo Lab 1", accreditationBody: "CLIA_ONLY", complexity: "high" }, H(lab1));
const row5 = (() => { const d = db(); const r = d.prepare("SELECT clia_number FROM staff_labs WHERE tier2_lab_id = ?").get(lab1.id); d.close(); return r; })();
check("5. VeritaStaff lab setup saves without a CLIA (stored blank)", s5.status === 200 && row5 && row5.clia_number === "", `${s5.status} ${JSON.stringify(row5)} ${s5.status !== 200 ? await s5.text() : ""}`);

const s6 = await post(`/api/labs/${lab2.id}/staff-portal-invites`, { email: `reader-${stamp}@example.invalid`, firstName: "Read", lastName: "Sign", deliverEmail: false }, H(lab2));
const row6 = (() => { const d = db(); const r = d.prepare("SELECT lab_name, clia_number FROM staff_labs WHERE tier2_lab_id = ?").get(lab2.id); d.close(); return r; })();
check("6. a read-and-sign invite works on a CLIA-less lab with no VeritaStaff setup yet", s6.status === 200 && row6 && row6.clia_number === "", `${s6.status} ${JSON.stringify(row6)} ${s6.status !== 200 ? (await s6.text()).slice(0, 200) : ""}`);

const s7 = await fetch(`${B}/api/labs/${lab2.id}/staff/employees`, { headers: H(lab2) });
const s7j = await s7.json().catch(() => null);
check("7. the VeritaStaff roster loads for that lab", s7.status === 200 && Array.isArray(s7j?.employees ?? s7j), `${s7.status} ${JSON.stringify(s7j).slice(0, 160)}`);

child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
