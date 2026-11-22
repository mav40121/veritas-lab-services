// scripts/verify-tissue-rules.mts
// Receipt for shared/tissueRules.ts: every branch of the tissue rules on a fixed input set, and the CFR text pinned to what
// eCFR's renderer API returned (https://www.ecfr.gov/api/renderer/v1/content/enhanced/2026-11-04/title-21?chapter=I&subchapter=L&part=1271&subpart=D&section=1271.290;
// 2026-10-01 reads the same). Exits non-zero on any failure.
import {
  correctableFields, detectTissuePhi, expiredSolutionRefusal, findTissuePhi, isBefore, isFinalState, isHhMm, isOpenOnLog, isYmd, issueRefusals, lastLiveReturn, liveSteps,
  returnUnusedRefusal, solutionExpiredAtImplant, tissueFlags, tissueIdKey, yesNo, ISSUE_ROW_FIELDS, OTHER_DISPOSITION_LABELS, SOLUTION_EXPIRED_NOTE_LABEL,
  TISSUE_FIELD_LABELS, TISSUE_STATE_LABELS,
  TISSUE_CFR_CODE_CITATION, TISSUE_CFR_CODE_QUOTE, TISSUE_CFR_TRACKING_CITATION, TISSUE_CFR_TRACKING_QUOTE, TISSUE_NO_PHI_NOTICE,
  addYearsYmd, finalDispositionDate, parseTissueRetentionYears, storedTissueRetentionYears, tissueRetention, tissueRetentionPolicyText,
  TISSUE_RETENTION_NOT_SET, TISSUE_RETENTION_OPEN_VALUE, TISSUE_RETENTION_UNSET_NOTE,
} from "../shared/tissueRules";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// The ID
check("tissue ID: case, spaces, dashes, dots and underscores don't count", tissueIdKey(" ab-12.3_4 x ") === "AB1234X");
check("tissue ID: nothing but separators is empty", tissueIdKey(" - . _ ") === "");

// Final disposition
for (const s of ["implanted", "wasted", "returned", "expired"]) check(`${s} is final, not open`, isFinalState(s) && !isOpenOnLog(s));
for (const s of ["received_mm", "stored", "issued"]) check(`${s} is open, not final`, !isFinalState(s) && isOpenOnLog(s));

// Dates, times, yes/no
check("a real date passes", isYmd("2028-02-29"));
check("a date that doesn't exist fails", !isYmd("2027-02-29") && !isYmd("2027-13-01") && !isYmd("01/02/2027"));
check("a real time passes", isHhMm("23:59") && isHhMm("00:00"));
check("a bad time fails", !isHhMm("24:00") && !isHhMm("9:30") && !isHhMm(""));
check("yes and no read", yesNo("yes") === 1 && yesNo("no") === 0 && yesNo(true) === 1 && yesNo(false) === 0);
check("anything else is unanswered", yesNo("") === null && yesNo(undefined) === null && yesNo("maybe") === null);
check("earlier time on the same day is before", isBefore("2026-11-06", "08:00", "2026-11-06", "09:00"));
check("later is not before", !isBefore("2026-11-06", "09:00", "2026-11-06", "08:00"));
check("no earlier step: not before", !isBefore("2026-11-06", "08:00", null, null));

