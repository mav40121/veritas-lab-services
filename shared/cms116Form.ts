// Form CMS-116 (04/2026), CLIA Application, OMB 0938-0581, expires 04/30/2029: the fields of sections 1-10 and the
// signature lines, shared by the VeritaLab CMS-116 tab (client/src/components/veritalab/Cms116FormTab.tsx) and its
// printed worksheet (server/cms116Pdf.ts), so the two can't disagree.
//
// Storage is unchanged: cms116_drafts keeps one JSON blob per section in section_i_json .. section_x_json, and section
// N of the 04/2026 form lives in the Nth column (1 -> i, ..., 10 -> x). A draft saved on the tab's earlier layout (no
// `form_version` in section i) is read through normalizeCms116, which carries over what has a home on the 04/2026 form
// and lists the rest in `carriedNotes`, so nothing a lab typed disappears without a word. Saving writes the 04/2026
// shape with form_version set, so a draft is converted once, when its lab saves it.

export const CMS116_FORM_VERSION = "2026-04";
export const CMS116_FORM_LABEL = "Form CMS-116 (04/2026)";

export type YesNo = "" | "yes" | "no";

export interface Cms116Section1 {
  form_version: string;
  app_initial: boolean;
  anticipated_start_date: string;
  app_survey: boolean;
  app_change_cert_type: boolean;
  app_change_director: boolean;
  app_other_changes: boolean;
  other_changes_text: string;
  effective_date: string;
  clia_number: string;
  facility_name: string;
  federal_tax_id: string;
  email_1: string;
  email_2: string;
  email_3: string;
  email_fee_coupons: string;
  phone: string;
  fax: string;
  street: string;
  street_2: string;
  city: string;
  state: string;
  zip: string;
  director_name: string;
  director_phone: string;
  owner_name: string;
  owner_phone: string;
}

export type CertificateType = "" | "waiver" | "ppm" | "compliance" | "accreditation";

export interface Cms116Section2 {
  certificate_type: CertificateType;
  accrediting_orgs: string[];
}

export interface Cms116Section3 {
  lab_type: string; // a LAB_TYPES code, "01" .. "29"
  lab_type_other: string; // for 22 Practitioner Other and 29 Other
  in_cms_certified_facility: YesNo;
  ccns: string;
}

export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface Cms116Section4 {
  testing_24_7: boolean;
  hours: Record<DayKey, { from: string; to: string }>;
}

export type SiteException = "" | "mobile" | "public_health" | "hospital_campus";

export interface Cms116Site {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  tests: string;
}

export interface Cms116Section5 {
  multiple_sites: YesNo;
  exception: SiteException;
  site_count: string;
  sites: Cms116Site[];
}

export interface Cms116WaivedTest {
  analyte: string;
  test_name: string;
  manufacturer: string;
}

export interface Cms116Section6 {
  none_performed: boolean;
  tests: Cms116WaivedTest[];
  total_volume: string;
}

export interface Cms116Section7 {
  none_performed: boolean;
  procedures: Record<string, boolean>;
  total_volume: string;
}

export interface Cms116NonWaivedTest extends Cms116WaivedTest {
  complexity: "" | "M" | "H";
}

export interface Cms116Specialty {
  checked: boolean;
  accrediting_org: string;
  volume: string;
}

export interface Cms116Section8 {
  tests: Cms116NonWaivedTest[];
  specialties: Record<string, Cms116Specialty>;
  total_volume: string;
}

export interface Cms116Section9 {
  control_type: string; // a CONTROL_TYPES code, "01" .. "09"
  control_other: string; // for 03 Other Nonprofit and 09 Other Government
  foreign_ownership: YesNo;
  foreign_country: string;
}

export interface Cms116OtherLab {
  clia_number: string;
  lab_name: string;
}

export interface Cms116Section10 {
  other_labs: Cms116OtherLab[];
}

