// tests/integration/security-settings.test.ts
//
// STANDING integration test for system security settings (server/securityPolicy.ts,
// server/securitySettingsRoutes.ts; Michael Q27 = 1, 2026-10-25; Lifepoint TRB questionnaire Q53, Q55-Q57,
// Q59, Q65 and IPS III.1(k)). A system owner sets: sign out after idle, password expiry, password history,
// lockout after wrong passwords, turn off unused accounts, and a required symbol. Each check asserts the
// rule bites for people in the owner's system AND stays off for everyone outside it.
//
// Boots the REAL Express routes against a throwaway SQLite DB and drives real HTTP.
// Run: npm run test:security-settings

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { clearPolicyCache, isInactive, effectivePolicy } from "../../server/securityPolicy";

(globalThis as any).require ??= createRequire(import.meta.url);

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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;

  const req = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const me = (t: string) => req("GET", "/api/auth/me", undefined, t);
  // Throwaway passwords for this in-memory test DB, built at runtime so secret scanners do not read them as credentials.
  const pw = (tag: string, sym = true) => ["Zq", tag, sym ? "7x!" : "7x"].join(sym ? "-" : "Q");
  const PW = pw("base");
  const register = async (tag: string) => {
    const email = `it-sec-${tag}-${Date.now()}@example.com`;
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body?.user?.id), token: r.body?.token as string };
  };
  const signOutAll = (uid: number) => sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid);
  const login = (email: string, password = PW) => req("POST", "/api/auth/login", { email, password });
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

  try {
    // 0) Setup: G owns lab g1 (M is a member); H owns lab h1; O is outside both systems.
    const G = await register("owner");
    const M = await register("member");
    const H = await register("other-owner");
    const O = await register("outside");
    const g1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: G.email, labName: "IT Security Lab", plan: "hospital" })).body?.labId);
    const h1 = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: H.email, labName: "IT Other Lab", plan: "hospital" })).body?.labId);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: g1, email: M.email, role: "staff" });
    check("0. test labs provisioned", g1 > 0 && h1 > 0, JSON.stringify([g1, h1]));

    // 1) Who can set them, and the password gate.
    const mView = await req("GET", "/api/auth/security-settings", undefined, M.token);
    check("1a. a member who owns no lab cannot manage settings", mView.status === 200 && mView.body?.canManage === false);
    const mPut = await req("PUT", "/api/auth/security-settings", { password: PW, settings: { idleMinutes: 15 } }, M.token);
    check("1b. a member's save is refused", mPut.status === 403 && mPut.body?.code === "NO_SYSTEM", `status=${mPut.status}`);
    const gView = await req("GET", "/api/auth/security-settings", undefined, G.token);
    check("1c. the owner can manage; everything starts off", gView.body?.canManage === true && gView.body?.settings?.idleMinutes === null && gView.body?.settings?.requireSymbol === false);
    const noPw = await req("PUT", "/api/auth/security-settings", { settings: { idleMinutes: 15 } }, G.token);
    check("1d. saving needs the current password", noPw.status === 401 && noPw.body?.code === "PASSWORD_REQUIRED");
    const bad = await req("PUT", "/api/auth/security-settings", { password: PW, settings: { idleMinutes: 2 } }, G.token);
    check("1e. an out-of-range value is refused", bad.status === 400 && bad.body?.code === "INVALID_SETTINGS");
    const all = { idleMinutes: 15, passwordExpiryDays: 180, passwordHistory: 4, lockoutAttempts: 3, inactiveDays: 90, requireSymbol: true };
    const save = await req("PUT", "/api/auth/security-settings", { password: PW, settings: all }, G.token);
    check("1f. the owner saves all six", save.status === 200 && save.body?.settings?.lockoutAttempts === 3 && save.body?.settings?.requireSymbol === true);
    const audit = sqlite.prepare("SELECT entity_label FROM audit_log WHERE entity_type = 'system.security_settings' AND user_id = ? ORDER BY id DESC LIMIT 1").get(G.id) as any;
    check("1g. the change is in the audit trail", /password expiry \(days\): off -> 180/.test(audit?.entity_label || ""), audit?.entity_label);
    const mEff = (await req("GET", "/api/auth/security-settings", undefined, M.token)).body?.effective;
    const oEff = (await req("GET", "/api/auth/security-settings", undefined, O.token)).body?.effective;
    check("1h. the member gets the owner's settings", mEff?.idleMinutes === 15 && mEff?.lockoutAttempts === 3 && mEff?.requireSymbol === true, JSON.stringify(mEff));
    check("1i. someone outside the system gets none", oEff?.idleMinutes === null && oEff?.lockoutAttempts === null && oEff?.requireSymbol === false, JSON.stringify(oEff));

    // 2) Symbol rule and password history.
    const noSym = await req("POST", "/api/auth/change-password", { currentPassword: PW, newPassword: pw("next", false) }, M.token);
    check("2a. member: a password without a symbol is refused", noSym.status === 400 && noSym.body?.code === "PASSWORD_RULE", JSON.stringify(noSym.body));
    const oNoSym = await req("POST", "/api/auth/change-password", { currentPassword: PW, newPassword: pw("next", false) }, O.token);
    check("2b. outsider: the same password is accepted", oNoSym.status === 200, JSON.stringify(oNoSym.body));
    const P2 = pw("second");
    const ch1 = await req("POST", "/api/auth/change-password", { currentPassword: PW, newPassword: P2 }, M.token);
    check("2c. member: a password with a symbol is accepted", ch1.status === 200);
    const back = await req("POST", "/api/auth/change-password", { currentPassword: P2, newPassword: PW }, M.token);
    check("2d. member: going back to the previous password is refused (history)", back.status === 400 && back.body?.code === "PASSWORD_REUSED", JSON.stringify(back.body));
    const pc = sqlite.prepare("SELECT password_changed_at FROM users WHERE id = ?").get(M.id) as any;
    check("2e. the change is stamped", !!pc?.password_changed_at);

    // 3) Lockout after 3 wrong passwords; Forgot password and the owner both unlock.
    signOutAll(M.id);
    for (let i = 0; i < 3; i++) await login(M.email, "Wrong-Pass-1!");
    const locked = await login(M.email, P2);
    check("3a. after 3 wrong passwords the right one is refused: locked", locked.status === 423 && locked.body?.code === "ACCOUNT_LOCKED", `status=${locked.status}`);
    signOutAll(O.id);
    for (let i = 0; i < 3; i++) await login(O.email, "Wrong-Pass-1!");
    const oOk = await login(O.email, pw("next", false));
    check("3b. outsider: 3 wrong passwords do not lock", oOk.status === 200 && typeof oOk.body?.token === "string", `status=${oOk.status}`);
    signOutAll(G.id);
    const gTok = (await login(G.email)).body?.token as string;
    const st = await req("GET", `/api/labs/${g1}/account-status`, undefined, gTok);
    check("3c. the owner sees the member as locked", (st.body?.people || []).some((p: any) => p.userId === M.id && p.locked), JSON.stringify(st.body));
    const lockAudit = sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'account.locked' AND user_id = ?").get(M.id);
    check("3d. the lock is in the audit trail", !!lockAudit);
    const re = await req("POST", `/api/labs/${g1}/members/${M.id}/reenable`, {}, gTok);
    check("3e. the owner unlocks the member", re.status === 200 && re.body?.unlocked === true);
    const afterUnlock = await login(M.email, P2);
    check("3f. the member signs in after the unlock", afterUnlock.status === 200 && (typeof afterUnlock.body?.token === "string" || afterUnlock.body?.session_conflict), `status=${afterUnlock.status}`);
    signOutAll(M.id);
    for (let i = 0; i < 3; i++) await login(M.email, "Wrong-Pass-1!");
    const rt = `it-reset-${Date.now()}`;
    sqlite.prepare("INSERT INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(M.id, rt, new Date(Date.now() + 3600_000).toISOString());
    const P3 = pw("third");
    const rs = await req("POST", "/api/auth/reset-password", { token: rt, password: P3 });
    check("3g. Forgot password sets a new password and clears the lock", rs.status === 200 && !(sqlite.prepare("SELECT locked_at FROM users WHERE id = ?").get(M.id) as any)?.locked_at, `status=${rs.status} ${JSON.stringify(rs.body).slice(0, 120)}`);
    const mOutsider = await req("POST", `/api/labs/${g1}/members/${O.id}/reenable`, {}, gTok);
    check("3h. the owner cannot touch someone outside the lab", mOutsider.status === 404);
    signOutAll(M.id);
    const mTok = (await login(M.email, P3)).body?.token;
    const memberTry = await req("POST", `/api/labs/${g1}/members/${G.id}/reenable`, {}, mTok);
    check("3i. a staff member cannot use the owner's button", memberTry.status === 403, `status=${memberTry.status}`);

    // 4) Password expiry: an old password is changed at sign-in before any session exists.
    signOutAll(M.id);
    sqlite.prepare("UPDATE users SET password_changed_at = ? WHERE id = ?").run(daysAgo(200), M.id);
    const ex = await login(M.email, P3);
    check("4a. an expired password gets the change step, not a session", ex.status === 200 && ex.body?.password_expired === true && !ex.body?.token && ex.body?.expiry_days === 180, JSON.stringify(Object.keys(ex.body || {})));
    check("4b. the step token opens no other route", (await me(ex.body.expired_token)).status === 401);
    const same = await req("POST", "/api/auth/password-expired", { token: ex.body.expired_token, newPassword: P3 });
    check("4c. the current password is refused as the new one", same.status === 400 && same.body?.code === "PASSWORD_REUSED");
    const P4 = pw("fourth");
    const done = await req("POST", "/api/auth/password-expired", { token: ex.body.expired_token, newPassword: P4 });
    check("4d. a new password finishes sign-in with a session", done.status === 200 && typeof done.body?.token === "string", `status=${done.status} ${JSON.stringify(done.body).slice(0, 120)}`);
    check("4e. that session works", (await me(done.body.token)).status === 200);
    sqlite.prepare("UPDATE users SET password_changed_at = ? WHERE id = ?").run(daysAgo(200), O.id);
    signOutAll(O.id);
    const oOld = await login(O.email, pw("next", false));
    check("4f. outsider: an old password still signs straight in", oOld.status === 200 && typeof oOld.body?.token === "string" && !oOld.body?.password_expired);

    // 5) Inactive accounts: turned off after 90 days, owner turns them back on; Veritas support never.
    signOutAll(M.id);
    sqlite.prepare("UPDATE users SET last_sign_in_at = ?, reenabled_at = NULL, created_at = ? WHERE id = ?").run(daysAgo(100), daysAgo(400), M.id);
    sqlite.prepare("UPDATE user_sessions SET created_at = ? WHERE user_id = ?").run(daysAgo(100), M.id);
    const inact = await login(M.email, P4);
    check("5a. no sign-in for 100 days: sign-in refused", inact.status === 403 && inact.body?.code === "ACCOUNT_INACTIVE", `status=${inact.status}`);
    const st2 = await req("GET", `/api/labs/${g1}/account-status`, undefined, gTok);
    check("5b. the owner sees the member as turned off", (st2.body?.people || []).some((p: any) => p.userId === M.id && p.inactive));
    const re2 = await req("POST", `/api/labs/${g1}/members/${M.id}/reenable`, {}, gTok);
    check("5c. the owner turns the member back on", re2.status === 200 && re2.body?.reenabled === true);
    const back5 = await login(M.email, P4);
    check("5d. the member signs in again", back5.status === 200 && typeof back5.body?.token === "string", `status=${back5.status}`);
    sqlite.prepare("UPDATE users SET vls_support = 1, last_sign_in_at = ?, created_at = ? WHERE id = ?").run(daysAgo(300), daysAgo(400), H.id);
    sqlite.prepare("UPDATE user_sessions SET created_at = ? WHERE user_id = ?").run(daysAgo(300), H.id);
    check("5e. a Veritas support account is never turned off", isInactive(sqlite, H.id, { ...effectivePolicy(sqlite, M.id) }) === false);
    sqlite.prepare("UPDATE users SET vls_support = 0 WHERE id = ?").run(H.id);

    // 6) Sign out after idle: the server ends a session idle past the limit, and only for this system.
    const mSess = back5.body.token as string;
    const sid = back5.body.session_token as string;
    check("6a. a fresh session works", (await me(mSess)).status === 200);
    sqlite.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ?").run(new Date(Date.now() - 20 * 60_000).toISOString(), sid);
    const idle = await me(mSess);
    check("6b. idle 20 minutes against a 15-minute limit: refused with SESSION_IDLE", idle.status === 401 && idle.body?.code === "SESSION_IDLE" && /15 minutes/.test(idle.body?.error || ""), JSON.stringify(idle.body));
    const row = sqlite.prepare("SELECT is_active, ended_reason FROM user_sessions WHERE session_token = ?").get(sid) as any;
    check("6c. the session row is ended as idle", Number(row?.is_active) === 0 && row?.ended_reason === "idle", JSON.stringify(row));
    const oSess = issueSession(sqlite, O.id, { headers: { "user-agent": "IT" } });
    sqlite.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ?").run(new Date(Date.now() - 20 * 60_000).toISOString(), oSess.sessionToken);
    check("6d. outsider: the same idle time is fine", (await me(oSess.token)).status === 200);

    // 7) Strictest wins across systems; turning everything off lifts every rule.
    signOutAll(H.id);
    const hTok = (await login(H.email)).body?.token as string;
    await req("PUT", "/api/auth/security-settings", { password: PW, settings: { idleMinutes: 60, lockoutAttempts: 10 } }, hTok);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: h1, email: M.email, role: "staff" });
    clearPolicyCache();
    const both = effectivePolicy(sqlite, M.id);
    check("7a. a person in two systems gets the strictest of each", both.idleMinutes === 15 && both.lockoutAttempts === 3 && both.passwordExpiryDays === 180, JSON.stringify(both));
    const off = await req("PUT", "/api/auth/security-settings", { password: PW, settings: {} }, gTok);
    clearPolicyCache();
    const after = effectivePolicy(sqlite, M.id);
    check("7b. the owner turns everything off; only the other system's rules remain", off.status === 200 && after.idleMinutes === 60 && after.lockoutAttempts === 10 && after.passwordExpiryDays === null && after.requireSymbol === false, JSON.stringify(after));

    // 8) A new account joining a lab that requires a symbol gets the rule at sign-up.
    await req("PUT", "/api/auth/security-settings", { password: PW, settings: { requireSymbol: true } }, gTok);
    const joinEmail = `it-sec-join-${Date.now()}@example.com`;
    const invTok = `it-sec-invite-${Date.now()}`;
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, invite_token, lab_id) VALUES (?, ?, ?, 'pending', '{}', ?, ?)")
      .run(G.id, joinEmail, new Date().toISOString(), invTok, g1);
    const j1 = await req("POST", "/api/auth/register", { email: joinEmail, password: pw("join", false), name: "IT Joiner", hipaa_acknowledged: true, inviteToken: invTok });
    check("8a. joining a symbol-requiring lab: no symbol, refused", j1.status === 400 && j1.body?.code === "PASSWORD_RULE", JSON.stringify(j1.body));
    const j2 = await req("POST", "/api/auth/register", { email: joinEmail, password: pw("join"), name: "IT Joiner", hipaa_acknowledged: true, inviteToken: invTok });
    check("8b. with a symbol, accepted", j2.status === 200, `status=${j2.status}`);
    const hist = sqlite.prepare("SELECT COUNT(*) AS n FROM password_history WHERE user_id = ?").get(Number(j2.body?.user?.id)) as any;
    check("8c. the first password is recorded for history and expiry", Number(hist?.n) === 1);

    // 9) Guard: every password write goes through setUserPassword (no other UPDATE of users.password_hash in server/).
    const serverDir = path.resolve("server");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(serverDir).filter((x) => x.endsWith(".ts"))) {
      if (f === "securityPolicy.ts") continue;
      fs.readFileSync(path.join(serverDir, f), "utf8").split("\n").forEach((line, i) => {
        if (/password_hash\s*=\s*\?/.test(line) && !/security-settings-ok/.test(line)) offenders.push(`${f}:${i + 1}`);
      });
    }
    check("9. no password write bypasses the security settings", offenders.length === 0, offenders.join(", "));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
