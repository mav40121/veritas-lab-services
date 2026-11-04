// tests/integration/veritadc-minor-revisions.test.ts
//
// VeritaDC minor revisions (Michael 2026-11-03, Q154 = 1; server/policyMinorRevision.ts). Each lab chooses between staff
// signing again on every new version (the default, today's behavior) and signatures carrying forward across minor
// revisions. Boots the REAL routes on a scratch DB and pins:
//   1. boot adds labs.dc_minor_revision_carry_forward; the default is re-sign
//   2. DEFAULT lab: a staff signature on 1.0 no longer counts on 1.1 (the staff list asks again), and a writer attestation
//      on 1.0 shows stale on 1.1
//   3. the setting: must be true/false; a change is audited from/to; another lab is untouched and can't change this one
//   4. CARRY-FORWARD lab: the same signature counts on 1.1, the staff list says it was carried and from which version, and
//      the writer attestation isn't stale in the tracker, the pending list or the signature tracker
//   5. never across a major revision: on 2.0 the staff list asks again and the attestation is stale, carry-forward or not
//   6. after signing 2.0, a 2.1 carries from 2.0 (the label says 2.0, not 1.0)
//   7. turning the setting back to re-sign applies at once
// Every lab, person and document here is made up; the database and policy storage are scratch folders.
// Run: npm run test:veritadc-minor-revisions

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `minorrev-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Rev ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Rev Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const upload = async (L: { token: string; labId: number }, fields: Record<string, string>, p = `/api/labs/${L.labId}/veritapolicy/documents`) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const cols = (sqlite.prepare("PRAGMA table_info(labs)").all() as any[]).map((c) => c.name);
    check("1. boot adds labs.dc_minor_revision_carry_forward", cols.includes("dc_minor_revision_carry_forward"));
    const A = await mkLab("A");
    const B = await mkLab("B");
    const S = (L = A) => `/api/labs/${L.labId}/veritapolicy/settings/minor-revisions`;
    const def = await call("GET", S(), undefined, A.token);
    check("1. the default is re-sign", def.status === 200 && def.body.carryForward === false, JSON.stringify(def.body));

    // A made-up staff login on lab A
    const owner = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(A.labId) as any;
    const now = new Date().toISOString();
    const existingSl = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any;
    const sl = existingSl?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Rev Lab A', '22D0000098', ?, ?, ?)").run(owner.owner_user_id, A.labId, now, now).lastInsertRowid);
    const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, 'Example', 'Sam', 'active', ?, ?)").run(sl, owner.owner_user_id, now, now).lastInsertRowid);
    const staffEmail = `minorrev-staff-${Date.now()}@example.com`;
    const staffUid = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at, hipaa_acknowledged, hipaa_ack_source) VALUES (?, 'x', 'Sam Example', 'free', ?, 1, 'signup')").run(staffEmail, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(owner.owner_user_id, staffEmail, staffUid, A.labId, emp);
    const staffTok = issueSession(sqlite, staffUid, { headers: { "user-agent": "minor-rev-test" }, ip: "127.0.0.1" }).token;

    // A made-up document at 1.0, approved; the staff member signs, the owner attests
    const doc = await upload(A, { title: "Made-up critical results policy" });
    const id = doc.body.id as number;
    const D = `/api/labs/${A.labId}/veritapolicy/documents/${id}`;
    const approve = () => sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(id);
    approve();
    const staffRow = async () => ((await call("GET", `/api/staff-portal-session/policies?employee_id=${emp}`, undefined, staffTok)).body.policies || []).find((p: any) => p.document_id === id);
    const v10 = (await staffRow())?.version_id;
    const sign = await call("POST", `/api/staff-portal-session/policies/${id}/sign`, { employee_id: emp, version_id: v10, typed_signature: "Sam Example" }, staffTok);
    const assign = await call("POST", `${D}/attestations`, { assignedToUserIds: [A.userId] }, A.token);
    const signedOn10 = await staffRow();
    check("setup: the staff member signed 1.0 and the owner has an attestation on 1.0",
      sign.status < 300 && signedOn10?.signed === true && signedOn10?.carried_forward === false && assign.status < 300, `${sign.status} ${assign.status}`);
    const tracker = async () => ((await call("GET", `${D}/attestations`, undefined, A.token)).body.attestations || []).find((a: any) => a.assigned_to_user_id === A.userId);
    const pending = async () => ((await call("GET", `/api/labs/${A.labId}/veritapolicy/pending-attestations`, undefined, A.token)).body.pending || []).find((p: any) => p.document_id === id);

    // 2. Default: minor revision goes back to everyone
    const v11 = await upload(A, {}, `${D}/versions`);
    approve();
    const afterMinorDefault = await staffRow();
    check("2. default lab: on 1.1 the staff list asks again", v11.body.version_label === "1.1" && afterMinorDefault?.signed === false && afterMinorDefault?.carried_forward === false, JSON.stringify(afterMinorDefault && { s: afterMinorDefault.signed, c: afterMinorDefault.carried_forward }));
    check("2. default lab: the attestation on 1.0 is stale on 1.1", (await tracker())?.is_stale_version === true && (await pending())?.is_stale_version === true);

    // 3. The setting
    const badVal = await call("PUT", S(), { carryForward: "yes" }, A.token);
    const set = await call("PUT", S(), { carryForward: true }, A.token);
    const audit = sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'minor_revision_rule_changed' ORDER BY id DESC LIMIT 1").get(A.labId) as any;
    const ad = JSON.parse(audit?.details || "{}");
    check("3. the setting must be true or false, and a change is audited", badVal.status === 400 && set.status === 200 && ad.from === "re_sign" && ad.to === "carry_forward", audit?.details);
    const bStill = await call("GET", S(B), undefined, B.token);
    const bTries = await call("PUT", `/api/labs/${A.labId}/veritapolicy/settings/minor-revisions`, { carryForward: false }, B.token);
    check("3. another lab is untouched and can't change this one", bStill.body.carryForward === false && bTries.status === 403, `${bStill.body.carryForward} ${bTries.status}`);

    // 4. Carry forward
    const carried = await staffRow();
    check("4. carry-forward lab: the 1.0 signature counts on 1.1, and the list says so",
      carried?.signed === true && carried?.carried_forward === true && carried?.signed_version_label === "1.0" && carried?.version_label === "1.1" && !!carried?.signed_at,
      JSON.stringify(carried && { s: carried.signed, c: carried.carried_forward, from: carried.signed_version_label, v: carried.version_label }));
    check("4. carry-forward lab: the attestation on 1.0 isn't stale on 1.1", (await tracker())?.is_stale_version === false && (await pending())?.is_stale_version === false);

    // 5. Never across a major revision
    const v20 = await upload(A, { is_major_revision: "true" }, `${D}/versions`);
    approve();
    const afterMajor = await staffRow();
    check("5. on 2.0 the staff list asks again, carry-forward or not", v20.body.version_label === "2.0" && afterMajor?.signed === false && afterMajor?.carried_forward === false, JSON.stringify(afterMajor && { s: afterMajor.signed, c: afterMajor.carried_forward }));
    check("5. on 2.0 the attestation on 1.0 is stale", (await tracker())?.is_stale_version === true && (await pending())?.is_stale_version === true);

    // 6. Sign 2.0, then 2.1 carries from 2.0
    const sign20 = await call("POST", `/api/staff-portal-session/policies/${id}/sign`, { employee_id: emp, version_id: afterMajor.version_id, typed_signature: "Sam Example" }, staffTok);
    const v21 = await upload(A, {}, `${D}/versions`);
    approve();
    const carried2 = await staffRow();
    check("6. after signing 2.0, 2.1 carries from 2.0", sign20.status < 300 && v21.body.version_label === "2.1" && carried2?.signed === true && carried2?.signed_version_label === "2.0",
      JSON.stringify(carried2 && { s: carried2.signed, from: carried2.signed_version_label }));

    // 7. Back to re-sign
    const off = await call("PUT", S(), { carryForward: false }, A.token);
    const backOff = await staffRow();
    check("7. turning it back to re-sign applies at once", off.status === 200 && backOff?.signed === false && backOff?.carried_forward === false, JSON.stringify(backOff && { s: backOff.signed }));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
