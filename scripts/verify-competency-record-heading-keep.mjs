// scripts/verify-competency-record-heading-keep.mjs
//
// Receipt for the VeritaComp record's "Competency by method" heading staying with its table (Michael 2026-11-03,
// Q138 = 1). After the sign-off block moved to page 1 (#1784), a live 14-method record printed that heading alone at the
// bottom of page 1, with the table starting on page 2. This renders a made-up record shaped like that one (the same 14
// methods, groups and waived methods; made-up people at the demo lab) through the REAL generator
// (generateEmployeeCompetencyRecordPDF, with the license band and footer) and writes OUT/record-heading.pdf, plus a short
// record OUT/record-heading-short.pdf. scripts/verify-competency-record-heading-keep.py then checks the pages.
// Run: node --import tsx scripts/verify-competency-record-heading-keep.mjs
import fs from "node:fs";
import path from "node:path";
import { generateEmployeeCompetencyRecordPDF } from "../server/pdfReport.ts";

const OUT = process.env.OUT || "out-heading-keep";
fs.mkdirSync(OUT, { recursive: true });
const els = (na = []) => [1, 2, 3, 4, 5, 6].map((n) => ({ num: n, status: na.includes(n) ? "na" : "pass", na: na.includes(n) }));
const wm = (date) => [{ num: 1, name: "Blind specimen testing", date, status: "pass" }, { num: 2, name: "Periodic observation by supervisor", date, status: "pass" }];
const signer = (role, initials) => ({ signerName: "Jordan Signer", signerRole: role, signerInitials: initials });
const so = (role, extra = {}) => ({ milestone: "annual", signedDate: "2026-10-30", ...signer(role, "JS"), elements: els(), hasEntries: false, determination: "pass", ...extra });
const sys = (instrumentName, department, complexity, analyteCount, opts = {}) => {
  const { na = [], waived = false, members = null, unsigned = false, role = "TC" } = opts;
  const w = waived ? { waived: true, waivedRequired: 2, waivedPassed: 2, waivedMethods: wm("2026-09-26") } : {};
  return {
    instrumentName, department, complexity, analyteCount, elements: els(na), hasData: !unsigned, complete: !unsigned, signable: false,
    groupMembers: members ? members.map((name, i) => ({ id: i + 1, name })) : null, ...w,
    signoffs: unsigned ? [] : [so(waived ? "GS" : role, waived ? { waivedPassed: 2, waivedMethods: wm("2026-09-26"), elements: [] } : { elements: els(na) })],
    nextMilestone: unsigned ? "initial" : "annual", nextDue: unsigned ? null : { targetDate: "2027-10-30", latest: null },
  };
};
const live14 = [
  sys("Sofia waived", "Bacteriology", "WAIVED", 4, { waived: true, members: ["Quidel Sofia 2", "Sofia 2"] }),
  sys("Biorex Labs K-Check", "Chemistry", "MODERATE", 2),
  sys("Quidel Cardiovascular Inc., Quidel Triage MeterPro", "Coagulation", "MODERATE", 2),
  sys("Sysmex CA-620 / CA-660", "Coagulation", "MODERATE", 3, { members: ["Sysmex CA-660", "Sysmex CA-620"] }),
  sys("Medline hCG Combo Pregnancy Test Cassette (Serum/Urine)", "Endocrinology", "MODERATE", 2),
  sys("AmniSure International AmniSure ROM (Rupture of [Fetal] Membranes) Test", "General Immunology", "MODERATE", 1, { na: [4] }),
  sys("ALCOR Scientific Inc. miniiSED Erythrocyte Sedimentation Rate (ESR) Automated Analyzer", "Hematology", "MODERATE", 1),
  sys("Beckman Coulter DxH 520 (backup)", "Hematology", "MODERATE", 7),
  sys("Beckman Coulter UniCel DxH 900", "Hematology", "MODERATE", 7),
  sys("Alere Toxicology ServicesTox Screen Drug of Abuse Test Card", "Toxicology", "MODERATE", 1, { na: [4] }),
  sys("CLIAwaived, Inc. Rapid Drug Test Device RDTD for Fentanyl in Urine", "Toxicology", "WAIVED", 1, { waived: true }),
  sys("IL GEM Premier 7000 iQM3", "Toxicology", "MODERATE", 7, { members: ["IL GEM Premier 7000 with iQM3 (1)", "IL GEM Premier 7000 with iQM3 (2)"], unsigned: true }),
  sys("Siemens Dimension EXL", "Toxicology", "MODERATE", 60, { members: ["Siemens Dimension EXL with LM", "Siemens Dimension EXL 200 (backup)"] }),
  sys("Siemens Clinitek Advantus Urinalysis Analyzer", "Urinalysis", "MODERATE", 10),
];
const record = (testSystems) => ({
  labName: "Sample Regional Medical Center", cliaNumber: "22D0999999",
  employee: { name: "Jordan Example", title: "BS / BA", complexity: "M", hireDate: "2024-09-23" }, elementCount: 6, testSystems,
});
const license = { licensee: "Sample Regional Medical Center", email: "lab@example.com", issueDate: "2026-11-03", product: "VeritaComp™" };
for (const [name, systems] of [["record-heading.pdf", live14], ["record-heading-short.pdf", live14.slice(1, 4)]]) {
  const buf = await generateEmployeeCompetencyRecordPDF(record(systems), license);
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log("wrote", path.resolve(OUT, name));
}
process.exit(0);
