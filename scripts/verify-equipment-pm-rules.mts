// scripts/verify-equipment-pm-rules.mts
//
// Receipt for shared/equipmentPm.ts (B9, 2026-11-24): what an event does to the PM due date, and the out of service arithmetic.
// Imports the real functions. Run: npx tsx scripts/verify-equipment-pm-rules.mts
import {
  addDays, canCompletePm, completesPmByDefault, durationLabel, isLocalMinute, minutesBetween, minutesInMonth, outAllDay, planPmDue,
} from "../shared/equipmentPm";

let fails = 0;
const ok = (label: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  :: " + detail}`); if (!cond) fails++; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Which entries complete PM
ok("preventive maintenance completes PM by default; nothing else does", completesPmByDefault("preventive_maintenance") && ["calibration", "service", "repair", "function_check", "troubleshooting", "solution_change"].every((t) => !completesPmByDefault(t)));
ok("calibration, service, repair and function check can be marked as completing it", ["calibration", "service", "repair", "function_check"].every(canCompletePm));
ok("troubleshooting, a solution change and a carried stain log line can't", ["troubleshooting", "solution_change", "stain_log"].every((t) => !canCompletePm(t)));

// The due date
ok("interval from the event date", same(planPmDue({ currentDue: "2026-12-01", eventDate: "2026-11-20", intervalDays: 90 }), { computed: "2027-02-18", move: true, held: null }));
ok("a typed date wins", planPmDue({ currentDue: null, eventDate: "2026-11-20", intervalDays: 90, typedDue: "2027-03-01" }).computed === "2027-03-01");
ok("earlier than the date on file is held", same(planPmDue({ currentDue: "2027-02-18", eventDate: "2026-06-01", intervalDays: 90 }), { computed: "2026-08-30", move: false, held: { keeps: "2027-02-18", works_out_to: "2026-08-30" } }));
ok("a typed earlier date is held too", planPmDue({ currentDue: "2027-02-18", eventDate: "2026-11-20", intervalDays: 90, typedDue: "2027-01-01" }).held?.works_out_to === "2027-01-01");
ok("unless the person says so", same(planPmDue({ currentDue: "2027-02-18", eventDate: "2026-06-01", intervalDays: 90, allowEarlier: true }), { computed: "2026-08-30", move: true, held: null }));
ok("the same date isn't a move and isn't held", same(planPmDue({ currentDue: "2027-02-18", eventDate: "2026-11-20", intervalDays: 90 }), { computed: "2027-02-18", move: false, held: null }));
ok("no date on file takes whatever it works out to", planPmDue({ currentDue: null, eventDate: "2026-06-01", intervalDays: 90 }).move);
ok("no interval and no typed date leaves it alone", same(planPmDue({ currentDue: "2027-02-18", eventDate: "2026-11-20", intervalDays: null }), { computed: null, move: false, held: null }) && planPmDue({ currentDue: "2027-02-18", eventDate: "2026-11-20", intervalDays: 0 }).computed === null);
ok("days cross a leap February", addDays("2028-02-28", 2) === "2028-03-01" && addDays("2027-02-28", 1) === "2027-03-01");

// Out of service
ok("a wall-clock moment must be real", isLocalMinute("2026-11-01T08:00") && !isLocalMinute("2026-11-01") && !isLocalMinute("2026-02-30T08:00") && !isLocalMinute("2026-11-01T24:00") && !isLocalMinute("2026-11-01T08:60"));
ok("minutes between", minutesBetween("2026-11-01T08:00", "2026-11-03T10:30") === 3030 && minutesBetween("2026-11-03T10:30", "2026-11-01T08:00") === 0);
ok("labels", durationLabel(45) === "45 min" && durationLabel(60) === "1 h" && durationLabel(185) === "3 h 5 min" && durationLabel(3030) === "2 d 2 h" && durationLabel(2880) === "2 d" && durationLabel(0) === "0 min");
ok("a period clipped to the month at both ends", minutesInMonth({ down_from: "2026-10-30T00:00", down_until: "2026-12-02T00:00" }, "2026-11", "2026-12-05T00:00") === 30 * 1440);
ok("an open period counts up to now", minutesInMonth({ down_from: "2026-11-20T00:00", down_until: null }, "2026-11", "2026-11-21T12:00") === 2160);
ok("a period outside the month counts nothing", minutesInMonth({ down_from: "2026-10-01T00:00", down_until: "2026-10-05T00:00" }, "2026-11", "2026-11-21T12:00") === 0 && minutesInMonth({ down_from: "2026-12-01T00:00", down_until: null }, "2026-11", "2026-12-05T00:00") === 0);
ok("December clips at the new year", minutesInMonth({ down_from: "2026-12-31T00:00", down_until: "2027-01-02T00:00" }, "2026-12", "2027-02-01T00:00") === 1440);
ok("out all day needs the whole day", outAllDay([{ down_from: "2026-11-01T00:00", down_until: "2026-11-02T00:00" }], "2026-11-01") && !outAllDay([{ down_from: "2026-11-01T08:00", down_until: "2026-11-03T00:00" }], "2026-11-01") && outAllDay([{ down_from: "2026-11-01T08:00", down_until: null }], "2026-11-02"));

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
