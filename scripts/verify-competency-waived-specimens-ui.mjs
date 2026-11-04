// scripts/verify-competency-waived-specimens-ui.mjs
//
// Browser receipt for two RFGH requests (Cathy Thornton, 2026-11-04). On a local production build with a scratch DB, a made-up owner, program and person:
//   W1. New Waived Assessment: Blind specimen testing has Add specimen, each specimen has its own fields and Pass, one can be removed, and saving keeps them.
//   W2. The person page: the same list for a waived method, and the status follows every specimen.
//   N1. A non-technical assessment offers 6-Month and Annual.
//   P1. The person's record PDF spells out each specimen.
//   D1. Dark mode and phone width read and do not overflow.
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-waived-specimens-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const day = "2026-10-15";
const email = `waivedui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Waived UI", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Waived UI Lab", plan: "hospital" })).body.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Waived UI Lab", cliaNumber: "11D7654382", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
sql("UPDATE users SET has_completed_onboarding = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const map = (await call("POST", `${L}/veritamap/maps`, { name: "POC" }, token)).body;
await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Made-up meter", role: "Primary", category: "Point of Care", serial_number: "M1" }, token);
const inst = sql("SELECT id FROM veritamap_instruments WHERE map_id = ?", map.id).id;
await call("PUT", `${L}/veritamap/maps/${map.id}/instruments/${inst}/tests`, { tests: [{ analyte: "Made-up glucose", specialty: "General Chemistry", complexity: "WAIVED", active: 1 }] }, token);
const emp = (await call("POST", `${L}/staff/employees`, { firstName: "Tia", lastName: "Tester", hireDate: "2020-01-06", highestComplexity: "W", performsTesting: true }, token)).body.id;
await call("PUT", `${L}/staff/employees/${emp}/instruments`, { instrumentIds: [inst] }, token);
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up waived program", department: "Point of Care", type: "waived" }, token)).body.id;
const nt = (await call("POST", `${L}/competency/programs`, { name: "Made-up non-technical", department: "Phlebotomy", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, token)).body.id;

const browser = await chromium.launch();
const open = async (p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 900 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
    if (dark) localStorage.setItem("theme", "dark");
  }, [token, owner.body.user, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}${p}`, { waitUntil: "networkidle" });
  return page;
};
const fillSpecimen = async (page, prefix, i, evidence, passed) => {
  await page.getByTestId(`${prefix}-specimen-${i}-evidence`).fill(evidence);
  await page.getByTestId(`${prefix}-specimen-${i}-date`).fill(day);
  await page.getByTestId(`${prefix}-specimen-${i}-initials`).fill("MU");
  if (passed) await page.getByTestId(`${prefix}-specimen-${i}-pass`).check();
};

// W2: the person page
const person = await open(`/veritacomp-app/employee/${emp}`);
const prefix = "waived-method-1";
await person.getByTestId(`${prefix}-add-specimen`).waitFor({ timeout: 15000 });
check("W2. the person page has Add specimen", await person.getByTestId(`${prefix}-add-specimen`).isVisible());
check("W2. only blind specimen testing has it", (await person.getByTestId("waived-method-2-add-specimen").count()) === 0 && await person.getByTestId("waived-method-2-evidence").isVisible());
await fillSpecimen(person, prefix, 0, "BS-1 glucose 92", true);
await person.getByTestId(`${prefix}-add-specimen`).click();
await fillSpecimen(person, prefix, 1, "BS-2 glucose 180", true);
await person.getByTestId(`${prefix}-add-specimen`).click();
await fillSpecimen(person, prefix, 2, "Remove me", false);
check("W2. three rows show", await person.getByTestId(`${prefix}-specimen-2-evidence`).isVisible());
await person.getByTestId(`${prefix}-specimen-2-remove`).click();
check("W2. a row can be removed", (await person.getByTestId(`${prefix}-specimen-2-evidence`).count()) === 0);
await person.waitForTimeout(200);
await person.screenshot({ path: path.join(OUT, "waived-specimens-person.png") });
await person.getByRole("button", { name: /^Save/ }).first().click();
await person.waitForTimeout(1500);
const row = sql("SELECT * FROM competency_assessment_items WHERE instrument_id = ? AND waived_method_number = 1 ORDER BY id DESC LIMIT 1", inst);
check("W2. saving keeps both", row?.waived_evidence === "BS-1 glucose 92" && JSON.parse(row?.waived_specimens_json || "[]").length === 2 && row?.passed === 1, JSON.stringify({ e: row?.waived_evidence, j: row?.waived_specimens_json?.length, p: row?.passed }));
await person.reload({ waitUntil: "networkidle" });
await person.getByTestId(`${prefix}-specimen-1-evidence`).waitFor({ timeout: 15000 });
check("W2. they come back after a reload", (await person.getByTestId(`${prefix}-specimen-1-evidence`).inputValue()) === "BS-2 glucose 180");
await person.context().close();

