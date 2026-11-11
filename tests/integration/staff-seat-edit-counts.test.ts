// tests/integration/staff-seat-edit-counts.test.ts
//
// GET /api/admin/staff-seat-edit-counts's counting (server/staffSeatEditCounts.ts), measured before the rule "a Staff seat
// never edits" (Michael 2026-11-11) ships. In-memory SQLite, made-up rows only. Run:
//   npx tsx tests/integration/staff-seat-edit-counts.test.ts
import Database from "better-sqlite3";
import { SEAT_MODULE_KEYS } from "@shared/schema";
import { staffSeatEditCounts } from "../../server/staffSeatEditCounts";
import { modulesWithStoredEdit } from "@shared/seatEditRule";

let fails = 0, passes = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else fails++; };

const db = new Database(":memory:");
db.exec("CREATE TABLE user_seats (id INTEGER PRIMARY KEY, lab_id INTEGER, status TEXT, permissions TEXT, seat_type TEXT)");
const add = (lab: number | null, status: string, perms: unknown, type: string | null) =>
  db.prepare("INSERT INTO user_seats (lab_id, status, permissions, seat_type) VALUES (?, ?, ?, ?)").run(lab, status, typeof perms === "string" ? perms : JSON.stringify(perms), type);

// Lab 10: two Staff seats with edit (one edit_all active, one custom VeritaMap pending), one Staff view_all.
add(10, "active", { mode: "edit_all" }, "staff_portal");
add(10, "pending", { mode: "custom", overrides: { veritamap: "edit" } }, "staff_portal");
add(10, "active", { mode: "view_all" }, "staff_portal");
// Lab 11: a Staff seat with a legacy flat shape giving VeritaComp edit; a deactivated Staff seat with edit (not counted).
add(11, "active", { veritacomp: "edit", veritamap: "view" }, "staff_portal");
add(11, "deactivated", { mode: "edit_all" }, "staff_portal");
// Writer seats with edit are not Staff seats (never counted); a broken JSON Staff seat reads as no edit.
add(10, "active", { mode: "edit_all" }, "active");
add(12, "active", { mode: "edit_all" }, null);
add(12, "active", "{not json", "staff_portal");

const r = staffSeatEditCounts(db);
check("1. counts only active or pending Staff seats (5 of the 8 rows: not the deactivated one or the two writer seats)", r.totals.staffSeats === 5, JSON.stringify(r.totals));
check("2. three Staff seats hold edit (edit_all, custom VeritaMap, legacy VeritaComp)", r.totals.withEdit === 3, JSON.stringify(r.totals));
check("3. two active and one pending among them", r.totals.active === 2 && r.totals.pending === 1, JSON.stringify(r.totals));
check("4. one has edit on every module", r.totals.editAll === 1, JSON.stringify(r.totals));
check("5. two labs have a Staff seat with edit (10 and 11), lab 12's broken JSON and writer seats leave it out", r.totals.labsWithEdit === 2 && r.labs.map((l: any) => l.labId).join(",") === "10,11", JSON.stringify(r.labs.map((l: any) => l.labId)));
const lab10 = r.labs.find((l: any) => l.labId === 10)!;
check("6. lab 10: 2 with edit; VeritaMap counted twice (edit_all and custom)", lab10.withEdit === 2 && lab10.modules.veritamap === 2, JSON.stringify(lab10));
const lab11 = r.labs.find((l: any) => l.labId === 11)!;
check("7. lab 11: 1 with edit, VeritaComp only (the deactivated seat is left out)", lab11.withEdit === 1 && lab11.modules.veritacomp === 1 && !lab11.modules.veritamap, JSON.stringify(lab11));
check("8. edit_all reads as edit on every seat module", modulesWithStoredEdit(JSON.stringify({ mode: "edit_all" })).length === SEAT_MODULE_KEYS.length);
check("9. view_all and broken JSON read as no edit", modulesWithStoredEdit(JSON.stringify({ mode: "view_all" })).length === 0 && modulesWithStoredEdit("{not json").length === 0);
check("10. the answer carries no names, emails or seat ids", !/@|seat_?id|email|name/i.test(JSON.stringify(r).replace(/"rule":"[^"]*"/, "")), JSON.stringify(r).slice(0, 200));

// seat-facts (server/seatFacts.ts): one made-up person holding a Staff seat (view_all) and a writer seat (edit_all) in the
// same lab, a membership there, and one audited permission change.
import("../../server/seatFacts").then(({ seatFactsForUser }) => {
  const f = new Database(":memory:");
  f.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT);
    CREATE TABLE user_seats (id INTEGER PRIMARY KEY, owner_user_id INTEGER, seat_email TEXT, seat_user_id INTEGER, lab_id INTEGER, seat_type TEXT, status TEXT, invited_at TEXT, accepted_at TEXT, permissions TEXT);
    CREATE TABLE lab_members (lab_id INTEGER, user_id INTEGER, role TEXT, status TEXT, is_primary_lab INTEGER);
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY, user_id INTEGER, entity_type TEXT, entity_id TEXT, created_at TEXT, before_json TEXT, after_json TEXT);`);
  f.prepare("INSERT INTO users VALUES (7, 'Made.Up@Example.test')").run();
  f.prepare("INSERT INTO user_seats VALUES (1, 2, 'made.up@example.test', 7, 20, 'staff_portal', 'active', 't0', 't1', ?)").run(JSON.stringify({ mode: "view_all" }));
  f.prepare("INSERT INTO user_seats VALUES (2, 2, 'made.up@example.test', 7, 20, 'active', 'active', 't2', 't3', ?)").run(JSON.stringify({ mode: "edit_all" }));
  f.prepare("INSERT INTO user_seats VALUES (3, 2, 'made.up@example.test', NULL, 21, 'active', 'pending', 't4', NULL, ?)").run(JSON.stringify({ mode: "edit_all" }));
  f.prepare("INSERT INTO lab_members VALUES (20, 7, 'staff', 'active', 1)").run();
  f.prepare("INSERT INTO audit_log VALUES (1, 2, 'seat.permissions', '2', '2026-11-11 17:39:00', ?, ?)").run(JSON.stringify({ mode: "view_all" }), JSON.stringify({ mode: "edit_all" }));
  const r: any = seatFactsForUser(f, 7);
  check("11. seat-facts lists all three seats, the email-only pending one included", r.seats.length === 3 && r.seats[2].linkedBy === "email-only", JSON.stringify(r.seats));
  check("12. it reads each seat's type and mode", r.seats[0].seatType === "staff_portal" && r.seats[0].mode === "view_all" && r.seats[1].mode === "edit_all", JSON.stringify(r.seats));
  check("13. the edit check sees two active seats in lab 20 and reports which it picks", r.editCheck[0].activeSeatsInLab.length === 2 && [1, 2].includes(r.editCheck[0].pickedSeatId), JSON.stringify(r.editCheck));
  check("14. the audited change shows before view_all, after edit_all, with its time", r.permissionChanges.length === 1 && r.permissionChanges[0].before.mode === "view_all" && r.permissionChanges[0].after.mode === "edit_all", JSON.stringify(r.permissionChanges));
  check("15. no email in the answer", !/example\.test/i.test(JSON.stringify(r)));
  check("16. unknown user gives null", seatFactsForUser(f, 999) === null);
  console.log(`${passes} PASS, ${fails} FAIL`);
  console.log(fails ? "FAILED" : "ALL PASS");
  process.exit(fails ? 1 : 0);
});
