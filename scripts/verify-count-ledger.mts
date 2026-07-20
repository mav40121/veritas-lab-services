// Verify receipt for the physical-count history ledger. Drives the ACTUAL
// logCount helper against the local dev DB, then reads inventory_count_events
// back to confirm the series, the delta math (up/down/confirm/null-prev), the
// non-finite skip, and time ordering. Uses a synthetic negative item/lab id and
// cleans up its own rows. Run: npx tsx scripts/verify-count-ledger.mts
import { logCount } from "../server/countLedger";
import { db } from "../server/db";

const sqlite = (db as any).$client;
const ITEM = -777, LAB = -777;
sqlite.prepare("DELETE FROM inventory_count_events WHERE item_id = ?").run(ITEM);

let fails = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}${cond ? "" : "  <<< " + (detail ?? "")}`);
  if (!cond) fails++;
};

// A realistic count series for one item, with explicit timestamps for ordering.
logCount({ itemId: ITEM, labId: LAB, accountId: 1, countedQty: 80, previousQty: 100, countedBy: "MV", source: "kiosk", occurredAt: "2026-07-01T10:00:00.000Z" });        // down 20
logCount({ itemId: ITEM, labId: LAB, accountId: 1, countedQty: 90, previousQty: 80, countedBy: "John Hall", source: "staff_portal", occurredAt: "2026-07-08T10:00:00.000Z" }); // up 10
logCount({ itemId: ITEM, labId: LAB, accountId: 1, countedQty: 90, previousQty: 90, countedBy: "MV", source: "kiosk", occurredAt: "2026-07-15T10:00:00.000Z" });               // confirm, delta 0
logCount({ itemId: ITEM, labId: LAB, accountId: 1, countedQty: 70, previousQty: null, countedBy: "MV", source: "director", occurredAt: "2026-07-20T10:00:00.000Z" });          // no prior -> delta null
const skipped = logCount({ itemId: ITEM, labId: LAB, accountId: 1, countedQty: NaN, source: "kiosk" });                                                                        // non-finite -> skipped

check("non-finite counted_qty is skipped (returns -1)", skipped === -1);

const rows = sqlite.prepare(
  "SELECT counted_qty, previous_qty, delta, counted_by, source, occurred_at FROM inventory_count_events WHERE item_id = ? ORDER BY occurred_at"
).all(ITEM) as any[];

check("exactly 4 count rows recorded (NaN skipped)", rows.length === 4, `got ${rows.length}`);
check("ordered by occurred_at ascending", rows[0].occurred_at < rows[1].occurred_at && rows[1].occurred_at < rows[2].occurred_at);
check("delta down: 80 - 100 = -20", rows[0].counted_qty === 80 && rows[0].delta === -20);
check("delta up: 90 - 80 = +10", rows[1].counted_qty === 90 && rows[1].delta === 10);
check("delta confirm: 90 - 90 = 0", rows[2].delta === 0);
check("null previous -> null delta", rows[3].previous_qty === null && rows[3].delta === null);
check("counted_by + source persisted", rows[1].counted_by === "John Hall" && rows[1].source === "staff_portal");

// True-burn sanity: between the first two counts (7 days), actual usage with no
// receipts would be prev(80) - this(90) = -10 (a gain, i.e. a found/correction).
// The report layer computes this per window; here we just confirm the inputs are
// present and reconstructable from the ledger.
check("burn inputs reconstructable (prev + this + dates present)",
  rows[0].counted_qty != null && rows[1].counted_qty != null && rows[0].occurred_at && rows[1].occurred_at);

// Clean up the synthetic rows.
sqlite.prepare("DELETE FROM inventory_count_events WHERE item_id = ?").run(ITEM);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
