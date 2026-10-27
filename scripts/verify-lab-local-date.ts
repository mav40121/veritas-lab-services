// Verify lab-local dates (Chineme's "Wrong Date" report, 2026-08-09) and the per-lab time zone (Michael 2026-10-26,
// option 1): a lab's zone comes from labs.time_zone, else its CLIA state, else Eastern; the request-scoped lab clock
// drives labLocalDate and labToday.
// Run: npx tsx scripts/verify-lab-local-date.ts
import { labLocalDate, labToday, withLabClock, currentLabTz, labTimeZoneOf } from "../server/dateLocal";
import { labTimeZoneInfo, cliaState, DEFAULT_LAB_TIME_ZONE } from "../shared/labTimeZone";

let fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// Arizona (SCAHC): Chineme signed 8/9 ~5:30pm Phoenix = 8/10 00:30:47 UTC; the date must print 2026-08-09.
withLabClock("America/Phoenix", () => {
  check("AZ sign-off date (5:30pm AZ)", labLocalDate("2026-08-10T00:30:47.000Z"), "2026-08-09");
  check("AZ sign-off datetime", labLocalDate("2026-08-10T00:30:47.000Z", true), "2026-08-09 17:30");
  check("AZ morning date", labLocalDate("2026-08-09T16:00:00.000Z"), "2026-08-09");
  check("AZ just before midnight (06:59:59Z)", labLocalDate("2026-08-10T06:59:59.000Z"), "2026-08-09");
  check("AZ just after midnight (07:00:00Z)", labLocalDate("2026-08-10T07:00:00.000Z"), "2026-08-10");
});

// Eastern: 00:30 EDT on 10/27 is 04:30Z; Arizona is still on 10/26 (the bug this change fixes for Eastern labs).
withLabClock("America/New_York", () => {
  check("ET 00:30 is already 10/27", labLocalDate("2026-10-27T04:30:00.000Z"), "2026-10-27");
  check("ET datetime", labLocalDate("2026-10-27T04:30:00.000Z", true), "2026-10-27 00:30");
});
check("same instant in Arizona is still 10/26", labLocalDate("2026-10-27T04:30:00.000Z", false, "America/Phoenix"), "2026-10-26");
check("an explicit zone overrides the clock", withLabClock("America/New_York", () => labLocalDate("2026-10-27T04:30:00.000Z", false, "America/Phoenix")), "2026-10-26");

// No lab clock: the default zone.
check("no clock -> default zone", currentLabTz(), DEFAULT_LAB_TIME_ZONE);
check("nested clocks: inner wins, outer restored", withLabClock("America/Chicago", () => [withLabClock("Pacific/Honolulu", () => currentLabTz()), currentLabTz()]), ["Pacific/Honolulu", "America/Chicago"]);
check("labToday follows the clock", withLabClock("America/Phoenix", () => labToday()), labLocalDate(new Date().toISOString(), false, "America/Phoenix"));

// Zone resolution.
check("CLIA state 03 = AZ", cliaState("03D0531813"), "AZ");
check("CLIA overflow code 68 = FL", cliaState("68D1234567"), "FL");
check("placeholder CLIA has no state", cliaState("PENDING-UNCNASH-2026"), null);
const z = (lab: any) => { const i = labTimeZoneInfo(lab); return [i.timeZone, i.source, i.needsConfirm]; };
check("SCAHC (03D, Arizona) stays Arizona, no prompt", z({ clia_number: "03D0531813" }), ["America/Phoenix", "clia", false]);
check("Massachusetts (22D) Eastern, no prompt", z({ clia_number: "22D0999999" }), ["America/New_York", "clia", false]);
check("North Carolina (34D) Eastern", z({ clia_number: "34D1234567" }), ["America/New_York", "clia", false]);
check("California (05D) Pacific", z({ clia_number: "05D1234567" }), ["America/Los_Angeles", "clia", false]);
check("Michigan (23D, Gameday) Eastern main zone, asked to confirm", z({ clia_number: "23D2310670" }), ["America/New_York", "clia_main_zone", true]);
check("Tennessee (44D) Central main zone, asked to confirm", z({ clia_number: "44D1234567" }), ["America/Chicago", "clia_main_zone", true]);
check("no CLIA -> Eastern, asked to confirm", z({ clia_number: "PENDING-UNCNASH-2026" }), ["America/New_York", "default", true]);
check("a set zone wins over the CLIA state", z({ clia_number: "03D0531813", time_zone: "America/Denver" }), ["America/Denver", "set", false]);
check("an invalid set zone is ignored", z({ clia_number: "03D0531813", time_zone: "Mars/Olympus" }), ["America/Phoenix", "clia", false]);
check("labTimeZoneOf(lab)", labTimeZoneOf({ clia_number: "05D1234567" }), "America/Los_Angeles");

// Empty / null / bad inputs.
check("empty", labLocalDate(""), "");
check("null", labLocalDate(null), "");

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
