// server/ptSamples.ts
//
// VeritaPT events offered to VeritaComp's Element 5 (blind or PT sample performance), shared by the program record's picker and
// the person page's, one method at a time (B11, 2026-11-24; moved out of routes.ts, where BUG-189 part 1 set the rules below).
// Recent results of this lab only, newest first, filtered loosely to the analytes given (case-insensitive, either name inside the
// other; "ALT" matches "ALT (SGPT)"), 25 at most. The sample id is the event id and name the lab entered, whichever there are,
// never a made-up number.
//
// Who tested it: on a program's record, an event recorded as tested by someone else is left out and one with no tester recorded
// stays for the evaluator to judge. The person page asks for the ones recorded as tested by that person, and no other.
//
// 18 months is the practical surveyor-defensible window (CMS Subpart H allows the lab to use any event in the current calendar
// year; widening to 18 months lets the LD also reach a late-year event from the prior cycle).
//
// A pick only fills the form: the evaluator still marks the element, saves and signs. An ungraded or not yet graded result fills
// no Acceptable.
import { PT_STATUS_LABEL, ptStatus } from "@shared/ptEvents";

export interface PtSamplePick {
  id: number;
  eventId: string | null;
  eventName: string | null;
  eventDate: string;
  analyte: string;
  yourResult: number | null;
  yourMethod: string | null;
  acceptableLow: number | null;
  acceptableHigh: number | null;
  sdi: number | null;
  passFail: string;
  statusLabel: string;
  suggestedSampleType: string;
  suggestedSampleId: string;
  testedByEmployeeId: number | null;
  testedByName: string | null;
  testedByThisPerson: boolean;
  suggestedAcceptable: 0 | 1 | null;
}

export function ptSamplePicks(sqlite: any, o: {
  labId: number;
  analytes: Iterable<string>;
  /** The person the record is for (staff_employees.id), when it is known. */
  person: number | null;
  /** Leave out what someone else tested; an event with no tester recorded stays. */
  leaveOutOthers?: boolean;
  /** Only what this person tested. */
  onlyTheirs?: boolean;
  hideTester?: boolean;
}): PtSamplePick[] {
  const analytes = Array.from(o.analytes, (a) => a.trim().toLowerCase()).filter(Boolean);
  const since = new Date();
  since.setMonth(since.getMonth() - 18);
  const rows = sqlite.prepare(
    `SELECT e.id, e.event_id, e.event_name, e.event_date, e.analyte, e.your_result, e.your_method,
            e.acceptable_low, e.acceptable_high, e.sdi, e.pass_fail, e.tested_by_employee_id,
            (SELECT TRIM(COALESCE(se.last_name, '') || ', ' || COALESCE(se.first_name, '')) FROM staff_employees se
              WHERE se.id = e.tested_by_employee_id AND se.tier2_lab_id = e.lab_id) AS tested_by_name
       FROM pt_events e
      WHERE e.lab_id = @lab AND date(e.event_date) >= date(@since)
        AND (@mode = 'all' OR e.tested_by_employee_id = @person OR (@mode = 'others' AND e.tested_by_employee_id IS NULL))
      ORDER BY date(e.event_date) DESC, e.id DESC
      LIMIT 200`
  ).all({ lab: o.labId, since: since.toISOString().split("T")[0], person: o.person, mode: o.onlyTheirs ? "only" : o.leaveOutOthers ? "others" : "all" }) as any[];
  const wanted = analytes.length === 0 ? rows : rows.filter((e) => {
    const a = String(e.analyte || "").toLowerCase();
    return analytes.some((x) => a.includes(x) || x.includes(a));
  });
  return wanted.slice(0, 25).map((e) => ({
    id: e.id, eventId: e.event_id, eventName: e.event_name, eventDate: e.event_date, analyte: e.analyte,
    yourResult: e.your_result, yourMethod: e.your_method, acceptableLow: e.acceptable_low, acceptableHigh: e.acceptable_high, sdi: e.sdi,
    passFail: e.pass_fail, statusLabel: PT_STATUS_LABEL[ptStatus(e.pass_fail)],
    // Convenience pre-formatted fields the picker can drop straight into the Element 5 form state.
    suggestedSampleType: "PT",
    suggestedSampleId: [e.event_id, e.event_name].map((v) => String(v ?? "").trim()).filter((v, i, all) => v && all.indexOf(v) === i).join(", "),
    testedByEmployeeId: o.hideTester ? null : e.tested_by_employee_id,
    testedByName: o.hideTester ? null : e.tested_by_name,
    testedByThisPerson: o.person != null && e.tested_by_employee_id === o.person,
    suggestedAcceptable: e.pass_fail === "pass" ? 1 : e.pass_fail === "fail" ? 0 : null,
  }));
}
