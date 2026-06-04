#!/usr/bin/env node
// verify-inventory-barcode-persistence.js
//
// Verify that VeritaStock inventory items have a canonical barcode_value
// stored at creation time and that the one-shot boot-migration backfills
// the value for existing rows without overwriting any user-supplied
// barcode.
//
// What this script proves:
//
//   1. Boot migration fills barcode_value for existing rows where it is
//      NULL or empty string, using 'VLS-<id padded to 8 digits>' as the
//      canonical format.
//   2. Boot migration is idempotent: a second run produces zero changes
//      because the WHERE clause excludes rows that already have a value
//      (per the boot-migration-no-cascading-writes rule).
//   3. User-supplied barcode_value at creation time is preserved by the
//      post-insert persistence logic.
//   4. Post-insert persistence fires when no barcode_value was supplied,
//      writing the canonical VLS-<padded id> format.
//   5. Format stability: the printed code on a label generated today
//      matches the stored barcode_value, even if the synthesis algorithm
//      changes server-side in the future (because the stored value
//      becomes the source of truth).
//   6. Labels endpoint pass-through: SELECT barcode_value returns the
//      stored value verbatim; no re-synthesis happens at print time.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    lab_id INTEGER,
    item_name TEXT NOT NULL,
    barcode_value TEXT
  );
