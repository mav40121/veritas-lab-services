// tests/integration/terms-gate.test.ts
//
// Terms of Use and Confidentiality Agreement (Michael 2026-11-03, Q141 = 1; server/termsOfUse.ts). Pins:
//   1. a deploy alone asks nobody: until an admin activates a version, signed-in people use the app as before
//   2. activation is admin-only, dry run by default, and only the current version can be activated
//   3. once active, a signed-in person who has not accepted gets 403 TERMS_REQUIRED (+ X-Terms-Required) on every API
//      route, in routes.ts and in other route files (two-factor, staff login), and is not logged out: reading the
//      agreement, /api/auth/me and signing out still work
//   4. not people, not gated: scripts' service tokens, the shared demo account, requests with no sign-in (their own 401)
//   5. accepting needs the current version, the box and a typed name; it records the name, time, IP, browser and the
//      text hash; the person is let through at once; accepting again keeps the first record
//   6. a lab owner must also accept for the organization, and the record lists the labs accepted for
//   7. a new version asks everyone again; deactivating stops asking and keeps what was accepted
// Every person here is made up; the database is a scratch file.
// Run: npm run test:terms-gate

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { issueSession } from "../../server/sessionAuth";
import { TERMS_TEXT_SHA256 } from "../../server/termsOfUse";
import { TERMS_VERSION } from "../../shared/termsOfUse";
import { DEMO_USER_EMAIL } from "../../server/constants";

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
  const call = async (method: string, p: string, body?: any, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", "User-Agent": "terms-gate-test", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, header: r.headers.get("x-terms-required"), body: (await r.json().catch(() => ({}))) as any };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const fakeReq = { headers: { "user-agent": "terms-gate-test" }, ip: "127.0.0.1" };
  const session = (uid: number) => issueSession(sqlite, uid, fakeReq).token;
  const mkUser = (tag: string, name = `IT Terms ${tag}`) => {
    const email = `it-terms-${tag}-${Date.now()}@example.com`;
    sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at, hipaa_acknowledged, hipaa_ack_source) VALUES (?, 'x', ?, 'free', ?, 1, 'signup')")
      .run(email, name, new Date().toISOString());
    return Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
  };
  const ROUTE = "/api/auth/no-phi-acknowledgment"; // an ordinary signed-in route in routes.ts
  const accept = (token: string, extra: any = {}) => call("POST", "/api/auth/terms/accept", { version: TERMS_VERSION, agree: true, signedName: "Pat Example", ...extra }, token);

  try {
    const cols = (t: string) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
    check("boot created terms_acceptances and terms_activations", cols("terms_acceptances").includes("text_sha256") && cols("terms_activations").includes("active"));

    // 1. Nothing active
    const a = mkUser("a");
    const aTok = session(a);
    const before = await call("GET", ROUTE, undefined, aTok);
    const st0 = await call("GET", "/api/auth/terms", undefined, aTok);
    check("1. before activation a signed-in person uses the app as before", before.status === 200 && st0.body.required === false && st0.body.activeVersion === null, JSON.stringify({ s: before.status, st: st0.body }));

    // 2. Activation
    const noSecret = await call("POST", "/api/admin/terms/activate", { version: TERMS_VERSION, dryRun: false });
    const wrongVersion = await call("POST", "/api/admin/terms/activate", { secret: ADMIN, version: "1999-01-01", dryRun: false });
    const dry = await call("POST", "/api/admin/terms/activate", { secret: ADMIN, version: TERMS_VERSION });
    const stillOpen = await call("GET", ROUTE, undefined, aTok);
    check("2. activation needs the admin secret (403) and the current version (400)", noSecret.status === 403 && wrongVersion.status === 400, `${noSecret.status} ${wrongVersion.status}`);
    check("2. activation is a dry run by default: nothing activated, nobody asked", dry.status === 200 && dry.body.dryRun === true && stillOpen.status === 200
      && !(sqlite.prepare("SELECT 1 FROM terms_activations WHERE active = 1").get()), JSON.stringify(dry.body));
    const act = await call("POST", "/api/admin/terms/activate", { secret: ADMIN, version: TERMS_VERSION, dryRun: false });
    check("2. a real activation records the version and the text hash", act.status === 200 && act.body.dryRun === false && act.body.textSha256 === TERMS_TEXT_SHA256
      && (sqlite.prepare("SELECT terms_version FROM terms_activations WHERE active = 1").get() as any)?.terms_version === TERMS_VERSION, JSON.stringify(act.body));

    // 3. Held, not logged out
    const held = await call("GET", ROUTE, undefined, aTok);
    check("3. an ordinary route answers 403 TERMS_REQUIRED with the X-Terms-Required header", held.status === 403 && held.body.code === "TERMS_REQUIRED" && held.header === TERMS_VERSION, JSON.stringify({ s: held.status, h: held.header, b: held.body }));
    const heldMfa = await call("GET", "/api/auth/mfa", undefined, aTok);
    const heldStaff = await call("GET", "/api/staff-portal-session/policies", undefined, aTok);
    const heldSessions = await call("GET", "/api/auth/sessions", undefined, aTok);
    check("3. routes in other files are held too (two-factor, staff login, signed-in devices)", [heldMfa, heldStaff, heldSessions].every((r) => r.status === 403 && r.body.code === "TERMS_REQUIRED"),
      [heldMfa.status, heldStaff.status, heldSessions.status].join(" "));
    const me = await call("GET", "/api/auth/me", undefined, aTok);
    const st1 = await call("GET", "/api/auth/terms", undefined, aTok);
    check("3. the person is still signed in: /api/auth/me and the agreement status answer", me.status === 200 && st1.status === 200 && st1.body.required === true && st1.body.isOwner === false,
      JSON.stringify({ me: me.status, st: st1.body }));
    check("3. the session was not ended", Number((sqlite.prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ? AND is_active = 1").get(a) as any).n) === 1);

    // 4. Not people
    const svcRes = await call("GET", ROUTE, undefined, svc(a));
    const anon = await call("GET", ROUTE);
    if (!(sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL))) {
      sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Demo User', 'lab', ?)").run(DEMO_USER_EMAIL, new Date().toISOString());
    }
    const demoId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any).id);
    const demoRes = await call("GET", ROUTE, undefined, session(demoId));
    check("4. a script's service token is not held", svcRes.status === 200, String(svcRes.status));
    check("4. a request with no sign-in gets its route's own 401, not the agreement", anon.status === 401 && anon.body.code !== "TERMS_REQUIRED", String(anon.status));
    check("4. the shared demo account is not held", demoRes.status === 200, String(demoRes.status));

    // 5. Accepting
    const stale = await accept(aTok, { version: "1999-01-01" });
    const noBox = await accept(aTok, { agree: false });
    const noName = await accept(aTok, { signedName: "  " });
    check("5. accepting needs the current version (409), the box (400) and a typed name (400)", stale.status === 409 && noBox.status === 400 && noName.status === 400 && noName.body.code === "NAME_REQUIRED",
      `${stale.status} ${noBox.status} ${noName.status}`);
    const t0 = Date.now();
    const ok = await accept(aTok, { signedName: "  Pat   Example " });
    const rowA = sqlite.prepare("SELECT * FROM terms_acceptances WHERE user_id = ?").get(a) as any;
    check("5. acceptance records the typed name, time, IP, browser and the text hash", ok.status === 200 && ok.body.recorded === true && rowA?.signed_name === "Pat Example"
      && Date.parse(rowA.accepted_at) >= t0 - 1000 && !!rowA.ip_address && rowA.user_agent === "terms-gate-test" && rowA.text_sha256 === TERMS_TEXT_SHA256
      && rowA.accepted_for_organization === 0 && rowA.account_name === "IT Terms a", JSON.stringify(rowA));
    const after = await call("GET", ROUTE, undefined, aTok);
    check("5. the person is let through at once, same session", after.status === 200 && ok.body.status?.required === false, `${after.status} ${JSON.stringify(ok.body.status)}`);
    const again = await accept(aTok, { signedName: "Someone Else" });
    check("5. accepting again keeps the first record", again.body.recorded === false && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM terms_acceptances WHERE user_id = ?").get(a) as any).n) === 1
      && (sqlite.prepare("SELECT signed_name FROM terms_acceptances WHERE user_id = ?").get(a) as any).signed_name === "Pat Example");

    // 6. Owner
    const prov = await call("POST", "/api/admin/provision-owner-lab", { secret: ADMIN, ownerEmail: `it-terms-owner-${Date.now()}@example.com`, ownerName: "IT Terms Owner", labName: "IT Terms Lab", plan: "hospital" });
    const owner = Number(prov.body.owner_user_id);
    const ownerLab = Number(prov.body.lab_id);
    const oTok = session(owner);
    const oSt = await call("GET", "/api/auth/terms", undefined, oTok);
    check("6. an owner is asked to accept for the organization, naming the lab", oSt.body.required === true && oSt.body.isOwner === true && (oSt.body.acceptsFor || []).includes("IT Terms Lab"), JSON.stringify(oSt.body));
    const oNo = await accept(oTok);
    check("6. an owner who does not accept for the organization is refused (400 ORG_ACCEPTANCE_REQUIRED)", oNo.status === 400 && oNo.body.code === "ORG_ACCEPTANCE_REQUIRED", JSON.stringify(oNo.body));
    const oYes = await accept(oTok, { onBehalfOfOrganization: true, signedName: "Owner Example" });
    const rowO = sqlite.prepare("SELECT * FROM terms_acceptances WHERE user_id = ?").get(owner) as any;
    check("6. the owner's record says it binds the organization and lists the lab", oYes.status === 200 && rowO?.accepted_for_organization === 1
      && JSON.parse(rowO.organization_lab_ids || "[]").includes(ownerLab) && JSON.parse(rowO.organization_names || "[]").includes("IT Terms Lab"), JSON.stringify(rowO));

    // 7. New version, deactivate, sign out while held
    sqlite.prepare("UPDATE terms_activations SET active = 0").run();
    sqlite.prepare("INSERT INTO terms_activations (terms_version, text_sha256, active, activated_at, activated_by) VALUES ('2099-01-01', 'x', 1, ?, 'test')").run(new Date().toISOString());
    await call("POST", "/api/admin/terms/deactivate", { secret: ADMIN }); // clears the cache, then the future version is re-activated below
    sqlite.prepare("INSERT INTO terms_activations (terms_version, text_sha256, active, activated_at, activated_by) VALUES ('2099-01-01', 'x', 1, ?, 'test')").run(new Date().toISOString());
    const reask = await call("GET", ROUTE, undefined, aTok);
    check("7. a new version asks again someone who accepted the old one", reask.status === 403 && reask.header === "2099-01-01", `${reask.status} ${reask.header}`);
    const off = await call("POST", "/api/admin/terms/deactivate", { secret: ADMIN });
    const freed = await call("GET", ROUTE, undefined, aTok);
    check("7. deactivating stops asking and keeps what was accepted", off.status === 200 && freed.status === 200
      && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM terms_acceptances").get() as any).n) >= 2, `${off.status} ${freed.status}`);
    await call("POST", "/api/admin/terms/activate", { secret: ADMIN, version: TERMS_VERSION, dryRun: false });
    const c = mkUser("c");
    const cTok = session(c);
    const cHeld = await call("GET", ROUTE, undefined, cTok);
    const out = await call("POST", "/api/auth/logout", {}, cTok);
    check("7. a held person can still sign out, which ends that session", cHeld.status === 403 && out.status === 200
      && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ? AND is_active = 1").get(c) as any).n) === 0, `${cHeld.status} ${out.status}`);
    const stat = await call("GET", "/api/admin/terms/status", undefined, undefined, { "x-admin-secret": ADMIN });
    check("admin status is counts only", stat.status === 200 && stat.body.activeVersion === TERMS_VERSION && typeof stat.body.accepted === "number" && !JSON.stringify(stat.body).includes("@"), JSON.stringify(stat.body));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
