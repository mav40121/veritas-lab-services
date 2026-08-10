// Verify the lab-local date fix for Chineme's "Wrong Date" report.
// Run: npx tsx scripts/verify-lab-local-date.ts
import { labLocalDate, LAB_DISPLAY_TZ } from "../server/dateLocal";

let fail = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// Chineme signed 8/9 ~5:30pm Phoenix = 8/10 00:30:47 UTC. The bug printed
// 2026-08-10 (UTC slice); the fix must print 2026-08-09.
check("sign-off date (5:30pm AZ)", labLocalDate("2026-08-10T00:30:47.000Z"), "2026-08-09");
check("sign-off datetime", labLocalDate("2026-08-10T00:30:47.000Z", true), "2026-08-09 17:30");

// Morning AZ: 09:00 AZ = 16:00 UTC same day.
check("morning AZ date", labLocalDate("2026-08-09T16:00:00.000Z"), "2026-08-09");

// AZ-midnight boundaries (Phoenix is UTC-7 year round, no DST).
check("just before AZ midnight (06:59:59Z)", labLocalDate("2026-08-10T06:59:59.000Z"), "2026-08-09");
check("just after AZ midnight (07:00:00Z)", labLocalDate("2026-08-10T07:00:00.000Z"), "2026-08-10");

// Empty / null / bad inputs.
check("empty", labLocalDate(""), "");
check("null", labLocalDate(null), "");

console.log(`\nTZ=${LAB_DISPLAY_TZ}  ${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
