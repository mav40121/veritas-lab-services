// scripts/verify-intacct-csv-export.mjs
//
// Gate-3 receipt for the "Export for Sage Intacct" purchasing CSV
// (server/intacctExport.ts). Exercises the REAL builder + preflight against a
// fixed reorder fixture and a sample template mapping. Asserts:
//   - the CSV header row matches the sample template byte-for-byte,
//   - the exact Intacct Vendor ID lands on the line,
//   - account-based (no Intacct item id) vs item-based line branches,
//   - RFC-4180 escaping of a value containing a comma,
//   - preflight BLOCKS with a named list when a vendor id / transaction
//     definition / mapped dimension is missing.
//
//   npx tsx scripts/verify-intacct-csv-export.mjs

import { buildIntacctCSV, preflightIntacct } from "../server/intacctExport.ts";

let fails = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) fails++;
}

// ── Sample customer template mapping (exact headers) ─────────────────────────
const template_columns = [
  { header: "Vendor ID", source: "vendor_id" },
  { header: "Transaction Definition", source: "transaction_definition" },
  { header: "Transaction Date", source: "transaction_date" },
  { header: "GL Account", source: "gl_account" },
  { header: "Location ID", source: "dimension:location_id" },
  { header: "Item Description", source: "item_name" },
  { header: "Quantity", source: "order_qty" },
  { header: "Unit Price", source: "unit_cost" },
  { header: "Item ID", source: "intacct_item_id" },
];
const config = {
  transaction_definition: "Purchase Requisition",
  gl_account: "5000",
  date_format: "MM/DD/YYYY",
  dimensions: { location_id: "SC-ED" },
  template_columns,
};
const vendorMap = new Map([
  ["medline", "V-MED-01"],
  ["baxter", null], // present in directory but Intacct id not set
]);
const today = new Date(2026, 5, 24); // 2026-06-24 local

const accountLine = { item_name: "IV start kit", vendor: "Medline", unit_cost: 4.2, suggested_order_packs: 3, delivered_qty: 60, order_unit: "case", usage_unit: "kit", intacct_item_id: null };
const itemLine = { item_name: "Saline, 1000mL", vendor: "Medline", unit_cost: 1.8, suggested_order_packs: 2, delivered_qty: 24, order_unit: "case", usage_unit: "bag", intacct_item_id: "ITM-SAL" };

// ── Header row matches the template exactly ──────────────────────────────────
const csv = buildIntacctCSV([accountLine, itemLine], config, vendorMap, { today });
const rows = csv.replace(/\r\n$/, "").split("\r\n");
const expectedHeader = "Vendor ID,Transaction Definition,Transaction Date,GL Account,Location ID,Item Description,Quantity,Unit Price,Item ID";
check("header row matches template byte-for-byte", rows[0] === expectedHeader, `got: ${rows[0]}`);
check("uses CRLF line endings", csv.includes("\r\n"));

// Rows sorted by vendor then item: "IV start kit" before "Saline, 1000mL".
const ivRow = rows.find(r => r.includes("IV start kit"));
const salRow = rows.find(r => r.includes("Saline"));
check("account-based line present", !!ivRow);
check("item-based line present", !!salRow);

// ── Vendor ID exact + on the line ────────────────────────────────────────────
check("Vendor ID (exact, not the account label) on the line", ivRow.startsWith("V-MED-01,"), ivRow);

// ── Account-based vs item-based branches ─────────────────────────────────────
const ivCols = ivRow.split(",");
check("account-based line carries GL account", ivCols[3] === "5000");
check("account-based line has EMPTY Item ID (account-based)", ivCols[ivCols.length - 1] === "");
check("account-based line carries the item name as description", ivCols[5] === "IV start kit");
check("Quantity is the order-unit packs", ivCols[6] === "3");
check("Unit Price formatted to 2 decimals", ivCols[7] === "4.20");
check("Transaction Date formatted MM/DD/YYYY", ivCols[2] === "06/24/2026");

// Saline name has a comma -> the field must be quoted (RFC 4180).
check("comma-containing description is quoted", salRow.includes('"Saline, 1000mL"'), salRow);
check("item-based line carries the Intacct Item ID", salRow.trim().endsWith("ITM-SAL"), salRow);

// ── Preflight: clean case passes ─────────────────────────────────────────────
const pfOk = preflightIntacct([accountLine, itemLine], config, vendorMap);
check("preflight passes when all Medline lines are ready", pfOk.ok, JSON.stringify(pfOk.missing));

// ── Preflight: missing vendor id is named ────────────────────────────────────
const baxterLine = { ...accountLine, item_name: "Sterile water", vendor: "Baxter" };
const pfVendor = preflightIntacct([accountLine, baxterLine], config, vendorMap);
check("preflight blocks on missing vendor id", !pfVendor.ok);
check("preflight names the missing vendor (Baxter)", pfVendor.missing.some(m => m.includes("Baxter")), JSON.stringify(pfVendor.missing));

// ── Preflight: missing transaction definition ────────────────────────────────
const pfTxn = preflightIntacct([accountLine], { ...config, transaction_definition: "" }, vendorMap);
check("preflight blocks on missing transaction definition", !pfTxn.ok && pfTxn.missing.some(m => /transaction definition/i.test(m)));

// ── Preflight: mapped dimension with no value ────────────────────────────────
const pfDim = preflightIntacct([accountLine], { ...config, dimensions: {} }, vendorMap);
check("preflight blocks on mapped-but-unset dimension (location_id)", !pfDim.ok && pfDim.missing.some(m => m.includes("location_id")));

// ── Preflight: no columns configured ─────────────────────────────────────────
const pfNoCols = preflightIntacct([accountLine], { ...config, template_columns: [] }, vendorMap);
check("preflight blocks when no columns mapped", !pfNoCols.ok && pfNoCols.missing.some(m => /column mapping/i.test(m)));

// ── Config-driven: renaming a header changes ONLY the header row ─────────────
const renamed = { ...config, template_columns: template_columns.map(c => c.header === "Vendor ID" ? { ...c, header: "VendorID" } : c) };
const csv2 = buildIntacctCSV([accountLine], renamed, vendorMap, { today });
check("renaming a header is a config edit (no code change)", csv2.split("\r\n")[0].startsWith("VendorID,"), csv2.split("\r\n")[0]);

console.log(fails === 0 ? "\nALL INTACCT CHECKS PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
