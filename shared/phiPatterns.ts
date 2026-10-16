// shared/phiPatterns.ts
//
// The shape-detectable patient identifiers VeritaAssure looks for, shared by the nightly database scan
// (server/phiScan.ts), the upload check (server/phiUploadCheck.ts) and the warning shown while typing
// (client/src/components/PhiGuard.tsx), so all three agree. High precision only: each needs a strong anchor
// (a dash-formatted SSN, or a labeled MRN, date of birth or patient name). Bare dates, phone numbers and the word
// "patient" are legitimate all over a compliance platform and are deliberately not matched.

export interface PhiDetector {
  name: string;
  label: string;
  re: RegExp;
}

export const PHI_DETECTORS: PhiDetector[] = [
  { name: "ssn", label: "Social Security number", re: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    name: "mrn",
    label: "Medical record number",
    re: /\b(?:mrn|medical record (?:number|no\.?|#))\b[\s:#]*\d{4,}/i,
  },
  {
    name: "dob",
    label: "Date of birth",
    re: /\b(?:dob|date of birth)\b[\s:]*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/i,
  },
  {
    name: "patient_name",
    label: "Labeled patient name",
    re: /\b(?:patient(?:'s)? name|pt name)\b\s*[:#]/i,
  },
];

/** Labels of every detector that matches the text (empty when nothing looks like patient information). */
export function detectPhi(text: string | null | undefined): string[] {
  const s = String(text ?? "");
  if (!s) return [];
  return PHI_DETECTORS.filter((d) => d.re.test(s)).map((d) => d.label);
}

/**
 * The same check for uploaded documents. A labeled patient-name FIELD with nothing filled in
 * ("Patient Name: ______") is a normal part of a policy or form template, so for documents the patient-name
 * detector only counts when real text follows the label.
 */
export function detectPhiInDocumentText(text: string | null | undefined): string[] {
  const s = String(text ?? "");
  if (!s) return [];
  const out: string[] = [];
  for (const d of PHI_DETECTORS) {
    if (d.name === "patient_name") {
      if (/\b(?:patient(?:'s)? name|pt name)\b\s*[:#][ \t]*[A-Za-z][A-Za-z'.-]+[ \t,]+[A-Za-z][A-Za-z'.-]+/i.test(s)) out.push(d.label);
    } else if (d.re.test(s)) {
      out.push(d.label);
    }
  }
  return out;
}
