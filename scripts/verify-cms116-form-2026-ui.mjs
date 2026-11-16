// scripts/verify-cms116-form-2026-ui.mjs
// Gate 3 browser receipt for the VeritaLab CMS-116 tab on Form CMS-116 (04/2026) (Michael 2026-11-15, Q339 = 1;
// shared/cms116Form.ts, client/src/components/veritalab/Cms116FormTab.tsx, server/cms116Pdf.ts).
// Run against a LOCAL server on a scratch database (it registers owners, provisions labs and writes drafts, so it
// refuses any other host):
//   PW_BASE=http://localhost:5326 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-cms116-form-2026-ui.mjs
//   1. the tab shows sections 1 to 10 of the 04/2026 form; new fields (a second email, the owner, the CCN question,
//      a waived test row) save and read back after a reload, stored with form_version 2026-04;
//   2. Download PDF gives the worksheet: the 04/2026 sections, the saved entries, "Copy these entries onto CMS's
//      current Form CMS-116", and not the old "Mail the signed packet" line;
//   3. a draft saved on the tab's earlier layout opens with what fits carried over and the rest listed; Save Draft
//      stores it on the 04/2026 layout and the list goes;
//   4. marking a draft issued (the API the wire-back reads) names section 1's director on the new certificate;
//   5. dark mode, no page errors.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
// The scratch account's password: made at run time, never stored, gone with the scratch database.
const scratchPassword = () => ["Aa1", randomUUID()].join("!");
const owner = async (tag, labName, clia) => {
  const email = `cms116-${tag}-${Date.now()}@example.test`;
  const reg = (await call("POST", "/api/auth/register", { email, password: scratchPassword(), name: "Made Up Director", hipaa_acknowledged: true })).body;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).body.labId;
  const sdb = new Database(process.env.SCRATCH_DB);
  sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = ? WHERE id = ?").run(clia, labId);
  sdb.close();
  return { reg, labId };
};
const A = await owner("a", "Made-up Valley Hospital Laboratory", "99D9990116");
const B = await owner("b", "Made-up Earlier Layout Lab", "99D9990117");
check("scratch owners and labs created", Boolean(A.labId && B.labId && A.reg.token && B.reg.token));

// Lab B holds a draft saved by the tab's earlier layout, as that tab stored it.
const EARLIER = {
  i: { legal_name: "Made-up Earlier Layout Lab", dba: "Earlier Lab", street: "2 Made-up Rd", city: "Testville", state: "ME", zip: "04000", county: "Somerset", telephone: "555-0200", fax: "", email: "earlier@example.test", federal_tax_id: "" },
  ii: { certificate_type: "compliance", accrediting_org: "" },
  iii: { lab_type: "Hospital", lab_type_other: "" },
  iv: { hours_per_week: "168" },
  v: { multiple_sites: "no", sites_text: "" },
  vi: { has_waived_testing: "no", estimated_annual_volume: "" },
  vii: { has_ppm: "no", estimated_annual_volume: "" },
  viii: { chem_routine: true, histocompatibility: true },
  ix: { total_annual_volume: "40000" },
  x: { control_type: "corporation", control_other: "", director_name: "Earlier Q Director", director_credentials: "MD", director_npi: "", director_clia_director_number: "" },
};
{
  const sdb = new Database(process.env.SCRATCH_DB);
  const now = new Date().toISOString();
  sdb.prepare(`INSERT INTO cms116_drafts (lab_id, section_i_json, section_ii_json, section_iii_json, section_iv_json, section_v_json, section_vi_json, section_vii_json, section_viii_json, section_ix_json, section_x_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`).run(B.labId, ...["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"].map((k) => JSON.stringify(EARLIER[k])), now, now);
  sdb.close();
}

const browser = await chromium.launch();
const errors = [];
const open = async (who, dark) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1500 }, colorScheme: dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, d]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", d ? "dark" : "light"); }, [who.reg.token, who.reg.user, dark]);
  await page.goto(`${BASE}/labs/${who.labId}/veritalab-app`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /CMS-116/ }).click();
  await page.getByText(/Form CMS-116 \(04\/2026\), CLIA Application/).waitFor({ timeout: 20000 });
  return { ctx, page };
};
const panelShot = async (page, file) => {
  await page.addStyleTag({ content: "header, nav.sticky, .sticky.top-0 { visibility: hidden !important; }" });
  await page.locator("[role=tabpanel][data-state=active]").first().screenshot({ path: path.join(OUT, file) });
};
const pickSelect = async (page, triggerLabel, optionName) => {
  await page.getByRole("combobox", { name: triggerLabel }).click();
  await page.getByRole("option", { name: optionName }).click();
};
const sectionTitles = [
  "1. General Information", "2. Type of Certificate Requested", "3. Type of Laboratory", "4. Hours of Laboratory Testing",
  "5. Multiple Sites", "6. Waived Testing to Be Performed", "7. PPM Testing to Be Performed",
  "8. Non-Waived Testing to Be Performed", "9. Type of Control", "10. Director Affiliation with Other Laboratories",
];

