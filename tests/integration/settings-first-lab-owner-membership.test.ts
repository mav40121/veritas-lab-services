// tests/integration/settings-first-lab-owner-membership.test.ts
//
// Receipt for parking lot #83 (2026-10-07). A user who signs up without a CLIA
// gets their lab created the first time they save lab settings (accreditation,
// CLIA, lab name) on the account settings page. That path created the labs row
// but never the owner's lab_members row, and labScopeMiddleware admits only an
// active lab_members row, so the owner was locked out of their own lab from the
// first minute: the St. Charles owner (lab 31, 2026-09-18) and lab 20.
//
// 2026-10-14 (Michael, Q195 = 1): labs are created only by Veritas staff (admin provisioning), so the settings save
// no longer creates one, and the boot backfill covers only accounts made before 2026-10-14 19:00 UTC. Updated
// 2026-10-27 to that rule; the #83 point is kept: an owner is never locked out of their own lab.
//
// Boots the REAL routes on a scratch DB and proves:
//   1. a fresh signup without a CLIA owns no lab yet
//   2. that signup's first settings save is refused (LAB_SETUP_BY_STAFF) and creates no lab
//   3. staff provisioning (admin/provision-first-lab) gives the owner an active, primary 'owner' lab_members row
//   4. the owner can open a lab-scoped route (200, not 403 "No active membership")
//   5. the membership is audit-logged with source admin/provision-first-lab
//   6. a settings save (CLIA + lab name) then updates that lab: no second lab, no duplicate row
//   7. the boot-time backfill (server/db.ts) gives a pre-cutoff legacy account its lab AND the owner row, and makes
//      no lab for an account created after the cutoff (runs a second process on the same DB)
//
// Run (Windows, from bash): DB_PATH=.tmp-slom.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/settings-first-lab-owner-membership.test.ts
import http from "node:http";
import express from "express";
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  // 1. fresh signup, no CLIA
  const email = `slom-${Date.now()}@example.com`;
  const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "SLOM Owner", hipaa_acknowledged: true }));
  const token = reg.token as string;
  const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const ownedBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(userId) as any).n;
  check("1. fresh signup without a CLIA owns no lab", !!token && userId > 0 && ownedBefore === 0, `user=${userId} owned=${ownedBefore}`);

  // 2. first settings save: accreditation only, the 9/18 sequence. Refused since Q195: staff set labs up.
  const r1 = await call("PUT", "/api/account/settings", { accreditation_choice: "TJC" }, token);
  const b1 = await j(r1);
  const labs1 = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(userId) as any).n;
  check("2. a signup's first settings save is refused and creates no lab", r1.status === 409 && b1.code === "LAB_SETUP_BY_STAFF" && labs1 === 0, `status=${r1.status} code=${b1.code} labs=${labs1}`);

  // Staff set the lab up.
  const prov = await call("POST", "/api/admin/provision-first-lab", { secret: process.env.ADMIN_SECRET, userId, labName: "SLOM Lab", accreditationBody: "TJC", plan: "clinic", expiresAt: "2027-12-31T00:00:00.000Z" });
  const provBody = await j(prov);
  const labId = Number(provBody.lab?.id) || (sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ?").get(userId) as any)?.id;
  check("2b. staff provisioning creates the lab", prov.status === 200 && labId > 0, `status=${prov.status} ${JSON.stringify(provBody).slice(0, 160)}`);

  // 3. owner membership row
  const m = sqlite.prepare("SELECT role, status, is_primary_lab FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, userId) as any;
  check("3. owner has an active primary 'owner' lab_members row", !!m && m.role === "owner" && m.status === "active" && m.is_primary_lab === 1, JSON.stringify(m));

  // 4. a lab-scoped route admits the owner
  const scoped = await call("GET", `/api/labs/${labId}/studies`, undefined, token);
  const scopedBody = await j(scoped);
  check("4. owner opens a lab-scoped route (200, not 403)", scoped.status === 200, `status=${scoped.status} body=${JSON.stringify(scopedBody).slice(0, 120)}`);

  // 5. audit
  const aud = sqlite.prepare("SELECT action FROM audit_log WHERE module = 'lab_members' AND entity_label LIKE ? ORDER BY id DESC LIMIT 1").get(`${email}@%`) as any;
  check("5. membership creation is audit-logged as admin/provision-first-lab", !!aud && String(aud.action).includes("admin/provision-first-lab"), JSON.stringify(aud));

  // 6. a settings save after provisioning updates that lab
  const r2 = await call("PUT", "/api/account/settings", { clia_number: "38D9999999", clia_lab_name: "SLOM Lab" }, token);
  const labs2 = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(userId) as any).n;
  const rows2 = (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, userId) as any).n;
  check("6. a settings save (CLIA + name) updates the provisioned lab: one lab, one membership row", r2.status === 200 && labs2 === 1 && rows2 === 1, `status=${r2.status} labs=${labs2} rows=${rows2}`);

  // 7. boot backfill: a legacy user row (made before the 2026-10-14 cutoff) carrying CLIA fields and no lab_id gets a
  //    lab AND the owner row on the next boot; a user made after the cutoff gets none (Q195).
  const legacyCreated = "2026-10-01T12:00:00.000Z";
  const bfEmail = `slom-bf-${Date.now()}@example.com`;
  const bfId = Number(sqlite.prepare(
    "INSERT INTO users (email, password_hash, name, plan, study_credits, created_at, clia_number, clia_lab_name) VALUES (?, 'x', 'SLOM Backfill', 'free', 0, ?, ?, ?)"
  ).run(bfEmail, legacyCreated, "05D9999998", "SLOM Backfill Lab").lastInsertRowid);
  const newEmail = `slom-new-${Date.now()}@example.com`;
  const newId = Number(sqlite.prepare(
    "INSERT INTO users (email, password_hash, name, plan, study_credits, created_at, clia_number, clia_lab_name) VALUES (?, 'x', 'SLOM New', 'free', 0, ?, ?, ?)"
  ).run(newEmail, new Date().toISOString(), "05D9999997", "SLOM New Lab").lastInsertRowid);
  const bootScript = join(tmpdir(), `slom-boot-${Date.now()}.mts`);
  writeFileSync(
    bootScript,
    `import { createRequire } from "node:module";\n(globalThis as any).require ??= createRequire(import.meta.url);\nawait import(${JSON.stringify(pathToFileURL(resolve("server/db.ts")).href)});\nprocess.exit(0);\n`,
  );
  const boot = spawnSync(`npx tsx "${bootScript}"`, { shell: true, env: process.env, encoding: "utf-8", timeout: 180000 });
  rmSync(bootScript, { force: true });
  const bfLab = sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ?").get(bfId) as any;
  const bfRow = bfLab ? (sqlite.prepare("SELECT role, status FROM lab_members WHERE lab_id = ? AND user_id = ?").get(bfLab.id, bfId) as any) : null;
  check(
    "7. boot backfill creates the lab and the owner's active row",
    boot.status === 0 && !!bfLab && !!bfRow && bfRow.role === "owner" && bfRow.status === "active",
    `exit=${boot.status} lab=${JSON.stringify(bfLab)} row=${JSON.stringify(bfRow)} ${boot.status !== 0 ? (boot.stderr || "").slice(-400) : ""}`,
  );
  const newLab = sqlite.prepare("SELECT id FROM labs WHERE owner_user_id = ?").get(newId) as any;
  check("7b. the boot backfill makes no lab for an account created after the cutoff", boot.status === 0 && !newLab, JSON.stringify(newLab));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