export interface Cms116Sections {
  i: Cms116Section1;
  ii: Cms116Section2;
  iii: Cms116Section3;
  iv: Cms116Section4;
  v: Cms116Section5;
  vi: Cms116Section6;
  vii: Cms116Section7;
  viii: Cms116Section8;
  ix: Cms116Section9;
  x: Cms116Section10;
}

export const SECTION_TITLES: Record<keyof Cms116Sections, string> = {
  i: "1. General Information",
  ii: "2. Type of Certificate Requested",
  iii: "3. Type of Laboratory",
  iv: "4. Hours of Laboratory Testing",
  v: "5. Multiple Sites",
  vi: "6. Waived Testing to Be Performed",
  vii: "7. PPM Testing to Be Performed",
  viii: "8. Non-Waived Testing to Be Performed",
  ix: "9. Type of Control",
  x: "10. Director Affiliation with Other Laboratories",
};

export const CERTIFICATE_TYPES: Array<{ value: Exclude<CertificateType, "">; label: string; sections: string }> = [
  { value: "waiver", label: "Certificate of Waiver", sections: "sections 1-6 and 9-10" },
  { value: "ppm", label: "Certificate for Provider Performed Microscopy Procedures (PPM)", sections: "sections 1-6 and 9-10" },
  { value: "compliance", label: "Certificate of Compliance", sections: "sections 1-10" },
  { value: "accreditation", label: "Certificate of Accreditation", sections: "sections 1-10" },
];

// The accreditation organizations section 2 lists, in its order.
export const ACCREDITING_ORGS = ["The Joint Commission", "ACHC", "AABB", "A2LA", "CAP", "COLA", "ASHI"];

// Section 3, in the form's order; `cms` marks the facility types CMS certifies (the form's asterisk).
export const LAB_TYPES: Array<{ code: string; label: string; cms: boolean; specify?: boolean }> = [
  { code: "01", label: "Ambulance", cms: false },
  { code: "02", label: "Ambulatory Surgery Center", cms: true },
  { code: "03", label: "Ancillary Testing Site in Health Care Facility", cms: false },
  { code: "04", label: "Assisted Living Facility", cms: false },
  { code: "05", label: "Blood Bank", cms: false },
  { code: "06", label: "Community Clinic", cms: false },
  { code: "07", label: "Comp. Outpatient Rehab Facility", cms: true },
  { code: "08", label: "End Stage Renal Disease Dialysis Facility", cms: true },
  { code: "09", label: "Federally Qualified Health Center", cms: true },
  { code: "10", label: "Health Fair", cms: false },
  { code: "11", label: "Health Main. Organization", cms: false },
  { code: "12", label: "Home Health Agency", cms: true },
  { code: "13", label: "Hospice", cms: true },
  { code: "14", label: "Hospital", cms: true },
  { code: "15", label: "Independent", cms: false },
  { code: "16", label: "Industrial", cms: false },
  { code: "17", label: "Insurance", cms: false },
  { code: "18", label: "Intermediate Care Facilities for Individuals with Intellectual Disabilities", cms: true },
  { code: "19", label: "Mobile Laboratory", cms: false },
  { code: "20", label: "Pharmacy", cms: false },
  { code: "21", label: "Physician Office", cms: false },
  { code: "22", label: "Practitioner Other", cms: false, specify: true },
  { code: "23", label: "Prison", cms: false },
  { code: "24", label: "Public Health Laboratories", cms: false },
  { code: "25", label: "Rural Health Clinic", cms: true },
  { code: "26", label: "School/Student Health Service", cms: false },
  { code: "27", label: "Skilled Nursing Facility/Nursing Facility", cms: true },
  { code: "28", label: "Tissue Bank/Repositories", cms: false },
  { code: "29", label: "Other", cms: false, specify: true },
];

export const DAYS: Array<{ key: DayKey; label: string }> = [
  { key: "sun", label: "Sunday" },
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
];