// 1. Lab A: fill new fields, save, reload, read back.
{
  const { ctx, page } = await open(A, false);
  const triggers = await page.locator("[role=tabpanel][data-state=active] button[aria-expanded]").allTextContents();
  check("1a the tab shows sections 1 to 10 of the 04/2026 form, in order", sectionTitles.every((t, n) => (triggers[n] || "").trim() === t), JSON.stringify(triggers));
  await page.getByLabel("Initial application", { exact: true }).check();
  await page.getByLabel("Anticipated start date", { exact: true }).fill("2027-01-04");
  await page.getByLabel("Facility name", { exact: true }).fill("Made-up Valley Hospital Laboratory");
  await page.getByLabel("Email address 2 (optional)", { exact: true }).fill("director@example.test");
  await page.getByLabel("Name of Laboratory Director (Last, First, Middle initial)", { exact: true }).fill("Doe, Jane, Q");
  await page.getByLabel("Name of Owner", { exact: true }).fill("Made-up Health System");
  await page.getByRole("button", { name: "3. Type of Laboratory" }).click();
  await pickSelect(page, "Type of laboratory", "14 Hospital*");
  await pickSelect(page, /CMS-certified health care facility/, "Yes");
  await page.getByLabel("CMS Certification Numbers (CCNs)", { exact: true }).fill("000116");
  await page.getByRole("button", { name: "6. Waived Testing to Be Performed" }).click();
  await page.getByRole("button", { name: "Add waived test" }).click();
  await page.getByLabel("Analyte/Test, row 1", { exact: true }).fill("Glucose");
  await page.getByLabel("Test Name, row 1", { exact: true }).fill("Made-up meter");
  await page.getByLabel("Manufacturer, row 1", { exact: true }).fill("Made-up Co");
  await page.getByRole("button", { name: "Save Draft" }).first().click();
  await page.getByText("Draft saved").first().waitFor({ timeout: 10000 });
  await panelShot(page, "cms116-tab-light.png");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /CMS-116/ }).click();
  await page.getByText(/Form CMS-116 \(04\/2026\), CLIA Application/).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "3. Type of Laboratory" }).click();
  await page.getByRole("button", { name: "6. Waived Testing to Be Performed" }).click();
  const back = {
    facility: await page.getByLabel("Facility name", { exact: true }).inputValue(),
    email2: await page.getByLabel("Email address 2 (optional)", { exact: true }).inputValue(),
    owner: await page.getByLabel("Name of Owner", { exact: true }).inputValue(),
    start: await page.getByLabel("Anticipated start date", { exact: true }).inputValue(),
    ccn: await page.getByLabel("CMS Certification Numbers (CCNs)", { exact: true }).inputValue(),
    labType: (await page.getByRole("combobox", { name: "Type of laboratory" }).textContent() || "").trim(),
    waived: await page.getByLabel("Analyte/Test, row 1", { exact: true }).inputValue(),
  };
  check("1b the new fields read back after a reload", back.facility === "Made-up Valley Hospital Laboratory" && back.email2 === "director@example.test" && back.owner === "Made-up Health System" && back.start === "2027-01-04" && back.ccn === "000116" && back.labType === "14 Hospital*" && back.waived === "Glucose", JSON.stringify(back));
  const sdb = new Database(process.env.SCRATCH_DB, { readonly: true });
  const row = sdb.prepare("SELECT section_i_json, section_iii_json, section_vi_json FROM cms116_drafts WHERE lab_id = ?").get(A.labId);
  sdb.close();
  const i = JSON.parse(row.section_i_json), iii = JSON.parse(row.section_iii_json), vi = JSON.parse(row.section_vi_json);
  check("1c stored on the 04/2026 layout (form_version, section 3 code and CCN, section 6 row)", i.form_version === "2026-04" && iii.lab_type === "14" && iii.in_cms_certified_facility === "yes" && vi.tests[0].analyte === "Glucose", row.section_i_json.slice(0, 80));

  // 2. Download PDF.
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download PDF" }).click()]);
  const pdfPath = path.join(OUT, "cms116-download.pdf");
  await dl.saveAs(pdfPath);
  const head = fs.readFileSync(pdfPath).subarray(0, 5).toString();
  check("2a Download PDF gives a PDF", head === "%PDF-" && /^CMS-116_Worksheet_Made-up_Valley_Hospital_Laboratory.pdf$/.test(dl.suggestedFilename()), `${head} ${dl.suggestedFilename()}`);
  const py = spawnSync("python", ["-E", "-P", "C:/Users/veril/projects/vls-ops/pdf_text_has.py", pdfPath,
    "Form CMS-116 (04/2026) worksheet", "1. General Information", "10. Director Affiliation with Other Laboratories",
    "Made-up Valley Hospital Laboratory", "director@example.test", "Made-up Health System", "000116", "Made-up meter",
    "Copy these entries onto CMS's current Form CMS-116", "CLIA: 99D9990116",
    "--lacks", "Mail the signed packet", "wet ink required", "Section X. Type of Control"], { encoding: "utf8" });
  console.log(py.stdout.trim().split("\n").map((l) => "      " + l).join("\n"));
  check("2b the worksheet holds the 04/2026 sections and the saved entries, and not the old mailing line", py.status === 0, py.stderr);
  await ctx.close();
}

