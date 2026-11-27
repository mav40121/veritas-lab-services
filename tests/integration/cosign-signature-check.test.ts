// tests/integration/cosign-signature-check.test.ts
//
// BUG-205 (2026-11-27): the monthly VeritaQC co-sign (POST /api/labs/:labId/qc/period-reviews/md-cosign) and a VeritaResponse
// finding's sign-off (POST /api/labs/:labId/findings/:id/signoff) recorded the signed-in user and a typed name, with no password.
// Every other director signature re-checks the person at the moment of signing. Both now go through the one signature check
// (server/eSignature.ts verifySigner, purposes qc_md_cosign and finding_signoff), as the VeritaCheck verification signatures and
// the VeritaMaintain monthly review do. Boots the REAL routes on a scratch SQLite file, with a made-up OpenID Connect provider on
// its own local port for the hospital sign-in. Made-up labs and people only. Proves, for both routes:
//   1, 2. the right password signs and the stored row names the signer (the typed name, the user id, signed with a password);
//         a wrong password and no password are refused and nothing is stored; the medical director signs from a view-only
//         seat (PR 1996's allowance), a designee signs as "(designee)", and a view-only seat with no role is still refused
//   3. the owner override signs with a password and stays labelled "(owner override)"
//   4. where the signer's domain requires single sign-on, a password is refused and the hospital sign-in is asked for again
//      (a fresh login, through the same callback), its proof signs once, for its own purpose only, recorded as sso; the director
//      here is on a view-only seat, whose gate refused the sign-in's start and complete before (so they could sign nothing)
//      and still refuses every other write
//   5. another lab's director and a Veritas support login are refused, and nothing is stored
//   6. a co-signature and a sign-off stored before this change read back unchanged
//   7. each signature has one write path in the server, so no other caller writes one without the check
// Run: npm run test:cosign-signature-check
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { inspectionWorld, type Login } from "./inspectionFixture";

