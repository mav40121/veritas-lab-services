// scripts/verify-competency-record-signoff-page1.mjs
//
// Receipt for the VeritaComp record's evaluator sign-off on page 1 (Michael 2026-11-03, Q132 = 1 / Q133 = 1). A live
// record with 14 methods printed the "Evaluator sign-off by method" block on page 3, after the method table; CLAUDE.md
// section 5 puts the signature on page 1. The block now prints above the method table.
//
// Renders records from server/pdfReport.ts buildEmployeeCompetencyRecordHTML with made-up people at the demo lab, at the
// production page size (Letter, 15 mm side margins, 14 mm top, 20 mm bottom) in print media, and checks:
//   1. short record (3 methods): the sign-off block comes before the method table and ends on page 1
//   2. 14 methods with long names, a method group and long signer names (the live case): the whole block is on page 1,
//      every method has one sign-off line, and no cell spills past the table
//   3. 24 methods: the block starts on page 1
//   4. the method table, legend and signed-entries section still print (entries on a new page)
//   5. no em dash in the generated HTML
// It writes the three PDFs to OUT (default ./out-signoff-page1) for a visual check.
// Run: node --import tsx scripts/verify-competency-record-signoff-page1.mjs
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { buildEmployeeCompetencyRecordHTML } from "../server/pdfReport.ts";

const OUT = process.env.OUT || "out-signoff-page1";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  :: ${detail}` : ""}`);
  if (!cond) failures++;
};

const els = (na = []) => [1, 2, 3, 4, 5, 6].map((n) => ({ num: n, status: na.includes(n) ? "na" : "pass", na: na.includes(n) }));
const signoff = (name, role, initials, entries = false) => ({
  milestone: "annual", signedDate: "2026-10-30", signerName: name, signerRole: role, signerInitials: initials,
  elements: els(), hasEntries: entries, determination: "pass",
  ...(entries ? { elements: els().map((e) => ({ ...e, specimenId: "S-1", observerInitials: initials })) } : {}),
});
const method = (name, signer, extra = {}) => ({
  instrumentName: name, department: "Chemistry", complexity: "MODERATE", analyteCount: 12, elements: els(),
  hasData: true, complete: true, signable: false, signoffs: signer ? [signer] : [], nextMilestone: "annual",
  nextDue: signer ? { targetDate: "2027-10-30", latest: null } : null, ...extra,
});
const record = (methods) => ({
  labName: "Sample Regional Medical Center", cliaNumber: "22D0999999",
  employee: { name: "Jordan Example", title: "MLS", complexity: "H", hireDate: "2024-09-23" },
  elementCount: 6, testSystems: methods,
});

const LONG = [
  "AmniSure International AmniSure ROM (Rupture of [Fetal] Membranes) Test",
  "Quidel Cardiovascular Inc., Quidel Triage MeterPro",
  "ALCOR Scientific Inc. miniiSED Erythrocyte Sedimentation Rate (ESR) Automated Analyzer",
  "Alere Toxicology ServicesTox Screen Drug of Abuse Test Card",
  "Medline hCG Combo Pregnancy Test Cassette (Serum/Urine)",
  "Siemens Dimension EXL", "Beckman Coulter DxH 520 (backup)", "Beckman Coulter UniCel DxH 900",
  "Biorex Labs K-Check", "Siemens Clinitek Advantus Urinalysis Analyzer", "IL GEM Premier 7000 iQM3",
  "CLIAwaived, Inc. Rapid Drug Test Device RDTD for Fentanyl in Urine", "Sofia waived",
];
const longSigner = (i) => i % 3 === 0 ? signoff("Alexandra Montgomery-Whitfield", "TS", "AMW", i === 0)
  : i % 3 === 1 ? signoff("Casey Tate", "TC", "CT") : signoff("Natalie Lamb", "GS", "NL");
