// tests/integration/seat-count-gaps.test.ts
//
// BUG-096 (found 2026-10-25): seats are counted from user_seats rows, so a lab admin with no seat row isn't counted
// (Heywood's original owner, made an admin when ownership moved). GET /api/admin/seat-count-gaps measures it before
// anything changes: per lab, the active owner or admin members writing without a seat row, and what the count and the
// invite gate would read with them. Made-up users and labs on a fresh database. It checks:
//   1. the route refuses without the admin header
//   2. a standalone lab's admin with no seat row is counted as uncounted; the count and the gate read as they would
//   3. left out: an admin who holds a seat row, a Veritas support account, a member with the staff role, the lab's own
//      owner, and a medical director (who sits on the free seat)
//   4. on a system account, one admin with no seat in two of its labs is one more pooled seat, and one person in totals
//   5. it writes nothing (row counts before and after)
// Run: rm -f .tmp-seatgap.db && DB_PATH=.tmp-seatgap.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/seat-count-gaps.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const user = (tag: string, extra: Record<string, unknown> = {}) => insert("users", { email: `${tag}-096@example.test`, name: `Made-up ${tag}`, plan: "community", seat_count: 0, ...extra });
  const member = (lab: number, u: number, role: string) => insert("lab_members", { lab_id: lab, user_id: u, role, status: "active" });
  const seat = (owner: number, lab: number, email: string, u: number | null = null) => insert("user_seats", { owner_user_id: owner, lab_id: lab, seat_email: email, seat_user_id: u, seat_type: "active", status: "active" });

  // ── A standalone Community lab (5 included): owner + 3 writers + 1 admin on seats = 5 used, plus one admin with no seat ──
  const o1 = user("owner1");
  const s = insert("labs", { lab_name: "Made-up Standalone", owner_user_id: o1, plan: "community", organization_id: null, medical_director_email: "md1-096@example.test" });
  member(s, o1, "owner");
  for (let i = 1; i <= 3; i++) { const w = user(`w${i}`); member(s, w, "staff"); seat(o1, s, `w${i}-096@example.test`, w); }
  const formerOwner = user("former"); member(s, formerOwner, "admin");                 // writing, no seat row: uncounted
  const seated = user("seatedadmin"); member(s, seated, "admin"); seat(o1, s, "seatedadmin-096@example.test", seated); // has a seat
  const support = user("support", { vls_support: 1 }); member(s, support, "admin");   // Veritas support: left out
  const staffOnly = user("staffonly"); member(s, staffOnly, "staff");                  // staff role: left out
  const md = user("md1"); member(s, md, "admin");                                      // the lab's medical director: free seat
  // ── A system: owner o2, two org-linked labs, one admin in both with no seat ──
  const o2 = user("owner2", { plan: "hospital", seat_count: 10 });
  const org = insert("organizations", { name: "Made-up Health System" });
  const p1 = insert("labs", { lab_name: "Made-up System Lab 1", owner_user_id: o2, plan: "hospital", organization_id: org });
  const p2 = insert("labs", { lab_name: "Made-up System Lab 2", owner_user_id: o2, plan: "hospital", organization_id: org });
  const both = user("bothlabs"); member(p1, both, "admin"); member(p2, both, "admin");

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    const no = await fetch(`${base}/api/admin/seat-count-gaps`);
    check("1. refuses without the admin header", no.status === 403, String(no.status));
    const before = ["user_seats", "lab_members", "labs", "users"].map((t) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n).join(",");
    const r = await fetch(`${base}/api/admin/seat-count-gaps`, { headers: { "x-admin-secret": process.env.ADMIN_SECRET || "" } });
    const j: any = await r.json();
    const row = (id: number) => (j.labs || []).find((x: any) => x.labId === id);
    const sr = row(s);
    check("2. the standalone lab lists exactly one uncounted admin (the former owner)", r.status === 200 && sr?.uncountedAdmins === 1, JSON.stringify(sr));
    check("2. ... used 5 of 5 now; 6 if counted, over the cap", sr?.activeIncluded === 5 && sr?.activeUsed === 5 && sr?.usedIfCounted === 6 && !sr?.overNow && sr?.overIfCounted, JSON.stringify(sr));
    check("2. ... the next writer invite is refused now and would be refused counted (5 + 1 > 5)", sr?.nextInviteRefusedNow === true && sr?.nextInviteRefusedIfCounted === true, JSON.stringify(sr));
    check("3. left out: the seated admin, the support account, the staff-role member, the owner and the medical director (the count is 1, not 5)", sr?.uncountedAdmins === 1);
    const r1 = row(p1), r2 = row(p2);
    check("4. the system's labs each list their one admin, counted once in the pool (usedIfCounted = used + 1, not + 2)",
      r1?.uncountedAdmins === 1 && r2?.uncountedAdmins === 1 && r1?.pooled && r1?.usedIfCounted === r1?.activeUsed + 1 && r2?.usedIfCounted === r2?.activeUsed + 1, JSON.stringify([r1, r2]));
    check("4. totals: 3 labs with uncounted admins, 2 people (the former owner, the one system admin)", j.totals?.labsWithUncountedAdmins === 3 && j.totals?.uncountedAdmins === 2, JSON.stringify(j.totals));
    check("4. totals: one lab newly over its cap if counted (the standalone)", j.totals?.labsNewlyOverIfCounted === 1, JSON.stringify(j.totals));
    check("4. no names or emails in the answer", !/@|Made-up/.test(JSON.stringify(j)));
    const after = ["user_seats", "lab_members", "labs", "users"].map((t) => (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n).join(",");
    check("5. it writes nothing", before === after, `${before} -> ${after}`);
  } finally {
    server.close();
  }
  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
