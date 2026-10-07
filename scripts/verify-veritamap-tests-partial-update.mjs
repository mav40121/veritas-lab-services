// Verify the veritamap_tests date-save fix against the REAL constraint.
//
// Production 500 (confirmed in Railway runtime log 2026-10-07):
//   PUT /api/labs/4/veritamap/maps/61/tests/25-hydroxyvitamin D (25-OH-D) 500
//   SqliteError: NOT NULL constraint failed: veritamap_tests.active
//
// Cause: the client autosaves ONE field at a time (e.g. {last_sop_review: x}).
// The old handler did a full-row UPDATE binding active from the (absent) body,
// which set active=NULL and tripped the NOT NULL constraint. This script builds
// a table with the same NOT NULL active column, reproduces the crash with the
// OLD logic, and proves the NEW partial-update logic saves cleanly without
// nulling active or clobbering the other date columns.
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`CREATE TABLE veritamap_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL,
  analyte TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_cal_ver TEXT, last_method_comp TEXT, last_precision TEXT, last_sop_review TEXT,
  notes TEXT, updated_at TEXT
)`);

const MAP = 61;
const AN = "25-hydroxyvitamin D (25-OH-D)";
const reseed = () => {
  db.prepare("DELETE FROM veritamap_tests").run();
  db.prepare("INSERT INTO veritamap_tests (map_id, analyte, active, last_cal_ver, last_method_comp) VALUES (?,?,?,?,?)")
    .run(MAP, AN, 1, "2026-01-01", "2026-02-02");
};

// OLD handler logic (the bug)
function oldSave(body) {
  const { active: rawActive, last_cal_ver, last_method_comp, last_precision, last_sop_review, notes } = body;
  const active = typeof rawActive === "boolean" ? (rawActive ? 1 : 0) : rawActive;
  db.prepare(`UPDATE veritamap_tests SET active=?, last_cal_ver=?, last_method_comp=?, last_precision=?, last_sop_review=?, notes=?, updated_at=? WHERE map_id=? AND analyte=?`)
    .run(active, last_cal_ver ?? null, last_method_comp ?? null, last_precision ?? null, last_sop_review ?? null, notes ?? null, new Date().toISOString(), MAP, AN);
}

// NEW handler logic (the fix) - mirrors server/routes.ts exactly
function newSave(body) {
  const now = new Date().toISOString();
  const sets = [], vals = [];
  if ("active" in body) { const a = body.active; sets.push("active=?"); vals.push((typeof a === "boolean" ? a : !!a) ? 1 : 0); }
  for (const col of ["last_cal_ver", "last_method_comp", "last_precision", "last_sop_review", "notes"]) {
    if (col in body) { sets.push(`${col}=?`); vals.push(body[col] ?? null); }
  }
  if (sets.length > 0) {
    sets.push("updated_at=?"); vals.push(now);
    vals.push(MAP, AN);
    db.prepare(`UPDATE veritamap_tests SET ${sets.join(", ")} WHERE map_id=? AND analyte=?`).run(...vals);
  }
}

const row = () => db.prepare("SELECT * FROM veritamap_tests WHERE map_id=? AND analyte=?").get(MAP, AN);
let pass = true;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${name}${extra ? "  (" + extra + ")" : ""}`); if (!cond) pass = false; };

// 1. OLD logic reproduces the production 500
reseed();
let threw = false, msg = "";
try { oldSave({ last_sop_review: "2026-01-28" }); } catch (e) { threw = true; msg = e.message; }
ok("OLD full-row UPDATE on a date-only save throws NOT NULL on active (reproduces the production 500)", threw && /NOT NULL constraint failed: veritamap_tests\.active/.test(msg), msg);

// 2. NEW logic: date-only save succeeds, active preserved, others untouched
reseed();
let newThrew = false, newMsg = "";
try { newSave({ last_sop_review: "2026-01-28" }); } catch (e) { newThrew = true; newMsg = e.message; }
ok("NEW partial UPDATE on a date-only save does NOT throw", !newThrew, newMsg);
const r = row();
ok("active preserved (still 1, not nulled)", r.active === 1, `active=${r.active}`);
ok("last_sop_review saved", r.last_sop_review === "2026-01-28", r.last_sop_review);
ok("last_cal_ver NOT clobbered", r.last_cal_ver === "2026-01-01", r.last_cal_ver);
ok("last_method_comp NOT clobbered", r.last_method_comp === "2026-02-02", r.last_method_comp);

// 3. NEW logic: explicit active toggle still works and never nulls
reseed();
newSave({ active: false });
ok("explicit active:false sets 0 (never null)", row().active === 0, `active=${row().active}`);
newSave({ active: true });
ok("explicit active:true sets 1", row().active === 1, `active=${row().active}`);

console.log(pass ? "\nALL PASS" : "\nFAILED");
process.exit(pass ? 0 : 1);
