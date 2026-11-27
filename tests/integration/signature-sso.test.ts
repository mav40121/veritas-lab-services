// tests/integration/signature-sso.test.ts
//
// STANDING integration test for the one signature check and signing with the hospital's sign-in (S0, 2026-11-27; server/eSignature.ts,
// server/ssoRoutes.ts, components/SignaturePrompt.tsx). Boots the REAL routes on a throwaway SQLite DB with the mock OpenID Connect
// provider of tests/integration/sso.test.ts mounted on the same server, and drives the real round trip. Made-up people and documents.
//   1. The gap: where single sign-on is required there is no password reset, so a forgotten password meant no signature.
//   2. What each person signs with. A required domain can't sign with a password, and that isn't counted as a wrong one.
//   3. The round trip asks for a fresh login, comes back to the same callback, signs nobody in and hands the window a one-time code.
//   4. The code is traded once, by the signer's own session, for a proof; the proof works once, for its own person and purpose,
//      not after it expires, not in another lab, and the signature row says how it was made.
//   5. An old or missing auth_time, and another person's token, are refused.
//   6. Re-certify and bulk approval sign with a proof; someone not on the step can't sign it even with their own proof.
//   7. An optional domain signs either way. A password user signs exactly as before, with each route's old words.
//   8. A wrong password at signing counts toward the sign-in lockout; a locked account can't sign or sign in.
//   9. A Veritas support login can't start a signature.
// Run: npm run test:signature-sso

