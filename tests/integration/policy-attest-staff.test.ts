// tests/integration/policy-attest-staff.test.ts
//
// Receipt for BUG-079 (2026-10-27): VeritaPolicy's in-app Attest showed for view-only staff, and the server refused them
// (the complete route required VeritaPolicy edit). Signing one's own assigned policy is operational work any active
// member may do (access model, PR #1435), and it is what staff seats are for.
//   1. a staff member (no edit seat) completes their own assigned attestation (200) and it is recorded
//   2. they cannot complete someone else's attestation (403)
//   3. a wrong password still records nothing (401)
//   4. staff still cannot do setup in VeritaPolicy (assigning attestations stays owner/admin/edit)
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:policy-attest-staff
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
  const PW = ["Att", "st", "7x!"].join("-");
  const register = async (tag: string) => {
    const email = `att-${tag}-${Date.now()}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, name: `Att ${tag}`, hipaa_acknowledged: true }) }));
    return { email, userId: Number(reg.user?.id), token: reg.token as string };
  };
  const owner = await register("owner");
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: owner.email, labName: "Attest Lab", plan: "hospital" }) }))).labId);
  const staff = await register("staff");
  const other = await register("other");
  const now = new Date().toISOString();
  for (const u of [staff, other]) {
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, u.userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, u.userId);
  }
  // Made-up approved policy with one version, assigned to the staff member and to the other member.
  const docId = Number(sqlite.prepare("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, created_at, updated_at) VALUES (?, 'Specimen Rejection', ?, 'approved', ?, ?)").run(labId, owner.userId, now, now).lastInsertRowid);
  const verId = Number(sqlite.prepare("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, 1, 'x.pdf', 'pdf', 1, 'abc123', ?)").run(docId, owner.userId).lastInsertRowid);
  sqlite.prepare("UPDATE policy_documents SET current_version_id = ? WHERE id = ?").run(verId, docId);
  const mkAtt = (userId: number) => Number(sqlite.prepare("INSERT INTO policy_attestations (document_id, version_id, assigned_to_user_id, assigned_by) VALUES (?, ?, ?, ?)").run(docId, verId, userId, owner.userId).lastInsertRowid);
  const attStaff = mkAtt(staff.userId), attOther = mkAtt(other.userId);
  // Fresh staff session (registration's token is fine; one-session rule allows it).
  const H = (u: any) => ({ "Content-Type": "application/json", Authorization: `Bearer ${u.token}`, "X-Active-Lab-Id": String(labId) });
  const complete = (u: any, id: number, password: string) => fetch(`${base}/api/labs/${labId}/veritapolicy/attestations/${id}/complete`, { method: "POST", headers: H(u), body: JSON.stringify({ typedSignature: "Made-Up Staff", password }) });

  const wrong = await complete(staff, attStaff, "not-the-password");
  check("3. a wrong password records nothing (401)", wrong.status === 401 && !(sqlite.prepare("SELECT completed_at FROM policy_attestations WHERE id = ?").get(attStaff) as any).completed_at, `status=${wrong.status}`);
  const r1 = await complete(staff, attStaff, PW);
  const row1 = sqlite.prepare("SELECT completed_at, typed_signature FROM policy_attestations WHERE id = ?").get(attStaff) as any;
  check("1. a staff member completes their own assigned attestation", r1.status === 200 && !!row1.completed_at && row1.typed_signature === "Made-Up Staff", `status=${r1.status} ${JSON.stringify(await j(r1)).slice(0, 120)}`);
  const r2 = await complete(staff, attOther, PW);
  check("2. they cannot complete someone else's attestation (403)", r2.status === 403 && !(sqlite.prepare("SELECT completed_at FROM policy_attestations WHERE id = ?").get(attOther) as any).completed_at, `status=${r2.status}`);
  const assign = await fetch(`${base}/api/labs/${labId}/veritapolicy/documents/${docId}/attestations`, { method: "POST", headers: H(staff), body: JSON.stringify({ userIds: [other.userId] }) });
  check("4. staff still cannot assign attestations (setup stays gated)", assign.status === 403, `status=${assign.status}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
