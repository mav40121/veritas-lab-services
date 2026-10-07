// Verify the PHI-scan detectors: known patient identifiers must flag, and
// legitimate compliance text (dates, lab phone numbers, staff emails, lot
// numbers, "patient results") must NOT. Run: npx tsx scripts/verify-phi-scan.ts
import { PHI_DETECTORS } from "../server/phiScan";

type Case = { text: string; expect: string | null };

const CASES: Case[] = [
  // Should flag (real patient identifiers)
  { text: "Reviewed with the floor, SSN 123-45-6789 was on the requisition.", expect: "ssn" },
  { text: "MRN: 00883421 pulled for the redraw.", expect: "mrn" },
  { text: "medical record number 4471902 attached", expect: "mrn" },
  { text: "DOB 03/14/1982, specimen recollected", expect: "dob" },
  { text: "date of birth: 7-1-1990 on the label", expect: "dob" },
  { text: "Patient name: John Q. Public", expect: "patient_name" },
  // Should NOT flag (legitimate compliance corpus)
  { text: "Review interval 24 months; effective 01/02/2026.", expect: null },
  { text: "Call the lab at 719-252-8360 for reagent questions.", expect: null },
  { text: "Patient results must be reviewed by the director or designee.", expect: null },
  { text: "Lot 0322357 expires 2027-01-02.", expect: null },
  { text: "Contact chineme.swann@scahealth.org about the policy.", expect: null },
  { text: "CLIA 18D0322357; CAP checklist GEN.20316.", expect: null },
  { text: "QC mean 4.2, SD 0.15, reviewed monthly.", expect: null },
];

function firstMatch(text: string): string | null {
  for (const d of PHI_DETECTORS) if (d.re.test(text)) return d.name;
  return null;
}

let pass = 0;
let fail = 0;
for (const c of CASES) {
  const got = firstMatch(c.text);
  const ok = got === c.expect;
  console.log(`${ok ? "PASS" : "FAIL"}  expect=${c.expect ?? "(clean)"}  got=${got ?? "(clean)"}  | ${c.text}`);
  if (ok) pass++;
  else fail++;
}
console.log(`\n${pass}/${CASES.length} passed, ${fail} failed`);
if (fail) process.exit(1);
