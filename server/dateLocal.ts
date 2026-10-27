// Lab-local calendar date/time rendering for stored UTC instants.
//
// Stored *_at timestamps are UTC instants (new Date().toISOString()). Rendering
// them server-side by truncating the ISO string (String(instant).slice(0,10))
// prints the UTC calendar day, which is WRONG for a lab west of UTC in the
// evening: a 5:30pm America/Phoenix sign-off is 00:30 UTC the NEXT day, so the
// signed VeritaCheck report printed tomorrow's date. Reported by Chineme Swann
// (San Carlos Apache Healthcare, Peridot AZ) on 2026-08-09.
//
// Per-lab time zone (Michael 2026-10-26, option 1; shared/labTimeZone.ts). Every lab used to be America/Phoenix. Now
// a request carries its lab's zone in a request-scoped "lab clock" (AsyncLocalStorage): labClockMiddleware opens it
// for every request, and the lab-scope middleware and the active-lab resolver set it once they know the lab. Code
// with no lab (admin, system) uses DEFAULT_LAB_TIME_ZONE. Background jobs that loop over labs run each lab inside
// withLabClock(tz, ...). labToday() and labLocalDate() read the clock, so their callers need no change.
import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_LAB_TIME_ZONE, labTimeZoneInfo } from "@shared/labTimeZone";

const labClock = new AsyncLocalStorage<{ tz: string | null }>();

export function labClockMiddleware(_req: any, _res: any, next: () => void): void {
  labClock.run({ tz: null }, next);
}
export function setRequestLabTz(tz: string | null | undefined): void {
  const store = labClock.getStore();
  if (store && tz) store.tz = tz;
}
export function withLabClock<T>(tz: string | null | undefined, fn: () => T): T {
  return labClock.run({ tz: tz || null }, fn);
}
export function currentLabTz(): string {
  return labClock.getStore()?.tz || DEFAULT_LAB_TIME_ZONE;
}
// The zone of a lab row (labs.time_zone, else its CLIA state, else the default).
export function labTimeZoneOf(lab: { time_zone?: string | null; clia_number?: string | null } | null | undefined): string {
  return labTimeZoneInfo(lab).timeZone;
}
// The zone of a lab by id, for code that has only the id (background jobs).
export function labTimeZoneById(sqlite: any, labId: number | null | undefined): string {
  if (!labId) return DEFAULT_LAB_TIME_ZONE;
  try {
    return labTimeZoneOf(sqlite.prepare("SELECT time_zone, clia_number FROM labs WHERE id = ?").get(Number(labId)) as any);
  } catch {
    return DEFAULT_LAB_TIME_ZONE;
  }
}

// "Today" as the lab's calendar date (YYYY-MM-DD). Use this, never new Date().toISOString().slice(0, 10), for any
// date a lab sees or that is stored on a lab record: the UTC day is already tomorrow on a US evening (parking lot
// #97, 2026-10-26). The zone is the request's lab (or the one passed).
export function labToday(tz?: string): string {
  return labLocalDate(new Date().toISOString(), false, tz);
}

// A lab calendar date (YYYY-MM-DD) moved by whole days and/or months. Pure calendar arithmetic, no clock, so the
// result does not depend on the server's time zone. Month-end clamps like SQLite's date(..., '+N months') does not:
// Jan 31 + 1 month = Feb 28/29 here.
export function addLabDays(isoDay: string, days = 0, months = 0): string {
  const [y, m, d] = isoDay.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay) + days);
  return target.toISOString().slice(0, 10);
}

export function labLocalDate(instant?: string | null, withTime = false, tz?: string): string {
  if (!instant) return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) {
    return String(instant).slice(0, withTime ? 16 : 10).replace("T", " ");
  }
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: tz || currentLabTz(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  };
  if (withTime) {
    opts.hour = "2-digit";
    opts.minute = "2-digit";
    opts.hour12 = false;
  }
  const parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
  let hh = g("hour");
  if (hh === "24") hh = "00";
  const date = `${g("year")}-${g("month")}-${g("day")}`;
  return withTime ? `${date} ${hh}:${g("minute")}` : date;
}
