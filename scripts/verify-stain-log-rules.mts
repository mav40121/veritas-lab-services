// scripts/verify-stain-log-rules.mts
// Receipt for shared/stainLogRules.ts: every branch of the stain log's rules on a fixed input set. Exits non-zero on any failure.
import {
  addDays, cleanInitials, cleanManualEntry, cleanRow, codeMark, codesForKind, dailyShortDays, detectStainPhi, findStainPhi, lastOfMonth, manualMonthFindings, monthDays, planRowEntries,
  rowInUseFrom, rowScheduleLabel, rowShownInMonth, shiftMonth, stainMonthFindings, stainPhiMessage, STAIN_NO_PHI_NOTICE, type FindingEntry, type FindingRow,
} from "../shared/stainLogRules";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const J = (v: unknown) => JSON.stringify(v);

// ── Rows ──
check("a stain row as needed saves with no code", J(cleanRow({ name: " Hematoxylin ", row_kind: "stain", frequency: "as_needed", required_code: "C" }).row) === J({ name: "Hematoxylin", row_kind: "stain", frequency: "as_needed", required_code: null }));
check("a row with no type or frequency is a stain row, as needed", J(cleanRow({ name: "Eosin" }).row) === J({ name: "Eosin", row_kind: "stain", frequency: "as_needed", required_code: null }));
check("a daily solution row keeps its code", cleanRow({ name: "Water", row_kind: "solution", frequency: "daily", required_code: "C" }).row?.required_code === "C");
check("a monthly stain row keeps its code", cleanRow({ name: "Eosin", row_kind: "stain", frequency: "monthly", required_code: "D" }).row?.required_code === "D");
check("a daily row needs a code", /each day/.test(cleanRow({ name: "Water", row_kind: "solution", frequency: "daily" }).error || ""));
check("a monthly row needs a code", /each month/.test(cleanRow({ name: "Eosin", row_kind: "stain", frequency: "monthly" }).error || ""));
check("a check never names a code", cleanRow({ name: "Slide quality", row_kind: "check", frequency: "daily", required_code: "C" }).row?.required_code === null);
check("no name is refused", !!cleanRow({ name: "  " }).error);
check("a long name is refused", !!cleanRow({ name: "x".repeat(81) }).error);
check("an 80 character name saves", !!cleanRow({ name: "x".repeat(80) }).row);
check("an unknown type is refused", !!cleanRow({ name: "x", row_kind: "other" }).error);
check("an unknown frequency is refused", !!cleanRow({ name: "x", frequency: "weekly" }).error);
check("a code that doesn't exist is refused", !!cleanRow({ name: "x", frequency: "daily", required_code: "X" }).error);
check("schedule labels", rowScheduleLabel({ frequency: "daily", required_code: "C" }) === "C daily" && rowScheduleLabel({ frequency: "monthly", required_code: "D" }) === "D monthly" && rowScheduleLabel({ frequency: "daily" }) === "Daily" && rowScheduleLabel({ frequency: "monthly" }) === "Monthly" && rowScheduleLabel({ frequency: "as_needed" }) === "As needed");
check("marks", codeMark("OK") === "✓" && codeMark("PROBLEM") === "!" && codeMark("TO") === "TO");
check("a check takes Acceptable or Problem; the others take the five codes", J(codesForKind("check")) === J(["OK", "PROBLEM"]) && J(codesForKind("stain")) === J(["D", "C", "F", "TO", "R"]) && J(codesForKind("solution")) === J(["D", "C", "F", "TO", "R"]));

// ── Initials ──
check("initials are trimmed and upper case", cleanInitials(" mu ").initials === "MU");
check("no initials are refused", !!cleanInitials("  ").error);
check("eight characters save, nine don't", !!cleanInitials("ABCDEFGH").initials && !!cleanInitials("ABCDEFGHI").error);