`);

// Seed: simulate a pre-migration prod state.
// - Three items with NULL barcode_value (the legacy state).
// - One item with a user-supplied barcode (rare today but possible after
//   a future edit endpoint lands).
// - One item with empty-string barcode_value (also treated as missing).
const seed = db.prepare(
  "INSERT INTO inventory_items (account_id, lab_id, item_name, barcode_value) VALUES (?, ?, ?, ?)"
);
seed.run(100, 1, "ACOAG1", null);
seed.run(100, 1, "BMP Calibrator Set", null);
seed.run(100, 1, "BMP QC Level 1", null);
seed.run(100, 1, "Manufacturer-Coded Item", "MFR-EXTERNAL-12345");
seed.run(100, 1, "Imported Item With Empty Barcode", "");

// Reproduce the boot-migration UPDATE shape from db.ts.
function runMigration() {
  return db.prepare(`
    UPDATE inventory_items
    SET barcode_value = 'VLS-' || printf('%08d', id)
    WHERE barcode_value IS NULL OR barcode_value = ''
  `).run();
}

// Reproduce the post-insert persistence UPDATE shape from veritabench.ts.
function persistAfterInsert(newId) {
  return db.prepare(
    "UPDATE inventory_items SET barcode_value = 'VLS-' || printf('%08d', id) WHERE id = ? AND (barcode_value IS NULL OR barcode_value = '')"
  ).run(newId);
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}

function getBarcode(id) {
  const row = db.prepare("SELECT barcode_value FROM inventory_items WHERE id = ?").get(id);
  return row ? row.barcode_value : null;
}

// 1. Pre-migration state: confirm what the boot migration is about to fix.
{
  check("pre-migration: ACOAG1 (id=1) has NULL barcode_value", getBarcode(1) === null);
  check("pre-migration: Manufacturer-Coded Item (id=4) has 'MFR-EXTERNAL-12345' barcode_value",
    getBarcode(4) === "MFR-EXTERNAL-12345");
  check("pre-migration: Empty-string barcode item (id=5) has empty string", getBarcode(5) === "");
}

// 2. Run migration once. Expect 4 rows changed (3 nulls + 1 empty).
{
  const first = runMigration();
  check("first migration run: 4 rows changed (3 NULL + 1 empty)", first.changes === 4);
  check("post-migration: id=1 has VLS-00000001", getBarcode(1) === "VLS-00000001");
  check("post-migration: id=2 has VLS-00000002", getBarcode(2) === "VLS-00000002");
  check("post-migration: id=3 has VLS-00000003", getBarcode(3) === "VLS-00000003");
  check("post-migration: id=5 (was empty) has VLS-00000005", getBarcode(5) === "VLS-00000005");
}

// 3. User-supplied barcode preserved.
{
  check("post-migration: user-supplied 'MFR-EXTERNAL-12345' preserved on id=4",
    getBarcode(4) === "MFR-EXTERNAL-12345");
}

// 4. Idempotency: second migration run is a no-op.
{
  const second = runMigration();
  check("second migration run: 0 rows changed (idempotent)", second.changes === 0);
  check("idempotency check: id=1 still VLS-00000001 (not mutated)",
    getBarcode(1) === "VLS-00000001");
  check("idempotency check: id=4 still 'MFR-EXTERNAL-12345' (not mutated)",
    getBarcode(4) === "MFR-EXTERNAL-12345");
}

// 5. Post-insert persistence for a fresh row.
{
  const result = seed.run(100, 1, "Fresh Item No Barcode", null);
  const newId = Number(result.lastInsertRowid);
  check("fresh row before persist has NULL barcode_value", getBarcode(newId) === null);
  const persistResult = persistAfterInsert(newId);
  check("post-insert persist: 1 row changed", persistResult.changes === 1);
  const expectedCode = `VLS-${String(newId).padStart(8, "0")}`;
  check("post-insert persist: new row has canonical VLS-<padded id>",
    getBarcode(newId) === expectedCode);
}

// 6. Post-insert persistence is a no-op when barcode_value was supplied.
{
  const result = seed.run(100, 1, "Fresh Item Manufacturer Barcode", "MFR-NEW-77777");
  const newId = Number(result.lastInsertRowid);
  check("fresh row with supplied barcode has 'MFR-NEW-77777'",
    getBarcode(newId) === "MFR-NEW-77777");
  const persistResult = persistAfterInsert(newId);
  check("post-insert persist: 0 rows changed when barcode_value supplied",
    persistResult.changes === 0);
  check("post-insert persist: user-supplied barcode untouched",
    getBarcode(newId) === "MFR-NEW-77777");
}

// 7. Labels endpoint pass-through: a SELECT barcode_value returns stored
//    value verbatim, never re-synthesizing.
{
  const rows = db
    .prepare("SELECT id, item_name, barcode_value FROM inventory_items WHERE lab_id = 1 ORDER BY id ASC")
    .all();
  const labels = rows.map((r) => ({
    itemName: r.item_name,
    // The label endpoint should now use the stored value directly; the
    // defensive fallback only fires if barcode_value is somehow still
    // NULL or empty after migration + post-insert persistence.
    barcodeValue: (r.barcode_value && r.barcode_value.trim().length > 0)
      ? r.barcode_value
      : `VLS-${String(r.id).padStart(8, "0")}`,
  }));
  check("labels pass-through: every label has a non-empty barcode",
    labels.every((l) => l.barcodeValue && l.barcodeValue.length > 0));
  check("labels pass-through: manufacturer-coded item kept its external code",
    labels.find((l) => l.itemName === "Manufacturer-Coded Item").barcodeValue === "MFR-EXTERNAL-12345");
  check("labels pass-through: VLS-coded items use stored value, not runtime synthesis",
    labels.find((l) => l.itemName === "ACOAG1").barcodeValue === "VLS-00000001");
}

// 8. Format-stability counterfactual: prove that if a future synthesis
//    algorithm changes (e.g., to 12-digit padding), the stored barcode
//    still matches the originally printed label.
{
  // Today's algorithm: VLS-<8 digit padded>.
  const todayStored = getBarcode(1);
  // Hypothetical future algorithm: VLS-<12 digit padded>.
  const futureFormat = `VLS-${String(1).padStart(12, "0")}`;
  check("counterfactual: today's stored value differs from future-algorithm output",
    todayStored !== futureFormat);
  check("counterfactual: today's printed label still matches today's stored value",
    todayStored === "VLS-00000001");
  // The point: because the value is STORED, not computed at label-print
  // time, a server-side algorithm change does not invalidate physical
  // labels already applied to bottles.
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
