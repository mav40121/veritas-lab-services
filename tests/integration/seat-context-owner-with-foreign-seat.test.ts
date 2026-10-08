// tests/integration/seat-context-owner-with-foreign-seat.test.ts
//
// Receipt for parking lot #82 (2026-10-08). From 2026-10-01 Michael (an owner of
// several labs) also held a seat on the St. Charles lab owned by user 81. The auth
// layer took his FIRST active seat anywhere and treated every request as that
// seat: his writes in his own labs were stamped user_id 81 and /api/auth/me
// reported user 81's plan. This boots the REAL routes on a scratch DB with the
// same shape (owner A also seated on owner B's lab) and proves:
//   1. A's /api/auth/me is A's own account: not a seat user, A's plan, no foreign owner
//   2. A seeding VeritaTrack tasks in A's OWN lab stamps them with A, not B
//   3. A working inside B's lab (where A holds the seat) still acts as B's seat (B stamped)
//   4. a non-owner seat user C is unchanged: seat of A, A's plan
//   5. an owner D with a seat under D's own account (self-seat) is unchanged
//   6. /api/admin/reattribute-records: bad secret 403; a lab not owned by the
//      target user 400; dryRun lists ids and writes nothing; commit moves only the
//      named lab's rows; the move is audit-logged
//
// Run (Windows, from bash): DB_PATH=.tmp-sctx.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/seat-context-owner-with-foreign-seat.test.ts
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
  const call = (method: string, path: string, body?: unknown, token?: string, labHeader?: number) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(labHeader ? { "X-Active-Lab-Id": String(labHeader) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const now = new Date().toISOString();

  const register = async (tag: string) => {
    const email = `sctx-${tag.toLowerCase()}-${stamp}@example.com`;
    const resp = await call("POST", "/api/auth/register", { email, password: "testpass123", name: `SCTX ${tag}`, hipaa_acknowledged: true });
    const reg = await j(resp);
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    if (!id) console.log(`register ${tag} failed: ${resp.status} ${JSON.stringify(reg).slice(0, 200)}`);
    return { email, id, token: reg.token as string };
  };
  const provision = async (ownerEmail: string, tag: string) =>
    Number((await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: `SCTX Lab ${tag}`, plan: "hospital" }))).labId);
  const seat = (ownerId: number, user: { id: number; email: string }, labId: number) => {
    sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
       VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`
    ).run(ownerId, user.email, user.id, now, now, `sctx-${ownerId}-${user.id}-${labId}-${stamp}`, labId);
  };
  const member = (labId: number, userId: number, role: string) =>
    sqlite.prepare(
      `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
       SELECT ?, ?, ?, '{}', 'active', 0, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ?)`
    ).run(labId, userId, role, now, now, now, labId, userId);

  // A = owner who also holds a seat on B's lab (Michael); B = the other owner (St. Charles).
  const A = await register("A"), B = await register("B"), C = await register("C"), D = await register("D");
  const LA = await provision(A.email, "A"), LB = await provision(B.email, "B"), LD = await provision(D.email, "D");
  sqlite.prepare("UPDATE users SET plan = 'hospital' WHERE id = ?").run(A.id);
  sqlite.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(B.id);
  seat(B.id, A, LB); member(LB, A.id, "admin");          // A seated on B's lab, as on 10/01
  seat(A.id, C, LA); member(LA, C.id, "staff");          // C: plain staff seat under A
  seat(D.id, D, LD);                                     // D: self-seat on D's own lab
  check("setup: three labs provisioned", LA > 0 && LB > 0 && LD > 0, JSON.stringify({ LA, LB, LD }));

  // 1. A's account view
  const meA = await j(await call("GET", "/api/auth/me", undefined, A.token));
  check("1. A /api/auth/me: not a seat user, A's own plan, no foreign owner", meA.isSeatUser === false && meA.plan === "hospital" && (meA.ownerUserId == null || meA.ownerUserId === A.id),
    JSON.stringify({ isSeatUser: meA.isSeatUser, plan: meA.plan, ownerUserId: meA.ownerUserId }));

  // 2. A seeds tasks in A's own lab
  const s2 = await call("POST", "/api/veritatrack/seed-defaults", { categories: ["hipaa_training"] }, A.token, LA);
  const rowsA = sqlite.prepare("SELECT user_id FROM veritatrack_tasks WHERE lab_id = ?").all(LA) as any[];
  check("2. tasks A creates in A's own lab are stamped A", s2.status === 200 && rowsA.length > 0 && rowsA.every((r) => r.user_id === A.id),
    `status=${s2.status} user_ids=${JSON.stringify(rowsA.map((r) => r.user_id))} A=${A.id} B=${B.id}`);

  // 3. A works inside B's lab under the seat
  const s3 = await call("POST", "/api/veritatrack/seed-defaults", { categories: ["pipette_cal"] }, A.token, LB);
  const rowsB = sqlite.prepare("SELECT user_id FROM veritatrack_tasks WHERE lab_id = ?").all(LB) as any[];
  check("3. tasks A creates inside B's lab still belong to B (seat context kept)", s3.status === 200 && rowsB.length > 0 && rowsB.every((r) => r.user_id === B.id),
    `status=${s3.status} user_ids=${JSON.stringify(rowsB.map((r) => r.user_id))}`);

  // 4. non-owner seat user unchanged
  const meC = await j(await call("GET", "/api/auth/me", undefined, C.token));
  check("4. non-owner C: still A's seat with A's plan", meC.isSeatUser === true && meC.ownerUserId === A.id && meC.plan === "hospital",
    JSON.stringify({ isSeatUser: meC.isSeatUser, ownerUserId: meC.ownerUserId, plan: meC.plan }));

  // 5. self-seat owner unchanged
  const meD = await j(await call("GET", "/api/auth/me", undefined, D.token));
  check("5. owner D with a self-seat: unchanged (seat of D)", meD.isSeatUser === true && meD.ownerUserId === D.id,
    JSON.stringify({ isSeatUser: meD.isSeatUser, ownerUserId: meD.ownerUserId }));

  // 6. re-attribution endpoint, on rows stamped the old way
  const bad = Number(sqlite.prepare(
    "INSERT INTO veritatrack_tasks (user_id, lab_id, name, category, frequency, frequency_months, created_at, updated_at) VALUES (?, ?, 'SCTX mis-stamped', 'Other', 'Annual', 12, ?, ?)"
  ).run(B.id, LA, now, now).lastInsertRowid);
  const keepB = rowsB.length;
  const r403 = await call("POST", "/api/admin/reattribute-records", { secret: "nope", fromUserId: B.id, toUserId: A.id, labIds: [LA] });
  const r400 = await call("POST", "/api/admin/reattribute-records", { secret: ADMIN, fromUserId: B.id, toUserId: A.id, labIds: [LB] });
  check("6a. bad secret 403; a lab the target does not own 400", r403.status === 403 && r400.status === 400, `${r403.status}/${r400.status}`);
  const dry = await j(await call("POST", "/api/admin/reattribute-records", { secret: ADMIN, fromUserId: B.id, toUserId: A.id, labIds: [LA], dryRun: true }));
  const stillB = (sqlite.prepare("SELECT user_id FROM veritatrack_tasks WHERE id = ?").get(bad) as any)?.user_id;
  check("6b. dryRun lists the mis-stamped row and writes nothing", dry.dryRun === true && dry.total === 1 && dry.report?.veritatrack_tasks?.[0] === bad && stillB === B.id, JSON.stringify(dry));
  const done = await j(await call("POST", "/api/admin/reattribute-records", { secret: ADMIN, fromUserId: B.id, toUserId: A.id, labIds: [LA] }));
  const nowA = (sqlite.prepare("SELECT user_id FROM veritatrack_tasks WHERE id = ?").get(bad) as any)?.user_id;
  const bRowsAfter = (sqlite.prepare("SELECT COUNT(*) AS n FROM veritatrack_tasks WHERE lab_id = ? AND user_id = ?").get(LB, B.id) as any).n;
  check("6c. commit moves the row to A and leaves B's own lab untouched", done.ok === true && nowA === A.id && bRowsAfter === keepB, `moved=${nowA} bRows=${bRowsAfter}/${keepB}`);
  const aud = sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'admin.reattribute_records'").get() as any;
  check("6d. the move is audit-logged", aud.n >= 1, `rows=${aud.n}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