// ── A day's entry on a row ──
const D = "2026-09-10";
const stain = { row_kind: "stain" }, solution = { row_kind: "solution" }, chk = { row_kind: "check" };
const lot = { lot_number: "L1", expiration_date: "2027-01-01" };
check("a change to a stain with lot and expiration saves with both", J(planRowEntries(stain, { codes: ["C"], ...lot }, D).entries) === J([{ code: "C", lot_number: "L1", expiration_date: "2027-01-01", lot_expired: 0, corrective_action: null }]));
check("a change to a stain with no lot is refused", planRowEntries(stain, { codes: ["C"], expiration_date: "2027-01-01" }, D).code === "LOT_REQUIRED");
check("a change to a stain with no expiration is refused", planRowEntries(stain, { codes: ["C"], lot_number: "L1" }, D).code === "LOT_REQUIRED");
check("a change to water needs no lot", planRowEntries(solution, { codes: ["C"] }, D).entries?.[0].lot_number === null);
check("water can carry a lot if there is one", planRowEntries(solution, { codes: ["C"], ...lot }, D).entries?.[0].lot_number === "L1");
check("a top-off needs no lot", planRowEntries(stain, { codes: ["TO"] }, D).entries?.[0].code === "TO");
check("a top-off can carry one", planRowEntries(stain, { codes: ["TO"], ...lot }, D).entries?.[0].lot_number === "L1");
check("half a lot on a top-off is refused", planRowEntries(stain, { codes: ["TO"], lot_number: "L1" }, D).code === "LOT_REQUIRED" && planRowEntries(stain, { codes: ["TO"], expiration_date: "2027-01-01" }, D).code === "LOT_REQUIRED");
check("a lot on a dump or a rotate is refused", planRowEntries(stain, { codes: ["D"], ...lot }, D).code === "BAD_LOT" && planRowEntries(stain, { codes: ["R"], ...lot }, D).code === "BAD_LOT");
const dumpChange = planRowEntries(stain, { codes: ["D", "C"], ...lot }, D).entries!;
check("dumped and changed the same day: two entries, the lot on the change only", dumpChange.length === 2 && dumpChange[0].code === "D" && dumpChange[0].lot_number === null && dumpChange[1].code === "C" && dumpChange[1].lot_number === "L1");
check("no code is refused", planRowEntries(stain, { codes: [] }, D).code === "NO_CODE" && planRowEntries(stain, {}, D).code === "NO_CODE");
check("a code from the other list is refused", planRowEntries(stain, { codes: ["OK"] }, D).code === "BAD_CODE" && planRowEntries(chk, { codes: ["C"] }, D).code === "BAD_CODE");
check("a code twice is refused", planRowEntries(stain, { codes: ["F", "F"] }, D).code === "BAD_CODE");
check("a lot past its expiration needs the corrective action", planRowEntries(stain, { codes: ["C"], lot_number: "L1", expiration_date: "2026-09-09" }, D).code === "CORRECTIVE_ACTION_REQUIRED");
const expired = planRowEntries(stain, { codes: ["C"], lot_number: "L1", expiration_date: "2026-09-09", corrective_action: "Replaced at 14:00" }, D).entries?.[0];
check("and with it, it's recorded as expired", expired?.lot_expired === 1 && expired?.corrective_action === "Replaced at 14:00");
check("a lot expiring that day isn't expired", planRowEntries(stain, { codes: ["C"], lot_number: "L1", expiration_date: D }, D).entries?.[0].lot_expired === 0);
check("an expiration that isn't a date is refused", planRowEntries(stain, { codes: ["C"], lot_number: "L1", expiration_date: "soon" }, D).code === "BAD_EXPIRATION");
check("a long lot and a long action are refused", planRowEntries(stain, { codes: ["C"], lot_number: "x".repeat(61), expiration_date: "2027-01-01" }, D).code === "BAD_LOT" && planRowEntries(stain, { codes: ["F"], corrective_action: "x".repeat(2001) }, D).code === "TOO_LONG");
check("a check saves Acceptable", planRowEntries(chk, { codes: ["OK"] }, D).entries?.[0].code === "OK");
check("a Problem needs the corrective action", planRowEntries(chk, { codes: ["PROBLEM"] }, D).code === "CORRECTIVE_ACTION_REQUIRED");
check("and saves with it", planRowEntries(chk, { codes: ["PROBLEM"], corrective_action: "Re-stained" }, D).entries?.[0].corrective_action === "Re-stained");
check("a check can't be both", planRowEntries(chk, { codes: ["OK", "PROBLEM"], corrective_action: "x" }, D).code === "BAD_CODE");
check("a check has no lot", planRowEntries(chk, { codes: ["OK"], ...lot }, D).code === "BAD_LOT");

