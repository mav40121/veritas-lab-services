// server/scheduling.ts
//
// Pure-ish availability calculation for the scoping-call booking flow
// (PARKING_LOT #29 follow-on, services-page CTA fix).
//
// Inputs:
//   - The event type (drives slot duration)
//   - Availability rules (day-of-week + time range, in operator tz)
//   - Existing bookings (operator tz)
//   - Blackouts (whole day or partial range, operator tz)
//   - A date range to compute availability for
//
// Output:
//   - Array of available slots: { date, start_time, end_time, duration }
//
// Operator tz: America/New_York (operator is in MA / Eastern). Times stored
// throughout are HH:MM strings in that tz; the client renders in the browser
// tz at display time. Eastern observes DST, so the "now" computation and the
// ICS VTIMEZONE are DST-aware (unlike the prior fixed-offset Arizona tz).

export const OPERATOR_TZ = "America/New_York";

export interface AvailabilityRule {
  id: number;
  event_type_id: number;
  day_of_week: number; // 0 = Sunday, 6 = Saturday
  start_time: string;  // "14:00"
  end_time: string;    // "16:00"
  active: number;
}

export interface Blackout {
  id: number;
  blackout_date: string;     // "YYYY-MM-DD"
  start_time: string | null; // null = whole day
  end_time: string | null;
  reason: string | null;
}

export interface Booking {
  slot_date: string;   // "YYYY-MM-DD"
  slot_start: string;  // "14:00"
  slot_end: string;    // "14:30"
  status: string;      // ignore non-"confirmed" rows when computing conflicts
}

export interface Slot {
  date: string;       // "YYYY-MM-DD"
  start_time: string; // "14:00"
  end_time: string;   // "14:30"
  duration_minutes: number;
}

