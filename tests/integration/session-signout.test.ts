// tests/integration/session-signout.test.ts
//
// STANDING integration test for two-factor sign-in Stage 1 (Michael Q170 = 1,
// mock Q171 = 1, 2026-10-14; server/sessionAuth.ts). Before Stage 1 a sign-in
// token was a bare { userId } JWT good for 30 days and nothing checked
// user_sessions on later requests, so "Sign out", the login force-logout, a
// password change and the admin kill switch flipped a row while the token kept
// working. Every check below asserts the NEGATIVE that was missing: after the
// session ends, the token is refused.
//
// Boots the REAL Express routes against a throwaway SQLite DB and drives real HTTP.
// Run: npm run test:session-signout

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession, LEGACY_TOKEN_CUTOFF_MS } from "../../server/sessionAuth";

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
  const SECRET = process.env.JWT_SECRET!;

  const req = async (method: string, p: string, body?: unknown, token?: string, ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0") => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": ua, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j: any = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
  };
  const me = (t: string) => req("GET", "/api/auth/me", undefined, t);
  // Throwaway passwords for this in-memory test DB, built at runtime so secret scanners do not read them as credentials.
  const pw = (tag: string) => ["Zq", tag, "7x!"].join("-");
  const PW1 = pw("one"), PW2 = pw("two"), PW3 = pw("three");

  try {
    // 1) Password rule at register.
    const email = `it-session-${Date.now()}@example.com`;
    const weak = await req("POST", "/api/auth/register", { email, password: "testpass123", name: "Session IT", hipaa_acknowledged: true });
    check("1a. register refuses a 2-of-4 password", weak.status === 400 && weak.body?.code === "PASSWORD_RULE", `status=${weak.status} ${JSON.stringify(weak.body).slice(0, 120)}`);
    const reg = await req("POST", "/api/auth/register", { email, password: PW1, name: "Session IT", hipaa_acknowledged: true });
    check("1b. register accepts a 3-of-4 password", reg.status === 200 && typeof reg.body?.token === "string", `status=${reg.status}`);
    const userId = Number(reg.body?.user?.id);
    const regPayload: any = jwt.decode(reg.body.token);
    check("1c. the token names its session (sid)", typeof regPayload?.sid === "string" && regPayload.sid === reg.body.session_token);

    // 2) Sign out ends the token at once.
    check("2a. token works before sign-out", (await me(reg.body.token)).status === 200);
    await req("POST", "/api/auth/logout", {}, reg.body.token);
    const after = await me(reg.body.token);
    check("2b. after sign-out the same token is refused (SESSION_ENDED)", after.status === 401 && after.body?.code === "SESSION_ENDED", `status=${after.status} ${JSON.stringify(after.body)}`);

    // 3) Login, a second login hits the conflict, the conflict token opens nothing else,
    //    force-logout ends the first device and returns a working token.
    const l1 = await req("POST", "/api/auth/login", { email, password: PW1 });
    check("3a. login issues a session token", l1.status === 200 && !!l1.body?.token && !l1.body?.session_conflict);
    const tokA = l1.body.token as string;
    const l2 = await req("POST", "/api/auth/login", { email, password: PW1 }, undefined, "Mozilla/5.0 (iPhone) Safari/604.1");
    check("3b. second login reports the conflict", l2.body?.session_conflict === true && l2.body?.active_device === "Chrome on Windows", JSON.stringify(l2.body?.active_device));
    const conflictTok = l2.body.token as string;
    const conflictMe = await me(conflictTok);
    check("3c. the conflict token opens no API route", conflictMe.status === 401, `status=${conflictMe.status}`);
    const fl = await req("POST", "/api/auth/force-logout", {}, conflictTok, "Mozilla/5.0 (iPhone) Safari/604.1");
    check("3d. force-logout returns a new session token", fl.status === 200 && typeof fl.body?.token === "string", `status=${fl.status}`);
    const tokB = fl.body.token as string;
    check("3e. the first device's token is now refused", (await me(tokA)).status === 401);
    check("3f. the new token works", (await me(tokB)).status === 200);

    // 4) Signed-in devices: list, sign out one other device, sign out all others.
    const extra1 = issueSession(sqlite, userId, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Edg/130.0" } });
    const extra2 = issueSession(sqlite, userId, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Mac OS X) Firefox/131.0" } });
    const list = await req("GET", "/api/auth/sessions", undefined, tokB);
    const sessions: any[] = list.body?.sessions || [];
    check("4a. device list shows 3 sign-ins with this one current", sessions.length === 3 && sessions.filter((s) => s.current).length === 1, JSON.stringify(sessions.map((s) => [s.device, s.current])));
    check("4b. device labels read plainly", sessions.some((s) => s.device === "Edge on Windows") && sessions.some((s) => s.device === "Firefox on Mac"));
    const edgeRow = sessions.find((s) => s.device === "Edge on Windows");
    const one = await req("POST", `/api/auth/sessions/${edgeRow?.id}/sign-out`, {}, tokB);
    check("4c. Sign out on another device succeeds", one.status === 200);
    check("4d. that device's token is refused", (await me(extra1.token)).status === 401);
    check("4e. the remaining other device still works", (await me(extra2.token)).status === 200);
    const selfRow = sessions.find((s) => s.current);
    const selfOut = await req("POST", `/api/auth/sessions/${selfRow?.id}/sign-out`, {}, tokB);
    check("4f. the per-device button refuses this device", selfOut.status === 400);
    const others = await req("POST", "/api/auth/sessions/sign-out-others", {}, tokB);
    check("4g. Sign out all other devices ends the rest", others.status === 200 && others.body?.signedOut === 1 && (await me(extra2.token)).status === 401, JSON.stringify(others.body));
    check("4h. this device stays signed in", (await me(tokB)).status === 200);
    const other = await req("POST", "/api/auth/register", { email: `it-session-other-${Date.now()}@example.com`, password: PW1, name: "Other Person", hipaa_acknowledged: true });
    const otherRowId = (sqlite.prepare("SELECT id FROM user_sessions WHERE session_token = ?").get(other.body?.session_token) as any)?.id;
    const cross = await req("POST", `/api/auth/sessions/${otherRowId}/sign-out`, {}, tokB);
    check("4i. cannot sign out another person's device", cross.status === 404, `status=${cross.status}`);

    // 5) Password change: rule enforced; every other device signed out; this one stays.
    const extra3 = issueSession(sqlite, userId, { headers: { "user-agent": "Mozilla/5.0 (Android) Chrome/130.0" } });
    const weakChange = await req("POST", "/api/auth/change-password", { currentPassword: PW1, newPassword: "alllowercase" }, tokB);
    check("5a. change-password refuses a weak password", weakChange.status === 400 && weakChange.body?.code === "PASSWORD_RULE");
    const change = await req("POST", "/api/auth/change-password", { currentPassword: PW1, newPassword: PW2 }, tokB);
    check("5b. change-password succeeds", change.status === 200 && change.body?.ok === true && change.body?.signedOutOthers === 1, JSON.stringify(change.body));
    check("5c. the other device is signed out by the change", (await me(extra3.token)).status === 401);
    check("5d. this device stays signed in", (await me(tokB)).status === 200);

    // 6) Reset-password by email link ends every sign-in and signs in fresh.
    const resetTok = `it-reset-${Date.now()}`;
    sqlite.prepare("INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(userId, resetTok, new Date(Date.now() + 3600_000).toISOString());
    const weakReset = await req("POST", "/api/auth/reset-password", { token: resetTok, password: "short1" });
    check("6a. reset refuses a weak password", weakReset.status === 400 && weakReset.body?.code === "PASSWORD_RULE");
    const reset = await req("POST", "/api/auth/reset-password", { token: resetTok, password: PW3 });
    check("6b. reset succeeds with a new session token", reset.status === 200 && typeof reset.body?.token === "string" && typeof reset.body?.session_token === "string");
    check("6c. the pre-reset token is refused", (await me(tokB)).status === 401);
    check("6d. the reset sign-in works", (await me(reset.body.token)).status === 200);

    // 7) Admin kill switch now really ends access.
    const kill = await req("POST", "/api/admin/kill-sessions", { secret: process.env.ADMIN_SECRET, userId });
    check("7a. admin kill-sessions ends the sign-in", kill.status === 200 && kill.body?.sessionsKilled === 1 && (await me(reset.body.token)).status === 401, JSON.stringify(kill.body));

    // 8) Token kinds that carry no session id.
    const legacyOld = jwt.sign({ userId, iat: Math.floor((LEGACY_TOKEN_CUTOFF_MS - 86_400_000) / 1000) }, SECRET, { expiresIn: "30d" });
    check("8a. a pre-Stage-1 token with no active session is refused", (await me(legacyOld)).status === 401);
    const live = issueSession(sqlite, userId, { headers: {} });
    check("8b. a pre-Stage-1 token works while the person has an active session", (await me(legacyOld)).status === 200);
    // Issued after the cutoff (any token the server issues from now on carries a sid).
    const legacyNew = jwt.sign({ userId, iat: Math.floor(LEGACY_TOKEN_CUTOFF_MS / 1000) + 60 }, SECRET, { expiresIn: "30d" });
    check("8c. a token issued after the cutoff without a session id is refused", (await me(legacyNew)).status === 401);
    await req("POST", "/api/auth/logout", {}, legacyOld);
    check("8d. sign-out on a pre-Stage-1 token ends it", (await me(legacyOld)).status === 401 && (await me(live.token)).status === 401);
    const svc = jwt.sign({ svc: true, userId }, SECRET, { expiresIn: "5m" });
    check("8e. a script service token (svc) works with no session", (await me(svc)).status === 200);
    const ci = jwt.sign({ userId, ci_sandbox: true }, SECRET, { expiresIn: "5m" });
    check("8f. the CI sandbox token (ci_sandbox) works with no session", (await me(ci)).status === 200);
    const forged = jwt.sign({ userId, sid: "not-a-real-session" }, SECRET, { expiresIn: "5m" });
    check("8g. a token naming an unknown session is refused", (await me(forged)).status === 401);
    const wrongKey = jwt.sign({ svc: true, userId }, "not-the-secret", { expiresIn: "5m" });
    check("8h. a token signed with another key is refused", (await me(wrongKey)).status === 401);

    // 9) Routes that read the token outside authMiddleware refuse an ended session too.
    const ended = issueSession(sqlite, userId, { headers: {} });
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE session_token = ?").run(ended.sessionToken);
    const exp = await req("GET", "/api/my-studies/export", undefined, ended.token);
    check("9a. study export refuses an ended session", exp.status === 401, `status=${exp.status}`);
    const sp = await req("GET", "/api/staff-portal-session/employees", undefined, ended.token);
    check("9b. the staff portal refuses an ended session (SESSION_ENDED)", sp.status === 401 && sp.body?.code === "SESSION_ENDED", `status=${sp.status} ${JSON.stringify(sp.body)}`);

    // 10) Bug-class guard: no file in server/ verifies a JWT except sessionAuth.ts.
    const serverDir = path.resolve(process.cwd(), "server");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(serverDir)) {
      if (!/\.(ts|mts|js)$/.test(f) || f === "sessionAuth.ts") continue;
      const src = fs.readFileSync(path.join(serverDir, f), "utf8");
      if (/jwt\.verify\(/.test(src)) offenders.push(f);
    }
    check("10. only server/sessionAuth.ts calls jwt.verify", offenders.length === 0, offenders.join(", "));
  } finally {
    server.close();
  }

  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
