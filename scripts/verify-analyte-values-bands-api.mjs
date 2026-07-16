// scripts/verify-analyte-values-bands-api.mjs
//
// Receipt for PR 2: the band-aware analyte-values API.
//
// PR 1 gave veritamap_analyte_values an age/sex band key; PR 1's regression fix made
// the writes work again but every route still addressed only the All-ages band, so a
// second band could not be written or read. This adds band params to the PUT, a
// delete-band route, and fixes the last-band-wins collapse in the map/export consumer.
//
// Proves:
//   1. backward compatibility - a PUT with no band fields still writes All-ages,
//   2. a real band can be written alongside All-ages without disturbing it,
//   3. bad band input is REJECTED, not guessed (a value filed under the wrong age
//      band is a clinical error, not a formatting one),
//   4. delete removes only the named band, and refuses an attested one,
//   5. pickDisplayBand is ORDER-INDEPENDENT - the actual defect, since the old
//      `map[av.analyte] = av` in a loop meant whichever row came back last won.
//
// Run: node scripts/verify-analyte-values-bands-api.mjs

import Database from "better-sqlite3";
import { readFileSync } from "fs";

const ALL_AGES_BAND = { ageMinDays: 0, ageMaxDays: 999999, sex: "A", label: "All ages" };
const BAND_SEXES = new Set(["A", "F", "M"]);
const DAYS_18Y = 6570;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// ---- mirrors server/routes.ts ----
function deriveBandLabel(minD, maxD, sex) {
  const fmt = (d) => (d % 365 === 0 ? `${d / 365} y` : `${d} d`);
  let age;
  if (minD === ALL_AGES_BAND.ageMinDays && maxD === ALL_AGES_BAND.ageMaxDays) age = "All ages";
  else if (maxD === ALL_AGES_BAND.ageMaxDays) age = `${fmt(minD)} and older`;
  else if (minD === 0) age = `0 to ${fmt(maxD)}`;
  else age = `${fmt(minD)} to ${fmt(maxD)}`;
  const sexPart = sex === "F" ? ", female" : sex === "M" ? ", male" : "";
  return age + sexPart;
}
function parseBand(body) {
  const hasBand = body?.age_min_days !== undefined || body?.age_max_days !== undefined || body?.sex !== undefined;
  if (!hasBand) return { band: { ...ALL_AGES_BAND } };
  const minD = body.age_min_days === undefined ? ALL_AGES_BAND.ageMinDays : Number(body.age_min_days);
  const maxD = body.age_max_days === undefined ? ALL_AGES_BAND.ageMaxDays : Number(body.age_max_days);
  const sex = String(body.sex ?? ALL_AGES_BAND.sex).trim().toUpperCase();
  if (!Number.isInteger(minD) || minD < 0) return { error: "age_min_days must be an integer >= 0" };
  if (!Number.isInteger(maxD) || maxD < 0) return { error: "age_max_days must be an integer >= 0" };
  if (maxD > ALL_AGES_BAND.ageMaxDays) return { error: "age_max_days too large" };
  if (minD >= maxD) return { error: "age_min_days must be less than age_max_days" };
  if (!BAND_SEXES.has(sex)) return { error: "bad sex" };
  const label = String(body.band_label ?? "").trim() || deriveBandLabel(minD, maxD, sex);
  return { band: { ageMinDays: minD, ageMaxDays: maxD, sex, label } };
}
function pickDisplayBand(bands) {
  if (!bands || bands.length === 0) return undefined;
  const allAges = bands.find((b) => b.age_min_days === ALL_AGES_BAND.ageMinDays && b.age_max_days === ALL_AGES_BAND.ageMaxDays && b.sex === ALL_AGES_BAND.sex);
  if (allAges) return allAges;
  return bands.reduce((w, b) => (b.age_max_days - b.age_min_days > w.age_max_days - w.age_min_days ? b : w), bands[0]);
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE veritamap_analyte_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT, map_id INTEGER NOT NULL, analyte TEXT NOT NULL,
    age_min_days INTEGER NOT NULL DEFAULT 0, age_max_days INTEGER NOT NULL DEFAULT 999999,
    sex TEXT NOT NULL DEFAULT 'A', band_label TEXT,
    ref_range_low TEXT, ref_range_high TEXT, critical_low TEXT, critical_high TEXT, units TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    mec_reviewed_at TEXT, mec_reviewed_by TEXT,
    ref_attested_at TEXT, ref_attested_by TEXT, ref_attested_title TEXT,
    ref_locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(map_id, analyte, age_min_days, age_max_days, sex)
  );
