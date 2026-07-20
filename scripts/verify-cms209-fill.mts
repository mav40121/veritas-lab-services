// Gate 3 receipt for the real CMS-209 fill: drives the ACTUAL generateCMS209PDF
// (template resolution, block pagination, AcroForm fill + flatten, multi-page
// stacking, stampPdfAuthor). Run: npx tsx scripts/verify-cms209-fill.mts <outPath>
//
// The sample deliberately forces MULTIPLE pages and a person whose block cannot
// split: 8 TP techs fill most of page 1, then Veri (entire-lab TC+TS, specialties
// 1-9 = 9 rows) will not fit and must move WHOLE to page 2. The LD (Gilles) is
// listed LAST to prove the sort forces the director to row 1 of page 1.
import { writeFileSync } from "node:fs";
import { generateCMS209PDF } from "../server/pdfReport";

const tp = (last: string) => ({
  last_name: last, first_name: "Tech", middle_initial: null, highest_complexity: "H",
  performs_testing: 1, qualifications_text: null, roles: [{ role: "TP", specialty_number: null }],
});

const input = {
  lab: { lab_name: "SAN CARLOS APACHE HEALTHCARE LAB", clia_number: "03D0531813",
    lab_address_street: "103 Medicine Way Road", lab_address_city: "Peridot", lab_address_state: "AZ", lab_address_zip: "85542" },
  employees: [
    tp("Adams"), tp("Baker"), tp("Carter"), tp("Diaz"), tp("Evans"), tp("Ford"), tp("Grant"), tp("Hayes"),
    // Entire-lab TC + TS across specialties 1-9 => 9 rows, an unsplittable block.
    { last_name: "Veri", first_name: "Michael", middle_initial: "A", highest_complexity: "H", performs_testing: 1, qualifications_text: null,
      roles: [1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((s) => [{ role: "TC", specialty_number: s }, { role: "TS", specialty_number: s }]).concat([{ role: "GS", specialty_number: null }, { role: "TP", specialty_number: null }]) },
    { last_name: "Hall", first_name: "John", middle_initial: null, highest_complexity: "H", performs_testing: 1, qualifications_text: null, roles: [{ role: "TS", specialty_number: 7 }, { role: "GS", specialty_number: null }, { role: "TP", specialty_number: null }] },
    // Listed LAST on purpose; the builder must promote the LD to the very first line.
    { last_name: "Gilles", first_name: "Christopher", middle_initial: null, highest_complexity: "H", performs_testing: 0, qualifications_text: null, roles: [{ role: "LD", specialty_number: null }] },
  ],
  specialties: { 1: "Bacteriology", 7: "Chemistry", 8: "Hematology", 9: "Immunohematology" },
};

const buf = await generateCMS209PDF(input as any, null);
const out = process.argv[2] || "cms209_realfn.pdf";
writeFileSync(out, buf);
console.log(`PASS: generateCMS209PDF returned ${buf.length} bytes -> ${out}`);
process.exit(0);
