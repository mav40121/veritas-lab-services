// scripts/verify-digest-cards.mts
//
// Receipt for shared/digestCards.ts (the compliance digest's cards, PR 4 of 5; Michael 2026-11-11, Q281 = 1): the change
// line rule decided for the screens, the period labels, "Not available" for a null section, and the copy rules on every
// string a card can produce. Hardcoded made-up counts; prints PASS/FAIL per case and exits non-zero on any failure.
// Run: npx tsx scripts/verify-digest-cards.mts
import {
  DIGEST_CARD_KEYS, DIGEST_CARDS, cardBody, changeLine, draftablePeriods, headlineNumber, periodFrequency, periodTitle,
  priorPeriodLabel, formatDay, formatMomentDay, issueCardKeys, type DigestCardKey,
} from "../shared/digestCards";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Made-up counts for one month (every section), and a prior month's.
const OCT = { period_start: "2026-10-01", period_end: "2026-10-31" };
const SEP = { period_start: "2026-09-01", period_end: "2026-09-30" };
const counts: Record<DigestCardKey, any> = {
  competencies: { overdue: 3, dueIn30: 7, dueIn90: 4, testingStaff: 20, nontechnical: null },
  studies: { hasMap: true, overdue: 2, calVerOverdue: 1, methodComparisonOverdue: 1, dueSoon: 4, calVerDueSoon: 2, methodComparisonDueSoon: 2, completedInMonth: 6, passedInMonth: 5, failedInMonth: 1, openDrafts: 0 },
  newTests: { count: 3, items: [{ mapId: 1, analyte: "Troponin I", instrumentName: "Made-up Chem 1", studyOnFile: true }, { mapId: 1, analyte: "BNP", instrumentName: "Made-up Chem 1", studyOnFile: true }, { mapId: 1, analyte: "Influenza A/B", instrumentName: "Made-up Molecular", studyOnFile: false }], maps: [{ mapId: 1, mapBuiltThisMonth: false, newTests: 3 }] },
  pt: { unacceptableInMonth: 1, openCorrectiveActions: 1, acceptableYearToDate: 41, gradedYearToDate: 42 },
  documents: { pastReview: 4, overdueReview: 3, expired: 1, signaturesOwed: 12, peopleOwingSignatures: 5, changedInMonth: 2, newInMonth: 1, revisedInMonth: 1 },
  certificates: { expired: 0, expiringIn90: 1 },
  maintenance: { overdue: 2, dueIn30: 9, reviewProblems: 0, recordsWithProblems: 0 },
  qc: { rejectedRunsInMonth: 21, withoutCorrectiveAction: 3 },
  stock: { expiredLots: 2, expiredProducts: 2, openRecalls: 1, overdueRecalls: 0 },
  tasks: { overdue: 5, dueThisMonth: 11, notStarted: 3 },
  findings: { open: 6, pastDue: 1 },
  scan: { scanId: 9, updatedOn: "2026-10-20", total: 100, assessed: 80, compliant: 70, needsAttention: 8, immediateAction: 2, na: 0, notAssessed: 20, automatic: { compliant: 10, needsAttention: 0, immediateAction: 0, na: 0 }, staff: { compliant: 60, needsAttention: 8, immediateAction: 2, na: 0 } },
};
const prior: any = { ...SEP, counts: { competencies: { overdue: 5 }, studies: { overdue: 2 }, newTests: { count: 0 }, pt: { unacceptableInMonth: 0 }, documents: { pastReview: 6 }, certificates: { expiringIn90: 1 }, maintenance: { overdue: 3 }, qc: { withoutCorrectiveAction: 1 }, stock: { expiredLots: 4 }, tasks: { overdue: 8 }, findings: { open: 9 } } };

// 1. Periods
check("1. a month's period is monthly, a calendar quarter's quarterly, anything else neither",
  periodFrequency("2026-10-01", "2026-10-31") === "monthly" && periodFrequency("2024-02-01", "2024-02-29") === "monthly" && periodFrequency("2026-07-01", "2026-09-30") === "quarterly"
    && periodFrequency("2026-08-01", "2026-10-31") === null && periodFrequency("2026-10-02", "2026-10-31") === null);