`);

function putValue(mapId, analyte, body) {
  const parsed = parseBand(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const b = parsed.band;
  const locked = db.prepare("SELECT ref_range_low, ref_range_high, ref_locked FROM veritamap_analyte_values WHERE map_id=? AND analyte=? AND age_min_days=? AND age_max_days=? AND sex=?").get(mapId, analyte, b.ageMinDays, b.ageMaxDays, b.sex);
  if (locked?.ref_locked) {
    const changed = (body.ref_range_low || null) !== (locked.ref_range_low || null) || (body.ref_range_high || null) !== (locked.ref_range_high || null);
    if (changed) return { status: 409, body: { error: "locked" } };
  }
  db.prepare(`
    INSERT INTO veritamap_analyte_values (map_id, analyte, age_min_days, age_max_days, sex, band_label, ref_range_low, ref_range_high, critical_low, critical_high, units, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(map_id, analyte, age_min_days, age_max_days, sex) DO UPDATE SET
      band_label=excluded.band_label, ref_range_low=excluded.ref_range_low, ref_range_high=excluded.ref_range_high,
      critical_low=excluded.critical_low, critical_high=excluded.critical_high, units=excluded.units, updated_at=excluded.updated_at
  `).run(mapId, analyte, b.ageMinDays, b.ageMaxDays, b.sex, b.label,
    body.ref_range_low || null, body.ref_range_high || null, body.critical_low || null, body.critical_high || null, body.units || null, "2026-07-16");
  return { status: 200, body: db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id=? AND analyte=? AND age_min_days=? AND age_max_days=? AND sex=?").get(mapId, analyte, b.ageMinDays, b.ageMaxDays, b.sex) };
}
function deleteBand(mapId, analyte, body) {
  const parsed = parseBand(body);
  if (parsed.error) return { status: 400, body: { error: parsed.error } };
  const b = parsed.band;
  const existing = db.prepare("SELECT * FROM veritamap_analyte_values WHERE map_id=? AND analyte=? AND age_min_days=? AND age_max_days=? AND sex=?").get(mapId, analyte, b.ageMinDays, b.ageMaxDays, b.sex);
  if (!existing) return { status: 404, body: { error: "band not found" } };
  if (existing.ref_locked) return { status: 409, body: { error: "locked" } };
  db.prepare("DELETE FROM veritamap_analyte_values WHERE map_id=? AND analyte=? AND age_min_days=? AND age_max_days=? AND sex=?").run(mapId, analyte, b.ageMinDays, b.ageMaxDays, b.sex);
  return { status: 200, body: { ok: true } };
}
const bandsOf = (a) => db.prepare("SELECT * FROM veritamap_analyte_values WHERE analyte=? ORDER BY age_min_days").all(a);
const count = () => db.prepare("SELECT COUNT(*) n FROM veritamap_analyte_values").get().n;

console.log("\nCase 1: a PUT with NO band fields still writes All-ages (pre-band client)");
let r = putValue(48, "Sodium", { ref_range_low: "136", ref_range_high: "145", units: "mmol/L" });
check("200", r.status === 200);
check("landed on All-ages", r.body.age_min_days === 0 && r.body.age_max_days === 999999 && r.body.sex === "A");
check("labelled 'All ages'", r.body.band_label === "All ages");
r = putValue(48, "Sodium", { ref_range_low: "135", ref_range_high: "146", units: "mmol/L" });
check("second PUT updates, does not duplicate", bandsOf("Sodium").length === 1 && bandsOf("Sodium")[0].ref_range_low === "135");

console.log("\nCase 2: a real band writes alongside All-ages without disturbing it");
putValue(48, "Creatinine", { ref_range_low: "0.6", ref_range_high: "1.2", units: "mg/dL" }); // All-ages
r = putValue(48, "Creatinine", { age_min_days: 0, age_max_days: DAYS_18Y, ref_range_low: "0.2", ref_range_high: "0.9", critical_high: "0.99", units: "mg/dL" });
check("200 on the peds band", r.status === 200, JSON.stringify(r.body));
check("auto-labelled '0 to 18 y'", r.body.band_label === "0 to 18 y", r.body.band_label);
check("two bands now", bandsOf("Creatinine").length === 2);
check("peds band keeps its own critical", bandsOf("Creatinine").find((b) => b.age_max_days === DAYS_18Y).critical_high === "0.99");
check("All-ages band untouched", bandsOf("Creatinine").find((b) => b.age_max_days === 999999).ref_range_low === "0.6");

console.log("\nCase 3: sex bands");
r = putValue(48, "Ferritin", { sex: "f", ref_range_low: "11", ref_range_high: "307", units: "ng/mL" });
check("lowercase sex normalised to F", r.status === 200 && r.body.sex === "F");
check("auto-labelled ', female'", r.body.band_label === "All ages, female", r.body.band_label);
putValue(48, "Ferritin", { sex: "M", ref_range_low: "24", ref_range_high: "336", units: "ng/mL" });
check("F and M are distinct bands", bandsOf("Ferritin").length === 2);

console.log("\nCase 4: bad band input is REJECTED, not guessed");
const bad = [
  [{ age_min_days: 100, age_max_days: 100 }, "min == max"],
  [{ age_min_days: 200, age_max_days: 100 }, "min > max"],
  [{ age_min_days: -1 }, "negative min"],
  [{ age_min_days: 1.5 }, "non-integer"],
  [{ age_max_days: 1000000 }, "beyond the sentinel"],
  [{ sex: "X" }, "sex not in A/F/M"],
  [{ sex: "" }, "empty sex"],
];
const beforeBad = count();
for (const [body, label] of bad) {
  const rr = putValue(48, "Junk", { ...body, ref_range_low: "1" });
  check(`rejected: ${label}`, rr.status === 400, JSON.stringify(rr.body));
}
check("no junk rows written by any rejected PUT", count() === beforeBad, `${beforeBad} -> ${count()}`);

console.log("\nCase 5: delete removes only the named band");
const beforeDel = bandsOf("Creatinine").length;
r = deleteBand(48, "Creatinine", { age_min_days: 0, age_max_days: DAYS_18Y });
check("200", r.status === 200);
check("peds band gone", !bandsOf("Creatinine").some((b) => b.age_max_days === DAYS_18Y));
check("All-ages band survived", bandsOf("Creatinine").some((b) => b.age_max_days === 999999), `${beforeDel} -> ${bandsOf("Creatinine").length}`);
check("deleting a band that does not exist -> 404", deleteBand(48, "Creatinine", { age_min_days: 1, age_max_days: 2 }).status === 404);

console.log("\nCase 6: an attested band cannot be silently deleted or edited (493.1253)");
db.prepare("UPDATE veritamap_analyte_values SET ref_locked=1, ref_attested_by='Dr. Gilles' WHERE analyte='Sodium'").run();
check("delete of a locked band -> 409", deleteBand(48, "Sodium", {}).status === 409);
check("PUT changing a locked range -> 409", putValue(48, "Sodium", { ref_range_low: "999", ref_range_high: "999" }).status === 409);
check("PUT NOT changing the range is still allowed", putValue(48, "Sodium", { ref_range_low: "135", ref_range_high: "146", units: "mmol/L", critical_low: "120" }).status === 200);
check("the locked band still exists", bandsOf("Sodium").length === 1);

console.log("\nCase 7: pickDisplayBand is ORDER-INDEPENDENT (the actual defect)");
const peds = { analyte: "X", age_min_days: 0, age_max_days: DAYS_18Y, sex: "A", ref_range_low: "peds" };
const adult = { analyte: "X", age_min_days: DAYS_18Y, age_max_days: 999999, sex: "A", ref_range_low: "adult" };
const allAges = { analyte: "X", age_min_days: 0, age_max_days: 999999, sex: "A", ref_range_low: "allages" };
// The OLD collapse: `map[av.analyte] = av` in a loop -> last row wins.
const oldCollapse = (rows) => { const m = {}; for (const r of rows) m[r.analyte] = r; return m["X"]; };
check("OLD collapse IS order-dependent (proves the defect was real)",
  oldCollapse([peds, adult, allAges]).ref_range_low !== oldCollapse([allAges, adult, peds]).ref_range_low);
check("NEW pick is identical regardless of order",
  pickDisplayBand([peds, adult, allAges]).ref_range_low === pickDisplayBand([allAges, adult, peds]).ref_range_low);
check("NEW pick prefers the All-ages band", pickDisplayBand([peds, adult, allAges]).ref_range_low === "allages");
check("with no All-ages band, falls back to the WIDEST deterministically",
  pickDisplayBand([peds, adult]).ref_range_low === pickDisplayBand([adult, peds]).ref_range_low);
check("single-band analyte is unaffected", pickDisplayBand([allAges]).ref_range_low === "allages");
check("empty -> undefined (no crash)", pickDisplayBand([]) === undefined);

console.log("\nCase 8: shipped source");
const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
check("delete-band route exists", src.includes('analyte-values/:analyte/band"'));
check("parseBand exists", src.includes("function parseBand("));
check("collapse no longer assigns in a bare loop", !/for \(const av of analyteValuesRaw\) analyteValuesMap\[av\.analyte\] = av;/.test(src));
check("band values are BOUND, not interpolated into SQL", !/VALUES \(\?, \?, \$\{.*ageMinDays\}/.test(src));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