const PW = ["In", "spect", "7x!"].join("-"); // inspectionFixture's made-up password
const WRONG = ["Not", "the", "pw", "9"].join("-"); // a password nobody has
const HOSPITAL = "Example Hospital";
const CLIENT_ID = "made-up-client";
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const w = await inspectionWorld("csc");
  const { sqlite, base, call, check, seed, member, seat, login, one, all, finish, A, B, X, OWNER, OTHER, VIEWER, SUPPORT, ADMIN, stamp, now } = w;
  const { isQualifiedSigningRequest } = await import("../../server/qualifiedSigning");
  const { buildMonthlyReviewPayload } = await import("../../server/qcMonthlyReviewPayload");

  // ── A made-up OpenID Connect provider on its own port (as in signature-sso.test.ts) ──
  const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(key.publicKey.export({ format: "jwk" }) as any), kid: "k1", alg: "RS256", use: "sig" };
  const codes = new Map<string, any>();
  const signJwt = (payload: any) => {
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
    return `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key.privateKey))}`;
  };
  let issuer = "";
  const idp = express();
  idp.use(express.urlencoded({ extended: false }));
  idp.get("/tenant/v2.0/.well-known/openid-configuration", (_q, r) => r.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/keys` }));
  idp.get("/tenant/v2.0/keys", (_q, r) => r.json({ keys: [jwk] }));
  idp.post("/tenant/v2.0/token", (q, r) => {
    const c = codes.get(String(q.body.code));
    if (!c) return r.status(400).json({ error: "invalid_grant" });
    codes.delete(String(q.body.code));
    const verifier = b64url(crypto.createHash("sha256").update(String(q.body.code_verifier || "")).digest());
    if (verifier !== c.challenge || q.body.redirect_uri !== c.redirectUri) return r.status(400).json({ error: "invalid_grant" });
    r.json({ id_token: c.idToken, token_type: "Bearer" });
  });
  const idpServer = http.createServer(idp);
  await new Promise<void>((r) => idpServer.listen(0, "127.0.0.1", r));
  const ia = idpServer.address();
  issuer = `http://127.0.0.1:${typeof ia === "object" && ia ? ia.port : 0}/tenant/v2.0`;

  // ── People ──────────────────────────────────────────────────────────────
  const viewOnly = (lab: number, u: Login, ownerId = OWNER.id) => { member(lab, u); seat(ownerId, u, lab, { type: "view_only", perms: { mode: "view_all" } }); };
  const MD = await login("director", "Dana Director"); viewOnly(A, MD);
  sqlite.prepare("UPDATE labs SET medical_director_email = ?, medical_director_name = 'Dana Director' WHERE id = ?").run(MD.email, A);
  // A technical supervisor named in a signed Letter of Delegation for both signatures (a test with no map row reads as high).
  const TS = await login("ts", "Taylor Supervisor"); viewOnly(A, TS);
  seed("director_delegations", {
    lab_id: A, delegate_user_id: TS.id, delegate_name: TS.name, position: "technical_supervisor", complexity_scope: "high",
    responsibilities_json: JSON.stringify({ qc_period_cosign: true, finding_closure: true }), signed_by_user_id: MD.id, signed_name: "Dana Director",
    signed_at: now, status: "active", created_at: now, updated_at: now,
  });
  const XMD = await login("xdirector", "Xan Xdirector"); viewOnly(X, XMD, OTHER.id);
  sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(XMD.email, X);
  // Lab B's director signs in through their hospital, which requires single sign-on.
  const hospEmail = `csc-hosp-${stamp}@csc-hospital.test`;
  const hospReg = await call(null, "POST", "/api/auth/register", { email: hospEmail, password: PW, name: "Harper Hospital", hipaa_acknowledged: true });
  const HOSP: Login = { id: Number(one("SELECT id FROM users WHERE email = ?", hospEmail)?.id), email: hospEmail, name: "Harper Hospital", token: hospReg.j?.token };
  viewOnly(B, HOSP);
  sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(HOSP.email, B);
  const cfg = await call(null, "POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer, clientId: CLIENT_ID, emailDomains: ["csc-hospital.test"], required: true });
  const seatOf = (u: Login, lab: number) => one("SELECT seat_type FROM user_seats WHERE seat_user_id = ? AND lab_id = ?", u.id, lab)?.seat_type;
  check("0. setup: the director, the designee and a plain reviewer on view-only seats in lab A; lab X's director; lab B's director at a hospital that requires single sign-on",
    [MD, TS, VIEWER].every((u) => seatOf(u, A) === "view_only") && seatOf(XMD, X) === "view_only" && seatOf(HOSP, B) === "view_only" && !!HOSP.token && cfg.s === 200, `${cfg.s} ${cfg.text.slice(0, 160)}`);
  check("0. both routes are still on the one list of signatures a view-only seat may make (PR 1996)",
    isQualifiedSigningRequest("POST", `/api/labs/${A}/qc/period-reviews/md-cosign`) && isQualifiedSigningRequest("POST", `/api/labs/${A}/findings/7/signoff`));

  // ── Records ─────────────────────────────────────────────────────────────
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [py, pm] = lastMonth.split("-").map(Number);
  sqlite.prepare("UPDATE labs SET qc_md_cosign_required = 1 WHERE id IN (?, ?, ?)").run(A, B, X);
  let lotNo = 0;
  const lot = (lab: number) => seed("qc_control_lots", { lab_id: lab, analyte: "Glucose", level: "mid", lot_number: `MU-${++lotNo}`, mfr_mean: 100, mfr_sd: 2 });
  const filed = (lab: number, lotId: number, extra: Record<string, any> = {}) => seed("qc_period_reviews", {
    lab_id: lab, control_lot_id: lotId, period_month: pm, period_year: py, reviewed_by_user_id: OWNER.id, reviewed_at: now, attestation_acknowledged: 1, created_at: now, ...extra,
  });
  const review = (id: number) => one("SELECT md_signed_at, md_signed_by_user_id, md_signed_name, md_signed_with, md_signed_with_provider FROM qc_period_reviews WHERE id = ?", id);
  const unsigned = (id: number) => { const r = review(id); return !r.md_signed_at && r.md_signed_by_user_id == null && r.md_signed_name == null; };
  const cosign = (u: Login, lab: number, lotId: number, extra: Record<string, any>) =>
    call(u, "POST", `/api/labs/${lab}/qc/period-reviews/md-cosign`, { control_lot_id: lotId, period_year: py, period_month: pm, ...extra }, lab);
  const cosignAudits = (id: number) => all("SELECT * FROM audit_log WHERE entity_type = 'qc_period_review.md_cosign' AND entity_id = ? ORDER BY id", String(id));
  const finding = (lab: number, extra: Record<string, any> = {}) => seed("findings", { user_id: OWNER.id, lab_id: lab, accreditor: "CAP", status: "open", created_at: now, updated_at: now, ...extra });
  const F = (id: number) => one("SELECT status, signed_by, signed_at, signoff_role, signed_with, signed_with_provider FROM findings WHERE id = ?", id);
  const stillOpen = (id: number) => { const f = F(id); return f.status === "open" && f.signed_by == null && f.signoff_role == null; };
  const signoff = (u: Login, lab: number, id: number, body: Record<string, any>) => call(u, "POST", `/api/labs/${lab}/findings/${id}/signoff`, body, lab);
  const signedOffHistory = (id: number) => all("SELECT payload FROM finding_history WHERE finding_id = ? AND event = 'signed_off'", id).map((h) => JSON.parse(h.payload || "{}"));
  const failed = (u: Login) => Number(one("SELECT COALESCE(failed_login_count, 0) AS n FROM users WHERE id = ?", u.id)?.n);

  // ── 1. The QC co-sign ───────────────────────────────────────────────────
  const m = await call(MD, "GET", "/api/auth/signature/method", undefined, A);
  check("1a. the director signs with a password (no hospital sign-in on their domain)", m.s === 200 && m.j?.password === true && m.j?.sso === null, m.text);
  const lot1 = lot(A), r1 = filed(A, lot1);
  const noPw = await cosign(MD, A, lot1, { typed_name: "Dana Director, MD" });
  check("1b. no password: refused, and nothing is stored", noPw.s === 400 && noPw.j?.error === "Enter your password to sign" && unsigned(r1) && cosignAudits(r1).length === 0, `${noPw.s} ${noPw.text}`);
  const noName = await cosign(MD, A, lot1, { password: PW });
  check("1c. no typed name: refused, and nothing is stored (it used to fall back to the account name)", noName.s === 400 && noName.j?.error === "Type your full name to sign" && unsigned(r1), `${noName.s} ${noName.text}`);
  const before = failed(MD);
  const wrong = await cosign(MD, A, lot1, { typed_name: "Dana Director, MD", password: WRONG });
  check("1d. a wrong password: refused, nothing is stored, and it counts toward the sign-in lockout", wrong.s === 401 && wrong.j?.error === "Password incorrect; the review was not co-signed" && unsigned(r1) && failed(MD) === before + 1 && cosignAudits(r1).length === 0, `${wrong.s} ${wrong.text}`);
  const ok = await cosign(MD, A, lot1, { typed_name: "Dana Director, MD", password: PW });
  const s1 = review(r1);
  check("1e. the right password co-signs from the view-only seat, and the stored review names the signer as typed, signed with a password",
    ok.s === 200 && ok.j?.signed_as === "medical_director" && ok.j?.signed_with === "password" && !!s1.md_signed_at && s1.md_signed_by_user_id === MD.id && s1.md_signed_name === "Dana Director, MD" && s1.md_signed_with === "password" && s1.md_signed_with_provider == null,
    `${ok.s} ${ok.text} ${JSON.stringify(s1)}`);
  check("1f. the right password clears the wrong-password count", failed(MD) === 0, String(failed(MD)));
  const a1 = cosignAudits(r1);
  const a1b = JSON.parse(a1[0]?.before_json || "{}"), a1a = JSON.parse(a1[0]?.after_json || "{}");
  check("1g. one VeritaQC audit row: who, before (unsigned) and after (the signature and how it was made)",
    a1.length === 1 && a1[0].user_id === MD.id && a1[0].module === "veritaqc" && a1b.md_signed_at == null && a1a.md_signed_name === "Dana Director, MD" && a1a.md_signed_with === "password" && a1a.lab_id === A, JSON.stringify(a1[0] || {}).slice(0, 300));
  const lot2 = lot(A), r2 = filed(A, lot2);
  const ts = await cosign(TS, A, lot2, { typed_name: "Taylor Supervisor", password: PW });
  check("1h. a designee holding the QC co-sign duty signs with their password, labelled (designee)", ts.s === 200 && ts.j?.signed_as === "designee" && review(r2).md_signed_by_user_id === TS.id && review(r2).md_signed_name === "Taylor Supervisor (designee)" && review(r2).md_signed_with === "password", `${ts.s} ${ts.text}`);
  const lot3 = lot(A), r3 = filed(A, lot3);
  const viewer = await cosign(VIEWER, A, lot3, { typed_name: VIEWER.name, password: PW });
  check("1i. a view-only seat with no director role or duty is refused by the route, even with the right password", viewer.s === 403 && /Only the medical director/.test(viewer.j?.error || "") && unsigned(r3), `${viewer.s} ${viewer.text}`);
  const lotNotFiled = lot(A);
  const notFiled = await cosign(MD, A, lotNotFiled, { typed_name: "Dana Director", password: PW });
  check("1j. the review must be filed first, as before", notFiled.s === 409 && !one("SELECT 1 AS x FROM qc_period_reviews WHERE control_lot_id = ?", lotNotFiled), `${notFiled.s} ${notFiled.text}`);

  // ── 2. A finding's sign-off ─────────────────────────────────────────────
  const f1 = finding(A), f2 = finding(A), f3 = finding(A);
  const fNoPw = await signoff(MD, A, f1, { signed_by: "Dana Director, MD" });
  check("2a. no password: refused, the finding stays open, nothing in its history", fNoPw.s === 400 && fNoPw.j?.error === "Enter your password to sign" && stillOpen(f1) && signedOffHistory(f1).length === 0, `${fNoPw.s} ${fNoPw.text}`);
  const fNoName = await signoff(MD, A, f1, { password: PW });
  check("2b. no typed name: refused, the finding stays open", fNoName.s === 400 && fNoName.j?.error === "Type your full name to sign" && stillOpen(f1), `${fNoName.s} ${fNoName.text}`);
  const fWrong = await signoff(MD, A, f1, { signed_by: "Dana Director, MD", password: WRONG });
  check("2c. a wrong password: refused, the finding stays open", fWrong.s === 401 && fWrong.j?.error === "Password incorrect; the finding was not signed off" && stillOpen(f1) && signedOffHistory(f1).length === 0, `${fWrong.s} ${fWrong.text}`);
  const fOk = await signoff(MD, A, f1, { signed_by: "Dana Director, MD", password: PW });
  const g1 = F(f1), h1 = signedOffHistory(f1);
  check("2d. the right password signs off from the view-only seat: closed, the typed name stored, signed with a password",
    fOk.s === 200 && g1.status === "closed" && g1.signed_by === "Dana Director, MD" && g1.signoff_role === "medical_director" && !!g1.signed_at && g1.signed_with === "password" && g1.signed_with_provider == null,
    `${fOk.s} ${fOk.text.slice(0, 200)} ${JSON.stringify(g1)}`);
  check("2e. its history says who, as what, and how it was signed", h1.length === 1 && h1[0].signoff_role === "medical_director" && h1[0].signed_by === "Dana Director, MD" && h1[0].signed_with === "password" && h1[0].status_before === "open"
    && !!one("SELECT 1 AS x FROM finding_history WHERE finding_id = ? AND event = 'signed_off' AND by_user_id = ?", f1, MD.id), JSON.stringify(h1));
  const fTs = await signoff(TS, A, f2, { signed_by: "Taylor Supervisor", password: PW });
  check("2f. a designee delegated finding closure signs off with their password", fTs.s === 200 && F(f2).signoff_role === "designee" && F(f2).signed_by === "Taylor Supervisor" && F(f2).signed_with === "password", `${fTs.s} ${fTs.text.slice(0, 200)}`);
  const fViewer = await signoff(VIEWER, A, f3, { signed_by: VIEWER.name, password: PW });
  check("2g. a view-only seat with no director role or duty is refused by the route, even with the right password", fViewer.s === 403 && fViewer.j?.error !== "view_only_seat" && stillOpen(f3), `${fViewer.s} ${fViewer.text}`);

  // ── 3. The owner override signs the same way ────────────────────────────
  const oNo = await cosign(OWNER, A, lot3, { typed_name: "Avery Owner" });
  const oWrong = await cosign(OWNER, A, lot3, { typed_name: "Avery Owner", password: WRONG });
  check("3a. the owner override without a password, or with a wrong one, is refused and stores nothing", oNo.s === 400 && oWrong.s === 401 && unsigned(r3), `${oNo.s} ${oWrong.s}`);
  const oOk = await cosign(OWNER, A, lot3, { typed_name: "Avery Owner", password: PW });
  check("3b. the owner override co-signs with a password and stays labelled (owner override)", oOk.s === 200 && oOk.j?.signed_as === "owner_override" && review(r3).md_signed_name === "Avery Owner (owner override)" && review(r3).md_signed_by_user_id === OWNER.id && review(r3).md_signed_with === "password", `${oOk.s} ${oOk.text}`);
  const fo1 = finding(A);
  const foNo = await signoff(OWNER, A, fo1, { signed_by: "Avery Owner" });
  const foOk = await signoff(OWNER, A, fo1, { signed_by: "Avery Owner", password: PW });
  check("3c. the owner's finding sign-off needs the password too, and is recorded as the override", foNo.s === 400 && foOk.s === 200 && F(fo1).signoff_role === "owner_override" && F(fo1).signed_by === "Avery Owner" && F(fo1).signed_with === "password", `${foNo.s} ${foOk.s} ${JSON.stringify(F(fo1))}`);

  // ── 4. A hospital that requires single sign-on: asked for again ─────────
  const hm = await call(HOSP, "GET", "/api/auth/signature/method", undefined, B);
  check("4a. lab B's director signs with the hospital sign-in only", hm.s === 200 && hm.j?.password === false && hm.j?.sso?.name === HOSPITAL && hm.j?.sso?.required === true, hm.text);
  const lotB = lot(B), rB = filed(B, lotB), lotB2 = lot(B), rB2 = filed(B, lotB2);
  const hBefore = failed(HOSP);
  const hPw = await cosign(HOSP, B, lotB, { typed_name: "Harper Hospital", password: PW });
  check("4b. a password can't co-sign there, nothing is stored, and it isn't counted as a wrong password", hPw.s === 403 && hPw.j?.code === "SSO_SIGN_REQUIRED" && unsigned(rB) && failed(HOSP) === hBefore, `${hPw.s} ${hPw.text}`);
  /** One signing round trip: start, the provider's fresh login, the same callback, then the one-time code traded for a proof. */
  const proofFor = async (u: Login, purpose: string) => {
    const waiter = b64url(crypto.randomBytes(12));
    const start = await call(u, "POST", "/api/auth/signature/sso/start", { purpose, waiter }, B);
    if (start.s !== 200) return { start, q: null as URLSearchParams | null, landed: null as URL | null, proof: "" };
    const q = new URL(start.j.url).searchParams;
    const t = Math.floor(Date.now() / 1000);
    const idToken = signJwt({ iss: issuer, aud: CLIENT_ID, sub: `sub-${u.email}`, email: u.email, name: u.name, nonce: q.get("nonce"), iat: t, nbf: t, exp: t + 3600, auth_time: t });
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri"), idToken });
    const cb = await fetch(`${base}/api/auth/sso/callback?code=${code}&state=${encodeURIComponent(q.get("state") || "")}`, { redirect: "manual" });
    const landed = new URL(cb.headers.get("location") || "", base);
    const done = await call(u, "POST", "/api/auth/signature/sso/complete", { code: landed.searchParams.get("h") }, B);
    return { start, q, landed, proof: String(done.j?.proof || ""), done };
  };
  const pc = await proofFor(HOSP, "qc_md_cosign");
  check("4c. the co-sign asks the hospital for a fresh login for this person, back through the same sign-in callback",
    pc.start.s === 200 && pc.q?.get("prompt") === "login" && pc.q?.get("max_age") === "0" && pc.q?.get("login_hint") === HOSP.email && pc.q?.get("redirect_uri") === `${base}/api/auth/sso/callback`,
    `${pc.start.s} ${pc.start.text.slice(0, 160)}`);
  check("4d. the window gets a one-time code, which the signer's own session trades for a proof bound to the co-sign", pc.landed?.pathname === "/sso/sign-done" && pc.proof.length > 30 && (pc as any).done?.j?.purpose === "qc_md_cosign", `${pc.landed} ${JSON.stringify((pc as any).done?.j || {}).slice(0, 160)}`);
  const pf = await proofFor(HOSP, "finding_signoff");
  check("4e. the finding sign-off asks for its own fresh login and proof", pf.start.s === 200 && pf.q?.get("prompt") === "login" && pf.proof.length > 30 && (pf as any).done?.j?.purpose === "finding_signoff", `${pf.start.s} ${pf.start.text.slice(0, 160)}`);
  const crossed = await cosign(HOSP, B, lotB, { typed_name: "Harper Hospital", sso_proof: pf.proof });
  check("4f. a proof asked for a finding's sign-off can't co-sign a review", crossed.s === 401 && crossed.j?.code === "SIGN_PROOF_INVALID" && unsigned(rB), `${crossed.s} ${crossed.text}`);
  const hOk = await cosign(HOSP, B, lotB, { typed_name: "Harper Hospital", sso_proof: pc.proof });
  check("4g. the fresh hospital sign-in co-signs, recorded as signed with the hospital's sign-in", hOk.s === 200 && hOk.j?.signed_with === "sso" && review(rB).md_signed_by_user_id === HOSP.id && review(rB).md_signed_name === "Harper Hospital" && review(rB).md_signed_with === "sso" && review(rB).md_signed_with_provider === HOSPITAL, `${hOk.s} ${hOk.text} ${JSON.stringify(review(rB))}`);
  const reuse = await cosign(HOSP, B, lotB2, { typed_name: "Harper Hospital", sso_proof: pc.proof });
  check("4h. the same proof doesn't sign a second time", reuse.s === 401 && reuse.j?.code === "SIGN_PROOF_INVALID" && unsigned(rB2), `${reuse.s} ${reuse.text}`);
  const fB = finding(B);
  const fbPw = await signoff(HOSP, B, fB, { signed_by: "Harper Hospital", password: PW });
  check("4i. a password can't sign off a finding there either", fbPw.s === 403 && fbPw.j?.code === "SSO_SIGN_REQUIRED" && stillOpen(fB), `${fbPw.s} ${fbPw.text}`);
  const fbOk = await signoff(HOSP, B, fB, { signed_by: "Harper Hospital", sso_proof: pf.proof });
  check("4j. its own fresh hospital sign-in signs it off, recorded as signed with the hospital's sign-in", fbOk.s === 200 && F(fB).status === "closed" && F(fB).signed_by === "Harper Hospital" && F(fB).signed_with === "sso" && F(fB).signed_with_provider === HOSPITAL, `${fbOk.s} ${fbOk.text.slice(0, 200)}`);
  // Lab B's director is on a view-only seat: 4c to 4j need the hospital sign-in's two requests through the view-only gate. Only those.
  const hFile = await call(HOSP, "POST", `/api/labs/${B}/qc/period-reviews`, { control_lot_id: lotB2, period_year: py, period_month: pm, attestation_acknowledged: true }, B);
  const hSetting = await call(HOSP, "POST", `/api/labs/${B}/qc/md-cosign-setting`, { required: false }, B);
  check("4k. the same view-only seat is still refused every other write (filing the review, the co-sign setting)", hFile.s === 403 && hFile.j?.error === "view_only_seat" && hSetting.s === 403 && hSetting.j?.error === "view_only_seat", `${hFile.s} ${hSetting.s}`);

  // ── 5. Another lab's director, and Veritas support ──────────────────────
  const lot5 = lot(A), r5 = filed(A, lot5), f5 = finding(A);
  const xa = await cosign(XMD, A, lot5, { typed_name: "Xan Xdirector", password: PW });
  const xaF = await signoff(XMD, A, f5, { signed_by: "Xan Xdirector", password: PW });
  check("5a. another customer's director, with their own right password, can't co-sign or sign off in lab A", [403, 404].includes(xa.s) && [403, 404].includes(xaF.s) && unsigned(r5) && stillOpen(f5), `${xa.s} ${xaF.s}`);
  const xOwnUrl = await cosign(XMD, X, lot5, { typed_name: "Xan Xdirector", password: PW });
  const xOwnUrlF = await signoff(XMD, X, f5, { signed_by: "Xan Xdirector", password: PW });
  check("5b. nor by naming lab A's review or finding under their own lab", xOwnUrl.s === 409 && xOwnUrlF.s === 404 && unsigned(r5) && stillOpen(f5), `${xOwnUrl.s} ${xOwnUrlF.s}`);
  const lotX = lot(X), rX = filed(X, lotX);
  const xOwn = await cosign(XMD, X, lotX, { typed_name: "Xan Xdirector", password: PW });
  check("5c. and they co-sign in their own lab with their password (decided in the record's own lab)", xOwn.s === 200 && review(rX).md_signed_by_user_id === XMD.id && review(rX).md_signed_with === "password", `${xOwn.s} ${xOwn.text}`);
  const sup = await cosign(SUPPORT, A, lot5, { typed_name: "Vera Support", password: PW });
  const supF = await signoff(SUPPORT, A, f5, { signed_by: "Vera Support", password: PW });
  check("5d. Veritas support can't co-sign or sign off, even with its own right password", sup.s === 403 && sup.j?.code === "VLS_SUPPORT_CANNOT_SIGN" && supF.s === 403 && supF.j?.code === "VLS_SUPPORT_CANNOT_SIGN" && unsigned(r5) && stillOpen(f5), `${sup.s} ${sup.text} ${supF.s}`);
  check("5e. none of the refusals wrote a co-sign audit row", cosignAudits(r5).length === 0 && cosignAudits(r3).length === 1 && cosignAudits(rB2).length === 0);

  // ── 6. Signatures stored before this change stay as they are ────────────
  const lotOld = lot(A);
  const old = { md_signed_at: "2026-09-30 14:05:00", md_signed_by_user_id: MD.id, md_signed_name: "Dana Director" };
  const rOld = filed(A, lotOld, old);
  const listed = (await call(MD, "GET", `/api/labs/${A}/qc/period-reviews?control_lot_id=${lotOld}`, undefined, A)).j?.reviews?.find((r: any) => r.id === rOld);
  const labRow = one("SELECT id, lab_name, clia_number FROM labs WHERE id = ?", A);
  const lotRow = one("SELECT id, analyte, level, lot_number, manufacturer, mfr_mean, mfr_sd, mfr_sd_interval, mfr_range_low, mfr_range_high FROM qc_control_lots WHERE id = ?", lotOld);
  const payload: any = buildMonthlyReviewPayload(sqlite, A, lotRow, labRow, py, pm);
  check("6a. a co-signature stored before reads back unchanged on the screen and the monthly PDF, with no how-signed recorded",
    listed?.md_signed_at === old.md_signed_at && listed?.md_signed_by_user_id === MD.id && listed?.md_signed_name === "Dana Director" && review(rOld).md_signed_with == null
    && payload?.mdSignedName === "Dana Director" && payload?.mdSignedDate === "2026-09-30", `${JSON.stringify(listed)} ${payload?.mdSignedName} ${payload?.mdSignedDate}`);
  const fOld = finding(A, { status: "closed", signed_by: "Pat Prior", signed_at: "2026-09-29T15:00:00.000Z", signoff_role: "medical_director", completion_date: "2026-09-29" });
  const got = (await call(MD, "GET", `/api/labs/${A}/findings/${fOld}`, undefined, A)).j;
  check("6b. a finding signed off before reads back unchanged", got?.status === "closed" && got?.signed_by === "Pat Prior" && got?.signed_at === "2026-09-29T15:00:00.000Z" && got?.signoff_role === "medical_director" && got?.signed_with == null, JSON.stringify(got).slice(0, 300));
  const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
  check("6c. the boot only added the how-signed columns (no rows rewritten)", ["md_signed_with", "md_signed_with_provider"].every((c) => cols("qc_period_reviews").includes(c)) && ["signed_with", "signed_with_provider"].every((c) => cols("findings").includes(c)));

  // ── 7. One write path for each signature ────────────────────────────────
  // Every server file that writes a co-signature or a finding's sign-off. A second caller (a bulk form, a list, an import) would
  // show here and has to go through verifySigner too.
  const serverDir = path.resolve(process.cwd(), "server");
  const files = (fs.readdirSync(serverDir, { recursive: true }) as string[]).filter((f) => /\.ts$/.test(String(f)));
  const writes = (re: RegExp) => files.flatMap((f) => (fs.readFileSync(path.join(serverDir, String(f)), "utf8").match(re) || []).map(() => String(f)));
  const cosignWrites = writes(/UPDATE\s+qc_period_reviews\s+SET[^"`;]*md_signed/g);
  const signoffWrites = writes(/UPDATE\s+findings\s+SET[^"`;]*signoff_role\s*=/g);
  const routes = fs.readFileSync(path.join(serverDir, "routes.ts"), "utf8");
  const block = (start: string) => routes.slice(routes.indexOf(start), routes.indexOf("\n  });", routes.indexOf(start)));
  check("7a. one server statement writes a co-signature, in the co-sign route, after verifySigner", cosignWrites.length === 1 && /verifySigner\([^)]*signerInput/.test(block('app.post("/api/labs/:labId/qc/period-reviews/md-cosign"')), cosignWrites.join(", "));
  check("7b. one server statement writes a finding's sign-off, in the sign-off route, after verifySigner", signoffWrites.length === 1 && /verifySigner\([^)]*signerInput/.test(block('app.post("/api/labs/:labId/findings/:id/signoff"')), signoffWrites.join(", "));

  idpServer.close();
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
