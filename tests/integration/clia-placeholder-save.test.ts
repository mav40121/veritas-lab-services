// tests/integration/clia-placeholder-save.test.ts
//
// Receipt for 2026-10-21 (Michael, UNC Health Nash lab 21): "I thought we had stopped blocking functionality while
// the CLIA number was pending?" Lab 21 holds the placeholder "PENDING-UNCNASH-2026". Every card on the account
// settings page sends the whole form, so picking CAP + AABB and pressing Save re-sent the placeholder and the CLIA
// format check refused the save ("Must be 10 characters: 2 digits, then 'D', then 7 digits.").
//
// Boots the REAL routes on a scratch DB and proves:
//   1. placeholder on file + accreditation change saves (200), accreditation written, placeholder untouched
//   2. a second save carrying the placeholder (PT vendor card) also saves
//   3. a newly typed malformed CLIA is still refused (400, format hint) and nothing is written
//   4. a newly typed valid CLIA saves, normalized (spaces/dash stripped, uppercased)
//   5. re-sending the real CLIA on file saves with no audit entry for clia_number
//   6. a blank CLIA still clears the field
//   7. a LOCKED lab: re-sending its CLIA saves (no 403); a different CLIA is still refused (403)
//   8. support (admin/update-lab) can replace a LOCKED placeholder with the real CLIA once; a locked real CLIA is still
//      refused (409) (2026-10-27, lab 18 "PENDING-GEORGETOWN-LPNT")
//
// Run (Windows, from bash): rm -f .tmp-clia-placeholder.db && DB_PATH=.tmp-clia-placeholder.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/clia-placeholder-save.test.ts
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

  const email = `clia-ph-${Date.now()}@example.com`;
  const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Testpass123", name: "Placeholder Owner", hipaa_acknowledged: true }) }));
  const token = reg.token as string;
  const userId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const now = new Date().toISOString();
  const PLACEHOLDER = "PENDING-TESTLAB-2026";
  const mkLab = (name: string, clia: string | null, locked: number) => {
    const id = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, clia_locked, owner_user_id, plan, created_at, updated_at) VALUES (?, ?, ?, ?, 'community', ?, ?)")
      .run(name, clia, locked, userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','active',0,?,?,?)").run(id, userId, now, now, now);
    return id;
  };
  const labId = mkLab("Placeholder Test Lab", PLACEHOLDER, 0);
  const save = (lab: number, body: Record<string, unknown>) => fetch(base + "/api/account/settings", {
    method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(lab) }, body: JSON.stringify(body) });
  const row = (lab: number) => sqlite.prepare("SELECT clia_number, accreditation_cap, accreditation_aabb, accreditation_tjc FROM labs WHERE id = ?").get(lab) as any;
  const cliaAudits = (lab: number) => (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_audit_log WHERE lab_id = ? AND field_name = 'clia_number'").get(lab) as any)?.n ?? 0;
  const auditTable = !!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='lab_audit_log'").get();

  // 1. the 10/21 sequence: placeholder on file, pick CAP + AABB, Save
  const r1 = await save(labId, { clia_number: PLACEHOLDER, clia_lab_name: "Placeholder Test Lab", accreditation_choice: "CAP+AABB", preferredPtVendor: "none" });
  const b1 = await j(r1); const l1 = row(labId);
  check("1. placeholder on file + CAP+AABB saves (200)", r1.status === 200, `status=${r1.status} body=${JSON.stringify(b1).slice(0, 160)}`);
  check("1b. accreditation written, placeholder untouched", l1.accreditation_cap === 1 && l1.accreditation_aabb === 1 && l1.clia_number === PLACEHOLDER, JSON.stringify(l1));

  // 2. another card's Save (same whole-form body)
  const r2 = await save(labId, { clia_number: PLACEHOLDER, clia_lab_name: "Placeholder Test Lab", accreditation_choice: "TJC", preferredPtVendor: "none" });
  check("2. second save carrying the placeholder also saves", r2.status === 200 && row(labId).accreditation_tjc === 1, `status=${r2.status}`);

  // 3. a newly typed malformed CLIA is still refused
  const r3 = await save(labId, { clia_number: "12345", clia_lab_name: "Placeholder Test Lab", accreditation_choice: "CAP" });
  const b3 = await j(r3); const l3 = row(labId);
  check("3. newly typed malformed CLIA refused with the format hint", r3.status === 400 && /2 digits, then 'D'/.test(String(b3.error)), `status=${r3.status} error=${b3.error}`);
  check("3b. nothing written on the refused save", l3.clia_number === PLACEHOLDER && l3.accreditation_tjc === 1 && l3.accreditation_cap === 0, JSON.stringify(l3));

  // 4. a newly typed valid CLIA saves, normalized
  const r4 = await save(labId, { clia_number: "34d 123-4567", clia_lab_name: "Placeholder Test Lab", accreditation_choice: "CAP+AABB" });
  check("4. newly typed valid CLIA saves normalized (34D1234567)", r4.status === 200 && row(labId).clia_number === "34D1234567", `status=${r4.status} clia=${row(labId).clia_number}`);

  // 5. re-sending the real CLIA on file: saves, no new clia_number audit entry
  const before5 = auditTable ? cliaAudits(labId) : 0;
  const r5 = await save(labId, { clia_number: "34D1234567", clia_lab_name: "Placeholder Test Lab", accreditation_choice: "COLA" });
  const after5 = auditTable ? cliaAudits(labId) : 0;
  check("5. unchanged real CLIA saves with no clia_number audit entry", r5.status === 200 && row(labId).clia_number === "34D1234567" && after5 === before5,
    `status=${r5.status} audits ${before5}->${after5} (table ${auditTable ? "present" : "absent"})`);

  // 6. blank clears
  const r6 = await save(labId, { clia_number: "", clia_lab_name: "Placeholder Test Lab", accreditation_choice: "COLA" });
  check("6. blank CLIA clears the field", r6.status === 200 && row(labId).clia_number === null, `status=${r6.status} clia=${row(labId).clia_number}`);

  // 7. locked lab
  const locked = mkLab("Locked Test Lab", "22D0001111", 1);
  const r7 = await save(locked, { clia_number: "22D0001111", clia_lab_name: "Locked Test Lab", accreditation_choice: "TJC" });
  check("7. locked lab: re-sending its CLIA saves (no 403)", r7.status === 200 && row(locked).accreditation_tjc === 1, `status=${r7.status}`);
  const r7b = await save(locked, { clia_number: "22D0002222", clia_lab_name: "Locked Test Lab", accreditation_choice: "TJC" });
  check("7b. locked lab: a different CLIA is still refused (403)", r7b.status === 403 && row(locked).clia_number === "22D0001111", `status=${r7b.status}`);

  // 8. support corrects a locked placeholder
  const adminUpdate = async (labId: number, cliaNumber: string) => {
    const r = await fetch(`${base}/api/admin/update-lab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, labId, cliaNumber }) });
    let body: any = {}; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  };
  const lockedPh = mkLab("Locked Placeholder Lab", "PENDING-LOCKED-TEST", 1);
  const r8 = await adminUpdate(lockedPh, "18D0322357");
  check("8. support replaces a locked placeholder with the real CLIA", r8.status === 200 && row(lockedPh).clia_number === "18D0322357", `status=${r8.status} ${JSON.stringify(r8.body).slice(0, 160)}`);
  const r8b = await adminUpdate(lockedPh, "18D0000001");
  check("8b. once real, it is locked again (409)", r8b.status === 409 && row(lockedPh).clia_number === "18D0322357", `status=${r8b.status}`);
  const r8c = await adminUpdate(locked, "22D0003333");
  check("8c. a locked real CLIA is still refused through support (409)", r8c.status === 409 && row(locked).clia_number === "22D0001111", `status=${r8c.status}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
