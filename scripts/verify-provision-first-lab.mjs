// scripts/verify-provision-first-lab.mjs
//
// POST /api/admin/provision-first-lab (2026-10-23): the first lab for an EXISTING user who has none (a self-signup
// the operator sets up; Krista McKnight, Shriners Children's Ohio). Boots the built server on a COPY of a production
// backup (never written), seeds one lab-less user with a map and a study that have no lab yet, and checks:
//   1. wrong secret 403; unknown user 404; plan "free" 400; missing expiresAt 400
//   2. dryRun reports the rows it would adopt and creates nothing
//   3. the real call creates the lab (plan, status active, expiry), an owner membership with is_primary_lab=1,
//      users.lab_id / default_lab_id, and adopts the map and the study; the user's own plan stays "free"
//   4. a second call for the same user is refused (409); a user who already has a lab is refused (409)
//   5. as the user: the map list in the new lab shows the adopted map, and a correlation study can be started
//      without spending a free study credit (the lab plan is uncapped)
// Usage: node scripts/verify-provision-first-lab.mjs <production-backup.db>   (after npm run build)
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
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5179, SECRET = "first-lab-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-provision-first-lab.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-lab-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);

// Seed (on the copy only): a free self-signup with no lab, one map and one draft study that have no lab yet.
const stamp = Date.now(), email = `first-lab-${stamp}@example.invalid`, now = new Date().toISOString();
{
  const w = new Database(dbPath);
  const u = w.prepare("INSERT INTO users (email, password_hash, name, plan, study_credits, created_at) VALUES (?, 'x', 'First Lab Test', 'free', 2, ?)").run(email, now);
  const uid = Number(u.lastInsertRowid);
  w.prepare("INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, 'Pre-lab map', '[]', ?, ?)").run(uid, now, now);
  w.prepare("INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at) VALUES (?, 'Sodium', 'i-STAT 1', 'FL', '2026-10-21', 'method_comparison', 0.04, '[]', '[]', 'draft', ?)").run(uid, now);
  w.close();
}
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start; last log lines:\n" + log.split("\n").slice(-15).join("\n")); child.kill(); process.exit(2); }
const B = `http://localhost:${PORT}`;
const post = (url, body, headers = {}) => fetch(B + url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const ro = () => new Database(dbPath, { readonly: true });
const one = (sql, ...a) => { const d = ro(); const r = d.prepare(sql).get(...a); d.close(); return r; };
const user = one("SELECT id, plan, study_credits, lab_id FROM users WHERE email = ?", email);
const EXP = "2026-11-22T23:59:59.000Z";
const body = { secret: SECRET, userId: user.id, labName: "First Lab Test Hospital", plan: "veritacheck_only", expiresAt: EXP };

try {
  const r403 = await post("/api/admin/provision-first-lab", { ...body, secret: "wrong" });
  const r404 = await post("/api/admin/provision-first-lab", { ...body, userId: 99999999 });
  const rFree = await post("/api/admin/provision-first-lab", { ...body, plan: "free" });
  const { expiresAt, ...noExp } = body;
  const rNoExp = await post("/api/admin/provision-first-lab", noExp);
  check("1. wrong secret 403, unknown user 404, plan free 400, no expiresAt 400",
    r403.status === 403 && r404.status === 404 && rFree.status === 400 && rNoExp.status === 400, `${r403.status} ${r404.status} ${rFree.status} ${rNoExp.status}`);

  const labsBefore = one("SELECT COUNT(*) AS n FROM labs").n;
  const dry = await post("/api/admin/provision-first-lab", { ...body, dryRun: true });
  const dj = await dry.json();
  const adoptMap = (dj.adopt || []).find((x) => x.table === "veritamap_maps")?.rows, adoptStudy = (dj.adopt || []).find((x) => x.table === "studies")?.rows;
  check("2. dryRun lists 1 map and 1 study to adopt and creates nothing", dry.status === 200 && dj.dryRun === true && adoptMap === 1 && adoptStudy === 1 && one("SELECT COUNT(*) AS n FROM labs").n === labsBefore,
    `${dry.status} ${JSON.stringify(dj)}`);

  const real = await post("/api/admin/provision-first-lab", body);
  const rj = await real.json();
  const labId = rj.lab?.id;
  const lab = labId ? one("SELECT * FROM labs WHERE id = ?", labId) : null;
  const m = labId ? one("SELECT role, status, is_primary_lab FROM lab_members WHERE lab_id = ? AND user_id = ?", labId, user.id) : null;
  const u2 = one("SELECT plan, study_credits, lab_id, default_lab_id FROM users WHERE id = ?", user.id);
  const mapRow = one("SELECT lab_id FROM veritamap_maps WHERE user_id = ? AND name = 'Pre-lab map'", user.id);
  const studyRow = one("SELECT lab_id FROM studies WHERE user_id = ? AND test_name = 'Sodium'", user.id);
  check("3a. lab created: plan veritacheck_only, active, expiry set, owner is the user, CLIA blank",
    real.status === 200 && lab && lab.plan === "veritacheck_only" && lab.subscription_status === "active" && lab.subscription_expires_at === EXP && lab.owner_user_id === user.id && lab.clia_number === null,
    `${real.status} ${JSON.stringify(rj).slice(0, 300)}`);
  check("3b. owner membership, active, is_primary_lab 1", m && m.role === "owner" && m.status === "active" && m.is_primary_lab === 1, JSON.stringify(m));
  check("3c. users.lab_id and default_lab_id point at the lab; the user's own plan stays free", u2.lab_id === labId && u2.default_lab_id === labId && u2.plan === "free", JSON.stringify(u2));
  check("3d. the map and the study made before the lab are adopted into it", mapRow?.lab_id === labId && studyRow?.lab_id === labId, `${JSON.stringify(mapRow)} ${JSON.stringify(studyRow)}`);

  const again = await post("/api/admin/provision-first-lab", body);
  const existingOwner = one("SELECT m.user_id FROM lab_members m WHERE m.status = 'active' AND m.user_id <> ? LIMIT 1", user.id);
  const other = await post("/api/admin/provision-first-lab", { ...body, userId: existingOwner.user_id });
  check("4. a second call 409; a user who already has a lab 409", again.status === 409 && other.status === 409, `${again.status} ${other.status}`);

  const H = { Authorization: `Bearer ${jwt.sign({ svc: true, userId: user.id }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(labId) };
  const maps = await fetch(`${B}/api/veritamap/maps`, { headers: H });
  const mj = await maps.json();
  check("5a. as the user, the lab's map list shows the adopted map", maps.status === 200 && Array.isArray(mj) && mj.some((x) => x.name === "Pre-lab map"), `${maps.status} ${JSON.stringify(mj).slice(0, 200)}`);
  // The inputs of an existing completed correlation study in the backup, saved in the new lab as the user.
  const src = one("SELECT * FROM studies WHERE status <> 'draft' AND study_type = 'method_comparison' ORDER BY id DESC LIMIT 1");
  const st = await post(`/api/labs/${labId}/studies`, {
    testName: src.test_name, instrument: src.instrument, analyst: src.analyst, date: src.date, studyType: src.study_type,
    cliaAllowableError: src.clia_allowable_error, dataPoints: src.data_points, instruments: src.instruments, status: "completed",
    teaIsPercentage: src.tea_is_percentage, teaUnit: src.tea_unit, createdAt: new Date().toISOString(),
  }, H);
  const stj = await st.json().catch(() => ({}));
  const credits = one("SELECT study_credits FROM users WHERE id = ?", user.id).study_credits;
  const saved = stj.id ? one("SELECT lab_id FROM studies WHERE id = ?", stj.id) : null;
  check("5b. as the user, a correlation study saves in the lab and no free study credit is spent",
    (st.status === 200 || st.status === 201) && !stj.code && saved?.lab_id === labId && credits === 2, `${st.status} ${JSON.stringify(stj).slice(0, 200)} credits=${credits}`);
} finally {
  child.kill();
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
