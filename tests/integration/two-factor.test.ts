// tests/integration/two-factor.test.ts
//
// STANDING integration test for two-factor sign-in Stage 2 (Michael Q170 = 1, mock Q171 = 1,
// 2026-10-14; server/totp.ts, server/twoFactor.ts, server/twoFactorRoutes.ts). Boots the REAL
// Express routes against a throwaway SQLite DB and drives real HTTP. The negatives are the point:
// a password alone must NOT open an enrolled account, a step token must open nothing else, a used
// code must not work twice, and the side doors (reset link, new account in a requiring lab,
// Veritas support accounts) must all land on the second step.
// Run: npm run test:two-factor

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { hotp, totpAt, totpStep, base32Encode, verifyTotp } from "../../server/totp";
import { setTwoFactorEmailSender } from "../../server/twoFactor";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // RFC 6238 Appendix B (SHA-1), last 6 digits.
  const rfcKey = base32Encode(Buffer.from("12345678901234567890"));
  check("0a. RFC 6238 vector T=59", totpAt(rfcKey, 59_000) === "287082", totpAt(rfcKey, 59_000));
  check("0b. RFC 6238 vector T=1111111109", totpAt(rfcKey, 1_111_111_109_000) === "081804");
  check("0c. RFC 6238 vector T=1234567890", totpAt(rfcKey, 1_234_567_890_000) === "005924");
  check("0d. RFC 6238 vector T=2000000000", totpAt(rfcKey, 2_000_000_000_000) === "279037");
  check("0e. a code one step old still verifies; three steps old does not", verifyTotp(rfcKey, hotp(rfcKey, totpStep() - 1)) != null && verifyTotp(rfcKey, hotp(rfcKey, totpStep() - 3)) == null);

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  const mail: { to: string; code: string; purpose: string }[] = [];
  setTwoFactorEmailSender(async (to, code, purpose) => { mail.push({ to, code, purpose }); });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const pw = (tag: string) => ["Zq", tag, "7x!"].join("-");
  const PW = pw("main");

  const req = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const me = (t: string) => req("GET", "/api/auth/me", undefined, t);
  const register = async (tag: string) => {
    const email = `it-2fa-${tag}-${Date.now()}@example.com`;
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body?.user?.id), token: r.body?.token as string, body: r.body };
  };
  const login = (email: string, extra: Record<string, unknown> = {}) => req("POST", "/api/auth/login", { email, password: PW, ...extra });
  const keyOf = (k: string) => k.replace(/\s/g, "");
  const signOutAll = (uid: number) => sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid);
  const nextStepCode = (key: string, after: number) => hotp(key, Math.max(totpStep(), after + 1));

  try {
    // 1) Not enrolled, not required: a plain sign-in.
    const A = await register("a");
    check("1a. register signs a new account straight in (no lab requires two-factor)", typeof A.token === "string" && !A.body?.mfa_setup_required);
    signOutAll(A.id);
    const l0 = await login(A.email);
    check("1b. login without two-factor issues a session", typeof l0.body?.token === "string" && !l0.body?.mfa_required);

    // 2) Turn it on from Account settings (authenticator app).
    const st = await req("POST", "/api/auth/mfa/setup/start", {}, l0.body.token);
    check("2a. setup returns a key, otpauth link and QR code", st.status === 200 && /^[A-Z2-7 ]{20,}$/.test(st.body?.key || "") && String(st.body?.otpauth || "").startsWith("otpauth://totp/") && String(st.body?.qr_svg || "").includes("<svg"));
    const keyA = keyOf(st.body.key);
    const wrongConfirm = await req("POST", "/api/auth/mfa/setup/confirm", { code: "000000" }, l0.body.token);
    check("2b. a wrong code does not turn it on", wrongConfirm.status === 400);
    const conf = await req("POST", "/api/auth/mfa/setup/confirm", { code: totpAt(keyA) }, l0.body.token);
    const recovery: string[] = conf.body?.recovery_codes || [];
    check("2c. the right code turns it on and returns 10 recovery codes", conf.status === 200 && recovery.length === 10 && recovery.every((c) => /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(c)), JSON.stringify(recovery.slice(0, 2)));
    const stat = await req("GET", "/api/auth/mfa", undefined, l0.body.token);
    check("2d. status: on, authenticator app, 10 codes left, can turn off", stat.body?.enabled === true && stat.body?.method === "totp" && stat.body?.recoveryCodesLeft === 10 && stat.body?.canTurnOff === true, JSON.stringify(stat.body));
    const stored = sqlite.prepare("SELECT totp_secret_enc FROM user_mfa WHERE user_id = ?").get(A.id) as any;
    check("2e. the key is stored sealed, not in plain text", !!stored?.totp_secret_enc && !String(stored.totp_secret_enc).includes(keyA));

    // 3) A password alone no longer opens the account.
    signOutAll(A.id);
    const l1 = await login(A.email);
    check("3a. login now asks for the code (no token)", l1.body?.mfa_required === true && !l1.body?.token && typeof l1.body?.mfa_token === "string", JSON.stringify(Object.keys(l1.body)));
    check("3b. the step token opens no API route", (await me(l1.body.mfa_token)).status === 401);
    const bad = await req("POST", "/api/auth/mfa/verify", { mfa_token: l1.body.mfa_token, code: "123456", kind: "app" });
    check("3c. a wrong code is refused", bad.status === 400 && bad.body?.code === "BAD_CODE");
    const lastStep = (sqlite.prepare("SELECT last_totp_step FROM user_mfa WHERE user_id = ?").get(A.id) as any).last_totp_step;
    const goodCode = nextStepCode(keyA, lastStep);
    const ok1 = await req("POST", "/api/auth/mfa/verify", { mfa_token: l1.body.mfa_token, code: goodCode, kind: "app" });
    check("3d. the right code signs in", ok1.status === 200 && typeof ok1.body?.token === "string" && (await me(ok1.body.token)).status === 200);
    const sessRow = sqlite.prepare("SELECT mfa_method FROM user_sessions WHERE user_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(A.id) as any;
    check("3e. the session records how it passed the second step", sessRow?.mfa_method === "app", sessRow?.mfa_method);
    signOutAll(A.id);
    const l2 = await login(A.email);
    const replay = await req("POST", "/api/auth/mfa/verify", { mfa_token: l2.body.mfa_token, code: goodCode, kind: "app" });
    check("3f. the same code cannot be used twice", replay.status === 400);

    // 4) Recovery codes work once each.
    const rc = await req("POST", "/api/auth/mfa/verify", { mfa_token: l2.body.mfa_token, code: recovery[0].toLowerCase().replace("-", " "), kind: "recovery" });
    check("4a. a recovery code signs in (any case, any separator)", rc.status === 200 && rc.body?.recovery_codes_left === 9, JSON.stringify({ s: rc.status, left: rc.body?.recovery_codes_left }));
    signOutAll(A.id);
    const l3 = await login(A.email);
    const rc2 = await req("POST", "/api/auth/mfa/verify", { mfa_token: l3.body.mfa_token, code: recovery[0], kind: "recovery" });
    check("4b. a used recovery code is refused", rc2.status === 400);

    // 5) Emailed code.
    const ec = await req("POST", "/api/auth/mfa/email-code", { mfa_token: l3.body.mfa_token });
    const sentA = mail.filter((m) => m.to === A.email && m.purpose === "login").pop();
    check("5a. Email me a code sends a 6-digit code to the person's email", ec.status === 200 && /^\d{6}$/.test(sentA?.code || "") && String(ec.body?.email_hint || "").includes("•"), ec.body?.email_hint);
    const again = await req("POST", "/api/auth/mfa/email-code", { mfa_token: l3.body.mfa_token });
    check("5b. a second email within 30 seconds waits", again.status === 429);
    const ev = await req("POST", "/api/auth/mfa/verify", { mfa_token: l3.body.mfa_token, code: sentA!.code, kind: "email" });
    check("5c. the emailed code signs in", ev.status === 200 && typeof ev.body?.token === "string");

    // 6) Remember this computer.
    signOutAll(A.id);
    const l4 = await login(A.email);
    // The test runs inside one 30-second window; move the last-used step back as if the next window arrived.
    sqlite.prepare("UPDATE user_mfa SET last_totp_step = ? WHERE user_id = ?").run(totpStep() - 2, A.id);
    const rem = await req("POST", "/api/auth/mfa/verify", { mfa_token: l4.body.mfa_token, code: totpAt(keyA), kind: "app", remember: true });
    check("6a. Remember this computer returns a device token", rem.status === 200 && /^[0-9a-f]{64}$/.test(rem.body?.device_token || ""), `status=${rem.status} ${rem.body?.error || ""}`);
    signOutAll(A.id);
    const l5 = await login(A.email, { device_token: rem.body.device_token });
    check("6b. a remembered computer skips the code step", typeof l5.body?.token === "string" && !l5.body?.mfa_required);
    signOutAll(A.id);
    const l5b = await login(A.email, { device_token: "f".repeat(64) });
    check("6c. an unknown device token still gets the code step", l5b.body?.mfa_required === true);

    // 7) Ten wrong codes in 15 minutes lock the step.
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await req("POST", "/api/auth/mfa/verify", { mfa_token: l5b.body.mfa_token, code: "999999", kind: "app" })).status;
    const lockedRes = await req("POST", "/api/auth/mfa/verify", { mfa_token: l5b.body.mfa_token, code: "999999", kind: "app" });
    check("7. after 10 wrong codes the next try is refused (429)", last === 400 && lockedRes.status === 429, `last=${last} then=${lockedRes.status}`);

    // 8) Reset by email link does not skip the code step.
    const resetTok = `it-2fa-reset-${Date.now()}`;
    sqlite.prepare("INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(A.id, resetTok, new Date(Date.now() + 3600_000).toISOString());
    const rs = await req("POST", "/api/auth/reset-password", { token: resetTok, password: pw("reset") });
    check("8a. a password reset for an enrolled person returns no token (sign in again)", rs.status === 200 && rs.body?.sign_in_required === true && !rs.body?.token, JSON.stringify(rs.body));
    check("8b. the reset also forgets remembered computers", sqlite.prepare("SELECT COUNT(*) AS n FROM mfa_trusted_devices WHERE user_id = ? AND revoked_at IS NULL").get(A.id).n === 0);

    // 9) Lab requires it: the owner's switch, first-time setup at next sign-in (email method).
    const B = await register("b");
    const labRes = await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: B.email, labName: "IT Two-Factor Lab", plan: "hospital" });
    const labId = Number(labRes.body?.labId);
    check("9a. test lab provisioned", Number.isInteger(labId) && labId > 0, JSON.stringify(labRes.body).slice(0, 120));
    const put = await req("PUT", `/api/labs/${labId}/two-factor`, { required: true }, B.token);
    check("9b. the lab owner turns on Require two-factor", put.status === 200, JSON.stringify(put.body));
    signOutAll(B.id);
    const lb = await login(B.email);
    check("9c. the next sign-in goes to first-time setup", lb.body?.mfa_setup_required === true && !lb.body?.token && String(lb.body?.required_by || "").includes("IT Two-Factor Lab"), JSON.stringify(lb.body?.required_by));
    check("9d. the setup token opens no API route", (await me(lb.body.mfa_token)).status === 401);
    await req("POST", "/api/auth/mfa/email-code", { mfa_token: lb.body.mfa_token });
    const setupMail = mail.filter((m) => m.to === B.email && m.purpose === "setup").pop();
    const bConf = await req("POST", "/api/auth/mfa/setup/confirm", { mfa_token: lb.body.mfa_token, method: "email", code: setupMail?.code, remember: true });
    check("9e. setting up with email codes signs in and returns recovery codes", bConf.status === 200 && typeof bConf.body?.token === "string" && bConf.body?.recovery_codes?.length === 10, `status=${bConf.status} ${bConf.body?.error || ""}`);
    check("9f. remember is honored while the lab allows it", /^[0-9a-f]{64}$/.test(bConf.body?.device_token || ""));
    const offB = await req("POST", "/api/auth/mfa/turn-off", { password: PW }, bConf.body.token);
    check("9g. a person whose lab requires it cannot turn it off", offB.status === 409);
    const remOff = await req("PUT", `/api/labs/${labId}/two-factor`, { allowRemember: false }, bConf.body.token);
    check("9h. the owner switches off Remember this computer", remOff.status === 200);
    signOutAll(B.id);
    const lb2 = await login(B.email, { device_token: bConf.body.device_token });
    check("9i. with remember switched off, a remembered computer still gets the code step", lb2.body?.mfa_required === true && lb2.body?.allow_remember === false);

    // 10) The lab's people list and the owner's reset.
    const C = await register("c");
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId, email: C.email, role: "staff" });
    signOutAll(C.id);
    const lc = await login(C.email);
    check("10a. a member of the requiring lab is sent to setup", lc.body?.mfa_setup_required === true);
    const cst = await req("POST", "/api/auth/mfa/setup/start", { mfa_token: lc.body.mfa_token });
    const cConf = await req("POST", "/api/auth/mfa/setup/confirm", { mfa_token: lc.body.mfa_token, code: totpAt(keyOf(cst.body.key)) });
    check("10b. the member sets up the authenticator app and is signed in", cConf.status === 200 && typeof cConf.body?.token === "string");
    // B signs in again for the owner view (one of the recovery codes from setup).
    const bIn = await req("POST", "/api/auth/mfa/verify", { mfa_token: lb2.body.mfa_token, code: bConf.body.recovery_codes[0], kind: "recovery" });
    check("10c. the owner signs back in with a recovery code", bIn.status === 200 && typeof bIn.body?.token === "string", `status=${bIn.status} ${bIn.body?.error || ""}`);
    const people = await req("GET", `/api/labs/${labId}/two-factor`, undefined, bIn.body.token);
    const cRow = (people.body?.people || []).find((p: any) => p.userId === C.id);
    const bRow = (people.body?.people || []).find((p: any) => p.userId === B.id);
    check("10d. the lab list shows who has it on, and how", people.body?.required === true && cRow?.status === "on" && bRow?.status === "on_email" && cRow?.canReset === true && bRow?.canReset === false, JSON.stringify(people.body?.people?.map((p: any) => [p.name, p.status, p.canReset])));
    const resetSelf = await req("POST", `/api/labs/${labId}/two-factor/reset/${B.id}`, {}, bIn.body.token);
    check("10e. the owner cannot reset their own two-factor here", resetSelf.status === 400);
    const resetC = await req("POST", `/api/labs/${labId}/two-factor/reset/${C.id}`, {}, bIn.body.token);
    check("10f. the owner resets the member: two-factor cleared and signed out everywhere", resetC.status === 200 && resetC.body?.signedOut >= 1 && (await me(cConf.body.token)).status === 401 && !sqlite.prepare("SELECT 1 FROM user_mfa WHERE user_id = ?").get(C.id));
    const resetA = await req("POST", `/api/labs/${labId}/two-factor/reset/${A.id}`, {}, bIn.body.token);
    check("10g. the owner cannot reset someone outside the lab", resetA.status === 404);
    const memberPut = await req("PUT", `/api/labs/${labId}/two-factor`, { required: false }, cConf.body.token);
    check("10h. a non-owner cannot change the lab's rule", memberPut.status === 401 || memberPut.status === 403, `status=${memberPut.status}`);

    // 11) A new account joining a requiring lab sets it up before any session.
    const joinEmail = `it-2fa-join-${Date.now()}@example.com`;
    const invTok = `it-invite-${Date.now()}`;
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, invite_token, lab_id) VALUES (?, ?, ?, 'pending', '{}', ?, ?)")
      .run(B.id, joinEmail, new Date().toISOString(), invTok, labId);
    const joined = await req("POST", "/api/auth/register", { email: joinEmail, password: PW, name: "IT Joiner", hipaa_acknowledged: true, inviteToken: invTok });
    check("11. a new account joining a requiring lab gets setup, not a token", joined.status === 200 && joined.body?.mfa_setup_required === true && !joined.body?.token, `status=${joined.status} ${JSON.stringify(Object.keys(joined.body || {}))}`);

    // 12) Veritas support accounts are always asked.
    const D = await register("d");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(D.id);
    signOutAll(D.id);
    const ld = await login(D.email);
    check("12. a Veritas support account must set it up", ld.body?.mfa_setup_required === true && ld.body?.required_by === "Veritas Lab Services", JSON.stringify(ld.body?.required_by));

    // 13) Turning it off (not required) and the Veritas admin reset.
    const E = await register("e");
    const est = await req("POST", "/api/auth/mfa/setup/start", {}, E.token);
    await req("POST", "/api/auth/mfa/setup/confirm", { code: totpAt(keyOf(est.body.key)) }, E.token);
    const offWrong = await req("POST", "/api/auth/mfa/turn-off", { password: "not-it" }, E.token);
    check("13a. turning it off needs the current password", offWrong.status === 401);
    const off = await req("POST", "/api/auth/mfa/turn-off", { password: PW }, E.token);
    check("13b. turn off works when no lab requires it", off.status === 200 && !sqlite.prepare("SELECT 1 FROM user_mfa WHERE user_id = ?").get(E.id));
    const adm = await req("POST", "/api/admin/two-factor/reset", { secret: ADMIN, userId: A.id });
    check("13d. the Veritas admin reset clears a person's two-factor", adm.status === 200 && !sqlite.prepare("SELECT 1 FROM user_mfa WHERE user_id = ?").get(A.id));
    const admBad = await req("POST", "/api/admin/two-factor/reset", { secret: "wrong", userId: A.id });
    check("13e. the admin reset refuses a wrong secret", admBad.status === 403);

    // 14) Second step, then the other-device prompt: the session still records the method.
    const F = await register("f");
    const fst = await req("POST", "/api/auth/mfa/setup/start", {}, F.token);
    const fKey = keyOf(fst.body.key);
    await req("POST", "/api/auth/mfa/setup/confirm", { code: totpAt(fKey) }, F.token);
    const lf = await login(F.email); // F's register session is still active
    const fStep = (sqlite.prepare("SELECT last_totp_step FROM user_mfa WHERE user_id = ?").get(F.id) as any).last_totp_step;
    const fv = await req("POST", "/api/auth/mfa/verify", { mfa_token: lf.body.mfa_token, code: nextStepCode(fKey, fStep), kind: "app" });
    check("14a. after the code, an active session elsewhere gives the other-device prompt", fv.body?.session_conflict === true, `status=${fv.status} ${JSON.stringify(Object.keys(fv.body))}`);
    const ff = await req("POST", "/api/auth/force-logout", {}, fv.body.token);
    const fRow = sqlite.prepare("SELECT mfa_method FROM user_sessions WHERE user_id = ? AND is_active = 1").get(F.id) as any;
    check("14b. force-logout's new session records the second step", ff.status === 200 && fRow?.mfa_method === "app", JSON.stringify(fRow));
    const moveNoPw = await req("POST", "/api/auth/mfa/setup/start", {}, ff.body.token);
    const moveWithPw = await req("POST", "/api/auth/mfa/setup/start", { password: PW }, ff.body.token);
    check("14c. moving an existing two-factor to a new phone needs the password", moveNoPw.status === 401 && moveWithPw.status === 200, `${moveNoPw.status}/${moveWithPw.status}`);
  } finally {
    server.close();
  }

  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
