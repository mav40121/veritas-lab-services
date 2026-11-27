// scripts/verify-quality-indicators.mts
//
// Receipt for the VeritaQA rules of B15 (shared/qualityIndicators.ts), on hand-worked numbers: how a value reads against a
// target, what a numerator and denominator make, which version a month takes, periods, and how a period and a system add up.
// Run: npx tsx scripts/verify-quality-indicators.mts
import {
  entryMonths, expectedEntries, indicatorStatus, metText, orgUnit, orgValue, parsePeriod, rollPeriod, targetMet, targetText, totalAcross, trimNumber, valueText, versionForMonth, type OrgEntry,
} from "../shared/qualityIndicators";

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const near = (a: number | null, b: number) => a != null && Math.abs(a - b) < 1e-9;

// A lab's own indicator: the dashboard's rule, both directions, with and without a yellow threshold, and at the edge.
const low = { direction: "lower_is_better", benchmark_green: 2, benchmark_yellow: 3 }, high = { direction: "higher_is_better", benchmark_green: 95, benchmark_yellow: 90 };
check("lower is better: at the target, inside yellow, past it", indicatorStatus(2, low) === "green" && indicatorStatus(2.01, low) === "yellow" && indicatorStatus(3, low) === "yellow" && indicatorStatus(3.01, low) === "red");
check("higher is better", indicatorStatus(95, high) === "green" && indicatorStatus(90, high) === "yellow" && indicatorStatus(89.9, high) === "red");
check("no yellow: anything past the target is red", indicatorStatus(2.5, { direction: "lower_is_better", benchmark_green: 2, benchmark_yellow: null }) === "red");
check("no target, or no value: no status; a value of 0 is a value", indicatorStatus(5, { direction: "lower_is_better" }) === null && indicatorStatus(null, low) === null && indicatorStatus(0, low) === "green");

// Numerators and denominators.
check("percent, rate per 1,000, ratio, count", near(orgValue("percent", 3, 200), 1.5) && near(orgValue("per_1000", 3, 1500), 2) && near(orgValue("ratio", 9000, 200), 45) && orgValue("count", 4, null) === 4);
check("no denominator, or 0: no value, never 0 or infinity", orgValue("percent", 3, null) === null && orgValue("percent", 3, 0) === null && orgValue("percent", null, 10) === null);
check("a numerator of 0 is a value of 0", orgValue("percent", 0, 200) === 0 && orgValue("count", 0, null) === 0);
check("met, missed, and neither without a target or a value", targetMet(2, 2, "lower_is_better") === true && targetMet(2.1, 2, "lower_is_better") === false && targetMet(95, 95, "higher_is_better") === true && targetMet(2, null, "lower_is_better") === null && targetMet(null, 2, "lower_is_better") === null);
check("text", targetText(2, "lower_is_better", "%") === "At most 2%" && targetText(45, "higher_is_better", "minutes") === "At least 45 minutes" && targetText(null, "lower_is_better", "%") === "Not set" && valueText(1.005, "%") === "1.01%" && valueText(null, "%") === "" && trimNumber(2.5) === "2.5" && orgUnit("per_1000") === "per 1,000" && orgUnit("count") === "");

// Versions by month.
const versions = [{ version: 1, effective_from: "2026-01" }, { version: 2, effective_from: "2026-05" }, { version: 3, effective_from: "2026-05" }, { version: 4, effective_from: "2027-01" }];
check("a month takes the newest version that had started by then", ["2026-01", "2026-04", "2026-05", "2026-12", "2027-01"].map((m) => versionForMonth(versions, m)!.version).join() === "1,1,3,3,4");
check("a month before the first version takes the first", versionForMonth(versions, "2025-06")!.version === 1 && versionForMonth([], "2025-06") === null);

