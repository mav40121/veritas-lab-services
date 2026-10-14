// scripts/verify-bug050-nontechnical-checklist.mjs
//
// BUG-050 (2026-10-14): creating a non-technical VeritaComp program inside a lab (POST /api/labs/:labId/competency/
// programs, the route the app uses) dropped the checklist items, so the program's assessments had nothing to check off
// (Michael's "Plating Media", lab 3). Boots the built server (dist/index.cjs) on a COPY of a scratch database that has
// a lab whose owner has VeritaComp, then:
//   1. creates a non-technical program with 3 checklist items through the lab route
//   2. reads the program back: 3 checklist items, in order, with their labels and descriptions
//   3. a technical program created the same way still gets no checklist items
// On the pre-fix build, check 2 FAILs (0 items).
// Usage: node scripts/verify-bug050-nontechnical-checklist.mjs <scratch.db> <labId> <ownerUserId>   (after npm run build)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = path.join(ROOT, "dist", "index.cjs"), PORT = 5171, SECRET = "bug050-local";
const [seed, labId, ownerId] = process.argv.slice(2);
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!seed || !labId || !ownerId || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-bug050-nontechnical-checklist.mjs <scratch.db> <labId> <ownerUserId>"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bug050-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(seed, dbPath);
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const H = { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ userId: Number(ownerId) }, SECRET, { expiresIn: "5m" })}`, "X-Active-Lab-Id": String(labId) };
const B = `http://localhost:${PORT}/api/labs/${labId}/competency/programs`;
const items = [{ label: "A", description: "Prepares plating media per procedure" }, { label: "B", description: "Checks media QC and expiration" }, { label: "C", description: "Documents lot numbers" }];
const c1 = await fetch(B, { method: "POST", headers: H, body: JSON.stringify({ name: "BUG-050 Plating Media", department: "Microbiology", type: "nontechnical", checklistItems: items }) });
const p1 = await c1.json().catch(() => ({}));
check("1. non-technical program created through the lab route", c1.status === 200 && !!p1.id, `${c1.status} ${JSON.stringify(p1)}`);
const d1 = await (await fetch(`${B}/${p1.id}`, { headers: H })).json().catch(() => ({}));
const got = (d1.checklistItems || []).map((i) => `${i.label}:${i.description}`);
check("2. its 3 checklist items were saved, in order", JSON.stringify(got) === JSON.stringify(items.map((i) => `${i.label}:${i.description}`)), JSON.stringify(got));
const c2 = await fetch(B, { method: "POST", headers: H, body: JSON.stringify({ name: "BUG-050 Technical control", department: "Chemistry", type: "technical", checklistItems: items }) });
const p2 = await c2.json().catch(() => ({}));
const d2 = await (await fetch(`${B}/${p2.id}`, { headers: H })).json().catch(() => ({}));
check("3. a technical program gets no checklist items", c2.status === 200 && (d2.checklistItems || []).length === 0, `${c2.status} ${JSON.stringify(d2.checklistItems)}`);
child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
