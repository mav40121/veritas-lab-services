#!/usr/bin/env node
// verify-labels-lab-scope.js
//
// Verify that POST /api/labs/:labId/inventory/labels/pdf scopes by lab_id,
// not account_id. Customer report 2026-06-04: clicking Print Labels on
// Michaels Lab returned a sheet with only ONE label even though the lab has
// 14 items, because the legacy /api/inventory/labels/pdf endpoint queried
// WHERE account_id = req.ownerUserId and only items where account_id matched
// the requester's user-id were visible. The lab-scoped endpoint added in this
// PR queries WHERE lab_id = req.scope.labId, capturing every item in the lab
// regardless of which seat user created it.
//
// What this script proves (offline, against an in-memory sqlite):
//
//   1. The lab-scoped query returns ALL items in the queried lab, regardless
//      of which user's account_id is attached to each row.
//   2. The legacy account-scoped query (still on file under the same
//      endpoint path /api/inventory/labels/pdf) returns ONLY items where
//      account_id matches the requester. That is the bug shape.
//   3. With requested IDs filter, the lab-scoped query intersects the
//      requested set with the lab_id WHERE clause, so a request for items
//      from a different lab returns zero rows (cross-lab access blocked).
//   4. Items missing barcode_value get a stable VLS-<padded id> placeholder
//      so labels still print before barcode wiring is finished. Items with
//      a populated barcode_value pass through verbatim.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    lab_id INTEGER,
    item_name TEXT NOT NULL,
    catalog_number TEXT,
    lot_number TEXT,
    storage_location TEXT,
    barcode_value TEXT
  );
