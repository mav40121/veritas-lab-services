// Minimum CLIA personnel qualifications shown in the VeritaStaff Add/Edit
// Employee dialog when a CLIA role is selected. Paraphrased from 42 CFR 493
// Subpart M as amended by the 12/28/2023 final rule (88 FR 90039-90044,
// effective 12/28/2024), checked against eCFR as of 2026-10-01.
//
// 2026-10-21: rewritten after Angie Cedeno flagged that the TS line left out
// the bachelor's + 4 years route. The audit that followed found the LD, GS,
// TC, CC and testing-personnel lines also predated the 2024 rule. TS
// requirements differ by specialty (493.1449(c)-(i)), so TS now shows one line
// per specialty group picked rather than a single summary.
//
// Customer-facing copy: no em dashes. Pinned by
// scripts/verify-clia-role-qualifications.mjs.

export type QualComplexity = "high" | "moderate";

export const CLIA_ROLE_QUALIFICATIONS: Record<string, Record<QualComplexity, string>> = {
  LD: {
    high: "MD/DO certified in anatomic or clinical pathology (ABP or AOBP); or MD/DO/DPM with 2 years directing or supervising high complexity testing and 20 CE credit hours covering director responsibilities; or a doctoral degree with HHS-approved board certification, 2 years of laboratory training or experience, 2 years directing or supervising high complexity testing, and 20 CE credit hours. 42 CFR §493.1443.",
    moderate: "MD/DO certified in anatomic or clinical pathology; or MD/DO/DPM with 1 year directing or supervising nonwaived testing and 20 CE credit hours; or a doctoral degree with HHS-approved board certification, 1 year directing or supervising nonwaived testing, and 20 CE credit hours; or a master's degree with 1 year of nonwaived testing, 1 year supervising it, and 20 CE credit hours; or a bachelor's degree with 2 years of nonwaived testing, 2 years supervising it, and 20 CE credit hours. 42 CFR §493.1405.",
  },
  CC: {
    // eCFR 493.1455 prints (a) and (b) without the "or" between them; 493.1417 and the
    // pre-2024 text read "or", so the paraphrase keeps it.
    high: "Qualified as a high complexity laboratory director under §493.1443(b)(1), (2) or (3) (oral pathology: (b)(5)), or a licensed MD, DO or DPM. 42 CFR §493.1455.",
    moderate: "Qualified as a moderate complexity laboratory director under §493.1405(b)(1), (2) or (3), or a licensed MD, DO or DPM. 42 CFR §493.1417.",
  },
  TC: {
    high: "Not used at high complexity (see TS instead).",
    moderate: "MD/DO certified in anatomic or clinical pathology; or MD/DO/DPM, or a doctoral or master's degree, with 1 year of nonwaived testing in the specialty; or a bachelor's degree with 2 years; or an associate degree in medical laboratory technology, medical laboratory science or clinical laboratory science with 4 years. 42 CFR §493.1411.",
  },
  TS: {
    high: "Depends on the specialty; each specialty picked below shows its own requirement. An MD/DO certified in both anatomic and clinical pathology qualifies for every specialty except histocompatibility and clinical cytogenetics. 42 CFR §493.1449.",
    moderate: "Not used at moderate complexity (see TC instead).",
  },
  GS: {
    high: "Qualified as a laboratory director or technical supervisor; or MD/DO/DPM, or a doctoral, master's or bachelor's degree, with 1 year of high complexity testing; or qualified as high complexity testing personnel by associate degree (§493.1489(b)(3)) with 2 years of high complexity testing. Blood gas analysis has its own routes. 42 CFR §493.1461.",
    moderate: "Not used at moderate complexity. 42 CFR §493.1459.",
  },
  TP: {
    high: "MD/DO/DPM; or a doctoral, master's or bachelor's degree; or an associate degree in a laboratory science or medical laboratory technology (or 60 semester hours with the required science and laboratory training); or a 50-week U.S. military medical laboratory course as a Medical Laboratory Specialist. 42 CFR §493.1489.",
    moderate: "MD/DO; or a doctoral, master's, bachelor's or associate degree in a laboratory science, medical technology or nursing; or a high school diploma or equivalent with documented training before testing patient specimens, or the 50-week U.S. military medical laboratory course. 42 CFR §493.1423.",
  },
};

