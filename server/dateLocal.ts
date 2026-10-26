// Lab-local calendar date/time rendering for stored UTC instants.
//
// Stored *_at timestamps are UTC instants (new Date().toISOString()). Rendering
// them server-side by truncating the ISO string (String(instant).slice(0,10))
// prints the UTC calendar day, which is WRONG for a lab west of UTC in the
// evening: a 5:30pm America/Phoenix sign-off is 00:30 UTC the NEXT day, so the
// signed VeritaCheck report printed tomorrow's date. Reported by Chineme Swann
// (San Carlos Apache Healthcare, Peridot AZ) on 2026-08-09.
//
// No per-lab timezone column exists yet; America/Phoenix matches the operator and
// the current labs. TODO: thread a per-lab timezone when that field is added.
export const LAB_DISPLAY_TZ = "America/Phoenix";

// "Today" as the lab's calendar date (YYYY-MM-DD). Use this, never new Date().toISOString().slice(0, 10), for any
// date a lab sees or that is stored on a lab record: the UTC day is already tomorrow on a US evening (parking lot
// #97, 2026-10-26). One place to change when a per-lab time zone exists.
export function labToday(): string {
  return labLocalDate(new Date().toISOString());
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

export function labLocalDate(instant?: string | null, withTime = false): string {
  if (!instant) return "";
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) {
    return String(instant).slice(0, withTime ? 16 : 10).replace("T", " ");
  }
  const opts: Intl.DateTimeFormatOptions = {
    timeZone: LAB_DISPLAY_TZ,
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
