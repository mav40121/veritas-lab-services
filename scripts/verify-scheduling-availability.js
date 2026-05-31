// Receipt for the scheduling availability calculation.
//
// Exercises computeAvailability() against a hardcoded rule/blackout/booking
// set and asserts expected slot lists. Math source is
// server/scheduling.ts; this file re-implements the same logic so the
// receipt is self-contained.
//
// Run:
//   node scripts/verify-scheduling-availability.js
// Exits non-zero on any failure.

// Pure copy of the production logic (kept in sync with server/scheduling.ts).
function pad(n) { return n < 10 ? "0" + n : String(n); }
function timeToMinutes(hhmm) { const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10)); return h * 60 + m; }
function minutesToTime(minutes) { const h = Math.floor(minutes / 60); const m = minutes % 60; return `${pad(h)}:${pad(m)}`; }
function overlaps(aS, aE, bS, bE) { return aS < bE && bS < aE; }
function dateAddDays(s, n) { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dayOfWeekFor(s) { return new Date(s + "T12:00:00Z").getUTCDay(); }

function computeAvailability(input) {
  const { fromDate, toDate, durationMinutes, rules, blackouts, bookings,
          minLeadHours = 0, nowOperator, busyTimes = [] } = input;
  const out = [];
  const rulesByDow = new Map();
  for (const r of rules) {
    if (!r.active) continue;
    const list = rulesByDow.get(r.day_of_week) ?? [];
    list.push(r); rulesByDow.set(r.day_of_week, list);
  }
  const blackoutsByDate = new Map();
  for (const b of blackouts) {
    const list = blackoutsByDate.get(b.blackout_date) ?? [];
    list.push(b); blackoutsByDate.set(b.blackout_date, list);
  }
  const bookingsByDate = new Map();
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const list = bookingsByDate.get(b.slot_date) ?? [];
    list.push(b); bookingsByDate.set(b.slot_date, list);
  }
  const busyByDate = new Map();
  for (const b of busyTimes) {
    const list = busyByDate.get(b.date) ?? [];
    list.push({ start: b.start, end: b.end });
    busyByDate.set(b.date, list);
  }
  let cursor = fromDate, guard = 0;
  while (cursor <= toDate && guard < 400) {
    guard += 1;
    const dow = dayOfWeekFor(cursor);
    const dayRules = rulesByDow.get(dow) ?? [];
    if (dayRules.length === 0) { cursor = dateAddDays(cursor, 1); continue; }
    const dayBlackouts = blackoutsByDate.get(cursor) ?? [];
    const wholeDay = dayBlackouts.some((b) => !b.start_time && !b.end_time);
    if (wholeDay) { cursor = dateAddDays(cursor, 1); continue; }
    const partialB = dayBlackouts.filter((b) => b.start_time && b.end_time).map((b) => ({ start: timeToMinutes(b.start_time), end: timeToMinutes(b.end_time) }));
    const dayBk = (bookingsByDate.get(cursor) ?? []).map((b) => ({ start: timeToMinutes(b.slot_start), end: timeToMinutes(b.slot_end) }));
    const dayBusy = (busyByDate.get(cursor) ?? []).map((b) => ({ start: timeToMinutes(b.start), end: timeToMinutes(b.end) }));
    for (const r of dayRules) {
      const rs = timeToMinutes(r.start_time), re = timeToMinutes(r.end_time);
      for (let m = rs; m + durationMinutes <= re; m += durationMinutes) {
        const ss = m, se = m + durationMinutes;
        if (partialB.some((b) => overlaps(ss, se, b.start, b.end))) continue;
        if (dayBk.some((b) => overlaps(ss, se, b.start, b.end))) continue;
        if (dayBusy.some((b) => overlaps(ss, se, b.start, b.end))) continue;
        if (nowOperator && cursor === nowOperator.date && ss < nowOperator.minute + minLeadHours * 60) continue;
        if (nowOperator && cursor < nowOperator.date) continue;
        out.push({ date: cursor, start_time: minutesToTime(ss), end_time: minutesToTime(se), duration_minutes: durationMinutes });
      }
    }
    cursor = dateAddDays(cursor, 1);
  }
  return out;
}

// ───── cases ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function assertEq(name, actual, expected) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got === want) { console.log(`PASS ${name}`); pass += 1; }
  else { console.error(`FAIL ${name}\n  got:  ${got}\n  want: ${want}`); fail += 1; }
}

