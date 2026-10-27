// scripts/verify-lab-local-today.ts
//
// Parking lot #97 (2026-10-26): "today" for a lab is the lab's calendar day, not the UTC day (which is already
// tomorrow on a US evening). Two parts:
//   1. labLocalDate / addLabDays on known instants: an Arizona or Eastern evening stays on the same day; month-end
//      and leap-year arithmetic.
//   2. A ratchet on server/routes.ts: the number of UTC calendar-date derivations may only go DOWN. Each clean-up PR
//      lowers BASELINE; a new `new Date().toISOString().slice(0, 10)` (or split("T")[0], now.slice(0, 10),
//      date('now')) makes this fail. Use labToday() / addLabDays() from server/dateLocal.ts instead; a genuine UTC
//      use (a full timestamp, an internal job key) is fine, then raise BASELINE in the same PR and say why.
//   npx tsx scripts/verify-lab-local-today.ts
import { readFileSync } from "node:fs";
import { labLocalDate, addLabDays } from "../server/dateLocal";

const BASELINE = 23; // after part 3, file names and date stamps (2026-10-26); the rest are date arithmetic or true UTC
let fails = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!ok) fails++;
};

check("Arizona 6:30 PM on 10/26 (01:30 UTC 10/27) is still 10/26", labLocalDate("2026-10-27T01:30:00.000Z") === "2026-10-26", labLocalDate("2026-10-27T01:30:00.000Z"));
check("Eastern 9:00 PM on 10/26 (01:00 UTC 10/27) is still 10/26", labLocalDate("2026-10-27T01:00:00.000Z") === "2026-10-26");
check("midday is the same day everywhere", labLocalDate("2026-10-26T17:00:00.000Z") === "2026-10-26");
check("+30 days crosses a month", addLabDays("2026-10-26", 30) === "2026-11-25", addLabDays("2026-10-26", 30));
check("+1 day crosses a year", addLabDays("2026-12-31", 1) === "2027-01-01");
check("Jan 31 + 1 month clamps to Feb 28", addLabDays("2026-01-31", 0, 1) === "2026-02-28", addLabDays("2026-01-31", 0, 1));
check("Jan 31 + 1 month in a leap year is Feb 29", addLabDays("2028-01-31", 0, 1) === "2028-02-29");
check("+12 months keeps the day", addLabDays("2026-10-26", 0, 12) === "2027-10-26");
check("-365 days", addLabDays("2026-10-26", -365) === "2025-10-26");

const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
const patterns: Record<string, RegExp> = {
  "toISOString().slice(0, 10)": /toISOString\(\)\.slice\(0,\s*10\)/g,
  'toISOString().split("T")[0]': /toISOString\(\)\.split\(["']T["']\)\[0\]/g,
  "now.slice(0, 10)": /\bnow\.slice\(0,\s*10\)/g,
  'now.split("T")[0]': /\bnow\.split\(["']T["']\)\[0\]/g,
  "date('now')": /date\('now'/g,
};
let total = 0;
for (const [label, re] of Object.entries(patterns)) {
  const n = (src.match(re) || []).length;
  total += n;
  console.log(`      ${label}: ${n}`);
}
check(`routes.ts UTC calendar dates do not grow (now ${total}, baseline ${BASELINE})`, total <= BASELINE);
if (total < BASELINE) console.log(`NOTE  ${BASELINE - total} fewer than the baseline: lower BASELINE to ${total} in this PR.`);

// 3. Ratchet on every other server file (2026-10-27): "today" taken straight from the UTC clock
//    (new Date().toISOString() cut to the date) may only go DOWN. Use labToday() in request code (the lab clock) and
//    labToday(labTimeZoneById(sqlite, labId)) in background jobs. Known uses that stay: dateLocal.ts (its own comment),
//    audit.ts (nightly snapshot key), certificateReminders.ts (runs at 13:00 UTC, the same day as every US lab),
//    stockRecalls.ts (the UTC day + 1 as a query bound, then each lab's own day). ptReminders.ts and
//    equipmentReminders.ts drop out with PR #1726.
import { readdirSync } from "node:fs";
const OTHER_BASELINE = 6;
const todayRe = /new Date\(\)\.toISOString\(\)\.(?:slice\(0,\s*10\)|split\(["']T["']\)\[0\])/g;
const serverDir = new URL("../server/", import.meta.url);
let other = 0;
for (const f of readdirSync(serverDir).filter((n) => n.endsWith(".ts") && n !== "routes.ts")) {
  const n = (readFileSync(new URL(f, serverDir), "utf8").match(todayRe) || []).length;
  if (n) console.log(`      ${f}: ${n}`);
  other += n;
}
check(`other server files: UTC "today" does not grow (now ${other}, baseline ${OTHER_BASELINE})`, other <= OTHER_BASELINE);
if (other < OTHER_BASELINE) console.log(`NOTE  ${OTHER_BASELINE - other} fewer than the baseline: lower OTHER_BASELINE to ${other} in this PR.`);
console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
