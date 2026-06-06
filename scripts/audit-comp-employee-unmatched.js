#!/usr/bin/env node
// audit-comp-employee-unmatched.js
//
// Phase B2 of the employee-table unification (2026-06-06). Lists
// competency_employees rows whose staff_employee_id FK is still null after
// the boot backfills (PR #566 forward + Phase B2 reverse). These are the
// rows a lab director needs to address manually before Phase B3 can drop
// the legacy read sites.
//
// Read-only. Hits a prod admin endpoint to enumerate the rows; the
// endpoint requires ADMIN_SECRET.
//
// Run: BASE=https://www.veritaslabservices.com ADMIN_SECRET=... node scripts/audit-comp-employee-unmatched.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const SECRET = process.env.ADMIN_SECRET;
if (!SECRET) { console.error("ERROR: ADMIN_SECRET env var required"); process.exit(2); }

(async () => {
  const r = await fetch(`${BASE}/api/admin/competency-employees/unmatched?secret=${encodeURIComponent(SECRET)}`);
  if (!r.ok) {
    console.error(`ERROR: HTTP ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  const data = await r.json();
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (rows.length === 0) {
    console.log("No unmatched competency_employees rows. Phase B3 can proceed.");
    process.exit(0);
  }
  console.log(`${rows.length} unmatched competency_employees row(s):`);
  console.log("");
  const byLab = new Map();
  for (const r of rows) {
    const key = String(r.lab_id ?? "no-lab");
    if (!byLab.has(key)) byLab.set(key, []);
    byLab.get(key).push(r);
  }
  for (const [labId, labRows] of byLab.entries()) {
    console.log(`Lab ${labId}: ${labRows.length} row(s)`);
    for (const r of labRows) {
      console.log(`  - id=${r.id}, name="${r.name}", status=${r.status}, hire_date=${r.hire_date || "-"}`);
    }
    console.log("");
  }
  console.log("Suggested actions per row:");
  console.log("  (a) Add the missing staff_employees record in VeritaStaff; the next read auto-resolves the FK via name match.");
  console.log("  (b) If the row is a duplicate or no longer valid, delete it directly in the DB (after confirming no competency_assessments reference it).");
})();