// P1: the record PDF prints what was signed
const gs = (await call("POST", `${L}/staff/employees`, { lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] }, token)).body.id;
await call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, { waivedMethods: [{ num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: day, initials: "MU", passed: true }, { evidence: "BS-2 glucose 180", date: day, initials: "MU", passed: true }] }, { num: 3, evidence: "QC run", date: day, initials: "MU", passed: true }] }, token);
const signed = await call("POST", `${L}/competency/employee/${emp}/test-system/${inst}/sign`, { signerStaffEmployeeId: gs, signerInitials: "JE" }, token);
check("P1. the method signs", signed.status === 200, `HTTP ${signed.status}`);
const pdfRes = await fetch(`${BASE}${L}/competency/employee/${emp}/record-pdf`, { headers: { Authorization: `Bearer ${token}` } });
const pdfJson = (pdfRes.headers.get("content-type") || "").includes("json") ? await pdfRes.json() : null;
const pdfUrl = pdfJson?.url || pdfJson?.pdfUrl || (pdfJson?.token ? `/api/pdf/${pdfJson.token}` : null);
const pdfBuf = pdfUrl ? Buffer.from(await (await fetch(`${BASE}${pdfUrl}`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer()) : Buffer.from(await pdfRes.arrayBuffer());
fs.writeFileSync(path.join(OUT, "waived-record.pdf"), pdfBuf);
check("P1. the record PDF comes back", pdfBuf.subarray(0, 4).toString() === "%PDF", `HTTP ${pdfRes.status} ${pdfBuf.length} bytes`);

// W1: New Waived Assessment
const form = await open(`/veritacomp-app/${prog}?newAssessment=1`);
await form.getByTestId("waived-form-add-specimen").waitFor({ timeout: 15000 });
check("W1. the program form has Add specimen", await form.getByTestId("waived-form-add-specimen").isVisible());
await fillSpecimen(form, "waived-form", 0, "BS-1", true);
await form.getByTestId("waived-form-add-specimen").click();
await fillSpecimen(form, "waived-form", 1, "BS-2", false);
check("W1. clicking Add specimen leaves the method ticked", await form.getByTestId("waived-form-specimen-1-evidence").isVisible());
await form.waitForTimeout(200);
await form.screenshot({ path: path.join(OUT, "waived-specimens-form.png") });
await form.context().close();

// N1: non-technical
const ntPage = await open(`/veritacomp-app/${nt}?newAssessment=1`);
await ntPage.getByTestId("nt-assessment-type").waitFor({ timeout: 15000 });
await ntPage.getByTestId("nt-assessment-type").click();
const listbox = ntPage.getByRole("listbox");
await listbox.waitFor({ timeout: 5000 });
const opts = await listbox.innerText();
check("N1. it offers 6-Month and Annual", /6-Month/.test(opts) && /Annual/.test(opts) && /Orientation/.test(opts) && /2-Year Reassessment/.test(opts), opts.replace(/\s+/g, " "));
await ntPage.waitForTimeout(200);
await ntPage.screenshot({ path: path.join(OUT, "nontechnical-types.png") });
await ntPage.context().close();

// D1
const dark = await open(`/veritacomp-app/employee/${emp}`, { dark: true });
await dark.getByTestId(`${prefix}-add-specimen`).waitFor({ timeout: 15000 });
check("D1. dark mode is on", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await dark.getByTestId(`${prefix}-add-specimen`).scrollIntoViewIfNeeded();
await dark.screenshot({ path: path.join(OUT, "waived-specimens-dark.png") });
await dark.context().close();
const phone = await open(`/veritacomp-app/employee/${emp}`, { viewport: { width: 375, height: 800 } });
await phone.getByTestId(`${prefix}-add-specimen`).waitFor({ timeout: 15000 });
await phone.getByTestId(`${prefix}-add-specimen`).scrollIntoViewIfNeeded();
check("D1. phone width doesn't scroll sideways", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phone.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await phone.screenshot({ path: path.join(OUT, "waived-specimens-phone.png") });
await phone.context().close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