export const SITE_EXCEPTIONS: Array<{ value: Exclude<SiteException, "">; label: string }> = [
  { value: "mobile", label: "A laboratory not at a fixed location that moves from testing site to testing site (mobile unit, health screening fairs or other temporary testing locations), covered under the certificate of its primary site or home base" },
  { value: "public_health", label: "A not-for-profit or Federal, State or local government laboratory doing limited public health testing (not more than a combination of 15 moderate complexity or waived tests per certificate), filing one certificate for multiple sites" },
  { value: "hospital_campus", label: "A hospital with multiple laboratories in contiguous buildings on the same campus, at the same physical location or street address and under common direction, filing one certificate for these locations" },
];

export const PPM_PROCEDURES: Array<{ key: string; label: string }> = [
  { key: "wet_mount", label: "Direct wet mount preparations for the presence or absence of bacteria, fungi, parasites, and human cellular elements" },
  { key: "koh", label: "Potassium hydroxide (KOH) preparations" },
  { key: "pinworm", label: "Pinworm examinations" },
  { key: "fern", label: "Fern tests" },
  { key: "post_coital", label: "Post-coital direct, qualitative examinations of vaginal or cervical mucous" },
  { key: "urine_sediment", label: "Urine sediment examinations" },
  { key: "nasal_smears", label: "Nasal smears for granulocytes" },
  { key: "fecal_leukocyte", label: "Fecal leukocyte examinations" },
  { key: "semen", label: "Qualitative semen analysis (limited to the presence or absence of sperm and detection of motility)" },
];

// Section 8's specialty and subspecialty boxes, grouped as the form groups them, with CMS's codes.
export const SPECIALTY_GROUPS: Array<{ label: string; items: Array<{ key: string; label: string; code: string }> }> = [
  { label: "Histocompatibility", items: [
    { key: "histo_transplant", label: "Transplant", code: "010" },
    { key: "histo_nontransplant", label: "Nontransplant", code: "010" },
  ]},
  { label: "Microbiology", items: [
    { key: "micro_bacteriology", label: "Bacteriology", code: "110" },
    { key: "micro_mycobacteriology", label: "Mycobacteriology", code: "115" },
    { key: "micro_mycology", label: "Mycology", code: "120" },
    { key: "micro_parasitology", label: "Parasitology", code: "130" },
    { key: "micro_virology", label: "Virology", code: "140" },
  ]},
  { label: "Diagnostic Immunology", items: [
    { key: "immuno_syphilis_serology", label: "Syphilis Serology", code: "210" },
    { key: "immuno_general", label: "General Immunology", code: "220" },
  ]},
  { label: "Chemistry", items: [
    { key: "chem_routine", label: "Routine", code: "310" },
    { key: "chem_urinalysis", label: "Urinalysis", code: "320" },
    { key: "chem_endocrinology", label: "Endocrinology", code: "330" },
    { key: "chem_toxicology", label: "Toxicology", code: "340" },
  ]},
  { label: "Hematology", items: [
    { key: "hematology", label: "Hematology", code: "400" },
  ]},
  { label: "Immunohematology", items: [
    { key: "immunohem_abo_rh", label: "ABO Group & Rh Group", code: "510" },
    { key: "immunohem_antibody_transfusion", label: "Antibody Detection (transfusion)", code: "520" },
    { key: "immunohem_antibody_nontransfusion", label: "Antibody Detection (nontransfusion)", code: "530" },
    { key: "immunohem_antibody_id", label: "Antibody Identification", code: "540" },
    { key: "immunohem_compatibility", label: "Compatibility Testing", code: "550" },
  ]},
  { label: "Pathology", items: [
    { key: "pathology_histopathology", label: "Histopathology", code: "610" },
    { key: "pathology_oral", label: "Oral Pathology", code: "620" },
    { key: "pathology_cytology", label: "Cytology", code: "630" },
  ]},
  { label: "Radiobioassay", items: [
    { key: "radiobioassay", label: "Radiobioassay", code: "800" },
  ]},
  { label: "Clinical Cytogenetics", items: [
    { key: "clinical_cytogenetics", label: "Clinical Cytogenetics", code: "900" },
  ]},
];

