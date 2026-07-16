// scripts/verify-veritamap-complexity-source.mjs
//
// Receipt for the source-side VeritaMap complexity fixes.
//
// Background (HANDOFF_veritamap_complexity_defect.md, found in San Carlos lab 2 QA):
//   Defect A - /api/admin/seed-instrument-menu did `String(t.complexity || "MODERATE")`,
//     silently writing MODERATE when a payload omitted complexity, with no error and no
//     marker separating "the lab said moderate" from "nobody said anything". That is how
//     CLIA-waived CLINITEK Status+ dipstick rows were seeded MODERATE.
//   Defect B - the seeder is INSERT OR IGNORE, so re-posting the CORRECT complexity
//     silently no-ops (analyte lands in skipped[]), and resync-complexity only re-derives
//     the veritamap_tests rollup FROM instrument_tests, faithfully propagating the wrong
//     value. Nothing could fix complexity at the source.
//
// Complexity drives PT enrollment (493.801), performance verification (493.1253),
// competency (493.1235), QC design (493.1256) and personnel (Subpart M). It is a
// regulatory property, so it is rejected when absent, never guessed.
//
// This mirrors the SQL/logic in server/routes.ts. Case 8 additionally greps the real
// source so the mirrored logic cannot silently drift from the shipped route.
//
// Run: node scripts/verify-veritamap-complexity-source.mjs

import Database from "better-sqlite3";
import { readFileSync } from "fs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const VERITAMAP_COMPLEXITY_VALUES = new Set(["WAIVED", "MODERATE", "HIGH"]);

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, lab_id INTEGER);
  CREATE TABLE veritamap_instruments (id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER, instrument_name TEXT, nickname TEXT);
  CREATE TABLE veritamap_instrument_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, instrument_id INTEGER NOT NULL, map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL, specialty TEXT, complexity TEXT, active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(instrument_id, analyte)
  );
  CREATE TABLE veritamap_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, analyte TEXT NOT NULL,
    specialty TEXT, complexity TEXT, active INTEGER NOT NULL DEFAULT 1,
    instrument_source TEXT, updated_at TEXT NOT NULL,
    UNIQUE(map_id, analyte)
  );
