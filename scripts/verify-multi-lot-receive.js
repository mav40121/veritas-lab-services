// scripts/verify-multi-lot-receive.js
//
// Gate 3 receipt for the multi-lot receive routing in server/veritabench.ts.
// The receive handler decides whether the arriving stock LUMPS onto the existing
// item row or SPLITS into a separate lot-row:
//   lumpOntoExisting = !hasLotInfo || sameAsCurrent || existingEmptyUnlotted
// This mirrors that rule and asserts every branch.
//
// Run: node scripts/verify-multi-lot-receive.js   (exits non-zero on any FAIL)

// Pure replica of the server decision (keep in sync with veritabench.ts /receive).
function route({ recvLot, recvExp, curLot, curExp, existingOnHand }) {
  const _curLot = (curLot ?? "") || "";
  const _curExp = (curExp ?? "") || "";
  const hasLotInfo = !!(recvLot || recvExp);
  const sameAsCurrent = (recvLot ?? "") === _curLot && (recvExp ?? "") === _curExp;
  const existingEmptyUnlotted = (existingOnHand || 0) <= 0 && !_curLot && !_curExp;
  const lump = !hasLotInfo || sameAsCurrent || existingEmptyUnlotted;
  return lump ? "lump" : "split";
}

let fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  (got ${got}, want ${want})`);
  if (!ok) fail++;
};

// 1. No lot info at all -> lump (backward compatible with old receives).
check("no lot info lumps", route({ recvLot: null, recvExp: null, curLot: "A", curExp: "2026-09-01", existingOnHand: 100 }), "lump");

// 2. Received lot/expiry identical to the existing row -> lump (same lot continues).
check("same lot+expiry lumps", route({ recvLot: "A", recvExp: "2026-09-01", curLot: "A", curExp: "2026-09-01", existingOnHand: 100 }), "lump");

// 3. Existing row empty + unlotted, first lot arrives -> lump (adopt the lot).
check("first lot onto empty unlotted item lumps", route({ recvLot: "A", recvExp: "2026-09-01", curLot: null, curExp: null, existingOnHand: 0 }), "lump");

// 4. Different lot number -> split into its own lot-row.
check("different lot splits", route({ recvLot: "B", recvExp: "2026-09-01", curLot: "A", curExp: "2026-09-01", existingOnHand: 100 }), "split");

// 5. Different expiration (same/blank lot) -> split.
check("different expiry splits", route({ recvLot: "A", recvExp: "2026-12-01", curLot: "A", curExp: "2026-09-01", existingOnHand: 100 }), "split");

// 6. New lot onto an item that already holds a different lot (not empty) -> split.
check("new lot onto stocked item splits", route({ recvLot: "C", recvExp: "2027-01-01", curLot: "A", curExp: "2026-09-01", existingOnHand: 50 }), "split");

// 7. Lot info matches a blank-lot existing row that HAS stock -> only lumps if equal.
check("blank received vs lotted existing splits", route({ recvLot: "X", recvExp: null, curLot: "", curExp: "", existingOnHand: 30 }), "split");

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILURE(S)"} — multi-lot receive routing`);
process.exit(fail === 0 ? 0 : 1);
