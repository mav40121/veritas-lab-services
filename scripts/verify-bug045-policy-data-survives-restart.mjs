// scripts/verify-bug045-policy-data-survives-restart.mjs
//
// BUG-045 receipt: VeritaPolicy data must survive a server restart for an owner who holds a seat in their own pool
// (production "seat 102 -> owner 102", Redington lab 34) and for a seat user who also owns a lab ("seat 17 -> owner
// 81"). The removed startup backfill deleted those rows by user_id on every boot. LOCAL scratch DB only.
//   1. setup: self-seated owner A with a lab, a house-format settings row and 3 master-list statuses (real routes);
//      user B who owns lab B (settings row + 1 status) and also holds an active seat in A's pool
//   2. restart the server (a boot is what deleted the rows)
//   3. A's settings row, A's docx_format and A's 3 statuses are all still there
//   4. B's own lab settings row and status are still there
// Run: DIST=<repo>/dist/index.cjs SCRATCH_DB=<db> PORT=5167 node scripts/verify-bug045-policy-data-survives-restart.mjs
// On the pre-fix build, checks 3-4 FAIL (the boot deletes the rows); on the fix they PASS.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { DIST, SCRATCH_DB } = process.env, PORT = process.env.PORT || "5167", BASE = `http://localhost:${PORT}`, ADMIN = "test-admin-secret";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const env = { ...process.env, DB_PATH: SCRATCH_DB, JWT_SECRET: "localqasecret", ADMIN_SECRET: ADMIN, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy", PORT, NODE_ENV: "production" };
const boot = async (tag) => {
  const log = fs.openSync(`${SCRATCH_DB}.${tag}.log`, "w");
  const p = spawn(process.execPath, [DIST], { env, stdio: ["ignore", log, log] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  await new Promise((r) => setTimeout(r, 4000)); // startup jobs run around listen
  return p;
};
const stop = (p) => new Promise((r) => { p.on("exit", r); p.kill(); });
for (const f of [SCRATCH_DB, `${SCRATCH_DB}-wal`, `${SCRATCH_DB}-shm`]) { try { fs.unlinkSync(f); } catch {} }

let server = await boot("boot1");
const reg = async (who) => { const email = `${who}-${Date.now()}@example.com`; const u = await call("POST", "/api/auth/register", { email, password: "testpass123", name: who, hipaa_acknowledged: true }); const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `${who} Lab`, plan: "hospital" })).labId; return { email, token: u.token, id: u.user?.id ?? u.id, labId }; };
const A = await reg("ownerA"), B = await reg("ownerB");
let db = new Database(SCRATCH_DB);
for (const u of [A, B]) {
  db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(u.email);
  u.id = u.id ?? db.prepare("SELECT id FROM users WHERE email = ?").get(u.email).id;
}
// A holds a seat in A's own pool; B holds a seat in A's pool (B also owns lab B).
const seat = db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, lab_id, invited_at, accepted_at) VALUES (?, ?, ?, 'active', ?, datetime('now'), datetime('now'))");
seat.run(A.id, A.email, A.id, A.labId);
seat.run(A.id, B.email, B.id, A.labId);
db.close();
const hf = await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: A.labId, format: "redington_fairview" });
check("1. A: house-format settings row written", hf.status === 200 && hf.ok, JSON.stringify(hf.after || hf).slice(0, 120));
for (const pid of ["69", "72", "1"]) {
  const r = await call("PATCH", `/api/labs/${A.labId}/veritapolicy/master-list/${pid}`, { is_na: true, na_reason: "Service not offered (test fixture)" }, A.token);
  check(`1. A: master-list ${pid} saved`, r.status === 200, String(r.status));
}
const hfB = await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: B.labId, format: "umass_milford" });
const rB = await call("PATCH", `/api/labs/${B.labId}/veritapolicy/master-list/5`, { is_na: true, na_reason: "test fixture" }, B.token);
check("1. B: own-lab settings row and a status written", hfB.status === 200 && rB.status === 200);
db = new Database(SCRATCH_DB, { readonly: true });
const snap = (q, ...a) => db.prepare(q).get(...a).n;
const beforeA = { s: snap("SELECT COUNT(*) n FROM veritapolicy_settings WHERE lab_id = ?", A.labId), m: snap("SELECT COUNT(*) n FROM veritapolicy_master_status WHERE lab_id = ?", A.labId) };
const beforeB = { s: snap("SELECT COUNT(*) n FROM veritapolicy_settings WHERE lab_id = ?", B.labId), m: snap("SELECT COUNT(*) n FROM veritapolicy_master_status WHERE lab_id = ?", B.labId) };
db.close();
console.log("before restart:", JSON.stringify({ A: beforeA, B: beforeB }));

await stop(server);
server = await boot("boot2");
db = new Database(SCRATCH_DB, { readonly: true });
const aS = db.prepare("SELECT docx_format FROM veritapolicy_settings WHERE lab_id = ?").get(A.labId);
const aM = snap("SELECT COUNT(*) n FROM veritapolicy_master_status WHERE lab_id = ?", A.labId);
const bS = snap("SELECT COUNT(*) n FROM veritapolicy_settings WHERE lab_id = ?", B.labId);
const bM = snap("SELECT COUNT(*) n FROM veritapolicy_master_status WHERE lab_id = ?", B.labId);
db.close();
const bootLog = fs.readFileSync(`${SCRATCH_DB}.boot2.log`, "utf8").split("\n").filter((l) => /backfill-veritapolicy/.test(l));
console.log("boot2 backfill log:", bootLog.length ? bootLog.join(" | ").slice(0, 300) : "(none)");
check("3. A (self-seated owner): settings row survives the restart, still redington_fairview", aS?.docx_format === "redington_fairview", JSON.stringify(aS));
check("3. A: all master-list statuses survive the restart", aM === beforeA.m && aM >= 3, `${beforeA.m} -> ${aM}`);
check("4. B (seat elsewhere, owns a lab): own lab's settings and status survive", bS === beforeB.s && bS === 1 && bM === beforeB.m, `settings ${beforeB.s} -> ${bS}, statuses ${beforeB.m} -> ${bM}`);
await stop(server);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
