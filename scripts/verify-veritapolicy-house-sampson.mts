// scripts/verify-veritapolicy-house-sampson.mts
//
// Verifies the Sampson Regional house format (server/veritapolicyHouseFormats.ts buildSampsonRegionalDocument), the DOCX
// layout lab 36 gets once veritapolicy_settings.docx_format = 'sampson_regional' (REQ-019: "Thanks for the policy
// sample. We will use it to put our stock policies in your format." to Natalie Lamb, 2026-10-08).
//
// For EVERY policy on the master list that has a template:
//  - renders without throwing; no literal <<LAB_NAME>>; 0 em dashes in body, header, footer
//  - section order from her PolicyStat printout: title, Policy:, Scope:, Procedure:, REFERENCES:, the "Printed copies"
//    line, Approval Signatures
//  - header block: logo + Origination / Last Approved / Effective / Last Revised / Next Review + Owner / Area; Owner is a
//    role title, never a person's name; approvers "Medical Director or Designee" and "Director of Laboratory Services"
//  - footer "<title>. Copyright (c) <year> <lab>" and "Page X of Y"; no vendor line; procedure steps upper-Roman; Arial
// Branches: revision set vs draft date; department set vs "Laboratory"; crosswalk CAP line vs null; UNCONTROLLED watermark
// on vs off; downloadedBy line; stock (house null), umass_milford and redington_fairview still render.
//
// Run: npx tsx scripts/verify-veritapolicy-house-sampson.mts   (exits 1 on any FAIL)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT); // template loader resolves server/policyTemplates/data from the working directory
const require = createRequire(path.join(ROOT, "package.json"));
const JSZip = require("jszip");
const { generatePolicyDocxBuffer } = await import("../server/veritapolicyDocx");
const { VERITAPOLICY_MASTER_LIST } = await import("../server/veritapolicyMasterList");

const LAB = { lab_name: "Sampson Regional Medical Center", clia_number: "34D0000000" };
const SR = { format: "sampson_regional" as const, draftDate: "2026-10-15" };
let fails = 0, passes = 0;
const check = (ok: boolean, label: string) => { if (ok) passes++; else { fails++; console.log(`FAIL  ${label}`); } };

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
const ORDER = ["Policy:", "Scope:", "Procedure:", "REFERENCES:", "Printed copies are for reference only.", "Approval Signatures"];

let rendered = 0, noTemplate = 0;
for (const row of VERITAPOLICY_MASTER_LIST as any[]) {
  const id = String(row.policy_id);
  const buf = await generatePolicyDocxBuffer(id, LAB, crosswalkFor(row), undefined, SR);
  if (!buf) { noTemplate++; continue; }
  rendered++;
  const p = await parts(buf);
  const all = p.body.join("\n");
  check(!/<<LAB_NAME>>/.test(all + p.header + p.footer), `${id}: no literal <<LAB_NAME>>`);
  check(!/—/.test(all + p.header + p.footer), `${id}: no em dash`);
  const ti = p.body.findIndex((t) => t === row.policy_name || t.startsWith(row.policy_name));
  let at = ti, inOrder = ti >= 0;
  for (const label of ORDER) { const i = p.body.findIndex((t, k) => k > at && t.startsWith(label)); if (i < 0) { inOrder = false; break; } at = i; }
  check(inOrder, `${id}: title then Policy, Scope, Procedure, REFERENCES, printed-copies line, Approval Signatures`);
  check(["Origination  10/15/2026", "Last Approved  ________", "Effective  ________", "Last Revised  10/15/2026", "Next Review  ________"].every((x) => p.body.includes(x)), `${id}: date block (Origination and Last Revised = draft date, approval dates blank)`);
  check(p.body.includes("Owner  Director of Laboratory Services") && p.body.includes("Area  Laboratory") && !/Natalie/.test(all), `${id}: Owner is a role title, Area Laboratory, no person named`);
  check((p.bodyXml.match(/<w:drawing/g) || []).length === 1, `${id}: logo in the header block`);
  check(p.body.includes("Medical Director or Designee") && p.body.includes("Director of Laboratory Services") && p.body.includes("Step Description"), `${id}: Approval Signatures table`);
  check(p.footer.includes(`${row.policy_name}. Copyright © 2026 ${LAB.lab_name}`) && /NUMPAGES/.test(p.footerXml) && /PAGE/.test(p.footerXml) && !/Veritas|VeritaDC|VeritaPolicy/.test(p.footer), `${id}: footer title + copyright, Page X of Y, no vendor line`);
  if ((row.procedure_steps_count ?? 1) > 0) check(/w:val="upperRoman"/.test(p.numbering), `${id}: procedure steps upper-Roman`);
  check(/w:ascii="Arial"/.test(p.bodyXml), `${id}: Arial`);
  if (row.cap_citations) check(p.body.some((t) => t.startsWith("CAP: ")), `${id}: CAP crosswalk listed under REFERENCES`);
}
console.log(`rendered ${rendered} policies in the Sampson format (${noTemplate} master-list rows have no template)`);
check(rendered >= 50, `at least 50 policies render (got ${rendered})`);

