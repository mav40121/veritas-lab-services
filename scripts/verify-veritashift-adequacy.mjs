// scripts/verify-veritashift-adequacy.mjs
//
// Receipt for Wave D3 (2026-06-12): VeritaShift staffing-adequacy attestation.
// Replicates the staffing_studies migration + the attest-adequacy logic over an
// in-memory DB and asserts:
//
//   1. migration adds the 5 adequacy columns, idempotent
//   2. an "adequate" determination stamps determination/by/title/at
//   3. a "gap_identified" determination requires a note
//   4. an invalid determination is rejected
//   5. missing attested_by is rejected
//   6. clear wipes the attestation back to null
//
// Run: node scripts/verify-veritashift-adequacy.mjs

import Database from "better-sqlite3";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

const db = new Database(":memory:");
db.exec(`CREATE TABLE staffing_studies (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT, status TEXT, updated_at TEXT);`);
db.prepare("INSERT INTO staffing_studies (id, account_id, name, status) VALUES (1, 7, 'Core Lab Q2', 'active')").run();

function migrate() {
  const cols = db.prepare("PRAGMA table_info(staffing_studies)").all().map(c => c.name);
  for (const [col, ddl] of [
    ["adequacy_determination", "ALTER TABLE staffing_studies ADD COLUMN adequacy_determination TEXT"],
    ["adequacy_note", "ALTER TABLE staffing_studies ADD COLUMN adequacy_note TEXT"],
    ["adequacy_attested_at", "ALTER TABLE staffing_studies ADD COLUMN adequacy_attested_at TEXT"],
    ["adequacy_attested_by", "ALTER TABLE staffing_studies ADD COLUMN adequacy_attested_by TEXT"],
    ["adequacy_attested_title", "ALTER TABLE staffing_studies ADD COLUMN adequacy_attested_title TEXT"],
  ]) { if (!cols.includes(col)) { try { db.exec(ddl); } catch {} } }
}
migrate(); migrate();
const cols = db.prepare("PRAGMA table_info(staffing_studies)").all().map(c => c.name);
check("1. migration adds 5 adequacy columns, idempotent",
  ["adequacy_determination","adequacy_note","adequacy_attested_at","adequacy_attested_by","adequacy_attested_title"].every(c => cols.includes(c)) &&
  cols.filter(c => c === "adequacy_determination").length === 1);

// Mirror of the server handler.
function attest(id, body) {
  const s = db.prepare("SELECT * FROM staffing_studies WHERE id = ? AND account_id = 7").get(id);
  if (!s) return { status: 404 };
  if (body.clear) {
    db.prepare("UPDATE staffing_studies SET adequacy_determination=NULL, adequacy_note=NULL, adequacy_attested_at=NULL, adequacy_attested_by=NULL, adequacy_attested_title=NULL WHERE id=?").run(id);
    return { status: 200 };
  }
  if (!["adequate", "gap_identified"].includes(body.determination)) return { status: 400, error: "bad determination" };
  if (!body.attested_by || !String(body.attested_by).trim()) return { status: 400, error: "attested_by required" };
  if (body.determination === "gap_identified" && (!body.note || !String(body.note).trim())) return { status: 400, error: "note required for gap" };
  db.prepare("UPDATE staffing_studies SET adequacy_determination=?, adequacy_note=?, adequacy_attested_at='2026-06-12T00:00:00Z', adequacy_attested_by=?, adequacy_attested_title=? WHERE id=?")
    .run(body.determination, body.note ?? null, String(body.attested_by).trim(), body.attested_title ?? null, id);
  return { status: 200 };
}

const a = attest(1, { determination: "adequate", attested_by: "M. Veri", attested_title: "Laboratory Director" });
const row1 = db.prepare("SELECT * FROM staffing_studies WHERE id = 1").get();
check("2a. adequate determination accepted", a.status === 200 && row1.adequacy_determination === "adequate");
check("2b. attestation stamps by/title/at", row1.adequacy_attested_by === "M. Veri" && row1.adequacy_attested_title === "Laboratory Director" && !!row1.adequacy_attested_at);

check("3a. gap without note rejected", attest(1, { determination: "gap_identified", attested_by: "M. Veri" }).status === 400);
const g = attest(1, { determination: "gap_identified", attested_by: "M. Veri", note: "Evening shift short 0.5 FTE; cross-train two day techs by Q3." });
check("3b. gap with note accepted", g.status === 200 && db.prepare("SELECT adequacy_determination FROM staffing_studies WHERE id=1").get().adequacy_determination === "gap_identified");

check("4. invalid determination rejected", attest(1, { determination: "maybe", attested_by: "X" }).status === 400);
check("5. missing attested_by rejected", attest(1, { determination: "adequate", attested_by: "  " }).status === 400);

attest(1, { clear: true });
const cleared = db.prepare("SELECT * FROM staffing_studies WHERE id = 1").get();
check("6. clear wipes the attestation", cleared.adequacy_determination === null && cleared.adequacy_attested_by === null && cleared.adequacy_attested_at === null);

console.log("");
if (failures) { console.log(`${failures} FAILURE(S)`); process.exit(1); }
console.log("ALL PASS (8/8): Wave D3 VeritaShift adequacy migration, determination capture, gap-note gate, validation, and clear verified.");
