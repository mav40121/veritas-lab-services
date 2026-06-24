// scripts/verify-accept-active-location.js
//
// Math receipt for the VeritaStock active-location accept/reject gate
// (server/routes.ts). Receiving a transfer happens AT the destination, so
// Accept/Reject require BOTH:
//   1. destination membership   -> else 403 (existing backstop)
//   2. active-location context  -> else 409 switch_to_destination (new)
// where active context means the currently-selected location (req.scope.labId)
// IS the transfer's destination (to_lab_id). on_hand moves ONLY on the 200 path.
// The same gate, in the same order, applies to accept AND reject (reject parity).
//
// Also models the incoming-list decoration the two client views key off:
//   per-row can_accept = (to_lab_id === activeLabId)
//   top-level active_count = number of DISTINCT actionable batches (shipments)
//
//   node scripts/verify-accept-active-location.js

// --- gate decision: mirrors routes.ts accept/reject ordering exactly ---------
// pending: the batch's transfer rows (all share one destination after the
// spans-multiple-destinations guard). ctx: { userMemberLabIds, activeLabId }.
// onHandBefore/qty model the destination item that would receive the stock.
function attemptDecide(pending, ctx, onHandBefore, qty) {
  // batch must exist + be pending
  if (!pending || pending.length === 0) {
    return { status: 404, onHandAfter: onHandBefore };
  }
  const toLabId = pending[0].to_lab_id;
  // 409: batch spans multiple destinations (pre-existing guard)
  if (pending.some((p) => p.to_lab_id !== toLabId)) {
    return { status: 409, code: "multi_destination", onHandAfter: onHandBefore };
  }
  // 403: membership backstop FIRST (defense in depth)
  if (!ctx.userMemberLabIds.includes(toLabId)) {
    return { status: 403, onHandAfter: onHandBefore };
  }
  // 409: active-location context (the new gate)
  if (Number(ctx.activeLabId) !== Number(toLabId)) {
    return { status: 409, code: "switch_to_destination", to_lab_id: toLabId, onHandAfter: onHandBefore };
  }
  // 200: stock lands at the destination
  return { status: 200, onHandAfter: onHandBefore + qty };
}

// --- incoming-list decoration: mirrors the GET .../incoming response ---------
function decorateIncoming(rows, activeLabId) {
  const decorated = rows.map((r) => ({ ...r, can_accept: Number(r.to_lab_id) === Number(activeLabId) }));
  const activeBatches = new Set(
    decorated.filter((r) => r.can_accept).map((r) => r.batch_id ?? `t${r.id}`),
  );
  return { incoming: decorated, total: decorated.length, active_count: activeBatches.size };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// --- 3-location fixture: Warehouse(1), ED(2), Bylas(3) -----------------------
const WAREHOUSE = 1, ED = 2, BYLAS = 3;
// One ED-bound pending batch ("B1") of 2 items; one Bylas-bound batch ("B2").
const edBatch = [
  { id: 11, batch_id: "B1", to_lab_id: ED },
  { id: 12, batch_id: "B1", to_lab_id: ED },
];
const owner = { userMemberLabIds: [WAREHOUSE, ED, BYLAS] }; // multi-location owner
const bylasOnly = { userMemberLabIds: [BYLAS] };            // single-location user

// (a) member + RIGHT context -> 200, on_hand moves (+5).
check("a) owner in ED accepts ED batch -> 200 + stock lands",
  attemptDecide(edBatch, { ...owner, activeLabId: ED }, 30, 5),
  { status: 200, onHandAfter: 35 });

// (b) member + WRONG context -> 409 switch_to_destination, on_hand UNCHANGED.
check("b) owner in Warehouse accepts ED batch -> 409, no move",
  attemptDecide(edBatch, { ...owner, activeLabId: WAREHOUSE }, 30, 5),
  { status: 409, code: "switch_to_destination", to_lab_id: ED, onHandAfter: 30 });

// (b') same gate from Bylas context -> 409, no move (any non-destination ctx).
check("b') owner in Bylas accepts ED batch -> 409, no move",
  attemptDecide(edBatch, { ...owner, activeLabId: BYLAS }, 30, 5),
  { status: 409, code: "switch_to_destination", to_lab_id: ED, onHandAfter: 30 });

// (c) NON-member -> 403 (membership fails before active-context is considered),
//     even if their active context happened to be ED.
check("c) Bylas-only user accepts ED batch -> 403, no move",
  attemptDecide(edBatch, { ...bylasOnly, activeLabId: ED }, 30, 5),
  { status: 403, onHandAfter: 30 });

// Reject parity: identical gate, identical outcomes (same function drives both).
check("reject parity: wrong context -> 409, no move",
  attemptDecide(edBatch, { ...owner, activeLabId: WAREHOUSE }, 30, 0),
  { status: 409, code: "switch_to_destination", to_lab_id: ED, onHandAfter: 30 });

// --- incoming decoration: can_accept + active_count --------------------------
const incomingRows = [
  { id: 11, batch_id: "B1", to_lab_id: ED },
  { id: 12, batch_id: "B1", to_lab_id: ED },
  { id: 21, batch_id: "B2", to_lab_id: BYLAS },
];

// Active = ED: B1 actionable (2 rows), B2 not -> active_count 1.
check("decorate @ ED: can_accept flags",
  decorateIncoming(incomingRows, ED).incoming.map((r) => r.can_accept),
  [true, true, false]);
check("decorate @ ED: active_count = 1 (distinct batch B1)",
  decorateIncoming(incomingRows, ED).active_count, 1);
check("decorate @ ED: total preserved (group-wide)",
  decorateIncoming(incomingRows, ED).total, 3);

// Active = Warehouse: nothing bound here -> no badge.
check("decorate @ Warehouse: active_count = 0",
  decorateIncoming(incomingRows, WAREHOUSE).active_count, 0);
check("decorate @ Warehouse: all can_accept false",
  decorateIncoming(incomingRows, WAREHOUSE).incoming.map((r) => r.can_accept),
  [false, false, false]);

// Active = Bylas: only B2 actionable -> active_count 1.
check("decorate @ Bylas: active_count = 1 (distinct batch B2)",
  decorateIncoming(incomingRows, BYLAS).active_count, 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
