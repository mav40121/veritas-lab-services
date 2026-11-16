// scripts/render-cms116-worksheet.mts
//
// Artifact receipt for the CMS-116 worksheet on Form CMS-116 (04/2026) (Michael 2026-11-15, Q339 = 1): renders the
// real PDF (server/cms116Pdf.ts generateCms116Pdf, the route's builder) for three made-up drafts so the pages can be
// looked at. Writes to OUT:
//   cms116-full.pdf      a 04/2026 draft with every section filled
//   cms116-earlier.pdf   a draft saved on the tab's earlier layout, read through normalizeCms116
//   cms116-empty.pdf     nothing entered, no CLIA on file
// Run: env -C <wt> OUT=<dir> DB_PATH=.tmp-cms116-render.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/render-cms116-worksheet.mts
import fs from "node:fs";
import path from "node:path";
import { emptyCms116 } from "../shared/cms116Form";
import { generateCms116Pdf } from "../server/cms116Pdf";
import { getBrowser } from "../server/pdfReport";

const OUT = process.env.OUT || ".";
fs.mkdirSync(OUT, { recursive: true });
const stored = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, JSON.stringify(v)]));

const full = emptyCms116();
Object.assign(full.i, {
  app_initial: true, anticipated_start_date: "2027-01-04", effective_date: "2027-01-04",
  facility_name: "Made-up Valley Hospital Laboratory", federal_tax_id: "00-0000000",
  email_1: "lab@example.test", email_2: "director@example.test", email_fee_coupons: "billing@example.test",
  phone: "555-0100", fax: "555-0101", street: "1 Made-up Way", street_2: "Building B, 2nd floor", city: "Testville",
  state: "ME", zip: "04000", director_name: "Doe, Jane, Q", director_phone: "555-0102", owner_name: "Made-up Health System", owner_phone: "555-0103",
});
full.ii = { certificate_type: "accreditation", accrediting_orgs: ["The Joint Commission", "AABB"] };
full.iii = { lab_type: "14", lab_type_other: "", in_cms_certified_facility: "yes", ccns: "000000" };
for (const d of ["mon", "tue", "wed", "thu", "fri"] as const) full.iv.hours[d] = { from: "07:00", to: "19:00" };
full.iv.hours.sat = { from: "08:00", to: "12:00" };
full.v = { multiple_sites: "yes", exception: "hospital_campus", site_count: "2", sites: [
  { name: "Main laboratory", address: "1 Made-up Way, 1st floor", city: "Testville", state: "ME", zip: "04000", phone: "555-0100", tests: "Chemistry, Hematology, Immunohematology" },
  { name: "Emergency department lab", address: "1 Made-up Way, ED", city: "Testville", state: "ME", zip: "04000", phone: "555-0104", tests: "Blood gas, Chemistry" },
] };
full.vi = { none_performed: false, tests: [
  { analyte: "Glucose", test_name: "Made-up meter", manufacturer: "Made-up Co" },
  { analyte: "Urine dipstick", test_name: "Made-up strip reader", manufacturer: "Made-up Co" },
], total_volume: "12000" };
full.vii.procedures.urine_sediment = true; full.vii.procedures.wet_mount = true; full.vii.total_volume = "300";
full.viii.tests = [
  { analyte: "Potassium", test_name: "Made-up chemistry analyzer", manufacturer: "Made-up Co", complexity: "M" },
  { analyte: "CBC", test_name: "Made-up hematology analyzer", manufacturer: "Made-up Co", complexity: "M" },
  { analyte: "Antibody identification", test_name: "Manual tube method", manufacturer: "Made-up Co", complexity: "H" },
];
full.viii.specialties.chem_routine = { checked: true, accrediting_org: "The Joint Commission", volume: "50000" };
full.viii.specialties.hematology = { checked: true, accrediting_org: "The Joint Commission", volume: "30000" };
full.viii.specialties.immunohem_abo_rh = { checked: true, accrediting_org: "AABB", volume: "4000" };
full.viii.total_volume = "84300";
full.ix = { control_type: "02", control_other: "", foreign_ownership: "no", foreign_country: "" };
full.x = { other_labs: [{ clia_number: "00D0000000", lab_name: "Made-up Clinic Lab" }] };

const earlier = {
  i: { legal_name: "Made-up Valley Hospital Laboratory", dba: "Valley Lab", street: "1 Made-up Way", city: "Testville", state: "ME", zip: "04000", county: "Somerset", telephone: "555-0100", fax: "555-0101", email: "lab@example.test", federal_tax_id: "00-0000000" },
  ii: { certificate_type: "accreditation", accrediting_org: "TJC" },
  iii: { lab_type: "Hospital", lab_type_other: "" },
  iv: { hours_per_week: "168" },
  v: { multiple_sites: "no", sites_text: "" },
  vi: { has_waived_testing: "yes", estimated_annual_volume: "12000" },
  vii: { has_ppm: "no", estimated_annual_volume: "" },
  viii: { chem_routine: true, hematology: true },
  ix: { total_annual_volume: "80000" },
  x: { control_type: "corporation", control_other: "", director_name: "Jane Q Doe", director_credentials: "MD", director_npi: "", director_clia_director_number: "" },
};

const runs: Array<[string, Record<string, unknown>, string | null, string | null, string]> = [
  ["cms116-full", stored(full as any), "Jane Q Doe", "2027-01-04", "00D0000001"],
  ["cms116-earlier", stored(earlier), null, null, "00D0000001"],
  ["cms116-empty", {}, null, null, ""],
];
for (const [name, sections, sigName, sigDate, clia] of runs) {
  const pdf = await generateCms116Pdf({ sections, director_signature_name: sigName, director_signature_date: sigDate, status: "draft", notes: null }, { labName: "Made-up Valley Hospital Laboratory", cliaNumber: clia });
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
  console.log(`${name}: ${pdf.length} bytes, starts ${pdf.subarray(0, 5).toString()}`);
}
await (await getBrowser()).close();
process.exit(0);
