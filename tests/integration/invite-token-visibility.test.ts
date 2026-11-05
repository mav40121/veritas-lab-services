// tests/integration/invite-token-visibility.test.ts
//
// STANDING integration test for who can read the tokens that open a seat or the documents (found 2026-11-04 while writing up account types). An invite token is the link itself, and whoever holds it can claim the seat, an admin seat included.
//   1. Owners and admins get the invite token, so Copy link keeps working.
//   2. An editor and a Staff login still see who is invited, with no token anywhere in the response.
//   3. A pending invite is claimed only with its own link, inside 30 days. Typing the invited address is refused, since sign-up doesn't verify email. The link still works, and an admin invite still makes an admin.
//   4. Surveyor link tokens go to people with VeritaDC edit only. A Staff login and a view-only seat are refused.
//   5. The surveyor link itself still opens with no login.
//   6. The request log masks anything that carries a token.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:invite-token-visibility

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { redactPath, redactSensitive } from "../../server/logRedact";

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
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Token", "chk", "77!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch {}
    return { status: r.status, body: parsed, text };
  };

  try {
    const stamp = Date.now();
    const mail = (tag: string) => `token-${tag}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email: mail("owner"), password: PW, name: "Owner Madeup", hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail("owner"), labName: "Token Lab", plan: "hospital", isWarehouse: true });
    const labId = prov.body.labId as number;
    const owner = reg.body.token as string;
    const L = `/api/labs/${labId}`;
    const seatToken = (email: string) => (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ?").get(email) as any)?.invite_token as string;
    const join = async (email: string, token: string) => (await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up", hipaa_acknowledged: true, inviteToken: token })).body.token as string;
    const invite = async (tag: string, role: string) => {
      const r = await call("POST", `${L}/members`, { email: mail(tag), role, firstName: "Made", lastName: tag }, owner);
      check(`setup: ${tag} invited`, r.status === 200 && !!seatToken(mail(tag)), `HTTP ${r.status} ${r.body.error ?? ""}`);
      return seatToken(mail(tag));
    };

    const admin = await join(mail("admin"), await invite("admin", "admin"));
    const editor = await join(mail("editor"), await invite("editor", "staff"));
    const viewer = await join(mail("viewer"), await invite("viewer", "staff"));
    const staffInvite = await call("POST", `${L}/staff-portal-invites`, { email: mail("staff"), firstName: "Made", lastName: "Staff", deliverEmail: false }, owner);
    check("setup: Staff login invited", staffInvite.status === 200, `HTTP ${staffInvite.status} ${staffInvite.body.error ?? ""}`);
    const staff = await join(mail("staff"), seatToken(mail("staff")));
    const staffPerms = (sqlite.prepare("SELECT permissions FROM user_seats WHERE seat_email = ?").get(mail("staff")) as any).permissions;
    sqlite.prepare("UPDATE user_seats SET permissions = ? WHERE seat_email = ?").run(staffPerms, mail("viewer"));

    // The invite everyone is looking at: still pending, and for an admin seat.
    const pendingAdmin = mail("pendingadmin");
    const pendingToken = await invite("pendingadmin", "admin");
    const row = (b: any) => (b.pendingInvites || []).find((p: any) => p.seat_email === pendingAdmin);

    // 1. People who manage members
    for (const [who, token] of [["The owner", owner], ["An admin", admin]] as const) {
      const r = await call("GET", `${L}/members`, undefined, token);
      check(`1. ${who} gets the invite token`, r.status === 200 && row(r.body)?.invite_token === pendingToken, `HTTP ${r.status}`);
    }

    // 2. Everyone else
    for (const [who, token] of [["An editor", editor], ["A Staff login", staff], ["A view-only seat", viewer]] as const) {
      const r = await call("GET", `${L}/members`, undefined, token);
      check(`2. ${who} still sees who is invited`, r.status === 200 && !!row(r.body), `HTTP ${r.status}`);
      check(`2. ${who} gets no token on that row`, row(r.body)?.invite_token === null);
      check(`2. ${who} gets the token nowhere in the response`, !r.text.includes(pendingToken));
    }
    const sup = await call("POST", "/api/auth/register", { email: mail("support"), password: PW, name: "Support Madeup", hipaa_acknowledged: true });
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE lower(email) = ?").run(mail("support"));
    const viaSupport = await call("GET", `${L}/members`, undefined, sup.body.token);
    check("2. Veritas support still sees who is invited", viaSupport.status === 200 && !!row(viaSupport.body), `HTTP ${viaSupport.status} ${viaSupport.body.error ?? ""}`);
    check("2. Veritas support gets the token nowhere in the response", !viaSupport.text.includes(pendingToken));
    const list = await call("GET", `${L}/staff-portal-invites`, undefined, staff);
    check("2. The Staff login invite list carries no token either", !list.text.includes(pendingToken) && !/invite_token|inviteToken/.test(list.text), `HTTP ${list.status}`);

    // 3. Typing the address is not enough. Sign-up doesn't verify email, so this used to take the seat.
    const typed = await call("POST", "/api/auth/register", { email: pendingAdmin, password: PW, name: "Someone Else", hipaa_acknowledged: true });
    check("3. Signing up with an invited address and no link is refused", typed.status === 409 && typed.body.code === "INVITE_LINK_REQUIRED", `HTTP ${typed.status} ${typed.body.code ?? ""}`);
    const typedUpper = await call("POST", "/api/auth/register", { email: pendingAdmin.toUpperCase(), password: PW, name: "Someone Else", hipaa_acknowledged: true });
    check("3. Capital letters don't get around it", typedUpper.status === 409, `HTTP ${typedUpper.status}`);
    const wrong = await call("POST", "/api/auth/register", { email: pendingAdmin, password: PW, name: "Someone Else", hipaa_acknowledged: true, inviteToken: "not-a-real-token" });
    check("3. A made-up link is refused too", wrong.status === 409, `HTTP ${wrong.status}`);
    check("3. None of those made an account", !sqlite.prepare("SELECT 1 FROM users WHERE lower(email) = ?").get(pendingAdmin));
    const stillPending = sqlite.prepare("SELECT status FROM user_seats WHERE seat_email = ?").get(pendingAdmin) as any;
    check("3. The seat is still waiting for its invitee", stillPending?.status === "pending", JSON.stringify(stillPending));
    const outsider = await call("POST", "/api/auth/register", { email: mail("outsider"), password: PW, name: "Plain Signup", hipaa_acknowledged: true });
    check("3. Someone with no invite still signs up normally", outsider.status < 300 && !!outsider.body.token, `HTTP ${outsider.status}`);

    // An expired link is dead on the server too, not only on the join page.
    const oldEmail = mail("oldinvite");
    const oldToken = await invite("oldinvite", "admin");
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE seat_email = ?").run(new Date(Date.now() - 31 * 86400000).toISOString(), oldEmail);
    const expired = await call("POST", "/api/auth/register", { email: oldEmail, password: PW, name: "Too Late", hipaa_acknowledged: true, inviteToken: oldToken });
    check("3. A link past 30 days is refused", expired.status === 400 && expired.body.code === "INVITE_EXPIRED", `HTTP ${expired.status} ${expired.body.code ?? ""}`);
    sqlite.prepare("UPDATE user_seats SET invited_at = ? WHERE seat_email = ?").run(new Date(Date.now() - 29 * 86400000).toISOString(), oldEmail);
    const inTime = await call("POST", "/api/auth/register", { email: oldEmail, password: PW, name: "In Time", hipaa_acknowledged: true, inviteToken: oldToken });
    check("3. A link inside 30 days still works", inTime.status < 300 && !!inTime.body.token, `HTTP ${inTime.status} ${inTime.body.code ?? ""}`);

    // The link itself still works
    const joined = await join(pendingAdmin, pendingToken);
    const me = sqlite.prepare("SELECT lm.role FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? AND lower(u.email) = ?").get(labId, pendingAdmin) as any;
    check("3. The invite link still signs the person up", !!joined);
    check("3. An admin invite still makes an admin", me?.role === "admin", JSON.stringify(me));

    // 4. Surveyor link tokens
    const made = await call("POST", `${L}/veritapolicy/surveyor-links`, { label: "Made-up survey" }, owner);
    const surveyorToken = (made.body.token ?? made.body.link?.token) as string;
    check("4. The owner can make a surveyor link", made.status < 300 && !!surveyorToken, `HTTP ${made.status} ${made.body.error ?? ""}`);
    const links = `${L}/veritapolicy/surveyor-links`;
    for (const [who, token] of [["The owner", owner], ["An admin", admin], ["An editor", editor]] as const) {
      const r = await call("GET", links, undefined, token);
      check(`4. ${who} sees the link and its token`, r.status === 200 && r.body.links?.[0]?.token === surveyorToken, `HTTP ${r.status}`);
    }
    for (const [who, token] of [["A Staff login", staff], ["A view-only seat", viewer]] as const) {
      const r = await call("GET", links, undefined, token);
      check(`4. ${who} is refused`, r.status === 403 && !r.text.includes(surveyorToken), `HTTP ${r.status}`);
    }

    // 5. The link itself
    const opened = await call("GET", `/api/surveyor/${surveyorToken}/policies`);
    check("5. The surveyor link still opens with no login", opened.status === 200, `HTTP ${opened.status}`);

    // 6. The request logger writes every response body, through this replacer
    const logged = JSON.stringify({ pendingInvites: [{ seat_email: "a@example.com", invite_token: "TOK-1", invite_role: "admin" }], inviteToken: "TOK-2", joinUrl: "https://x/join?token=TOK-3", token: "TOK-4", session_token: "TOK-5", sessionToken: "TOK-6", secret: "TOK-7", password: "TOK-8", token_count: 5 }, redactSensitive);
    check("6. No token, secret or password reaches the log", !/TOK-\d/.test(logged), logged.match(/TOK-\d/)?.[0] ?? "");
    check("6. Everything else is still logged", logged.includes('"seat_email":"a@example.com"') && logged.includes('"invite_role":"admin"') && logged.includes('"token_count":5'));
    const seatsRow = JSON.stringify(sqlite.prepare("SELECT * FROM user_seats WHERE invite_token IS NOT NULL LIMIT 1").get() ?? {}, redactSensitive);
    check("6. A whole seat row logs with its token masked", seatsRow.includes('"invite_token":"[REDACTED]"'));
    const linkFields = JSON.stringify({ url: "https://x/join?token=TOK-1", resetUrl: "https://x/reset-password?token=TOK-2", inviteUrl: "https://x/join?token=TOK-3", onboardingUrl: "https://x/reset-password?token=TOK-4", surveyor: "https://x/surveyor/TOK-5-long-enough", checkout: "https://checkout.stripe.com/c/pay/cs_live_abc" }, redactSensitive);
    check("6. A link that carries a token is masked, whatever its key", !/TOK-\d/.test(linkFields), linkFields.match(/TOK-\d/)?.[0] ?? "");
    check("6. An ordinary link is still logged", linkFields.includes("checkout.stripe.com"));
    for (const p of ["/api/surveyor/TOK-6/policies", "/api/surveyor/TOK-6/policies/4/render", "/api/seats/invite/TOK-6", "/api/pdf/TOK-6", "/api/zip/TOK-6", "/api/export-all/file/TOK-6", "/api/scheduling/booking/TOK-6/cancel"]) {
      check(`6. The path ${p.replace("TOK-6", ":token")} is masked`, !redactPath(p).includes("TOK-6"), redactPath(p));
    }
    check("6. The rest of a masked path stays", redactPath("/api/surveyor/TOK-6/policies/4/render") === "/api/surveyor/[REDACTED]/policies/4/render");
    check("6. Other paths are unchanged", redactPath(`/api/labs/${labId}/members`) === `/api/labs/${labId}/members`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
