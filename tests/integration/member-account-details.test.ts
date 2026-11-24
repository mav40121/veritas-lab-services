// tests/integration/member-account-details.test.ts
//
// BUG-194 (2026-11-24): a lab corrects sign-in details only for its own people (server/memberAccountControl.ts). Boots the REAL
// routes on a scratch DB (no mail key) and proves:
//   1. someone whose account is not the lab's alone keeps their sign-in email, name and two-factor as they are
//   2. the lab's own person, who joined by accepting its invitation and works only there, can be corrected
//   3. so can a person in two labs, by someone who manages both
//   4. a correction writes an audit row and ends the person's sessions (their old address is told; no mail key here)
//
// Run (Windows, from bash): npm run test:member-account-details
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY;
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const PW = ["De", "tails", "7x!"].join("-");
  const call = async (method: string, p: string, body: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  };
  const register = async (tag: string) => {
    const email = `ad-${tag}-${stamp}@example.com`;
    const r = await call("POST", "/api/auth/register", { email, password: PW, name: `AD ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id), token: r.body.token as string };
  };
  const provision = async (ownerEmail: string, labName: string) =>
    Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName, plan: "hospital" })).body.labId);
  const emailOf = (id: number) => (sqlite.prepare("SELECT email FROM users WHERE id = ?").get(id) as any)?.email as string;
  const nameOf = (id: number) => (sqlite.prepare("SELECT name FROM users WHERE id = ?").get(id) as any)?.name as string;

  const manager = await register("manager");
  const labX = await provision(manager.email, "Details Lab X");
  const otherOwner = await register("other-owner");
  const labV = await provision(otherOwner.email, "Other Lab");
  const otherMember = await register("other-member");
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, datetime('now'), datetime('now'), datetime('now'))").run(labV, otherMember.id);
  const noLab = await register("no-lab");
  const orgAdmin = await register("org-admin");
  const org = Number(sqlite.prepare("INSERT INTO organizations (name, billing_owner_user_id) VALUES ('Other System', ?)").run(otherOwner.id).lastInsertRowid);
  sqlite.prepare("INSERT INTO organization_members (organization_id, user_id, org_role, status, created_at, updated_at) VALUES (?, ?, 'org_admin', 'active', datetime('now'), datetime('now'))").run(org, orgAdmin.id);
  check("0. setup", labX > 0 && labV > 0 && [manager, otherOwner, otherMember, noLab, orgAdmin].every((u) => u.id > 0));

  const L = `/api/labs/${labX}/members`;
  const seat = async (email: string, role = "staff") => {
    const r = await call("POST", L, { email, role, firstName: "Any", lastName: "Body" }, manager.token);
    const m = sqlite.prepare("SELECT m.id FROM lab_members m JOIN users u ON u.id = m.user_id WHERE m.lab_id = ? AND lower(u.email) = lower(?) AND m.status = 'active'").get(labX, email) as any;
    return { status: r.status, memberId: m ? Number(m.id) : null };
  };

  // 1. An account that isn't this lab's alone.
  for (const [label, v, role] of [["the owner of another lab", otherOwner, "staff"], ["a member of another lab", otherMember, "staff"], ["a person with no lab", noLab, "staff"], ["an organization's admin", orgAdmin, "medical_director"]] as const) {
    const s = await seat(v.email, role);
    if (s.memberId == null) { check(`1. ${label}: not seated without accepting`, true, `HTTP ${s.status}`); continue; }
    const before = emailOf(v.id), beforeName = nameOf(v.id);
    const r = await call("PATCH", `${L}/${s.memberId}/email`, { email: `new-${v.id}-${stamp}@example.com` }, manager.token);
    check(`1. ${label}: the sign-in email can't be changed from the lab`, r.status === 409 && emailOf(v.id) === before, `HTTP ${r.status} ${r.body.code || ""} email now ${emailOf(v.id) === before ? "unchanged" : "CHANGED"}`);
    const n = await call("PATCH", `${L}/${s.memberId}/name`, { name: "Another Name" }, manager.token);
    check(`1. ${label}: the name can't be changed from the lab`, n.status === 409 && nameOf(v.id) === beforeName, `HTTP ${n.status}`);
    const f = await call("POST", `/api/labs/${labX}/two-factor/reset/${v.id}`, {}, manager.token);
    if (v !== noLab) check(`1. ${label}: two-factor can't be reset from the lab`, f.status === 409, `HTTP ${f.status} ${f.body.code || ""}`);
  }

  // 2. The lab's own person: an account made by accepting this lab's invitation.
  const own = `ad-own-${stamp}@example.com`;
  const inv = await call("POST", L, { email: own, role: "staff", firstName: "Own", lastName: "Person" }, manager.token);
  const token = (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ? AND lab_id = ?").get(own, labX) as any)?.invite_token;
  const joined = await call("POST", "/api/auth/register", { email: own, password: PW, name: "Own Person", hipaa_acknowledged: true, inviteToken: token, invite_token: token });
  let ownId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(own) as any)?.id);
  let ownMember = sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(labX, ownId) as any;
  if (!ownMember) {
    for (const p of ["/api/auth/accept-invite", "/api/account/seats/accept", "/api/join"]) {
      await call("POST", p, { token, inviteToken: token, password: PW, name: "Own Person" }, joined.body.token);
      ownMember = sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active'").get(labX, ownId) as any;
      if (ownMember) break;
    }
  }
  check("2a the lab's own invited person joins", ownId > 0 && !!ownMember, `invite HTTP ${inv.status} register HTTP ${joined.status}`);
  if (ownMember) {
    const fixed = `ad-own-fixed-${stamp}@example.com`;
    const r = await call("PATCH", `${L}/${ownMember.id}/email`, { email: fixed }, manager.token);
    check("2b their sign-in email can still be corrected", r.status === 200 && emailOf(ownId) === fixed, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    const n = await call("PATCH", `${L}/${ownMember.id}/name`, { name: "Own Person Fixed" }, manager.token);
    check("2c and their name", n.status === 200 && nameOf(ownId) === "Own Person Fixed", `HTTP ${n.status}`);
    const f = await call("POST", `/api/labs/${labX}/two-factor/reset/${ownId}`, {}, manager.token);
    check("2d and their two-factor reset", f.status === 200, `HTTP ${f.status} ${f.body.code || ""}`);
    const a = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type LIKE '%login_email%' AND entity_id = ?").get(String(ownId)) as any;
    check("4a the correction is in the audit log", Number(a?.n) === 1, JSON.stringify(a));
    const s = await call("GET", `/api/labs/${labX}/members`, undefined, joined.body.token);
    check("4b and the person's old sessions ended", s.status === 401, `HTTP ${s.status}`);
    // 5. Once they belong to another lab too, the first lab can't change it any more.
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))").run(labV, ownId);
    const r2 = await call("PATCH", `${L}/${ownMember.id}/email`, { email: `ad-own-again-${stamp}@example.com` }, manager.token);
    check("5. once they also work in a lab this owner doesn't manage, it is refused", r2.status === 409 && emailOf(ownId) === fixed, `HTTP ${r2.status} ${r2.body.code || ""}`);
    // 3. An owner of both labs can.
    sqlite.prepare("UPDATE labs SET owner_user_id = ? WHERE id = ?").run(manager.id, labV);
    sqlite.prepare("UPDATE lab_members SET status = 'inactive' WHERE lab_id = ? AND role = 'owner'").run(labV);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'owner', '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))").run(labV, manager.id);
    const r3 = await call("PATCH", `${L}/${ownMember.id}/email`, { email: `ad-own-both-${stamp}@example.com` }, manager.token);
    check("3. an owner of both labs still can", r3.status === 200, `HTTP ${r3.status} ${r3.body.code || ""}`);
  }
  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
