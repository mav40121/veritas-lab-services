// scripts/verify-veritamap-amr-noop-save.mjs
//
// Receipt for the idempotent AMR save guard (server/routes.ts amrUnchangedRow,
// 2026-10-07). Background: the VeritaMap map page re-PUT every row's AMR values
// on every render (TestRow autosave loop; ~1,400 blank writes a minute on
// Milford lab 4, map 61). The client is fixed in the same PR, but a tab still
// running the old bundle keeps PUTting until it reloads, so the server must
// refuse to write when nothing changed. This mirrors the helper's exact logic
// against a throwaway table and proves:
//   1. Same values as stored  -> no-op, returns the stored row, no write.
//   2. Blank request, no row  -> no-op, returns a blank shape, no row created.
//   3. "" and null are the same value (the client sends "" for an empty box).
//   4. A real change          -> not a no-op (the handler proceeds to write).
//   5. One changed side only  -> not a no-op.
//
// Run: node scripts/verify-veritamap-amr-noop-save.mjs
import Database from "better-sqlite3";

const db = new Database(":memory:");
db.exec(`CREATE TABLE veritamap_amr_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id INTEGER NOT NULL, instrument_id INTEGER NOT NULL, analyte TEXT NOT NULL,
  amr_low TEXT, amr_high TEXT, updated_at TEXT,
  UNIQUE(map_id, instrument_id, analyte)
)`);
db.prepare("INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high, updated_at) VALUES (61, 244, 'Magnesium', '0.5', '5.0', '2026-10-01')").run();
db.prepare("INSERT INTO veritamap_amr_values (map_id, instrument_id, analyte, amr_low, amr_high, updated_at) VALUES (61, 244, 'Lipase', NULL, NULL, '2026-10-01')").run();

// Mirrors server/routes.ts amrUnchangedRow exactly.
function amrUnchangedRow(mapId, instrumentId, analyte, body) {
  const current = db.prepare(
    "SELECT * FROM veritamap_amr_values WHERE map_id = ? AND instrument_id = ? AND analyte = ?"
  ).get(mapId, instrumentId, analyte);
  const sameLow = (body?.amr_low || null) === (current?.amr_low ?? null);
  const sameHigh = (body?.amr_high || null) === (current?.amr_high ?? null);
  if (!sameLow || !sameHigh) return null;
  return { ...(current ?? { map_id: mapId, instrument_id: instrumentId, analyte, amr_low: null, amr_high: null }), noop: true };
}
const rowCount = () => db.prepare("SELECT COUNT(*) AS n FROM veritamap_amr_values").get().n;

let pass = true;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${name}${extra ? "  (" + extra + ")" : ""}`); if (!cond) pass = false; };

// 1. identical values -> no-op with the stored row
const r1 = amrUnchangedRow(61, 244, "Magnesium", { amr_low: "0.5", amr_high: "5.0" });
ok("identical values are a no-op and return the stored row flagged noop:true", !!r1 && r1.id === 1 && r1.amr_low === "0.5" && r1.noop === true);

// 2. blank request for a row that does not exist -> no-op, nothing created
const before = rowCount();
const r2 = amrUnchangedRow(61, 999, "Sodium", { amr_low: "", amr_high: "" });
ok("blank request with no stored row is a no-op (blank shape, no row created)", !!r2 && r2.amr_low === null && r2.amr_high === null && rowCount() === before, `rows=${rowCount()}`);

// 3. "" vs NULL equivalence (stored NULLs, client sends "")
const r3 = amrUnchangedRow(61, 244, "Lipase", { amr_low: "", amr_high: "" });
ok("empty strings match stored NULLs (no-op)", !!r3 && r3.id === 2);

// 4. a real change -> proceed to write
ok("a changed value is NOT a no-op", amrUnchangedRow(61, 244, "Magnesium", { amr_low: "0.6", amr_high: "5.0" }) === null);

// 5. one side changed -> proceed to write
ok("only the high side changed is NOT a no-op", amrUnchangedRow(61, 244, "Magnesium", { amr_low: "0.5", amr_high: "6.0" }) === null);

// 6. new value on a missing row -> proceed to write (so first real entry still lands)
ok("a real value on a missing row is NOT a no-op", amrUnchangedRow(61, 999, "Sodium", { amr_low: "130", amr_high: "" }) === null);

console.log(pass ? "\nALL PASS" : "\nFAILED");
process.exit(pass ? 0 : 1);
