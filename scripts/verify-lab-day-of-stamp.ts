// scripts/verify-lab-day-of-stamp.ts
//
// client/src/lib/labDate.ts labDayOfStamp (2026-10-27, found on the BUG-077 browser check): a stored moment shown as
// the active lab's calendar day. SQLite datetime('now') stamps carry no zone and are UTC; a browser reading one with
// new Date() takes it as local time, so 03:39 UTC on 10/27 printed as 10/27 in Boston at 23:39 on 10/26.
// Run: npx tsx scripts/verify-lab-day-of-stamp.ts
import { labDayOfStamp, labStampLabel, labLocaleDate, setActiveLabTimeZone } from "../client/src/lib/labDate";

let failures = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  :: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (!ok) failures++;
}

setActiveLabTimeZone("America/New_York");
check("1. SQLite UTC stamp after 8 PM Eastern is still the 26th in Boston", labDayOfStamp("2026-10-27 03:39:56"), "2026-10-26");
check("2. the same moment as ISO with Z", labDayOfStamp("2026-10-27T03:39:56.123Z"), "2026-10-26");
check("3. midday UTC is the same day", labDayOfStamp("2026-10-27 15:00:00"), "2026-10-27");
setActiveLabTimeZone("America/Phoenix");
check("4. Arizona lab, 06:59 UTC is still the day before", labDayOfStamp("2026-10-27 06:59:00"), "2026-10-26");
check("5. Arizona lab, 07:00 UTC is the new day", labDayOfStamp("2026-10-27T07:00:00Z"), "2026-10-27");
check("6. a bare day is returned as is", labDayOfStamp("2026-10-27"), "2026-10-27");
check("7. empty, null and unreadable give an empty string", [labDayOfStamp(""), labDayOfStamp(null), labDayOfStamp("not a date")].join("|"), "||");
setActiveLabTimeZone("America/New_York");
check("8. labStampLabel: SQLite stamp on the lab clock, 24-hour", labStampLabel("2026-10-27 03:39:56"), "2026-10-26 23:39");
check("9. labStampLabel: ISO with Z, afternoon", labStampLabel("2026-10-27T18:05:00.000Z"), "2026-10-27 14:05");
check("10. labStampLabel: a bare day stays a day; empty stays empty", [labStampLabel("2026-10-27"), labStampLabel(null)].join("|"), "2026-10-27|");
// labLocaleDate keeps the browser's usual date format; compare with a local-midnight Date so any locale passes.
const loc = (y: number, m: number, d: number) => new Date(y, m - 1, d).toLocaleDateString();
check("11. labLocaleDate: a bare day is that day (new Date('2026-10-27') showed 10/26 in the US)", labLocaleDate("2026-10-27"), loc(2026, 10, 27));
check("12. labLocaleDate: a SQLite stamp after 8 PM Eastern is the lab's day", labLocaleDate("2026-10-27 03:39:56"), loc(2026, 10, 26));
check("13. labLocaleDate: empty stays empty", labLocaleDate(undefined), "");
setActiveLabTimeZone(null);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
