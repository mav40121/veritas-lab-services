// scripts/verify-clia-role-qualifications.mjs
//
// Angie Cedeno 2026-10-21: "Your TS qualifications are incorrect. You're missing bachelors plus 4 years." Then:
// "Can we please allow multiple credentials? ... I have a BS/BA who is also an MLTASCP but also an MTAMT", plus
// ASCPi (international) credentials and a custom entry (Michael).
//
// Part A pins the Add Employee dialog's minimum-qualification text to 42 CFR 493 Subpart M as amended 12/28/2023
// (88 FR 90039-90044), read from eCFR as of 2026-10-01:
//   493.1449(c)/(d)(5): bachelor's + 4 years for microbiology and for DI/chemistry/hematology/IH/radiobioassay
//   493.1449(c)(4)/(d)(4): master's + 2 years; (c)(2)-(3)/(d)(2)-(3): MD/DO/DPM or doctoral + 1 year
//   493.1449(e)-(g): cytology, histopathology, derm, ophthalmic, oral pathology are physician/board routes only
//   493.1449(h)/(i): histocompatibility and cytogenetics need MD/DO/DPM or doctoral, 4 years
//   493.1461(c)(1): GS bachelor's needs 1 year (the old text said 2, plus a 20-CEU route that is not in the rule)
//   493.1411(b)(5): TC associate degree + 4 years (new in the 2024 rule, missing before)
//   493.1443(b)(2): LD MD/DO/DPM route = 2 years directing/supervising + 20 CE hours (old text said 1 year)
//   493.1423(b)(1): moderate testing personnel physician route is MD/DO only, no DPM
// Part B checks the multi-credential round trip in shared/staffTitles.ts.
// Usage: node --import tsx scripts/verify-clia-role-qualifications.mjs
import { CLIA_ROLE_QUALIFICATIONS as Q, TS_SPECIALTY_QUALIFICATIONS, tsQualificationsFor, QUALIFICATION_FOOTNOTE } from "../shared/cliaRoleQualifications.ts";
import { buildCredentialFields, parseCredentialFields, getCredentialPickerGroups, getStaffTitleLabel, inferStaffTitleCode, STAFF_TITLE_OPTIONS } from "../shared/staffTitles.ts";

let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!ok) fails++; };
const line = (n) => tsQualificationsFor([n]).map((q) => q.text).join(" | ");

