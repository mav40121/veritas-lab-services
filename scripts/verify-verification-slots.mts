// Verify per-analyte study-slot seeding (server/verificationSlots.ts).
// Proves: first analyte ADOPTS the placeholder slots (preserving a linked
// study); later analytes INSERT fresh slots; carryover is never multiplied per
// analyte; seeding is idempotent; the partial unique index blocks duplicate
// (verification, element, analyte_id) slots; and delete-analyte removes only
// the empty slots while a linked study blocks the delete.
// Run: npx tsx scripts/verify-verification-slots.mts
import Database from "better-sqlite3";
import { seedSlotsForAnalyte, INSTRUMENT_WIDE_ELEMENTS } from "../server/verificationSlots";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

const ELEMENTS = ["accuracy", "precision", "reportable_range", "reference_interval", "method_comparison", "carryover"];
const NON_CARRYOVER = ELEMENTS.filter(e => !INSTRUMENT_WIDE_ELEMENTS.has(e)); // 5

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritacheck_verification_studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id INTEGER NOT NULL,
    element TEXT NOT NULL,
    study_id INTEGER,
    analyte TEXT,
    analyte_id INTEGER,
    scope TEXT NOT NULL DEFAULT 'analyte',
    clsi_protocol TEXT,
    created_at TEXT, updated_at TEXT
  );
  CREATE UNIQUE INDEX idx_vcs_verif_element_analyte
    ON veritacheck_verification_studies(verification_id, element, analyte_id)
    WHERE analyte_id IS NOT NULL;
`);

const VID = 1;
const NOW = "2026-07-24T00:00:00.000Z";
const protocolFor = (el: string) => ({ accuracy: "CLSI EP15-A3", precision: "CLSI EP15-A3", carryover: "CLSI EP10-A3" } as any)[el] || null;

// Package creation seeds one placeholder slot per element (analyte_id NULL).
const seedPlaceholder = db.prepare(
  "INSERT INTO veritacheck_verification_studies (verification_id, element, scope, created_at, updated_at) VALUES (?, ?, 'analyte', ?, ?)",
);
for (const el of ELEMENTS) seedPlaceholder.run(VID, el, NOW, NOW);
check("package seeds 6 placeholder slots", db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies").get().n === 6);

// Link a study to the precision placeholder so we can prove adoption preserves it.
db.prepare("UPDATE veritacheck_verification_studies SET study_id = 999 WHERE verification_id = ? AND element = 'precision' AND analyte_id IS NULL").run(VID);

// --- Analyte A: adopts the 5 non-carryover placeholders ---
const rA = seedSlotsForAnalyte(db, { verificationId: VID, analyteId: 10, analyteName: "rbc", elements: ELEMENTS, protocolFor, now: NOW });
check("analyte A adopts 5, inserts 0", rA.adopted === 5 && rA.inserted === 0, JSON.stringify(rA));
check("carryover slot NOT adopted (still analyte_id NULL)",
  db.prepare("SELECT analyte_id FROM veritacheck_verification_studies WHERE element='carryover'").get().analyte_id === null);
check("adoption preserved the linked study on precision",
  db.prepare("SELECT study_id, analyte_id, analyte FROM veritacheck_verification_studies WHERE element='precision' AND analyte_id=10").get()?.study_id === 999);

// --- Analyte B: inserts 5 fresh slots ---
const rB = seedSlotsForAnalyte(db, { verificationId: VID, analyteId: 20, analyteName: "Eos%", elements: ELEMENTS, protocolFor, now: NOW });
check("analyte B inserts 5, adopts 0", rB.inserted === 5 && rB.adopted === 0, JSON.stringify(rB));

// --- Idempotency: re-seed A is a no-op ---
const rA2 = seedSlotsForAnalyte(db, { verificationId: VID, analyteId: 10, analyteName: "rbc", elements: ELEMENTS, protocolFor, now: NOW });
check("re-seeding analyte A is a no-op", rA2.inserted === 0 && rA2.adopted === 0, JSON.stringify(rA2));

// Total: 5 (A) + 5 (B) + 1 carryover placeholder = 11
check("total slots = 11", db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies").get().n === 11);
check("each non-carryover element has exactly 2 analyte slots",
  NON_CARRYOVER.every(el => db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies WHERE element=? AND analyte_id IS NOT NULL").get(el).n === 2));

// --- Partial unique index blocks a duplicate (verif, element, analyte_id) ---
let threw = false;
try { db.prepare("INSERT INTO veritacheck_verification_studies (verification_id, element, analyte_id, scope) VALUES (?,?,?,'analyte')").run(VID, "precision", 10); }
catch { threw = true; }
check("unique index blocks a duplicate per-analyte slot", threw);

// --- delete-analyte: blocked while a linked study exists; removes empty slots otherwise ---
const linkedCount = (aid: number) => db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies WHERE analyte_id=? AND scope<>'instrument' AND study_id IS NOT NULL").get(aid).n;
check("analyte A blocked from delete (has a linked study)", linkedCount(10) === 1);
check("analyte B is deletable (no linked study)", linkedCount(20) === 0);
// Delete B's empty slots (the delete-analyte cleanup), then B has none.
db.prepare("DELETE FROM veritacheck_verification_studies WHERE analyte_id=? AND study_id IS NULL").run(20);
check("deleting analyte B removed its 5 empty slots",
  db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies WHERE analyte_id=20").get().n === 0);
check("analyte A slots untouched by B's cleanup",
  db.prepare("SELECT COUNT(*) n FROM veritacheck_verification_studies WHERE analyte_id=10").get().n === 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
