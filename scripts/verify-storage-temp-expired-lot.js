#!/usr/bin/env node
/**
 * verify-storage-temp-expired-lot.js
 *
 * Receipt for Pfizer demo items 2 and 5 (VeritaStockPage):
 *   Item 2: the storage-temperature label (storageTempLabel) shown on the row
 *           and reflected from the storage_temp / storage_temp_threshold fields.
 *   Item 5: the "expired lot" gate (isLotExpired) that surfaces the one-click
 *           "write off the whole expired lot" action, and the full-quantity
 *           write-off payload.
 *
 * Re-implements the pure client logic; keep in lockstep with VeritaStockPage.tsx.
 */

// --- Item 2: storage temperature label ---
const STORAGE_TEMP_LABEL = { room: "Room temp", refrigerated: "Refrigerated", frozen: "Frozen", deep_frozen: "Deep frozen" };
function storageTempLabel(it) {
  if (!it.storage_temp) return "";
  const base = STORAGE_TEMP_LABEL[it.storage_temp] || it.storage_temp;
  return it.storage_temp === "deep_frozen" && it.storage_temp_threshold ? `${base} (${it.storage_temp_threshold})` : base;
}

// --- Item 5: expired-lot gate + full-lot write-off payload ---
const TODAY = "2026-07-28";
function isLotExpired(it) {
  return !!it.expiration_date && it.expiration_date < TODAY && (it.quantity_on_hand || 0) > 0;
}
// The button posts the ENTIRE remaining quantity as an expired write-off.
function expiredLotWriteOffBody(it) {
  return { qty: it.quantity_on_hand, reason_code: "expired", note: "Expired lot removed from shelf" };
}

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
  ok ? pass++ : fail++;
};

// Item 2 label cases
check("room temp label", storageTempLabel({ storage_temp: "room" }), "Room temp");
check("refrigerated label", storageTempLabel({ storage_temp: "refrigerated" }), "Refrigerated");
check("frozen label", storageTempLabel({ storage_temp: "frozen" }), "Frozen");
check("deep frozen with threshold", storageTempLabel({ storage_temp: "deep_frozen", storage_temp_threshold: "-70 C" }), "Deep frozen (-70 C)");
check("deep frozen without threshold", storageTempLabel({ storage_temp: "deep_frozen", storage_temp_threshold: null }), "Deep frozen");
check("no storage temp -> empty", storageTempLabel({ storage_temp: null }), "");

// Item 5 expired-lot gate
check("expired lot with stock is flagged", isLotExpired({ expiration_date: "2026-07-27", quantity_on_hand: 6 }), true);
check("future-dated lot is not expired", isLotExpired({ expiration_date: "2026-12-31", quantity_on_hand: 6 }), false);
check("today is not yet expired (strict <)", isLotExpired({ expiration_date: "2026-07-28", quantity_on_hand: 6 }), false);
check("expired but zero on hand -> not flagged", isLotExpired({ expiration_date: "2026-01-01", quantity_on_hand: 0 }), false);
check("no expiration date -> not flagged", isLotExpired({ expiration_date: null, quantity_on_hand: 6 }), false);

// Item 5 write-off body removes the WHOLE lot
check("write-off body uses full on-hand qty + expired reason",
  expiredLotWriteOffBody({ quantity_on_hand: 6 }),
  { qty: 6, reason_code: "expired", note: "Expired lot removed from shelf" });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
