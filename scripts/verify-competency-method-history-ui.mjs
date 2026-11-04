// scripts/verify-competency-method-history-ui.mjs
//
// Browser receipt for the rebuilt VeritaComp bulk import (Michael 2026-11-04, Q164 = 1). On a local production build with a scratch DB, a made-up owner, analyzers and people:
//   B1. Bulk Import opens on the tests and instruments tab, says who the template lists and who has no methods, and the template downloads filled in.
//   B2. Uploading a filled-in copy previews what each date will set, a bad row blocks loading, and the older program tab is still there.
//   B3. Loading sets the person's due date: the person page shows it as imported history, and a loaded date can be removed.
//   D1. Dark mode and phone width read and do not overflow.
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-method-history-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const now = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const mdy = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const email = `histui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "History UI", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "History UI Lab", plan: "hospital" })).body.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "History UI Lab", cliaNumber: "11D7654381", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
const uid = sql("SELECT id FROM users WHERE email = ?", email).id;
sql("UPDATE users SET has_completed_onboarding = 1, plan = 'hospital' WHERE id = ?", uid);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const map = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, token)).body;
const addInst = async (name, serial, complexity) => {
  await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: name, role: "Primary", category: "Chemistry", serial_number: serial }, token);
  const id = sql("SELECT id FROM veritamap_instruments WHERE map_id = ? AND serial_number = ?", map.id, serial).id;
  await call("PUT", `${L}/veritamap/maps/${map.id}/instruments/${id}/tests`, { tests: [{ analyte: `Made-up ${serial}`, specialty: "General Chemistry", complexity, active: 1 }] }, token);
  return id;
};
const chem = await addInst("Made-up chemistry analyzer", "CHEM1", "MODERATE");
const heme = await addInst("Made-up hematology analyzer", "HEME1", "HIGH");
const mkEmp = async (firstName, lastName, hireDate) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, hireDate, highestComplexity: "M", performsTesting: true }, token)).body.id;
const ann = await mkEmp("Ann", "Longtime", "2015-03-02");
const bea = await mkEmp("Bea", "Newhire", daysAgo(100));
await mkEmp("Dee", "Nomethods", "2017-01-04");
await call("PUT", `${L}/staff/employees/${ann}/instruments`, { instrumentIds: [chem, heme] }, token);
await call("PUT", `${L}/staff/employees/${bea}/instruments`, { instrumentIds: [chem] }, token);

const browser = await chromium.launch();
const open = async (p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 900 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
    if (dark) localStorage.setItem("theme", "dark");
  }, [token, owner.body.user, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}${p}`, { waitUntil: "networkidle" });
  return page;
};
const openImport = async (page) => {
  await page.getByRole("button", { name: "Bulk Import" }).first().click();
  await page.getByTestId("method-history-import").waitFor({ timeout: 10000 });
  await page.getByTestId("method-history-counts").waitFor({ timeout: 10000 });
};

// B1
const page = await open("/veritacomp-app");
await openImport(page);
check("B1. it says who the template lists", /2 people and 3 methods/.test(await page.getByTestId("method-history-counts").innerText()), await page.getByTestId("method-history-counts").innerText());
check("B1. and who has no methods", /1 testing person has no instruments assigned/.test(await page.getByTestId("method-history-no-methods").innerText()));
check("B1. the older tab is still there", await page.getByTestId("bulk-import-tab-programs").isVisible());
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "bulk-import-window.png") });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("method-history-template").click()]);
const blank = path.join(OUT, "template.xlsx");
await dl.saveAs(blank);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(blank);
const ws = wb.getWorksheet("Past Competencies");
check("B1. the template comes filled in", ws.rowCount === 4 && wb.worksheets[0].name === "About", `rows ${ws.rowCount}`);
const rowFor = (sheet, emp, inst) => { for (let n = 2; n <= sheet.rowCount; n += 1) if (Number(sheet.getRow(n).getCell(10).value) === emp && Number(sheet.getRow(n).getCell(11).value) === inst) return sheet.getRow(n); return null; };
check("B1. Annual is filled in, and blank for a recent hire", rowFor(ws, ann, chem).getCell(8).value === "Annual" && !rowFor(ws, bea, chem).getCell(8).value);

