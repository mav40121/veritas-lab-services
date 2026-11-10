// scripts/verify-competency-linked-docs.mts
//
// Receipt for BUG-116 (2026-11-10). VeritaComp's Linked documents dialog listed Element 1 to 6, with the technical
// element names, on every record, and only the technical part of the competency PDF printed linked documents, so a link
// on a waived or non-technical record never reached its printout. Made-up records and URLs. Checks:
//   A. documentSections: a technical record gets its six elements, each with its own links; a waived or non-technical
//      record gets one "Supporting documents" list holding every link it has (links stored under any element by the old
//      dialog included), and the Link button stores a new one under element 1
//   B. buildCompetencyHTML (the PDF's HTML): a waived record, a non-technical record and a new-hire evaluation print
//      their links after their table; a technical record still prints them under their element, once; a blank
//      worksheet and a record with no links print none; a URL is escaped
// Run: rm -f .tmp-complinks.db && DB_PATH=.tmp-complinks.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-competency-linked-docs.mts
import { documentSections, documentsByElement, RECORD_DOCUMENT_ELEMENT } from "../shared/competencyDocuments";
import { buildCompetencyHTML } from "../server/pdfReport";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};
const doc = (element_number: number, title: string, url = `https://files.example.test/${encodeURIComponent(title)}`) =>
  ({ element_number, doc_type: "evidence_other", title, url });
const NAMES = { 1: "Direct observation", 2: "Monitoring results", 3: "QC review", 4: "Direct observation of maintenance", 5: "Blind samples", 6: "Problem solving" } as Record<number, string>;

// ── A ──
const techDocs = [doc(2, "Made-up worksheet"), doc(5, "Made-up blind sample log"), doc(5, "Made-up second log")];
const tech = documentSections("technical", techDocs, NAMES);
check("A1. a technical record gets Element 1 to 6, named", tech.length === 6 && tech.map((s) => s.heading).join(",") === "Element 1,Element 2,Element 3,Element 4,Element 5,Element 6" && tech[4].subheading === "Blind samples");
check("A2. ... each with only its own links", tech[1].docs.length === 1 && tech[4].docs.length === 2 && tech[0].docs.length === 0);
const oldLinks = [doc(1, "Made-up checklist scan"), doc(3, "Made-up linked under Element 3 by the old dialog"), doc(6, "Made-up linked under Element 6")];
for (const type of ["waived", "nontechnical"]) {
  const s = documentSections(type, oldLinks, NAMES);
  check(`A3. a ${type} record gets one Supporting documents list, no element names`, s.length === 1 && s[0].heading === "Supporting documents" && !/Element|observation/i.test(s[0].subheading), JSON.stringify(s.map((x) => [x.heading, x.subheading])));
  check(`A4. ... holding every link it has, whatever element the old dialog stored it under`, s[0].docs.length === 3);
  check(`A5. ... and its Link button stores a new one under element ${RECORD_DOCUMENT_ELEMENT} (the route takes 1 to 6)`, s[0].element === 1);
}
check("A6. only a technical record groups by element", documentsByElement("technical") && !documentsByElement("waived") && !documentsByElement("nontechnical") && !documentsByElement(undefined));

// ── B ──
const base = { id: 1, employee_name: "Made-up Tech", employee_lis_initials: "MT", evaluator_name: "Made-up Supervisor", evaluator_initials: "MS",
  assessment_date: "2026-11-10", department: "Made-up Chemistry", status: "pass", assessment_type: "annual", competency_type: "technical" };
const html = (assessment: any, items: any[], elementDocuments: any[], extra: any = {}) =>
  buildCompetencyHTML({ assessment, items, methodGroups: [], checklistItems: [], labName: "Made-up Lab", cliaNumber: "99D9999116", elementDocuments, ...extra });
const count = (h: string) => (h.match(/Linked documents \(/g) || []).length;

const waivedDocs = [doc(1, "Made-up waived QC log"), doc(4, "Made-up observation & sign-off", "https://files.example.test/a?b=1&c=2")];
const waived = html({ ...base, program_type: "waived" }, [{ method_number: 1, waived_instrument: "Made-up Meter", waived_test: "Glucose", waived_date: "2026-11-01", passed: 1 }], waivedDocs);
check("B1. a waived record prints its links (it printed none)", count(waived) === 1 && waived.includes("Linked documents (2)") && waived.includes("Made-up waived QC log"));
check("B2. ... after the waived table, before the sign-off", waived.indexOf("Linked documents (2)") > waived.indexOf("Waived Testing Competency - 2 of 4") && waived.indexOf("Linked documents (2)") < waived.lastIndexOf("Evaluator"));
check("B3. ... with the URL escaped", waived.includes("https://files.example.test/a?b=1&amp;c=2") && !waived.includes("a?b=1&c=2\""));
const nt = html({ ...base, program_type: "nontechnical", competency_type: "nontechnical" }, [{ nt_item_label: "1", nt_item_description: "Made-up safety item", nt_date_met: "2026-11-02" }], oldLinks);
check("B4. a non-technical record prints its links, all three (it printed none)", count(nt) === 1 && nt.includes("Linked documents (3)") && nt.includes("Made-up linked under Element 6"));
check("B5. ... after the checklist", nt.indexOf("Linked documents (3)") > nt.indexOf("Non-Technical Competency Checklist"));
const ev = html({ ...base, program_type: "nontechnical", competency_type: "nontechnical", program_record_kind: "evaluation" }, [{ nt_item_label: "1", nt_item_description: "Made-up evaluation item" }], [doc(1, "Made-up evaluation form")]);
check("B6. a new-hire evaluation prints its link", count(ev) === 1 && ev.includes("Made-up evaluation form") && ev.includes("New-Hire Evaluation Checklist"));
const techHtml = html({ ...base, program_type: "technical" }, [], techDocs);
check("B7. a technical record still prints its links under their element: one list each for Element 2 and 5", count(techHtml) === 2 && techHtml.includes("Linked documents (1)") && techHtml.includes("Linked documents (2)"));
check("B8. a blank waived or non-technical worksheet prints no links", count(html({ ...base, program_type: "waived" }, [], waivedDocs, { blank: true })) === 0 && count(html({ ...base, program_type: "nontechnical", competency_type: "nontechnical" }, [], oldLinks, { blank: true })) === 0);
check("B9. a record with no links prints no Linked documents heading", count(html({ ...base, program_type: "waived" }, [], [])) === 0 && count(html({ ...base, program_type: "nontechnical", competency_type: "nontechnical" }, [], [])) === 0);

console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