export interface TsSpecialtyQualification {
  /** CMS 209 specialty numbers this line covers. */
  specialties: number[];
  label: string;
  text: string;
}

// 42 CFR 493.1449(c)-(i), one entry per paragraph. The doctoral, master's and
// bachelor's routes include the education equivalencies in the cited paragraph.
export const TS_SPECIALTY_QUALIFICATIONS: TsSpecialtyQualification[] = [
  {
    specialties: [1, 2, 3, 4, 5],
    label: "Microbiology",
    text: "MD/DO certified in clinical pathology; or MD/DO/DPM, or a doctoral degree, with 1 year of high complexity microbiology testing; or a master's degree with 2 years; or a bachelor's degree with 4 years. Every experience route needs 6 months in the subspecialty. 42 CFR §493.1449(c).",
  },
  {
    specialties: [6, 7, 8, 9, 10],
    label: "Diagnostic immunology, chemistry, hematology, immunohematology, radiobioassay",
    text: "MD/DO certified in clinical pathology; or MD/DO/DPM, or a doctoral degree, with 1 year of high complexity testing in the specialty; or a master's degree with 2 years; or a bachelor's degree with 4 years. 42 CFR §493.1449(d).",
  },
  {
    specialties: [11],
    label: "Cytology",
    text: "MD/DO certified in anatomic pathology (ABP or AOBP). 42 CFR §493.1449(e).",
  },
  {
    specialties: [12],
    label: "Histopathology",
    text: "MD/DO certified in anatomic pathology (ABP or AOBP). 42 CFR §493.1449(f)(1).",
  },
  {
    specialties: [13],
    label: "Dermatopathology",
    text: "MD/DO certified in anatomic pathology, in dermatopathology (American Board of Dermatology and ABP), or in dermatology (American Board of Dermatology). 42 CFR §493.1449(f)(2).",
  },
  {
    specialties: [14],
    label: "Ophthalmic pathology",
    text: "MD/DO certified in anatomic pathology, or certified by the American Board of Ophthalmology with 1 year of post-residency fellowship training in ophthalmic pathology. 42 CFR §493.1449(f)(3).",
  },
  {
    specialties: [15],
    label: "Oral pathology",
    text: "MD/DO certified in anatomic pathology, or certified in oral pathology by the American Board of Oral Pathology. 42 CFR §493.1449(g).",
  },
  {
    specialties: [16],
    label: "Histocompatibility",
    text: "MD/DO/DPM or a doctoral degree, with 4 years in histocompatibility, or 2 years in general immunology plus 2 years in histocompatibility. 42 CFR §493.1449(h).",
  },
  {
    specialties: [17],
    label: "Clinical cytogenetics",
    text: "MD/DO/DPM or a doctoral degree in a biological science, with 4 years in genetics, 2 of them in clinical cytogenetics. 42 CFR §493.1449(i).",
  },
];

/** TS lines for the specialties picked, in regulation order, one line per paragraph. */
export function tsQualificationsFor(specialtyNumbers: number[]): TsSpecialtyQualification[] {
  const picked = new Set(specialtyNumbers);
  return TS_SPECIALTY_QUALIFICATIONS.filter((q) => q.specialties.some((n) => picked.has(n)));
}

export const QUALIFICATION_FOOTNOTE =
  "Degrees are in a chemical, biological, clinical or medical laboratory science, or medical technology, from an accredited institution; the cited section lists the equivalency routes. Anyone qualified and serving as LD, TC, TS, GS or testing personnel on 12/28/2024, and continuously since, remains qualified.";
