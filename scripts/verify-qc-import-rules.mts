// scripts/verify-qc-import-rules.mts
//
// Math and parsing receipt for reading QC results from a file (B12; shared/qcImportRules.ts). No database. Made-up values only.
// Run: npx tsx scripts/verify-qc-import-rules.mts
import * as rules from "../shared/qcImportRules";
// tsx gives this .ts as CommonJS under an .mts importer on some Node versions
const R: typeof rules = (rules as any).default ?? rules;

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const same = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const ET = "America/New_York";

// Names: case and spaces aside, and nothing else
check("names: case and spaces aside", R.nameKey(" Level  1 ") === R.nameKey("LEVEL1") && R.nameKey("Level 1") !== R.nameKey("Level-1") && R.nameKey("Na") !== R.nameKey("Na+"));

// Headers
same("headers: blank and repeated ones get a label", R.headerLabels(["Test", "", "Result", "result"], 5), ["Test", "Column B", "Result", "result (2)", "Column E"]);
same("column letters", [R.columnLetter(0), R.columnLetter(25), R.columnLetter(26), R.columnLetter(701)], ["A", "Z", "AA", "ZZ"]);
same("header row: the first with three or more cells", R.likelyHeaderRow([["QC export"], [], ["Made", "up"], ["Test", "Level", "Result"], ["Glucose", "1", "100"]]), 4);

// Patient columns are refused by name, and the columns a QC export has are not
const refused = ["Name", "Patient Name", "PatientID", "patient_id", "Pt Name", "PT_ID", "Last Name", "FIRST NAME", "MRN", "MRN#", "Med Rec No", "Medical Record Number", "DOB", "Birth Date", "Birthdate", "Date of Birth", "SSN", "Social Security #", "Accession", "Accession Number", "ACCN", "Acc No", "Encounter", "Sex", "Gender", "Age", "Patient"];
for (const h of refused) check(`refused column: ${h}`, R.patientColumn(["Test", h, "Result"]) === h, R.patientColumn(["Test", h, "Result"]));
const kept = ["Test", "Test Name", "Analyte Name", "Instrument", "Instrument Name", "Operator Name", "Control Name", "Level Name", "Lot No", "Sample ID", "Specimen ID", "Result", "Value", "Date/Time", "PT", "PT (sec)", "INR", "Comment", "Units", "Mean", "SD", "Reagent Lot", "Calibration Date", "File Name", "User", "Tech", "Acceptable", "Flag", "Name of control", "Percentage"];
for (const h of kept) check(`kept column: ${h}`, R.patientColumn([h]) === null, R.patientColumn([h]));

// Values
same("value: numbers and number text", ["100.5", " -2 ", "1e3", ".5", "+4", 7.25].map((v) => (R.readValue(v as any) as any).value), [100.5, -2, 1000, 0.5, 4, 7.25]);
for (const v of ["<5", "5.2 H", "1,234.5", "1,5", "", "  ", "NaN", "Infinity", "0x10", "--", null, { error: "#DIV/0!" }, { date: "2026-11-20", time: "" }, "POS"]) check(`value: not a number: ${JSON.stringify(v)}`, "error" in R.readValue(v as any));
same("value: Excel's binary tail is dropped at 15 digits", (R.readValue(0.1 + 0.2) as any).value, 0.3);

// Times
same("time: 24 hour, seconds, AM and PM, HHMM", ["7:05", "07:05:09", "07:05:00", "12:00 AM", "12:30 pm", "11:59 P.M.", "0715", "071530", "07:05:09.25"].map(R.readTime), ["07:05", "07:05:09", "07:05", "00:00", "12:30", "23:59", "07:15", "07:15:30", "07:05:09"]);
same("time: not a time", ["24:00", "7", "7:60", "13:00 PM", "0:30 AM", "noon", "7.5", "2460"].map(R.readTime), [null, null, null, null, null, null, null, null]);

