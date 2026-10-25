// scripts/verify-outside-records.mts
//
// Receipt for Q16 (2026-10-24, Lifepoint Georgetown REQ-103): studies performed OUTSIDE VeritaCheck count on Coverage.
// Exercises computeCoverageFrom with outside records: an outside cal ver covers exactly its instrument (not a second
// unit of the same model), counts for 6 months then reads overdue, loses to a newer real study, beats an older failed
// one, never shows on an exempt row; an outside correlation satisfies the method comparison; and with no outside
// records the result is unchanged.
// Run: npx tsx scripts/verify-outside-records.mts

import { computeCoverageFrom } from "../server/veritacheckCoverage.ts";

let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const plus6mo = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCMonth(dt.getUTCMonth() + 6); return dt.toISOString().slice(0, 10); };

const instruments = [
  { id: 1, instrument_name: "Ortho VITROS 5600", nickname: "Bonnie" },
  { id: 5, instrument_name: "Ortho VITROS 5600", nickname: "Clyde" }, // second unit of the same model
  { id: 7, instrument_name: "Siemens CA-600", nickname: null },
];
const combos = [
  { id: 15, analyte: "Sodium", specialty: "General Chemistry", instrument_id: 1 },
  { id: 18, analyte: "Sodium", specialty: "General Chemistry", instrument_id: 5 },
  { id: 19, analyte: "Potassium", specialty: "General Chemistry", instrument_id: 1 },
  { id: 20, analyte: "Glucose", specialty: "General Chemistry", instrument_id: 1 },
  { id: 21, analyte: "Fibrinogen", specialty: "Hematology", instrument_id: 7, linearity_exempt_multical: 1 },
];
const recent = daysAgo(60), old = daysAgo(240);
const outside = [
  { id: 101, kind: "cal_ver" as const, instrument_id: 1, analyte: "Sodium", performed_on: recent, records_location: "Chem binder", reviewed_by: "Dr. Lee" },
  { id: 102, kind: "cal_ver" as const, instrument_id: 1, analyte: "Potassium", performed_on: old, records_location: "Chem binder", reviewed_by: "Dr. Lee" },
  { id: 103, kind: "cal_ver" as const, instrument_id: 1, analyte: "Glucose", performed_on: daysAgo(90), records_location: "Chem binder", reviewed_by: "Dr. Lee" },
  { id: 104, kind: "cal_ver" as const, instrument_id: 7, analyte: "Fibrinogen", performed_on: recent, records_location: "Coag binder", reviewed_by: "Dr. Lee" },
  { id: 105, kind: "method_comparison" as const, instrument_id: null, analyte: "Sodium", performed_on: daysAgo(30), records_location: "Correlation log", reviewed_by: "Dr. Lee" },
];
// A real VeritaCheck study on Glucose / Bonnie, signed and passing, NEWER than the outside record (should win);
// a real FAILED study on Potassium / Bonnie, OLDER than nothing (outside 102 is older still, so it does not help).
const studies = [
  { id: 900, test_name: "Glucose", instrument: "Ortho VITROS 5600 Bonnie", study_type: "cal_ver", status: "pass", lifecycle_state: "finalized", date: daysAgo(20), finalized_at: daysAgo(20) },
  { id: 901, test_name: "Sodium", instrument: "Ortho VITROS 5600 Bonnie", study_type: "cal_ver", status: "fail", lifecycle_state: "finalized", date: daysAgo(120), finalized_at: daysAgo(120) },
];

const r = computeCoverageFrom(instruments as any, combos as any, studies as any, outside);
const row = (id: number) => r.rows.find((x) => x.instrumentTestId === id)!;

const na = row(15);
check("1. an outside cal ver covers its instrument and analyte", na.linearityStatus === "covered" && na.outsideRecord?.id === 101, JSON.stringify(na));
check("2. it counts for 6 months from the date performed", na.nextDueOn === plus6mo(recent) && !na.overdue, `${na.nextDueOn} vs ${plus6mo(recent)}`);
check("3. its id is never listed as a study id", !na.studyIds.includes(101) && !na.studyIds.includes(0), JSON.stringify(na.studyIds));
check("4. it beats an older FAILED real study on the same instrument (study 901, 120 days ago)", na.linearityStatus === "covered", JSON.stringify(na));
check("5. it does not cover the second unit of the same model (Sodium on Clyde stays missing)", row(18).linearityStatus === "missing" && !row(18).outsideRecord, JSON.stringify(row(18)));
const k = row(19);
check("6. an outside record older than 6 months reads missing and overdue", k.linearityStatus === "missing" && k.overdue === true && k.outsideRecord?.id === 102, JSON.stringify(k));
const g = row(20);
check("7. a newer real signed study wins over an older outside record", g.linearityStatus === "covered" && g.outsideRecord === null && g.studyIds.includes(900), JSON.stringify(g));
check("8. an exempt row never shows an outside record", row(21).status === "exempt" && row(21).outsideRecord === null, JSON.stringify(row(21)));
const mc = r.methodComparisons.find((m) => m.analyte === "Sodium")!;
check("9. an outside correlation satisfies the method comparison for 6 months", !!mc && mc.outsideRecord?.id === 105 && mc.nextDueOn === plus6mo(daysAgo(30)) && !mc.overdue && mc.studyId === null, JSON.stringify(mc));
check("10. the summary counts it as done", r.summary.methodComparisonsDone === 1 && r.summary.linearityCovered === 2, JSON.stringify(r.summary));

// No outside records: identical to the call without the argument (no behavior change for labs that never use it).
const a = computeCoverageFrom(instruments as any, combos as any, studies as any);
const b = computeCoverageFrom(instruments as any, combos as any, studies as any, []);
check("11. with no outside records the result is unchanged", JSON.stringify(a) === JSON.stringify(b) && a.rows.every((x) => x.outsideRecord === null), "");
check("12. without the record, Sodium on Bonnie is missing (the record is what covered it)", a.rows.find((x) => x.instrumentTestId === 15)!.linearityStatus !== "covered", JSON.stringify(a.rows.find((x) => x.instrumentTestId === 15)));

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
