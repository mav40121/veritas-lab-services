// tests/integration/lab-scoped-readiness-attestation.test.ts
//
// Receipt for BUG-033 and BUG-034 (2026-10-11, found on the St. Charles demo dry run).
//   BUG-033: Inspection Readiness counted certificates by the lab OWNER's user_id, so an owner of
//   two labs saw the other lab's expired certificate on this lab, and this lab's certificates filed
//   under another user were left out. Now by lab_id, the way VeritaLab lists them.
//   BUG-034: VeritaDC Compliance "Attestation rates per staff" (page and xlsx) counted a member's
//   attestations in every lab, and a member with none showed 1 pending (the empty join row). Now:
//   this lab's current (non-archived) policies only, the same filter as Pending my attestations.
// Boots the REAL routes on a scratch DB. Run (from bash):
//   DB_PATH=.tmp-lsra.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/lab-scoped-readiness-attestation.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { default: ExcelJS } = await import("exceljs");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const stamp = Date.now();
  const reg = async (tag: string) => (await call("POST", "/api/auth/register", { email: `lsra-${tag}-${stamp}@example.com`, password: "Testpass123", name: `LSRA ${tag}`, hipaa_acknowledged: true })).j;
  const owner = await reg("owner"), member = await reg("member"), quiet = await reg("quiet");
  const prov = async (name: string) => (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `lsra-owner-${stamp}@example.com`, labName: name, plan: "hospital" })).j.labId;
  const labA = await prov("Readiness Lab A"), labB = await prov("Readiness Lab B");
  const ownerId = owner.user.id, memberId = member.user.id, quietId = quiet.user.id;
  const now = new Date().toISOString();
  const addMember = sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, ?, ?, ?)");
  addMember.run(labA, memberId, now, now, now); addMember.run(labB, memberId, now, now, now); addMember.run(labA, quietId, now, now, now);
  check("fixture: one owner, two labs, a member in both, a quiet member in A", !!labA && !!labB && labA !== labB);

  // ---- BUG-033: certificates
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const cert = sqlite.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_name, expiration_date, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)");
  cert.run(ownerId, labB, "cola", "Lab B accreditation (expired)", day(-30), now, now);
  cert.run(memberId, labA, "clia", "Lab A CLIA (filed under the member)", day(400), now, now);
  cert.run(ownerId, labA, "state", "Lab A state license (due soon)", day(30), now, now);
  const rd = await call("GET", `/api/labs/${labA}/readiness`, undefined, owner.token);
  const certMod = (rd.j?.modules || rd.j?.lab?.modules || []).find((m: any) => m.key === "certificates");
  check("1. lab A readiness counts lab A's 2 certificates (incl. the one filed under the member), not lab B's expired one",
    rd.s === 200 && certMod?.total === 2 && certMod?.overdue === 0 && certMod?.due_soon === 1, `${rd.s} ${JSON.stringify(certMod ?? rd.j).slice(0, 220)}`);
  const rdB = await call("GET", `/api/labs/${labB}/readiness`, undefined, owner.token);
  const certB = (rdB.j?.modules || rdB.j?.lab?.modules || []).find((m: any) => m.key === "certificates");
  check("2. lab B readiness shows its own expired certificate", certB?.total === 1 && certB?.overdue === 1, JSON.stringify(certB));

  // ---- BUG-034: attestation rates
  const manual = (lab: number) => Number(sqlite.prepare("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Test manual')").run(lab).lastInsertRowid);
  const doc = (lab: number, title: string, archived = false) => Number(sqlite.prepare(
    "INSERT INTO policy_documents (lab_id, manual_id, title, status, owner_user_id, archived_at) VALUES (?, ?, ?, 'approved', ?, ?)"
  ).run(lab, manual(lab), title, ownerId, archived ? now : null).lastInsertRowid);
  const attest = sqlite.prepare("INSERT INTO policy_attestations (document_id, version_id, assigned_to_user_id, assigned_by, completed_at) VALUES (?, 1, ?, ?, ?)");
  const docA = doc(labA, "Lab A policy"), docArchived = doc(labA, "Lab A retired policy", true), docB = doc(labB, "Lab B policy");
  attest.run(docA, memberId, ownerId, null);          // member: 1 pending in A
  attest.run(docArchived, memberId, ownerId, null);   // retired policy: not counted
  attest.run(docB, memberId, ownerId, now);           // member: completed in B, not counted in A
  attest.run(docB, ownerId, ownerId, now);            // owner: completed in B only
  const cp = await call("GET", `/api/labs/${labA}/veritapolicy/compliance`, undefined, owner.token);
  const row = (uid: number, email: string) => (cp.j?.perUserAttest || []).find((u: any) => u.user_id === uid || u.email === email);
  const m = row(memberId, member.user.email), o = row(ownerId, owner.user.email), q = row(quietId, quiet.user.email);
  check("3. member: 1 pending, 0 completed, total 1 on lab A (lab B and the retired policy left out)", cp.s === 200 && m?.pending === 1 && m?.completed === 0 && m?.total === 1, `${cp.s} ${JSON.stringify(m)}`);
  check("4. owner: lab B's completed attestation is not counted on lab A", o?.pending === 0 && o?.completed === 0 && o?.total === 0, JSON.stringify(o));
  check("5. a member with no attestations shows 0 pending (no phantom row)", q?.pending === 0 && q?.total === 0, JSON.stringify(q));

  const x = await fetch(`${base}/api/labs/${labA}/veritapolicy/compliance/xlsx`, { headers: { Authorization: `Bearer ${owner.token}` } });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
  const ws = wb.getWorksheet("Per User Attestations");
  const xrows: Record<string, number[]> = {};
  ws?.eachRow((r, i) => { if (i > 1) xrows[String(r.getCell(2).value)] = [3, 4, 5].map((c) => Number(r.getCell(c).value)); });
  check("6. xlsx export matches: member 1/0/1, owner 0/0/0, quiet 0/0/0",
    x.status === 200 && JSON.stringify(xrows[member.user.email]) === "[1,0,1]" && JSON.stringify(xrows[owner.user.email]) === "[0,0,0]" && JSON.stringify(xrows[quiet.user.email]) === "[0,0,0]",
    `${x.status} ${JSON.stringify(xrows)}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
