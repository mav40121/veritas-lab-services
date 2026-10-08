// scripts/verify-stock-recall-logic.mts
//
// Gate 3 step 2 receipt for server/stockRecallLogic.ts (VeritaStock recall
// tracker). Imports the REAL module (no mirror). Known inputs, expected outputs:
//   - due date = 1 business day after opening; Fri/Sat/Sun -> Monday
//   - the opener's local date is trusted within +/-1 day of UTC, else UTC
//   - lot parsing/normalizing, checklist gating, reminder cadence, file name
//
// Run: npx tsx scripts/verify-stock-recall-logic.mts
import {
  nextBusinessDay, resolveOpenedDate, parseLotNumbers, normalizeLot,
  recallChecklist, readyForSignoff, readyToClose, decideOverdueReminder, noticeFilename, isYmd,
} from "../server/stockRecallLogic.ts";

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  :: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  if (!ok) failures++;
}

// Week of 2026-10-05 (Mon) .. 2026-10-11 (Sun)
check("Mon 10/05 -> Tue 10/06", nextBusinessDay("2026-10-05"), "2026-10-06");
check("Thu 10/08 -> Fri 10/09", nextBusinessDay("2026-10-08"), "2026-10-09");
check("Fri 10/09 -> Mon 10/12 (Brenda's Friday rule)", nextBusinessDay("2026-10-09"), "2026-10-12");
check("Sat 10/10 -> Mon 10/12", nextBusinessDay("2026-10-10"), "2026-10-12");
check("Sun 10/11 -> Mon 10/12", nextBusinessDay("2026-10-11"), "2026-10-12");
check("month rollover Fri 10/30 -> Mon 11/02", nextBusinessDay("2026-10-30"), "2026-11-02");
check("year rollover Thu 12/31/2026 -> Fri 1/1/2027 (holidays not modeled)", nextBusinessDay("2026-12-31"), "2027-01-01");
let threw = false; try { nextBusinessDay("10/09/2026"); } catch { threw = true; }
check("non-ISO date throws", threw, true);

check("local date same as UTC kept", resolveOpenedDate("2026-10-08", "2026-10-08"), "2026-10-08");
check("9 PM Eastern Thu (UTC already Fri) keeps Thu", resolveOpenedDate("2026-10-08", "2026-10-09"), "2026-10-08");
check("implausible local date (5 days off) falls back to UTC", resolveOpenedDate("2026-10-03", "2026-10-08"), "2026-10-08");
check("missing local date falls back to UTC", resolveOpenedDate(undefined, "2026-10-08"), "2026-10-08");
check("bad calendar date rejected", isYmd("2026-02-30"), false);

check("lots split on comma/semicolon/newline, trimmed, deduped", parseLotNumbers("A123, b-456;\nA123 \n\n B456"), ["A123", "b-456"]);
check("lots from array", parseLotNumbers([" X1 ", "", "x1", "Y2"]), ["X1", "Y2"]);
check("normalize ignores case/space/dash", normalizeLot(" ab-12 34x"), "AB1234X");

const empty = recallChecklist({}, 0);
check("empty case: nothing done", empty.map((i) => i.done), [false, false, false, false, false, false]);
check("empty case: not ready for sign-off or close", [readyForSignoff(empty), readyToClose(empty)], [false, false]);
const base = { affected_summary: "2 kits on shelf", corrective_action: "Pulled and discarded", vendor_response_sent_on: "2026-10-08", closeout_notified_at: "2026-10-08T14:00:00Z" };
check("response date set but no vendor paperwork: paperwork item open", recallChecklist(base, 0).find((i) => i.key === "vendor_paperwork")!.done, false);
const ready = recallChecklist(base, 1);
check("all but sign-off done: ready for sign-off, not close", [readyForSignoff(ready), readyToClose(ready)], [true, false]);
const signed = recallChecklist({ ...base, signoff_at: "2026-10-08T15:00:00Z" }, 1);
check("signed: ready to close", readyToClose(signed), true);
const na = recallChecklist({ affected_summary: "x", corrective_action: "y", vendor_response_not_required: 1, closeout_notified_at: "t" }, 0);
check("vendor marked not required covers response + paperwork", na.filter((i) => i.key.startsWith("vendor")).map((i) => i.done), [true, true]);
check("whitespace-only text does not count", recallChecklist({ affected_summary: "   " }, 0)[0].done, false);
check("bad response date does not count", recallChecklist({ vendor_response_sent_on: "yesterday" }, 0)[2].done, false);

check("due today (0 days overdue): no reminder", decideOverdueReminder(0, null), false);
check("1 day overdue, never reminded: remind", decideOverdueReminder(1, null), true);
check("reminded 1 day ago: wait", decideOverdueReminder(2, 1), false);
check("reminded 2 days ago: wait", decideOverdueReminder(3, 2), false);
check("reminded 3 days ago: remind", decideOverdueReminder(4, 3), true);

check("notice file name, manufacturer first", noticeFilename({ vendor: "Beckman Coulter", product: "Access hsTnI Reagent", recall_number: "FA-2026/014", notice_date: "2026-10-06" }, "scan0001.PDF"), "Beckman-Coulter_Access-hsTnI-Reagent_FA-2026-014_2026-10-06.pdf");
check("file name with only vendor", noticeFilename({ vendor: "Abbott" }, "notice"), "Abbott");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