check("1. titles: \"October 2026\" and \"Q3 2026 (July to September)\"", periodTitle("2026-10-01", "2026-10-31") === "October 2026" && periodTitle("2026-07-01", "2026-09-30") === "Q3 2026 (July to September)", periodTitle("2026-07-01", "2026-09-30"));
check("1. the prior period: \"September\" in the same year, \"December 2025\" across a year, \"Q2 2026\" for a quarter",
  priorPeriodLabel(SEP, OCT) === "September" && priorPeriodLabel({ period_start: "2025-12-01", period_end: "2025-12-31" }, { period_start: "2026-01-01" }) === "December 2025"
    && priorPeriodLabel({ period_start: "2026-04-01", period_end: "2026-06-30" }, { period_start: "2026-07-01" }) === "Q2 2026");
check("1. days read as \"Nov 3, 2026\"; a stored UTC moment reads on the lab's clock (03:00Z Dec 1 is Nov 30 in New York)",
  formatDay("2026-11-03") === "Nov 3, 2026" && formatMomentDay("2026-12-01T03:00:00.000Z", "America/New_York") === "Nov 30, 2026" && formatMomentDay("2026-12-01 03:00:00", "America/New_York") === "Nov 30, 2026" && formatMomentDay("2026-12-01T03:00:00.000Z", "UTC") === "Dec 1, 2026");
const months = draftablePeriods({ start: "2026-10-01", end: "2026-10-31" }, "monthly");
check("1. draftable months: 24, newest first, back across the year (the tenth is January, the eleventh December 2025)",
  months.length === 24 && months[0].start === "2026-10-01" && months[1].start === "2026-09-01" && months[9].start === "2026-01-01" && months[10].start === "2025-12-01" && months[10].end === "2025-12-31" && months[10].label === "December 2025");
const quarters = draftablePeriods({ start: "2026-07-01", end: "2026-09-30" }, "quarterly");
check("1. draftable quarters: 8, newest first, with their real last days",
  quarters.length === 8 && same(quarters.slice(0, 4).map((q) => [q.start, q.end]), [["2026-07-01", "2026-09-30"], ["2026-04-01", "2026-06-30"], ["2026-01-01", "2026-03-31"], ["2025-10-01", "2025-12-31"]]));

// 2. The change line rule
const line = (k: DigestCardKey, cur: any = counts[k], p: any = prior) => changeLine(k, cur, p, OCT);
check("2. fewer than last time is Better: \"Down from 5 in September\"", same(line("competencies"), { kind: "better", label: "Better:", text: "Down from 5 in September" }), JSON.stringify(line("competencies")));
check("2. more than last time is Worse: \"Up from 0 in September\"", same(line("pt"), { kind: "worse", label: "Worse:", text: "Up from 0 in September" }), JSON.stringify(line("pt")));
check("2. the same is No change: \"Same as September (2)\"", same(line("studies"), { kind: "same", label: "No change:", text: "Same as September (2)" }), JSON.stringify(line("studies")));
check("2. new tests added is information only: \"September: 0 added\"", same(line("newTests"), { kind: "info", label: null, text: "September: 0 added" }), JSON.stringify(line("newTests")));
check("2. every other card's headline: fewer is better (QC 3 vs 1 worse, stock 2 vs 4 better, tasks 5 vs 8 better, findings 6 vs 9 better, certificates 1 vs 1 same)",
  line("qc")?.kind === "worse" && line("stock")?.kind === "better" && line("tasks")?.kind === "better" && line("findings")?.kind === "better" && line("certificates")?.kind === "same" && line("maintenance")?.kind === "better" && line("documents")?.kind === "better");
check("2. no prior issue: no change line on any card", DIGEST_CARD_KEYS.every((k) => line(k, counts[k], null) === null));
check("2. the prior issue didn't include the section (the scan): no change line", line("scan") === null);
check("2. the prior issue's section was null (not available then): no change line", line("findings", counts.findings, { ...SEP, counts: { findings: null } }) === null);
check("2. this issue's section is null: no change line", line("findings", null) === null);
check("2. a zero against a zero is No change, not missing", same(line("pt", { unacceptableInMonth: 0 }, { ...SEP, counts: { pt: { unacceptableInMonth: 0 } } }), { kind: "same", label: "No change:", text: "Same as September (0)" }));
check("2. across a year the prior period carries its year (January's issue against December's)",
  changeLine("findings", counts.findings, { period_start: "2025-12-01", period_end: "2025-12-31", counts: { findings: { open: 2 } } }, { period_start: "2026-01-01" })?.text === "Up from 2 in December 2025");

