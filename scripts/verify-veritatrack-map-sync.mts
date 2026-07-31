// Verify the VeritaTrack <-> VeritaMap sign-off sync fix
// (server/veritatrackMapSync.ts) for the SCAHC report 2026-07-29: the map
// showed a cal ver as "not done" after a VeritaTrack sign-off. Proves:
//   - preserveMapLink keeps an imported task's link when the edit omits the fields
//     (the severed-link bug), overwrites on explicit values, clears on explicit ""
//   - applyMapSignoffWriteback updates the map row on an exact analyte match (updated=1)
//   - a name mismatch returns updated=0 + a warning (the bug's silent path, now surfaced)
//   - a non-allowlisted map_field returns a warning and writes nothing
//   - a lab with no map returns a warning
// Run: npx tsx scripts/verify-veritatrack-map-sync.mts
import Database from "better-sqlite3";
import { preserveMapLink, applyMapSignoffWriteback } from "../server/veritatrackMapSync";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}

console.log("preserveMapLink (a routine edit must not sever an imported link)");
{
  const r = preserveMapLink({ name: "x" } as any, { map_analyte: "Glucose", map_field: "last_cal_ver" });
  check("omitted fields keep existing link", r.map_analyte === "Glucose" && r.map_field === "last_cal_ver", JSON.stringify(r));
}
{
  const r = preserveMapLink({ map_analyte: "Sodium", map_field: "last_precision" }, { map_analyte: "Glucose", map_field: "last_cal_ver" });
  check("explicit values overwrite", r.map_analyte === "Sodium" && r.map_field === "last_precision", JSON.stringify(r));
}
{
  const r = preserveMapLink({ map_analyte: "", map_field: "" }, { map_analyte: "Glucose", map_field: "last_cal_ver" });
  check("explicit empty clears link (future unlink)", r.map_analyte === null && r.map_field === null, JSON.stringify(r));
}
{
  const r = preserveMapLink({ name: "x" } as any, {});
  check("no link either side -> null", r.map_analyte === null && r.map_field === null, JSON.stringify(r));
}

console.log("applyMapSignoffWriteback (a 0-row / errored writeback must not be silent)");
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, lab_id INTEGER);
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, lab_id INTEGER, user_id INTEGER);
  CREATE TABLE veritamap_tests (map_id INTEGER, analyte TEXT, last_cal_ver TEXT, last_method_comp TEXT, last_precision TEXT, last_sop_review TEXT, updated_at TEXT);
`);
db.prepare("INSERT INTO users (id, lab_id) VALUES (?, ?)").run(42, 2);
db.prepare("INSERT INTO veritamap_maps (id, lab_id, user_id) VALUES (?, ?, ?)").run(79, 2, 42);
db.prepare("INSERT INTO veritamap_tests (map_id, analyte, last_cal_ver) VALUES (?, ?, ?)").run(79, "Vaginal Panel", null);

{
  const r = applyMapSignoffWriteback(db, 42, "Vaginal Panel", "last_cal_ver", "2026-07-29");
  const row = db.prepare("SELECT last_cal_ver FROM veritamap_tests WHERE map_id=79 AND analyte='Vaginal Panel'").get() as any;
  check("exact match updates map + updated=1", r.linked && r.updated === 1 && !r.warning && row.last_cal_ver === "2026-07-29", JSON.stringify({ r, row }));
}
{
  const r = applyMapSignoffWriteback(db, 42, "Vaginal panel", "last_cal_ver", "2026-07-29"); // lowercase p -> mismatch
  check("name mismatch -> updated=0 + warning (was silent before)", r.linked && r.updated === 0 && !!r.warning, JSON.stringify(r));
}
{
  const r = applyMapSignoffWriteback(db, 42, "Vaginal Panel", "bogus_field", "2026-07-29");
  check("non-allowlisted field -> warning, no write", r.updated === 0 && !!r.warning, JSON.stringify(r));
}
{
  db.prepare("INSERT INTO users (id, lab_id) VALUES (?, ?)").run(99, 555);
  const r = applyMapSignoffWriteback(db, 99, "Vaginal Panel", "last_cal_ver", "2026-07-29");
  check("no map for lab -> warning", r.updated === 0 && !!r.warning, JSON.stringify(r));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
