// scripts/verify-equipment-maintenance.mjs
//
// Receipt for MLC-1 (equipment / instrument maintenance). Exercises the two
// pieces of branching logic in the module: the next-due status classifier and
// the next-due auto-computation from a PM interval. Mirrors server/routes.ts.
//
//   node scripts/verify-equipment-maintenance.mjs
let fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}${cond ? "" : "  -- " + detail}`); if (!cond) fails++; };

const TODAY = "2026-08-11";
// Mirror of equipmentStatus() in routes.ts (today pinned for determinism).
function equipmentStatus(nextDue, today = TODAY) {
  if (!nextDue) return "none";
  const days = Math.round((Date.parse(nextDue + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 30) return "due_soon";
  return "ok";
}
// Mirror of the next-due computation in POST /equipment/:id/events.
function computeNextDue(eventDate, intervalDays) {
  if (!intervalDays) return null;
  const d = new Date(eventDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(intervalDays));
  return d.toISOString().slice(0, 10);
}

// ── status classifier ───────────────────────────────────────────────────────
ok("no next-due -> 'none'", equipmentStatus(null) === "none");
ok("past date -> 'overdue'", equipmentStatus("2026-08-01") === "overdue");
ok("today (0 days) -> 'due_soon'", equipmentStatus("2026-08-11") === "due_soon");
ok("+30 days (boundary) -> 'due_soon'", equipmentStatus("2026-09-10") === "due_soon");
ok("+31 days -> 'ok'", equipmentStatus("2026-09-11") === "ok");
ok("far future -> 'ok'", equipmentStatus("2027-08-11") === "ok");

// ── next-due auto-computation ───────────────────────────────────────────────
ok("annual (365d) calibration on 2026-08-11 -> 2027-08-11", computeNextDue("2026-08-11", 365) === "2027-08-11");
ok("90-day PM on 2026-08-11 -> 2026-11-09", computeNextDue("2026-08-11", 90) === "2026-11-09");
ok("no interval -> null (relies on explicit next-due)", computeNextDue("2026-08-11", null) === null);

// ── round-trip: log annual calibration today, instrument is 'ok' after ───────
const nd = computeNextDue(TODAY, 365);
ok("after logging annual calibration today, status is 'ok'", equipmentStatus(nd) === "ok", `nextDue=${nd}`);

console.log(fails === 0 ? "\n=== EQUIPMENT MAINTENANCE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
