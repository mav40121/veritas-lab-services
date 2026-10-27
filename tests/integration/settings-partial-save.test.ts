// tests/integration/settings-partial-save.test.ts
//
// Receipt for 2026-10-27: an Account Settings save that LEAVES OUT a field keeps it. Before, PUT /api/account/settings
// without clia_number wrote NULL over the lab's CLIA (every report header prints it), without clia_lab_name blanked the
// lab name, and without preferredPtVendor reset the PT vendor to "none". The page sends the whole form, so this bit
// API callers and any partial client; it was seen while writing the ISO test (2026-10-26).
//
// Boots the REAL routes on a scratch DB (made-up rows only) and proves:
//   1. a save with only the accreditation keeps the CLIA, the lab name and the PT vendor
//   2. a save with only the time zone keeps them too
//   3. a blank CLIA and a blank lab name still clear them on purpose
//   4. the whole form (what the page sends) still updates every field
//
// Run: npm run test:settings-partial-save
import http from "node:http";
import express from "express";
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
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const email = `partial-${Date.now()}@example.com`;
  const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Testpass123", name: "Partial Save Owner", hipaa_acknowledged: true }) }));
  const token = reg.token as string;
  const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const now = new Date().toISOString();
  const labId = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, clia_locked, owner_user_id, plan, accreditation_cap, created_at, updated_at) VALUES ('Partial Save Lab', '22D7771234', 0, ?, 'community', 1, ?, ?)")
    .run(userId, now, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','active',1,?,?,?)").run(labId, userId, now, now, now);
  sqlite.prepare("UPDATE users SET preferred_pt_vendor = 'cap' WHERE id = ?").run(userId);

  const save = (body: Record<string, unknown>) => fetch(base + "/api/account/settings", {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) }, body: JSON.stringify(body) });
  const lab = () => sqlite.prepare("SELECT clia_number, lab_name, accreditation_cap, accreditation_tjc, time_zone FROM labs WHERE id = ?").get(labId) as any;
  const vendor = () => (sqlite.prepare("SELECT preferred_pt_vendor FROM users WHERE id = ?").get(userId) as any)?.preferred_pt_vendor;

  // 1. accreditation only
  const r1 = await save({ accreditation_choice: "TJC" });
  const l1 = lab();
  check("1. accreditation-only save keeps the CLIA, lab name and PT vendor", r1.status === 200 && l1.clia_number === "22D7771234" && l1.lab_name === "Partial Save Lab" && l1.accreditation_tjc === 1 && vendor() === "cap",
    `status=${r1.status} ${JSON.stringify(l1)} vendor=${vendor()}`);

  // 2. time zone only
  const r2 = await save({ time_zone: "America/Chicago" });
  const l2 = lab();
  check("2. time-zone-only save keeps them too", r2.status === 200 && l2.clia_number === "22D7771234" && l2.lab_name === "Partial Save Lab" && l2.time_zone === "America/Chicago" && l2.accreditation_tjc === 1 && vendor() === "cap",
    `status=${r2.status} ${JSON.stringify(l2)} vendor=${vendor()}`);

  // 4 (before 3, so the clears come last). The whole form updates every field.
  const r4 = await save({ clia_number: "22D7775678", clia_lab_name: "Partial Save Lab Renamed", accreditation_choice: "CAP", preferredPtVendor: "api", time_zone: "auto" });
  const l4 = lab();
  check("4. the whole form still updates every field", r4.status === 200 && l4.clia_number === "22D7775678" && l4.lab_name === "Partial Save Lab Renamed" && l4.accreditation_cap === 1 && l4.accreditation_tjc === 0 && l4.time_zone === null && vendor() === "api",
    `status=${r4.status} ${JSON.stringify(l4)} vendor=${vendor()}`);

  // 3. blanks clear on purpose
  const r3 = await save({ clia_number: "", clia_lab_name: "" });
  const l3 = lab();
  check("3. a blank CLIA and a blank lab name still clear them", r3.status === 200 && l3.clia_number === null && l3.lab_name === null && vendor() === "api",
    `status=${r3.status} ${JSON.stringify(l3)} vendor=${vendor()}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
