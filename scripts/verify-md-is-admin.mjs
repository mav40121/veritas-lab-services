// scripts/verify-md-is-admin.mjs
//
// A lab's medical director is an admin (Michael 2026-10-23, Heywood lab 38: "this should never happen. If he is the
// medical director then he is an admin"). Boots the built server on a COPY of a production backup (never written) and
// checks every way a person becomes a lab's medical director:
//   1. an owner's Medical Director invite is stored as an admin invitation
//   2. signing up from that invite lands the person as admin (not staff)
//   3. a plain staff invite still lands as staff
//   4. the owner naming an existing staff member as medical director raises them to admin; the former director keeps admin
//   5. the admin route naming a staff member as medical director raises them to admin
//   6. the one-time correction: dry run lists a staff-level director and changes nothing; the real run raises them; a
//      second dry run finds nothing; the owner is never touched
// Usage: node scripts/verify-md-is-admin.mjs <production-backup.db>   (after npm run build)
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
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5183, SECRET = "md-is-admin-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-md-is-admin.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "md-is-admin-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);

// Seed (copy only): three existing accounts with no lab, used as B, C and E below.
const stamp = Date.now(), now = new Date().toISOString();
const em = (k) => `md-admin-${k}-${stamp}@example.invalid`;
// Throwaway sign-up value for the copy database only, built at run time (meets the password rule: upper, lower, digit, symbol).
const signupPw = ["Tq", String(stamp).slice(-6), "z"].join("-") + "!";
{
  const w = new Database(dbPath);
  for (const k of ["b", "c", "d", "e"]) w.prepare("INSERT INTO users (email, password_hash, name, plan, study_credits, created_at) VALUES (?, 'x', ?, 'free', 2, ?)").run(em(k), `User ${k.toUpperCase()}`, now);
  w.close();
}
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; child.stdout.on("data", (d) => { log += d; }); child.stderr.on("data", (d) => { log += d; });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start; last log lines:\n" + log.split("\n").slice(-15).join("\n")); child.kill(); process.exit(2); }
const B = `http://localhost:${PORT}`;
const post = (url, body, headers = {}, method = "POST") => fetch(B + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const one = (sql, ...a) => { const d = new Database(dbPath, { readonly: true }); const r = d.prepare(sql).get(...a); d.close(); return r; };
const roleOf = (labId, email) => one("SELECT lm.role FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? AND lower(u.email) = lower(?)", labId, email)?.role ?? null;

try {
  // A fresh owner and lab to work in.
  const prov = await post("/api/admin/provision-owner-lab", { secret: SECRET, ownerEmail: em("owner"), ownerName: "MD Admin Owner", labName: `MD Admin Lab ${stamp}`, plan: "hospital" });
  const pj = await prov.json();
  const labId = pj.lab_id, ownerId = pj.owner_user_id;
  if (prov.status !== 200 || !labId) throw new Error("provision failed " + prov.status + " " + JSON.stringify(pj));
  const H = { Authorization: `Bearer ${jwt.sign({ svc: true, userId: ownerId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(labId) };

  // 1-2. Medical Director invite to a person with no account, then sign-up from it.
  const inv = await post(`/api/labs/${labId}/members`, { email: em("a"), role: "medical_director", seatType: "active", firstName: "Ada", lastName: "Director" }, H);
  const seat = one("SELECT invite_role, invite_token FROM user_seats WHERE lab_id = ? AND lower(seat_email) = lower(?)", labId, em("a"));
  check("1. a Medical Director invite is stored as an admin invitation", inv.status === 200 && seat?.invite_role === "admin", `${inv.status} ${JSON.stringify(seat && { invite_role: seat.invite_role })}`);
  const reg = await post("/api/auth/register", { email: em("a"), password: signupPw, name: "Ada Director", hipaa_acknowledged: true, inviteToken: seat?.invite_token });
  check("2. signing up from the Medical Director invite lands as admin", (reg.status === 200 || reg.status === 201) && roleOf(labId, em("a")) === "admin", `${reg.status} role=${roleOf(labId, em("a"))} ${reg.status >= 300 ? (await reg.text()).slice(0, 160) : ""}`);

  // 3. A plain staff invite to an existing account stays staff.
  const s3 = await post(`/api/labs/${labId}/members`, { email: em("b"), role: "staff", seatType: "active", firstName: "Bea", lastName: "Staff" }, H);
  check("3. a plain staff invite still lands as staff", s3.status === 200 && roleOf(labId, em("b")) === "staff", `${s3.status} role=${roleOf(labId, em("b"))}`);

  // 4. The owner names that staff member medical director.
  const s4 = await post(`/api/labs/${labId}/medical-director`, { email: em("b"), name: "Bea Staff" }, H, "PUT");
  check("4. naming an existing staff member medical director raises them to admin; the former director keeps admin",
    s4.status === 200 && roleOf(labId, em("b")) === "admin" && roleOf(labId, em("a")) === "admin", `${s4.status} b=${roleOf(labId, em("b"))} a=${roleOf(labId, em("a"))}`);

  // 5. The admin route names another staff member medical director.
  const uc = one("SELECT id FROM users WHERE email = ?", em("c"));
  await post("/api/admin/add-lab-membership", { secret: SECRET, userId: uc.id, labId, role: "staff" });
  const before5 = roleOf(labId, em("c"));
  const s5 = await post("/api/admin/set-lab-medical-director", { secret: SECRET, labId, email: em("c"), name: "Cy" });
  const s5j = await s5.json();
  check("5. the admin route naming a staff member medical director raises them to admin", before5 === "staff" && s5.status === 200 && roleOf(labId, em("c")) === "admin" && s5j.promoted?.members === 1, `before=${before5} ${s5.status} after=${roleOf(labId, em("c"))} ${JSON.stringify(s5j.promoted)}`);

  // 6. One-time correction: a staff-level director written straight into the database (as old data would be).
  const ud = one("SELECT id FROM users WHERE email = ?", em("d"));
  { const w = new Database(dbPath); w.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)").run(labId, ud.id, now, now, now); w.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(em("d").toUpperCase(), labId); w.close(); }
  const dry = await (await post("/api/admin/promote-medical-directors", { secret: SECRET })).json();
  const mine = (dry.changes || []).find((c) => c.labId === labId);
  check("6a. dry run lists the staff-level director (case-insensitive email) and changes nothing", dry.dryRun === true && mine?.members?.length === 1 && roleOf(labId, em("d")) === "staff", JSON.stringify(mine));
  const real = await (await post("/api/admin/promote-medical-directors", { secret: SECRET, dryRun: false })).json();
  check("6b. the real run raises them to admin", real.dryRun === false && roleOf(labId, em("d")) === "admin", `${roleOf(labId, em("d"))}`);
  const again = await (await post("/api/admin/promote-medical-directors", { secret: SECRET })).json();
  check("6c. a second dry run finds nothing on this lab; the owner is still owner",
    !(again.changes || []).some((c) => c.labId === labId) && one("SELECT role FROM lab_members WHERE lab_id = ? AND user_id = ?", labId, ownerId)?.role === "owner", JSON.stringify((again.changes || []).find((c) => c.labId === labId)));
  // A member who is not the director stays staff.
  const s7 = await post(`/api/labs/${labId}/members`, { email: em("e"), role: "staff", seatType: "active", firstName: "Eve", lastName: "Staff" }, H);
  check("7. a staff member who is not the director stays staff", s7.status === 200 && roleOf(labId, em("e")) === "staff", `${s7.status} ${roleOf(labId, em("e"))}`);
} catch (e) {
  console.error("ERROR", e.message); fails++;
} finally {
  child.kill();
}
console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
