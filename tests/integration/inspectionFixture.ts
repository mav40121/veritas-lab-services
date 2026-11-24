// tests/integration/inspectionFixture.ts
//
// The made-up people and labs the three inspection tests share (inspection-assign, veritascan-carry, inspection-links): the
// REAL routes on a scratch SQLite file, one organization with two labs, another customer's lab, and one login of each kind.
// Not a test by itself.
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

export interface Login { id: number; email: string; name: string; token: string }
export interface Sent { to: string; subject: string; html: string; from?: string }

export async function inspectionWorld(tag: string) {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { readSignMailer } = await import("../../server/policyReadSign");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const PW = ["In", "spect", "7x!"].join("-");
  const stamp = Date.now();
  const now = new Date().toISOString();

  let failures = 0;
  const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

  // Every email the app sends through the read-and-sign mailer lands here; nothing leaves the machine.
  const sent: Sent[] = [];
  const mail = { fail: false };
  readSignMailer.send = async (m: any) => { if (mail.fail) throw new Error("made-up mail failure"); sent.push(m); };
  readSignMailer.pauseMs = 0;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const call = async (who: Login | null, method: string, path: string, body?: unknown, labHeader?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (who) headers.Authorization = `Bearer ${who.token}`;
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString("utf8");
    let j: any = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text, buf };
  };
  const post = async (p: string, b: unknown) => (await (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json()) as any;

  const login = async (key: string, name: string): Promise<Login> => {
    const email = `${tag}-${key}-${stamp}@example.test`;
    const reg = await post("/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    return { id, email, name, token: reg.token };
  };
  const seed = (table: string, values: Record<string, any>): number => {
    const row: Record<string, any> = { ...values };
    for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? now : /INT|REAL/.test(String(c.type)) ? 0 : "x";
    }
    const cols = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => row[k])).lastInsertRowid);
  };
  const provision = async (owner: Login, labName: string) => Number((await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName, plan: "hospital" })).labId);
  const member = (lab: number, u: Login, role = "staff") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, u.id, role, now, now, now);
  let seatNo = 0;
  const seat = (ownerId: number, u: Login, lab: number, o: { type?: string; perms?: any; roster?: number | null; status?: string } = {}) => seed("user_seats", {
    owner_user_id: ownerId, seat_email: u.email, seat_user_id: u.id, invited_at: now, accepted_at: now, status: o.status ?? "active",
    permissions: JSON.stringify(o.perms ?? { mode: "edit_all" }), invite_token: `${tag}-${stamp}-${++seatNo}`, lab_id: lab, seat_type: o.type ?? "active", staff_employee_id: o.roster ?? null,
  });

  // One organization: OWNER's lab A and lab B. OTHER has lab X, outside it.
  const OWNER = await login("owner", "Avery Owner"), OTHER = await login("other", "Olive Other");
  const A = await provision(OWNER, "Made-up Lab A"), X = await provision(OTHER, "Made-up Lab X");
  const B = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Made-up Lab B', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?").run(now, now, A).lastInsertRowid);
  sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active', is_demo = 0 WHERE id IN (?, ?, ?)").run(A, B, X);
  member(B, OWNER, "owner");
  const ORG = seed("organizations", { name: "Made-up System", billing_owner_user_id: OWNER.id, plan: "enterprise" });
  sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)").run(ORG, A, B);

  // Roster of lab A
  const staffLabId = Number((sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(A) as any)?.id ?? seed("staff_labs", { user_id: OWNER.id, tier2_lab_id: A, lab_name: "Made-up Lab A" }));
  const roster = (first: string, last: string) => seed("staff_employees", { user_id: OWNER.id, lab_id: staffLabId, tier2_lab_id: A, first_name: first, last_name: last, status: "active" });

  // One login of each kind in lab A
  const EDITOR = await login("editor", "Ed Editor"); member(A, EDITOR); seat(OWNER.id, EDITOR, A);
  const SCAN_ONLY = await login("scanonly", "Sky Scanonly"); member(A, SCAN_ONLY); seat(OWNER.id, SCAN_ONLY, A, { perms: { mode: "custom", overrides: { veritascan: "edit", veritaresponse: "view" } } });
  const VIEWER = await login("viewer", "Vic Viewer"); member(A, VIEWER); seat(OWNER.id, VIEWER, A, { type: "view_only", perms: { mode: "view_all" } });
  const STAFF = await login("staff", "Stef Staff"); member(A, STAFF); const staffEmp = roster("Stef", "Staff"); seat(OWNER.id, STAFF, A, { type: "staff_portal", roster: staffEmp, perms: {} });
  const ADMIN_A = await login("admin", "Addie Admin"); member(A, ADMIN_A, "admin");
  // The system's admin (organization), no membership of their own
  const LEADER = await login("leader", "Lee Leader"); seed("organization_members", { organization_id: ORG, user_id: LEADER.id, org_role: "org_admin", status: "active" });
  // Veritas support
  const SUPPORT = await login("support", "Vera Support"); sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(SUPPORT.id);
  sqlite.prepare("UPDATE labs SET vls_support_access = 1 WHERE id IN (?, ?, ?)").run(A, B, X);

  const one = (q: string, ...a: any[]) => sqlite.prepare(q).get(...a) as any;
  const all = (q: string, ...a: any[]) => sqlite.prepare(q).all(...a) as any[];
  const audits = (entity: string, id?: number | string) => all(`SELECT * FROM audit_log WHERE entity_type = ? ${id === undefined ? "" : "AND entity_id = ?"} ORDER BY id`, ...(id === undefined ? [entity] : [entity, String(id)]));
  const newScan = async (who: Login, lab: number, name: string) => Number((await call(who, "POST", `/api/labs/${lab}/veritascan/scans`, { name })).j?.id);
  const finish = () => { server.close(); console.log(failures ? `\n${failures} FAILED` : "\nALL PASS"); process.exit(failures ? 1 : 0); };

  return {
    sqlite, app, base, call, check, seed, member, seat, roster, login, provision, sent, mail, one, all, audits, newScan, finish, stamp, now, ADMIN, staffLabId, staffEmp,
    A, B, X, ORG, OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, ADMIN_A, LEADER, SUPPORT,
  };
}
