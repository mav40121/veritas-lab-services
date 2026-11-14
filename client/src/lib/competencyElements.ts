// client/src/lib/competencyElements.ts
//
// The competency element names and the raw fields each element records, shared by the person page (entry), the
// By-instrument page and the read-only view of a signed set (SignedEntries). Elements 1-6 are the CLIA elements
// (42 CFR 493.1413(b)(8), 493.1451(b)(8)); 7 and 8 are the NYS CLEP additions.
import { labDayOf } from "./labDate";

export const ELEMENT_NAMES: Record<number, string> = {
  1: "Direct Observation of Routine Patient Test Performance",
  2: "Monitoring, Recording and Reporting of Test Results",
  3: "QC Performance",
  4: "Direct Observation of Instrument Maintenance",
  5: "Blind / PT Sample Performance",
  6: "Problem-Solving Assessment (Quiz)",
  7: "Safe Work Practices (NYS)",
  8: "Delegated Supervisory Functions (NYS)",
};

export type ElementFieldType = "text" | "date" | "number" | "bool" | "observer";

// Which raw fields each element captures (drives the entry inputs).
// "observer" = the lab's LD/TC/TS people in VeritaStaff, picked from a list (BUG-075, Michael Q35 = 1); the server
// refuses anyone else on a new or changed value. Element 7 (NYS) keeps typed entry.
export const ELEMENT_FIELDS: Record<number, Array<{ key: string; label: string; type: ElementFieldType }>> = {
  1: [{ key: "specimenId", label: "Specimen ID observed", type: "text" }, { key: "observerInitials", label: "Observer (LD / TC / TS)", type: "observer" }],
  2: [{ key: "evidence", label: "Evidence", type: "text" }, { key: "date", label: "Date", type: "date" }],
  3: [{ key: "qcDate", label: "Date QC was run", type: "date" }],
  4: [{ key: "dateObserved", label: "Date observed", type: "date" }, { key: "observerInitials", label: "Observer (LD / TC / TS)", type: "observer" }],
  5: [{ key: "sampleType", label: "Sample type", type: "text" }, { key: "sampleId", label: "Sample ID", type: "text" }, { key: "acceptable", label: "Acceptable", type: "bool" }],
  6: [{ key: "quizId", label: "Quiz ID", type: "text" }, { key: "score", label: "Score", type: "number" }, { key: "dateTaken", label: "Date taken", type: "date" }],
  7: [{ key: "dateObserved", label: "Date observed", type: "date" }, { key: "observerInitials", label: "Observer", type: "text" }],
  8: [{ key: "functionAssessed", label: "Function assessed", type: "text" }, { key: "date", label: "Date", type: "date" }],
};

/** A stored YYYY-MM-DD as MM/DD/YYYY; anything else unchanged. */
export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const [y, m, d] = labDayOf(String(iso)).split("-");
  return y && m && d ? `${m}/${d}/${y}` : String(iso);
};