export const SPECIALTY_KEYS: string[] = SPECIALTY_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const CONTROL_TYPES: Array<{ code: string; group: string; label: string; specify?: boolean }> = [
  { code: "01", group: "Voluntary Nonprofit", label: "Religious Affiliation" },
  { code: "02", group: "Voluntary Nonprofit", label: "Private Nonprofit" },
  { code: "03", group: "Voluntary Nonprofit", label: "Other Nonprofit", specify: true },
  { code: "04", group: "For Profit", label: "Proprietary" },
  { code: "05", group: "Government", label: "City" },
  { code: "06", group: "Government", label: "County" },
  { code: "07", group: "Government", label: "State" },
  { code: "08", group: "Government", label: "Federal" },
  { code: "09", group: "Government", label: "Other Government", specify: true },
];

export function emptySite(): Cms116Site {
  return { name: "", address: "", city: "", state: "", zip: "", phone: "", tests: "" };
}
export function emptyWaivedTest(): Cms116WaivedTest {
  return { analyte: "", test_name: "", manufacturer: "" };
}
export function emptyNonWaivedTest(): Cms116NonWaivedTest {
  return { analyte: "", test_name: "", manufacturer: "", complexity: "" };
}
export function emptyOtherLab(): Cms116OtherLab {
  return { clia_number: "", lab_name: "" };
}

export function emptyCms116(): Cms116Sections {
  const hours = {} as Record<DayKey, { from: string; to: string }>;
  for (const d of DAYS) hours[d.key] = { from: "", to: "" };
  const specialties: Record<string, Cms116Specialty> = {};
  for (const k of SPECIALTY_KEYS) specialties[k] = { checked: false, accrediting_org: "", volume: "" };
  const procedures: Record<string, boolean> = {};
  for (const p of PPM_PROCEDURES) procedures[p.key] = false;
  return {
    i: {
      form_version: CMS116_FORM_VERSION,
      app_initial: false, anticipated_start_date: "", app_survey: false, app_change_cert_type: false,
      app_change_director: false, app_other_changes: false, other_changes_text: "", effective_date: "",
      clia_number: "", facility_name: "", federal_tax_id: "",
      email_1: "", email_2: "", email_3: "", email_fee_coupons: "", phone: "", fax: "",
      street: "", street_2: "", city: "", state: "", zip: "",
      director_name: "", director_phone: "", owner_name: "", owner_phone: "",
    },
    ii: { certificate_type: "", accrediting_orgs: [] },
    iii: { lab_type: "", lab_type_other: "", in_cms_certified_facility: "", ccns: "" },
    iv: { testing_24_7: false, hours },
    v: { multiple_sites: "", exception: "", site_count: "", sites: [] },
    vi: { none_performed: false, tests: [], total_volume: "" },
    vii: { none_performed: false, procedures, total_volume: "" },
    viii: { tests: [], specialties, total_volume: "" },
    ix: { control_type: "", control_other: "", foreign_ownership: "", foreign_country: "" },
    x: { other_labs: [] },
  };
}

// The tab's earlier layout (before 2026-11-16): labels it stored for section III, mapped to the 04/2026 codes.
const EARLIER_LAB_TYPES: Record<string, string> = {
  "Ambulatory Surgical Center": "02",
  "Ancillary Testing Site in Health Care Facility": "03",
  "Assisted Living Facility": "04",
  "Blood Banks": "05",
  "Community Clinic": "06",
  "Comprehensive Outpatient Rehab Facility": "07",
  "End-Stage Renal Disease Dialysis Facility": "08",
  "Federally Qualified Health Center": "09",
  "Health Maintenance Organization": "11",
  "Home Health Agency": "12",
  "Hospice": "13",
  "Hospital": "14",
  "Independent": "15",
  "Industrial": "16",
  "Insurance": "17",
  "Intermediate Care Facility / Individuals with Intellectual Disabilities": "18",
  "Mobile Laboratory": "19",
  "Other Practitioner": "22",
  "Pharmacy": "20",
  "Physician Office": "21",
  "Prison": "23",
  "Public Health Laboratory": "24",
  "Rural Health Clinic": "25",
  "School/Student Health Service": "26",
  "Skilled Nursing/Nursing Facility": "27",
  "Tissue Bank/Repositories": "28",
  "Other": "29",
};