// 3. Card bodies
const body = (k: DigestCardKey, s: any = counts[k]) => cardBody(k, s, { start: OCT.period_start, end: OCT.period_end, asOf: "2026-11-03" });
check("3. a null section reads Not available, never 0", DIGEST_CARD_KEYS.every((k) => { const b = body(k, null); return !b.available && b.big === null; }));
check("3. a count of 0 is a number, not Not available", body("findings", { open: 0, pastDue: 0 }).available && body("findings", { open: 0, pastDue: 0 }).big === 0);
check("3. headlines come from the counts: competencies 3 overdue, QC 3 without a corrective action, scan 10 (8 need attention + 2 immediate)",
  body("competencies").big === 3 && body("competencies").unit === "overdue" && body("qc").big === 3 && headlineNumber("scan", counts.scan) === 10 && body("scan").big === 10);
check("3. the detail lines say what the mock says", body("competencies").detail.startsWith("7 due in the next 30 days") && body("studies").detail.includes("6 completed in October (5 passed, 1 failed)")
  && body("pt").detail === "1 corrective action open; 41 of 42 acceptable in 2026 through October" && body("qc").detail === "21 rejected runs in October, 18 documented"
  && body("tasks").detail === "3 not started; 11 more due in November" && body("certificates").detail === "0 expired" && body("findings").detail === "1 past the due date",
  JSON.stringify([body("pt").detail, body("qc").detail, body("tasks").detail]));
check("3. new tests: grouped by analyzer, the study-on-file count and what has none yet",
  body("newTests").detail === "Troponin I and BNP on Made-up Chem 1; Influenza A/B on Made-up Molecular. VeritaCheck® study on file: 2 of 3. None yet: Influenza A/B" && body("newTests").unit === "tests added in October", body("newTests").detail);
check("3. a map's first build isn't counted as new tests, and says so", body("newTests", { count: 0, items: [], maps: [{ mapId: 2, mapBuiltThisMonth: true, newTests: 0 }] }).detail.includes("a first build isn't counted as new tests"));
check("3. a quarter's cards say \"the quarter\"", cardBody("qc", counts.qc, { start: "2026-07-01", end: "2026-09-30", asOf: "2026-10-02" }).detail === "21 rejected runs in the quarter, 18 documented");
check("3. one item reads singular (\"1 test added\", \"1 expired lot\")", cardBody("newTests", { count: 1, items: [counts.newTests.items[0]], maps: [] }, { start: OCT.period_start, end: OCT.period_end }).unit === "test added in October" && body("stock", { ...counts.stock, expiredLots: 1 }).unit === "expired lot on the shelf");
check("3. an issue's cards follow the digest's order whatever order the sections were saved in", same(issueCardKeys(["findings", "studies", "qc", "bogus"]), ["studies", "qc", "findings"]));

// 4. Copy rules on every string a card can make
const texts: string[] = [];
for (const k of DIGEST_CARD_KEYS) {
  const m = DIGEST_CARDS[k];
  texts.push(m.title, m.module, body(k).unit, body(k).detail, body(k, null).detail);
  const c = line(k); if (c) texts.push(c.text, c.label || "");
}
const all = texts.join("\n");
check("4. no em dash in any card text", !all.includes(String.fromCharCode(0x2014)));
const REGISTERED = ["VeritaAssure", "VeritaCheck", "VeritaMap", "VeritaScan"];
const marks = Array.from(all.matchAll(/(Verita[A-Z][A-Za-z]+)([®™]?)/g)).map((m) => [m[1], m[2]]);
check("4. ® only on VeritaAssure, VeritaCheck, VeritaMap and VeritaScan; ™ on every other Verita name; never a bare name",
  marks.length > 0 && marks.every(([name, mark]) => (REGISTERED.includes(name) ? mark === "®" : mark === "™")), JSON.stringify(marks.filter(([n, m]) => (REGISTERED.includes(n) ? m !== "®" : m !== "™"))));
check("4. the modules on the cards: VeritaComp™, VeritaCheck®, VeritaMap®, VeritaPT™, VeritaDC™, VeritaLab™, VeritaMaintain™, VeritaQC™, VeritaStock™, VeritaTrack™, VeritaResponse™, VeritaScan®",
  same(DIGEST_CARD_KEYS.map((k) => DIGEST_CARDS[k].module), ["VeritaComp™", "VeritaCheck®", "VeritaMap®", "VeritaPT™", "VeritaDC™", "VeritaLab™", "VeritaMaintain™", "VeritaQC™", "VeritaStock™", "VeritaTrack™", "VeritaResponse™", "VeritaScan®"]));
check("4. \"medical director\" never appears without \"or designee\"", !/medical director(?! or designee)/i.test(all));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
