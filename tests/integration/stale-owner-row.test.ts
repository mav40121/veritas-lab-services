// tests/integration/stale-owner-row.test.ts
//
// A leftover lab_members 'owner' row on someone who is NOT labs.owner_user_id (Michael 2026-10-15:
// "remove me from ownership of san carlos. Only Chineme should be the owner"; lab 2 carried a
// 2026-07-22 owner row for Michael while Chineme owns it). Owner powers follow lab_members.role, so the
// row made a second owner. POST /api/admin/repair-lab-admins now demotes such a row to admin (dry run
// first) and still never touches the real owner; PATCH /api/labs/:id/members/:mid lets the real owner
// fix one, and still refuses the real owner's own row.
// Run: npm run test:stale-owner-row

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
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
  const call = async (method: string, p: string, body?: any, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const pw = ["Zq", "owner", "7x!"].join("-");
  const reg = async (tag: string) => {
    const email = `it-stale-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };
  const roleOf = (lab: number, uid: number) => (sqlite.prepare("SELECT role, status FROM lab_members WHERE lab_id = ? AND user_id = ?").get(lab, uid) as any);

  try {
    const real = await reg("realowner");
    const old = await reg("oldowner");
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: real.email, labName: "IT Two Owner Rows", plan: "hospital" })).body.labId);
    await call("POST", "/api/admin/add-lab-membership", { secret: ADMIN, userId: old.id, labId: L, role: "owner" });
    check("0. setup: the lab's owner is the real owner, and a second 'owner' row exists", (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(L) as any).owner_user_id === real.id && roleOf(L, old.id)?.role === "owner" && roleOf(L, real.id)?.role === "owner");

    const dry = await call("POST", "/api/admin/repair-lab-admins", { secret: ADMIN, labIds: [L], emails: [old.email, real.email], dryRun: true });
    const du = dry.body.report?.[0]?.users || [];
    check("1. dry run: the leftover row would be set to admin; the real owner is left alone; nothing written", du.find((u: any) => u.user_id === old.id)?.result === "would_demote_stale_owner_to_admin" && du.find((u: any) => u.user_id === real.id)?.result === "owner_unchanged" && roleOf(L, old.id).role === "owner", JSON.stringify(du.map((u: any) => u.result)));

    const go = await call("POST", "/api/admin/repair-lab-admins", { secret: ADMIN, labIds: [L], emails: [old.email, real.email] });
    const gu = go.body.report?.[0]?.users || [];
    check("2. apply: the leftover row is now admin (still active); the real owner is still owner", gu.find((u: any) => u.user_id === old.id)?.result === "demoted_stale_owner_to_admin" && roleOf(L, old.id).role === "admin" && roleOf(L, old.id).status === "active" && roleOf(L, real.id).role === "owner");
    const audit = sqlite.prepare("SELECT before_json, after_json FROM audit_log WHERE entity_type = 'lab_membership' AND action = 'update_role:admin/repair-lab-admins:stale-owner' ORDER BY id DESC LIMIT 1").get() as any;
    check("3. the audit trail records owner -> admin for that row", JSON.parse(audit?.before_json || "{}").role === "owner" && JSON.parse(audit?.after_json || "{}").role === "admin" && JSON.parse(audit?.after_json || "{}").user_id === old.id, JSON.stringify({ found: !!audit }));
    const again = await call("POST", "/api/admin/repair-lab-admins", { secret: ADMIN, labIds: [L], emails: [old.email] });
    check("4. running it again changes nothing (already admin)", again.body.report?.[0]?.users?.[0]?.result === "already_admin");
    const lst = await call("GET", "/api/labs/me", undefined, svc(old.id));
    const row = (Array.isArray(lst.body) ? lst.body : lst.body.labs || []).find((x: any) => Number(x.labId) === L);
    check("5. the former owner's lab list now says admin", row?.role === "admin", JSON.stringify(row?.role));

    // The real owner can fix a leftover owner row from the Members page; their own row stays protected.
    sqlite.prepare("UPDATE lab_members SET role = 'owner' WHERE lab_id = ? AND user_id = ?").run(L, old.id);
    const oldMid = Number((sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ?").get(L, old.id) as any).id);
    const realMid = Number((sqlite.prepare("SELECT id FROM lab_members WHERE lab_id = ? AND user_id = ?").get(L, real.id) as any).id);
    const p1 = await call("PATCH", `/api/labs/${L}/members/${oldMid}`, { role: "admin" }, svc(real.id), L);
    check("6. the real owner sets a leftover owner row to admin from the Members page", p1.status === 200 && roleOf(L, old.id).role === "admin", `status=${p1.status} ${p1.body?.error || ""}`);
    const p2 = await call("PATCH", `/api/labs/${L}/members/${realMid}`, { role: "admin" }, svc(real.id), L);
    check("7. the real owner's own row still cannot be changed there (409)", p2.status === 409 && roleOf(L, real.id).role === "owner", `status=${p2.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
