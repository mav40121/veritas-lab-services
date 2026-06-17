// scripts/verify-enterprise-column-order.mjs
//
// Gate 3 step 2 (math/logic) receipt for the Enterprise Inventory column
// ordering added to client/src/pages/VeritaStockEnterprisePage.tsx.
//
// The grid renders one column per enterprise location. When a transfer is set
// up, the From (source) column must be leftmost, the To (destination) next,
// then any remaining locations in their original order. This mirrors the
// `orderedLocations` useMemo so the branching logic is exercised in isolation.
//
// Run: node scripts/verify-enterprise-column-order.mjs

// --- mirror of the component logic (display-only ordering) ---
function orderLocationsForTransfer(locations, fromLab, toLab) {
  const transferReady = !!(fromLab && toLab && String(fromLab) !== String(toLab));
  if (!transferReady) return locations;
  const src = locations.find((l) => String(l.id) === String(fromLab));
  const dst = locations.find((l) => String(l.id) === String(toLab));
  const rest = locations.filter(
    (l) => String(l.id) !== String(fromLab) && String(l.id) !== String(toLab),
  );
  return [src, dst, ...rest].filter(Boolean);
}

const ids = (arr) => arr.map((l) => l.id).join(",");

const cases = [
  {
    name: "No From/To selected -> original order preserved",
    locs: [{ id: 1 }, { id: 2 }],
    from: "",
    to: "",
    expect: "1,2",
  },
  {
    name: "Screenshot case: 2 locs, From=2 To=1 -> From leftmost (reversed)",
    locs: [{ id: 1 }, { id: 2 }], // API returned To-then-From
    from: "2",
    to: "1",
    expect: "2,1",
  },
  {
    name: "Already correct: 2 locs, From=1 To=2 -> unchanged",
    locs: [{ id: 1 }, { id: 2 }],
    from: "1",
    to: "2",
    expect: "1,2",
  },
  {
    name: "3 locs, From=3 To=1 -> source, dest, then the rest",
    locs: [{ id: 1 }, { id: 2 }, { id: 3 }],
    from: "3",
    to: "1",
    expect: "3,1,2",
  },
  {
    name: "4 locs, From=3 To=2 -> [3,2] then remaining in original order",
    locs: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    from: "3",
    to: "2",
    expect: "3,2,1,4",
  },
  {
    name: "From === To (not a valid transfer) -> original order, no dupes",
    locs: [{ id: 1 }, { id: 2 }],
    from: "1",
    to: "1",
    expect: "1,2",
  },
  {
    name: "Numeric id vs string from/to compare correctly",
    locs: [{ id: 8 }, { id: 9 }],
    from: "9",
    to: "8",
    expect: "9,8",
  },
  {
    name: "Column count is preserved (no dropped/added columns)",
    locs: [{ id: 1 }, { id: 2 }, { id: 3 }],
    from: "2",
    to: "3",
    expect: "2,3,1",
  },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = ids(orderLocationsForTransfer(c.locs, c.from, c.to));
  const ok = got === c.expect && got.split(",").length === c.locs.length;
  if (ok) {
    pass++;
    console.log(`PASS  ${c.name}  -> [${got}]`);
  } else {
    fail++;
    console.log(`FAIL  ${c.name}  -> got [${got}], expected [${c.expect}]`);
  }
}

console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
