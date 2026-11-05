// tests/integration/email-verification.test.ts
//
// STANDING integration test for email verification at sign-up (Michael 2026-11-05).
//   1. A public sign-up returns no session and the account is waiting.
//   2. It can't sign in until confirmed. A wrong password still reads as a wrong password.
//   3. The link alone confirms nothing: it needs the password chosen at sign-up.
//   4. The right password confirms it, the account signs in, and the link works once.
//   5. An expired link is refused.
//   6. Squatting fails: an unconfirmed account gets no invite, no seat and no membership, and the real person's invitation
//      link replaces it, so the first sign-up's password stops working.
//   7. Signing up again replaces an unconfirmed account and kills its old link. A confirmed address stays taken.
//   8. A password reset confirms the address. Accounts from before this aren't affected.
//   9. A new link can be sent, at most once a minute, and the answer doesn't reveal whether an account exists.
//  10. An invitation's link signs up only the address it was mailed to, and a made-up token doesn't skip verification.
//  11. With verification off, sign-up works as it did.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:email-verification

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { startEmailVerification } from "../../server/emailVerification";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.set("trust proxy", true);
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Verify", "chk", "77!"].join("-");
  const PW2 = ["Second", "chk", "88!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const stamp = Date.now();
    const mail = (t: string) => `verify-${t}-${stamp}@example.com`;
    const signUp = (email: string, password = PW, extra: object = {}) => call("POST", "/api/auth/register", { email, password, name: "Made Up", hipaa_acknowledged: true, ...extra });
    const signIn = (email: string, password = PW) => call("POST", "/api/auth/login", { email, password, force_login: true });
    const row = (email: string) => sqlite.prepare("SELECT id, email_verification_pending AS pending, email_verification_token_hash AS hash FROM users WHERE lower(email) = ?").get(email) as any;
    const freshLink = (email: string) => startEmailVerification(sqlite, row(email).id);
    const verify = (token: string, password = PW) => call("POST", "/api/auth/verify-email", { token, password });

    // 11. Off, and the lab owner for the invites below, signed up before verification was on.
    process.env.EMAIL_VERIFICATION = "off";
    const ownerReg = await signUp(mail("owner"));
    check("11. With verification off, sign-up returns a session as it did", !!ownerReg.body.token && !ownerReg.body.verification_required, JSON.stringify(Object.keys(ownerReg.body)));
    const owner = ownerReg.body.token as string;
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail("owner"), labName: "Verify Lab", plan: "hospital", isWarehouse: true })).body.labId as number;
    const L = `/api/labs/${labId}`;
    process.env.EMAIL_VERIFICATION = "on";
    check("8. An account from before this isn't waiting", row(mail("owner")).pending === 0);
    const ownerIn = await signIn(mail("owner"));
    check("8. It still signs in", ownerIn.status === 200 && !!ownerIn.body.token, `HTTP ${ownerIn.status} ${ownerIn.body.code ?? ""}`);

    // 1. Sign-up
    const a = mail("alice");
    const reg = await signUp(a);
    check("1. Sign-up says to check email", reg.status === 200 && reg.body.verification_required === true && reg.body.email === a, `HTTP ${reg.status}`);
    check("1. It returns no session", !reg.body.token && !reg.body.session_token);
    check("1. The account is waiting, and no session row exists", row(a).pending === 1 && (sqlite.prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?").get(row(a).id) as any).n === 0);
    check("1. The link isn't stored in the clear", /^[0-9a-f]{64}$/.test(row(a).hash || ""));

    // 2. Sign-in
    const early = await signIn(a);
    check("2. Sign-in is refused until confirmed", early.status === 403 && early.body.code === "EMAIL_NOT_VERIFIED" && !early.body.token, `HTTP ${early.status} ${early.body.code ?? ""}`);
    const wrong = await signIn(a, PW2);
    check("2. A wrong password reads as a wrong password", wrong.status === 401 && wrong.body.code !== "EMAIL_NOT_VERIFIED", `HTTP ${wrong.status}`);

    // 3. The link alone
    const link = freshLink(a);
    const noPw = await call("POST", "/api/auth/verify-email", { token: link });
    check("3. The link with no password is refused", noPw.status === 400 && row(a).pending === 1, `HTTP ${noPw.status}`);
    const badPw = await verify(link, PW2);
    check("3. The link with another password is refused", badPw.status === 401 && row(a).pending === 1, `HTTP ${badPw.status}`);
    const madeUp = await verify("0".repeat(64));
    check("3. A made-up link is refused", madeUp.status === 400 && madeUp.body.code === "VERIFY_LINK_INVALID", `HTTP ${madeUp.status}`);

    // 4. Confirmed
    const good = await verify(link);
    check("4. The link with the right password confirms it", good.status === 200 && row(a).pending === 0, `HTTP ${good.status} ${good.body.error ?? ""}`);
    const inNow = await signIn(a);
    check("4. The account signs in now", inNow.status === 200 && !!inNow.body.token, `HTTP ${inNow.status} ${inNow.body.code ?? ""}`);
    const again = await verify(link);
    check("4. The link works once", again.status === 400, `HTTP ${again.status}`);

    // 5. Expired
    const b = mail("bea");
    await signUp(b);
    const bLink = freshLink(b);
    sqlite.prepare("UPDATE users SET email_verification_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), row(b).id);
    const late = await verify(bLink);
    check("5. An expired link is refused", late.status === 400 && late.body.code === "VERIFY_LINK_EXPIRED" && row(b).pending === 1, `HTTP ${late.status} ${late.body.code ?? ""}`);

    // 6. Squatting on an address before it's invited
    const c = mail("carol");
    await signUp(c, PW2); // someone else gets there first
    const invite = await call("POST", `${L}/members`, { email: c, role: "admin", firstName: "Made", lastName: "Carol" }, owner);
    const seat = sqlite.prepare("SELECT status, seat_user_id, invite_token FROM user_seats WHERE seat_email = ?").get(c) as any;
    check("6. The invite stays pending", invite.status === 200 && seat?.status === "pending" && seat?.seat_user_id == null, JSON.stringify({ status: seat?.status, user: seat?.seat_user_id }));
    check("6. The unconfirmed account got no membership", !sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, row(c).id));
    const squatter = await signIn(c, PW2);
    check("6. It still can't sign in", squatter.status === 403, `HTTP ${squatter.status}`);
    const real = await signUp(c, PW, { inviteToken: seat.invite_token });
    check("6. The real person's invitation link works", real.status === 200 && !!real.body.token, `HTTP ${real.status} ${real.body.error ?? ""}`);
    check("6. It made one account, confirmed, an admin", row(c).pending === 0 && (sqlite.prepare("SELECT role FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, row(c).id) as any)?.role === "admin");
    const oldPw = await signIn(c, PW2);
    check("6. The first sign-up's password no longer works", oldPw.status === 401, `HTTP ${oldPw.status}`);
    check("6. The real person's password does", (await signIn(c)).status === 200);

    // 7. Signing up again
    const d = mail("dana");
    await signUp(d, PW2);
    const dOld = freshLink(d);
    const dAgain = await signUp(d, PW);
    check("7. Signing up again with an unconfirmed address works", dAgain.status === 200 && dAgain.body.verification_required === true, `HTTP ${dAgain.status}`);
    check("7. The old link is dead", (await verify(dOld, PW2)).status === 400);
    const dLink = freshLink(d);
    check("7. The earlier password can't confirm it", (await verify(dLink, PW2)).status === 401);
    check("7. The latest password can", (await verify(dLink, PW)).status === 200);
    const taken = await signUp(d, PW2);
    check("7. A confirmed address stays taken", taken.status === 409, `HTTP ${taken.status}`);

    // 8. A password reset proves the address
    const e = mail("erin");
    await signUp(e);
    const resetToken = `reset-${stamp}`;
    sqlite.prepare("INSERT OR REPLACE INTO reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)").run(row(e).id, resetToken, new Date(Date.now() + 3600000).toISOString());
    const reset = await call("POST", "/api/auth/reset-password", { token: resetToken, password: PW2 });
    check("8. A password reset confirms the address", reset.status === 200 && row(e).pending === 0, `HTTP ${reset.status} ${reset.body.error ?? ""}`);

    // 9. A new link
    const f = mail("fay");
    await signUp(f);
    const before = row(f).hash;
    const tooSoon = await call("POST", "/api/auth/resend-verification", { email: f });
    check("9. A new link inside a minute changes nothing", tooSoon.status === 200 && row(f).hash === before);
    sqlite.prepare("UPDATE users SET email_verification_sent_at = ? WHERE id = ?").run(new Date(Date.now() - 120000).toISOString(), row(f).id);
    const resent = await call("POST", "/api/auth/resend-verification", { email: f });
    check("9. After a minute there's a new link", resent.status === 200 && row(f).hash !== before);
    const nobody = await call("POST", "/api/auth/resend-verification", { email: mail("nobody") });
    check("9. An unknown address gets the same answer", nobody.status === 200 && JSON.stringify(nobody.body) === JSON.stringify(resent.body));

    // 10. Invitation links
    const g = mail("gail");
    await call("POST", `${L}/members`, { email: g, role: "staff", firstName: "Made", lastName: "Gail" }, owner);
    const gToken = (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ?").get(g) as any).invite_token;
    const other = await signUp(mail("other"), PW, { inviteToken: gToken });
    check("10. An invitation's link refuses another address", other.status === 400 && other.body.code === "INVITE_EMAIL_MISMATCH" && !row(mail("other")), `HTTP ${other.status} ${other.body.code ?? ""}`);
    const fake = await signUp(mail("fake"), PW, { inviteToken: "not-a-real-token" });
    check("10. A made-up token doesn't skip verification", fake.body.verification_required === true && !fake.body.token && row(mail("fake")).pending === 1, JSON.stringify(Object.keys(fake.body)));
    const gJoin = await signUp(g, PW, { inviteToken: gToken });
    check("10. The right address signs straight in", gJoin.status === 200 && !!gJoin.body.token && row(g).pending === 0, `HTTP ${gJoin.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
