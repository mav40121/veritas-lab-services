// scripts/verify-ceu.mts
//
// Receipt for Build #6 (VeritaCEU). The ceu-summary endpoint totals an
// employee's ce_credit credits inside a trailing rolling cycle (default ASCP
// CMP: 36 points / 36 months) and compares against the required total. This
// runs the EXACT selection + attribution + cycle math from routes.ts against an
// in-memory DB and asserts the totals, the activity_date vs created_at
// attribution fallback, the in/out-of-cycle boundary, and the pct/remaining/met
// derivations. It also proves non-ce_credit rows and null-credit rows are
// ignored, and that the required/cycleMonths overrides behave.
//
// Run: npx tsx scripts/verify-ceu.mts   (exits non-zero on fail)

import Database from "better-sqlite3";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

// The endpoint's math, extracted verbatim so this script IS the receipt.
function ceuSummary(
  db: any,
  employeeId: number,
  now: Date,
  required = 36,
  cycleMonths = 36,
) {
  // UTC start-of-day so the boundary matches the UTC-parsed activity dates
  // regardless of the server's timezone.
  const cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - cycleMonths, now.getUTCDate()));
  const cycleStartIso = cycleStart.toISOString();
  const rows = db.prepare(
    `SELECT id, title, url, credits, activity_date, created_at
     FROM staff_employee_documents
     WHERE employee_id = ? AND doc_type = 'ce_credit'
     ORDER BY COALESCE(activity_date, created_at) DESC`
  ).all(employeeId) as any[];
  let earned = 0;
  const entries: any[] = [];
  for (const r of rows) {
    const when = r.activity_date || r.created_at;
    const whenIso = /^\d{4}-\d{2}-\d{2}$/.test(String(when))
      ? new Date(`${when}T00:00:00.000Z`).toISOString()
      : new Date(when).toISOString();
    const inCycle = whenIso >= cycleStartIso;
    const credits = typeof r.credits === "number" ? r.credits : 0;
    if (inCycle) earned += credits;
    entries.push({ id: r.id, credits, inCycle });
  }
  earned = Math.round(earned * 100) / 100;
  const remaining = Math.max(0, Math.round((required - earned) * 100) / 100);
  const pct = required > 0 ? Math.min(100, Math.round((earned / required) * 100)) : 0;
  const met = earned >= required;
  return { required, cycleMonths, cycleStart: cycleStartIso.slice(0, 10), earned, remaining, pct, met, entryCount: rows.length, inCycleCount: entries.filter(e => e.inCycle).length, entries };
}

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE staff_employee_documents (
    id INTEGER PRIMARY KEY,
    employee_id INTEGER,
    doc_type TEXT,
    title TEXT,
    url TEXT,
    storage_provider TEXT,
    expiration_date TEXT,
    created_at TEXT,
    created_by_user_id INTEGER,
    credits REAL,
    activity_date TEXT
  );
`);

// Anchor "now" so the boundaries are deterministic.
const NOW = new Date("2026-09-25T12:00:00.000Z");
// 36-month cycle start = 2023-09-25.
const ins = db.prepare(
  `INSERT INTO staff_employee_documents (id, employee_id, doc_type, title, url, credits, activity_date, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
// Employee 1 rows:
ins.run(1, 1, "ce_credit", "In-cycle A", "https://x/1", 10, "2026-01-15", "2026-01-16T00:00:00Z");   // in
ins.run(2, 1, "ce_credit", "In-cycle B", "https://x/2", 5.5, "2025-06-01", "2025-06-02T00:00:00Z");  // in
ins.run(3, 1, "ce_credit", "Boundary in", "https://x/3", 3, "2023-09-25", "2023-09-25T00:00:00Z");   // in (== cycleStart)
ins.run(4, 1, "ce_credit", "Out-of-cycle", "https://x/4", 20, "2020-01-01", "2020-01-02T00:00:00Z");  // out
ins.run(5, 1, "ce_credit", "No-date (uses created_at, in)", "https://x/5", 2, null, "2026-03-01T00:00:00Z"); // in via created_at
ins.run(6, 1, "ce_credit", "Null credits ignored value", "https://x/6", null, "2026-02-01", "2026-02-02T00:00:00Z"); // in but 0 credits
ins.run(7, 1, "license", "Not a CE row", "https://x/7", 99, "2026-01-01", "2026-01-01T00:00:00Z");     // wrong doc_type, ignored
// Employee 2: nothing.

const s1 = ceuSummary(db, 1, NOW);
// Earned = 10 + 5.5 + 3 + 2 + 0 (null credits) = 20.5. Out-of-cycle 20 excluded. License row excluded.
check("earned sums in-cycle ce_credit only", s1.earned === 20.5, `earned=${s1.earned}`);
check("boundary row (== cycleStart) counts", s1.entries.find(e => e.id === 3)?.inCycle === true);
check("pre-cycle row excluded", s1.entries.find(e => e.id === 4)?.inCycle === false);
check("null activity_date falls back to created_at", s1.entries.find(e => e.id === 5)?.inCycle === true);
check("null credits contributes 0, not NaN", Number.isFinite(s1.earned) && s1.entries.find(e => e.id === 6)?.credits === 0);
check("license doc_type excluded entirely", s1.entryCount === 6, `entryCount=${s1.entryCount}`);
check("cycleStart is 36 months back", s1.cycleStart === "2023-09-25", s1.cycleStart);
check("remaining = required - earned", s1.remaining === Math.round((36 - 20.5) * 100) / 100, `remaining=${s1.remaining}`);
check("pct = round(earned/required*100)", s1.pct === Math.round((20.5 / 36) * 100), `pct=${s1.pct}`);
check("not met at 20.5/36", s1.met === false);
check("inCycleCount excludes the one pre-cycle row", s1.inCycleCount === 5, `inCycleCount=${s1.inCycleCount}`);

// Employee 2: empty -> zeros, not met, pct 0, remaining full.
const s2 = ceuSummary(db, 2, NOW);
check("empty employee earns 0", s2.earned === 0 && s2.entryCount === 0);
check("empty employee remaining = required", s2.remaining === 36);
check("empty employee pct 0 and not met", s2.pct === 0 && s2.met === false);

// Met case: add a big row for employee 3.
ins.run(8, 3, "ce_credit", "Big", "https://x/8", 40, "2026-05-01", "2026-05-02T00:00:00Z");
const s3 = ceuSummary(db, 3, NOW);
check("met when earned >= required", s3.met === true && s3.earned === 40);
check("pct clamps to 100 when over", s3.pct === 100, `pct=${s3.pct}`);
check("remaining clamps to 0 when over", s3.remaining === 0, `remaining=${s3.remaining}`);

// Override: shorter 12-month cycle for employee 1 -> only 2026-dated rows count.
const s1short = ceuSummary(db, 1, NOW, 36, 12);
// cycleStart = 2025-09-25. In: id1(2026-01,10), id5(2026-03 via created_at,2), id6(2026-02,0). id2 is 2025-06 -> out.
check("12-month override moves the window", s1short.cycleStart === "2025-09-25", s1short.cycleStart);
check("12-month override re-totals correctly", s1short.earned === 12, `earned=${s1short.earned}`);

// Override: custom required target.
const s1req = ceuSummary(db, 1, NOW, 20, 36);
check("custom required target changes met", s1req.required === 20 && s1req.met === true && s1req.earned === 20.5);

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
