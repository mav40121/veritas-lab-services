// scripts/verify-license-stamp-location.ts
//
// Receipt (2026-10-27): the "Licensed to" appendix page that client-built PDFs end with (VeritaCheck studies via
// client/src/lib/pdfGenerator.ts -> applyLicenseToPdf) printed "Veritas Lab Services, LLC · Globe, Arizona", a
// location from the SCAHC engagement. The company address is 119 Glen Avenue, Upton, MA. Builds a one-page jsPDF,
// stamps it, writes it out, and checks the appendix text.
// Run: npx tsx scripts/verify-license-stamp-location.ts [out.pdf]
import fs from "node:fs";
import { jsPDF } from "jspdf";
import { applyLicenseToPdf } from "../client/src/lib/licenseStamp";

const out = process.argv[2] || "license-stamp-location.pdf";
const doc = new jsPDF({ unit: "mm", format: "letter", orientation: "portrait", compress: false }); // same as pdfGenerator.ts
doc.text("Study page (made-up content for this check)", 20, 20);
applyLicenseToPdf(doc, { licensee: "Made-up Lab", email: "lab@example.com", plan: "hospital" } as any);
const bytes = Buffer.from(doc.output("arraybuffer"));
fs.writeFileSync(out, bytes);
const raw = bytes.toString("latin1");
let failures = 0;
const check = (name: string, cond: boolean) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) failures++; };
check("appendix names the company location as Upton, Massachusetts", raw.includes("Upton, Massachusetts"));
check("no Globe, Arizona anywhere in the PDF", !raw.includes("Globe"));
check("the appendix page was added (2 pages)", doc.getNumberOfPages() === 2);
// The sentence wraps across lines in the PDF, so check its parts (the rendered page is inspected separately).
check("copyright block carries the approved trademark notice",
  raw.includes("are registered") && raw.includes("Other Verita product names are trademarks") && !raw.includes("VeritaDC™ are trademarks"));
console.log(failures ? `\n${failures} FAILED` : `\nALL PASS (wrote ${out})`);
process.exit(failures ? 1 : 0);