const EARLIER_CONTROL_LABELS: Record<string, string> = {
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  corporation: "Corporation",
  government: "Government",
  other: "Other",
};

// Specialty keys the earlier layout used under the same name and meaning.
const EARLIER_SPECIALTY_SAME = SPECIALTY_KEYS.filter((k) => !k.startsWith("histo_") && !k.startsWith("immunohem_antibody_t") && !k.startsWith("immunohem_antibody_n"));

const str = (v: unknown): string => (v == null ? "" : String(v));
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;
const yesNo = (v: unknown): YesNo => (v === "yes" || v === "no" ? v : "");
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function orgsFromText(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  if (/joint commission|\btjc\b|\bjcaho\b/.test(t)) found.push("The Joint Commission");
  for (const o of ["ACHC", "AABB", "A2LA", "CAP", "COLA", "ASHI"]) {
    if (new RegExp(`\\b${o.toLowerCase()}\\b`).test(t)) found.push(o);
  }
  return found;
}

// One section's saved JSON, as stored: a string from the database or an object from the client.
type Raw = unknown;
export interface RawCms116Sections { i?: Raw; ii?: Raw; iii?: Raw; iv?: Raw; v?: Raw; vi?: Raw; vii?: Raw; viii?: Raw; ix?: Raw; x?: Raw }

function parseRaw(v: Raw): Record<string, any> {
  if (v == null || v === "") return {};
  if (typeof v === "string") {
    try { return obj(JSON.parse(v)); } catch { return {}; }
  }
  return obj(v);
}

export function isEarlierLayout(raw: RawCms116Sections): boolean {
  const i = parseRaw(raw.i);
  if (i.form_version) return false;
  return Object.values(raw).some((s) => Object.keys(parseRaw(s)).length > 0);
}