// dateAddDays(2026-06-02, 0) is a Tuesday. Use Mon=2026-06-01 .. Sun=2026-06-07.
const rules = [
  { id: 1, event_type_id: 1, day_of_week: 2, start_time: "14:00", end_time: "16:00", active: 1 }, // Tue
  { id: 2, event_type_id: 1, day_of_week: 3, start_time: "14:00", end_time: "15:00", active: 1 }, // Wed
];

// Case 1: Tuesday Jun 2 with no conflicts -> 14:00, 14:30, 15:00, 15:30
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules, blackouts: [], bookings: [], minLeadHours: 0,
  });
  assertEq("clean Tue gives 4 slots", slots.map((s) => s.start_time), ["14:00", "14:30", "15:00", "15:30"]);
}

// Case 2: existing booking at 14:30 -> 14:00, 15:00, 15:30 (14:30 dropped)
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules, blackouts: [],
    bookings: [{ slot_date: "2026-06-02", slot_start: "14:30", slot_end: "15:00", status: "confirmed" }],
    minLeadHours: 0,
  });
  assertEq("existing booking removes its slot", slots.map((s) => s.start_time), ["14:00", "15:00", "15:30"]);
}

// Case 3: partial blackout 15:00-15:30 -> drops 15:00
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules,
    blackouts: [{ id: 1, blackout_date: "2026-06-02", start_time: "15:00", end_time: "15:30", reason: null }],
    bookings: [], minLeadHours: 0,
  });
  assertEq("partial blackout removes overlapping slot", slots.map((s) => s.start_time), ["14:00", "14:30", "15:30"]);
}

// Case 4: whole-day blackout -> zero slots
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules,
    blackouts: [{ id: 1, blackout_date: "2026-06-02", start_time: null, end_time: null, reason: "PTO" }],
    bookings: [], minLeadHours: 0,
  });
  assertEq("whole-day blackout removes all slots", slots, []);
}

// Case 5: no rule for the dow -> zero slots (Monday Jun 1)
{
  const slots = computeAvailability({
    fromDate: "2026-06-01", toDate: "2026-06-01", durationMinutes: 30,
    rules, blackouts: [], bookings: [], minLeadHours: 0,
  });
  assertEq("Monday has no rule -> zero slots", slots, []);
}

// Case 6: cancelled booking does NOT block the slot
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules, blackouts: [],
    bookings: [{ slot_date: "2026-06-02", slot_start: "14:30", slot_end: "15:00", status: "cancelled" }],
    minLeadHours: 0,
  });
  assertEq("cancelled booking does not block", slots.map((s) => s.start_time), ["14:00", "14:30", "15:00", "15:30"]);
}

// Case 7: lead-time gate. nowOperator is Tuesday 13:00, lead=24h -> all
// Tuesday slots filtered, Wednesday 14:00 + 14:30 also filtered (within
// 24h of "now"). Wednesday after 13:00 the next day = 13:00 + 24h
// boundary; both 14:00 and 14:30 fall after the 24h mark so they stay.
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-03", durationMinutes: 30,
    rules, blackouts: [], bookings: [], minLeadHours: 24,
    nowOperator: { date: "2026-06-02", minute: 13 * 60 },
  });
  // Tuesday: 13:00 + 24*60 = 13:00 next day. All Tuesday slots earlier
  // than that. None survive.
  // Wednesday rule is 14:00-15:00; 14:00 > 13:00 next-day boundary so both 14:00 and 14:30 survive.
  assertEq(
    "24h lead time drops Tue slots and keeps Wed slots",
    slots.map((s) => s.date + " " + s.start_time),
    ["2026-06-03 14:00", "2026-06-03 14:30"]
  );
}

// Case 8: Phase 2 stub. busyTimes from Google Calendar block 14:00 slot.
{
  const slots = computeAvailability({
    fromDate: "2026-06-02", toDate: "2026-06-02", durationMinutes: 30,
    rules, blackouts: [], bookings: [], minLeadHours: 0,
    busyTimes: [{ date: "2026-06-02", start: "14:00", end: "14:45" }],
  });
  // 14:00-14:30 overlaps busy. 14:30-15:00 also overlaps (14:45 still busy).
  // 15:00 and 15:30 survive.
  assertEq("busy times subtract from slots", slots.map((s) => s.start_time), ["15:00", "15:30"]);
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
