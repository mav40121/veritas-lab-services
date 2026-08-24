// Verify the NYS CLEP 8-element competency slice in the VeritaComp PDF builder.
// NYS-CLEP labs must render Elements 7 (Safe Work Practices, 10 NYCRR 58-1.2(d)
// HR S8(d)) and 8 (Delegated Supervisory Functions, HR S8(i)) in ADDITION to the
// six CLIA elements (which keep 42 CFR 493.1235). CLIA labs must render exactly
// six elements and never reference Element 7/8 or a fabricated 493.1235(a)(7/8).
//
// Run: npx tsx scripts/verify-veritacomp-nys-elements.ts
import { writeFileSync } from "fs";
import { buildCompetencyHTML } from "../server/pdfReport";

function synthInput(primaryRegime?: "CLIA" | "NYS-CLEP") {
  const methodGroups = [{ id: 1, name: "Chemistry - VITROS 5600" }];
  const items: any[] = [];
  for (let el = 1; el <= 8; el++) {
    items.push({
      element_number: el, method_number: el, method_group_id: 1,
      method_group_name: "Chemistry - VITROS 5600", passed: 1,
      el1_specimen_id: "SP-1001", el1_observer_initials: "MV",
      el2_evidence: "Monitored recording and reporting", el2_date: "2026-08-01",
      el3_qc_date: "2026-08-01",
      el4_date_observed: "2026-08-01", el4_observer_initials: "MV",
      el5_sample_type: "PT", el5_sample_id: "PT-01", el5_acceptable: 1,
      el6_quiz_id: "Q-1", el6_score: 100, el6_date_taken: "2026-08-01",
      el7_date_observed: "2026-08-02", el7_observer_initials: "MV",
      el8_function_assessed: "QC review sign-off", el8_date: "2026-08-02",
    });
  }
  return {
    assessment: {
      competency_type: "technical", status: "pass",
      assessment_date: "2026-08-02", employee_name: "Test Technologist",
      employee_role: "MLS(ASCP)", assessment_type: "annual",
      evaluator_name: "Michael Veri", evaluator_title: "Technical Consultant",
      evaluator_initials: "MV",
    },
    items, methodGroups, checklistItems: [],
    labName: "Catholic Health - NYS CLEP Demo", cliaNumber: "33D-DEMO-2026",
    quizResults: [], primaryRegime,
  } as any;
}

const nys = buildCompetencyHTML(synthInput("NYS-CLEP"));
const clia = buildCompetencyHTML(synthInput("CLIA"));
writeFileSync("scripts/.nys-comp.html", nys);

let fail = 0;
const check = (name: string, cond: boolean) => { console.log((cond ? "PASS" : "FAIL") + "  " + name); if (!cond) fail++; };

// NYS: 8 elements, correct citations
check("NYS renders Element 7 (Safe Work Practices)", /Element 7: Direct Observation of Safe Work Practices/.test(nys));
check("NYS renders Element 8 (Delegated Supervisory Functions)", /Element 8: Assessment of Delegated Supervisory Functions/.test(nys));
check("NYS El7 cites 10 NYCRR 58-1.2(d) HR S8(d)", /10 NYCRR 58-1\.2\(d\)[^<]*HR S8\(d\)/.test(nys));
check("NYS El8 cites HR S8(i)", /HR S8\(i\)/.test(nys));
check("NYS El7/El8 do NOT fabricate 493.1235(a)(7) or (a)(8)", !/493\.1235\(a\)\(7\)/.test(nys) && !/493\.1235\(a\)\(8\)/.test(nys));
check("NYS keeps the six CLIA citations 493.1235(a)(1)..(6)", [1,2,3,4,5,6].every(n => nys.includes(`493.1235(a)(${n})`)));
check("NYS summary lists Element 7 + 8 rows", /Safe Work Practices \(NYS CLEP\)/.test(nys) && /Delegated Supervisory Functions \(NYS CLEP\)/.test(nys));

// CLIA (non-NYS regression): exactly six elements
check("CLIA renders Element 6", /Element 6: Problem-Solving Assessment/.test(clia));
check("CLIA has NO Element 7", !/Element 7:/.test(clia));
check("CLIA has NO Element 8", !/Element 8:/.test(clia));
check("CLIA has NO 10 NYCRR reference", !/10 NYCRR/.test(clia));
check("CLIA keeps 493.1235(a)(6)", clia.includes("493.1235(a)(6)"));

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILURE(S)`);
process.exit(fail === 0 ? 0 : 1);