const cases = {
  short: record([method("Beckman Coulter AU5800", signoff("Casey Tate", "TC", "CT", true)), method("Sysmex XN-1000", signoff("Casey Tate", "TC", "CT")), method("Gram Stain", null)]),
  long14: record([
    method("Sysmex CA-620 / CA-660", longSigner(1), { groupMembers: [{ id: 1, name: "Sysmex CA-660" }, { id: 2, name: "Sysmex CA-620" }] }),
    ...LONG.map((n, i) => method(n, i === LONG.length - 1 ? null : longSigner(i))),
  ]),
  many24: record(Array.from({ length: 24 }, (_, i) => method(`Analyzer ${i + 1}`, signoff("Casey Tate", "TC", "CT")))),
  // BUG-144 (2026-11-09): the live record had 36 methods, one signed, some waived. Its sign-off block was taller than a page,
  // so the PDF moved all of it to page 2. The layout checks above can't see that (a screen layout has no pages), so
  // scripts/verify-competency-record-pdf-pages.py reads these PDFs page by page.
  many36: record(Array.from({ length: 36 }, (_, i) => method(`Analyzer ${String(i + 1).padStart(2, "0")}`, i === 0 ? signoff("Casey Tate", "TC", "CT") : null,
    i % 9 === 4 ? { waived: true, waivedPassed: 0, waivedRequired: 2, waivedMethods: [], complexity: "WAIVED" } : {}))),
};

// Production page geometry (server/pdfReport.ts generateEmployeeCompetencyRecordPDF): Letter, margins 14/15/20/15 mm.
const MM = 96 / 25.4;
const PAGE_W = Math.round(8.5 * 96 - 30 * MM);          // printable width in CSS px
const PAGE_H = Math.round(11 * 96 - (14 + 20) * MM);    // printable height in CSS px

const browser = await puppeteer.launch({ headless: true });
const results = {};
for (const [name, input] of Object.entries(cases)) {
  const html = buildEmployeeCompetencyRecordHTML(input);
  const page = await browser.newPage();
  await page.setViewport({ width: PAGE_W, height: PAGE_H });
  await page.emulateMediaType("print");
  await page.setContent(html, { waitUntil: "load" });
  results[name] = await page.evaluate(() => {
    const sign = document.querySelector(".sign");
    const matrix = Array.from(document.querySelectorAll("h2")).find((h) => /Competency by method/i.test(h.textContent || ""));
    const r = sign.getBoundingClientRect();
    const rows = Array.from(sign.querySelectorAll("tbody tr"));
    const spill = Array.from(sign.querySelectorAll("td, th")).filter((c) => c.scrollWidth > c.clientWidth + 1).length;
    return {
      top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, lines: rows.length,
      lineTops: rows.map((tr) => tr.getBoundingClientRect().top + window.scrollY),
      matrixTop: matrix ? matrix.getBoundingClientRect().top + window.scrollY : null,
      tableRight: sign.querySelector("table").getBoundingClientRect().right, signRight: r.right, spill,
      hasLegend: !!document.querySelector(".legend"), hasEntries: !!document.querySelector(".entries"),
    };
  });
  results[name].html = html;
  await page.pdf({ path: path.join(OUT, `record-${name}.pdf`), format: "Letter", printBackground: true,
    margin: { top: "14mm", right: "15mm", bottom: "20mm", left: "15mm" } });
  await page.close();
}
await browser.close();

const s = results.short, l = results.long14, m = results.many24;
check("1a. short record: the sign-off block comes before the method table", s.matrixTop !== null && s.top < s.matrixTop, `sign top ${Math.round(s.top)}, table ${Math.round(s.matrixTop)}`);
check("1b. short record: the whole sign-off block is on page 1", s.bottom <= PAGE_H, `bottom ${Math.round(s.bottom)} of ${PAGE_H}`);
check("2a. 14 methods, long names: one sign-off line per method", l.lines === 14, `${l.lines} lines`);
check("2b. 14 methods, long names: the whole sign-off block is on page 1", l.bottom <= PAGE_H, `bottom ${Math.round(l.bottom)} of ${PAGE_H}`);
check("2c. 14 methods, long names: no sign-off cell spills and the table stays inside the block", l.spill === 0 && l.tableRight <= l.signRight + 1, `${l.spill} spilling cells`);
check("3. 24 methods: the sign-off block starts on page 1", m.top < PAGE_H, `top ${Math.round(m.top)}; lines on page 1: ${m.lineTops.filter((t) => t + 20 <= PAGE_H).length} of ${m.lines}`);
check("3b. 36 methods: one sign-off line per method", results.many36.lines === 36, `${results.many36.lines} lines`);
check("4a. the method table and legend still print after the sign-off", [s, l, m, results.many36].every((x) => x.matrixTop > x.top && x.hasLegend));
check("4b. the signed-entries section still prints on its own page", s.hasEntries && /\.entries \{ page-break-before: always; \}/.test(s.html));
check("5. no em dash in the generated HTML", [s, l, m].every((x) => !x.html.includes("—")));
console.log(`PDFs: ${path.resolve(OUT)}`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
