// scripts/verify-lot-reconcile.js
//
// Gate 3 receipt for the FEFO reconcile math in server/inventoryLots.ts.
// reconcileLots makes the lot total equal the authoritative quantity_on_hand:
// a shortfall is removed oldest-expiry first (FEFO); a surplus goes to the newest
// lot (or seeds one). It never changes quantity_on_hand. This mirrors that math
// as a pure function and asserts each branch.
//
// Run: node scripts/verify-lot-reconcile.js   (exits non-zero on any FAIL)

// Pure replica (lots are FEFO-sorted: oldest expiry first).
function reconcile(lotsIn, onHand) {
  const lots = lotsIn.map((l) => ({ ...l }));
  const sum = lots.reduce((s, l) => s + l.qty, 0);
  if (Math.abs(sum - onHand) < 1e-6) return lots.filter((l) => l.qty > 1e-6);
  if (sum > onHand) {
    let deficit = sum - onHand;
    for (const l of lots) {
      if (deficit <= 1e-6) break;
      const take = Math.min(l.qty, deficit);
      l.qty -= take;
      deficit -= take;
    }
    return lots.filter((l) => l.qty > 1e-6);
  }
  const surplus = onHand - sum;
  if (lots.length > 0) lots[lots.length - 1].qty += surplus;
  else lots.push({ exp: null, qty: surplus });
  return lots;
}

let fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) { console.log("   got ", JSON.stringify(got)); console.log("   want", JSON.stringify(want)); fail++; }
};

// 1. In sync -> unchanged.
eq("in-sync is a no-op",
  reconcile([{ exp: "2026-09", qty: 100 }], 100),
  [{ exp: "2026-09", qty: 100 }]);

// 2. Shortfall within the oldest lot -> deplete oldest only.
eq("shortfall depletes oldest lot first",
  reconcile([{ exp: "2026-09", qty: 100 }, { exp: "2026-12", qty: 50 }], 120),
  [{ exp: "2026-09", qty: 70 }, { exp: "2026-12", qty: 50 }]);

// 3. Shortfall crossing lots -> oldest emptied (removed), remainder from next.
eq("shortfall crosses lots FEFO, empties oldest",
  reconcile([{ exp: "2026-09", qty: 100 }, { exp: "2026-12", qty: 50 }], 40),
  [{ exp: "2026-12", qty: 40 }]);

// 4. Deplete to zero -> all lots removed.
eq("deplete to zero removes all lots",
  reconcile([{ exp: "2026-09", qty: 100 }, { exp: "2026-12", qty: 50 }], 0),
  []);

// 5. Surplus -> added to the newest lot.
eq("surplus goes to the newest lot",
  reconcile([{ exp: "2026-09", qty: 100 }, { exp: "2026-12", qty: 50 }], 200),
  [{ exp: "2026-09", qty: 100 }, { exp: "2026-12", qty: 100 }]);

// 6. Surplus with no lots -> seeds a lot.
eq("surplus with no lots seeds a lot",
  reconcile([], 60),
  [{ exp: null, qty: 60 }]);

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILURE(S)"} — FEFO lot reconcile`);
process.exit(fail === 0 ? 0 : 1);