// ─── time helpers ────────────────────────────────────────────────────────
function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((s) => parseInt(s, 10));
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad(h)}:${pad(m)}`;
}

// Range overlap. Both are [start, end) in minute-of-day.
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function dateAddDays(yyyyMmDd: string, days: number): string {
  const d = new Date(yyyyMmDd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayOfWeekFor(yyyyMmDd: string): number {
  // 0 = Sunday. Use UTC noon to dodge any DST edge cases for the
  // bare date.
  const d = new Date(yyyyMmDd + "T12:00:00Z");
  return d.getUTCDay();
}

// ─── main ────────────────────────────────────────────────────────────────
// ─── deterministic daily holds ─────────────────────────────────────────────
// Reserve a fixed number of slots off the public calendar each day. The choice
// is seeded by the date, so a given day always shows the SAME held slots (a slot
// never flips available/blocked between page loads), and it self-maintains for
// every future date with no seeding or upkeep.
function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function pickHeldStarts(date: string, gridStarts: number[], count: number): Set<number> {
  const held = new Set<number>();
  const n = Math.min(count, gridStarts.length);
  if (n <= 0) return held;
  const pool = gridStarts.slice();
  let seed = hashStr(date + ":holds");
  for (let k = 0; k < n; k++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; // LCG step
    const idx = seed % pool.length;
    held.add(pool[idx]);
    pool.splice(idx, 1);
  }
  return held;
}

export interface ComputeAvailabilityInput {
  fromDate: string;             // YYYY-MM-DD inclusive
  toDate: string;               // YYYY-MM-DD inclusive
  durationMinutes: number;      // session length
  intervalMinutes?: number;     // slot cadence (start-to-start). Defaults to
                                // durationMinutes (back-to-back). Larger leaves
                                // a gap, e.g. 50-min sessions on a 60-min cadence.
  syntheticHoldsPerDay?: number; // reserve up to this many slots/day off the
                                 // public calendar (date-deterministic). 0 = off.
  rules: AvailabilityRule[];    // already filtered to the event type
  blackouts: Blackout[];        // operator tz
  bookings: Booking[];          // operator tz, status === "confirmed"
  minLeadHours?: number;        // optional: skip slots earlier than now + N
  nowOperator?: { date: string; minute: number }; // current time in operator tz
                                                  // (for minLeadHours window)
  busyTimes?: { date: string; start: string; end: string }[]; // Phase 2 hook:
                                                              // Google busy
}

export function computeAvailability(input: ComputeAvailabilityInput): Slot[] {
  const {
    fromDate,
    toDate,
    durationMinutes,
    intervalMinutes,
    syntheticHoldsPerDay = 0,
    rules,
    blackouts,
    bookings,
    minLeadHours = 24,
    nowOperator,
    busyTimes = [],
  } = input;
  const step = intervalMinutes && intervalMinutes > 0 ? intervalMinutes : durationMinutes;

  const slots: Slot[] = [];

  // Index rules + blackouts + bookings + busy times by date for fast lookup
  const rulesByDow = new Map<number, AvailabilityRule[]>();
  for (const r of rules) {
    if (!r.active) continue;
    const list = rulesByDow.get(r.day_of_week) ?? [];
    list.push(r);
    rulesByDow.set(r.day_of_week, list);
  }

  const blackoutsByDate = new Map<string, Blackout[]>();
  for (const b of blackouts) {
    const list = blackoutsByDate.get(b.blackout_date) ?? [];
    list.push(b);
    blackoutsByDate.set(b.blackout_date, list);
  }

  const bookingsByDate = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.status !== "confirmed") continue;
    const list = bookingsByDate.get(b.slot_date) ?? [];
    list.push(b);
    bookingsByDate.set(b.slot_date, list);
  }

  const busyByDate = new Map<string, { start: string; end: string }[]>();
  for (const b of busyTimes) {
    const list = busyByDate.get(b.date) ?? [];
    list.push({ start: b.start, end: b.end });
    busyByDate.set(b.date, list);
  }

  // Walk the date range
  let cursor = fromDate;
  let guard = 0;
  while (cursor <= toDate && guard < 400) {
    guard += 1;
    const dow = dayOfWeekFor(cursor);
    const dayRules = rulesByDow.get(dow) ?? [];

    if (dayRules.length === 0) {
      cursor = dateAddDays(cursor, 1);
      continue;
    }

    // Whole-day blackout check
    const dayBlackouts = blackoutsByDate.get(cursor) ?? [];
    const wholeDayBlackout = dayBlackouts.some(
      (b) => !b.start_time && !b.end_time
    );
    if (wholeDayBlackout) {
      cursor = dateAddDays(cursor, 1);
      continue;
    }

    const partialBlackouts = dayBlackouts
      .filter((b) => b.start_time && b.end_time)
      .map((b) => ({
        start: timeToMinutes(b.start_time!),
        end: timeToMinutes(b.end_time!),
      }));

    const dayBookings = (bookingsByDate.get(cursor) ?? []).map((b) => ({
      start: timeToMinutes(b.slot_start),
      end: timeToMinutes(b.slot_end),
    }));

    const dayBusy = (busyByDate.get(cursor) ?? []).map((b) => ({
      start: timeToMinutes(b.start),
      end: timeToMinutes(b.end),
    }));

    // Full candidate-start grid for the day (used to pick deterministic holds).
    const gridStarts: number[] = [];
    for (const rule of dayRules) {
      const rs = timeToMinutes(rule.start_time);
      const re = timeToMinutes(rule.end_time);
      for (let m = rs; m + durationMinutes <= re; m += step) gridStarts.push(m);
    }
    // Reserve N or N-1 holds for the day (N = syntheticHoldsPerDay), varying by
    // date so it is not a fixed daily pattern; stable across refreshes.
    let heldStarts = new Set<number>();
    if (syntheticHoldsPerDay > 0 && gridStarts.length > 0) {
      const wobble = hashStr(cursor + ":count") & 1; // 0 or 1
      const holdCount = Math.max(0, syntheticHoldsPerDay - wobble);
      heldStarts = pickHeldStarts(cursor, gridStarts, holdCount);
    }

    // For each rule covering this dow, generate candidate slots
    for (const rule of dayRules) {
      const ruleStart = timeToMinutes(rule.start_time);
      const ruleEnd = timeToMinutes(rule.end_time);

      for (let m = ruleStart; m + durationMinutes <= ruleEnd; m += step) {
        const slotStart = m;
        const slotEnd = m + durationMinutes;

        // Reserved (held) slot for this day
        if (heldStarts.has(slotStart)) continue;

        // Skip if any conflict
        const hasBlackoutConflict = partialBlackouts.some((b) =>
          overlaps(slotStart, slotEnd, b.start, b.end)
        );
        if (hasBlackoutConflict) continue;

        const hasBookingConflict = dayBookings.some((b) =>
          overlaps(slotStart, slotEnd, b.start, b.end)
        );
        if (hasBookingConflict) continue;

        const hasBusyConflict = dayBusy.some((b) =>
          overlaps(slotStart, slotEnd, b.start, b.end)
        );
        if (hasBusyConflict) continue;

        // Lead-time gate
        if (nowOperator && cursor === nowOperator.date) {
          if (slotStart < nowOperator.minute + minLeadHours * 60) continue;
        } else if (nowOperator && cursor < nowOperator.date) {
          continue;
        }

        slots.push({
          date: cursor,
          start_time: minutesToTime(slotStart),
          end_time: minutesToTime(slotEnd),
          duration_minutes: durationMinutes,
        });
      }
    }

    cursor = dateAddDays(cursor, 1);
  }

  return slots;
}

// Booking confirmation token. 16 url-safe bytes is plenty for
// unguessability of a token meant for "look up your booking" / "cancel
// your booking" public flows.
import crypto from "crypto";
export function makeConfirmationToken(): string {
  return crypto.randomBytes(16).toString("base64url");
}

// Build a single VEVENT ICS file for a confirmed booking. Uses the
// operator's tz explicitly so the booker's calendar app does not
// reinterpret naive local times.
export function buildBookingIcs(input: {
  uid: string;
  summary: string;
  description: string;
  location: string;
  bookerEmail: string;
  bookerName: string;
  organizerEmail: string;
  organizerName: string;
  slotDate: string;
  slotStart: string;
  slotEnd: string;
}): string {
  const { uid, summary, description, location, bookerEmail, bookerName, organizerEmail, organizerName, slotDate, slotStart, slotEnd } = input;
  const fmt = (d: string, t: string) => {
    return d.replace(/-/g, "") + "T" + t.replace(":", "") + "00";
  };
  const dtStamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Veritas Lab Services//Scheduling//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:-0400",
    "TZOFFSETTO:-0500",
    "TZNAME:EST",
    "DTSTART:19701101T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=America/New_York:${fmt(slotDate, slotStart)}`,
    `DTEND;TZID=America/New_York:${fmt(slotDate, slotEnd)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
    `LOCATION:${location}`,
    `ORGANIZER;CN=${organizerName}:mailto:${organizerEmail}`,
    `ATTENDEE;CN=${bookerName};RSVP=TRUE:mailto:${bookerEmail}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