// No PHI: the platform's detectors, then the tissue ones
const hits: [string, string][] = [
  ["MRN: 12345", "Medical record number"], ["medical record number 998877", "Medical record number"], ["MR# 4471", "Medical record number"], ["MRN A12345", "Medical record number"],
  ["Patient name: Pat Example", "Labeled patient name"], ["patient: Pat Example", "Labeled patient name"], ["Recipient: Pat Example", "Labeled patient name"], ["pt: Pat Example", "Labeled patient name"],
  ["DOB 01/02/1950", "Date of birth"], ["date of birth 1-2-50", "Date of birth"], ["DOB: 1950", "Date of birth"],
  ["SSN 123-45-6789", "Social Security number"],
];
for (const [text, label] of hits) check(`refused: ${label} in "${text}"`, detectTissuePhi(text).includes(label), detectTissuePhi(text).join("|"));
const clean = ["Moved to backup freezer, called the supplier", "OR 4", "Surgery department", "Patient not affected, supplier notified", "Dr. Example", "Sterile water", "2 x 4 cm", "Lot 12345", "Kept at 2 to 8 C", "Opt: use the second shelf"];
for (const text of clean) check(`allowed: "${text}"`, detectTissuePhi(text).length === 0, detectTissuePhi(text).join("|"));
check("a body is searched all the way down", findTissuePhi({ a: "ok", receive_bb: { transport_action: "MRN: 12345" } })?.field === "receive_bb.transport_action");
check("a list in a body is searched", findTissuePhi({ rows: [{ tissue_type: "ok" }, { tissue_type: "patient: X" }] })?.field === "rows[1].tissue_type");
check("a clean body finds nothing", findTissuePhi({ a: "ok", n: 1, b: { c: null } }) === null);

