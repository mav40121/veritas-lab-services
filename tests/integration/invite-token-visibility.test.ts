// tests/integration/invite-token-visibility.test.ts
//
// STANDING integration test for who can read the tokens that open a seat or the documents (found 2026-11-04 while writing up account types). An invite token is the link itself, and whoever holds it can claim the seat, an admin seat included.
//   1. Owners and admins get the invite token, so Copy link keeps working.
//   2. An editor and a Staff login still see who is invited, with no token anywhere in the response.
//   3. The invite link still works, and an admin invite still makes an admin.
//   4. Surveyor link tokens go to people with VeritaDC edit only. A Staff login and a view-only seat are refused.
//   5. The surveyor link itself still opens with no login.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:invite-token-visibility

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

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
    const list = await call("GET", `${L}/staff-portal-invites`, undefined, staff);
    check("2. The Staff login invite list carries no token either", !list.text.includes(pendingToken) && !/invite_token|inviteToken/.test(list.text), `HTTP ${list.status}`);

    // 3. The link still works
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
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