// ── Manual ──
const m = { log_date: D, specimen_type: "Frozen section", result: "good" };
check("a good stain saves", cleanManualEntry(m).entry?.result === "good" && cleanManualEntry(m).entry?.test_slide === 0);
check("a test slide is marked", cleanManualEntry({ ...m, test_slide: true }).entry?.test_slide === 1 && cleanManualEntry({ ...m, test_slide: 1 }).entry?.test_slide === 1 && cleanManualEntry({ ...m, test_slide: "yes" }).entry?.test_slide === 0);
check("no date is refused", cleanManualEntry({ ...m, log_date: "" }).code === "BAD_DATE");
check("no type is refused", cleanManualEntry({ ...m, specimen_type: " " }).code === "TYPE_REQUIRED");
check("a long type is refused", cleanManualEntry({ ...m, specimen_type: "x".repeat(81) }).code === "TOO_LONG");
check("no result is refused", cleanManualEntry({ ...m, result: "" }).code === "RESULT_REQUIRED");
check("a problem needs the corrective action", cleanManualEntry({ ...m, result: "problem" }).code === "CORRECTIVE_ACTION_REQUIRED");
check("and saves with it", cleanManualEntry({ ...m, result: "problem", comments: "Re-stained" }).entry?.comments === "Re-stained");
check("a long comment is refused", cleanManualEntry({ ...m, comments: "x".repeat(2001) }).code === "TOO_LONG");
check("a specimen number passed in isn't kept", !("specimen_number" in (cleanManualEntry({ ...m, specimen_number: "A1" }).entry as any)));

// ── No PHI ──
check("a labeled MRN is caught", detectStainPhi("MRN: 00482913").includes("Medical record number"));
check("a labeled patient is caught", detectStainPhi("Patient: Jane Doe").includes("Labeled patient name"));
check("a labeled date of birth is caught", detectStainPhi("DOB 3/14/1961").includes("Date of birth"));
for (const t of ["Specimen # S26-1234", "specimen number 44", "specimen no. 12", "specimen id A1", "accession 12345", "Accession #: S26-1", "case # 5", "case number FS26-100"]) check(`a labeled specimen number is caught: ${t}`, detectStainPhi(t).includes("Specimen number"));
for (const t of ["Frozen section", "Touch preparation", "Patient not affected", "Re-stained, no impact on patient testing", "Lot AB-1234", "Specimen type: breast", "In case of spills", "Changed at 14:00"]) check(`ordinary text isn't caught: ${t}`, detectStainPhi(t).length === 0, J(detectStainPhi(t)));
check("empty text isn't caught", detectStainPhi("").length === 0 && detectStainPhi(null).length === 0);
check("a body search finds it in a list, and says the field", J(findStainPhi({ items: [{ codes: ["F"], corrective_action: "MRN: 123456" }] })) === J({ field: "items[0].corrective_action", labels: ["Medical record number"] }));
check("a clean body passes", findStainPhi({ items: [{ codes: ["F"], row_id: 1, ok: true }], initials: "MU" }) === null);
check("the refusal says what it looks like, not the text", /medical record number/.test(stainPhiMessage(["Medical record number"])) && /patient name/.test(stainPhiMessage(["Labeled patient name"])) && !/00482913/.test(stainPhiMessage(["Medical record number"])));
check("the notice names specimen numbers and the LIS", /specimen or accession number/.test(STAIN_NO_PHI_NOTICE) && /LIS/.test(STAIN_NO_PHI_NOTICE));

// ── Calendar ──
check("calendar", addDays("2026-09-30", 1) === "2026-10-01" && lastOfMonth("2028-02") === "2028-02-29" && lastOfMonth("2026-09") === "2026-09-30" && monthDays("2026-09").length === 30 && monthDays("2026-09")[29] === "2026-09-30" && shiftMonth("2026-01", -1) === "2025-12" && shiftMonth("2026-12", 1) === "2027-01");