// Issue
const today = "2026-11-06";
const stored = { state: "stored", expiration_date: "2027-01-01" };
const yes = { readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes", issued_date: today };
check("issue: all three yes on an unexpired stored unit passes", issueRefusals(stored, yes, today).length === 0);
check("issue: expires today is still good", issueRefusals({ ...stored, expiration_date: today }, yes, today).length === 0);
check("issue: expired yesterday is refused", issueRefusals({ ...stored, expiration_date: "2026-11-05" }, yes, today).some((r) => /expired on 2026-11-05/.test(r)));
check("issue: with no date, today decides", issueRefusals({ ...stored, expiration_date: "2026-11-05" }, { ...yes, issued_date: null }, today).some((r) => /expired/.test(r)));
check("issue: a paper record issued before the unit expired can be entered later", issueRefusals({ ...stored, expiration_date: "2026-11-05" }, { ...yes, issued_date: "2026-11-01" }, today).length === 0);
for (const k of ["readback_id", "readback_expiration", "readback_integrity"]) {
  check(`issue: ${k} no is refused`, issueRefusals(stored, { ...yes, [k]: "no" }, today).length === 1);
  check(`issue: ${k} unanswered is refused`, issueRefusals(stored, { ...yes, [k]: undefined }, today).length === 1);
}
for (const s of ["received_mm", "issued", "implanted"]) check(`issue: refused from ${s}`, issueRefusals({ ...stored, state: s }, yes, today).length === 1);

// Returned unused (Michael 2026-11-09)
check("labels: the terminal returned reads Returned to supplier, stored value unchanged", TISSUE_STATE_LABELS.returned === "Returned to supplier" && OTHER_DISPOSITION_LABELS.returned === "Returned to supplier" && isFinalState("returned"));
check("return: both yes puts it back", returnUnusedRefusal("yes", "yes") === null && returnUnusedRefusal(1, true) === null);
check("return: a storage no is refused, pointing to Other disposition", /Storage conditions maintained was answered no.*Other disposition/.test(returnUnusedRefusal("no", "yes") || ""));
check("return: a package no is refused, pointing to Other disposition", /Package integrity on return was answered no.*Other disposition/.test(returnUnusedRefusal("yes", "no") || ""));
check("return: both no names both", /Storage conditions and package integrity were answered no/.test(returnUnusedRefusal("no", "no") || ""));
check("return: unanswered isn't a refusal here (the route asks for it)", returnUnusedRefusal("", "") === null);
check("return: the issue fields it moves off the row include the read-backs", ISSUE_ROW_FIELDS.length === 9 && ISSUE_ROW_FIELDS.includes("readback_integrity_ok") && ISSUE_ROW_FIELDS.includes("delivered_to"));
const ev = (id: number, event_type: string, detail?: unknown) => ({ id, event_type, detail_json: detail === undefined ? null : JSON.stringify(detail) });
const types = (list: { event_type: string }[]) => list.map((e) => e.event_type).join(",");
const chain = [ev(1, "received_mm"), ev(2, "received_bb"), ev(3, "issued"), ev(4, "corrected", { reason: "x" }), ev(5, "returned_unused")];
check("steps: corrections and the usage card aren't steps", types(liveSteps(chain)) === "received_mm,received_bb,issued,returned_unused");
check("steps: the latest standing return is found", lastLiveReturn(chain)?.id === 5);
const undoneReturn = [...chain, ev(6, "undone", { undid_event_id: 5 })];
check("steps: an undo naming the return takes it back", types(liveSteps(undoneReturn)) === "received_mm,received_bb,issued" && lastLiveReturn(undoneReturn) === null);
check("steps: the next undo takes back the issue, not the return again", types(liveSteps([...undoneReturn, ev(7, "undone", { undid_event_id: 3 })])) === "received_mm,received_bb");
check("steps: an older undo with no id takes back the latest standing step", types(liveSteps([ev(1, "received_mm"), ev(2, "received_bb"), ev(3, "issued"), ev(4, "undone", { reason: "x" })])) === "received_mm,received_bb");
const reissued = [...chain, ev(6, "issued"), ev(7, "undone", { undid_event_id: 6 })];
check("steps: a second issue undone leaves the return on top", liveSteps(reissued).at(-1)?.event_type === "returned_unused");
check("steps: a disposition after the return, undone, leaves the return on top", liveSteps([...chain, ev(6, "other_disposition"), ev(7, "undone", { undid_event_id: 6 })]).at(-1)?.id === 5);
const twoReturns = [...chain, ev(6, "issued"), ev(7, "returned_unused"), ev(8, "undone", { undid_event_id: 7 })];
check("steps: two returns, the second undone: the first is the latest standing", lastLiveReturn(twoReturns)?.id === 5 && liveSteps(twoReturns).at(-1)?.id === 6);
check("steps: an undo naming a step that isn't standing takes nothing", types(liveSteps([...chain, ev(6, "undone", { undid_event_id: 99 })])) === types(liveSteps(chain)));
check("steps: out-of-order rows are read by id", types(liveSteps([ev(5, "returned_unused"), ev(1, "received_mm"), ev(3, "issued"), ev(2, "received_bb")])) === "received_mm,received_bb,issued,returned_unused");

// How a unit reads on the log
const open = tissueFlags({ state: "stored", expiration_date: "2026-11-05" }, today);
check("flags: past expiration with no disposition", open.open && open.expired_on_shelf);
check("flags: final and past expiration isn't flagged", !tissueFlags({ state: "expired", expiration_date: "2026-11-05" }, today).expired_on_shelf);
check("flags: a no at receipt shows", tissueFlags({ state: "stored", transport_temp_ok: 0, package_ok: 1 }, today).receipt_problem && tissueFlags({ state: "stored", transport_temp_ok: 1, package_ok: 0 }, today).receipt_problem);
check("flags: usage card pending only when implanted", tissueFlags({ state: "implanted" }, today).card_pending && !tissueFlags({ state: "implanted", usage_card_returned: 1 }, today).card_pending && !tissueFlags({ state: "issued" }, today).card_pending);

// An expired reconstituting solution at implant (Michael 2026-11-15, Q335 = 1)
check("solution: expiring the day before the implant is expired", solutionExpiredAtImplant("2026-11-05", "2026-11-06"));
check("solution: expiring on the implant day is still good", !solutionExpiredAtImplant("2026-11-06", "2026-11-06"));
check("solution: expiring after the implant is good", !solutionExpiredAtImplant("2026-12-01", "2026-11-06"));
check("solution: no reconstitution or no implant date reads not expired", !solutionExpiredAtImplant(null, "2026-11-06") && !solutionExpiredAtImplant("2026-11-05", null) && !solutionExpiredAtImplant("11/05/2026", "2026-11-06"));
check("solution: expired with no note is refused, naming both dates", /expired on 2026-11-05, before the implant on 2026-11-06.*still recorded/.test(expiredSolutionRefusal("2026-11-05", "2026-11-06", "") || ""));
check("solution: a blank note is no note", expiredSolutionRefusal("2026-11-05", "2026-11-06", "   ") !== null && expiredSolutionRefusal("2026-11-05", "2026-11-06", null) !== null);
check("solution: expired with a note passes", expiredSolutionRefusal("2026-11-05", "2026-11-06", "Surgeon informed; documented in the OR record") === null);
check("solution: in date needs no note", expiredSolutionRefusal("2026-11-06", "2026-11-06", "") === null && expiredSolutionRefusal(null, "2026-11-06", null) === null);
check("flags: solution expired at implant shows, in date doesn't", tissueFlags({ state: "implanted", implanted_date: "2026-11-06", reconstitution_expiration: "2026-11-05" }, today).solution_expired
  && !tissueFlags({ state: "implanted", implanted_date: "2026-11-06", reconstitution_expiration: "2026-11-06" }, today).solution_expired && !tissueFlags({ state: "issued" }, today).solution_expired);
check("correct: tissue type and supplier are corrected through the catalog product, on any unit", correctableFields({}).includes("catalog_id") && !correctableFields({}).includes("tissue_type") && !correctableFields({}).includes("supplier_name"));
check("correct: the note is correctable once implanted, and not before", correctableFields({ implanted_date: "x" }).includes("reconstitution_expired_note") && !correctableFields({ issued_date: "x" }).includes("reconstitution_expired_note"));
check("labels: catalog, type, supplier and the note read plainly", TISSUE_FIELD_LABELS.catalog_id === "Tissue type and supplier" && TISSUE_FIELD_LABELS.tissue_type === "Type of tissue"
  && TISSUE_FIELD_LABELS.supplier_name === "Supplier" && TISSUE_FIELD_LABELS.reconstitution_expired_note === SOLUTION_EXPIRED_NOTE_LABEL);

// Corrections
const receiptOnly = correctableFields({});
check("correct: a new unit has receipt fields only", receiptOnly.includes("source_id") && !receiptOnly.includes("issued_date") && !receiptOnly.includes("received_bb_by"));
const issued = correctableFields({ received_bb_date: "x", issued_date: "x" });
check("correct: an issued unit adds its steps", issued.includes("received_bb_by") && issued.includes("delivered_to") && !issued.includes("implanted_by"));
check("correct: the state and the read-backs are never corrected", !correctableFields({ received_bb_date: "x", issued_date: "x", implanted_date: "x", disposition_date: "x" }).some((f) => f === "state" || f.startsWith("readback")));

// No field or word on the list invites a patient
check("correct: no field names a patient", !correctableFields({ received_bb_date: "x", issued_date: "x", implanted_date: "x", disposition_date: "x" }).some((f) => /patient|recipient|mrn|medical_record/i.test(f)));
check("the notice says what not to enter", /patient's name, medical record number or date of birth/.test(TISSUE_NO_PHI_NOTICE));

// The CFR text, as eCFR's renderer API returned it
const ECFR_B1 = "You must establish and maintain a system of HCT/P tracking that enables the tracking of all HCT/Ps from: (i) The donor to the consignee or final disposition; and (ii) The consignee or final disposition to the donor.";
const ECFR_C = "Distinct identification code. As part of your tracking system, you must ensure: That each HCT/P that you manufacture is assigned and labeled with a distinct identification code,";
check("the quote is verbatim in 1271.290(b)(1)", ECFR_B1.includes(TISSUE_CFR_TRACKING_QUOTE) && TISSUE_CFR_TRACKING_CITATION === "21 CFR 1271.290(b)(1)");
check("the code's name is verbatim in 1271.290(c)", ECFR_C.includes(TISSUE_CFR_CODE_QUOTE) && TISSUE_CFR_CODE_CITATION === "21 CFR 1271.290(c)");

// Record retention: the lab's own period (Michael 2026-11-22, Decision 11 = 1, parking lot #115)
const parsed = (raw: unknown) => { const p = parseTissueRetentionYears(raw); return "error" in p ? "error" : p.years; };
check("retention: 1, 10 and 99 years save", parsed(1) === 1 && parsed(10) === 10 && parsed("10") === 10 && parsed(" 25 ") === 25 && parsed(99) === 99);
check("retention: blank or null clears", parsed(null) === null && parsed("") === null);
check("retention: 0, 100, a fraction, words, true, a list or nothing at all is refused",
  [0, 100, -1, 2.5, "2.5", "ten", "10 years", true, false, [10], undefined, {}].every((v) => parsed(v) === "error"));
check("retention: a stored value outside the range reads as not set", storedTissueRetentionYears(0) === null && storedTissueRetentionYears(150) === null && storedTissueRetentionYears(null) === null && storedTissueRetentionYears("7") === 7);
check("retention: years add on the same day", addYearsYmd("2026-11-05", 10) === "2036-11-05" && addYearsYmd("2026-01-31", 1) === "2027-01-31");
check("retention: Feb 29 lands on Feb 28 in a year with none, and stays Feb 29 in one with it", addYearsYmd("2028-02-29", 1) === "2029-02-28" && addYearsYmd("2028-02-29", 4) === "2032-02-29");
check("retention: final disposition is the implant date, or the other disposition's date",
  finalDispositionDate({ state: "implanted", implanted_date: "2026-11-05" }) === "2026-11-05"
  && ["wasted", "returned", "expired"].every((s) => finalDispositionDate({ state: s, disposition_date: "2026-10-01" }) === "2026-10-01"));
check("retention: an open unit has no final disposition, whatever dates it holds",
  ["received_mm", "stored", "issued"].every((s) => finalDispositionDate({ state: s, implanted_date: "2026-11-05", disposition_date: "2026-11-05" }) === null));
check("retention: the policy line is the mock's", tissueRetentionPolicyText(10) === "10 years after final disposition (implant, return to supplier, or discard)" && tissueRetentionPolicyText(1).startsWith("1 year after"));
const rImpl = tissueRetention({ state: "implanted", implanted_date: "2026-11-05" }, 10);
check("retention set, implanted: the mock's keep-until date, policy and note",
  rImpl.years === 10 && rImpl.basis_date === "2026-11-05" && rImpl.keep_until === "2036-11-05" && rImpl.keep_until_text === "2036-11-05"
  && rImpl.policy_text === "10 years after final disposition (implant, return to supplier, or discard)"
  && rImpl.note === "Set by the laboratory on the Tissue page. The keep-until date counts from this unit's final disposition, implanted 2026-11-05.", JSON.stringify(rImpl));
const rRet = tissueRetention({ state: "returned", disposition_date: "2026-09-30" }, 7);
check("retention set, returned to supplier: counts from the disposition date and says so", rRet.keep_until === "2033-09-30" && /final disposition, returned to supplier 2026-09-30\.$/.test(rRet.note), JSON.stringify(rRet));
check("retention set, wasted and expired name their disposition",
  /, wasted 2026-09-30\.$/.test(tissueRetention({ state: "wasted", disposition_date: "2026-09-30" }, 7).note) && /, recorded as expired 2026-09-30\.$/.test(tissueRetention({ state: "expired", disposition_date: "2026-09-30" }, 7).note));
const rOpen = tissueRetention({ state: "issued" }, 10);
check("retention set, not final yet: no date, it counts from final disposition", rOpen.keep_until === null && rOpen.basis_date === null && rOpen.keep_until_text === TISSUE_RETENTION_OPEN_VALUE && rOpen.policy_text !== null && /which isn't recorded yet\.$/.test(rOpen.note), JSON.stringify(rOpen));
const rUnset = tissueRetention({ state: "implanted", implanted_date: "2026-11-05" }, null);
check("retention not set: Not set and the mock's note, never a number we supply", rUnset.years === null && rUnset.keep_until === null && rUnset.keep_until_text === TISSUE_RETENTION_NOT_SET && rUnset.policy_text === null && rUnset.note === TISSUE_RETENTION_UNSET_NOTE && !/\d/.test(rUnset.note), JSON.stringify(rUnset));
check("retention: no em dash in any of its words", ![rImpl, rRet, rOpen, rUnset].some((r) => /—/.test(JSON.stringify(r))));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