`);
db.prepare("INSERT INTO veritamap_maps (id, lab_id) VALUES (1, 2)").run();
db.prepare("INSERT INTO veritamap_instruments (id, map_id, instrument_name) VALUES (1, 1, 'CLINITEK Advantus')").run();
db.prepare("INSERT INTO veritamap_instruments (id, map_id, instrument_name) VALUES (2, 1, 'CLINITEK Status+')").run();

// ---- mirrors rebuildMapTests (routes.ts:13092-13121): highest-wins rollup ----
const COMPLEXITY_RANK = { WAIVED: 0, MODERATE: 1, HIGH: 2 };
function rebuildMapTests(mapId) {
  const rows = db.prepare(`
    SELECT it.analyte, it.specialty, it.complexity, i.instrument_name
    FROM veritamap_instrument_tests it
    JOIN veritamap_instruments i ON i.id = it.instrument_id
    WHERE it.map_id = ? AND it.active = 1
  `).all(mapId);
  const byAnalyte = new Map();
  for (const r of rows) {
    const cx = String(r.complexity || "").toUpperCase();
    const prev = byAnalyte.get(r.analyte);
    if (!prev || (COMPLEXITY_RANK[cx] ?? -1) > (COMPLEXITY_RANK[String(prev.complexity).toUpperCase()] ?? -1)) {
      byAnalyte.set(r.analyte, r);
    }
  }
  const stmt = db.prepare(`
    INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(map_id, analyte) DO UPDATE SET
      specialty = excluded.specialty, complexity = excluded.complexity,
      instrument_source = excluded.instrument_source, updated_at = excluded.updated_at
  `);
  for (const r of byAnalyte.values()) stmt.run(mapId, r.analyte, r.specialty, r.complexity, r.instrument_name, "2026-07-16");
}

// ---- mirrors the FIXED /api/admin/seed-instrument-menu ----
function seedInstrumentMenu({ mapId, instrumentId, tests }) {
  for (const t of tests) {
    const a = String(t?.analyte || "").trim();
    if (!a) continue;
    const cx = String(t?.complexity ?? "").trim().toUpperCase();
    if (!cx) return { status: 400, body: { error: "complexity_required", analyte: a } };
    if (!VERITAMAP_COMPLEXITY_VALUES.has(cx)) {
      return { status: 400, body: { error: "complexity_invalid", analyte: a, complexity: t?.complexity ?? null } };
    }
  }
  const stmt = db.prepare("INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, ?)");
  let inserted = 0; const skipped = [];
  const tx = db.transaction((rows) => {
    for (const t of rows) {
      const analyte = String(t.analyte || "").trim();
      if (!analyte) continue;
      const specialty = String(t.specialty || "").trim();
      const complexity = String(t.complexity).trim().toUpperCase();
      const r = stmt.run(instrumentId, mapId, analyte, specialty, complexity, 1);
      if (r.changes === 1) inserted++; else skipped.push(analyte);
    }
  });
  tx(tests);
  rebuildMapTests(mapId);
  return { status: 200, body: { inserted, skipped } };
}

// ---- mirrors the NEW /api/admin/veritamap/set-complexity ----
function setComplexity({ labId, instrumentNameLike, analytes, complexity, dryRun }) {
  const list = (analytes || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (!Number.isFinite(Number(labId)) || !instrumentNameLike || list.length === 0) {
    return { status: 400, body: { error: "labId, instrumentNameLike, and analyte or analytes[] required" } };
  }
  const cx = String(complexity ?? "").trim().toUpperCase();
  if (!cx) return { status: 400, body: { error: "complexity_required" } };
  if (!VERITAMAP_COMPLEXITY_VALUES.has(cx)) return { status: 400, body: { error: "complexity_invalid", complexity } };
  const maps = db.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(Number(labId));
  if (maps.length === 0) return { status: 404, body: { error: `no map for lab ${labId}` } };
  if (maps.length > 1) return { status: 400, body: { error: "ambiguous" } };
  const mapId = maps[0].id;
  const instruments = db.prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ? AND instrument_name LIKE ?").all(mapId, `%${instrumentNameLike}%`);
  if (instruments.length === 0) return { status: 400, body: { error: "no instruments match" } };
  const findRow = db.prepare("SELECT id, analyte, complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND lower(analyte) = lower(?)");
  const upd = db.prepare("UPDATE veritamap_instrument_tests SET complexity = ? WHERE id = ?");
  const results = []; let updated = 0;
  for (const inst of instruments) {
    for (const a of list) {
      const row = findRow.get(inst.id, a);
      if (!row) { results.push({ instrument: inst.instrument_name, analyte: a, action: "skipped-not-on-instrument" }); continue; }
      if (String(row.complexity || "").toUpperCase() === cx) { results.push({ instrument: inst.instrument_name, analyte: row.analyte, action: "skipped-already" }); continue; }
      if (!dryRun) { upd.run(cx, row.id); updated++; }
      results.push({ instrument: inst.instrument_name, analyte: row.analyte, action: dryRun ? "would-update" : "updated", from: row.complexity, to: cx });
    }
  }
  if (!dryRun && updated > 0) rebuildMapTests(mapId);
  return { status: 200, body: { dryRun: !!dryRun, mapId, updated, results } };
}

const cxOf = (instId, analyte) => db.prepare("SELECT complexity FROM veritamap_instrument_tests WHERE instrument_id=? AND analyte=?").get(instId, analyte)?.complexity;
const rowCount = () => db.prepare("SELECT COUNT(*) n FROM veritamap_instrument_tests").get().n;

console.log("\nCase 1: complexity supplied -> stored");
let r = seedInstrumentMenu({ mapId: 1, instrumentId: 1, tests: [
  { analyte: "Glucose, urine", specialty: "Urinalysis", complexity: "MODERATE" },
  { analyte: "Protein, urine", specialty: "Urinalysis", complexity: "MODERATE" },
]});
check("200 on a complete payload", r.status === 200, JSON.stringify(r.body));
check("Advantus Glucose stored MODERATE", cxOf(1, "Glucose, urine") === "MODERATE");
check("rollup derived", db.prepare("SELECT complexity FROM veritamap_tests WHERE analyte='Glucose, urine'").get()?.complexity === "MODERATE");

console.log("\nCase 2: complexity MISSING -> 400, and nothing is written");
const beforeMissing = rowCount();
r = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [
  { analyte: "Urine qualitative dipstick glucose", specialty: "Urinalysis" }, // no complexity
]});
check("400 returned", r.status === 400, JSON.stringify(r.body));
check("error is complexity_required", r.body.error === "complexity_required");
check("names the offending analyte", r.body.analyte === "Urine qualitative dipstick glucose");
check("NOTHING written (all-or-nothing)", rowCount() === beforeMissing, `${beforeMissing} -> ${rowCount()}`);

console.log("\nCase 2b: blank/null complexity is also rejected, not coerced");
for (const bad of ["", "   ", null, undefined]) {
  const rr = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [{ analyte: "X", complexity: bad }] });
  check(`complexity=${JSON.stringify(bad)} -> 400 complexity_required`, rr.status === 400 && rr.body.error === "complexity_required");
}

console.log("\nCase 2c: a payload where ONE row lacks complexity writes none of the rows");
const beforePartial = rowCount();
r = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [
  { analyte: "Ketones", specialty: "Urinalysis", complexity: "WAIVED" },   // valid
  { analyte: "Nitrite", specialty: "Urinalysis" },                          // invalid
]});
check("400 returned", r.status === 400);
check("the VALID row was not written either", rowCount() === beforePartial, `${beforePartial} -> ${rowCount()}`);

console.log("\nCase 3: an unrecognised complexity is rejected, not stored");
r = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [{ analyte: "Y", complexity: "SORTA_MODERATE" }] });
check("400 complexity_invalid", r.status === 400 && r.body.error === "complexity_invalid", JSON.stringify(r.body));

console.log("\nCase 4: the San Carlos shape -- seed Status+ WRONG, then correct at the source");
// Seed the Status+ the way it actually landed: MODERATE on a waived analyzer.
r = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [
  { analyte: "Urine qualitative dipstick glucose", specialty: "Urinalysis", complexity: "MODERATE" },
  { analyte: "URINE HCG", specialty: "Urinalysis", complexity: "WAIVED" },
]});
check("Status+ seeded", r.status === 200);
check("Status+ dipstick glucose is MODERATE (the defect)", cxOf(2, "Urine qualitative dipstick glucose") === "MODERATE");

// Defect B proof: re-posting the CORRECT value through the seeder does nothing.
r = seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [
  { analyte: "Urine qualitative dipstick glucose", specialty: "Urinalysis", complexity: "WAIVED" },
]});
check("re-posting via seeder reports skipped[] (INSERT OR IGNORE)", r.body.skipped?.includes("Urine qualitative dipstick glucose"));
check("re-posting via seeder does NOT fix it (this is Defect B)", cxOf(2, "Urine qualitative dipstick glucose") === "MODERATE");

// The new endpoint CAN fix it.
const beforeFix = rowCount();
r = setComplexity({ labId: 2, instrumentNameLike: "Status+", analytes: ["Urine qualitative dipstick glucose"], complexity: "WAIVED" });
check("set-complexity 200", r.status === 200, JSON.stringify(r.body));
check("existing row ACTUALLY updated to WAIVED", cxOf(2, "Urine qualitative dipstick glucose") === "WAIVED");
check("reports updated=1", r.body.updated === 1);
check("no row inserted or dropped (UPDATE-only)", rowCount() === beforeFix, `${beforeFix} -> ${rowCount()}`);
check("did NOT touch the Advantus row", cxOf(1, "Glucose, urine") === "MODERATE");
check("did NOT touch URINE HCG (already correct)", cxOf(2, "URINE HCG") === "WAIVED");

console.log("\nCase 5: dryRun previews without writing");
r = setComplexity({ labId: 2, instrumentNameLike: "Advantus", analytes: ["Glucose, urine"], complexity: "WAIVED", dryRun: true });
check("dryRun reports would-update", r.body.results.some((x) => x.action === "would-update" && x.from === "MODERATE" && x.to === "WAIVED"));
check("dryRun updated=0", r.body.updated === 0);
check("dryRun left the row alone", cxOf(1, "Glucose, urine") === "MODERATE");

console.log("\nCase 6: UPDATE-only -- cannot create a row for an analyte not on the instrument");
const beforeGhost = rowCount();
r = setComplexity({ labId: 2, instrumentNameLike: "Status+", analytes: ["Not On This Instrument"], complexity: "WAIVED" });
check("reports skipped-not-on-instrument", r.body.results.some((x) => x.action === "skipped-not-on-instrument"));
check("inserted nothing", rowCount() === beforeGhost);

console.log("\nCase 7: rebuildMapTests re-derives the rollup from the corrected source");
// Advantus MODERATE + Status+ WAIVED for the SAME analyte name -> highest-wins -> MODERATE.
// This pins the DOCUMENTED behaviour of Defect C (per-instrument complexity cannot be
// represented in the UNIQUE(map_id, analyte) rollup). Not fixed here; Michael's call.
seedInstrumentMenu({ mapId: 1, instrumentId: 2, tests: [{ analyte: "Glucose, urine", specialty: "Urinalysis", complexity: "WAIVED" }] });
rebuildMapTests(1);
check("rollup for a waived+moderate analyte reports MODERATE (highest-wins, Defect C)",
  db.prepare("SELECT complexity FROM veritamap_tests WHERE analyte='Glucose, urine'").get()?.complexity === "MODERATE");
// And a correction that lowers the ONLY instrument does propagate.
setComplexity({ labId: 2, instrumentNameLike: "Status+", analytes: ["URINE HCG"], complexity: "MODERATE" });
check("rollup follows a source correction (URINE HCG -> MODERATE)",
  db.prepare("SELECT complexity FROM veritamap_tests WHERE analyte='URINE HCG'").get()?.complexity === "MODERATE");

console.log("\nCase 8: the guessed-MODERATE default is gone from the real source");
// Guards the mirrored logic above against drifting from the shipped route. Comment
// lines are stripped first: the fix's own comment quotes the old `|| "MODERATE"`
// expression on purpose (it records why the check exists), and that documentation
// must not read as the defect still being present.
const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const code = src
  .split("\n")
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
  })
  .join("\n");
check('no `|| "MODERATE"` fallback in executable code', !/\|\|\s*["']MODERATE["']/.test(code));
check('no `?? "MODERATE"` fallback in executable code', !/\?\?\s*["']MODERATE["']/.test(code));
check("the guard can still see the defect shape (self-test)", /\|\|\s*["']MODERATE["']/.test('x = String(t.complexity || "MODERATE")'));
check("seed endpoint rejects with complexity_required", src.includes('error: "complexity_required"'));
check("set-complexity endpoint exists", src.includes('"/api/admin/veritamap/set-complexity"'));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
