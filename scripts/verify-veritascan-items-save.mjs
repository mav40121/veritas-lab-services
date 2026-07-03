// scripts/verify-veritascan-items-save.mjs
// Reproduces the VeritaScan lab-scoped save 500 (NOT NULL: veritascan_items.item_id)
// and proves the fix. The client sends camelCase { itemId, dueDate }; the lab-scoped
// bulk PUT (routes.ts) read r.item_id (snake_case) -> undefined -> NOT NULL 500, while
// its legacy twin already accepted both. This mirrors the fixed loop and asserts:
// camelCase saves, snake_case still works, a null-id row is skipped (no batch abort),
// and re-saves upsert. Run: node scripts/verify-veritascan-items-save.mjs
import Database from "better-sqlite3";

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

const db = new Database(":memory:");
db.exec(`CREATE TABLE veritascan_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Not Assessed',
  notes TEXT, owner TEXT, due_date TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(scan_id, item_id)
)`);
const stmt = db.prepare(`
  INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scan_id, item_id) DO UPDATE SET
    status=excluded.status, notes=excluded.notes, owner=excluded.owner,
    due_date=excluded.due_date, updated_at=excluded.updated_at
`);

// Exact mirror of the fixed lab-scoped handler loop.
function save(scanId, rows) {
  const now = new Date(0).toISOString();
  const tx = db.transaction((rs) => {
    for (const r of rs) {
      const itemId = r.item_id ?? r.itemId;
      if (itemId == null) continue;
      const dueDate = r.due_date ?? r.dueDate ?? null;
      stmt.run(scanId, itemId, r.status || "Not Assessed", r.notes || null, r.owner || null, dueDate, now);
    }
  });
  tx(rows);
}

// Sanity: the OLD behavior (reading r.item_id off a camelCase payload) threw.
let oldThrew = false;
try { db.prepare("INSERT INTO veritascan_items (scan_id,item_id,updated_at) VALUES (?,?,?)").run(7, undefined, "x"); }
catch { oldThrew = true; }
check("repro: inserting undefined item_id throws NOT NULL (the old bug)", oldThrew);

// 1. camelCase itemId (what the client actually sends) now saves.
save(7, [{ itemId: 5, status: "Compliant", dueDate: "2026-08-01" }]);
const a = db.prepare("SELECT item_id,status,due_date FROM veritascan_items WHERE scan_id=7 AND item_id=5").get();
check("camelCase itemId saves + due_date persists", a && a.item_id === 5 && a.status === "Compliant" && a.due_date === "2026-08-01");

// 2. snake_case still works (legacy shape).
save(7, [{ item_id: 6, status: "Gap", due_date: "2026-09-01" }]);
const b = db.prepare("SELECT item_id,due_date FROM veritascan_items WHERE scan_id=7 AND item_id=6").get();
check("snake_case item_id still works", b && b.item_id === 6 && b.due_date === "2026-09-01");

// 3. a null-id row in a batch is skipped; valid rows in the same batch still save; no throw.
let threw = false;
try { save(7, [{ itemId: 8, status: "Compliant" }, { status: "N/A" }, { itemId: 9 }]); } catch { threw = true; }
check("batch with a null-id row does not throw", !threw);
check("valid rows in that batch still saved",
  !!db.prepare("SELECT 1 FROM veritascan_items WHERE scan_id=7 AND item_id=8").get() &&
  !!db.prepare("SELECT 1 FROM veritascan_items WHERE scan_id=7 AND item_id=9").get());

// 4. upsert: re-saving the same item updates in place, no duplicate.
save(7, [{ itemId: 5, status: "N/A" }]);
const c = db.prepare("SELECT COUNT(*) n FROM veritascan_items WHERE scan_id=7 AND item_id=5").get();
const s = db.prepare("SELECT status FROM veritascan_items WHERE scan_id=7 AND item_id=5").get();
check("upsert updates in place (no duplicate row)", c.n === 1 && s.status === "N/A");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
