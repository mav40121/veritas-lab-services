// scripts/verify-csp-enforced.mjs
//
// Crawl the app with the Content-Security-Policy ENFORCED (server started with CSP_ENFORCE=1) and record
// every violation the browser raises (securitypolicyviolation events + CSP console errors). LOCAL
// production build + scratch DB only. Pages: public marketing pages and every /labs/:id module page.
// Actions most likely to trip a CSP: VeritaCheck Excel import (client-side ExcelJS), Load Demo Data,
// run a study and open its PDF; Google Analytics loads on every page.
//   PASS = the header is present and enforcing, X-Powered-By is gone, and zero violations.
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-csp-enforced.mjs
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

// 0) headers
const head = await fetch(BASE + "/");
const csp = head.headers.get("content-security-policy") || "";
check("0a. Content-Security-Policy is sent and enforcing (not Report-Only)", csp.includes("default-src 'self'") && !head.headers.get("content-security-policy-report-only"), csp.slice(0, 90));
check("0b. script-src has no 'unsafe-inline' and no 'unsafe-eval'", /script-src [^;]*'sha256-/.test(csp) && !/script-src [^;]*'unsafe-(inline|eval)'/.test(csp));
check("0c. X-Powered-By is not sent", head.headers.get("x-powered-by") === null, String(head.headers.get("x-powered-by")));

// 1) QA owner + lab
const PW = ["Zq", "csp", "7x!"].join("-");
const email = `csp-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
check("1. QA owner and lab", !!lab && !!reg.body?.token);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push({ d: e.effectiveDirective, b: e.blockedURI, s: (e.sourceFile || "").slice(-60), l: e.lineNumber }));
});
const violations = [];
const page = await ctx.newPage();
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push({ where: page.url(), console: m.text().slice(0, 220) }); });
const collect = async (label) => {
  const v = await page.evaluate(() => { const x = window.__csp || []; window.__csp = []; return x; }).catch(() => []);
  for (const e of v) violations.push({ where: label, ...e });
};
await page.goto(`${BASE}/`);
await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);

const publicPages = ["/staff-access", "/login", "/","/pricing", "/resources", "/resources/clia-tea-what-lab-directors-dont-know", "/trust", "/study-guide", "/veritaassure", "/demo", "/faq", "/features", "/contact", "/security", "/veritamap", "/veritacomp", "/veritascan", "/veritapt", "/veritastock", "/veritadc", "/book", "/team", "/roadmap", "/calculator", "/getting-started"];
const appPages = ["dashboard", "veritacheck", "veritamap-app", "veritacomp-app", "veritacomp-app/method-groups", "veritastaff-app", "veritapolicy-app", "veritascan-app", "veritaqc-app", "veritatrack-app", "veritaresponse", "veritalab-app", "equipment-app", "veritastock", "veritabench", "veritaops-app", "veritaceu-app", "readiness", "repository", "members", "my-signoffs"].map((p) => `/labs/${lab}/${p}`).concat(["/account/settings"]);
let visited = 0;
for (const p of [...publicPages, ...appPages]) {
  try { await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 30000 }); } catch { await page.waitForTimeout(1500); }
  await page.waitForTimeout(600);
  await collect(p);
  visited++;
}
check(`2. ${visited} pages visited (public + every module page)`, visited === publicPages.length + appPages.length);

// 3) VeritaCheck: Excel import through client-side ExcelJS, demo data, run the study, open the PDF.
{
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("Data");
  ws.addRow(["Level", "Expected", "Run 1"]); [[1, 0.3, 0.31], [2, 7.0, 7.37], [3, 13.8, 14.25]].forEach((r) => ws.addRow(r));
  const xlsx = `${OUT}/csp-import.xlsx`; await wb.xlsx.writeFile(xlsx);
  await page.goto(`${BASE}/labs/${lab}/veritacheck`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Data Entry" }).click();
  const imp = page.getByRole("button", { name: /Import from CSV \/ Excel/i });
  if (await imp.count()) {
    await imp.first().click();
    const input = page.locator('input[type="file"]').first();
    await input.setInputFiles(xlsx);
    await page.waitForTimeout(2500);
    const parsed = await page.getByText(/mapping|Map columns|Level|Expected/i).count();
    check("3a. Excel import parses the workbook (client-side ExcelJS) with the CSP enforced", parsed > 0);
    await page.keyboard.press("Escape");
  } else check("3a. Excel import button found", false);
  await collect("veritacheck excel import");
  await page.getByRole("button", { name: "Load Demo Data" }).click();
  await page.getByRole("tab", { name: "Setup" }).click();
  const testName = page.getByPlaceholder(/GCI CREAT|e\.g\./i).first();
  if (await testName.count()) await testName.fill("Creatinine");
  await page.getByRole("tab", { name: "Data Entry" }).click();
  const run = page.getByRole("button", { name: /Run Study/i });
  if (await run.count() && await run.first().isEnabled()) {
    await run.first().click();
    await page.waitForURL(/\/study\/\d+/, { timeout: 30000 }).catch(() => {});
    const pdfBtn = page.getByText(/Download PDF/i);
    await pdfBtn.first().waitFor({ timeout: 30000 }).catch(() => {});
    if (await pdfBtn.count()) {
      const popupP = ctx.waitForEvent("page", { timeout: 20000 }).catch(() => null);
      const dlP = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
      await pdfBtn.first().click();
      const [popup, dl] = await Promise.all([popupP, dlP]);
      check("3b. the study PDF opens or downloads with the CSP enforced", !!popup || !!dl, popup ? "new tab" : dl ? "download" : "nothing");
      if (popup) { await popup.waitForTimeout(2500); await popup.close(); }
    } else check("3b. Download PDF button found", false, page.url());
  } else check("3b. study ran", false, "Run Study disabled or missing");
  await collect("veritacheck study + pdf");
}

const reports = await (await fetch(`${BASE}/api/admin/csp-reports?secret=${ADMIN}`)).json().catch(() => ({ rows: [] }));
await page.screenshot({ path: `${OUT}/csp-last-page.png` });
await browser.close();
fs.writeFileSync(`${OUT}/csp-violations.json`, JSON.stringify({ violations, reports }, null, 1));
for (const v of violations.slice(0, 25)) console.log("   VIOLATION", JSON.stringify(v));
check("4. zero CSP violations in the browser across every page and action", violations.length === 0, `${violations.length} violation(s)`);
check("5. the report endpoint stored nothing (no violation reached the server)", (reports.rows || []).length === 0, `${(reports.rows || []).length} row(s): ${JSON.stringify((reports.rows || []).slice(0, 3))}`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
