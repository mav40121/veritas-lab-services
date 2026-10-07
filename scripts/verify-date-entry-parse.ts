// scripts/verify-date-entry-parse.ts
//
// Receipt for the shared DateEntry parsing (parking lot #78 with #75,
// 2026-10-07): masking, loose parsing, display formatting. Exits non-zero on
// any failure. Run: npx tsx scripts/verify-date-entry-parse.ts
import { isoToDisplay, maskDateInput, parseLooseDate, isoToLocalDate } from "../client/src/lib/dateEntry";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  :: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}

// masking while typing
check("mask: digits only get slashes", maskDateInput("10072026"), "10/07/2026");
check("mask: partial keeps partial", maskDateInput("100"), "10/0");
check("mask: strips letters and extra separators", maskDateInput("1a0//0b7-2026x"), "10/07/2026");
check("mask: caps at eight digits", maskDateInput("100720261234"), "10/07/2026");
check("mask: empty", maskDateInput(""), "");

// loose parsing
check("parse: MM/dd/yyyy", parseLooseDate("10/07/2026"), "2026-10-07");
check("parse: M/d/yyyy", parseLooseDate("1/7/2026"), "2026-01-07");
check("parse: M/d/yy", parseLooseDate("10/7/26"), "2026-10-07");
check("parse: dashes", parseLooseDate("10-07-2026"), "2026-10-07");
check("parse: ISO passes through", parseLooseDate("2026-10-07"), "2026-10-07");
check("parse: ISO with slashes", parseLooseDate("2026/10/07"), "2026-10-07");
check("parse: bare digits", parseLooseDate("10072026"), "2026-10-07");
check("parse: surrounding spaces", parseLooseDate("  10/07/2026 "), "2026-10-07");
check("parse: empty is a clear, not an error", parseLooseDate(""), "");
check("parse: impossible month", parseLooseDate("13/45/2026"), null);
check("parse: Feb 30", parseLooseDate("02/30/2026"), null);
check("parse: real leap day", parseLooseDate("02/29/2024"), "2024-02-29");
check("parse: non-leap Feb 29", parseLooseDate("02/29/2023"), null);
check("parse: letters", parseLooseDate("next tuesday"), null);
check("parse: year typo out of range", parseLooseDate("10/07/0026"), null);
check("parse: partial entry is invalid", parseLooseDate("10/07"), null);

// display + local date
check("display: ISO -> MM/DD/YYYY", isoToDisplay("2026-10-07"), "10/07/2026");
check("display: empty", isoToDisplay(""), "");
check("display: garbage", isoToDisplay("yesterday"), "");
const d = isoToLocalDate("2026-10-07");
check("local date: year/month/day", d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null, [2026, 10, 7]);
check("local date: invalid", isoToLocalDate("2026-13-40"), undefined);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
