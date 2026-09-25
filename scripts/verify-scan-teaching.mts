// scripts/verify-scan-teaching.mts
//
// Receipt for Build #7 (VeritaScan teaching mode). The risk is that a plain
// status/notes save (which does not carry teaching_note) could wipe a
// trainer's teaching note. The item upsert guards this with
// `teaching_note = COALESCE(excluded.teaching_note, teaching_note)` plus a JS
// rule that passes null when the caller omits the key. This runs the EXACT
// upsert SQL against an in-memory DB, driving it through the same key-presence
// logic the routes use, and asserts:
//   - absent key preserves the stored note
//   - explicit "" clears it
//   - a value sets it
//   - a fresh row with no key inserts null
//   - the scan-level is_teaching / teaching_intro flags round-trip
//
// Run: npx tsx scripts/verify-scan-teaching.mts   (exits non-zero on fail)

import Database from "better-sqlite3";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritascan_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lab_id INTEGER,
    name TEXT, created_at TEXT, updated_at TEXT,
    is_teaching INTEGER NOT NULL DEFAULT 0, teaching_intro TEXT
  );
  CREATE TABLE veritascan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, scan_id INTEGER NOT NULL, item_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Not Assessed', notes TEXT, owner TEXT, due_date TEXT,
    teaching_note TEXT, updated_at TEXT NOT NULL, UNIQUE(scan_id, item_id)
  );
`);
db.prepare("INSERT INTO veritascan_scans (id, name, created_at, updated_at) VALUES (1,'Teaching example','t','t')").run();

// The exact item upsert from routes.ts.
const upsert = db.prepare(`
  INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, teaching_note, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scan_id, item_id) DO UPDATE SET
    status = excluded.status,
    notes = excluded.notes,
    owner = excluded.owner,
    due_date = excluded.due_date,
    teaching_note = COALESCE(excluded.teaching_note, teaching_note),
    updated_at = excluded.updated_at
`);

// The exact JS key-presence rule the routes apply before binding.
function teachingNoteParam(body: Record<string, unknown>): string | null {
  if ('teaching_note' in body) return (body.teaching_note as string) ?? null;
  if ('teachingNote' in body) return (body.teachingNote as string) ?? null;
  return null;
}
function saveItem(body: Record<string, any>) {
  upsert.run(1, body.item_id, body.status || 'Not Assessed', body.notes ?? null, body.owner ?? null, body.due_date ?? null, teachingNoteParam(body), 'now');
}
const readNote = (itemId: number) =>
  (db.prepare("SELECT teaching_note FROM veritascan_items WHERE scan_id = 1 AND item_id = ?").get(itemId) as any)?.teaching_note;
const readStatus = (itemId: number) =>
  (db.prepare("SELECT status FROM veritascan_items WHERE scan_id = 1 AND item_id = ?").get(itemId) as any)?.status;

// 1) Author a teaching note.
saveItem({ item_id: 10, status: "Compliant", teaching_note: "Surveyors check the calibration log dates." });
check("teaching note is set on author", readNote(10) === "Surveyors check the calibration log dates.");

// 2) A plain status save (NO teaching_note key) must NOT wipe it.
saveItem({ item_id: 10, status: "Needs Attention", notes: "found a gap" });
check("status-only save preserves the note (COALESCE)", readNote(10) === "Surveyors check the calibration log dates.", `note=${readNote(10)}`);
check("status-only save still updates the status", readStatus(10) === "Needs Attention");

// 3) Explicit empty string clears the note.
saveItem({ item_id: 10, status: "Needs Attention", teaching_note: "" });
check("explicit empty string clears the note", (readNote(10) ?? "") === "", `note=${JSON.stringify(readNote(10))}`);

// 4) Re-set a value after clearing.
saveItem({ item_id: 10, status: "Compliant", teaching_note: "Re-annotated." });
check("note can be re-set after clearing", readNote(10) === "Re-annotated.");

// 5) camelCase teachingNote key is honored (client ItemState path).
saveItem({ item_id: 11, status: "Compliant", teachingNote: "via camelCase" });
check("camelCase teachingNote key persists", readNote(11) === "via camelCase");

// 6) A brand-new row with no key inserts null.
saveItem({ item_id: 12, status: "Compliant" });
check("new row with no key -> null note", readNote(12) === null);

// 7) Scan-level flags round-trip (the teaching PUT).
const setTeaching = db.prepare("UPDATE veritascan_scans SET is_teaching = ?, teaching_intro = ?, updated_at = 'now' WHERE id = 1");
setTeaching.run(1, "Learn what a surveyor looks for.");
let scan = db.prepare("SELECT is_teaching, teaching_intro FROM veritascan_scans WHERE id = 1").get() as any;
check("is_teaching flag round-trips", scan.is_teaching === 1 && scan.teaching_intro === "Learn what a surveyor looks for.");
setTeaching.run(0, null);
scan = db.prepare("SELECT is_teaching, teaching_intro FROM veritascan_scans WHERE id = 1").get() as any;
check("teaching flag can be removed", scan.is_teaching === 0 && scan.teaching_intro === null);

// 8) The trainee-curated set = items with a non-empty note, in insertion order.
saveItem({ item_id: 13, status: "Compliant", teaching_note: "note c" });
const annotated = (db.prepare("SELECT item_id FROM veritascan_items WHERE scan_id = 1 AND teaching_note IS NOT NULL AND TRIM(teaching_note) != '' ORDER BY item_id").all() as any[]).map(r => r.item_id);
check("annotated set excludes cleared + null notes", JSON.stringify(annotated) === JSON.stringify([10, 11, 13]), annotated.join(","));

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
