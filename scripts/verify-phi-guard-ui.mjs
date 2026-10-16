// scripts/verify-phi-guard-ui.mjs
//
// Browser receipt: PHI guard (Q56 item 4, 2026-10-16). LOCAL production build with the Content-Security-Policy
// enforced + scratch DB only. Through the real VeritaPolicy Upload Policy dialog:
//   1. typing an SSN into the description and leaving the field shows "This looks like patient information"
//   2. ordinary text in the title shows no warning
//   3. uploading a text file that contains an SSN saves it and shows "Possible patient information in this file"
//   4. no CSP violations; light, dark, 390px screenshots of the warning
//   5. VeritaLab: uploading a Word certificate document with a labeled date of birth saves it and shows the file warning
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-phi-guard-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const docx = require("docx");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const email = `phi-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "phi", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (PHI QA)", plan: "hospital" })).body?.labId;
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
check("0. QA owner and lab", !!lab);
const ssnFile = `${OUT}/rejection log.txt`;
fs.writeFileSync(ssnFile, "Specimen rejection log\nPatient SSN 123-45-6789 hemolyzed, recollect\n");

const browser = await chromium.launch();
const open = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Upload Policy/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 15000 });
  return { ctx, page, dlg, csp };
};
const warning = (page) => page.getByText("This looks like patient information").first();

{
  const { ctx, page, dlg, csp } = await open("light", 1280);
  const fields = dlg.locator("input[type=text], input:not([type]), textarea");
  const n = await fields.count();
  // title: ordinary text, no warning
  await fields.nth(0).fill("Specimen Rejection");
  await fields.nth(0).press("Tab");
  await page.waitForTimeout(600);
  check("2. ordinary text shows no warning", (await page.getByText("This looks like patient information").count()) === 0, `${n} text fields in the dialog`);
  // description (last text field): an SSN
  await fields.nth(n - 1).fill("Recollect for SSN 123-45-6789 per lab director");
  await fields.nth(n - 1).press("Tab");
  await warning(page).waitFor({ timeout: 5000 }).catch(() => {});
  check("1. typing an SSN and leaving the field shows the warning", await warning(page).isVisible(), (await page.locator("[role=status], li").filter({ hasText: "patient information" }).first().innerText().catch(() => "")).slice(0, 160));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phi-guard-typing-light.png` });
  // upload a file with an SSN
  await fields.nth(n - 1).fill("Rejection log");
  await dlg.locator('input[type="file"]').setInputFiles(ssnFile);
  await dlg.getByRole("button", { name: "Upload", exact: true }).click();
  const fileWarn = page.getByText("Possible patient information in this file").first();
  await fileWarn.waitFor({ timeout: 15000 }).catch(() => {});
  // One notice shows at a time, so the warning replaces "Uploaded"; prove the save by the new row instead.
  const saved = page.getByText("Specimen Rejection").first();
  await saved.waitFor({ timeout: 15000 }).catch(() => {});
  check("3. uploading a file with an SSN saves it and shows the file warning", await fileWarn.isVisible() && await saved.isVisible(), "");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phi-guard-upload-light.png` });
  check("4a. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
  await ctx.close();
}
for (const [scheme, width, tag] of [["dark", 1280, "dark"], ["light", 390, "390"]]) {
  const { ctx, page, dlg } = await open(scheme, width);
  const fields = dlg.locator("input[type=text], input:not([type]), textarea");
  const n = await fields.count();
  await fields.nth(n - 1).fill("MRN: 00482913 repeat draw");
  await fields.nth(n - 1).press("Tab");
  await warning(page).waitFor({ timeout: 5000 }).catch(() => {});
  const box = await warning(page).boundingBox().catch(() => null);
  check(`4${tag === "dark" ? "b" : "c"}. ${tag}: the warning shows${tag === "390" ? " inside the screen" : ""}`, await warning(page).isVisible() && (!box || tag !== "390" || (box.x >= 0 && box.x + box.width <= 391)), box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phi-guard-typing-${tag}.png` });
  await ctx.close();
}
{
  // 5) VeritaLab certificate documents use the same file check (server/phiUploadCheck.ts checkUploadedFileForPhi).
  const hdr = { Authorization: `Bearer ${reg.body.token}`, "X-Active-Lab-Id": String(lab), "Content-Type": "application/json" };
  const cert = await (await fetch(`${BASE}/api/veritalab/certificates`, { method: "POST", headers: hdr, body: JSON.stringify({ cert_name: "CLIA Certificate of Compliance", cert_type: "clia" }) })).json().catch(() => ({}));
  const certDoc = `${OUT}/courier call log.docx`;
  const d = new docx.Document({ sections: [{ children: [new docx.Paragraph("Courier call log"), new docx.Paragraph("DOB: 03/14/1961 specimen picked up 14:20")] }] });
  fs.writeFileSync(certDoc, await docx.Packer.toBuffer(d));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritalab-app`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Documents$/ }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await page.locator('input[type="file"]').first().setInputFiles(certDoc);
  const certWarn = page.getByText("Possible patient information in this file").first();
  await certWarn.waitFor({ timeout: 15000 }).catch(() => {});
  const listed = page.getByRole("dialog").getByText("courier call log.docx").first();
  await listed.waitFor({ timeout: 15000 }).catch(() => {});
  check("5. VeritaLab: a certificate document with a labeled date of birth saves and shows the file warning", !!cert.id && await certWarn.isVisible() && await listed.isVisible(), `cert ${cert.id}`);
  check("5b. no Content-Security-Policy violations on VeritaLab", csp.length === 0, csp.slice(0, 2).join(" | "));
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/phi-guard-certificate-light.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