// B2
const annDate = daysAgo(200);
const nextYear = `${Number(annDate.slice(0, 4)) + 1}${annDate.slice(4)}`;
rowFor(ws, ann, chem).getCell(7).value = new Date(`${annDate}T00:00:00Z`);
rowFor(ws, ann, chem).getCell(9).value = "Made Up Evaluator";
rowFor(ws, bea, chem).getCell(7).value = new Date(`${daysAgo(50)}T00:00:00Z`);
rowFor(ws, bea, chem).getCell(9).value = "Made Up Evaluator";
const badFile = path.join(OUT, "filled-bad.xlsx");
await wb.xlsx.writeFile(badFile);
await page.getByTestId("method-history-file").setInputFiles(badFile);
await page.getByTestId("method-history-preview").click();
await page.getByTestId("method-history-review").waitFor({ timeout: 15000 });
check("B2. a row missing its type is named", /Pick Initial, 6-month or Annual/.test(await page.getByTestId("method-history-review").innerText()));
check("B2. and blocks loading", await page.getByTestId("method-history-commit").isDisabled());
rowFor(ws, bea, chem).getCell(8).value = "Initial";
const goodFile = path.join(OUT, "filled.xlsx");
await wb.xlsx.writeFile(goodFile);
await page.getByTestId("method-history-file").setInputFiles(goodFile);
await page.getByTestId("method-history-preview").click();
await page.getByTestId("method-history-commit").waitFor({ timeout: 15000 });
await page.waitForFunction(() => { const b = document.querySelector('[data-testid="method-history-commit"]'); return b && !b.disabled; }, null, { timeout: 15000 });
const reviewText = await page.getByTestId("method-history-review").innerText();
check("B2. the preview shows what each date will set", new RegExp(`Annual due ${mdy(nextYear)}`).test(reviewText) && /6-month due/.test(reviewText), reviewText.slice(0, 300).replace(/\s+/g, " "));
check("B2. it offers the right count", /Load 2 dates/.test(await page.getByTestId("method-history-commit").innerText()));
check("B2. nothing is saved yet", sql("SELECT COUNT(*) n FROM competency_method_history WHERE lab_id = ?", labId).n === 0);
await page.screenshot({ path: path.join(OUT, "bulk-import-preview.png") });

// B3
await page.getByTestId("method-history-commit").click();
await page.getByTestId("method-history-import").waitFor({ state: "hidden", timeout: 15000 });
check("B3. loading saves the dates", sql("SELECT COUNT(*) n FROM competency_method_history WHERE lab_id = ?", labId).n === 2);
await page.context().close();
const person = await open(`/veritacomp-app/employee/${ann}`);
const imported = person.getByTestId("method-imported").first();
await imported.waitFor({ timeout: 15000 }).catch(() => {});
check("B3. the person page shows it as imported history", await imported.isVisible() && /Imported history from the laboratory's past records/.test(await imported.innerText()));
await person.screenshot({ path: path.join(OUT, "bulk-import-person.png") });
await person.getByTestId("method-history-remove").first().click();
await person.getByRole("button", { name: "Remove", exact: true }).click();
await person.getByText("Date removed").first().waitFor({ timeout: 10000 }).catch(() => {});
check("B3. a loaded date can be removed", sql("SELECT COUNT(*) n FROM competency_method_history WHERE lab_id = ? AND removed_at IS NOT NULL", labId).n === 1);
await person.context().close();

// D1
const dark = await open("/veritacomp-app", { dark: true });
await openImport(dark);
check("D1. dark mode is on", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await dark.getByTestId("method-history-file").setInputFiles(goodFile);
await dark.getByTestId("method-history-preview").click();
await dark.getByTestId("method-history-review").waitFor({ timeout: 15000 });
await dark.waitForTimeout(300);
await dark.screenshot({ path: path.join(OUT, "bulk-import-dark.png") });
await dark.context().close();
const phone = await open("/veritacomp-app", { viewport: { width: 375, height: 800 } });
await openImport(phone);
await phone.getByTestId("method-history-file").setInputFiles(goodFile);
await phone.getByTestId("method-history-preview").click();
await phone.getByTestId("method-history-review").waitFor({ timeout: 15000 });
await phone.waitForTimeout(300);
check("D1. phone width doesn't scroll sideways", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phone.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
const fits = await phone.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const t = document.querySelector('[data-testid="method-history-preview"]').getBoundingClientRect(); return { inner: d.scrollWidth <= d.clientWidth + 1, right: t.right <= window.innerWidth, widths: `${d.scrollWidth} vs ${d.clientWidth}` }; });
check("D1. the import window fits a phone screen, with its buttons on screen", fits.inner && fits.right, JSON.stringify(fits));
await phone.screenshot({ path: path.join(OUT, "bulk-import-phone.png") });
await phone.context().close();

await browser.close();
for (const f of [blank, badFile, goodFile]) fs.rmSync(f, { force: true });
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
