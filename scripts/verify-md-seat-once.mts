// scripts/verify-md-seat-once.mts
//
// Receipt for BUG-093 (2026-10-25, fixed 2026-11-10). On a system account (labs linked to an organization), the members
// route's medical director count ran across every lab the owner holds and counted each seat row of any lab's director,
// so a director invited to both of a system's labs read "medicalDirector 2" against 1 included in each lab. On a fresh
// database with a made-up owner and labs, through labSeatSummary (what GET /api/labs/:labId/members sends):
//   1. two org-linked labs naming the same director, invited to each: each lab counts 1 (it counted 2)
//   2. the active count is unchanged: the director sits outside it, the other writer and the owner count as before
//   3. a third org lab naming a different director counts only its own; a lab naming none counts 0
//   4. a standalone lab is unchanged (one director row per lab, counted once)
// Run: rm -f .tmp-mdseat.db && DB_PATH=.tmp-mdseat.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-md-seat-once.mts
import { db } from "../server/db";
import { labSeatSummary } from "../server/labSeats";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};
const sqlite = (db as any).$client;
sqlite.pragma("foreign_keys = OFF");
const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
// Insert with the named values plus a filler for any other NOT NULL column without a default.
const insert = (table: string, values: Record<string, unknown>) => {
  const row: Record<string, unknown> = { ...values };
  for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
  const keys = Object.keys(row);
  return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
};

const owner = insert("users", { email: "owner-093@example.test", name: "Made-up Owner", plan: "hospital", seat_count: 10 });
const org = insert("organizations", { name: "Made-up Health System" });
const MD = "director-093@example.test";
const labA = insert("labs", { lab_name: "Made-up Lab A", owner_user_id: owner, plan: "hospital", organization_id: org, medical_director_email: MD });
const labB = insert("labs", { lab_name: "Made-up Lab B", owner_user_id: owner, plan: "hospital", organization_id: org, medical_director_email: MD });
const seat = (lab: number, email: string, type = "active") => insert("user_seats", { owner_user_id: owner, lab_id: lab, seat_email: email, seat_type: type, status: "active" });
seat(labA, MD); seat(labB, MD);               // the director, invited to each lab
seat(labA, "writer-093@example.test");         // one other writer
const a = labSeatSummary(sqlite, labA)!, b = labSeatSummary(sqlite, labB)!;
check("1. the same director invited to both labs counts 1 in each (it counted 2)", a.medicalDirectorUsed === 1 && b.medicalDirectorUsed === 1, JSON.stringify([a.medicalDirectorUsed, b.medicalDirectorUsed]));
check("2. the active count is unchanged: the writer and the owner, the director outside it (pooled across the owner's labs)", a.activeUsed === 2 && b.activeUsed === 2 && a.pooled && b.pooled, JSON.stringify([a.activeUsed, b.activeUsed]));
const MD2 = "director2-093@example.test";
const labC = insert("labs", { lab_name: "Made-up Lab C", owner_user_id: owner, plan: "hospital", organization_id: org, medical_director_email: MD2 });
const labD = insert("labs", { lab_name: "Made-up Lab D", owner_user_id: owner, plan: "hospital", organization_id: org, medical_director_email: null });
seat(labC, MD2);
const c = labSeatSummary(sqlite, labC)!, d = labSeatSummary(sqlite, labD)!, a2 = labSeatSummary(sqlite, labA)!;
check("3. a lab naming a different director counts only its own (1); lab A still 1", c.medicalDirectorUsed === 1 && a2.medicalDirectorUsed === 1, JSON.stringify([c.medicalDirectorUsed, a2.medicalDirectorUsed]));
check("3. a lab naming no director counts 0, and the other director stays outside the active count", d.medicalDirectorUsed === 0 && d.activeUsed === 2, JSON.stringify([d.medicalDirectorUsed, d.activeUsed]));
const owner2 = insert("users", { email: "owner2-093@example.test", name: "Made-up Owner 2", plan: "community", seat_count: 0 });
const solo = insert("labs", { lab_name: "Made-up Standalone", owner_user_id: owner2, plan: "community", organization_id: null, medical_director_email: MD });
insert("user_seats", { owner_user_id: owner2, lab_id: solo, seat_email: MD, seat_type: "active", status: "active" });
insert("user_seats", { owner_user_id: owner2, lab_id: solo, seat_email: "w2-093@example.test", seat_type: "active", status: "active" });
const s = labSeatSummary(sqlite, solo)!;
check("4. a standalone lab is unchanged: its director 1, one writer plus the owner", s.medicalDirectorUsed === 1 && s.activeUsed === 2 && !s.pooled, JSON.stringify(s));

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
