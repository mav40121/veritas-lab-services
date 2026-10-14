// scripts/verify-annual-month-alignment.mts
//
// Math receipt for the lab annual competency month (Michael Q157 = 1, 2026-10-13; Sampson REQ-057): a repeat annual
// already due in the lab's month stays; any other moves EARLIER to the end of the last such month before it, never
// later. Exercises shared/competencySignoff.ts alignAnnualToMonth directly and through server/competencySchedule.ts
// competencyDueColumns (VeritaStaff's stored due dates): only the annual moves; the 6-month and first annual do not.
// Run: npx tsx --tsconfig tsconfig.json scripts/verify-annual-month-alignment.mts
import { alignAnnualToMonth } from "../shared/competencySignoff";
import { competencyDueColumns } from "../server/competencySchedule";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const eq = (name: string, got: any, want: any) => check(name, got === want, `got ${got}, want ${want}`);

eq("1. due in the lab month stays (10/02 with October)", alignAnnualToMonth("2028-10-02", 10), "2028-10-02");
eq("2. due the month after moves back to the end of that October", alignAnnualToMonth("2028-11-20", 10), "2028-10-31");
eq("3. due in March moves back to the previous October", alignAnnualToMonth("2029-03-15", 10), "2028-10-31");
eq("4. due on the last day of the month stays", alignAnnualToMonth("2028-10-31", 10), "2028-10-31");
eq("5. December month from January: previous December 31", alignAnnualToMonth("2028-01-15", 12), "2027-12-31");
eq("6. February in a leap year ends on the 29th", alignAnnualToMonth("2028-03-01", 2), "2028-02-29");
eq("7. February in a common year ends on the 28th", alignAnnualToMonth("2027-03-01", 2), "2027-02-28");
eq("8. no month set: unchanged", alignAnnualToMonth("2028-11-20", null), "2028-11-20");
eq("9. month out of range: unchanged", alignAnnualToMonth("2028-11-20", 13), "2028-11-20");
eq("10. no date: null", alignAnnualToMonth(null, 10), null);

// Never later, always in the month, and never more than 12 months earlier: every day of 2027-2028, every month.
let later = 0, wrongMonth = 0, tooEarly = 0, n = 0;
for (let t = Date.UTC(2027, 0, 1); t <= Date.UTC(2028, 11, 31); t += 86400000) {
  const d = new Date(t).toISOString().slice(0, 10);
  for (let m = 1; m <= 12; m++) {
    const a = alignAnnualToMonth(d, m)!;
    n++;
    if (a > d) later++;
    if (Number(a.slice(5, 7)) !== m) wrongMonth++;
    if (Date.parse(d) - Date.parse(a) >= 366 * 86400000) tooEarly++;
  }
}
check(`11. ${n} date/month pairs: never later, always in the month, under a year earlier`, later === 0 && wrongMonth === 0 && tooEarly === 0, `later ${later}, wrong month ${wrongMonth}, a year or more early ${tooEarly}`);

// Through VeritaStaff's due-date projection (CLIA-only lab, non-waived and waived).
const ctx = { accreditor: "CLIA_ONLY", nys: false, highestComplexity: "H", hireDate: "2023-12-01" };
const comp = { initialCompletedAt: "2024-01-10", sixMonthCompletedAt: "2024-07-10", firstAnnualCompletedAt: "2025-01-10", lastAnnualCompletedAt: "2025-11-20" };
const off = competencyDueColumns(ctx, comp), oct = competencyDueColumns({ ...ctx, annualMonth: 10 }, comp);
eq("12. VeritaStaff annual due: 2026-11-20 with no month", off.annual_due_at, "2026-11-20");
eq("13. VeritaStaff annual due: 2026-10-31 with October", oct.annual_due_at, "2026-10-31");
check("14. the 6-month and first annual are not moved by the annual month", oct.six_month_due_at === off.six_month_due_at && oct.first_annual_due_at === off.first_annual_due_at, `${oct.six_month_due_at} ${oct.first_annual_due_at}`);
const yearOne = { initialCompletedAt: "2026-11-01", sixMonthCompletedAt: "2027-05-01" };
eq("15. a new hire's first annual (initial + 12) stays put with October set", competencyDueColumns({ ...ctx, annualMonth: 10 }, yearOne).first_annual_due_at, "2027-11-01");
const waived = competencyDueColumns({ ...ctx, highestComplexity: "W", annualMonth: 10 }, { initialCompletedAt: "2026-11-20" });
eq("16. waived: the annual after the initial moves into October", waived.annual_due_at, "2027-10-31");

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
