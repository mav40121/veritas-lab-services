// Verify receipt for the Count History report. Seeds a synthetic item + count
// events + a receipt in the local dev DB, drives the ACTUAL buildCountHistory
// (the true-burn math), asserts, then generates the real workbook to confirm it
// builds. Cleans up its own rows. Run: npx tsx scripts/verify-count-history.mts
import { buildCountHistory } from "../server/countHistoryReport";
import { generateCountHistoryExcel } from "../server/countHistoryExcel";
import { db } from "../server/db";

const sqlite = (db as any).$client;
// Synthetic rows use a negative lab id with no real labs/users parents; turn off
// FK enforcement for the duration of this local verify only.
sqlite.pragma("foreign_keys = OFF");
const LAB = -778;
const now = new Date("2026-02-01T00:00:00Z").getTime();

// Clean any prior run.
const priorItems = sqlite.prepare("SELECT id FROM inventory_items WHERE lab_id = ?").all(LAB) as any[];
for (const it of priorItems) sqlite.prepare("DELETE FROM inventory_count_events WHERE item_id = ?").run(it.id);
sqlite.prepare("DELETE FROM inventory_receipts WHERE lab_id = ?").run(LAB);
sqlite.prepare("DELETE FROM inventory_items WHERE lab_id = ?").run(LAB);

// Synthetic item: pack size 10 (10 usage units per count unit).
const ins = sqlite.prepare(`
  INSERT INTO inventory_items (account_id, lab_id, item_name, catalog_number, quantity_on_hand, count_unit, units_per_count_unit, storage_location, department, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(1, LAB, "Test Reagent", "TR-001", 120, "box", 10, "Fridge 1", "Chemistry", "2026-01-01T00:00:00Z", "2026-01-11T00:00:00Z");
const ITEM = Number(ins.lastInsertRowid);

// Two counts 10 days apart, with 50 units received in between.
sqlite.prepare("INSERT INTO inventory_count_events (item_id, lab_id, account_id, counted_qty, previous_qty, delta, counted_by, source, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(ITEM, LAB, 1, 100, null, null, "MV", "kiosk", "2026-01-01T10:00:00.000Z", "2026-01-01T10:00:00.000Z");
sqlite.prepare("INSERT INTO inventory_receipts (lab_id, item_id, account_id, qty_received, received_date, created_at) VALUES (?,?,?,?,?,?)")
  .run(LAB, ITEM, 1, 50, "2026-01-05", "2026-01-05T00:00:00Z");
sqlite.prepare("INSERT INTO inventory_count_events (item_id, lab_id, account_id, counted_qty, previous_qty, delta, counted_by, source, occurred_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
  .run(ITEM, LAB, 1, 120, 100, 20, "John Hall", "staff_portal", "2026-01-11T10:00:00.000Z", "2026-01-11T10:00:00.000Z");

let fails = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${cond ? "" : "  <<< " + (detail ?? "")}`);
  if (!cond) fails++;
};

const report = buildCountHistory(sqlite, LAB, { days: 3650 }, now);
const it = report.items.find((x) => x.item_id === ITEM);

check("item present with 2 counts", !!it && it.count_count === 2);
check("counts ordered ascending by date", !!it && it.counts[0].occurred_at < it.counts[1].occurred_at);
// usage = prev(100) + received(50) - this(120) = 30 over 10 days = 3 usage-units/day
check("true burn = 3 usage units/day (100 + 50 - 120 over 10 days)", it?.true_burn_per_day === 3, `got ${it?.true_burn_per_day}`);
check("true burn = 0.3 count units/day (3 / pack size 10)", it?.true_burn_per_day_count_unit === 0.3, `got ${it?.true_burn_per_day_count_unit}`);
check("counted_by + source carried through", it?.counts[1].counted_by === "John Hall" && it?.counts[1].source === "staff_portal");
check("last_counted_at is the newer count", it?.last_counted_at === "2026-01-11T10:00:00.000Z");

// Single-count item yields a null burn (needs >= 2 counts). Verify by trimming.
sqlite.prepare("DELETE FROM inventory_count_events WHERE item_id = ? AND occurred_at = ?").run(ITEM, "2026-01-11T10:00:00.000Z");
const single = buildCountHistory(sqlite, LAB, { days: 3650 }, now).items.find((x) => x.item_id === ITEM);
check("single count -> null true burn", single?.true_burn_per_day === null && single?.count_count === 1);

// Excel builds to a non-trivial workbook.
const buf = await generateCountHistoryExcel(report, { labName: "Test Lab", cliaNumber: "00D0000000" });
check("workbook generated (xlsx zip, > 5KB)", buf.length > 5000 && buf.slice(0, 2).toString() === "PK");

// Clean up.
sqlite.prepare("DELETE FROM inventory_count_events WHERE item_id = ?").run(ITEM);
sqlite.prepare("DELETE FROM inventory_receipts WHERE lab_id = ?").run(LAB);
sqlite.prepare("DELETE FROM inventory_items WHERE lab_id = ?").run(LAB);

sqlite.pragma("foreign_keys = ON");
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
