// tests/integration/veritadc-doc-types.test.ts
//
// VeritaDC document types (Michael 2026-11-03, Q151/Q154; parity plan Phase 1 item 2; shared/policyDocTypes.ts). Heywood's
// MediaLab types every document, and a form or a job aid skips periodic review and read-and-sign there. Boots the REAL
// routes on a scratch DB and pins:
//   1. boot adds policy_documents.doc_type and policy_doc_type_settings
//   2. out of the box every type keeps both rules on (today's behavior), set_by_lab false
//   3. a lab sets a type's rules (audited from/to); an unknown type and an interval outside 6/12/24/36 are refused;
//      another lab is unaffected
//   4. upload takes a type (an unknown one is refused); a type's default interval is used when the uploader picks none,
//      and the uploader's own choice still wins
//   5. periodic review: re-certifying a "no review" type leaves no review date, a type with review gets one; changing an
//      approved document's type to "no review" clears its date and back gives it one (audited from/to)
//   6. read-and-sign: a "no read-and-sign" type can't be assigned for attestation (409) and leaves the staff login list;
//      a document with no type is still listed
// Every lab, person and document here is made up; the database and policy storage are scratch folders.
// Run: npm run test:veritadc-doc-types

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
  const PW = "Testpass123";
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string) => {
    const email = `doctype-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Type ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Type Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const upload = async (L: { token: string; labId: number }, fields: Record<string, string>) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const today = new Date().toISOString().slice(0, 10);

  try {
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
    check("1. boot adds doc_type and policy_doc_type_settings", cols("policy_documents").includes("doc_type") && cols("policy_doc_type_settings").includes("requires_read_and_sign"));

    const A = await mkLab("A");
    const B = await mkLab("B");
    const T = (L = A) => `/api/labs/${L.labId}/veritapolicy/doc-types`;
    const types0 = (await call("GET", T(), undefined, A.token)).body.types as any[];
    check("2. nine types, every rule on and not set by the lab", types0?.length === 9 && types0.every((t) => t.requires_periodic_review && t.requires_read_and_sign && !t.set_by_lab && t.default_review_months === null),
      `${types0?.length} types`);

    // 3. Setting rules
    const form = await call("PUT", `${T()}/form`, { requiresPeriodicReview: false, requiresReadAndSign: false }, A.token);
    const proc = await call("PUT", `${T()}/procedure`, { defaultReviewMonths: 36 }, A.token);
    const bad = await call("PUT", `${T()}/memo`, { requiresPeriodicReview: false }, A.token);
    const badMonths = await call("PUT", `${T()}/policy`, { defaultReviewMonths: 18 }, A.token);
    const typesA = (await call("GET", T(), undefined, A.token)).body.types as any[];
    const typesB = (await call("GET", T(B), undefined, B.token)).body.types as any[];
    const f = typesA.find((t) => t.doc_type === "form");
    const audit = sqlite.prepare("SELECT details FROM policy_audit_log WHERE lab_id = ? AND action = 'doc_type_rule_changed' ORDER BY id ASC LIMIT 1").get(A.labId) as any;
    const ad = JSON.parse(audit?.details || "{}");
    check("3. a lab turns off review and read-and-sign for forms (audited from/to)",
      form.status === 200 && f?.requires_periodic_review === false && f?.requires_read_and_sign === false && f?.set_by_lab === true && ad.from?.review === true && ad.to?.review === false,
      audit?.details);
    check("3. a procedure default interval of 36 months is saved",
      proc.status === 200 && typesA.find((t) => t.doc_type === "procedure")?.default_review_months === 36, String(proc.status));
    check("3. an unknown type and an 18-month interval are refused", bad.status === 400 && badMonths.status === 400, `${bad.status} ${badMonths.status}`);
    check("3. another lab's rules are untouched", typesB.every((t) => t.requires_periodic_review && t.requires_read_and_sign && !t.set_by_lab));

    // 4. Upload
    const uBad = await upload(A, { title: "Made-up memo", doc_type: "memo" });
    const uForm = await upload(A, { title: "Made-up requisition form", doc_type: "form", review_interval_months: "24" });
    const uProc = await upload(A, { title: "Made-up gram stain procedure", doc_type: "procedure" });
    const uProc12 = await upload(A, { title: "Made-up urinalysis procedure", doc_type: "procedure", review_interval_months: "12" });
    const uNone = await upload(A, { title: "Made-up untyped policy" });
    const row = (id: number) => sqlite.prepare("SELECT doc_type, review_interval_months FROM policy_documents WHERE id = ?").get(id) as any;
    check("4. an unknown type is refused on upload", uBad.status === 400 && uBad.body.code === "BAD_TYPE", String(uBad.status));
    check("4. upload stores the type", uForm.status === 201 && row(uForm.body.id)?.doc_type === "form", JSON.stringify(row(uForm.body.id)));
    check("4. a procedure with no interval picked gets the type's 36; a picked 12 wins",
      row(uProc.body.id)?.review_interval_months === 36 && row(uProc12.body.id)?.review_interval_months === 12, `${row(uProc.body.id)?.review_interval_months} ${row(uProc12.body.id)?.review_interval_months}`);

    // 5. Periodic review
    sqlite.prepare("UPDATE policy_documents SET status = 'approved', next_review_date = '2027-01-01' WHERE id IN (?, ?, ?)").run(uForm.body.id, uProc.body.id, uNone.body.id);
    const recert = (id: number) => call("POST", `/api/labs/${A.labId}/veritapolicy/documents/${id}/recertify`, { typedSignature: "Pat Example", password: PW }, A.token);
    const rf = await recert(uForm.body.id);
    const rp = await recert(uProc.body.id);
    const nrd = (id: number) => (sqlite.prepare("SELECT next_review_date FROM policy_documents WHERE id = ?").get(id) as any)?.next_review_date ?? null;
    check("5. re-certifying a form (no review) leaves no review date; a procedure gets one 36 months out",
      rf.status === 200 && nrd(uForm.body.id) === null && rp.status === 200 && typeof nrd(uProc.body.id) === "string" && nrd(uProc.body.id) > today,
      `${rf.status} ${nrd(uForm.body.id)} | ${rp.status} ${nrd(uProc.body.id)}`);
    const P = (id: number, body: any) => call("PATCH", `/api/labs/${A.labId}/veritapolicy/documents/${id}`, body, A.token);
    const toForm = await P(uNone.body.id, { docType: "form" });
    const clearedDate = nrd(uNone.body.id);
    const backToPolicy = await P(uNone.body.id, { docType: "policy" });
    const newDate = nrd(uNone.body.id);
    const ed = JSON.parse((sqlite.prepare("SELECT details FROM policy_audit_log WHERE document_id = ? AND action = 'edited' ORDER BY id DESC LIMIT 1").get(uNone.body.id) as any)?.details || "{}");
    check("5. an approved document changed to a no-review type loses its date, and back to a review type gets a new one",
      toForm.status === 200 && clearedDate === null && backToPolicy.status === 200 && typeof newDate === "string" && newDate > today && ed.doc_type_from === "form" && ed.doc_type_to === "policy",
      `${clearedDate} -> ${newDate} :: ${JSON.stringify(ed)}`);
    const badPatch = await P(uNone.body.id, { docType: "memo" });
    check("5. an unknown type is refused on edit", badPatch.status === 400, String(badPatch.status));

    // 6. Read-and-sign
    const assignForm = await call("POST", `/api/labs/${A.labId}/veritapolicy/documents/${uForm.body.id}/attestations`, { assignedToUserIds: [A.userId] }, A.token);
    check("6. a form (no read-and-sign) can't be assigned for attestation", assignForm.status === 409 && assignForm.body.code === "TYPE_NO_READ_AND_SIGN", JSON.stringify(assignForm.body));
    // A made-up staff login on lab A
    const owner = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(A.labId) as any;
    const now = new Date().toISOString();
    const existingSl = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A.labId) as any;
    const sl = existingSl?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Type Lab A', '22D0000099', ?, ?, ?)").run(owner.owner_user_id, A.labId, now, now).lastInsertRowid);
    const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, 'Example', 'Sam', 'active', ?, ?)").run(sl, owner.owner_user_id, now, now).lastInsertRowid);
    const staffEmail = `doctype-staff-${Date.now()}@example.com`;
    const staffUid = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at, hipaa_acknowledged, hipaa_ack_source) VALUES (?, 'x', 'Sam Example', 'free', ?, 1, 'signup')").run(staffEmail, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(owner.owner_user_id, staffEmail, staffUid, A.labId, emp);
    const staffTok = issueSession(sqlite, staffUid, { headers: { "user-agent": "doc-types-test" }, ip: "127.0.0.1" }).token;
    sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id IN (?, ?)").run(uForm.body.id, uProc12.body.id);
    // Since Step D a Staff login sees only what's assigned; this test is about what happens to what they see, so everything goes to everyone.
    await call("POST", `/api/labs/${A.labId}/veritapolicy/read-sign`, { scope: "lab", everyone: true }, A.token);
    const staffList = await call("GET", `/api/staff-portal-session/policies?employee_id=${emp}`, undefined, staffTok);
    const ids = (staffList.body.policies || []).map((p: any) => p.document_id);
    check("6. the staff login list leaves out the form and keeps the procedure and the untyped-then-retyped policy",
      staffList.status === 200 && !ids.includes(uForm.body.id) && ids.includes(uProc12.body.id) && ids.includes(uNone.body.id),
      `HTTP ${staffList.status} ${JSON.stringify(ids)}`);
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
