// scripts/verify-veritapolicy-house-redington.mts
//
// Verifies the Redington-Fairview house format (server/veritapolicyHouseFormats.ts buildRedingtonFairviewDocument),
// the DOCX layout lab 34 gets once veritapolicy_settings.docx_format = 'redington_fairview'.
//
// For EVERY policy on the master list that has a template:
//  - renders without throwing; no literal <<LAB_NAME>>; 0 em dashes in body, header, footer
//  - section labels appear in the template's order: Title, Department, Effective Date, Authorization, Principle, Policy,
//    Procedure, References, Revised, Biannual Approval/Review Documentation
//  - matches their template (.docx read 2026-10-13): first-page header = logo + "Laboratory Department" (Arial Black),
//    later pages no header text; footer "Pg. <PAGE>"; sections numbered 01.-06. (decimalZero); 5-column review grid;
//    labels Arial Black, body Arial
// Branches: Department default "Laboratory" vs a set department; crosswalk CAP line present vs crosswalk null;
// house.revision vs the draft line; UNCONTROLLED watermark image on vs off; stock (house null) and umass_milford still render.
//
// Run: npx tsx scripts/verify-veritapolicy-house-redington.mts   (exits 1 on any FAIL)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT); // template loader resolves server/policyTemplates/data from the working directory
const require = createRequire(path.join(ROOT, "package.json"));
const JSZip = require("jszip");
const { generatePolicyDocxBuffer } = await import("../server/veritapolicyDocx");
const { VERITAPOLICY_MASTER_LIST } = await import("../server/veritapolicyMasterList");

const LAB = { lab_name: "Riverside Regional Medical Center", clia_number: "22D0999999" };
const RF = { format: "redington_fairview" as const, draftDate: "2026-10-13" };
const ORDER = ["Title:", "Department:", "Effective Date:", "Authorization:", "Principle:", "Policy:", "Procedure:", "References:", "Revised:", "Biannual Approval/Review Documentation:"];
let fails = 0, passes = 0;
const check = (ok: boolean, label: string) => { if (ok) passes++; else { fails++; console.log(`FAIL  ${label}`); } };

// Paragraph texts (w:t runs joined per w:p) for the body, all headers, all footers, plus the raw header XML.
async function parts(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const paras = (xml: string) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""));
  const names = Object.keys(zip.files);
  const read = async (re: RegExp) => (await Promise.all(names.filter((n) => re.test(n)).map((n) => zip.file(n).async("string")))).join("\n");
  const body = await read(/^word\/document\.xml$/), header = await read(/^word\/header\d*\.xml$/), footer = await read(/^word\/footer\d*\.xml$/);
  const numbering = await read(/^word\/numbering\.xml$/);
  return { body: paras(body).map((t) => t.trim()), header: paras(header).join(" | "), footer: paras(footer).join(" | "), headerXml: header, footerXml: footer, bodyXml: body, numbering };
}
const crosswalkFor = (row: any) => { const c: any = {}; if (row.cfr_citations) c.cfr = row.cfr_citations; if (row.cap_citations) c.cap = row.cap_citations; return c; };

