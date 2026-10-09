// scripts/verify-lab-seat-counts.ts
//
// Receipt for bug 4 (2026-10-09: "Every lab is showing that they have 25 admin
// seats and no staff seats"). Boots the REAL routes on a fresh throwaway SQLite
// DB (no prod data) and checks the Members page numbers and the invite seat gate
// for the shapes that were wrong on production:
//   A. Redington-shaped: Community lab (5), owner moved to an invitee whose
//      account copied the enterprise plan (25) with seat_count 1, owner also has
//      a stale seat row on the lab, a medical director seat (free).
//   B. Sampson-shaped: Clinic lab (2) whose single-lab owner bought 5 seats.
//   C. A multi-lab owner on the enterprise account plan: a Community client lab
//      shows 5, and seats on the owner's OTHER lab do not count here.
//   D. The Staff Portal band, set by the admin route, shows staff used of it.
//   E. The invite gate refuses past the lab's own cap (402), the same number
//      the page shows.
// Run (from repo root):
//   DB_PATH=.tmp-verify-seats.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-lab-seat-counts.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const SECRET = process.env.JWT_SECRET!;
const sqlite = (db as any).$client;
const now = new Date().toISOString();
let fails = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${detail})`);
  if (!ok) fails++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const tok = (uid: number) => jwt.sign({ userId: uid }, SECRET, { expiresIn: "1h" });
  const post = (p: string, b: any, t?: string, lab?: number) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b) });
  const members = async (labId: number, t: string) =>
    (await fetch(base + `/api/labs/${labId}/members`, { headers: { "X-Active-Lab-Id": String(labId), Authorization: `Bearer ${t}` } })).json();

  const mkUser = (email: string, name: string, plan: string, seatCount: number) => {
    const u = storage.createUser(email, "$2a$10$abcdefghijklmnopqrstuv", name) as any;
    sqlite.prepare("UPDATE users SET plan=?, seat_count=?, hipaa_acknowledged=1 WHERE id=?").run(plan, seatCount, u.id);
    return u.id as number;
  };
  const mkLab = (name: string, ownerId: number, plan: string) => {
    const r = sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES (?,?,?,?,?)").run(name, ownerId, plan, now, now);
    const id = Number(r.lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','{}','active',1,?,?,?)").run(id, ownerId, now, now, now);
    return id;
  };
  const seat = (ownerId: number, labId: number, email: string, uid: number | null, status: string, type = "active") =>
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, lab_id, seat_type) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(ownerId, email, uid, now, uid ? now : null, status, JSON.stringify({ mode: "edit_all" }), labId, type);

  // A. Redington-shaped.
  const michael = mkUser("michael@qa.test", "Michael", "enterprise", 25);
  const lindsay = mkUser("lindsay@qa.test", "Lindsay", "enterprise", 1); // copied plan on accept, seat_count 1
  const labA = mkLab("Redington-shaped", lindsay, "community");
  seat(michael, labA, "lindsay@qa.test", lindsay, "active");   // her old seat row, now the owner
  seat(michael, labA, "brandy@qa.test", null, "active");
  seat(michael, labA, "noelle@qa.test", null, "pending");
  seat(michael, labA, "cathy@qa.test", null, "pending");
  seat(michael, labA, "michael@qa.test", michael, "active");
  seat(michael, labA, "md@qa.test", null, "pending");
  sqlite.prepare("UPDATE labs SET medical_director_email='md@qa.test' WHERE id=?").run(labA);
  const a = await members(labA, tok(lindsay));
  check("A: Community lab shows 5 included, not the account's 25", a.seatLimits?.activeIncluded === 5, `included=${a.seatLimits?.activeIncluded}`);
  check("A: used = Brandy, Noelle, Cathy, Michael + owner once (MD free)", a.seatCounts?.active === 5 && a.seatCounts?.medicalDirector === 1, `used=${a.seatCounts?.active} md=${a.seatCounts?.medicalDirector}`);

  // B. Sampson-shaped.
  const natalie = mkUser("natalie@qa.test", "Natalie", "clinic", 5);
  const labB = mkLab("Sampson-shaped", natalie, "clinic");
  seat(natalie, labB, "michael@qa.test", michael, "active");
  const b = await members(labB, tok(natalie));
  check("B: single-lab owner's purchased 5 seats kept on a Clinic lab", b.seatLimits?.activeIncluded === 5, `included=${b.seatLimits?.activeIncluded}`);
  check("B: used = Michael + owner", b.seatCounts?.active === 2, `used=${b.seatCounts?.active}`);

  // C. Multi-lab owner on the enterprise account plan.
  const labC1 = mkLab("Client lab (Community)", michael, "community");
  const labC2 = mkLab("Other lab (Hospital)", michael, "hospital");
  for (const e of ["x1@qa.test", "x2@qa.test", "x3@qa.test", "x4@qa.test"]) seat(michael, labC2, e, null, "active");
  seat(michael, labC1, "y1@qa.test", null, "active");
  const c = await members(labC1, tok(michael));
  check("C: Community client lab owned by an enterprise account shows 5", c.seatLimits?.activeIncluded === 5, `included=${c.seatLimits?.activeIncluded}`);
  check("C: only this lab's seats count (1 + owner), not the other lab's 4", c.seatCounts?.active === 2, `used=${c.seatCounts?.active}`);
  const c2 = await members(labC2, tok(michael));
  check("C: the Hospital lab shows 15", c2.seatLimits?.activeIncluded === 15, `included=${c2.seatLimits?.activeIncluded}`);

  // D. Staff Portal band.
  seat(lindsay, labA, "tech1@qa.test", null, "pending", "staff_portal");
  seat(lindsay, labA, "tech2@qa.test", null, "active", "staff_portal");
  const before = await members(labA, tok(lindsay));
  check("D: no band set yet -> no max", before.staffPortal && before.staffPortal.maxStaff === null && before.staffPortal.used === 2, JSON.stringify(before.staffPortal));
  const badBand = await post("/api/admin/set-lab-staff-portal-band", { secret: "localadmin", labId: labA, band: "huge" });
  check("D: admin route rejects an unknown band", badBand.status === 400, `status=${badBand.status}`);
  const noSecret = await post("/api/admin/set-lab-staff-portal-band", { secret: "wrong", labId: labA, band: "medium" });
  check("D: admin route requires the admin secret", noSecret.status === 403, `status=${noSecret.status}`);
  const setBand = await post("/api/admin/set-lab-staff-portal-band", { secret: "localadmin", labId: labA, band: "medium" });
  check("D: admin route sets Medium", setBand.status === 200, `status=${setBand.status}`);
  const after = await members(labA, tok(lindsay));
  check("D: page shows 2 of 100 staff (Medium)", after.staffPortal?.band === "medium" && after.staffPortal?.maxStaff === 100 && after.staffPortal?.used === 2, JSON.stringify(after.staffPortal));

  // E. Invite gate: lab A is at 5 of 5 -> a new writer is refused with the page's number.
  const gate = await post(`/api/labs/${labA}/members`, { email: "sixth@qa.test", role: "staff", seatType: "active", firstName: "Six", lastName: "Th" }, tok(lindsay), labA);
  const gj: any = await gate.json().catch(() => ({}));
  check("E: invite past the lab's own cap is refused (402, limit 5)", gate.status === 402 && gj.limit === 5 && gj.current === 5, `status=${gate.status} ${JSON.stringify(gj)}`);
  const gateC = await post(`/api/labs/${labC1}/members`, { email: "ok@qa.test", role: "staff", seatType: "active", firstName: "Ok", lastName: "Fine" }, tok(michael), labC1);
  check("E: invite under the cap goes through", gateC.status === 200 || gateC.status === 201, `status=${gateC.status}`);

  server.close();
  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
