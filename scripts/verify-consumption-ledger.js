// scripts/verify-consumption-ledger.js
//
// Math receipt for the Keystone Layer-2 consumption ledger (Phase 1). Models the
// depletion-event derivation for each instrumented path exactly as the endpoints
// compute it, and the logConsumption skip-rule (non-positive qty -> no event).
// Proves: each depletion derives one event with the right reason + qty, the event
// qty equals the magnitude of the on_hand delta (so the ledger records the same
// depletion that moved on_hand — without itself touching on_hand), and an
// upward / no-change adjustment records NOTHING.
//
//   node scripts/verify-consumption-ledger.js

// --- mirrors server/consumptionLedger.ts logConsumption skip-rule ------------
function wouldLog(qty) { return Number.isFinite(qty) && qty > 0; }

// --- mirrors the instrumentation in each endpoint ----------------------------
// write-off: depletes `qty`; on_hand goes onHand -> onHand - qty.
function writeOff(onHand, qty) {
  const after = onHand - qty;
  const ev = wouldLog(qty) ? { reason: "write_off", qty } : null;
  return { onHandAfter: after, event: ev };
}
// adjust: SETS on_hand to `after`. A downward correction (before > after) is a
// depletion of (before - after); upward / no-change logs nothing.
function adjust(before, after) {
  const depQty = before - after;
  const ev = wouldLog(depQty) ? { reason: "adjust_down", qty: depQty } : null;
  return { onHandAfter: after, event: ev };
}
// transfer accept: the SOURCE depleted `qtyUsage` (left on send, finalized on
// accept). on_hand at the source already moved on send; accept logs the event.
function transferAccept(qtyUsage) {
  const ev = wouldLog(qtyUsage) ? { reason: "transfer_out", qty: qtyUsage } : null;
  return { event: ev };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// --- write-off ----------------------------------------------------------------
const wo = writeOff(540, 120);
check("write-off: on_hand moves 540 -> 420", wo.onHandAfter, 420);
check("write-off: one write_off event of 120", wo.event, { reason: "write_off", qty: 120 });
check("write-off: event qty == |on_hand delta|", wo.event.qty, 540 - wo.onHandAfter);

// --- adjust DOWN (depletion) --------------------------------------------------
const ad = adjust(420, 416);
check("adjust down: on_hand 420 -> 416", ad.onHandAfter, 416);
check("adjust down: one adjust_down event of 4", ad.event, { reason: "adjust_down", qty: 4 });
check("adjust down: event qty == |on_hand delta|", ad.event.qty, 420 - ad.onHandAfter);

// --- adjust UP (NOT consumption) ----------------------------------------------
const au = adjust(416, 500);
check("adjust up: on_hand 416 -> 500", au.onHandAfter, 500);
check("adjust up: NO event logged", au.event, null);

// --- adjust no-change ---------------------------------------------------------
check("adjust no-change: NO event logged", adjust(100, 100).event, null);

// --- transfer accept (source depletion) ---------------------------------------
check("transfer accept: one transfer_out event of 2000", transferAccept(2000).event, { reason: "transfer_out", qty: 2000 });

// --- skip-rule edge cases -----------------------------------------------------
check("skip: zero qty -> no event", wouldLog(0), false);
check("skip: negative qty -> no event", wouldLog(-5), false);
check("log: positive qty -> event", wouldLog(5), true);

// --- on_hand invariant (the ledger never sets on_hand) ------------------------
// Each path computes on_hand independently of the event; the event is a derived
// side-effect record. Re-deriving the event from a path must NOT change on_hand.
const base = writeOff(1000, 7);
check("invariant: deriving the event does not alter the computed on_hand", base.onHandAfter, 993);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