// ── Part A: qualification text ─────────────────────────────────────────
for (const n of [1, 2, 3, 4, 5]) check(`A1. TS specialty ${n} (microbiology) includes bachelor's + 4 years, master's + 2, 6 months in subspecialty`, /bachelor's degree with 4 years/.test(line(n)) && /master's degree with 2 years/.test(line(n)) && /6 months in the subspecialty/.test(line(n)) && /493\.1449\(c\)/.test(line(n)), line(n));
for (const n of [6, 7, 8, 9, 10]) check(`A2. TS specialty ${n} includes bachelor's + 4 years, master's + 2, doctoral + 1, 493.1449(d)`, /bachelor's degree with 4 years/.test(line(n)) && /master's degree with 2 years/.test(line(n)) && /doctoral degree, with 1 year/.test(line(n)) && /493\.1449\(d\)/.test(line(n)), line(n));
for (const n of [11, 12, 13, 14, 15]) check(`A3. TS specialty ${n} (AP subspecialty) offers no degree-plus-experience route`, !/bachelor|master|doctoral/.test(line(n)) && /anatomic pathology/.test(line(n)), line(n));
check("A4. TS histocompatibility: MD/DO/DPM or doctoral, 4 years, 493.1449(h); no bachelor's", /4 years in histocompatibility/.test(line(16)) && !/bachelor/.test(line(16)) && /493\.1449\(h\)/.test(line(16)), line(16));
check("A5. TS cytogenetics: 4 years in genetics, 2 in clinical cytogenetics, 493.1449(i)", /4 years in genetics, 2 of them in clinical cytogenetics/.test(line(17)) && /493\.1449\(i\)/.test(line(17)), line(17));
const covered = new Set(TS_SPECIALTY_QUALIFICATIONS.flatMap((q) => q.specialties));
check("A6. every CMS 209 specialty 1-17 has exactly one TS line", Array.from({ length: 17 }, (_, i) => i + 1).every((n) => covered.has(n) && tsQualificationsFor([n]).length === 1), [...covered]);
check("A7. specialties 7 + 8 + 1 collapse to two lines in regulation order (c) then (d)", tsQualificationsFor([8, 7, 1]).map((q) => q.label).join("|") === "Microbiology|Diagnostic immunology, chemistry, hematology, immunohematology, radiobioassay");
check("A8. no specialty picked -> no TS lines (the dialog asks to pick)", tsQualificationsFor([]).length === 0);
check("A9. GS: bachelor's with 1 year, associate route 2 years, no 20-CEU route", /bachelor's degree, with 1 year/.test(Q.GS.high) && /associate degree \(§493\.1489\(b\)\(3\)\) with 2 years/.test(Q.GS.high) && !/CEU/.test(Q.GS.high), Q.GS.high);
check("A10. TC: associate degree + 4 years present, bachelor's + 2", /associate degree .* with 4 years/.test(Q.TC.moderate) && /bachelor's degree with 2 years/.test(Q.TC.moderate), Q.TC.moderate);
check("A11. LD high: MD/DO/DPM route is 2 years + 20 CE credit hours; board-certified pathologist route present", /MD\/DO\/DPM with 2 years directing or supervising high complexity testing and 20 CE credit hours/.test(Q.LD.high) && /certified in anatomic or clinical pathology/.test(Q.LD.high), Q.LD.high);
check("A12. LD moderate: bachelor's route = 2 years testing + 2 years supervising + 20 CE", /bachelor's degree with 2 years of nonwaived testing, 2 years supervising it, and 20 CE credit hours/.test(Q.LD.moderate), Q.LD.moderate);
check("A13. TP moderate physician route is MD/DO (no DPM); nursing counts", /^MD\/DO;/.test(Q.TP.moderate) && /nursing/.test(Q.TP.moderate), Q.TP.moderate);
check("A14. CC high cites 493.1455, moderate 493.1417, both allow a licensed MD, DO or DPM", /493\.1455/.test(Q.CC.high) && /493\.1417/.test(Q.CC.moderate) && /licensed MD, DO or DPM/.test(Q.CC.high) && /licensed MD, DO or DPM/.test(Q.CC.moderate));
check("A15. footnote names the 12/28/2024 grandfather clause and the degree fields", /12\/28\/2024/.test(QUALIFICATION_FOOTNOTE) && /medical technology/.test(QUALIFICATION_FOOTNOTE));
const allText = [...Object.values(Q).flatMap((v) => Object.values(v)), ...TS_SPECIALTY_QUALIFICATIONS.map((q) => q.text + q.label), QUALIFICATION_FOOTNOTE].join("\n");
check("A16. no em dashes in any customer-facing qualification text", !allText.includes("—"));

// ── Part B: credentials ────────────────────────────────────────────────
const angie = buildCredentialFields(["MT_AMT", "MLT_ASCP", "BS_BA"], []);
check("B1. Angie's example: BS/BA + MLT(ASCP) + MT(AMT) -> one title in fixed order", angie.title === "BS / BA, MLT(ASCP), MT(AMT)" && angie.titleCode === "BS_BA,MLT_ASCP,MT_AMT", angie);
const p1 = parseCredentialFields(angie.title, angie.titleCode);
check("B2. ...and parses back to the same three codes, no custom entries", p1.codes.join(",") === "BS_BA,MLT_ASCP,MT_AMT" && p1.customs.length === 0, p1);
const intl = buildCredentialFields(["MLS_ASCPI"], ["NY State CLT License"]);
check("B3. ASCPi + custom entry -> title + OTHER marker", intl.title === "MLS(ASCPi), NY State CLT License" && intl.titleCode === "MLS_ASCPI,OTHER", intl);
const p2 = parseCredentialFields(intl.title, intl.titleCode);
check("B4. ...and the custom entry comes back as typed", p2.codes.join() === "MLS_ASCPI" && p2.customs.join("|") === "NY State CLT License", p2);
const typedLabel = buildCredentialFields([], ["mt (amt)", "MT(AMT)", " "]);
check("B5. a typed custom entry matching a known label is stored as that code, once; blanks dropped", typedLabel.titleCode === "MT_AMT" && typedLabel.title === "MT(AMT)", typedLabel);
const legacy = parseCredentialFields("MLS(ASCP)", "MLS_ASCP");
check("B6. legacy single-code row reads as one chip", legacy.codes.join() === "MLS_ASCP" && legacy.customs.length === 0, legacy);
const legacyBackfill = parseCredentialFields("Medical Laboratory Scientist", "MLS_ASCP");
check("B7. legacy keyword-backfilled row: chip shows, stored title kept (no phantom custom chip)", legacyBackfill.codes.join() === "MLS_ASCP" && legacyBackfill.customs.length === 0, legacyBackfill);
const legacyOther = parseCredentialFields("Lab Assistant II", "OTHER");
check("B8. legacy OTHER row: its free text becomes the custom entry", legacyOther.codes.length === 0 && legacyOther.customs.join() === "Lab Assistant II", legacyOther);
const noCode = parseCredentialFields("Supervisor", null);
check("B9. title with no code at all: shown as a custom entry, rebuilds to the same title", noCode.customs.join() === "Supervisor" && buildCredentialFields(noCode.codes, noCode.customs).title === "Supervisor", noCode);
check("B10. empty -> empty title and code (stored as NULL by the routes)", JSON.stringify(buildCredentialFields([], [])) === JSON.stringify({ title: "", titleCode: "" }));
const groups = getCredentialPickerGroups();
check("B11. picker groups: Degree, ASCP, ASCPi, AMT; OTHER marker not offered", Object.keys(groups).join(",") === "Degree,ASCP,ASCPi,AMT" && !Object.values(groups).flat().some((o) => o.code === "OTHER"), Object.keys(groups));
check("B12. ASCPi labels use the (ASCPi) suffix and unique codes", groups.ASCPi.length >= 2 && groups.ASCPi.every((o) => /\(ASCPi\)$/.test(o.label)) && new Set(STAFF_TITLE_OPTIONS.map((o) => o.code)).size === STAFF_TITLE_OPTIONS.length, groups.ASCPi.map((o) => o.label));
check("B13. codes never contain a comma (title_code is comma-joined)", STAFF_TITLE_OPTIONS.every((o) => !o.code.includes(",")));
check("B14. boot backfill unchanged: 'MLS(ASCP)' still infers MLS_ASCP; ASCPi adds no keywords", inferStaffTitleCode("MLS(ASCP)") === "MLS_ASCP" && groups.ASCPi.every((o) => o.keywords.length === 0));
check("B15. label lookup works for a new code", getStaffTitleLabel("PBT_ASCPI") === "PBT(ASCPi)");

console.log(fails ? `${fails} FAIL` : "ALL PASS");
process.exit(fails ? 1 : 0);