// ── Which rows show, and from when ──
const row = (over: Partial<FindingRow>): FindingRow => ({ id: 1, name: "Row", row_kind: "stain", frequency: "as_needed", required_code: null, created_at: "2026-01-01T00:00:00.000Z", active: 1, retired_at: null, first_entry_day: null, ...over });
check("a row is in use from when it was added", rowInUseFrom(row({})) === "2026-01-01");
check("or from its first entry, if older logs were back-entered", rowInUseFrom(row({ created_at: "2026-11-01T00:00:00.000Z", first_entry_day: "2026-06-05" })) === "2026-06-05");
check("a later first entry doesn't move it", rowInUseFrom(row({ first_entry_day: "2026-06-05" })) === "2026-01-01");
check("an active row shows on any month", rowShownInMonth(row({ created_at: "2026-11-01T00:00:00.000Z" }), "2026-06", false));
check("a retired row shows in the month it retired", rowShownInMonth(row({ active: 0, retired_at: "2026-09-15" }), "2026-09", false));
check("not after it", !rowShownInMonth(row({ active: 0, retired_at: "2026-09-15" }), "2026-10", false));
check("unless it holds entries", rowShownInMonth(row({ active: 0, retired_at: "2026-09-15" }), "2026-10", true));

// ── Daily rows ──
const e = (row_id: number, log_date: string, code: string, over: Partial<FindingEntry> = {}): FindingEntry => ({ row_id, log_date, code, created_at: `${log_date}T12:00:00.000Z`, ...over });
const T = "2026-11-06";
const daily = row({ id: 2, name: "Water", row_kind: "solution", frequency: "daily", required_code: "C" });
const entries = [e(2, "2026-09-01", "C"), e(1, "2026-09-02", "F"), e(2, "2026-09-03", "TO")];
const used = ["2026-09-01", "2026-09-02", "2026-09-03"];
check("a daily row is short on a day in use with nothing on it, and on a day with the wrong code", J(dailyShortDays(daily, entries, used, T)) === J(["2026-09-02", "2026-09-03"]));
check("a day nobody recorded anything isn't short", !dailyShortDays(daily, entries, used, T).includes("2026-09-04"));
check("today isn't short yet", J(dailyShortDays(daily, [e(1, T, "F")], [T], T)) === J([]));
check("yesterday is", J(dailyShortDays(daily, [e(1, "2026-11-05", "F")], ["2026-11-05"], T)) === J(["2026-11-05"]));
check("a day before the row was in use isn't short", J(dailyShortDays(row({ ...daily, created_at: "2026-09-03T00:00:00.000Z" }), entries, used, T)) === J(["2026-09-03"]));
check("a day from its retirement on isn't short", J(dailyShortDays(row({ ...daily, active: 0, retired_at: "2026-09-03" }), entries, used, T)) === J(["2026-09-02"]));
check("an as-needed row is never short", J(dailyShortDays(row({ id: 2 }), entries, used, T)) === J([]));
const dailyCheck = row({ id: 3, name: "Slide quality", row_kind: "check", frequency: "daily" });
check("a daily check counts whichever way it was answered", J(dailyShortDays(dailyCheck, [e(3, "2026-09-01", "PROBLEM"), e(3, "2026-09-02", "OK"), e(1, "2026-09-03", "F")], used, T)) === J(["2026-09-03"]));

// ── The month ──
const find = (over: Partial<Parameters<typeof stainMonthFindings>[0]>) => stainMonthFindings({ rows: [], entries: [], priorChanges: [], voided: 0, month: "2026-09", today: T, ...over });
check("a log with nothing in the month shows nothing", J(find({ rows: [daily] }).problems) === J([]) && J(find({ rows: [daily] }).notes) === J([]));
const f1 = find({ rows: [row({}), daily], entries });
check("a short daily row is a problem, by date", f1.problems.length === 1 && /Water: 2 days in use with no C recorded: 9\/2, 9\/3/.test(f1.problems[0]), J(f1.problems));
check("the month's days on the log are noted", f1.notes.includes("3 days on the stain log"), J(f1.notes));
check("the days with nothing recorded are noted, not a problem", f1.notes.some((n) => /^27 days with nothing on the stain log: 9\/4, 9\/5/.test(n)), J(f1.notes));
const dailyAny = find({ rows: [row({}), dailyCheck], entries: [e(1, "2026-09-02", "F")] });
check("a daily check short says no entry", /Slide quality: 1 day in use with no entry: 9\/2/.test(dailyAny.problems[0] || ""), J(dailyAny.problems));
const dates = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const longList = find({ rows: [row({}), daily], entries: dates.map((d) => e(1, d, "F")) });
check("a long list stops at eight dates", /9\/8 and more$/.test(longList.problems[0]), J(longList.problems));

