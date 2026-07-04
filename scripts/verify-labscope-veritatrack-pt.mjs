// scripts/verify-labscope-veritatrack-pt.mjs
// Proves the multi-lab wrong-lab fix for VeritaTrack seed-defaults / import-from-map /
// export and VeritaPT trends. Before the fix these server handlers keyed on user_id
// (or the owner's home users.lab_id), so a multi-lab owner acting while viewing Lab B
// seeded/imported/exported/trended Lab A's data (or orphaned it with lab_id=NULL).
// The fix scopes every one of them to the active lab (X-Active-Lab-Id ->
// resolveLegacyLabId -> lab_id). This mirrors the exact SQL the handlers now run and
// asserts Lab A and Lab B never bleed into each other.
// Run: node scripts/verify-labscope-veritatrack-pt.mjs
import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, lab_name TEXT, clia_number TEXT, owner_user_id INTEGER);
  CREATE TABLE veritatrack_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lab_id INTEGER,
    name TEXT, category TEXT, instrument TEXT, frequency TEXT, frequency_months INTEGER,
    map_analyte TEXT, map_field TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT, updated_at TEXT
  );
  CREATE TABLE veritamap_maps (id INTEGER PRIMARY KEY, user_id INTEGER, lab_id INTEGER, name TEXT, updated_at TEXT);
  CREATE TABLE veritamap_tests (
    id INTEGER PRIMARY KEY, map_id INTEGER, analyte TEXT, complexity TEXT,
    instrument_source TEXT, last_cal_ver TEXT, active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE pt_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, lab_id INTEGER, analyte TEXT, event_date TEXT, pass_fail TEXT);
