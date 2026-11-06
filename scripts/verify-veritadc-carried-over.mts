// scripts/verify-veritadc-carried-over.mts
//
// Receipt for the pure rules of the VeritaDC bulk load (shared/policyCarriedOver.ts, scripts/veritadc-load-plan.mts): title
// cleaning, dates, versions, which rows load, which lab and manual each goes in, and which review notice applies. Every
// title and path here is made up. Exits non-zero on any failure.
//   npm run verify:veritadc-carried-over
import { carriedOverNotice, cleanCarriedTitle, isRealIsoDate, parseSourceVersion, reminderDays, reminderTypeForDays, titleLooksUnclear, usDateToIso, validateCarriedMeta } from "../shared/policyCarriedOver";
import { csvCell, datesFor, parseCsv, placementsFor, reviewGapMonths, selectByStatus, splitPaths, titleFromFacePage, type LoadConfig } from "./veritadc-load-plan.mts";

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  :: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}

// Titles: extensions and copy markers come off, nothing else changes.
const t = (s: string) => cleanCarriedTitle(s).title;
eq("title: copy marker", t("Madeup Assay (2)"), "Madeup Assay");
eq("title: extension", t("MADEUP II.doc"), "MADEUP II");
eq("title: extension the export wrote with a dash", t("MADEUP II-doc"), "MADEUP II");
eq("title: counted extension and marker together", t("Whole Blood Method 100i-docx02 (1)"), "Whole Blood Method 100i");
eq("title: dotted form of the same", t("Whole Blood Method 100i.docx02 (1)"), "Whole Blood Method 100i");
eq("title: marker with spaces before it", t("Madeup Acid  (1)"), "Madeup Acid");
eq("title: every extension form", ["a b.pdf", "a b.PPT", "a b.xlsx", "a b.html", "a b.rtf", "a b.txt"].map(t), ["a b", "a b", "a b", "a b", "a b", "a b"]);
eq("title: inner spacing is left alone", t("NA  K  CL for Gen 2"), "NA  K  CL for Gen 2");
eq("title: a number that isn't a marker stays", t("Madeup Tissue 002"), "Madeup Tissue 002");
eq("title: a version in the name stays", t("Madeup v 2.0"), "Madeup v 2.0");
eq("title: a dash in the name stays", t("Chain-of-custody"), "Chain-of-custody");
eq("title: parentheses that aren't a marker stay", t("Quality Control (QC)"), "Quality Control (QC)");
eq("title: nothing to do reports no change", cleanCarriedTitle("Madeup Policy").changed, false);
eq("title: a change is reported", cleanCarriedTitle("Madeup Policy (1)").changed, true);
eq("title: a title that is only a marker doesn't go blank", t("(1)"), "(1)");

// What's still unclear is flagged, not rewritten.
eq("unclear: catalog number", titleLooksUnclear("ALB2 8056722190"), "catalog or file number in the title");
eq("unclear: very short", titleLooksUnclear("OXY"), "very short");
eq("unclear: file counter", titleLooksUnclear("Madeup Tissue 002"), "ends in a file counter");
eq("unclear: a plain title is fine", titleLooksUnclear("Direct Bilirubin"), null);

// Dates and versions.
eq("date: one digit month and day", usDateToIso("3/9/2026"), "2026-03-09");
eq("date: blank", usDateToIso(""), null);
eq("date: not a real day", usDateToIso("2/31/2026"), null);
eq("date: not a date", usDateToIso("soon"), null);
eq("iso: real", isRealIsoDate("2026-11-13"), true);
eq("iso: not real", isRealIsoDate("2026-13-01"), false);
eq("version: 2.1", parseSourceVersion("2.1"), { major: 2, minor: 1 });
eq("version: 1.0", parseSourceVersion("1.0"), { major: 1, minor: 0 });
eq("version: no zero major", parseSourceVersion("0.1"), null);
eq("version: one number isn't a version", parseSourceVersion("3"), null);
const d = datesFor({ version: "1.1", effective_date: "9/17/2026", last_approval_or_review: "", next_review_due: "bad" });
eq("dates: effective read, blank stays null, a bad one is named", [d.effectiveDate, d.lastApprovalOrReview, d.badDates], ["2026-09-17", null, ["next_review_due"]]);
eq("gap: 12 months", reviewGapMonths("2026-01-15", "2027-01-15"), 12);
eq("gap: unknown without both dates", reviewGapMonths(null, "2027-01-15"), null);

// Which rows load.
eq("status: current loads", selectByStatus("approved and current", false), "load");
eq("status: current in any case", selectByStatus("Approved And Current ", false), "load");
eq("status: retired stays out", selectByStatus("retired", true), "retired");
eq("status: in review stays out", selectByStatus("in review", true), "not_current");
eq("status: being edited stays out", selectByStatus("being edited", true), "not_current");
eq("status: past review date stays out without the flag", selectByStatus("past periodic review date (1/2/2026", false), "past_due_excluded");
eq("status: past review date loads with the flag", selectByStatus("past periodic review date (1/2/2026", true), "load");

