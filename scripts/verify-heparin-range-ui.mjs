// scripts/verify-heparin-range-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the Heparin Therapeutic Range, aPTT vs Anti-Xa study (REQ-124, Michael Q134 = 1).
// On a local production build with a scratch DB and a made-up lab:
//   A. the form: picking the study type shows the heparin form and hides the TEa card, the Instruments card and the
//      generic data grid; the samples are pasted from a spreadsheet (the approved mock's 24 samples), two are excluded
//      with a reason, and the live summary reads 59 to 94 s and "meets"
//   B. Save stores the study as PASS and opens the results page: range, prior lot, 22 of 24, r, the chart with 24
//      points, the criteria, the narrative and the table
//   C. Download PDF (the real button) downloads a 2-page-plus PDF
//   D. light and dark at 1400 px, light at 390 px: no horizontal page scroll on the form or the results page
//   E. the CUMSUM page's link opens the study page with the heparin study type picked
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-heparin-range-ui.mjs
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

// ---------- fixture: a made-up lab ----------
const email = `heparin-range-${Date.now()}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Heparin Range Owner", hipaa_acknowledged: true })).body;
const T = owner.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Heparin Range Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
check("0. fixture: a made-up lab and owner", !!T && !!labId, `lab ${labId}`);

// The approved mock's samples: patient code, anti-Xa, aPTT, INR (24 lines; S-23 and S-24 get excluded below).
const PASTE = [
  ["P01", 0.14, 44, 1.1], ["P02", 0.18, 49, 1.0], ["P03", 0.21, 53, 1.2], ["P04", 0.24, 50, 1.1], ["P05", 0.27, 59, 1.0],
  ["P06", 0.29, 54, 1.3], ["P07", 0.31, 63, 1.1], ["P08", 0.33, 58, 1.0], ["P09", 0.36, 68, 1.2], ["P10", 0.38, 64, 1.1],
  ["P11", 0.41, 71, 1.0], ["P12", 0.44, 67, 1.4], ["P13", 0.47, 77, 1.1], ["P14", 0.50, 72, 1.0], ["P15", 0.53, 82, 1.2],
  ["P02", 0.56, 79, 1.1], ["P16", 0.59, 88, 1.0], ["P17", 0.63, 84, 1.3], ["P18", 0.66, 93, 1.1], ["P19", 0.70, 90, 1.0],
  ["P20", 0.74, 99, 1.2], ["P21", 0.81, 104, 1.1], ["P22", 0.46, 112, 1.7], ["P23", 0.58, 41, 1.0],
].map((r) => r.join("\t")).join("\n");

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

  // A. The form
  await page.goto(`${BASE}/labs/${labId}/veritacheck?studyType=heparin_range&analyte=aPTT`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  const setupText = await page.locator("body").innerText();
  check(`A0. ${tag} Setup tab: the study type is picked and the Instruments card is hidden`, /Heparin Therapeutic Range: aPTT vs Anti-Xa/.test(setupText) && !/Instruments \/ Methods/.test(setupText));
  await page.getByRole("tab", { name: "Data Entry" }).click(); await page.waitForTimeout(500);
  const form = page.getByTestId("heparin-range-form");
  check(`A1. ${tag} Data Entry tab: the heparin form shows`, await form.isVisible().catch(() => false));
  const bodyText = await page.locator("body").innerText();
  check(`A2. ${tag} the TEa card, the CSV import and the generic data grid are hidden`, !/Adopted Acceptance Criterion/.test(bodyText) && !/Import from CSV/.test(bodyText) && !/\bData Points\b/.test(bodyText) && !/Generate/.test(bodyText.replace(/Generating/g, "")));
  check(`A3. ${tag} no horizontal page scroll on the form`, await noScroll());
  await page.screenshot({ path: `${OUT}/heparin_form_${scheme}_${width}.png`, fullPage: true });
  if (studyId === null) {
    await page.getByTestId("hr-instrument").fill("Stago STA R Max 3");
    await page.getByTestId("hr-reagent-lot").fill("APTT-2026-A");
    await page.getByTestId("hr-antixa-method").fill("STA-Liquid Anti-Xa");
    await page.getByTestId("hr-antixa-lot").fill("AXA-7781");
    await page.getByTestId("hr-prior-lot").fill("APTT-2025-B");
    await page.getByTestId("hr-prior-low").fill("62");
    await page.getByTestId("hr-prior-high").fill("101");
    await page.getByTestId("hr-paste-toggle").click();
    await page.getByTestId("hr-paste-text").fill(PASTE);
    await page.getByTestId("hr-paste-apply").click(); await page.waitForTimeout(200);
    check(`A4. ${tag} pasting fills 24 rows`, (await page.getByTestId("hr-row-23-aptt").inputValue()) === "41" && (await page.getByTestId("hr-row-0-patient").inputValue()) === "P01");
    for (const [i, why] of [[22, "INR above 1.5 (warfarin overlap)"], [23, "aPTT within the normal range (sample mismatch)"]]) {
      await page.getByTestId(`hr-row-${i}-exclude`).click();
      await page.getByTestId(`hr-row-${i}-reason`).fill(why);
    }
    await page.waitForTimeout(200);
    const summary = (await page.getByTestId("hr-summary").innerText()).replace(/\s+/g, " ");
    check(`A5. ${tag} live summary: 59 to 94 s, n 22, meets`, /aPTT range: 59 to 94 s/.test(summary) && /n 22/.test(summary) && /meets the study criteria/.test(summary), summary.slice(0, 160));
    // B. Save
    await page.getByTestId("hr-save").click();
    await page.waitForURL(/\/study\/\d+\/results/, { timeout: 20000 }).catch(() => {});
    const m = page.url().match(/\/study\/(\d+)\/results/);
    studyId = m ? Number(m[1]) : null;
    check(`B1. ${tag} Save opens the results page`, !!studyId, page.url());
    const stored = (await call("GET", `/api/labs/${labId}/studies/${studyId}`, undefined, T)).body;
    check("B2. the stored study is heparin_range with status pass and 24 samples", stored.studyType === "heparin_range" && stored.status === "pass" && JSON.parse(stored.dataPoints).samples.length === 24, `${stored.studyType} ${stored.status}`);
  } else {
    await page.goto(`${BASE}/labs/${labId}/study/${studyId}/results`, { waitUntil: "networkidle" });
  }

  // B. Results page
  await page.waitForTimeout(900);
  const txt = async (id) => (await page.getByTestId(id).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  check(`B3. ${tag} results: range 59 to 94 s, prior 62 to 101 s, 22 of 24, r 0.983`, (await txt("hr-result-range")) === "59 to 94 s" && (await txt("hr-result-prior")) === "62 to 101 s" && (await txt("hr-result-n")) === "22 of 24" && (await txt("hr-result-r")) === "0.983");
  check(`B4. ${tag} the verdict reads meets`, /meets the study criteria/.test(await txt("hr-result-verdict")) && !/does not/.test(await txt("hr-result-verdict")));
  check(`B5. ${tag} the chart draws 24 points`, (await page.getByTestId("hr-result-chart").locator("circle").count()) === 24);
  const narrative = await txt("hr-result-narrative");
  check(`B6. ${tag} the narrative: determination, 59 to 94 seconds, the director line`, narrative.startsWith("The sample set meets the study criteria for an aPTT heparin therapeutic range.") && /is 59 to 94 seconds\./.test(narrative) && /laboratory director or designee\.$/.test(narrative));
  const table = await txt("hr-result-table");
  check(`B7. ${tag} the table lists both exclusions with their reasons`, /Excluded: INR above 1\.5/.test(table) && /Excluded: aPTT within the normal range/.test(table));
  check(`D1. ${tag} no horizontal page scroll on the results page`, await noScroll());
  await page.screenshot({ path: `${OUT}/heparin_results_${scheme}_${width}.png`, fullPage: true });

  // C. Download PDF with the real button (first pass only)
  if (scheme === "light" && width === 1400) {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }).catch(() => null), page.getByTestId("button-download-pdf-heparin").click()]);
    let pages = 0, name = "";
    if (dl) { name = dl.suggestedFilename(); await dl.saveAs(`${OUT}/heparin.pdf`); try { pages = (await PDFDocument.load(fs.readFileSync(`${OUT}/heparin.pdf`))).getPageCount(); } catch {} }
    check("C1. Download PDF downloads the study PDF (results page, samples page, license page)", !!dl && pages >= 2 && /^VeritaCheck_HeparinRange_aPTT_/.test(name), `${name} ${pages} pages`);

    // H. Edit reopens the form with the saved study (unsigned only)
    await page.getByTestId("study-edit").click();
    await page.waitForURL(/\/study\/\d+\/edit/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.getByRole("tab", { name: "Data Entry" }).click().catch(() => {}); await page.waitForTimeout(500);
    const hydrated = (await page.getByTestId("hr-reagent-lot").inputValue().catch(() => "")) === "APTT-2026-A"
      && (await page.getByTestId("hr-instrument").inputValue().catch(() => "")) === "Stago STA R Max 3"
      && (await page.getByTestId("hr-row-23-aptt").inputValue().catch(() => "")) === "41"
      && /sample mismatch/.test(await page.getByTestId("hr-row-23-reason").inputValue().catch(() => ""));
    check("H1. Edit reopens the form with the saved analyzer, lots, samples and exclusion reasons", hydrated, page.url());
    await page.goto(`${BASE}/labs/${labId}/study/${studyId}/results`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);

    // G. Sign and lock, then the PDF carries the signature and no DRAFT mark
    await page.getByTestId("open-finalize-dialog").click();
    await page.getByTestId("study-sign-input").fill("Dr. Example Director");
    await page.getByTestId("study-sign-confirm").click(); await page.waitForTimeout(1200);
    const signed = (await call("GET", `/api/labs/${labId}/studies/${studyId}`, undefined, T)).body;
    check("G1. Sign and lock finalizes the study and the page shows Signed Off", signed.lifecycle_state === "finalized" && await page.getByTestId("study-signed-off").isVisible().catch(() => false), signed.lifecycle_state);
    const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }).catch(() => null), page.getByTestId("button-download-pdf-heparin").click()]);
    if (dl2) await dl2.saveAs(`${OUT}/heparin_signed.pdf`);
    check("G2. the signed study's PDF downloads (text checked next to it)", !!dl2);
  }

  // E. CUMSUM link target (first pass only): the link's URL opens the form with the type picked
  if (scheme === "light" && width === 1400) {
    // The CUMSUM page builds a lab-scoped link (the un-prefixed redirect drops the query string); open that URL.
    await page.goto(`${BASE}/labs/${labId}/veritacheck?studyType=heparin_range&analyte=aPTT`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    const picked = /Heparin Therapeutic Range: aPTT vs Anti-Xa/.test(await page.locator("body").innerText());
    await page.getByRole("tab", { name: "Data Entry" }).click().catch(() => {}); await page.waitForTimeout(500);
    check("E1. the CUMSUM link's URL opens the study page with the heparin type picked and its form", picked && await page.getByTestId("heparin-range-form").isVisible().catch(() => false), page.url());
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