// Branches, on policy 36 (Method Verification and Performance Specifications, the subject of her sample).
const row36: any = (VERITAPOLICY_MASTER_LIST as any[]).find((r) => String(r.policy_id) === "36");
const base = await parts((await generatePolicyDocxBuffer("36", LAB, null, undefined, SR))!);
const rev = await parts((await generatePolicyDocxBuffer("36", LAB, null, undefined, { ...SR, revision: "Rev 11/2026", department: "Laboratory - Chemistry", houseNumber: "LAB-036" }))!);
check(rev.body.includes("Last Revised  Rev 11/2026") && rev.body.includes("Area  Laboratory - Chemistry") && rev.body.includes("Document  LAB-036"), "revision, department and house number set: header block uses them");
check(!base.body.some((t) => t.startsWith("Document  ")), "house number unset: no Document line");
check(!base.body.some((t) => t.startsWith("CAP: ")) && base.body.some((t) => /^42 CFR/.test(t)), "crosswalk null: CFR references only");
const withCap = row36 ? await parts((await generatePolicyDocxBuffer("36", LAB, { cap: "COM.40000" } as any, undefined, SR))!) : null;
check(!!withCap && withCap.body.includes("CAP: COM.40000"), "crosswalk set: CAP line listed");
const u = await parts((await generatePolicyDocxBuffer("36", LAB, null, { uncontrolled: true } as any, SR))!);
const pics = (x: string) => (x.match(/<w:drawing|<w:pict/g) || []).length;
check(pics(base.headerXml) === 0 && pics(u.headerXml) >= 1, `uncontrolled: watermark only when requested (off ${pics(base.headerXml)}, on ${pics(u.headerXml)})`);
const dl = await parts((await generatePolicyDocxBuffer("36", LAB, null, { downloadedBy: "Natalie Lamb", downloadedAt: "2026-10-15" } as any, SR))!);
check(dl.footer.includes("Downloaded by Natalie Lamb on 2026-10-15") && !base.footer.includes("Downloaded by"), "downloadedBy: footer line only when set");

// Other renderers untouched.
const stock = await parts((await generatePolicyDocxBuffer("36", LAB, null, undefined, null))!);
check(!stock.body.includes("Approval Signatures") && !stock.body.some((t) => t.startsWith("Origination")), "house null: stock layout, not Sampson");
for (const f of ["umass_milford", "redington_fairview"] as const) {
  const b = await generatePolicyDocxBuffer("36", LAB, null, undefined, { format: f, draftDate: "2026-10-15" });
  check(!!b && b.length > 1000, `${f} still renders`);
}

console.log(`${passes} PASS, ${fails} FAIL`);
console.log(fails ? "FAILED" : "ALL PASS");
process.exit(fails ? 1 : 0);