// Frequency and periods.
check("a quarterly number goes on the quarter's last month, a yearly one on December", entryMonths("quarterly").join() === "3,6,9,12" && entryMonths("yearly").join() === "12" && entryMonths("monthly").length === 12);
const per = (q: any) => { const p = parsePeriod(q); return "period" in p ? p.period : null; };
check("month, quarter, year to date, year", per({ period: "month", year: 2026, month: 3 })!.months.join() === "3" && per({ period: "quarter", year: 2026, quarter: 3 })!.months.join() === "7,8,9" && per({ period: "ytd", year: "2026", month: "4" })!.months.join() === "1,2,3,4" && per({ period: "year", year: 2026 })!.months.length === 12);
check("a period's ends and name", per({ period: "quarter", year: 2026, quarter: 3 })!.from === "2026-07" && per({ period: "quarter", year: 2026, quarter: 3 })!.to === "2026-09" && per({ period: "ytd", year: 2026, month: 4 })!.label === "Year to date, January to April 2026");
check("a bad period is refused", per({ period: "week", year: 2026 }) === null && per({ period: "month", year: 2026, month: 13 }) === null && per({ period: "quarter", year: 2026, quarter: 5 }) === null && per({ period: "month", year: "x", month: 1 }) === null);
check("entries a period holds", expectedEntries("monthly", [1, 2, 3]) === 3 && expectedEntries("quarterly", [1, 2, 3]) === 1 && expectedEntries("quarterly", [1]) === 0 && expectedEntries("yearly", [10, 11, 12]) === 1);

// A period: sums, never an average of percents. 1 of 10 (10%) and 1 of 90 (1.11%) is 2 of 100 (2%), not 5.56%.
const e = (month: number, numerator: number | null, denominator: number | null, o: Partial<OrgEntry> = {}): OrgEntry => ({ month, numerator, denominator, kind: "percent", unit: "%", target: 3, direction: "lower_is_better", ...o });
const q = rollPeriod([e(1, 1, 10), e(2, 1, 90)], 3);
check("a quarter is the sum of numerators over the sum of denominators", q.value === 2 && q.numerator === 2 && q.denominator === 100 && q.met === true && q.entered === 2 && q.expected === 3 && q.state === "entered", q);
const none = rollPeriod([], 3);
check("nothing entered: no value, neither met nor missed, and No entry", none.state === "no_entry" && none.value === null && none.met === null && metText(none.met, none.state) === "No entry");
check("an entry with no denominator isn't an entry", rollPeriod([e(1, 5, null)], 1).state === "no_entry");
check("0 of 50 is 0%, entered and met", rollPeriod([e(1, 0, 50)], 1).value === 0 && rollPeriod([e(1, 0, 50)], 1).met === true);
const changed = rollPeriod([e(1, 1, 10), e(2, 1, 10, { target: 5 })], 3);
check("a target that changed inside the period is not judged; the sum stands", changed.met === null && changed.value === 10 && /target changed/.test(changed.note!) && metText(changed.met, changed.state) === "Not judged");
const kinds = rollPeriod([e(1, 1, 10), e(2, 1, 10, { kind: "per_1000", unit: "per 1,000" })], 3);
check("a kind that changed inside the period isn't added together", kinds.value === null && kinds.kind === null && kinds.state === "entered" && /kind of indicator changed/.test(kinds.note!));
const c = (n: number) => e(1, n, null, { kind: "count", unit: "", target: 3 });
check("counts add up; one entry is judged, several aren't", rollPeriod([c(2)], 1).met === true && rollPeriod([c(2), c(2)], 2).value === 4 && rollPeriod([c(2), c(2)], 2).met === null);
check("no target: not judged", rollPeriod([e(1, 1, 10, { target: null })], 1).met === null);

// Across laboratories: 2 of 100 and 30 of 1,000 is 32 of 1,100 (2.909%), and a laboratory with no entry is left out.
const t = totalAcross([q, rollPeriod([e(1, 30, 1000)], 3), none]);
check("the total is the sum, counting only laboratories that entered", t.shown && t.numerator === 32 && t.denominator === 1100 && near(t.value, (32 / 1100) * 100) && t.labs_counted === 2, t);
const mixed = totalAcross([q, rollPeriod([e(1, 30, 1000, { kind: "per_1000", unit: "per 1,000" })], 3)]);
check("different kinds: no total, with the reason", !mixed.shown && mixed.value === null && /different kinds/.test(mixed.reason!));
check("the same kind in different units: no total", !totalAcross([rollPeriod([e(1, 90, 2, { kind: "ratio", unit: "minutes" })], 1), rollPeriod([e(1, 3, 2, { kind: "ratio", unit: "hours" })], 1)]).shown);
check("a laboratory whose kind changed: no total", !totalAcross([q, kinds]).shown);
check("nobody entered: no total, and it says so", !totalAcross([none, none]).shown && totalAcross([none]).reason === "No entries in this period.");
const counts = totalAcross([rollPeriod([c(2), c(1)], 3), rollPeriod([c(4)], 3)]);
check("counts total", counts.shown && counts.numerator === 7 && counts.denominator === null && counts.value === 7);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