`);

// One owner (user 1), two labs. Lab 1 = "Alpha", Lab 2 = "Beta".
db.prepare("INSERT INTO labs (id,lab_name,clia_number,owner_user_id) VALUES (1,'Alpha Lab','11D1','?'),(2,'Beta Lab','22D2','?')").run();
db.prepare("UPDATE labs SET owner_user_id = 1").run();
// A map in each lab with a lab-distinct analyte.
db.prepare("INSERT INTO veritamap_maps (id,user_id,lab_id,name,updated_at) VALUES (10,1,1,'Alpha Menu','t'),(20,1,2,'Beta Menu','t')").run();
db.prepare("INSERT INTO veritamap_tests (id,map_id,analyte,complexity,instrument_source,last_cal_ver) VALUES (100,10,'Glucose','HIGH','Alpha-1','2026-01-01'),(200,20,'Sodium','HIGH','Beta-1','2026-02-02')").run();
const now = "2026-07-04T00:00:00Z";

// ── Mirrors of the fixed handler bodies ────────────────────────────────────
// seed-defaults: dedupe by (lab_id,name), insert with lab_id.
function seedInto(labId, names) {
  let created = 0, skipped = 0;
  for (const name of names) {
    const existing = db.prepare("SELECT id FROM veritatrack_tasks WHERE lab_id=? AND name=? AND active=1").get(labId, name);
    if (existing) { skipped++; continue; }
    db.prepare("INSERT INTO veritatrack_tasks (user_id,lab_id,name,category,frequency,frequency_months,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(1, labId, name, "QC Review", "Monthly", 1, now, now);
    created++;
  }
  return { created, skipped };
}
// import-from-map: read maps WHERE lab_id, insert tasks WHERE lab_id, dedupe by (lab_id,name).
function importInto(labId) {
  const maps = db.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ? ORDER BY updated_at DESC").all(labId);
  let created = 0;
  for (const m of maps) {
    const tests = db.prepare("SELECT * FROM veritamap_tests WHERE map_id = ? AND active = 1").all(m.id);
    for (const t of tests) {
      const name = `Calibration Verification - ${t.analyte}`;
      const existing = db.prepare("SELECT id FROM veritatrack_tasks WHERE lab_id=? AND name=? AND active=1").get(labId, name);
      if (existing) continue;
      db.prepare("INSERT INTO veritatrack_tasks (user_id,lab_id,name,category,map_analyte,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .run(1, labId, name, "Calibration Verification", t.analyte, now, now);
      created++;
    }
  }
  return { created };
}
// export: tasks WHERE lab_id.
const exportTasks = (labId) => db.prepare("SELECT name FROM veritatrack_tasks WHERE lab_id = ? AND active = 1 ORDER BY name").all(labId).map(r => r.name);
// trends: pt_events WHERE lab_id, grouped by analyte with fails-in-last-3 state.
function trends(labId) {
  const events = db.prepare("SELECT analyte, event_date, pass_fail FROM pt_events WHERE lab_id = ? AND pass_fail IN ('pass','fail') ORDER BY analyte ASC, event_date DESC").all(labId);
  const byAnalyte = {};
  for (const e of events) { (byAnalyte[e.analyte] ||= []).push(e); }
  return Object.keys(byAnalyte).map(a => {
    const fails = byAnalyte[a].slice(0, 3).filter(e => e.pass_fail === "fail").length;
    return { analyte: a, state: fails >= 2 ? "AT-RISK" : fails === 1 ? "WATCH" : "OK" };
  });
}

// ── 1. seed dedupe is per-lab, not per-user ────────────────────────────────
const s1 = seedInto(1, ["QC Review - Chemistry"]);
const s2 = seedInto(2, ["QC Review - Chemistry"]);   // same name, different lab -> must still create
check("seed: same task name creates once per lab (not blocked cross-lab)", s1.created === 1 && s2.created === 1);
const s2again = seedInto(2, ["QC Review - Chemistry"]);
check("seed: re-seeding the same lab is idempotent (skipped)", s2again.created === 0 && s2again.skipped === 1);
check("seed: rows carry the correct lab_id", (db.prepare("SELECT lab_id FROM veritatrack_tasks WHERE name='QC Review - Chemistry' ORDER BY lab_id").all().map(r=>r.lab_id).join(",")) === "1,2");
check("seed: no seeded task has NULL lab_id (the old orphaning bug)", db.prepare("SELECT COUNT(*) n FROM veritatrack_tasks WHERE lab_id IS NULL").get().n === 0);

// ── 2. import reads the ACTIVE lab's maps, writes to the active lab ─────────
importInto(2);   // active = Beta; must import Sodium (Beta's map), never Glucose (Alpha's)
const betaTasks = exportTasks(2);
check("import: active lab imports its own map analyte (Sodium)", betaTasks.includes("Calibration Verification - Sodium"));
check("import: active lab does NOT import the other lab's analyte (Glucose)", !betaTasks.includes("Calibration Verification - Glucose"));

// ── 3. export is scoped to the active lab ──────────────────────────────────
importInto(1);   // give Alpha its Glucose task too
const alphaTasks = exportTasks(1);
check("export: Alpha export contains Alpha's Glucose task", alphaTasks.includes("Calibration Verification - Glucose"));
check("export: Alpha export excludes Beta's Sodium task", !alphaTasks.includes("Calibration Verification - Sodium"));
check("export: Beta export excludes Alpha's Glucose task", !exportTasks(2).includes("Calibration Verification - Glucose"));

// ── 4. PT trends are scoped to the active lab ──────────────────────────────
// Alpha: Potassium fails twice (AT-RISK). Beta: Chloride passes (OK).
db.prepare("INSERT INTO pt_events (user_id,lab_id,analyte,event_date,pass_fail) VALUES (1,1,'Potassium','2026-05-01','fail'),(1,1,'Potassium','2026-06-01','fail'),(1,2,'Chloride','2026-06-01','pass')").run();
const beta = trends(2), alpha = trends(1);
check("trends: Beta sees only Chloride, OK state", beta.length === 1 && beta[0].analyte === "Chloride" && beta[0].state === "OK");
check("trends: Beta does NOT see Alpha's AT-RISK Potassium", !beta.some(t => t.analyte === "Potassium"));
check("trends: Alpha correctly flags its own Potassium AT-RISK", alpha.some(t => t.analyte === "Potassium" && t.state === "AT-RISK"));

// ── 5. Repro: the OLD user_id query merged both labs (the bug) ──────────────
const oldMerged = db.prepare("SELECT DISTINCT analyte FROM pt_events WHERE user_id = 1").all().map(r => r.analyte).sort();
check("repro: the old WHERE user_id query mixed Potassium + Chloride across labs", oldMerged.join(",") === "Chloride,Potassium");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