// Dates
const when = (c: any, t: any = undefined, hasTime = false, order: any = "mdy", tz = ET) => R.readWhen(c, t, hasTime, order, tz) as any;
same("date: ISO, written as it stands", when("2026-11-20 07:15"), { date: "2026-11-20", time: "07:15" });
same("date: ISO with a T", when("2026-11-20T07:15:30"), { date: "2026-11-20", time: "07:15:30" });
same("date: month first", when("11/20/2026 7:15 PM"), { date: "2026-11-20", time: "19:15" });
same("date: day first", when("20/11/2026 19:15", undefined, false, "dmy"), { date: "2026-11-20", time: "19:15" });
same("date: the same text reads as the mapping says", [when("03/04/2026").date, when("03/04/2026", undefined, false, "dmy").date], ["2026-03-04", "2026-04-03"]);
check("date: month 20 isn't swapped, it's refused", "error" in when("20/11/2026"));
same("date: month names and two-digit years", [when("20-Nov-2026 07:15").date, when("20 Nov 26").date, when("Nov 20, 2026 7:15").time, when("11/20/26").date], ["2026-11-20", "2026-11-20", "07:15", "2026-11-20"]);
same("date: HL7", [when("20261120"), when("20261120071530"), when("202611200715")], [{ date: "2026-11-20", time: null }, { date: "2026-11-20", time: "07:15:30" }, { date: "2026-11-20", time: "07:15" }]);
same("date: year first with slashes", when("26/11/20", undefined, false, "ymd").date, "2026-11-20");
same("date: a Z or an offset becomes the lab's clock", [when("2026-11-21T01:30:00Z"), when("2026-11-21T01:30:00+01:00"), when("20261121013000-0800"), when("2026-07-21T01:30:00Z")],
  [{ date: "2026-11-20", time: "20:30" }, { date: "2026-11-20", time: "19:30" }, { date: "2026-11-21", time: "04:30" }, { date: "2026-07-20", time: "21:30" }]);
same("date: the same instant on another lab's clock", when("2026-11-21T01:30:00Z", undefined, false, "mdy", "Pacific/Honolulu"), { date: "2026-11-20", time: "15:30" });
same("date: an Excel date is the wall clock in the cell, whatever the lab's zone", [when({ date: "2026-11-20", time: "23:45" }), when({ date: "2026-11-20", time: "23:45" }, undefined, false, "mdy", "Pacific/Guam")], [{ date: "2026-11-20", time: "23:45" }, { date: "2026-11-20", time: "23:45" }]);
same("date: an Excel date with no time has none", when({ date: "2026-11-20", time: "" }), { date: "2026-11-20", time: null });
same("date: date and time in two columns", [when("11/20/2026", "07:15", true), when({ date: "2026-11-20", time: "" }, { date: "1899-12-30", time: "07:15" }, true), when("2026-11-20", 715, true)], [{ date: "2026-11-20", time: "07:15" }, { date: "2026-11-20", time: "07:15" }, { date: "2026-11-20", time: "07:15" }]);
for (const [c, t, h] of [["", undefined, false], ["soon", undefined, false], ["2026-02-30", undefined, false], [45981, undefined, false], [45981.3, undefined, false], ["13/13/2026", undefined, false], [{ error: "#N/A" }, undefined, false], [{ date: "1899-12-30", time: "07:15" }, undefined, false], ["2026-11-20", "", true], ["2026-11-20", "later", true], ["2026-11-20 07:15 EST", undefined, false], ["2026-11-20", 5, true]] as any[]) check(`date: refused ${JSON.stringify(c)} ${JSON.stringify(t ?? "")}`, "error" in when(c, t, h), when(c, t, h));
check("date: a bare number says to format the column", /Format the column as a date/.test(when(45981).error));

// CSV
same("csv: quotes, doubled quotes, commas and line breaks inside, blank rows kept in place", R.parseDelimited('a,b\r\n"x, ""y""","l1\nl2"\r\n\r\nc,d\r\n'), [["a", "b"], ['x, "y"', "l1\nl2"], [""], ["c", "d"]]);
same("csv: the separator the file uses", [R.csvDelimiter("a;b;c\n1,5;2;3"), R.csvDelimiter("a\tb\tc\n1\t2\t3"), R.csvDelimiter("a,b\n1,2"), R.csvDelimiter("a|b|c\n1|2|3")], [";", "\t", ",", "|"]);

