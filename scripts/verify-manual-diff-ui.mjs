// scripts/verify-manual-diff-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the Manual Differential (Rümke, CLSI H20) save and results view (found
// 2026-11-03 building the heparin range study): the form sent no created_at, so every save was refused with a 400, and
// a saved study opened "This study can't be displayed". On a local production build with a scratch DB and a made-up lab:
//   A. the form saves; the study is stored PASS with created_at
//   B. the results page shows the verdict, counts and per-class table; no horizontal page scroll (light, dark, 390 px)
//   C. Download PDF downloads VeritaCheck_ManualDiff_*.pdf
//   D. Edit reopens the form with the saved counts; Sign and lock finalizes and the signed PDF downloads
//   E. a failing set (Eosinophils 0 of 100 against 9%) is stored FAIL and the page names the class
//   F. the dashboard labels it Manual Differential (it read "Method Comparison")
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-manual-diff-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const { PDFDocument } = require("pdf-lib");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };

const email = `manual-diff-${Date.now()}@example.com`;
const T = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Manual Diff Owner", hipaa_acknowledged: true })).body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Manual Diff Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
check("0. fixture: a made-up lab and owner", !!T && !!labId, `lab ${labId}`);

const browser = await chromium.launch();
let studyId = null;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
  const tag = `[${scheme} ${width}px]`;
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const txt = async (id) => (await page.getByTestId(id).innerText().catch(() => "")).replace(/\s+/g, " ").trim();

  if (studyId === null) {
    // A. Save through the form
    await page.goto(`${BASE}/labs/${labId}/veritacheck?studyType=manual_diff&analyte=Manual%20Differential`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.getByRole("tab", { name: "Data Entry" }).click(); await page.waitForTimeout(500);
    await page.getByTestId("md-reference-source").fill("Sysmex XN-1000 automated differential");
    for (const [i, count, ref] of [[0, 60, 58], [1, 30, 31], [2, 6, 7], [3, 3, 3], [4, 1, 1]]) {
      await page.getByTestId(`md-row-${i}-count`).fill(String(count));
      await page.getByTestId(`md-row-${i}-ref`).fill(String(ref));
    }
    await page.getByTestId("md-save").click();
    await page.waitForURL(/\/study\/\d+\/results/, { timeout: 20000 }).catch(() => {});
    const m = page.url().match(/\/study\/(\d+)\/results/);
    studyId = m ? Number(m[1]) : null;
    const stored = studyId ? (await call("GET", `/api/labs/${labId}/studies/${studyId}`, undefined, T)).body : {};
    check("A1. the form saves and opens the results page", !!studyId, page.url());
    check("A2. stored as manual_diff, PASS, with created_at", stored.studyType === "manual_diff" && stored.status === "pass" && !!(stored.createdAt || stored.created_at), `${stored.status} ${stored.createdAt || stored.created_at}`);
  } else {
    await page.goto(`${BASE}/labs/${labId}/study/${studyId}/results`, { waitUntil: "networkidle" });
  }
  await page.waitForTimeout(900);

  // B. Results view
  check(`B1. ${tag} the results view shows (not "This study can't be displayed")`, (await page.getByTestId("study-unreadable").count()) === 0 && /Every cell class is within/.test(await txt("md-result-verdict")));
  check(`B2. ${tag} 100 cells, 5 classes, counts total 100 of 100`, (await txt("md-result-cells")) === "100" && (await txt("md-result-classes")) === "5" && (await txt("md-result-sum")) === "100 of 100");
  const table = await txt("md-result-table");
  check(`B3. ${tag} per-class table: Neutrophils 60 / 100, 60.0%, reference 58.0%, Within`, /Neutrophils 60 \/ 100 60\.0% 58\.0% [\d.]+ to [\d.]+% Within/.test(table), table.slice(0, 120));
  check(`B4. ${tag} no horizontal page scroll`, await noScroll());
  await page.screenshot({ path: `${OUT}/manual_diff_results_${scheme}_${width}.png`, fullPage: true });

  if (scheme === "light" && width === 1400) {
    // C. PDF
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }).catch(() => null), page.getByTestId("button-download-pdf-manual-diff").click()]);
    let pages = 0, name = "";
    if (dl) { name = dl.suggestedFilename(); await dl.saveAs(`${OUT}/manual_diff.pdf`); try { pages = (await PDFDocument.load(fs.readFileSync(`${OUT}/manual_diff.pdf`))).getPageCount(); } catch {} }
    check("C1. Download PDF downloads VeritaCheck_ManualDiff_*.pdf", !!dl && pages >= 2 && /^VeritaCheck_ManualDiff_/.test(name), `${name} ${pages} pages`);

    // D. Edit reload, then Sign and lock
    await page.getByTestId("study-edit").click();
    await page.waitForURL(/\/study\/\d+\/edit/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByRole("tab", { name: "Data Entry" }).click().catch(() => {}); await page.waitForTimeout(500);
    const back = (await page.getByTestId("md-reference-source").inputValue().catch(() => "")) === "Sysmex XN-1000 automated differential"
      && (await page.getByTestId("md-row-0-count").inputValue().catch(() => "")) === "60" && (await page.getByTestId("md-row-1-ref").inputValue().catch(() => "")) === "31";
    check("D1. Edit reopens the form with the saved reference and counts", back, page.url());
    await page.goto(`${BASE}/labs/${labId}/study/${studyId}/results`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.getByTestId("open-finalize-dialog").click();
    await page.getByTestId("study-sign-input").fill("Dr. Example Director");
    await page.getByTestId("study-sign-confirm").click(); await page.waitForTimeout(1200);
    const signed = (await call("GET", `/api/labs/${labId}/studies/${studyId}`, undefined, T)).body;
    check("D2. Sign and lock finalizes and the page shows Signed Off", signed.lifecycle_state === "finalized" && await page.getByTestId("study-signed-off").isVisible().catch(() => false));
    const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }).catch(() => null), page.getByTestId("button-download-pdf-manual-diff").click()]);
    if (dl2) await dl2.saveAs(`${OUT}/manual_diff_signed.pdf`);
    check("D3. the signed study's PDF downloads (text checked next to it)", !!dl2);

    // E. A failing set, saved the way the form saves it
    const fail = await call("POST", `/api/labs/${labId}/studies`, {
      testName: "Manual Differential", instrument: "Sysmex XN-1000 automated differential", analyst: "-", date: "2026-11-03", studyType: "manual_diff",
      cliaAllowableError: 0, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Rümke 95% CI (CLSI H20)",
      dataPoints: JSON.stringify({ cellsCounted: 100, referenceSource: "Sysmex XN-1000 automated differential", classes: [{ name: "Neutrophils", manualCount: 67, referencePct: 58 }, { name: "Lymphocytes", manualCount: 30, referencePct: 30 }, { name: "Eosinophils", manualCount: 0, referencePct: 9 }, { name: "Monocytes", manualCount: 3, referencePct: 3 }] }),
      instruments: JSON.stringify(["Sysmex XN-1000 automated differential"]), status: "final", createdAt: new Date().toISOString(),
    }, T);
    const failStored = (await call("GET", `/api/labs/${labId}/studies/${fail.body.id}`, undefined, T)).body;
    await page.goto(`${BASE}/labs/${labId}/study/${fail.body.id}/results`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    check("E1. a failing set is stored FAIL and the page names the class outside the limits", failStored.status === "fail" && /Outside the Rümke 95% confidence limits: .*Eosinophils/.test(await txt("md-result-verdict")), `${failStored.status} ${await txt("md-result-verdict")}`);

    // F. Dashboard label
    await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
    const dash = await page.locator("body").innerText();
    check("F1. the dashboard labels the studies Manual Differential, not Method Comparison", /Manual Differential \(Rümke 95% CI, CLSI H20\)/.test(dash) && !/Method Comparison: Multi-Instrument Correlation/.test(dash));
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