`);

// Two labs, two owners.
//   Lab 1 = Michaels Lab, owned by user 100.
//   Lab 2 = Riverside Regional, owned by user 200.
// 14 items in Lab 1. Mixed account_id: 9 owned by 100 (Michael), 5 owned by
// user 150 (a Michaels Lab seat user). This is the customer-real shape.
const insertItem = db.prepare(
  "INSERT INTO inventory_items (account_id, lab_id, item_name, catalog_number, lot_number, storage_location, barcode_value) VALUES (?, ?, ?, ?, ?, ?, ?)"
);

const MICHAEL = 100;
const SEAT = 150; // seat user inside Michaels Lab
const RIVERSIDE = 200;

const lab1Items = [
  ["IPA (Isopropyl Alcohol), 70%", "A459-1", null, "FLAMMABLE CABINET", "VLS-00006063"],
  ["cool reagent", null, null, null, null],
  ["ACOAG1", null, null, null, null],
  ["BMP Calibrator Set", null, null, null, null],
  ["BMP QC Level 1", null, null, null, null],
  ["BMP QC Level 2", null, null, null, null],
  ["Creatinine Reagent", null, null, null, null],
  ["Glucose Reagent", null, null, null, null],
  ["Hemoglobin Reagent", null, null, null, null],
  ["Albumin Reagent", null, null, null, null],
  ["Calcium Reagent", null, null, null, null],
  ["Potassium Reagent", null, null, null, null],
  ["Sodium Reagent", null, null, null, null],
  ["Chloride Reagent", null, null, null, null],
];
const lab1AccountIds = [MICHAEL, MICHAEL, MICHAEL, MICHAEL, MICHAEL, MICHAEL, MICHAEL, MICHAEL, MICHAEL, SEAT, SEAT, SEAT, SEAT, SEAT];
for (let i = 0; i < lab1Items.length; i++) {
  insertItem.run(lab1AccountIds[i], 1, ...lab1Items[i]);
}

// Riverside has its own 3 items, all owned by RIVERSIDE user.
const lab2Items = [
  ["Demo Glucose Cal", null, null, null, "VLS-RIVER-001"],
  ["Demo BUN Reagent", null, null, null, null],
  ["Demo ALT Reagent", null, null, null, null],
];
for (const item of lab2Items) insertItem.run(RIVERSIDE, 2, ...item);

// --- Reproduce the two endpoint query shapes ---

// Legacy: WHERE account_id = ? (the bug shape).
function legacyAccountScopedRows(accountId) {
  return db
    .prepare(
      "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC"
    )
    .all(accountId);
}

// New: WHERE lab_id = ? (the fix shape).
function labScopedRows(labId) {
  return db
    .prepare(
      "SELECT id, item_name, catalog_number, lot_number, storage_location, barcode_value FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC"
    )
    .all(labId);
}

// New with requested IDs intersection.
function labScopedRowsWithIds(labId, ids) {
  const placeholders = ids.map(() => "?").join(",");
  return db
    .prepare(
      `SELECT id, item_name FROM inventory_items WHERE lab_id = ? AND id IN (${placeholders}) ORDER BY item_name ASC`
    )
    .all(labId, ...ids);
}

// Reproduce the labels.map placeholder synthesis from veritabench.ts.
function synthesizeBarcodes(rows) {
  return rows.map((r) => ({
    itemName: r.item_name,
    barcodeValue:
      r.barcode_value && String(r.barcode_value).trim().length > 0
        ? String(r.barcode_value)
        : `VLS-${String(r.id).padStart(8, "0")}`,
  }));
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log("PASS  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + (detail ? " -- " + detail : ""));
  }
}

// 1. Legacy account-scoped query against Michael's user-id returns only 9 of 14.
// This is the customer-reported bug shape: "I have 14 items but only one set
// of labels printed." (The exact reported count is variable; the shape is "less
// than the dashboard count.")
{
  const legacyAsMichael = legacyAccountScopedRows(MICHAEL);
  check(
    "legacy WHERE account_id = Michael returns only 9 items (seat-user items invisible)",
    legacyAsMichael.length === 9,
    `got ${legacyAsMichael.length}, expected 9`
  );
}

// 2. New lab-scoped query against Lab 1 returns all 14 items.
{
  const labScoped = labScopedRows(1);
  check(
    "lab-scoped WHERE lab_id = 1 returns all 14 items in Michaels Lab",
    labScoped.length === 14,
    `got ${labScoped.length}, expected 14`
  );
}

// 3. Lab-scoped query against Lab 2 returns only the 3 Riverside items.
{
  const lab2Scoped = labScopedRows(2);
  check(
    "lab-scoped WHERE lab_id = 2 returns only Riverside's 3 items",
    lab2Scoped.length === 3,
    `got ${lab2Scoped.length}, expected 3`
  );
  check(
    "lab-scoped query for Lab 2 contains only Riverside item names",
    lab2Scoped.every((r) => r.item_name.startsWith("Demo "))
  );
}

// 4. Cross-lab item ID intersection: requesting Lab 1's item IDs through the
// Lab 2 scoped query returns zero rows.
{
  const lab1Ids = labScopedRows(1).map((r) => r.id);
  const crossLab = labScopedRowsWithIds(2, lab1Ids);
  check(
    "cross-lab ID request: Lab 1 IDs intersected with Lab 2 scope returns 0",
    crossLab.length === 0
  );
}

// 5. Barcode synthesis: items missing barcode_value get VLS-<padded id>; items
// with a populated barcode_value pass through verbatim.
{
  const lab1Synth = synthesizeBarcodes(labScopedRows(1));
  const ipa = lab1Synth.find((s) => s.itemName.startsWith("IPA"));
  const generic = lab1Synth.find((s) => s.itemName === "cool reagent");
  check(
    "items with populated barcode_value pass through verbatim",
    ipa && ipa.barcodeValue === "VLS-00006063"
  );
  check(
    "items without barcode_value get VLS-<padded id> placeholder",
    generic && /^VLS-\d{8}$/.test(generic.barcodeValue)
  );
}

// 6. Sheet-count math: 14 labels at 30 per sheet should fit on one Avery 5160
// sheet with 16 empty cells trailing. Confirm the math the PDF generator uses.
{
  const LABELS_PER_SHEET = 30;
  const total = labScopedRows(1).length;
  const sheetCount = Math.ceil(total / LABELS_PER_SHEET);
  check("14 items fit on 1 Avery 5160 sheet", sheetCount === 1);
  // 30 - 14 = 16 empty cells
  const paddedTotal = total + (total % LABELS_PER_SHEET === 0 ? 0 : LABELS_PER_SHEET - (total % LABELS_PER_SHEET));
  const empties = paddedTotal - total;
  check("16 empty cells trail the 14 real labels on the single sheet", empties === 16);
}

// 7. Counterfactual: confirm the LEGACY query, given the customer-observed
// data shape, would explain the "only one set of labels" report if Michael's
// account had 1 item attributed to him and the other 13 to the seat user.
{
  // Different seed shape: only 1 item attributed to Michael, 13 to the seat.
  const db2 = new Database(":memory:");
  db2.pragma("foreign_keys = ON");
  db2.exec(`
    CREATE TABLE inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      lab_id INTEGER,
      item_name TEXT NOT NULL,
      catalog_number TEXT,
      lot_number TEXT,
      storage_location TEXT,
      barcode_value TEXT
    );
  `);
  const ins = db2.prepare(
    "INSERT INTO inventory_items (account_id, lab_id, item_name, barcode_value) VALUES (?, ?, ?, ?)"
  );
  ins.run(MICHAEL, 1, "IPA (Isopropyl Alcohol), 70%", "VLS-00006063");
  for (let i = 0; i < 13; i++) ins.run(SEAT, 1, `Seat item ${i + 1}`, null);
  const legacyOne = db2
    .prepare("SELECT * FROM inventory_items WHERE account_id = ? ORDER BY item_name ASC")
    .all(MICHAEL);
  const newAll = db2
    .prepare("SELECT * FROM inventory_items WHERE lab_id = ? ORDER BY item_name ASC")
    .all(1);
  check(
    "counterfactual: legacy returns 1 (the IPA item) when seat user owns the rest",
    legacyOne.length === 1 && legacyOne[0].item_name.startsWith("IPA"),
    "this matches the customer report shape"
  );
  check(
    "counterfactual: lab-scoped returns all 14 regardless of account_id mix",
    newAll.length === 14
  );
  db2.close();
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
