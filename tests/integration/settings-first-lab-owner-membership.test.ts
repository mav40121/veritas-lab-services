// tests/integration/settings-first-lab-owner-membership.test.ts
//
// Receipt for parking lot #83 (2026-10-07). A user who signs up without a CLIA
// gets their lab created the first time they save lab settings (accreditation,
// CLIA, lab name) on the account settings page. That path created the labs row
// but never the owner's lab_members row, and labScopeMiddleware admits only an
// active lab_members row, so the owner was locked out of their own lab from the
// first minute: the St. Charles owner (lab 31, 2026-09-18) and lab 20.
//
// Boots the REAL routes on a scratch DB and proves:
//   1. a fresh signup without a CLIA owns no lab yet
//   2. the first settings save (accreditation TJC, as on 9/18) creates the lab
//   3. the owner gets an active, primary 'owner' lab_members row on it
//   4. the owner can open a lab-scoped route (200, not 403 "No active membership")
//   5. the membership is audit-logged with source account/settings:first-lab
//   6. a second save (CLIA + lab name) reuses that lab: no second lab, no duplicate row
//   7. the boot-time backfill (server/db.ts) that creates a lab from a user's CLIA
//      fields also gives that user the owner row (runs a second process on the same DB)
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
  const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: "SLOM Owner", hipaa_acknowledged: true }));
  const token = reg.token as string;
  const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const ownedBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(userId) as any).n;
  check("1. fresh signup without a CLIA owns no lab", !!token && userId > 0 && ownedBefore === 0, `user=${userId} owned=${ownedBefore}`);

  // 2. first settings save: accreditation only, the 9/18 sequence
  const r1 = await call("PUT", "/api/account/settings", { accreditation_choice: "TJC" }, token);
  const labs1 = sqlite.prepare("SELECT id, accreditation_tjc FROM labs WHERE owner_user_id = ?").all(userId) as any[];
  const labId = labs1[0]?.id;
  check("2. first settings save creates the owner's lab", r1.status === 200 && labs1.length === 1 && labs1[0].accreditation_tjc === 1, `status=${r1.status} labs=${JSON.stringify(labs1)}`);

  // 3. owner membership row
  const m = sqlite.prepare("SELECT role, status, is_primary_lab FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, userId) as any;
  check("3. owner has an active primary 'owner' lab_members row", !!m && m.role === "owner" && m.status === "active" && m.is_primary_lab === 1, JSON.stringify(m));

  // 4. a lab-scoped route admits the owner
  const scoped = await call("GET", `/api/labs/${labId}/studies`, undefined, token);
  const scopedBody = await j(scoped);
  check("4. owner opens a lab-scoped route (200, not 403)", scoped.status === 200, `status=${scoped.status} body=${JSON.stringify(scopedBody).slice(0, 120)}`);

  // 5. audit
  const aud = sqlite.prepare("SELECT action FROM audit_log WHERE module = 'lab_members' AND entity_label LIKE ? ORDER BY id DESC LIMIT 1").get(`${email}@%`) as any;
  check("5. membership creation is audit-logged as account/settings:first-lab", !!aud && String(aud.action).includes("account/settings:first-lab"), JSON.stringify(aud));

  // 6. second save reuses the lab
  const r2 = await call("PUT", "/api/account/settings", { clia_number: "38D9999999", clia_lab_name: "SLOM Lab" }, token);
  const labs2 = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(userId) as any).n;
  const rows2 = (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, userId) as any).n;
  check("6. second save (CLIA + name) reuses the lab: one lab, one membership row", r2.status === 200 && labs2 === 1 && rows2 === 1, `status=${r2.status} labs=${labs2} rows=${rows2}`);

  // 7. boot backfill: a user row carrying CLIA fields and no lab_id gets a lab AND the owner row on the next boot
  const now = new Date().toISOString();
  const bfEmail = `slom-bf-${Date.now()}@example.com`;
  const bfId = Number(sqlite.prepare(
    "INSERT INTO users (email, password_hash, name, plan, study_credits, created_at, clia_number, clia_lab_name) VALUES (?, 'x', 'SLOM Backfill', 'free', 0, ?, ?, ?)"
  ).run(bfEmail, now, "05D9999998", "SLOM Backfill Lab").lastInsertRowid);
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

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