const monthly = row({ id: 4, name: "Eosin", frequency: "monthly", required_code: "D" });
const m1 = find({ rows: [monthly], entries: [e(4, "2026-09-02", "F")] });
check("a monthly row with nothing in a finished month is a problem", m1.problems.length === 1 && /Eosin: no D \(dumped\) recorded this month/.test(m1.problems[0]), J(m1.problems));
check("the code it needs clears it", find({ rows: [monthly], entries: [e(4, "2026-09-02", "D")] }).problems.length === 0);
check("the month isn't over yet: no problem", find({ rows: [monthly], entries: [e(4, "2026-11-02", "F")], month: "2026-11" }).problems.length === 0);
check("the last day of the month is still not over", find({ rows: [monthly], entries: [e(4, "2026-09-02", "F")], today: "2026-09-30" }).problems.length === 0);
check("the day after, it is", find({ rows: [monthly], entries: [e(4, "2026-09-02", "F")], today: "2026-10-01" }).problems.length === 1);
check("a month the instrument wasn't used: no problem", find({ rows: [monthly] }).problems.length === 0);
check("a row added during the month isn't held to it", find({ rows: [row({ ...monthly, created_at: "2026-09-15T00:00:00.000Z" }), row({})], entries: [e(1, "2026-09-20", "F")] }).problems.length === 0);
check("a row added on the first is", find({ rows: [row({ ...monthly, created_at: "2026-09-01T00:00:00.000Z" }), row({})], entries: [e(1, "2026-09-20", "F")] }).problems.length === 1);
check("a row retired before the month ended isn't held to it", find({ rows: [row({ ...monthly, active: 0, retired_at: "2026-09-20" }), row({})], entries: [e(1, "2026-09-02", "F")] }).problems.length === 0);
check("one retired after it ended is", find({ rows: [row({ ...monthly, active: 0, retired_at: "2026-10-05" }), row({})], entries: [e(1, "2026-09-02", "F")] }).problems.length === 1);
const monthlyCheck = find({ rows: [row({ id: 5, name: "Deep clean", row_kind: "check", frequency: "monthly" }), row({})], entries: [e(1, "2026-09-02", "F")] });
check("a monthly check says nothing recorded", /Deep clean: nothing recorded this month/.test(monthlyCheck.problems[0] || ""), J(monthlyCheck.problems));

