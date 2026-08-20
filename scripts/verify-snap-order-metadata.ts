// Verify receipt for the Snap Order metadata fields (PO #, Account #, Name & Reason).
// Exercises buildSnapOrderHTML with the fields present, absent (null branch), and
// with hostile input (HTML escaping). Run: npx tsx scripts/verify-snap-order-metadata.ts
import { buildSnapOrderHTML, type SnapOrderItem } from "../server/orderDocument";

const items: SnapOrderItem[] = [
  {
    id: 1, item_name: "BD Vacutainer SST", catalog_number: "367988", lot_number: "L123",
    vendor: "Becton Dickinson", department: "Chemistry", unit: "each", order_unit: "box",
    quantity_on_hand: 4, snap_qty: 10, snap_unit: "box",
  },
];

let pass = 0, fail = 0;
const assert = (name: string, cond: boolean) => {
  console.log((cond ? "PASS" : "FAIL") + ": " + name);
  cond ? pass++ : fail++;
};

// --- Fields present ---
const withMeta = buildSnapOrderHTML(items, {
  labName: "San Carlos Apache Healthcare", cliaNumber: "03D0531813", preparedBy: "Christian Bartlett",
  poNumber: "PO-2026-0042", accountNumber: "ACCT-778812",
  nameReason: "Christian Bartlett\nOutbreak surge, need BD tubes now",
});
assert("PO # renders in header", withMeta.includes("PO #: PO-2026-0042"));
assert("Account # renders in header", withMeta.includes("Account #: ACCT-778812"));
assert("Name/Reason first line renders", withMeta.includes("Christian Bartlett"));
assert("Name/Reason second line renders", withMeta.includes("Outbreak surge, need BD tubes now"));
assert("Name/Reason newline becomes <br>", withMeta.includes("<br>"));
assert("Name/Reason label present", withMeta.includes("Name &amp; Reason for snap order"));

// --- Fields absent (null branch) ---
const noMeta = buildSnapOrderHTML(items, { labName: "L", cliaNumber: "C", preparedBy: "P" });
assert("No PO # line when absent", !noMeta.includes("PO #:"));
assert("No Account # line when absent", !noMeta.includes("Account #:"));
assert("Label still present when blank (handwriting line)", noMeta.includes("Name &amp; Reason for snap order"));

// --- Hostile input is escaped ---
const xss = buildSnapOrderHTML(items, { poNumber: "<script>alert(1)</script>", nameReason: "<b>x</b>" });
assert("PO # is HTML-escaped", xss.includes("&lt;script&gt;") && !xss.includes("<script>alert(1)</script>"));
assert("Name/Reason is HTML-escaped", xss.includes("&lt;b&gt;x&lt;/b&gt;") && !xss.includes("<b>x</b>"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