// Reads a saved draft into the 04/2026 shape. `carriedNotes` lists, in plain words, what an earlier-layout draft held
// that has no field on the 04/2026 form, or that couldn't be placed without a guess; the tab shows them and the lab
// re-enters what applies. A 04/2026 draft has none.
export function normalizeCms116(raw: RawCms116Sections): { sections: Cms116Sections; carriedNotes: string[]; earlierLayout: boolean } {
  const out = emptyCms116();
  const r = {
    i: parseRaw(raw.i), ii: parseRaw(raw.ii), iii: parseRaw(raw.iii), iv: parseRaw(raw.iv), v: parseRaw(raw.v),
    vi: parseRaw(raw.vi), vii: parseRaw(raw.vii), viii: parseRaw(raw.viii), ix: parseRaw(raw.ix), x: parseRaw(raw.x),
  };
  const earlier = isEarlierLayout(raw);
  const notes: string[] = [];

  if (!earlier) {
    const i = r.i;
    for (const k of Object.keys(out.i) as Array<keyof Cms116Section1>) {
      if (typeof out.i[k] === "boolean") (out.i as any)[k] = bool(i[k]);
      else (out.i as any)[k] = str(i[k]);
    }
    out.i.form_version = CMS116_FORM_VERSION;
    const ct = str(r.ii.certificate_type);
    out.ii.certificate_type = (CERTIFICATE_TYPES.some((c) => c.value === ct) ? ct : "") as CertificateType;
    out.ii.accrediting_orgs = arr(r.ii.accrediting_orgs).map(str).filter((o) => ACCREDITING_ORGS.includes(o));
    out.iii.lab_type = LAB_TYPES.some((t) => t.code === str(r.iii.lab_type)) ? str(r.iii.lab_type) : "";
    out.iii.lab_type_other = str(r.iii.lab_type_other);
    out.iii.in_cms_certified_facility = yesNo(r.iii.in_cms_certified_facility);
    out.iii.ccns = str(r.iii.ccns);
    out.iv.testing_24_7 = bool(r.iv.testing_24_7);
    const h = obj(r.iv.hours);
    for (const d of DAYS) out.iv.hours[d.key] = { from: str(obj(h[d.key]).from), to: str(obj(h[d.key]).to) };
    out.v.multiple_sites = yesNo(r.v.multiple_sites);
    out.v.exception = (SITE_EXCEPTIONS.some((e) => e.value === r.v.exception) ? r.v.exception : "") as SiteException;
    out.v.site_count = str(r.v.site_count);
    out.v.sites = arr(r.v.sites).map((s) => ({ ...emptySite(), ...Object.fromEntries(Object.keys(emptySite()).map((k) => [k, str(obj(s)[k])])) }));
    out.vi.none_performed = bool(r.vi.none_performed);
    out.vi.tests = arr(r.vi.tests).map((t) => ({ analyte: str(obj(t).analyte), test_name: str(obj(t).test_name), manufacturer: str(obj(t).manufacturer) }));
    out.vi.total_volume = str(r.vi.total_volume);
    out.vii.none_performed = bool(r.vii.none_performed);
    const p = obj(r.vii.procedures);
    for (const pr of PPM_PROCEDURES) out.vii.procedures[pr.key] = bool(p[pr.key]);
    out.vii.total_volume = str(r.vii.total_volume);
    out.viii.tests = arr(r.viii.tests).map((t) => {
      const c = str(obj(t).complexity);
      return { analyte: str(obj(t).analyte), test_name: str(obj(t).test_name), manufacturer: str(obj(t).manufacturer), complexity: (c === "M" || c === "H" ? c : "") as "" | "M" | "H" };
    });
    const sp = obj(r.viii.specialties);
    for (const k of SPECIALTY_KEYS) {
      const s = obj(sp[k]);
      out.viii.specialties[k] = { checked: bool(s.checked), accrediting_org: str(s.accrediting_org), volume: str(s.volume) };
    }
    out.viii.total_volume = str(r.viii.total_volume);
    out.ix.control_type = CONTROL_TYPES.some((c) => c.code === str(r.ix.control_type)) ? str(r.ix.control_type) : "";
    out.ix.control_other = str(r.ix.control_other);
    out.ix.foreign_ownership = yesNo(r.ix.foreign_ownership);
    out.ix.foreign_country = str(r.ix.foreign_country);
    out.x.other_labs = arr(r.x.other_labs).map((l) => ({ clia_number: str(obj(l).clia_number), lab_name: str(obj(l).lab_name) }));
    return { sections: out, carriedNotes: [], earlierLayout: false };
  }

  // Earlier layout. Section I: name, tax id, phone, fax, one email and the street address carry over.
  const i = r.i;
  out.i.facility_name = str(i.legal_name);
  out.i.federal_tax_id = str(i.federal_tax_id);
  out.i.email_1 = str(i.email);
  out.i.phone = str(i.telephone);
  out.i.fax = str(i.fax);
  out.i.street = str(i.street);
  out.i.city = str(i.city);
  out.i.state = str(i.state);
  out.i.zip = str(i.zip);
  if (str(i.dba)) notes.push(`Doing business as: ${str(i.dba)} (the 04/2026 form has no DBA field)`);
  if (str(i.county)) notes.push(`County: ${str(i.county)} (the 04/2026 form has no county field)`);

  // Section II: the certificate type carries over; a typed accrediting organization is matched to the form's list.
  const ct = str(r.ii.certificate_type);
  out.ii.certificate_type = (CERTIFICATE_TYPES.some((c) => c.value === ct) ? ct : "") as CertificateType;
  const orgText = str(r.ii.accrediting_org);
  if (orgText) {
    out.ii.accrediting_orgs = orgsFromText(orgText);
    if (out.ii.accrediting_orgs.length === 0) notes.push(`Accrediting organization: ${orgText} (not one the 04/2026 form lists; pick from its list in section 2)`);
  }

  // Section III: the earlier labels map one to one onto the 04/2026 list.
  const lt = str(r.iii.lab_type);
  if (lt) {
    const code = EARLIER_LAB_TYPES[lt];
    if (code) out.iii.lab_type = code;
    else notes.push(`Type of laboratory: ${lt} (pick the matching type in section 3)`);
  }
  out.iii.lab_type_other = str(r.iii.lab_type_other);

  // Section IV asked total hours per week; the 04/2026 form asks the hours of each day.
  if (str(r.iv.hours_per_week)) notes.push(`Hours of testing: ${str(r.iv.hours_per_week)} hours per week (section 4 now asks the times for each day)`);

  // Section V: yes/no carries over; the free-text list of sites is kept as one site's text for the lab to split.
  out.v.multiple_sites = yesNo(r.v.multiple_sites);
  if (str(r.v.sites_text)) notes.push(`Sites listed: ${str(r.v.sites_text)} (section 5 now takes each site's name, address, phone and tests on its own row)`);

  // Section VI and VII: "no" becomes the form's "none performed" box; the volume carries over.
  if (r.vi.has_waived_testing === "no") out.vi.none_performed = true;
  out.vi.total_volume = str(r.vi.estimated_annual_volume);
  if (r.vii.has_ppm === "no") out.vii.none_performed = true;
  out.vii.total_volume = str(r.vii.estimated_annual_volume);
  if (r.vii.has_ppm === "yes") notes.push("PPM testing: yes (section 7 now asks which PPM procedures are performed)");

  // Section VIII: the same specialty boxes carry over; histocompatibility and antibody detection are split on the
  // 04/2026 form, so a box there is left for the lab to pick.
  for (const k of EARLIER_SPECIALTY_SAME) if (bool(r.viii[k])) out.viii.specialties[k].checked = true;
  if (bool(r.viii.histocompatibility)) notes.push("Histocompatibility was checked (section 8 now splits it into Transplant and Nontransplant)");
  if (bool(r.viii.immunohem_antibody_detection)) notes.push("Antibody Detection was checked (section 8 now splits it into transfusion and nontransfusion)");

  // Section IX's total volume is section 8's total on the 04/2026 form.
  out.viii.total_volume = str(r.ix.total_annual_volume);

  // Section X held the type of control and the director. The director's name moves to section 1; the earlier control
  // choices aren't the form's categories, so they are listed for the lab to pick in section 9.
  const x = r.x;
  out.i.director_name = str(x.director_name);
  const control = str(x.control_type);
  if (control) {
    const label = EARLIER_CONTROL_LABELS[control] || control;
    notes.push(`Type of control: ${label}${str(x.control_other) ? `, ${str(x.control_other)}` : ""} (pick the matching type in section 9)`);
  }
  if (str(x.director_credentials)) notes.push(`Director credentials: ${str(x.director_credentials)} (the 04/2026 form asks for proof of the director's qualifications sent with it, not a field)`);
  if (str(x.director_npi)) notes.push(`Director NPI: ${str(x.director_npi)} (not on the 04/2026 form)`);
  if (str(x.director_clia_director_number)) notes.push(`CLIA director ID: ${str(x.director_clia_director_number)} (not on the 04/2026 form)`);

  return { sections: out, carriedNotes: notes, earlierLayout: true };
}

// The director's name for the issued-certificate record: the signature line's printed name first, then section 1's.
export function cms116DirectorName(signatureName: string | null | undefined, raw: RawCms116Sections): string | null {
  const signed = str(signatureName).trim();
  if (signed) return signed;
  const name = normalizeCms116(raw).sections.i.director_name.trim();
  return name || null;
}