// The mapping
const LONG = { layout: "long", headerRow: 1, dateOrder: "mdy", dateColumn: "Date", instrument: { column: "Instrument" }, analyte: { column: "Test" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumn: "Result", operatorColumn: "Tech", commentColumn: "Note" };
check("mapping: complete", !!R.readMapping(LONG).mapping);
check("mapping: says what is missing", /instrument; test \(analyte\)/.test(R.readMapping({ ...LONG, instrument: null, analyte: { column: "" } }).error ?? ""), R.readMapping({ ...LONG, instrument: null, analyte: { column: "" } }).error);
check("mapping: a wide file needs a level for every value column", /control level/.test(R.readMapping({ ...LONG, layout: "wide", level: null, valueColumns: [{ column: "L1", level: "Low" }, { column: "L2" }] }).error ?? ""));
check("mapping: a wide file with every value column saying its level", !!R.readMapping({ ...LONG, layout: "wide", level: null, valueColumns: [{ column: "L1", level: "Low" }, { column: "L2", level: "High" }] }).mapping);

// Long file
const longGrid = [["Date", "Instrument", "Test", "Level", "Lot", "Result", "Tech", "Note"], ["11/20/2026 07:15", "Analyzer A", "Glucose", "Low", "G1", "100", "JD", "repeat"], ["", "", "", "", "", "", "", ""], ["bad", "Analyzer A", "Glucose", "Low", "G1", "x", "", ""]] as any;
const lm = R.readMapping(LONG).mapping!;
const heads = R.headerLabels(longGrid[0], 8);
const runs = R.readRuns(longGrid, heads, lm, ET);
check("long: a blank row is skipped and row numbers are the file's", runs.length === 2 && runs[0].row === 2 && runs[1].row === 4, runs.map((r) => r.row));
same("long: what the first row reads as", { ...runs[0] }, { row: 2, instrument: "Analyzer A", when: { date: "2026-11-20", time: "07:15" }, operator: "JD", comment: "repeat", column: null, analyte: "Glucose", level: "Low", lot: "G1", value: { value: 100 } });
check("long: each bad part keeps its own reason", "error" in runs[1].when && "error" in runs[1].value);
same("missing columns are named", R.missingColumns(lm, ["Date", "instrument", "TEST", "Level", "Lot"]), ["Result", "Tech", "Note"]);

// Wide by analyte, wide by level, and fixed text
const wideA = R.readMapping({ layout: "wide", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { fixed: "Analyzer A" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumns: [{ column: "Glucose", analyte: "Glucose" }, { column: "Sodium", analyte: "Sodium" }] }).mapping!;
const ga = [["When", "Level", "Lot", "Glucose", "Sodium"], ["11/20/2026 07:15", "Low", "45921", "100", "140"], ["11/21/2026 07:15", "Low", "45921", "", "141"]] as any;
const ra = R.readRuns(ga, R.headerLabels(ga[0], 5), wideA, ET);
same("wide by analyte: one run per value, a blank cell is no run", ra.map((r) => [r.row, r.column, r.analyte, r.level, r.lot, (r.value as any).value, r.instrument]), [[2, "Glucose", "Glucose", "Low", "45921", 100, "Analyzer A"], [2, "Sodium", "Sodium", "Low", "45921", 140, "Analyzer A"], [3, "Sodium", "Sodium", "Low", "45921", 141, "Analyzer A"]]);
const wideL = R.readMapping({ layout: "wide", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { column: "Inst" }, analyte: { column: "Test" }, valueColumns: [{ column: "L1", level: "Low", lot: "G1" }, { column: "L2", level: "High", lot: "G2" }] }).mapping!;
const gl = [["When", "Inst", "Test", "L1", "L2"], ["11/20/2026", "Analyzer A", "Glucose", "100", "300"]] as any;
same("wide by level: each value column says its level and lot", R.readRuns(gl, R.headerLabels(gl[0], 5), wideL, ET).map((r) => [r.analyte, r.level, r.lot, (r.value as any).value]), [["Glucose", "Low", "G1", 100], ["Glucose", "High", "G2", 300]]);

// Times compared
check("same time: to the second when both give seconds, else to the minute, none only with none",
  R.sameTime("07:15", "07:15:40") && R.sameTime("07:15:40", "07:15:40") && !R.sameTime("07:15:40", "07:15:41") && !R.sameTime("07:15", "07:16") && R.sameTime(null, "") && !R.sameTime(null, "07:15"));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
