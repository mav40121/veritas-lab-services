// Gate 3 receipt for the real CMS-209 fill: drives the ACTUAL generateCMS209PDF
// (template resolution, buildCMS209Rows, AcroForm fill, stampPdfAuthor) and writes
// a sample to render. Run: npx tsx scripts/verify-cms209-fill.mts <outPath>
import { writeFileSync } from "node:fs";
import { generateCMS209PDF } from "../server/pdfReport";

const input = {
  lab: { lab_name: "SAN CARLOS APACHE HEALTHCARE LAB", clia_number: "03D0531813",
    lab_address_street: "103 Medicine Way Road", lab_address_city: "Peridot", lab_address_state: "AZ", lab_address_zip: "85542" },
  employees: [
    { last_name: "Gilles", first_name: "Christopher", middle_initial: null, highest_complexity: "H", performs_testing: 0, qualifications_text: null, roles: [{ role: "LD", specialty_number: null }] },
    { last_name: "Veri", first_name: "Michael", middle_initial: "A", highest_complexity: "H", performs_testing: 1, qualifications_text: null,
      roles: [1,2,3,4,5,6,7,8,9].flatMap((s) => [{ role: "TC", specialty_number: s }, { role: "TS", specialty_number: s }]).concat([{ role: "GS", specialty_number: null }, { role: "TP", specialty_number: null }]) },
    { last_name: "Hall", first_name: "John", middle_initial: null, highest_complexity: "H", performs_testing: 1, qualifications_text: null, roles: [{ role: "TS", specialty_number: 7 }, { role: "GS", specialty_number: null }, { role: "TP", specialty_number: null }] },
    { last_name: "Tech", first_name: "Lab", middle_initial: null, highest_complexity: "H", performs_testing: 1, qualifications_text: null, roles: [{ role: "TP", specialty_number: null }] },
  ],
  specialties: { 1: "Bacteriology", 7: "Chemistry", 8: "Hematology", 9: "Immunohematology" },
};

const buf = await generateCMS209PDF(input as any, null);
const out = process.argv[2] || "cms209_realfn.pdf";
writeFileSync(out, buf);
console.log(`PASS: generateCMS209PDF returned ${buf.length} bytes -> ${out}`);
process.exit(0);
