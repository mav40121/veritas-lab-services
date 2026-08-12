// scripts/verify-exemption-drop-guard.ts
//
// Gate 3 receipt for the nightly linearity-exemption drop guard. Imports the
// REAL auditExemptionDrops (server/veritamapExemptionGuard.ts) and runs it
// against synthetic nightly_snapshots covering every branch:
//   - full wipe (10 -> 0)          -> FLAG   [harness bites]
//   - partial wipe (10 -> 3, -70%) -> FLAG
//   - exactly 50% (10 -> 5)        -> FLAG   (boundary, inclusive)
//   - just under (10 -> 6, -40%)   -> no flag
//   - small legit drop (10 -> 9)   -> no flag
//   - low baseline (4 -> 0)        -> no flag (below MIN_BASELINE)
//   - increase (0 -> 10)           -> no flag
//   - map deleted since prev       -> no flag (not a wipe)
//   - inactive exempt rows ignored (active 10 -> 4, +6 inactive-exempt) -> FLAG
//   - only one snapshot            -> skipped
//
// Run: node_modules/.bin/tsx scripts/verify-exemption-drop-guard.ts
import Database from "better-sqlite3";
import { auditExemptionDrops } from "../server/veritamapExemptionGuard";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) failures++;
}

const db = new Database(":memory:");
db.exec(`CREATE TABLE nightly_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, snapshot_date TEXT, modules_json TEXT, created_at TEXT);`);
const insert = db.prepare("INSERT INTO nightly_snapshots (user_id, snapshot_date, modules_json) VALUES (?, ?, ?)");

type Row = { active: boolean; exempt: boolean };
function snap(mapId: number, mapName: string | null, rows: Row[]): string {
  const instId = mapId * 10 + 1;
  return JSON.stringify({
    maps: mapName === null ? [] : [{ id: mapId, name: mapName }],
    instruments: mapName === null ? [] : [{ id: instId, map_id: mapId }],
    instrument_tests: mapName === null ? [] : rows.map((r, i) => ({
      instrument_id: instId, active: r.active ? 1 : 0, analyte: `A${i}`,
      linearity_exempt_multical: 0, linearity_exempt_noncal: 0,
      linearity_exempt_waived: r.exempt ? 1 : 0, linearity_exempt_other: null,
    })),
  });
}
const exRows = (activeExempt: number, inactiveExempt = 0, plain = 0): Row[] => [
  ...Array.from({ length: activeExempt }, () => ({ active: true, exempt: true })),
  ...Array.from({ length: inactiveExempt }, () => ({ active: false, exempt: true })),
  ...Array.from({ length: plain }, () => ({ active: true, exempt: false })),
];

// user -> [prev rows, latest rows] on a single map (id = user*100)
const cases: Record<number, { name: string; prev: Row[]; latest: Row[]; mapDeleted?: boolean; flag: boolean }> = {
  1: { name: "full wipe 10->0", prev: exRows(10), latest: exRows(0, 0, 10), flag: true },
  2: { name: "increase 0->10", prev: exRows(0, 0, 10), latest: exRows(10), flag: false },
  3: { name: "small legit drop 10->9", prev: exRows(10), latest: exRows(9, 0, 1), flag: false },
  4: { name: "low baseline 4->0", prev: exRows(4, 0, 6), latest: exRows(0, 0, 10), flag: false },
  5: { name: "partial wipe 10->3 (-70%)", prev: exRows(10), latest: exRows(3, 0, 7), flag: true },
  6: { name: "map deleted since prev", prev: exRows(10), latest: [], mapDeleted: true, flag: false },
  7: { name: "boundary exactly 50% 10->5", prev: exRows(10), latest: exRows(5, 0, 5), flag: true },
  8: { name: "just under threshold 10->6 (-40%)", prev: exRows(10), latest: exRows(6, 0, 4), flag: false },
  10: { name: "inactive exempt ignored (active 10->4)", prev: exRows(10), latest: exRows(4, 6, 0), flag: true },
};

for (const [uid, c] of Object.entries(cases)) {
  const mapId = Number(uid) * 100;
  insert.run(Number(uid), "2026-08-11", snap(mapId, "Map " + uid, c.prev));            // prev (older)
  insert.run(Number(uid), "2026-08-12", snap(mapId, c.mapDeleted ? null : "Map " + uid, c.latest)); // latest
}
// user 9: only one snapshot -> must be skipped, no crash
insert.run(9, "2026-08-12", snap(900, "Map 9", exRows(10)));

const result = auditExemptionDrops(db as any);
const flagged = new Set(result.drops.map((d) => d.mapId));

check("audit ran, ok=false (drops exist)", result.ok === false);
for (const [uid, c] of Object.entries(cases)) {
  const mapId = Number(uid) * 100;
  check(`${c.name} -> ${c.flag ? "FLAGGED" : "not flagged"}`, flagged.has(mapId) === c.flag);
}
check("single-snapshot user 9 skipped (map 900 not flagged, no crash)", !flagged.has(900));

// Spot-check the reported numbers for the full wipe (map 100)
const wipe = result.drops.find((d) => d.mapId === 100);
check("full-wipe row reports prevExempt=10, curExempt=0, dropPct=100", !!wipe && wipe.prevExempt === 10 && wipe.curExempt === 0 && wipe.dropPct === 100);
// Spot-check inactive-ignored (map 1000): active-exempt counted as 4, not 10
const inact = result.drops.find((d) => d.mapId === 1000);
check("inactive-exempt case reports curExempt=4 (inactive rows not counted)", !!inact && inact.curExempt === 4);

db.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
