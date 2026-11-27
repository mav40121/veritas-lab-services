// tests/integration/staff-read-and-sign.test.ts
//
// STANDING integration test for a Staff login's read-and-sign with a real signature (BUG-188, 2026-11-27; mock 3; server/policyStaffSign.ts).
// Boots the REAL routes on a throwaway SQLite DB with a made-up OpenID Connect provider mounted on the same server (as in
// signature-sso.test.ts). Made-up people and documents only.
//   0. Boot adds how-signed to staff_portal_policy_signatures.
//   1. The old gap: a name and no password, and a hash the browser sent, was a signature. Now a password (or the hospital sign-in) is
//      asked for, and a hash the browser sends is ignored: the server makes it from the version on file.
//   2. An opening is recorded with its version, in My sign-offs and in VeritaDC itself; one not opened at that version can't be signed.
//   3. One document: name and password; its own signature row and audit row; the list reads signed.
//   4. Sign several: each document opened at that version gets its own row and audit row, signed together; one not opened, and one
//      revised since the list was shown, are refused and the rest go; a wrong password signs nothing; the list says what was opened.
//   5. A file that doesn't match its record can't be signed, and the lab's trail says so.
//   6. A wrong password counts toward the sign-in lockout; the right one clears it; a locked account can't sign.
//   7. Signatures from before (a typed name, no password) stay signed, and the roster and the signature report say how.
//   8. A person whose hospital requires single sign-on signs through S0, one document and several; their password can't.
//   9. Refused: another lab's document, a document not assigned to them, someone else's signature, a login with no roster row, Veritas
//      support (with or without a roster row), and Sign several's bad lists.
// Run: npm run test:staff-read-and-sign

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const app = express();
  const server = http.createServer(app);

  // ── Made-up OpenID Connect provider (as in signature-sso.test.ts) ──
  const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(key.publicKey.export({ format: "jwk" }) as any), kid: "k1", alg: "RS256", use: "sig" };
  let issuerUrl = "";
  const CLIENT_ID = "client-readsign";
  const codes = new Map<string, any>();
  const signJwt = (payload: any) => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
    return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key.privateKey))}`;
  };
  const mock = express.Router();
  mock.use(express.urlencoded({ extended: false }));
  mock.get("/tenant-r/v2.0/.well-known/openid-configuration", (_req, res) => res.json({
    issuer: issuerUrl, authorization_endpoint: `${issuerUrl}/authorize`, token_endpoint: `${issuerUrl}/token`, jwks_uri: `${issuerUrl}/keys`,
  }));
  mock.get("/tenant-r/v2.0/keys", (_req, res) => res.json({ keys: [jwk] }));
  mock.post("/tenant-r/v2.0/token", (req, res) => {
    const c = codes.get(String(req.body.code));
    if (!c) return res.status(400).json({ error: "invalid_grant" });
    codes.delete(String(req.body.code));
    const verifierHash = b64url(crypto.createHash("sha256").update(String(req.body.code_verifier || "")).digest());
    if (verifierHash !== c.challenge || req.body.redirect_uri !== c.redirectUri) return res.status(400).json({ error: "invalid_grant" });
    res.json({ id_token: c.idToken, token_type: "Bearer" });
  });
  app.use("/mock-idp", mock);
  app.use(express.json({ limit: "10mb" }));
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  issuerUrl = `${base}/mock-idp/tenant-r/v2.0`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Read", "sign", "188!"].join("-");
  const WRONG_PW = ["Not", "their", "pass", "9"].join("-"); // a password nobody has
  const HOSPITAL = "Example Hospital";
  const now = new Date().toISOString();
  const stamp = Date.now();

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* a file */ }
    return { status: r.status, body: j as any, text };
  };
  const mkLab = async (tag: string) => {
    const email = `readsign-${tag}-${stamp}@owner.test`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Read Sign Lab ${tag}`, plan: "hospital", isWarehouse: true });
    const labId = prov.body.labId as number;
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    const existing = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
    const staffLab = existing?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, '22D0000188', ?, ?, ?)").run(userId, `Read Sign Lab ${tag}`, labId, now, now).lastInsertRowid);
    return { email, token: reg.body.token as string, labId, userId, staffLab, P: `/api/labs/${labId}/veritapolicy` };
  };
  type Lab = Awaited<ReturnType<typeof mkLab>>;
  const addEmployee = (L: Lab, first: string, last: string) => Number(sqlite.prepare(
    "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Laboratory Scientist', 'active', ?, ?)"
  ).run(L.staffLab, L.labId, L.userId, last, first, now, now).lastInsertRowid);
  const addStaffLogin = async (L: Lab, first: string, last: string, email: string) => {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `${first} ${last}`, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(L.labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
    const emp = addEmployee(L, first, last);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(L.userId, email, userId, L.labId, emp);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = issueSession(sqlite, userId, { headers: { "user-agent": "read-sign-188-test" }, ip: "127.0.0.1" }).token as string;
    return { email, userId, emp, token, name: `${first} ${last}` };
  };
  type Person = Awaited<ReturnType<typeof addStaffLogin>>;
  const upload = async (L: Lab, title: string, p = `${L.P}/documents`) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up procedure text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    if (title) fd.append("title", title);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };
  const approve = (id: number) => sqlite.prepare("UPDATE policy_documents SET status = 'approved' WHERE id = ?").run(id);
  const mkDoc = async (L: Lab, title: string) => { const d = await upload(L, title); approve(d.id); return Number(d.id); };
  const versionOf = (id: number) => Number((sqlite.prepare("SELECT current_version_id AS v FROM policy_documents WHERE id = ?").get(id) as any).v);
  const hashOf = (versionId: number) => String((sqlite.prepare("SELECT file_hash_sha256 AS h FROM policy_versions WHERE id = ?").get(versionId) as any).h);
  const open = (id: number, who: { token: string }) => call("GET", `/api/staff-portal-session/policies/${id}/render`, undefined, who.token);
  const sign = (id: number, who: Person, extra: Record<string, unknown> = {}) =>
    call("POST", `/api/staff-portal-session/policies/${id}/sign`, { employee_id: who.emp, version_id: versionOf(id), typed_signature: who.name, ...extra }, who.token);
  const several = (who: Person, items: { document_id: number; version_id: number }[], extra: Record<string, unknown> = {}) =>
    call("POST", "/api/staff-portal-session/policies/sign-several", { employee_id: who.emp, items, typed_signature: who.name, ...extra }, who.token);
  const item = (id: number, version = versionOf(id)) => ({ document_id: id, version_id: version });
  const sigRows = (id: number, emp: number) => sqlite.prepare("SELECT * FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ? ORDER BY id").all(id, emp) as any[];
  const audits = (id: number, action: string) => (sqlite.prepare("SELECT user_id, details FROM policy_audit_log WHERE document_id = ? AND action = ? ORDER BY id").all(id, action) as any[]).map((r) => ({ user_id: r.user_id, d: r.details ? JSON.parse(r.details) : null }));
  const listRow = async (who: Person, id: number) => ((await call("GET", `/api/staff-portal-session/policies?employee_id=${who.emp}`, undefined, who.token)).body.policies || []).find((p: any) => p.document_id === id);
  const failedCount = (userId: number) => Number((sqlite.prepare("SELECT COALESCE(failed_login_count, 0) AS n FROM users WHERE id = ?").get(userId) as any).n);

  /** One hospital sign-in round trip for a signature, traded for its proof (as in signature-sso.test.ts). */
  const proofFor = async (token: string, purpose: string, email: string) => {
    const start = await call("POST", "/api/auth/signature/sso/start", { purpose, waiter: b64url(crypto.randomBytes(12)) }, token);
    if (start.status !== 200) return "";
    const q = new URL(start.body.url).searchParams;
    const t = Math.floor(Date.now() / 1000);
    const payload = { iss: issuerUrl, aud: CLIENT_ID, sub: `sub-${email}`, email, name: "Made Up", nonce: q.get("nonce"), iat: t, nbf: t, exp: t + 3600, auth_time: t };
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), idToken: signJwt(payload) });
    const cb = await fetch(`${base}/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(q.get("state") || "")}`, { redirect: "manual" });
    const handoff = new URL(cb.headers.get("location") || "", base).searchParams.get("h");
    const done = await call("POST", "/api/auth/signature/sso/complete", { code: handoff }, token);
    return String(done.body?.proof || "");
  };

  try {
    // ── Setup: two labs; Staff logins Sam, Lou and Pat (password), Hana (hospital sign-in), an editor, a support login ──
    const A = await mkLab("a");
    const B = await mkLab("b");
    const sam = await addStaffLogin(A, "Sam", "Rivera", `sam-${stamp}@plain.test`);
    const lou = await addStaffLogin(A, "Lou", "Okafor", `lou-${stamp}@plain.test`);
    const pat = await addStaffLogin(A, "Pat", "Brandt", `pat-${stamp}@plain.test`);
    const hana = await addStaffLogin(A, "Hana", "Tate", `hana-${stamp}@hospital.test`);
    const supReg = await call("POST", "/api/auth/register", { email: `support-${stamp}@support.test`, password: PW, name: "Support Made-Up", hipaa_acknowledged: true });
    const supFlag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `support-${stamp}@support.test`, enabled: true });
    const cfg = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer: issuerUrl, clientId: CLIENT_ID, emailDomains: ["hospital.test"], required: true });
    check("0. two labs, four Staff logins, a support login and a required hospital sign-in", !!A.labId && !!B.labId && !!sam.token && !!hana.token && supFlag.status === 200 && cfg.status === 200, JSON.stringify(cfg.body).slice(0, 100));
    const cols = (sqlite.prepare("PRAGMA table_info(staff_portal_policy_signatures)").all() as any[]).map((c) => c.name);
    check("0. boot adds signed_with, signed_with_provider and signed_together to staff_portal_policy_signatures", ["signed_with", "signed_with_provider", "signed_together"].every((c) => cols.includes(c)), cols.join(","));

    // Documents in lab A, everything to everyone, except one assigned only to Pat. One in lab B.
    const d1 = await mkDoc(A, "Made-up Critical Result Reporting");
    const d2 = await mkDoc(A, "Made-up Specimen Labeling");
    const d3 = await mkDoc(A, "Made-up Pipette Calibration Check");
    const d4 = await mkDoc(A, "Made-up Chemical Hygiene Plan");
    const d5 = await mkDoc(A, "Made-up Exposure Control Plan");
    const d6 = await mkDoc(A, "Made-up Tamper Target");
    const d7 = await mkDoc(A, "Made-up Read In VeritaDC");
    const d8 = await mkDoc(A, "Made-up Hospital Sign One");
    const d9 = await mkDoc(A, "Made-up Hospital Sign Two");
    const d10 = await mkDoc(A, "Made-up Hospital Sign Three");
    const dLock = await mkDoc(A, "Made-up Lockout Document");
    const allA = [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, dLock];
    for (const id of allA) await call("POST", `${A.P}/read-sign`, { scope: "document", id, everyone: true }, A.token);
    const dPatOnly = await mkDoc(A, "Made-up Pat Only");
    const patOnly = await call("POST", `${A.P}/read-sign`, { scope: "document", id: dPatOnly, employee_ids: [pat.emp] }, A.token);
    const dB = await mkDoc(B, "Made-up Other Lab Procedure");
    await call("POST", `${B.P}/read-sign`, { scope: "document", id: dB, everyone: true }, B.token);
    check("0. made-up documents, assigned", allA.every(Boolean) && patOnly.status < 300 && !!dB, `${patOnly.status}`);

    // 2. Openings carry their version; not opened at this version can't be signed
    const notOpened = await sign(d1, sam, { password: PW });
    check("2. a version not opened can't be signed", notOpened.status === 409 && notOpened.body.code === "NOT_OPENED" && sigRows(d1, sam.emp).length === 0, JSON.stringify(notOpened.body));
    const opened = await open(d1, sam);
    const view = audits(d1, "viewed").filter((a) => a.user_id === sam.userId);
    check("2. opening it in My sign-offs is recorded with the version", opened.status === 200 && view.length === 1 && view[0].d?.version_id === versionOf(d1) && view[0].d?.via === "staff_login", JSON.stringify(view));
    const ownerOpen = await call("GET", `${A.P}/documents/${d1}/render`, undefined, A.token);
    const ownerView = audits(d1, "viewed").filter((a) => a.user_id === A.userId);
    check("2. an opening in VeritaDC itself is recorded with the version too", ownerOpen.status === 200 && ownerView.length === 1 && ownerView[0].d?.version_id === versionOf(d1), JSON.stringify(ownerView));
    check("2. the list says when they opened this version", !!(await listRow(sam, d1))?.opened_at && !(await listRow(sam, d2))?.opened_at);

    // 1. The old gap, and what is asked now: what the browser sent before (a name, and a hash) no longer signs
    const noPw = await sign(d1, sam, { content_hash: "madeup-browser-hash" });
    check("1. a name and no password no longer signs", noPw.status === 400 && noPw.body.error === "Enter your password to sign." && sigRows(d1, sam.emp).length === 0, JSON.stringify(noPw.body));

    // 3. One document, name and password; a hash from the browser is ignored
    const one = await sign(d1, sam, { password: PW, content_hash: "madeup-browser-hash" });
    const r1 = sigRows(d1, sam.emp);
    check("3. Sam signs one document with his name and password", one.status === 200 && one.body.already_signed === false && one.body.signed_with === "password" && r1.length === 1, JSON.stringify(one.body));
    check("3. the hash is the server's own from the version on file, not what the browser sent", r1[0]?.signed_document_hash === hashOf(versionOf(d1)) && r1[0]?.signed_document_hash !== "madeup-browser-hash", String(r1[0]?.signed_document_hash).slice(0, 16));
    check("3. the row says how it was made, alone", r1[0]?.signed_with === "password" && r1[0]?.signed_with_provider == null && r1[0]?.signed_together == null && r1[0]?.typed_signature === sam.name);
    const a1 = audits(d1, "read_and_signed");
    check("3. it writes its audit row: who, the version, how, the hash, before and after", a1.length === 1 && a1[0].user_id === sam.userId && a1[0].d.version_id === versionOf(d1) && a1[0].d.signed_with === "password" && a1[0].d.document_hash === hashOf(versionOf(d1))
      && a1[0].d.signature_id === r1[0].id && a1[0].d.staff_employee_id === sam.emp && a1[0].d.before?.signed === false && a1[0].d.after?.signed === true, JSON.stringify(a1[0]?.d));
    check("3. My sign-offs reads it signed", (await listRow(sam, d1))?.signed === true);
    const again = await sign(d1, sam, { password: PW });
    check("3. signing it again records nothing new", again.status === 200 && again.body.already_signed === true && sigRows(d1, sam.emp).length === 1 && audits(d1, "read_and_signed").length === 1);
    const trail = await call("GET", `${A.P}/documents/${d1}/audit-trail`, undefined, A.token);
    check("3. the document's trail shows the signature", (trail.body.events || []).some((e: any) => e.action === "read_and_signed" && e.user_id === sam.userId));

    // 4. Sign several
    for (const id of [d2, d3, d5]) await open(id, sam);
    const lst = await call("GET", `/api/staff-portal-session/policies?employee_id=${sam.emp}`, undefined, sam.token);
    const ready = (lst.body.policies || []).filter((p: any) => !p.signed && p.opened_at).map((p: any) => p.document_id).sort((a: number, b: number) => a - b);
    check("4. the list says which documents are opened at the version listed", JSON.stringify(ready) === JSON.stringify([d2, d3, d5].sort((a, b) => a - b)), JSON.stringify(ready));
    const listedV5 = versionOf(d5);
    await upload(A, "", `${A.P}/documents/${d5}/versions`);
    approve(d5);
    const d5Row = await listRow(sam, d5);
    check("4. revised since: the list says which version they opened and to open the new one", !d5Row?.opened_at && d5Row?.opened_version_label === "1.0" && d5Row?.version_label === "1.1", JSON.stringify(d5Row && { o: d5Row.opened_at, ov: d5Row.opened_version_label, v: d5Row.version_label }));
    const wrongSeveral = await several(sam, [item(d2), item(d3)], { password: WRONG_PW });
    check("4. a wrong password signs nothing", wrongSeveral.status === 401 && wrongSeveral.body.error === "Password incorrect; signature not recorded" && sigRows(d2, sam.emp).length === 0 && sigRows(d3, sam.emp).length === 0, JSON.stringify(wrongSeveral.body));
    const sev = await several(sam, [item(d2), item(d3), item(d4), item(d5, listedV5)], { password: PW, content_hash: "madeup" });
    const res = (id: number) => (sev.body.results || []).find((r: any) => r.document_id === id);
    check("4. Sign several: the two opened at that version are signed", sev.status === 200 && sev.body.signed === 2 && sev.body.refused === 2 && res(d2)?.ok && res(d3)?.ok, JSON.stringify(sev.body).slice(0, 300));
    check("4. one not opened is refused", res(d4)?.ok === false && res(d4)?.code === "NOT_OPENED" && sigRows(d4, sam.emp).length === 0, JSON.stringify(res(d4)));
    check("4. one revised since the list was shown is refused, in the mock's words", res(d5)?.ok === false && res(d5)?.code === "MOVED" && res(d5)?.message === "It was revised since the list was shown. Open it and read it again before you sign." && sigRows(d5, sam.emp).length === 0, JSON.stringify(res(d5)));
    const r2 = sigRows(d2, sam.emp)[0], r3 = sigRows(d3, sam.emp)[0];
    check("4. each document has its own signature row, its own hash, signed together", !!r2 && !!r3 && r2.id !== r3.id && r2.signed_document_hash === hashOf(versionOf(d2)) && r3.signed_document_hash === hashOf(versionOf(d3)) && r2.signed_together === 2 && r3.signed_together === 2 && r2.signed_with === "password");
    check("4. and its own audit row", audits(d2, "read_and_signed").length === 1 && audits(d3, "read_and_signed").length === 1 && audits(d4, "read_and_signed").length === 0 && audits(d2, "read_and_signed")[0].d.signed_together === 2);
    await open(d5, sam);
    const d5Now = await several(sam, [item(d5)], { password: PW });
    check("4. opened again at the new version, it signs", d5Now.status === 200 && d5Now.body.signed === 1 && sigRows(d5, sam.emp)[0]?.version_id === versionOf(d5) && sigRows(d5, sam.emp)[0]?.signed_together == null);
    const big = Array.from({ length: 101 }, (_, i) => ({ document_id: 900000 + i, version_id: 1 }));
    check("4. more than 100 at a time is refused", (await several(sam, big, { password: PW })).body.code === "TOO_MANY");
    check("4. a document listed twice is refused", (await several(sam, [item(d2), item(d2)], { password: PW })).body.code === "DUPLICATE");
    check("4. an empty list is refused", (await several(sam, [], { password: PW })).body.code === "NO_ITEMS");

    // 5. A file that doesn't match its record
    await open(d6, sam);
    const filePath = (sqlite.prepare("SELECT file_path FROM policy_versions WHERE id = ?").get(versionOf(d6)) as any).file_path;
    fs.writeFileSync(path.join(process.env.POLICY_STORAGE_ROOT || "/data/policies", filePath), "Changed on disk after it was approved (made up).\n");
    const tampered = await sign(d6, sam, { password: PW });
    check("5. a file that doesn't match its record can't be signed", tampered.status === 409 && tampered.body.code === "FILE_MISMATCH" && tampered.body.error === "This file doesn't match its record, so it can't be signed. Tell your supervisor." && sigRows(d6, sam.emp).length === 0, JSON.stringify(tampered.body));
    check("5. the lab's trail records it", audits(d6, "tamper_detected").some((a) => a.d?.surface === "staff_sign"));

    // An opening in VeritaDC itself by the Staff login counts as well
    const dcRead = await call("GET", `${A.P}/documents/${d7}/render`, undefined, sam.token);
    const dcSign = await sign(d7, sam, { password: PW });
    check("2. a version the Staff login opened in VeritaDC can be signed", dcRead.status === 200 && dcSign.status === 200 && sigRows(d7, sam.emp).length === 1, `${dcRead.status} ${JSON.stringify(dcSign.body)}`);

    // 6. Lockout
    await open(dLock, lou);
    const before = failedCount(lou.userId);
    const wrong1 = await sign(dLock, lou, { password: WRONG_PW });
    check("6. a wrong password is refused, nothing signed, and counts toward the lockout", wrong1.status === 401 && wrong1.body.error === "Password incorrect; signature not recorded" && sigRows(dLock, lou.emp).length === 0 && failedCount(lou.userId) === before + 1, `${wrong1.status} ${failedCount(lou.userId)}`);
    check("6. and writes no audit row", audits(dLock, "read_and_signed").length === 0);
    const lockSet = await call("PUT", "/api/auth/security-settings", { password: PW, settings: { lockoutAttempts: 3 } }, A.token);
    check("6. the owner turns the lockout on (3)", lockSet.status === 200, JSON.stringify(lockSet.body).slice(0, 100));
    for (let i = 0; i < 2; i++) await sign(dLock, lou, { password: WRONG_PW });
    const locked = sqlite.prepare("SELECT failed_login_count, locked_at FROM users WHERE id = ?").get(lou.userId) as any;
    check("6. three wrong passwords at signing lock the account", !!locked?.locked_at && Number(locked.failed_login_count) === 3, JSON.stringify(locked));
    const lockedSign = await sign(dLock, lou, { password: PW });
    check("6. a locked account can't sign, even with the right password", lockedSign.status === 423 && lockedSign.body.code === "ACCOUNT_LOCKED" && sigRows(dLock, lou.emp).length === 0);
    sqlite.prepare("UPDATE users SET locked_at = NULL, failed_login_count = 0 WHERE id = ?").run(lou.userId);
    await sign(dLock, lou, { password: WRONG_PW });
    const right = await sign(dLock, lou, { password: PW });
    check("6. unlocked, the right password signs and clears the count", right.status === 200 && failedCount(lou.userId) === 0);

    // 7. Signatures from before: a typed name, no password, a hash the browser sent
    sqlite.prepare(
      "INSERT INTO staff_portal_policy_signatures (lab_id, document_id, version_id, staff_employee_id, signed_document_hash, typed_signature, ip_address, user_agent, signed_at) VALUES (?, ?, ?, ?, ?, ?, '127.0.0.1', 'made-up', '2026-11-20 14:02:00')"
    ).run(A.labId, d1, versionOf(d1), pat.emp, "browser-sent-made-up-hash", pat.name);
    check("7. a signature from before reads as signed on their own list", (await listRow(pat, d1))?.signed === true);
    const bell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${A.labId}`, undefined, pat.token);
    check("7. and the bell doesn't ask for it again", bell.status === 200 && !(bell.body.policies || []).some((p: any) => p.document_id === d1) && (bell.body.policies || []).some((p: any) => p.document_id === d2), JSON.stringify((bell.body.policies || []).map((p: any) => p.document_id)));
    const st = await call("GET", `${A.P}/documents/${d1}/signature-status`, undefined, A.token);
    const person = (emp: number) => (st.body.people || []).find((p: any) => p.employee_id === emp);
    check("7. the roster reads it signed, and says how: a typed name, from before", person(pat.emp)?.status === "signed" && person(pat.emp)?.method === "Typed name, no password" && person(pat.emp)?.method_note === "Signed before passwords were asked", JSON.stringify(person(pat.emp)));
    check("7. a signature made now says name and password, hash matches", person(sam.emp)?.status === "signed" && person(sam.emp)?.method === "Name and password" && person(sam.emp)?.method_note === "Hash matches" && person(sam.emp)?.how === "Staff login", JSON.stringify(person(sam.emp)));
    check("7. the count of signed people is unchanged by how", st.body.summary?.signed === 2, JSON.stringify(st.body.summary));
    const { default: ExcelJS } = await import("exceljs");
    const report = async (id: number) => {
      const x = await fetch(`${base}${A.P}/documents/${id}/signature-report.xlsx`, { headers: { Authorization: `Bearer ${A.token}` } });
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await x.arrayBuffer()) as any);
      let text = "";
      wb.getWorksheet("Signature Report")?.eachRow((r) => r.eachCell((c) => { text += ` | ${c.text}`; }));
      let roster = "";
      wb.getWorksheet("Everyone on the Roster")?.eachRow((r) => { roster += ` | ${r.getCell(1).text}: ${r.getCell(7).text}`; });
      return { status: x.status, text, roster };
    };
    const rep1 = await report(d1);
    const short = (h: string) => `${h.slice(0, 4)} ${h.slice(4, 8)}`;
    check("7. the signature report says how each was made", rep1.status === 200 && /Typed name, no password \(signed before passwords were asked\)/.test(rep1.text) && /As sent by browser/.test(rep1.text) && /\| Name and password \|/.test(rep1.text), rep1.text.slice(0, 400));
    check("7. with the version hash the server holds, and the one each signature was made against", rep1.text.includes(`Version hash | ${short(hashOf(versionOf(d1)))}`) && rep1.text.includes(`| ${short(hashOf(versionOf(d1)))} |`), rep1.text.slice(0, 300));
    check("7. the roster sheet says how too", /Brandt, Pat: Staff login: Typed name, no password/.test(rep1.roster) && /Rivera, Sam: Staff login: Name and password/.test(rep1.roster), rep1.roster.slice(0, 300));
    const rep2 = await report(d2);
    check("7. a signature from Sign several says it was one of 2 signed together", /Name and password, one of 2 signed together/.test(rep2.text), rep2.text.slice(0, 300));

    // 8. A hospital sign-in signs through S0
    const method = await call("GET", "/api/auth/signature/method", undefined, hana.token);
    check("8. Hana's hospital requires its sign-in", method.body.password === false && method.body.sso?.name === HOSPITAL, JSON.stringify(method.body));
    await open(d8, hana);
    const hanaPw = await sign(d8, hana, { password: PW });
    check("8. her password can't sign", hanaPw.status === 403 && hanaPw.body.code === "SSO_SIGN_REQUIRED" && sigRows(d8, hana.emp).length === 0, JSON.stringify(hanaPw.body));
    const otherPurpose = await proofFor(hana.token, "policy_decision", hana.email);
    const wrongProof = await sign(d8, hana, { sso_proof: otherPurpose });
    check("8. a hospital sign-in asked for another purpose can't sign it", !!otherPurpose && wrongProof.status === 401 && wrongProof.body.code === "SIGN_PROOF_INVALID", JSON.stringify(wrongProof.body));
    const proof1 = await proofFor(hana.token, "policy_read_sign", hana.email);
    const hanaOne = await sign(d8, hana, { sso_proof: proof1 });
    const h8 = sigRows(d8, hana.emp)[0];
    check("8. her hospital sign-in, asked for again, signs one document", !!proof1 && hanaOne.status === 200 && h8?.signed_with === "sso" && h8?.signed_with_provider === HOSPITAL && h8?.signed_document_hash === hashOf(versionOf(d8)), JSON.stringify(hanaOne.body));
    await open(d9, hana); await open(d10, hana);
    const reused = await several(hana, [item(d9), item(d10)], { sso_proof: proof1 });
    check("8. that proof works once", reused.status === 401 && sigRows(d9, hana.emp).length === 0);
    const proof2 = await proofFor(hana.token, "policy_read_sign", hana.email);
    const hanaSev = await several(hana, [item(d9), item(d10)], { sso_proof: proof2 });
    check("8. one hospital sign-in signs several, each its own row", hanaSev.status === 200 && hanaSev.body.signed === 2 && sigRows(d9, hana.emp)[0]?.signed_with === "sso" && sigRows(d10, hana.emp)[0]?.signed_together === 2, JSON.stringify(hanaSev.body).slice(0, 200));
    const st8 = await call("GET", `${A.P}/documents/${d8}/signature-status`, undefined, A.token);
    check("8. the roster says it was signed with the hospital's sign-in", (st8.body.people || []).find((p: any) => p.employee_id === hana.emp)?.method === `${HOSPITAL} sign-in`);

    // 9. Refusals
    const otherLab = await call("POST", `/api/staff-portal-session/policies/${dB}/sign`, { employee_id: sam.emp, version_id: versionOf(dB), typed_signature: sam.name, password: PW }, sam.token);
    check("9. another lab's document can't be signed", otherLab.status === 404 && sigRows(dB, sam.emp).length === 0, JSON.stringify(otherLab.body));
    const otherLabSev = await several(sam, [item(dB)], { password: PW });
    check("9. nor in Sign several", otherLabSev.status === 200 && otherLabSev.body.results?.[0]?.ok === false && otherLabSev.body.results?.[0]?.status === 404 && sigRows(dB, sam.emp).length === 0);
    await open(dPatOnly, sam);
    const notMine = await sign(dPatOnly, sam, { password: PW });
    check("9. a document not assigned to them can be read, and can't be signed", notMine.status === 403 && notMine.body.code === "NOT_ASSIGNED" && sigRows(dPatOnly, sam.emp).length === 0, JSON.stringify(notMine.body));
    const notMineSev = await several(sam, [item(dPatOnly)], { password: PW });
    check("9. nor in Sign several", notMineSev.body.results?.[0]?.code === "NOT_ASSIGNED");
    const asPat = await call("POST", `/api/staff-portal-session/policies/${d4}/sign`, { employee_id: pat.emp, version_id: versionOf(d4), typed_signature: pat.name, password: PW }, sam.token);
    const asPatSev = await call("POST", "/api/staff-portal-session/policies/sign-several", { employee_id: pat.emp, items: [item(d4)], typed_signature: pat.name, password: PW }, sam.token);
    check("9. nobody signs as someone else", asPat.status === 403 && asPat.body.code === "STAFF_PORTAL_NOT_SELF" && asPatSev.status === 403 && sigRows(d4, pat.emp).length === 0);
    const editor = await call("POST", `/api/staff-portal-session/policies/${d4}/sign`, { employee_id: sam.emp, version_id: versionOf(d4), typed_signature: "Owner a", password: PW }, B.token);
    check("9. a login with no roster row here (another lab's owner) is refused", editor.status === 401 && editor.body.code === "NOT_STAFF_PORTAL", JSON.stringify(editor.body));
    const ownerNoRow = await call("POST", "/api/staff-portal-session/policies/sign-several", { items: [item(d4)], typed_signature: "Owner a", password: PW }, A.token);
    check("9. the lab's own owner, with no roster row, can't sign as staff either", ownerNoRow.status === 401 && ownerNoRow.body.code === "NOT_STAFF_PORTAL", JSON.stringify(ownerNoRow.body));
    const supTok = supReg.body.token as string;
    const supNoSeat = await call("POST", "/api/staff-portal-session/policies/sign-several", { items: [item(d4)], typed_signature: "Support Made-Up", password: PW }, supTok);
    check("9. Veritas support with no roster row is refused", supNoSeat.status === 401, JSON.stringify(supNoSeat.body));
    // Even holding a roster row (a made-up setup no screen allows), Veritas support never signs for the lab.
    const supUser = Number(supReg.body.user?.id ?? supReg.body.id);
    const supEmp = addEmployee(A, "Support", "Person");
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)").run(A.userId, `support-${stamp}@support.test`, supUser, A.labId, supEmp);
    await call("GET", `/api/staff-portal-session/policies/${d4}/render`, undefined, supTok);
    const supOne = await call("POST", `/api/staff-portal-session/policies/${d4}/sign`, { employee_id: supEmp, version_id: versionOf(d4), typed_signature: "Support Person", password: PW }, supTok);
    const supSev = await call("POST", "/api/staff-portal-session/policies/sign-several", { employee_id: supEmp, items: [item(d4)], typed_signature: "Support Person", password: PW }, supTok);
    check("9. Veritas support with a roster row can't sign one or several", supOne.status === 403 && supOne.body.code === "VLS_SUPPORT_CANNOT_SIGN" && supSev.status === 403 && supSev.body.code === "VLS_SUPPORT_CANNOT_SIGN" && sigRows(d4, supEmp).length === 0, `${JSON.stringify(supOne.body)} ${supSev.status}`);
    check("9. support's refusal costs nothing on the lockout", failedCount(supUser) === 0);
    const unsignedLeft = (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_portal_policy_signatures WHERE signed_with IS NULL").get() as any).n;
    check("9. the only row with no how is the one made before", Number(unsignedLeft) === 1, String(unsignedLeft));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