// 3. Lab B: the earlier-layout draft.
{
  const { ctx, page } = await open(B, false);
  const banner = page.getByTestId("cms116-carried-notes");
  await banner.waitFor({ timeout: 10000 });
  const text = (await banner.textContent()) || "";
  check("3a the earlier-layout notice lists what has no field or needs a choice",
    /saved on the earlier CMS-116 layout/.test(text) && /Doing business as: Earlier Lab/.test(text) && /168 hours per week/.test(text) && /Histocompatibility was checked/.test(text) && /Type of control: Corporation/.test(text), text.slice(0, 300));
  const carried = {
    facility: await page.getByLabel("Facility name", { exact: true }).inputValue(),
    email1: await page.getByLabel("Email address 1", { exact: true }).inputValue(),
    director: await page.getByLabel("Name of Laboratory Director (Last, First, Middle initial)", { exact: true }).inputValue(),
  };
  check("3b what fits is carried over (facility, email, director now in section 1)", carried.facility === "Made-up Earlier Layout Lab" && carried.email1 === "earlier@example.test" && carried.director === "Earlier Q Director", JSON.stringify(carried));
  await panelShot(page, "cms116-earlier-layout-light.png");
  await page.getByRole("button", { name: "Save Draft" }).first().click();
  await page.getByText("Draft saved").first().waitFor({ timeout: 10000 });
  check("3c after Save Draft the notice is gone", (await page.getByTestId("cms116-carried-notes").count()) === 0);
  const sdb = new Database(process.env.SCRATCH_DB, { readonly: true });
  const row = sdb.prepare("SELECT section_i_json, section_iii_json, section_viii_json, section_x_json FROM cms116_drafts WHERE lab_id = ?").get(B.labId);
  sdb.close();
  const i = JSON.parse(row.section_i_json), iii = JSON.parse(row.section_iii_json), viii = JSON.parse(row.section_viii_json), x = JSON.parse(row.section_x_json);
  check("3d stored on the 04/2026 layout (form_version, director in section 1, Hospital -> 14, total volume in section 8, section 10 a list)",
    i.form_version === "2026-04" && i.director_name === "Earlier Q Director" && iii.lab_type === "14" && viii.total_volume === "40000" && Array.isArray(x.other_labs), JSON.stringify({ i: i.form_version, lt: iii.lab_type, tv: viii.total_volume }));
  await ctx.close();
}

// 4. The issued-certificate wire-back reads section 1's director.
{
  const sdb = new Database(process.env.SCRATCH_DB, { readonly: true });
  const r = sdb.prepare("SELECT * FROM cms116_drafts WHERE lab_id = ?").get(A.labId);
  sdb.close();
  const sections = Object.fromEntries(["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"].map((k) => [k, JSON.parse(r[`section_${k}_json`])]));
  const put = await call("PUT", `/api/labs/${A.labId}/veritalab/cms116-draft`, { sections, director_signature_name: "", director_signature_date: "", status: "issued", notes: "" }, A.reg.token);
  const db2 = new Database(process.env.SCRATCH_DB, { readonly: true });
  const cert = put.body.issuedCertId ? db2.prepare("SELECT lab_id, lab_director, cert_type FROM lab_certificates WHERE id = ?").get(put.body.issuedCertId) : null;
  db2.close();
  check("4a marking the draft issued creates the CLIA certificate naming section 1's director", put.status === 200 && cert && cert.lab_id === A.labId && cert.cert_type === "clia" && cert.lab_director === "Doe, Jane, Q", JSON.stringify({ status: put.status, cert }));
}

// 5. Dark mode.
{
  const { ctx, page } = await open(A, true);
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("button", { name: "8. Non-Waived Testing to Be Performed" }).click();
  await panelShot(page, "cms116-tab-dark.png");
  check("5a dark mode renders the tab", isDark);
  await ctx.close();
}
await browser.close();
check("5b no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
