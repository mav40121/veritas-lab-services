// client/src/lib/labDate.ts
//
// Per-lab time zone on the pages (Michael 2026-10-26, option 1): "today" is the ACTIVE LAB's calendar day, the same
// day the server stamps and the reports print. NavBar keeps the active lab's zone here as the lab changes (from
// /api/labs/me). With no lab (signed out, public pages) it is the computer's own day. Never use
// new Date().toISOString().slice(0, 10) for a date a lab sees: that is the UTC day, already tomorrow on a US evening.

// Cached in the browser so a page that sets a default date as it first renders (before /api/labs/me returns) already
// has the zone from the last visit. A per-viewer convenience only; the server's own stamps never depend on it.
const CACHE_KEY = "veritas_active_lab_tz";
function readCache(): string | null {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(CACHE_KEY) : null; } catch { return null; }
}
let activeLabTimeZone: string | null = readCache();

export function setActiveLabTimeZone(tz: string | null | undefined): void {
  activeLabTimeZone = tz || null;
  try {
    if (typeof localStorage === "undefined") return;
    if (activeLabTimeZone) localStorage.setItem(CACHE_KEY, activeLabTimeZone);
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable: the in-memory zone still applies */ }
}
export function getActiveLabTimeZone(): string | null {
  return activeLabTimeZone;
}

// The calendar day (YYYY-MM-DD) in a zone; no zone = the computer's own zone.
export function todayInZone(tz?: string | null, at: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const g = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${g("year")}-${g("month")}-${g("day")}`;
  } catch {
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  }
}

// Today in the active lab: default values for date fields, "is it due" checks, and date stamps in file names.
export function labTodayIso(): string {
  return todayInZone(activeLabTimeZone);
}
