// scripts/verify-document-formats-ui.mjs
//
// Browser receipt: VeritaPolicy My Policies takes Excel and image files (2026-10-16, Q47 = 1). LOCAL
// production build + scratch DB only. Through the real Upload Policy dialog: an .xlsx and a .png; then
// View shows the workbook as a table and the image as an image; the dialog's file picker and label list
// the new types; light, dark, 390px.
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-document-formats-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const email = `docfmt-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "doc", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
check("0. QA owner and lab", !!lab);

const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Daily QC");
ws.addRow(["Date", "Analyte", "Level 1", "Level 2"]); ws.addRow(["2026-10-15", "Glucose", "92", "301"]); ws.addRow(["2026-10-16", "Glucose", "95", "298"]);
const xlsxPath = `${OUT}/Glucose QC log.xlsx`; await wb.xlsx.writeFile(xlsxPath);
const pngPath = `${OUT}/Specimen flowchart.png`;
const browser0 = await chromium.launch();
{ // a real 64x64 PNG drawn by the browser
  const pg = await browser0.newPage();
  const dataUrl = await pg.evaluate(() => { const c = document.createElement("canvas"); c.width = 64; c.height = 64; const x = c.getContext("2d"); x.fillStyle = "#01696F"; x.fillRect(0, 0, 64, 64); x.fillStyle = "#fff"; x.fillRect(16, 16, 32, 32); return c.toDataURL("image/png"); });
  fs.writeFileSync(pngPath, Buffer.from(dataUrl.split(",")[1], "base64"));
  await browser0.close();
}

const browser = await chromium.launch();
const open = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  return { ctx, page };
};

{
  const { ctx, page } = await open("light", 1280);
  for (const [file, label] of [[xlsxPath, "xlsx"], [pngPath, "png"]]) {
    await page.getByRole("button", { name: /Upload Policy/ }).first().click();
    const dlg = page.getByRole("dialog");
    const accept = await dlg.locator('input[type="file"]').getAttribute("accept");
    if (label === "xlsx") {
      const labelText = await dlg.getByText(/File \(Word, PDF, HTML, Excel/).innerText().catch(() => "");
      check("1a. the upload dialog lists the new types (label and file picker)", /Excel/.test(labelText) && /\.xlsx/.test(accept) && /\.png/.test(accept) && /\.txt/.test(accept), `${labelText} | ${accept}`);
      await dlg.screenshot({ path: `${OUT}/docfmt-upload-dialog-light.png` });
    }
    await dlg.locator('input[type="file"]').setInputFiles(file);
    await dlg.getByRole("button", { name: "Upload", exact: true }).click();
    await dlg.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  const rows = await page.locator("tr", { hasText: /Glucose QC log|Specimen flowchart/ }).count();
  check("1b. both files uploaded and listed", rows >= 2, `${rows} rows`);

  await page.locator("tr", { hasText: "Glucose QC log" }).first().getByRole("button", { name: /View/ }).click();
  const table = page.getByRole("dialog").locator("table");
  await table.waitFor({ timeout: 15000 });
  const t = await table.innerText();
  check("2a. View shows the Excel workbook as a table", t.includes("Glucose") && t.includes("301") && t.includes("Level 2"), t.replace(/\s+/g, " ").slice(0, 120));
  await page.getByRole("dialog").screenshot({ path: `${OUT}/docfmt-view-xlsx-light.png` });
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);

  await page.locator("tr", { hasText: "Specimen flowchart" }).first().getByRole("button", { name: /View/ }).click();
  const img = page.getByTestId("policy-view-image");
  await img.waitFor({ timeout: 15000 });
  const natural = await img.evaluate((el) => [el.naturalWidth, el.naturalHeight]);
  check("2b. View shows the PNG as an image (decoded, 64x64)", natural[0] === 64 && natural[1] === 64, JSON.stringify(natural));
  await page.getByRole("dialog").screenshot({ path: `${OUT}/docfmt-view-png-light.png` });
  await ctx.close();
}
for (const [scheme, width] of [["dark", 1280], ["light", 390]]) {
  const { ctx, page } = await open(scheme, width);
  await page.locator("tr", { hasText: "Glucose QC log" }).first().getByRole("button", { name: /View/ }).click();
  await page.getByRole("dialog").locator("table").waitFor({ timeout: 15000 });
  const noScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check(`3. [${scheme} ${width}px] the workbook view renders with no horizontal page scroll`, noScroll);
  await page.getByRole("dialog").screenshot({ path: `${OUT}/docfmt-view-xlsx-${scheme}-${width}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