// ── A lot past its expiration ──
const hema = row({ id: 6, name: "Hematoxylin" });
const change = (date: string, lotNo: string, exp: string, over: Partial<FindingEntry> = {}) => e(6, date, "C", { lot_number: lotNo, expiration_date: exp, ...over });
const x1 = find({ rows: [hema], entries: [change("2026-09-01", "L1", "2026-09-03"), e(6, "2026-09-03", "F"), e(6, "2026-09-04", "F"), e(6, "2026-09-05", "F")] });
check("a lot in use past its expiration is a problem, with its days", x1.problems.length === 1 && /Hematoxylin: lot L1 expired 2026-09-03 and was in use on 2 days after that: 9\/4, 9\/5/.test(x1.problems[0]), J(x1.problems));
const x2 = find({ rows: [hema], entries: [change("2026-09-01", "L1", "2026-09-03"), e(6, "2026-09-04", "F"), change("2026-09-05", "L2", "2027-01-01"), e(6, "2026-09-06", "F")] });
check("a new lot ends it", x2.problems.length === 1 && /on 1 day after that: 9\/4/.test(x2.problems[0]), J(x2.problems));
const x3 = find({ rows: [hema], priorChanges: [change("2026-08-20", "L0", "2026-09-02")], entries: [e(6, "2026-09-04", "F")] });
check("a lot put in last month and expiring this month is seen", x3.problems.length === 1 && /lot L0 expired 2026-09-02/.test(x3.problems[0]), J(x3.problems));
check("the day it expires is still good", find({ rows: [hema], priorChanges: [change("2026-08-20", "L0", "2026-09-04")], entries: [e(6, "2026-09-04", "F")] }).problems.length === 0);
const x4 = find({ rows: [hema], entries: [change("2026-09-01", "L1", "2026-08-01", { lot_expired: 1, corrective_action: "Replaced that day" }), e(6, "2026-09-02", "F")] });
check("a lot already expired when it went in has its action, so it's shown and doesn't force another", x4.problems.length === 0 && x4.notes.includes("1 entry with an expired lot, each with its corrective action"), J(x4));
const x5 = find({ rows: [row({ ...hema, active: 0, retired_at: "2026-09-04" })], entries: [change("2026-09-01", "L1", "2026-09-02"), e(6, "2026-09-03", "F"), e(6, "2026-09-05", "F")] });
check("a retired row stops counting from the day it retired", x5.problems.length === 1 && /on 1 day after that: 9\/3/.test(x5.problems[0]), J(x5.problems));
check("a solution row's expiration isn't checked", find({ rows: [row({ id: 6, name: "Rinse", row_kind: "solution" })], entries: [change("2026-09-01", "L1", "2026-08-01"), e(6, "2026-09-02", "F")] }).problems.length === 0);

// ── Notes ──
const n1 = find({ rows: [row({}), row({ id: 3, name: "Slide quality", row_kind: "check" })], voided: 2, entries: [
  e(1, "2026-09-01", "C"), e(1, "2026-09-02", "C"), e(3, "2026-09-02", "PROBLEM", { corrective_action: "Re-stained" }),
  e(1, "2026-09-03", "F", { created_at: "2026-09-05T23:59:00.000Z" }), e(1, "2026-09-04", "F", { created_at: "2026-09-07T00:00:00.000Z" }),
] });
check("changes are counted", n1.notes.includes("2 stain or solution changes"), J(n1.notes));
check("a check marked Problem is shown, not forced", n1.notes.includes("1 check marked Problem, each with its corrective action") && n1.problems.length === 0, J(n1));
check("an entry more than 2 days late is called out, and one 2 days late isn't", n1.notes.includes("1 stain log entry added more than 2 days after the date") && n1.summary.entered_late === 1, J(n1.notes));
check("voids are counted", n1.notes.includes("2 stain log entries voided, with the reason") && n1.summary.voided === 2, J(n1.notes));
const startLate = find({ rows: [row({ created_at: "2026-09-20T00:00:00.000Z" })], entries: [e(1, "2026-09-21", "F")] });
check("days before the log started aren't called quiet", startLate.notes.some((n) => /^10 days with nothing on the stain log: 9\/20, 9\/22/.test(n)), J(startLate.notes));
const current = find({ rows: [row({})], entries: [e(1, "2026-11-05", "F")], month: "2026-11" });
check("in the current month, quiet days stop at yesterday", current.notes.some((n) => /^4 days with nothing on the stain log: 11\/1, 11\/2, 11\/3, 11\/4$/.test(n)), J(current.notes));

// ── Manual month ──
const mm = manualMonthFindings([
  { result: "good", log_date: "2026-09-01", created_at: "2026-09-01T12:00:00.000Z" },
  { result: "problem", log_date: "2026-09-02", test_slide: 1, created_at: "2026-09-09T12:00:00.000Z" },
], 1);
check("the manual month counts stains, test slides, problems, late entries and voids", J(mm.notes) === J(["2 manual stains", "1 test slide", "1 problem, each with its corrective action", "1 entry added more than 2 days after the date", "1 entry voided, with the reason"]), J(mm.notes));
check("a clean manual month says only the count", J(manualMonthFindings([{ result: "good", log_date: "2026-09-01", created_at: "2026-09-01T12:00:00.000Z" }], 0).notes) === J(["1 manual stain"]));

console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
