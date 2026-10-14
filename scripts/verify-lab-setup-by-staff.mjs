// scripts/verify-lab-setup-by-staff.mjs
//
// Labs are created only by Veritas staff after a conversation (Michael 2026-10-14, Q195 = 1 / Q197 = 1: "I think we
// need to stop allowing random people create a lab. It should only happen after a conversation with my staff").
// Boots the built server on a COPY of a production backup (never written) and checks every self-serve path is closed
// while the staff path and existing labs keep working:
//   1. a brand-new signup still registers (free account, demo lab, no lab of its own)
//   2. that account's Account Settings save with a lab name and CLIA is refused (409 LAB_SETUP_BY_STAFF) and creates
//      no lab and no membership (this branch used to create the lab)
//   3. the self-serve add-a-lab purchase (POST /api/labs/me/add) is refused (403 LAB_SETUP_BY_STAFF)
//   4. a new account carrying lab details on its user row gets NO lab at the next restart (boot backfill cutoff)
//   5. ...while a legacy account (created before the 2026-10-14 19:00 UTC cutoff) is still backfilled on that restart
//   6. the staff path still works: admin provision-owner-lab creates the lab and its owner
//   7. an existing lab owner's Account Settings save still works (200)
// Usage: node scripts/verify-lab-setup-by-staff.mjs <production-backup.db>   (after npm run build)
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
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5178, SECRET = "lab-by-staff-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-lab-setup-by-staff.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lab-by-staff-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const B = `http://localhost:${PORT}`;
let child = null;
const boot = async () => {
  child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
  for (let i = 0; i < 90; i++) { await new Promise((r) => setTimeout(r, 1000)); try { if ((await fetch(`${B}/api/health`)).status === 200) return true; } catch {} }
  return false;
};
const stop = async () => { child?.kill(); await new Promise((r) => setTimeout(r, 1500)); };
if (!(await boot())) { console.error("server did not start"); process.exit(2); }
const q = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };
const labCount = () => q("SELECT COUNT(*) AS n FROM labs").n;
const json = (method, url, body, headers = {}) => fetch(B + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });

const stamp = Date.now();
const email = `lab-by-staff-${stamp}@example.invalid`;
const reg = await json("POST", "/api/auth/register", { email, password: "testpass123", name: "Stranger", hipaa_acknowledged: true, plan: "clinic", hospital_name: "Stranger Lab", hospital_state: "MA", bed_count: 25 });
const rj = await reg.json().catch(() => ({}));
const uid = rj?.user?.id;
check("1. a new signup still registers (free, no lab of its own)", reg.status === 200 && !!rj.token && rj?.user?.plan === "free" && !q("SELECT 1 FROM lab_members WHERE user_id = ?", uid), `${reg.status} ${JSON.stringify(rj).slice(0, 140)}`);
const H = { Authorization: `Bearer ${rj.token}` };

const before = labCount();
const s2 = await json("PUT", "/api/account/settings", { clia_lab_name: "Stranger Lab", clia_number: "22D9988776", accreditation_choice: "CAP" }, H);
const s2j = await s2.json().catch(() => ({}));
check("2. Account Settings refuses to create the lab (409 LAB_SETUP_BY_STAFF), no lab, no membership",
  s2.status === 409 && s2j.code === "LAB_SETUP_BY_STAFF" && labCount() === before && !q("SELECT 1 FROM lab_members WHERE user_id = ?", uid), `${s2.status} ${JSON.stringify(s2j).slice(0, 140)} labs ${before}->${labCount()}`);

const s3 = await json("POST", "/api/labs/me/add", { labName: "Stranger Lab 2", cliaNumber: "22D9988775", priceType: "clinic" }, H);
const s3j = await s3.json().catch(() => ({}));
check("3. the self-serve add-a-lab purchase is refused (403 LAB_SETUP_BY_STAFF)", s3.status === 403 && s3j.code === "LAB_SETUP_BY_STAFF" && labCount() === before, `${s3.status} ${JSON.stringify(s3j).slice(0, 140)}`);

// Boot backfill: give the new account lab details on its user row (what POST /api/clia/confirm writes), and a legacy
// account (created before the cutoff) the same shape, then restart.
await stop();
{
  const d = new Database(dbPath);
  d.prepare("UPDATE users SET clia_number = ?, clia_lab_name = ? WHERE id = ?").run("22D9988774", "Stranger Lab", uid);
  d.prepare("INSERT INTO users (email, password_hash, name, plan, created_at, clia_number, clia_lab_name) VALUES (?, 'x', 'Legacy', 'free', '2026-05-01T00:00:00.000Z', '22D9988773', 'Legacy Lab')").run(`legacy-${stamp}@example.invalid`);
  d.close();
}
if (!(await boot())) { console.error("server did not restart"); process.exit(2); }
const newUser = q("SELECT lab_id FROM users WHERE id = ?", uid);
check("4. a new account with lab details gets NO lab at the next restart", !newUser.lab_id && !q("SELECT 1 FROM labs WHERE clia_number = '22D9988774'"), JSON.stringify(newUser));
const legacy = q("SELECT lab_id FROM users WHERE email = ?", `legacy-${stamp}@example.invalid`);
check("5. a legacy account (before the 2026-10-14 19:00 UTC cutoff) is still backfilled on that restart", !!legacy.lab_id && !!q("SELECT 1 FROM labs WHERE clia_number = '22D9988773'"), JSON.stringify(legacy));

const p6 = await json("POST", "/api/admin/provision-owner-lab", { secret: SECRET, ownerEmail: `staff-made-${stamp}@example.invalid`, ownerName: "After the call", labName: "Staff Made Lab", cliaNumber: "22D9988772", plan: "clinic" });
check("6. the staff path still creates a lab (admin provision-owner-lab)", p6.status === 200 && !!q("SELECT 1 FROM labs WHERE clia_number = '22D9988772'"), `${p6.status} ${(await p6.text()).slice(0, 140)}`);

const owner = q("SELECT l.id, l.owner_user_id, l.lab_name, l.clia_number FROM labs l WHERE l.id = 1");
const s7 = await json("PUT", "/api/account/settings", { clia_lab_name: owner.lab_name, clia_number: owner.clia_number }, { Authorization: `Bearer ${jwt.sign({ userId: owner.owner_user_id }, SECRET, { expiresIn: "5m" })}`, "X-Active-Lab-Id": "1" });
check("7. an existing lab owner's Account Settings save still works", s7.status === 200, `${s7.status} ${(await s7.text()).slice(0, 140)}`);

await stop(); fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