import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { verifySigner } from "../../server/eSignature";

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

  // ── Mock OpenID Connect provider (as in sso.test.ts) ─────────────────
  const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(key.publicKey.export({ format: "jwk" }) as any), kid: "k1", alg: "RS256", use: "sig" };
  let issuerUrl = "";
  const CLIENT_ID = "client-sign";
  const codes = new Map<string, any>();
  const signJwt = (payload: any) => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
    return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key.privateKey))}`;
  };
  const mock = express.Router();
  mock.use(express.urlencoded({ extended: false }));
  mock.get("/tenant-s/v2.0/.well-known/openid-configuration", (_req, res) => res.json({
    issuer: issuerUrl, authorization_endpoint: `${issuerUrl}/authorize`, token_endpoint: `${issuerUrl}/token`, jwks_uri: `${issuerUrl}/keys`,
  }));
  mock.get("/tenant-s/v2.0/keys", (_req, res) => res.json({ keys: [jwk] }));
  mock.post("/tenant-s/v2.0/token", (req, res) => {
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
  issuerUrl = `${base}/mock-idp/tenant-s/v2.0`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Sign", "sso", "9q!"].join("-");
  const WRONG_PW = ["Wrong", "Pass", "1!"].join("-"); // a password nobody has, for the wrong-password checks
  const HOSPITAL = "Example Hospital";

  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const now = new Date().toISOString();
  const mkLab = async (tag: string) => {
    const email = `sign-${tag}@owner.test`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `Sign Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id), P: `/api/labs/${prov.body.labId}/veritapolicy` };
  };
  const addEditor = async (L: { labId: number; userId: number }, email: string, name: string) => {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)").run(L.labId, userId, "staff", now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(L.labId, userId);
    sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
       VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`
    ).run(L.userId, email, userId, now, now, `sign-${userId}-${Date.now()}`, L.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const login = await call("POST", "/api/auth/login", { email, password: PW });
    return { email, userId, name, token: login.body.token as string };
  };
  const upload = async (L: { token: string; labId: number }, title: string) => {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
    fd.append("title", title);
    const r = await fetch(`${base}/api/labs/${L.labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd });
    return (await r.json().catch(() => ({}))) as any;
  };
  const route = async (L: { token: string; P: string }, name: string, signerId: number) => {
    const w = await call("POST", `${L.P}/workflows`, { name }, L.token);
    await call("POST", `${L.P}/workflows/${w.body.id}/steps`, { stepName: "Review", requiredRole: "specific_user", specificUserId: signerId }, L.token);
    return Number(w.body.id);
  };
  const inReview = async (L: { token: string; labId: number; P: string }, title: string, workflowId: number) => {
    const d = await upload(L, title);
    await call("POST", `${L.P}/documents/${d.id}/submit`, { workflowId }, L.token);
    return Number(d.id);
  };
  const signoffs = (docId: number, userId: number) =>
    sqlite.prepare("SELECT action, typed_signature, signed_with, signed_with_provider FROM policy_signoffs WHERE document_id = ? AND user_id = ? AND action <> 'submitted' ORDER BY id").all(docId, userId) as any[];
  const sessions = (userId: number) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?").get(userId) as any).n);
  const failedCount = (userId: number) => Number((sqlite.prepare("SELECT COALESCE(failed_login_count, 0) AS n FROM users WHERE id = ?").get(userId) as any).n);
  const waiter = () => b64url(crypto.randomBytes(12));

  /** One signing round trip: start -> (provider) -> callback. Returns where the window lands. */
  const signTrip = async (token: string, purpose: string, email: string, claims: Record<string, any> = {}) => {
    const w = waiter();
    const start = await call("POST", "/api/auth/signature/sso/start", { purpose, waiter: w }, token);
    if (start.status !== 200) return { start, w, q: null as any, landed: null as any, handoff: null as string | null, error: null as string | null };
    const q = new URL(start.body.url).searchParams;
    const t = Math.floor(Date.now() / 1000);
    const payload: any = { iss: issuerUrl, aud: CLIENT_ID, sub: `sub-${email}`, email, name: "Made Up", nonce: q.get("nonce"), iat: t, nbf: t, exp: t + 3600, auth_time: t, ...claims };
    for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), idToken: signJwt(payload) });
    const cb = await fetch(`${base}/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(q.get("state") || "")}`, { redirect: "manual" });
    const landed = new URL(cb.headers.get("location") || "", base);
    return { start, w, q, landed, handoff: landed.searchParams.get("h"), error: landed.searchParams.get("error") };
  };
  const proofFor = async (token: string, purpose: string, email: string) => {
    const t = await signTrip(token, purpose, email);
    const done = await call("POST", "/api/auth/signature/sso/complete", { code: t.handoff }, token);
    return String(done.body?.proof || "");
  };

  try {
    // ── Setup: a lab, two people at the hospital, a password user, a support login, another lab ──
    const A = await mkLab("a");
    const B = await mkLab("b");
    const alice = await addEditor(A, "alice@hospital.test", "Alice Made-Up");
    const bob = await addEditor(A, "bob@hospital.test", "Bob Made-Up");
    const pat = await addEditor(A, "pat@plain.test", "Pat Made-Up");
    const supReg = await call("POST", "/api/auth/register", { email: "support@hospital.test", password: PW, name: "Support Made-Up", hipaa_acknowledged: true });
    const supFlag = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: "support@hospital.test", enabled: true });
    const cfg = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer: issuerUrl, clientId: CLIENT_ID, emailDomains: ["hospital.test"], required: true });
    const cfgId = Number(cfg.body?.config?.id);
    check("0. two labs, three editors, a support login and a required hospital sign-in", !!A.labId && !!B.labId && !!alice.token && !!bob.token && !!pat.token && supFlag.status === 200 && cfg.status === 200, JSON.stringify(cfg.body).slice(0, 120));
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
    check("0. boot adds how-signed to the three signature tables and the request table", ["policy_signoffs", "policy_attestations", "maintain_record_reviews"].every((t) => cols(t).includes("signed_with") && cols(t).includes("signed_with_provider")) && cols("signature_sso_requests").includes("proof_hash") && cols("sso_login_states").includes("sign_request_id"));
    const aliceRoute = await route(A, "Alice signs", alice.userId);
    const bobRoute = await route(A, "Bob signs", bob.userId);
    const patRoute = await route(A, "Pat signs", pat.userId);
    const bRoute = await route(B, "Owner B signs", B.userId);

    // 1. The gap
    const fp = await call("POST", "/api/auth/forgot-password", { email: alice.email });
    check("1. the gap: a required domain gets no password reset, so a forgotten password meant no signature", fp.status === 200 && fp.body?.sso_required === true);

    // 2. What each person signs with
    const mAlice = await call("GET", "/api/auth/signature/method", undefined, alice.token);
    const mPat = await call("GET", "/api/auth/signature/method", undefined, pat.token);
    check("2a. a required domain signs with the hospital only", mAlice.status === 200 && mAlice.body.password === false && mAlice.body.sso?.name === HOSPITAL && mAlice.body.sso?.required === true, JSON.stringify(mAlice.body));
    check("2b. a password user signs with the password, as before", mPat.status === 200 && mPat.body.password === true && mPat.body.sso === null, JSON.stringify(mPat.body));
    const d1 = await inReview(A, "Alice Doc One (made-up)", aliceRoute);
    const before = failedCount(alice.userId);
    const pwTry = await call("POST", `${A.P}/documents/${d1}/approve`, { typedSignature: alice.name, password: PW }, alice.token);
    check("2c. a required domain can't sign with its password", pwTry.status === 403 && pwTry.body?.code === "SSO_SIGN_REQUIRED" && signoffs(d1, alice.userId).length === 0, JSON.stringify(pwTry.body));
    check("2d. and that isn't counted as a wrong password", failedCount(alice.userId) === before);

    // 3. The round trip
    const sessionsBefore = sessions(alice.userId);
    const t1 = await signTrip(alice.token, "policy_decision", alice.email);
    check("3a. start asks the hospital for a fresh login for this person, back to the sign-in callback", t1.start.status === 200 && t1.q.get("prompt") === "login" && t1.q.get("max_age") === "0" && t1.q.get("login_hint") === alice.email && t1.q.get("redirect_uri") === `${base}/api/auth/sso/callback` && t1.start.body.provider === HOSPITAL, String(t1.start.body?.url).slice(0, 160));
    check("3b. the window lands on /sso/sign-done with a one-time code and its waiter", t1.landed.pathname === "/sso/sign-done" && !!t1.handoff && !t1.error && t1.landed.searchParams.get("w") === t1.w, t1.landed.toString().slice(0, 120));
    check("3c. it signs nobody in", sessions(alice.userId) === sessionsBefore);
    check("3d. the confirmation is in the audit log", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'signature_sso' AND user_id = ?").get(alice.userId));
    const badPurpose = await call("POST", "/api/auth/signature/sso/start", { purpose: "anything", waiter: waiter() }, alice.token);
    const noAuth = await call("POST", "/api/auth/signature/sso/start", { purpose: "policy_decision", waiter: waiter() });
    check("3e. start needs a known purpose and a signed-in person", badPurpose.status === 400 && noAuth.status === 401);
    const noSso = await call("POST", "/api/auth/signature/sso/start", { purpose: "policy_decision", waiter: waiter() }, pat.token);
    check("3f. someone whose domain has no hospital sign-in is told to use the password", noSso.status === 409 && noSso.body?.code === "SSO_NOT_CONFIGURED");

    // 4. The code, then the proof
    const stolen = await call("POST", "/api/auth/signature/sso/complete", { code: t1.handoff }, bob.token);
    check("4a. another person's session can't take the code", stolen.status === 401);
    const done1 = await call("POST", "/api/auth/signature/sso/complete", { code: t1.handoff }, alice.token);
    const P1 = String(done1.body?.proof || "");
    check("4b. the signer's own session trades it for a proof bound to the purpose, for 120 seconds", done1.status === 200 && P1.length > 30 && done1.body.purpose === "policy_decision" && done1.body.provider === HOSPITAL && done1.body.expiresInSeconds === 120, JSON.stringify({ ...done1.body, proof: !!done1.body?.proof }));
    check("4c. the code works once", (await call("POST", "/api/auth/signature/sso/complete", { code: t1.handoff }, alice.token)).status === 401);
    check("4d. nothing is stored but hashes", !sqlite.prepare("SELECT 1 FROM signature_sso_requests WHERE handoff_hash = ? OR proof_hash = ?").get(t1.handoff, P1));
    const b1 = await inReview(A, "Bob Doc One (made-up)", bobRoute);
    const asBob = await call("POST", `${A.P}/documents/${b1}/approve`, { typedSignature: bob.name, ssoProof: P1 }, bob.token);
    check("4e. the proof is no use to another person", asBob.status === 401 && asBob.body?.code === "SIGN_PROOF_INVALID" && signoffs(b1, bob.userId).length === 0, JSON.stringify(asBob.body));
    const pending = (await call("GET", `${A.P}/pending-reviews`, undefined, alice.token)).body.pending as any[];
    const item = pending.find((p) => p.document_id === d1);
    const wrongPurpose = await call("POST", `${A.P}/approvals/bulk`, { typedSignature: alice.name, ssoProof: P1, items: [{ documentId: item.document_id, versionId: item.version_id, stepId: item.step_id }] }, alice.token);
    check("4f. the proof is no use for another purpose", wrongPurpose.status === 401 && wrongPurpose.body?.code === "SIGN_PROOF_INVALID" && signoffs(d1, alice.userId).length === 0, JSON.stringify(wrongPurpose.body));
    const bDoc = await inReview(B, "Lab B Doc (made-up)", bRoute);
    const otherLab = await call("POST", `${B.P}/documents/${bDoc}/approve`, { typedSignature: alice.name, ssoProof: P1 }, alice.token);
    check("4g. another lab refuses her before the proof is looked at", otherLab.status === 403 && signoffs(bDoc, alice.userId).length === 0, `HTTP ${otherLab.status}`);
    const signed = await call("POST", `${A.P}/documents/${d1}/approve`, { typedSignature: alice.name, ssoProof: P1 }, alice.token);
    const row = signoffs(d1, alice.userId)[0];
    check("4h. she signs with her proof, and the signature says how", signed.status === 200 && signed.body?.status === "approved" && row?.action === "approved" && row?.signed_with === "sso" && row?.signed_with_provider === HOSPITAL && row?.typed_signature === alice.name, JSON.stringify({ s: signed.status, b: signed.body, row }));
    const d2 = await inReview(A, "Alice Doc Two (made-up)", aliceRoute);
    const reuse = await call("POST", `${A.P}/documents/${d2}/approve`, { typedSignature: alice.name, ssoProof: P1 }, alice.token);
    check("4i. the proof works once", reuse.status === 401 && reuse.body?.code === "SIGN_PROOF_INVALID" && signoffs(d2, alice.userId).length === 0);
    const P2 = await proofFor(alice.token, "policy_decision", alice.email);
    sqlite.prepare("UPDATE signature_sso_requests SET proof_expires_at = ? WHERE used_at IS NULL AND proof_expires_at IS NOT NULL").run(new Date(Date.now() - 1000).toISOString());
    const late = await call("POST", `${A.P}/documents/${d2}/approve`, { typedSignature: alice.name, ssoProof: P2 }, alice.token);
    check("4j. a proof isn't taken after it expires", late.status === 401 && late.body?.code === "SIGN_PROOF_INVALID" && signoffs(d2, alice.userId).length === 0);
    const t2 = await signTrip(alice.token, "policy_decision", alice.email);
    sqlite.prepare("UPDATE signature_sso_requests SET handoff_expires_at = ? WHERE handed_at IS NULL AND handoff_expires_at IS NOT NULL").run(new Date(Date.now() - 1000).toISOString());
    check("4k. a code isn't taken after its minute", !!t2.handoff && (await call("POST", "/api/auth/signature/sso/complete", { code: t2.handoff }, alice.token)).status === 401);
    const missing = await call("POST", `${A.P}/documents/${d2}/approve`, { typedSignature: alice.name }, alice.token);
    check("4l. no password and no proof reads as before", missing.status === 400 && missing.body?.error === "password required for electronic signature");

    // 5. A fresh login, by the signer
    const lastRequest = Number((sqlite.prepare("SELECT COALESCE(MAX(id), 0) AS n FROM signature_sso_requests").get() as any).n);
    const old = await signTrip(alice.token, "policy_decision", alice.email, { auth_time: Math.floor(Date.now() / 1000) - 3600 });
    check("5a. an hour-old hospital sign-in is refused", old.error === "not_fresh" && !old.handoff && old.landed.pathname === "/sso/sign-done", old.landed?.toString().slice(0, 120));
    const before5 = await signTrip(alice.token, "policy_decision", alice.email, { auth_time: Math.floor(Date.now() / 1000) - 400 });
    check("5b. a sign-in from before she asked (over five minutes ago) is refused", before5.error === "not_fresh" && !before5.handoff);
    const noTime = await signTrip(alice.token, "policy_decision", alice.email, { auth_time: undefined });
    check("5c. a token with no auth_time is refused", noTime.error === "not_fresh" && !noTime.handoff);
    const someoneElse = await signTrip(alice.token, "policy_decision", alice.email, { email: bob.email, preferred_username: bob.email });
    check("5d. another person's token is refused", someoneElse.error === "wrong_person" && !someoneElse.handoff);
    check("5e. none of those left a code to trade", Number((sqlite.prepare("SELECT COUNT(*) AS n FROM signature_sso_requests WHERE id > ?").get(lastRequest) as any).n) === 4 && !sqlite.prepare("SELECT 1 FROM signature_sso_requests WHERE id > ? AND handoff_hash IS NOT NULL").get(lastRequest));
    const replay = await fetch(`${base}/api/auth/sso/callback?code=x&state=${encodeURIComponent(t1.q.get("state") || "")}`, { redirect: "manual" });
    check("5f. a used signing state goes back to the signing window, never the sign-in page", new URL(replay.headers.get("location") || "", base).pathname === "/sso/sign-done");

    // 6. Re-certify and bulk approval; someone not on the step
    const PR = await proofFor(alice.token, "policy_recertify", alice.email);
    const recert = await call("POST", `${A.P}/documents/${d1}/recertify`, { typedSignature: alice.name, ssoProof: PR }, alice.token);
    const recRow = signoffs(d1, alice.userId).find((r) => r.action === "recertified");
    check("6a. re-certify signs with a proof for its purpose", recert.status === 200 && recRow?.signed_with === "sso" && recRow?.signed_with_provider === HOSPITAL, JSON.stringify({ s: recert.status, b: recert.body, recRow }));
    const recPw = await call("POST", `${A.P}/documents/${d1}/recertify`, { typedSignature: alice.name, password: PW }, alice.token);
    check("6b. and refuses her password", recPw.status === 403 && recPw.body?.code === "SSO_SIGN_REQUIRED");
    const PB = await proofFor(alice.token, "policy_bulk_approve", alice.email);
    const queue = ((await call("GET", `${A.P}/pending-reviews`, undefined, alice.token)).body.pending as any[]).filter((p) => p.document_id === d2);
    const bulk = await call("POST", `${A.P}/approvals/bulk`, { typedSignature: alice.name, ssoProof: PB, items: queue.map((p) => ({ documentId: p.document_id, versionId: p.version_id, stepId: p.step_id })) }, alice.token);
    check("6c. bulk approval signs each document with one proof", bulk.status === 200 && bulk.body?.signed === 1 && signoffs(d2, alice.userId)[0]?.signed_with === "sso", JSON.stringify(bulk.body));
    const d3 = await inReview(A, "Alice Doc Three (made-up)", aliceRoute);
    const PBob = await proofFor(bob.token, "policy_decision", bob.email);
    const notHis = await call("POST", `${A.P}/documents/${d3}/approve`, { typedSignature: bob.name, ssoProof: PBob }, bob.token);
    check("6d. someone not on the step can't sign it with their own proof", notHis.status === 403 && signoffs(d3, bob.userId).length === 0, JSON.stringify(notHis.body));

    // 7. Optional domain; a password user exactly as before
    await call("POST", "/api/admin/sso/configs", { secret: ADMIN, id: cfgId, required: false });
    const mOpt = await call("GET", "/api/auth/signature/method", undefined, alice.token);
    check("7a. an optional domain offers either", mOpt.body.password === true && mOpt.body.sso?.required === false, JSON.stringify(mOpt.body));
    const optPw = await call("POST", `${A.P}/documents/${d3}/approve`, { typedSignature: alice.name, password: PW }, alice.token);
    check("7b. and signs with the password, recorded so", optPw.status === 200 && signoffs(d3, alice.userId)[0]?.signed_with === "password" && signoffs(d3, alice.userId)[0]?.signed_with_provider === null, JSON.stringify(optPw.body));
    const d4 = await inReview(A, "Alice Doc Four (made-up)", aliceRoute);
    const POpt = await proofFor(alice.token, "policy_decision", alice.email);
    const optSso = await call("POST", `${A.P}/documents/${d4}/approve`, { typedSignature: alice.name, ssoProof: POpt }, alice.token);
    check("7c. or with the hospital sign-in", optSso.status === 200 && signoffs(d4, alice.userId)[0]?.signed_with === "sso");
    const p1 = await inReview(A, "Pat Doc One (made-up)", patRoute);
    const patOk = await call("POST", `${A.P}/documents/${p1}/approve`, { typedSignature: pat.name, password: PW }, pat.token);
    check("7d. a password user signs as before", patOk.status === 200 && patOk.body?.status === "approved" && signoffs(p1, pat.userId)[0]?.signed_with === "password", JSON.stringify(patOk.body));
    // Each route's words and status from before S0, read off the routes' old code.
    const OLD: Record<string, [string, string, string, string]> = {
      policy_decision: ["typedSignature required (full name)", "password required for electronic signature", "User has no password set; cannot sign electronically", "Password incorrect; signature not recorded"],
      policy_bulk_approve: ["typedSignature required (full name)", "password required for electronic signature", "User has no password set; cannot sign electronically", "Password incorrect; signature not recorded"],
      policy_recertify: ["typedSignature required", "password required", "User has no password set", "Password incorrect; re-certification not recorded"],
      policy_attest: ["typedSignature required", "password required for electronic signature", "User has no password set", "Password incorrect; attestation not recorded"],
      maintain_review: ["Type your full name to sign", "Enter your password to sign", "User has no password set", "Password incorrect; the review was not signed"],
    };
    const noHash = Number((await call("POST", "/api/auth/register", { email: "nohash@plain.test", password: PW, name: "No Hash", hipaa_acknowledged: true })).body.user?.id);
    sqlite.prepare("UPDATE users SET password_hash = '' WHERE id = ?").run(noHash);
    for (const [purpose, [nameErr, credErr, noPwErr, wrongErr]] of Object.entries(OLD)) {
      const n = await verifySigner(sqlite, pat.userId, { typedName: "P", password: PW, purpose: purpose as any });
      const c = await verifySigner(sqlite, pat.userId, { typedName: pat.name, password: "", purpose: purpose as any });
      const h = await verifySigner(sqlite, noHash, { typedName: "No Hash", password: PW, purpose: purpose as any });
      const w = await verifySigner(sqlite, pat.userId, { typedName: pat.name, password: WRONG_PW, purpose: purpose as any });
      const ok = await verifySigner(sqlite, pat.userId, { typedName: pat.name, password: PW, purpose: purpose as any });
      const same = (v: any, s: number, e: string) => !v.ok && v.status === s && v.body.error === e && !v.body.code;
      check(`7e. ${purpose}: the old statuses and words`, same(n, 400, nameErr) && same(c, 400, credErr) && same(h, 401, noPwErr) && same(w, 401, wrongErr) && ok.ok === true && (ok as any).signedWith.method === "password", JSON.stringify([n, c, h, w].map((v: any) => v.body?.error)));
    }

    // 8. Lockout
    const countBefore = failedCount(pat.userId);
    const p2 = await inReview(A, "Pat Doc Two (made-up)", patRoute);
    await call("POST", `${A.P}/documents/${p2}/approve`, { typedSignature: pat.name, password: WRONG_PW }, pat.token);
    check("8a. a wrong password at signing counts toward the lockout", failedCount(pat.userId) === countBefore + 1, `${countBefore} -> ${failedCount(pat.userId)}`);
    await call("POST", `${A.P}/documents/${p2}/approve`, { typedSignature: pat.name, password: PW }, pat.token);
    check("8b. the right one clears the count, as a sign-in does", failedCount(pat.userId) === 0);
    const lockSet = await call("PUT", "/api/auth/security-settings", { password: PW, settings: { lockoutAttempts: 3 } }, A.token);
    check("8c. the owner turns the lockout on (3)", lockSet.status === 200 && lockSet.body?.settings?.lockoutAttempts === 3, JSON.stringify(lockSet.body).slice(0, 120));
    const p3 = await inReview(A, "Pat Doc Three (made-up)", patRoute);
    for (let i = 0; i < 3; i++) await call("POST", `${A.P}/documents/${p3}/approve`, { typedSignature: pat.name, password: WRONG_PW }, pat.token);
    const lockedRow = sqlite.prepare("SELECT failed_login_count, locked_at FROM users WHERE id = ?").get(pat.userId) as any;
    check("8d. three wrong passwords at signing lock the account", !!lockedRow?.locked_at && Number(lockedRow.failed_login_count) === 3, JSON.stringify(lockedRow));
    check("8e. the lock is in the audit log", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'account.locked' AND user_id = ?").get(pat.userId));
    const lockedSign = await call("POST", `${A.P}/documents/${p3}/approve`, { typedSignature: pat.name, password: PW }, pat.token);
    check("8f. a locked account can't sign, even with the right password", lockedSign.status === 423 && lockedSign.body?.code === "ACCOUNT_LOCKED" && signoffs(p3, pat.userId).length === 0);
    const lockedLogin = await call("POST", "/api/auth/login", { email: pat.email, password: PW });
    check("8g. and can't sign in: it is the sign-in lockout", lockedLogin.status === 423 && lockedLogin.body?.code === "ACCOUNT_LOCKED");

    // 9. Veritas support
    const supStart = await call("POST", "/api/auth/signature/sso/start", { purpose: "policy_decision", waiter: waiter() }, supReg.body.token);
    const supMethod = await call("GET", "/api/auth/signature/method", undefined, supReg.body.token);
    check("9a. a Veritas support login can't start a signature", supStart.status === 403 && supStart.body?.code === "SUPPORT_CANNOT_SIGN", JSON.stringify(supStart.body));
    check("9b. and is never offered the hospital sign-in", supMethod.body?.sso === null);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
