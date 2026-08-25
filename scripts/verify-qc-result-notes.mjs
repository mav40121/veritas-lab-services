// scripts/verify-qc-result-notes.mjs
//
// Gate-3 branch receipt for the append-only QC-point note (2026-08-25, MedStar).
// Exercises the exact invariants of qc_result_notes against an in-memory SQLite
// that mirrors the schema and the endpoint SQL:
//   - append-only: many notes on one point, each its own row; the original
//     qc_results row + comment + timestamp are never mutated;
//   - author + time + source are stamped on every note (console vs staff_portal);
//   - the note thread for a point returns only that point's notes, in order;
//   - the front-line gate: labs.qc_note_frontline_can_add = 0 blocks the Staff
//     Portal add path (console writers are unaffected).
//
// Run: node scripts/verify-qc-result-notes.mjs   (exits non-zero on any FAIL)
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, qc_note_frontline_can_add INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE qc_results (id INTEGER PRIMARY KEY, lab_id INTEGER, comment TEXT, result_value REAL, created_at TEXT);
  CREATE TABLE qc_result_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER NOT NULL, qc_result_id INTEGER NOT NULL,
    note TEXT NOT NULL, author_user_id INTEGER, author_staff_employee_id INTEGER,
    author_name TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'console', created_at TEXT NOT NULL);
`);
db.prepare("INSERT INTO labs (id, qc_note_frontline_can_add) VALUES (1, 1), (2, 0)").run();
// lab 1 = front line open; lab 2 = restricted to console.
db.prepare("INSERT INTO qc_results (id, lab_id, comment, result_value, created_at) VALUES (10, 1, 'Original entry at record time', 4.2, '2026-08-25T10:00:00Z')").run();
db.prepare("INSERT INTO qc_results (id, lab_id, comment, result_value, created_at) VALUES (11, 1, NULL, 5.0, '2026-08-25T10:05:00Z')").run();

const origBefore = db.prepare("SELECT comment, result_value, created_at FROM qc_results WHERE id = 10").get();

// Mirror of the endpoint add: staff-portal front-line gate check + insert.
function addNote({ resultId, labId, note, source, authorName, staffEmployeeId, userId }) {
  if (source === "staff_portal") {
    const allow = db.prepare("SELECT qc_note_frontline_can_add FROM labs WHERE id = ?").get(labId);
    if (allow && allow.qc_note_frontline_can_add === 0) return { status: 403 };
  }
  const info = db.prepare(
    "INSERT INTO qc_result_notes (lab_id, qc_result_id, note, author_user_id, author_staff_employee_id, author_name, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(labId, resultId, note, userId ?? null, staffEmployeeId ?? null, authorName, source, new Date(0).toISOString());
  return { status: 200, id: Number(info.lastInsertRowid) };
}
const threadFor = (resultId) =>
  db.prepare("SELECT note, author_name, source FROM qc_result_notes WHERE qc_result_id = ? ORDER BY id ASC").all(resultId);

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  if (!ok) failed++;
};

// Front-line adds the investigation note, then a console TC appends a follow-up.
addNote({ resultId: 10, labId: 1, note: "Westgard 1-3s. Reran, in range. See point 11.", source: "staff_portal", authorName: "Jordan Tech", staffEmployeeId: 7 });
addNote({ resultId: 11, labId: 1, note: "Rerun of the failed point 10.", source: "staff_portal", authorName: "Jordan Tech", staffEmployeeId: 7 });
addNote({ resultId: 10, labId: 1, note: "Reviewed. Root cause was a bubble in the sampler.", source: "console", authorName: "Mike Hiltunen", userId: 3 });

check("point 10 has a 2-note append-only thread in order", threadFor(10).map(n => n.note),
  ["Westgard 1-3s. Reran, in range. See point 11.", "Reviewed. Root cause was a bubble in the sampler."]);
check("thread stamps each author + source", threadFor(10).map(n => `${n.author_name}/${n.source}`),
  ["Jordan Tech/staff_portal", "Mike Hiltunen/console"]);

const origAfter = db.prepare("SELECT comment, result_value, created_at FROM qc_results WHERE id = 10").get();
check("original qc_results row is untouched (append-only)", origAfter, origBefore);

// Point 11's thread is only point 11's note, not point 10's.
check("point 11 thread is isolated to point 11", threadFor(11).map(n => n.note), ["Rerun of the failed point 10."]);

// Front-line gate: lab 2 blocks the staff-portal path; console still works.
check("front-line add blocked when qc_note_frontline_can_add=0", addNote({ resultId: 10, labId: 2, note: "x", source: "staff_portal", authorName: "T" }).status, 403);
check("console add allowed even when front line is restricted", addNote({ resultId: 10, labId: 2, note: "TC note", source: "console", authorName: "TC", userId: 3 }).status, 200);

// No update/delete path exists in the schema surface used by the endpoints.
check("notes table exposes no updated_at (immutable by design)",
  db.prepare("SELECT COUNT(*) c FROM pragma_table_info('qc_result_notes') WHERE name='updated_at'").get().c, 0);

db.close();
if (failed) { console.error(`\n${failed} FAIL(s)`); process.exit(1); }
console.log("\nAll QC-note append-only + gate checks passed.");