// Which lab and manual.
const config: LoadConfig = {
  batch: "made-up", sourceSystem: "OldSystem", loadedBy: "Made Up Loader", ownerUserId: 1, reviewIntervalMonths: 12,
  labs: { "1": { expectedLabName: "Made Up One" }, "2": { expectedLabName: "Made Up Two" } },
  topLevel: { "North Lab": [1], "North IQCP": [1], "South Lab": [2], "Shared General": [1, 2] },
};
eq("split: paths", splitPaths("A / B || C"), [["A", "B"], ["C"]]);
const one = placementsFor("North Lab / Chem / Analyzer", config);
eq("place: one lab, its full path", one.placements, [{ labId: 1, manualPath: ["North Lab", "Chem", "Analyzer"], alsoFiledIn: [] }]);
const both = placementsFor("North Lab / Chem || South Lab / Chem", config);
eq("place: filed in both labs goes in both", both.placements.map((p) => p.labId), [1, 2]);
eq("place: each lab's record names the other filing", both.placements[0].alsoFiledIn, ["South Lab / Chem"]);
const deep = placementsFor("South Lab || South Lab / Chem", config);
eq("place: the deepest folder in a lab wins, the other is kept", deep.placements, [{ labId: 2, manualPath: ["South Lab", "Chem"], alsoFiledIn: ["South Lab"] }]);
const shared = placementsFor("Shared General", config);
eq("place: a shared manual goes in every lab", shared.placements.map((p) => [p.labId, p.manualPath.join("/")]), [[1, "Shared General"], [2, "Shared General"]]);
const sharedWins = placementsFor("North Lab / Chem / Deep || South Lab / Spec || Shared General", config);
eq("place: a shared folder wins in each lab even over a deeper one", sharedWins.placements.map((p) => p.manualPath.join("/")), ["Shared General", "Shared General"]);
const none = placementsFor("", config);
eq("place: no folder, no placement", none.placements, []);
const unknown = placementsFor("Somewhere Else / X", config);
eq("place: an unknown top-level folder is reported, never guessed", unknown, { placements: [], unmapped: ["Somewhere Else / X"] });

// Reading the title off a face page.
eq("face title: number comes off", titleFromFacePage("<html><h1>AB 12 Madeup Policy (2)</h1></html>", "AB 12"), "Madeup Policy (2)");
eq("face title: tags and entities", titleFromFacePage("<h1 class='x'>AB 12 <b>Tom &amp; Jerry</b></h1>", "AB 12"), "Tom & Jerry");
eq("face title: a different number means no title", titleFromFacePage("<h1>ZZ 9 Other</h1>", "AB 12"), "");
eq("face title: no heading", titleFromFacePage("<p>none</p>", "AB 12"), "");

// CSV.
eq("csv: quotes, commas, a BOM", parseCsv('﻿a,b\n"x, y","he said ""hi"""\n'), [{ a: "x, y", b: 'he said "hi"' }]);
eq("csv: a cell is quoted when it must be", csvCell('a,"b'), '"a,""b"');

// The record must hold what the rule requires.
const good = {
  labId: 1, expectedLabName: "Made Up One", ownerUserId: 1, batch: "b", loadedBy: "x", sourceSystem: "OldSystem", docNumber: " AB   12 ", title: "T",
  version: "2.1", effectiveDate: "2025-01-02", lastApprovalOrReview: null, nextReviewDue: "2027-01-02", reviewIntervalMonths: 12, remindersStartOn: "2026-11-10", manualPath: ["A"],
};
const okMeta = validateCarriedMeta(good);
eq("meta: a good record passes, number cleaned", okMeta.ok && okMeta.value.docNumber, "AB 12");
const refused = (patch: Record<string, unknown>) => { const r = validateCarriedMeta({ ...good, ...patch }); return r.ok ? [] : r.problems; };
eq("meta: no effective date is refused", refused({ effectiveDate: null }), ["effectiveDate"]);
eq("meta: no reminder start is refused", refused({ remindersStartOn: undefined }), ["remindersStartOn"]);
eq("meta: a bad version is refused", refused({ version: "x" }), ["version"]);
eq("meta: a review date with no interval is refused", refused({ reviewIntervalMonths: 0 }), ["reviewIntervalMonths: a review date needs an interval"]);
eq("meta: no review date can have no interval", refused({ nextReviewDue: null, reviewIntervalMonths: 0 }), []);
eq("meta: an empty manual path is refused", refused({ manualPath: [] }), ["manualPath"]);
eq("meta: a bad converted type is refused", refused({ convertedFrom: "exe" }), ["convertedFrom"]);

// Notices.
eq("notice: the usual sequence", [31, 30, 1, 0, -1, -29, -30, -59, -60].map(reminderTypeForDays), [null, "30_day_warning", "30_day_warning", "overdue", "overdue", "overdue", "final", "final", null]);
eq("days: an ordinary document counts from its date", reminderDays("2026-11-10", "2026-11-13"), 3);
eq("days: an old date with no load date keeps its real count", reminderDays("2026-11-10", "2026-05-08"), -186);
eq("days: arrived past due counts from arrival", reminderDays("2026-11-10", "2026-05-08", "2026-11-09"), -1);
eq("days: arrived past due, a month on", reminderDays("2026-12-10", "2026-05-08", "2026-11-09"), -31);
eq("days: due after it arrived counts from its date", reminderDays("2026-11-10", "2026-11-13", "2026-11-09"), 3);
eq("days: arrived, then went past due, counts from its date", reminderDays("2026-11-20", "2026-11-13", "2026-11-09"), -7);

// The words on the record.
const notice = carriedOverNotice("OldSystem");
eq("notice: says carried over with original dates", /carried over from the prior system \(OldSystem\), with its original dates/.test(notice), true);
eq("notice: says they signed there, not in VeritaAssure", /in OldSystem, not in VeritaAssure®/.test(notice), true);
eq("notice: no em dash", notice.includes("—"), false);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