let rendered = 0, noTemplate = 0;
for (const row of VERITAPOLICY_MASTER_LIST as any[]) {
  const id = String(row.policy_id);
  const buf = await generatePolicyDocxBuffer(id, LAB, crosswalkFor(row), undefined, RF);
  if (!buf) { noTemplate++; continue; }
  rendered++;
  const p = await parts(buf);
  const all = p.body.join("\n");
  check(!/<<LAB_NAME>>/.test(all + p.header + p.footer), `${id}: no literal <<LAB_NAME>>`);
  check(!/—/.test(all + p.header + p.footer), `${id}: no em dash`);
  let at = -1, inOrder = true;
  for (const label of ORDER) { const i = p.body.findIndex((t, k) => k > at && t.startsWith(label)); if (i < 0) { inOrder = false; break; } at = i; }
  check(inOrder, `${id}: section labels in template order`);
  check(p.body.find((t) => t) === `Title: ${row.policy_name}`, `${id}: Title line first (after the template's blank line)`);
  check(p.body.includes("Department: Laboratory"), `${id}: Department defaults to Laboratory`);
  check(p.header.includes("Laboratory Department") && (p.headerXml.match(/<w:drawing/g) || []).length === 1 && /Arial Black/.test(p.headerXml), `${id}: first-page header = logo + "Laboratory Department"`);
  check(/<w:titlePg\/>/.test(p.bodyXml), `${id}: separate first-page header (later pages carry no header text)`);
  check(p.footer.includes("Pg. ") && /PAGE/.test(p.footerXml) && !/NUMPAGES/.test(p.footerXml) && !p.footer.includes(LAB.lab_name), `${id}: footer is "Pg. <page>" only`);
  check(/w:val="decimalZero"/.test(p.numbering), `${id}: sections numbered 01.-06.`);
  check((p.bodyXml.match(/<w:gridCol w:w="1870"\/>/g) || []).length === 5, `${id}: 5-column review grid`);
  check(/w:ascii="Arial Black"/.test(p.bodyXml) && /w:ascii="Arial"/.test(p.bodyXml), `${id}: labels Arial Black, body Arial`);
  if (row.cap_citations) check(p.body.some((t) => t.startsWith("CAP: ")), `${id}: CAP crosswalk listed under References`);
}
console.log(`rendered ${rendered} policies in the Redington format (${noTemplate} master-list rows have no template)`);
check(rendered >= 50, `at least 50 policies render (got ${rendered})`);

// Branches, on policy 5 (Specimen Collection).
const row5: any = (VERITAPOLICY_MASTER_LIST as any[]).find((r) => String(r.policy_id) === "5");
const a = await parts((await generatePolicyDocxBuffer("5", LAB, crosswalkFor(row5), undefined, { ...RF, department: "Phlebotomy" }))!);
check(a.body.includes("Department: Phlebotomy"), "department set: Department line uses it");
const b = await parts((await generatePolicyDocxBuffer("5", LAB, null, undefined, RF))!);
check(!b.body.some((t) => t.startsWith("CAP: ")), "crosswalk null: no CAP line");
check(b.body.some((t) => t.startsWith("42 CFR 493.1232")), "crosswalk null: CFR references still listed");
const c = await parts((await generatePolicyDocxBuffer("5", LAB, null, undefined, { ...RF, revision: "Rev 10-26" }))!);
check(c.body.includes("Rev 10-26"), "revision set: Revised shows the lab's tag");
check(b.body.some((t) => t.startsWith("Draft 2026-10-13, prepared in VeritaDC")), "revision unset: draft line with the render date");
const u = await parts((await generatePolicyDocxBuffer("5", LAB, null, { uncontrolled: true } as any, RF))!);
const pics = (x: string) => (x.match(/<w:drawing|<w:pict/g) || []).length;
check(pics(b.headerXml) === 1 && pics(u.headerXml) === 3, `uncontrolled: watermark in both headers only when requested (logo only ${pics(b.headerXml)}, with watermark ${pics(u.headerXml)})`);
const d = await parts((await generatePolicyDocxBuffer("5", LAB, null, { downloadedBy: "Lindsay Webber", downloadedAt: "2026-10-13" } as any, RF))!);
check(d.footer.includes("Downloaded by Lindsay Webber on 2026-10-13") && !b.footer.includes("Downloaded by"), "downloadedBy: footer line only when set");

// Other renderers untouched.
const stock = await parts((await generatePolicyDocxBuffer("5", LAB, null, undefined, null))!);
check(!stock.body.some((t) => t.startsWith("Biannual Approval/Review Documentation:")), "house null: stock layout, not Redington");
const milford = await generatePolicyDocxBuffer("5", LAB, null, undefined, { format: "umass_milford", draftDate: "2026-10-13" });
check(!!milford && milford.length > 1000, "umass_milford still renders");

console.log(`${passes} PASS, ${fails} FAIL`);
console.log(fails ? "FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
