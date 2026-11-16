// scripts/verify-cms116-form-2026.mts
//
// Receipt for the VeritaLab CMS-116 tab on Form CMS-116 (04/2026) (Michael 2026-11-15, Q339 = 1). Pins
// shared/cms116Form.ts normalizeCms116 (how the tab and the worksheet PDF read a saved draft, 04/2026 or the tab's
// earlier layout), cms116DirectorName (the issued-certificate wire-back's director) and the worksheet HTML
// (server/cms116Pdf.ts buildCms116Html). Made-up values only.
//
// Run: env -C <wt> DB_PATH=.tmp-cms116-verify.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-cms116-form-2026.mts
import {
  CMS116_FORM_VERSION, SECTION_TITLES, SPECIALTY_KEYS, cms116DirectorName, emptyCms116, isEarlierLayout, normalizeCms116,
  type Cms116Sections,
} from "../shared/cms116Form";
import { buildCms116Html, cms116HeaderTemplate } from "../server/cms116Pdf";

let fails = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? "PASS" : "FAIL"}: ${label}${!cond && detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`);
  if (!cond) fails++;
};
const asStored = (s: Partial<Record<keyof Cms116Sections, unknown>>) =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v == null ? null : JSON.stringify(v)]));

// 1. An empty draft.
{
  const r = normalizeCms116({});
  ok("1a nothing saved reads as an empty 04/2026 draft", JSON.stringify(r.sections) === JSON.stringify(emptyCms116()));
  ok("1b and lists nothing carried over", r.carriedNotes.length === 0 && r.earlierLayout === false);
  ok("1c every specialty of section 8 is present", SPECIALTY_KEYS.every((k) => r.sections.viii.specialties[k]?.checked === false) && SPECIALTY_KEYS.length === 24);
}

// 2. A 04/2026 draft reads back exactly as saved, from database strings or client objects.
const full: Cms116Sections = (() => {
  const s = emptyCms116();
  Object.assign(s.i, {
    app_initial: true, anticipated_start_date: "2027-01-04", app_change_director: true, effective_date: "2027-01-04",
    clia_number: "", facility_name: "Made-up Valley Hospital Laboratory", federal_tax_id: "00-0000000",
    email_1: "lab@example.test", email_2: "director@example.test", email_3: "", email_fee_coupons: "billing@example.test",
    phone: "555-0100", fax: "555-0101", street: "1 Made-up Way", street_2: "Building B, 2nd floor", city: "Testville",
    state: "ME", zip: "04000", director_name: "Doe, Jane, Q", director_phone: "555-0102", owner_name: "Made-up Health System", owner_phone: "555-0103",
  });
  s.ii = { certificate_type: "accreditation", accrediting_orgs: ["The Joint Commission", "AABB"] };
  s.iii = { lab_type: "14", lab_type_other: "", in_cms_certified_facility: "yes", ccns: "000000" };
  s.iv.hours.mon = { from: "07:00", to: "19:00" };
  s.v = { multiple_sites: "yes", exception: "hospital_campus", site_count: "2", sites: [{ name: "Main lab", address: "1 Made-up Way", city: "Testville", state: "ME", zip: "04000", phone: "555-0100", tests: "Chemistry, Hematology" }] };
  s.vi = { none_performed: false, tests: [{ analyte: "Glucose", test_name: "Made-up meter", manufacturer: "Made-up Co" }], total_volume: "1200" };
  s.vii.procedures.urine_sediment = true; s.vii.total_volume = "300";
  s.viii.tests = [{ analyte: "Potassium", test_name: "Made-up analyzer", manufacturer: "Made-up Co", complexity: "M" }];
  s.viii.specialties.chem_routine = { checked: true, accrediting_org: "The Joint Commission", volume: "50000" };
  s.viii.total_volume = "50300";
  s.ix = { control_type: "02", control_other: "", foreign_ownership: "no", foreign_country: "" };
  s.x = { other_labs: [{ clia_number: "00D0000000", lab_name: "Made-up Clinic Lab" }] };
  return s;
})();
{
  const fromDb = normalizeCms116(asStored(full));
  ok("2a a 04/2026 draft saved as database strings reads back unchanged", JSON.stringify(fromDb.sections) === JSON.stringify(full));
  const fromClient = normalizeCms116(full as any);
  ok("2b the same draft as client objects reads back unchanged", JSON.stringify(fromClient.sections) === JSON.stringify(full));
  ok("2c a 04/2026 draft is not the earlier layout and carries no notes", !fromDb.earlierLayout && fromDb.carriedNotes.length === 0);
  ok("2d form_version is set", fromDb.sections.i.form_version === CMS116_FORM_VERSION);
}

// 3. Values off the form's lists are dropped, not kept.
{
  const bad = JSON.parse(JSON.stringify(full));
  bad.iii.lab_type = "99"; bad.ix.control_type = "10"; bad.ii.accrediting_orgs = ["The Joint Commission", "Made-up Org"];
  bad.viii.tests[0].complexity = "X"; bad.ii.certificate_type = "registration"; bad.v.exception = "campus";
  const r = normalizeCms116(bad).sections;
  ok("3a a lab type code off the list reads blank", r.iii.lab_type === "");
  ok("3b a control code off the list reads blank", r.ix.control_type === "");
  ok("3c an accrediting organization off the list is dropped", JSON.stringify(r.ii.accrediting_orgs) === JSON.stringify(["The Joint Commission"]));
  ok("3d a complexity other than M or H reads blank", r.viii.tests[0].complexity === "");
  ok("3e a certificate type off the list reads blank", r.ii.certificate_type === "");
  ok("3f a site exception off the list reads blank", r.v.exception === "");
}

// 4. A draft saved on the tab's earlier layout (before 2026-11-16), as that tab stored it.
const earlier = {
  i: { legal_name: "Made-up Valley Hospital Laboratory", dba: "Valley Lab", street: "1 Made-up Way", city: "Testville", state: "ME", zip: "04000", county: "Somerset", telephone: "555-0100", fax: "555-0101", email: "lab@example.test", federal_tax_id: "00-0000000" },
  ii: { certificate_type: "accreditation", accrediting_org: "TJC and AABB" },
  iii: { lab_type: "Blood Banks", lab_type_other: "" },
  iv: { hours_per_week: "168" },
  v: { multiple_sites: "yes", sites_text: "Site 1: 2 Made-up Rd" },
  vi: { has_waived_testing: "no", estimated_annual_volume: "" },
  vii: { has_ppm: "yes", estimated_annual_volume: "300" },
  viii: { chem_routine: true, hematology: true, histocompatibility: true, immunohem_antibody_detection: true, immunohem_abo_rh: true },
  ix: { total_annual_volume: "50300" },
  x: { control_type: "corporation", control_other: "", director_name: "Jane Q Doe", director_credentials: "MD", director_npi: "0000000000", director_clia_director_number: "" },
};
{
  ok("4a a draft with no form_version and saved entries is the earlier layout", isEarlierLayout(asStored(earlier as any)));
  ok("4b an empty earlier row (signature only) is not", !isEarlierLayout({}) && !isEarlierLayout(asStored({ i: {} } as any)));
  const r = normalizeCms116(asStored(earlier as any));
  const s = r.sections;
  const has = (re: RegExp) => r.carriedNotes.some((n) => re.test(n));
  ok("4c the facility's name, tax id, phone, fax, email and address carry to section 1",
    s.i.facility_name === "Made-up Valley Hospital Laboratory" && s.i.federal_tax_id === "00-0000000" && s.i.phone === "555-0100" &&
    s.i.fax === "555-0101" && s.i.email_1 === "lab@example.test" && s.i.street === "1 Made-up Way" && s.i.city === "Testville" && s.i.state === "ME" && s.i.zip === "04000");
  ok("4d the director's name moves from the earlier section X to section 1", s.i.director_name === "Jane Q Doe");
  ok("4e DBA and county, which the 04/2026 form has no field for, are listed", has(/Doing business as: Valley Lab/) && has(/County: Somerset/));
  ok("4f a typed accrediting organization is matched to the form's list", JSON.stringify(s.ii.accrediting_orgs) === JSON.stringify(["The Joint Commission", "AABB"]) && s.ii.certificate_type === "accreditation");
  ok("4g the earlier lab type label maps to its 04/2026 code (Blood Banks -> 05)", s.iii.lab_type === "05");
  ok("4h hours per week is listed, since section 4 asks each day's times", has(/168 hours per week/) && s.iv.hours.mon.from === "");
  ok("4i multiple sites yes carries; the free-text site list is listed", s.v.multiple_sites === "yes" && has(/Site 1: 2 Made-up Rd/) && s.v.sites.length === 0);
  ok("4j waived testing 'no' becomes section 6's none-performed box", s.vi.none_performed === true);
  ok("4k PPM yes is listed (section 7 asks which procedures) and its volume carries", has(/PPM testing: yes/) && s.vii.total_volume === "300" && !s.vii.none_performed);
  ok("4l specialty boxes with the same meaning carry", s.viii.specialties.chem_routine.checked && s.viii.specialties.hematology.checked && s.viii.specialties.immunohem_abo_rh.checked);
  ok("4m histocompatibility and antibody detection, split on the 04/2026 form, are listed and left unchecked",
    has(/Histocompatibility was checked/) && has(/Antibody Detection was checked/) &&
    !s.viii.specialties.histo_transplant.checked && !s.viii.specialties.histo_nontransplant.checked &&
    !s.viii.specialties.immunohem_antibody_transfusion.checked && !s.viii.specialties.immunohem_antibody_nontransfusion.checked);
  ok("4n the earlier section IX total volume is section 8's total", s.viii.total_volume === "50300");
  ok("4o the earlier control type is listed, not guessed into section 9", s.ix.control_type === "" && has(/Type of control: Corporation/));
  ok("4p credentials and NPI, not on the 04/2026 form, are listed", has(/Director credentials: MD/) && has(/Director NPI: 0000000000/));
  ok("4q the earlier layout is reported", r.earlierLayout === true && r.carriedNotes.length === 10, r.carriedNotes);
  const unmatched = normalizeCms116(asStored({ ...earlier, ii: { certificate_type: "accreditation", accrediting_org: "Made-up Accreditor" } } as any));
  ok("4r an accrediting organization the form doesn't list is listed", unmatched.carriedNotes.some((n) => /Made-up Accreditor/.test(n)) && unmatched.sections.ii.accrediting_orgs.length === 0);
  const unknownType = normalizeCms116(asStored({ ...earlier, iii: { lab_type: "Made-up type" } } as any));
  ok("4s an earlier lab type label with no match is listed", unknownType.sections.iii.lab_type === "" && unknownType.carriedNotes.some((n) => /Made-up type/.test(n)));
}

// 5. The issued-certificate director.
{
  ok("5a the signature line's printed name comes first", cms116DirectorName("Signed Name", asStored(full)) === "Signed Name");
  ok("5b then section 1's director", cms116DirectorName("", asStored(full)) === "Doe, Jane, Q");
  ok("5c an earlier-layout draft's section X director still counts", cms116DirectorName(null, asStored(earlier as any)) === "Jane Q Doe");
  ok("5d nothing gives null", cms116DirectorName(null, {}) === null);
}

// 6. The worksheet HTML.
{
  const html = buildCms116Html({ sections: asStored(full), director_signature_name: "Jane Q Doe", director_signature_date: "2027-01-04", status: "draft", notes: null }, { labName: "Made-up Valley Hospital Laboratory", cliaNumber: "00D0000000" });
  const order = Object.values(SECTION_TITLES).map((t) => html.indexOf(t));
  ok("6a sections 1 to 10 print in the form's order", order.every((p, n) => p > 0 && (n === 0 || p > order[n - 1])), order);
  ok("6b it names the 04/2026 form and says it is not a CMS form", /Form CMS-116 \(04\/2026\) worksheet/.test(html) && /It is not a CMS form/.test(html));
  ok("6c it tells the lab to copy the entries onto CMS's current form", /Copy these entries onto CMS's current Form CMS-116/.test(html));
  ok("6d no em dash in the printed text", !html.includes("—"));
  ok("6e saved entries print (facility, CCN, a site, a waived test, a specialty volume, another lab)",
    ["Made-up Valley Hospital Laboratory", "000000", "Main lab", "Made-up meter", "50000", "Made-up Clinic Lab", "Building B, 2nd floor", "billing@example.test"].every((t) => html.includes(t)));
  ok("6f the old wet-ink and mail-this-printout lines are gone", !/wet ink required/i.test(html) && !/Mail the signed packet/.test(html));
  const xss = JSON.parse(JSON.stringify(full)); xss.i.facility_name = "<script>alert(1)</script>";
  const x = buildCms116Html({ sections: asStored(xss), director_signature_name: null, director_signature_date: null, status: null, notes: null }, { labName: "<b>Lab</b>", cliaNumber: "" });
  ok("6g typed text is escaped", !x.includes("<script>alert(1)</script>") && x.includes("&lt;script&gt;") && !x.includes("<b>Lab</b>"));
  const fromEarlier = buildCms116Html({ sections: asStored(earlier as any), director_signature_name: null, director_signature_date: null, status: null, notes: null }, { labName: "L", cliaNumber: "" });
  ok("6h an earlier-layout draft prints on the 04/2026 layout (director in section 1, type 05 checked)",
    fromEarlier.indexOf("Jane Q Doe") > 0 && fromEarlier.indexOf("Jane Q Doe") < fromEarlier.indexOf(SECTION_TITLES.ii) &&
    /checkbox checked">&#10003;<\/span><span>05 Blood Bank/.test(fromEarlier));
  ok("6i the page header carries the lab's name and CLIA", /CLIA: 00D0000000/.test(cms116HeaderTemplate("Lab A", "00D0000000")) && cms116HeaderTemplate("Lab A", "00D0000000").includes("Lab A"));
  ok("6j a lab with no CLIA on file says so in the header", /CLIA: Not on file\. Enter it in account settings\./.test(cms116HeaderTemplate("Lab A", "")));
  const allDay = JSON.parse(JSON.stringify(full)); allDay.iv.testing_24_7 = true;
  const a = buildCms116Html({ sections: asStored(allDay), director_signature_name: null, director_signature_date: null, status: null, notes: null }, { labName: "L", cliaNumber: "" });
  ok("6k 24/7 testing prints the box and no day table", /checkbox checked">&#10003;<\/span><span>Testing 24\/7/.test(a) && !a.includes("From (HH:MM)") && html.includes("From (HH:MM)"));
}

console.log(fails === 0 ? "\n=== CMS-116 04/2026: ALL PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
