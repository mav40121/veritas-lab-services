// scripts/verify-lab-day-of.mts
//
// BUG-171 (2026-11-13): client/src/lib/labDate.ts labDayOf shows a stored value as the active lab's day. Pins:
//   1. a moment after 7 PM Eastern (stored in UTC, both shapes the server writes) is the lab's day, not the next day;
//   2. a bare date, and a picked date a route saved as UTC midnight, keep their own date (never a day earlier);
//   3. a lab in Arizona (no daylight saving) and one on UTC read their own days;
//   4. blank and unreadable input.
//   5. the class: no screen in client/src cuts a stored moment field (*_at / *At / completed / signed) to its first 10
//      characters or splits it on "T" any more.
// Run: npx tsx scripts/verify-lab-day-of.mts
import fs from "node:fs";
import path from "node:path";
import { labDayOf, labDaysFromToday, labTodayIso, setActiveLabTimeZone } from "../client/src/lib/labDate";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`); if (!ok) failures++; };

setActiveLabTimeZone("America/New_York");
check("1. 7:30 PM Eastern on 11/13, ISO with Z, reads 11/13 (it read 11/14)", labDayOf("2026-11-14T00:30:00.000Z") === "2026-11-13", labDayOf("2026-11-14T00:30:00.000Z"));
check("1. the same moment as SQLite datetime('now') reads 11/13", labDayOf("2026-11-14 00:30:00") === "2026-11-13", labDayOf("2026-11-14 00:30:00"));
check("1. a morning moment reads its own day", labDayOf("2026-11-13T14:05:00Z") === "2026-11-13");
check("1. summer time: 9 PM EDT on 7/4 reads 7/4", labDayOf("2026-07-05T01:00:00Z") === "2026-07-04", labDayOf("2026-07-05T01:00:00Z"));
check("2. a bare date stays", labDayOf("2026-11-13") === "2026-11-13");
check("2. a picked date saved as UTC midnight keeps its date (never 11/12)", labDayOf("2026-11-13T00:00:00.000Z") === "2026-11-13" && labDayOf("2026-11-13T00:00:00Z") === "2026-11-13" && labDayOf("2026-11-13 00:00:00") === "2026-11-13" && labDayOf("2026-11-13T00:00") === "2026-11-13");
setActiveLabTimeZone("America/Phoenix");
check("3. Arizona: 7:30 PM MST on 11/13 reads 11/13", labDayOf("2026-11-14T02:30:00Z") === "2026-11-13", labDayOf("2026-11-14T02:30:00Z"));
setActiveLabTimeZone("UTC");
check("3. a UTC lab reads the UTC day", labDayOf("2026-11-14T00:30:00Z") === "2026-11-14");
setActiveLabTimeZone("America/New_York");
check("4. blank gives blank", labDayOf("") === "" && labDayOf(null) === "" && labDayOf(undefined) === "");
check("4. unreadable gives its first 10 characters, as before", labDayOf("not a date at all") === "not a date");

// 6. "N days ago" and "today plus N" on the lab's day, with the clock held at 7:30 PM Eastern on 11/13 (00:30Z on 11/14).
{
  const RealDate = Date;
  const FIXED = RealDate.parse("2026-11-14T00:30:00Z");
  class FakeDate extends RealDate {
    constructor(...a: any[]) { if (a.length === 0) super(FIXED); else super(...(a as [any])); }
    static now() { return FIXED; }
  }
  (globalThis as any).Date = FakeDate;
  try {
    setActiveLabTimeZone("America/New_York");
    const old = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    check("6. today is the lab's 11/13 at 7:30 PM Eastern", labDaysFromToday(0) === "2026-11-13" && labTodayIso() === "2026-11-13", labDaysFromToday(0));
    // 7 days back stays in standard time; the old way's answer depends on the computer's own zone, so only the new one is pinned.
    check("6. 7 days ago is 11/6 (the UTC clock gives 11/7 on an Eastern computer)", labDaysFromToday(-7) === "2026-11-06", `${labDaysFromToday(-7)} vs ${old(-7)}`);
    check("6. 30 days ago is 10/14, across the 11/1 clock change", labDaysFromToday(-30) === "2026-10-14", labDaysFromToday(-30));
    check("6. today plus a 5-day lead time is 11/18 (the UTC clock gave 11/19)", labDaysFromToday(5) === "2026-11-18", `${labDaysFromToday(5)} vs ${old(5)}`);
    console.log(`INFO  on this computer the old way gives ${old(-7)} for 7 days ago and ${old(5)} for today plus 5`);
    check("6. a year back crosses the year and month correctly", labDaysFromToday(-365) === "2025-11-13");
    check("6. a blank lead time is today", labDaysFromToday(NaN) === "2026-11-13");
  } finally {
    (globalThis as any).Date = RealDate;
  }
}

// 5. The class sweep.
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "client", "src");
const bad: string[] = [];
const rx = /([A-Za-z_]*(_at|At|completed|signed|Signed)[A-Za-z_]*\)?\??)\.(slice\(0, ?10\)|substring\(0, ?10\)|split\(["']T["']\)\[0\])/;
const walk = (dir: string) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?)$/.test(f.name)) fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (rx.test(line)) bad.push(`${path.relative(root, p)}:${i + 1}`); });
  }
};
walk(root);
check("5. no stored moment field is cut to its UTC day in client/src", bad.length === 0, bad.join(", "));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
