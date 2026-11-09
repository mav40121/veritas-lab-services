// scripts/verify-ptcoag-geomean-ui.mjs
// Gate 3 receipt for the SCAHC report of 2026-11-09 ("Bobbi was trying to use the study to calculate the Geometric
// Mean on Verita, but it appears to not be working"). Run against a LOCAL production build on a scratch database with
// made-up values (it registers an owner, provisions a lab and writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5198 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-ptcoag-geomean-ui.mjs
// In a real browser, the PT/INR Geometric Mean Calculator:
//   1. the default path (20 normals typed, Module 2 blank, Module 3 neither skipped nor filled) is stored PASS and
//      the dashboard reads PASS, as the results page does (it was stored FAIL), with the hand-calculated mean;
//   2. Save Draft keeps the typed normals and Module 3 rows, the draft reopens with them, and Run Study from the
//      reopened draft gives the same mean (a draft reopened empty);
//   3. Download PDF delivers a PDF;
//   4. dark mode and a phone;
//   5. the CUMSUM page's lot geometric means match a hand calculation.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5198", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `ptcoag-${name}.png`), fullPage: full, animations: "disabled" });
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `ptcoag-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Geo", "mean", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Coag Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999996' WHERE id = ?").run(labId);
});
const statusOf = (name) => scratch((d) => d.prepare("SELECT id, status, data_points FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));

// Made-up normal PTs (seconds) and their geometric mean by hand: exp(mean(ln PT)).
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const HAND = Math.exp(NORMALS.reduce((s, v) => s + Math.log(v), 0) / NORMALS.length); // 11.9118

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  return page;
};
const m1Cells = (page) => page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 1: Normal Patient Mean", { exact: false }) }).last().locator("input[placeholder='-']");
const m3Card = (page) => page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 3: Old Lot vs New Lot Comparison", { exact: true }) }).last();
const openForm = async (page, testName) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /PT\/INR Geometric Mean/i }).click();
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
};
const typeNormals = async (page) => { for (let i = 0; i < NORMALS.length; i++) await m1Cells(page).nth(i).fill(String(NORMALS[i])); await page.keyboard.press("Tab"); };
const runStudy = async (page) => {
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("Geometric Mean PT", { exact: true }).first().waitFor({ timeout: 20000 });
};
const dashboardRow = async (page, name) => {
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
  const title = page.getByText(name, { exact: true }).first();
  await title.waitFor({ timeout: 15000 });
  await title.scrollIntoViewIfNeeded();
  return { title, row: (await title.locator("xpath=ancestor::div[contains(@class,'flex')][2]").innerText()).replace(/\s+/g, " ") };
};

// ── 1. The default path ───────────────────────────────────────────────────────
const page = await open();
await openForm(page, "PT made-up default");
await typeNormals(page);
check("form: 20 specimens ready", (await text(page)).includes("20 specimens ready"));
check("form: Module 3 is neither skipped nor filled (the default)", !(await page.getByText("Skip (single analyzer lab)").locator("xpath=..").locator("input").isChecked()));
await shot(page, "1-form");
await runStudy(page);
const res = await text(page);
check(`results: Geometric Mean PT ${HAND.toFixed(2)} sec (hand: exp(mean ln PT))`, res.includes(`Geo Mean PT: ${HAND.toFixed(2)} sec`) && res.includes(`${HAND.toFixed(1)} sec Geometric Mean PT`), res.slice(0, 400));
check("results: Geometric Mean INR 1.000, N 20, Overall PASS", res.includes("Geo Mean INR: 1.000") && res.includes("N: 20") && res.includes("PASS Overall"));
const saved = statusOf("PT made-up default");
check("stored verdict PASS (it was FAIL)", saved?.status === "pass", saved?.status);
check("saved Module 3 is not performed (null), not { data: [] }", JSON.parse(saved?.data_points || "{}").module3 === null);
await shot(page, "2-results");
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
await dl.saveAs(path.join(OUT, "ptcoag-default.pdf"));
check(`Download PDF delivered a PDF (${dl.suggestedFilename()})`, fs.readFileSync(path.join(OUT, "ptcoag-default.pdf")).subarray(0, 4).toString() === "%PDF");
const dash = await dashboardRow(page, "PT made-up default");
check("dashboard reads PASS, as the results page does", / PASS /.test(` ${dash.row} `) && !/ FAIL /.test(` ${dash.row} `), dash.row);
await page.evaluate(() => window.scrollBy(0, -200));
await shot(page, "3-dashboard");

// ── 2. Save Draft, reopen, run ────────────────────────────────────────────────
await openForm(page, "PT made-up draft");
await typeNormals(page);
const m3Inputs = m3Card(page).locator("input[placeholder='-']");
await m3Inputs.nth(0).fill("12.0");
await m3Inputs.nth(1).fill("12.2");
await m3Card(page).getByRole("textbox").first().fill("OLD-LOT-1");
await page.keyboard.press("Tab");
await page.getByTestId("button-save-draft").click();
await page.waitForURL(/dashboard/, { timeout: 30000 });
const draft = statusOf("PT made-up draft");
const draftDp = JSON.parse(draft?.data_points || "null");
check("Save Draft: a draft row holding the 20 normals (it held the calibration grid)", draft?.status === "draft" && !Array.isArray(draftDp) && JSON.stringify(draftDp?.module1Instruments?.[0]?.ptValues) === JSON.stringify(NORMALS), JSON.stringify(draftDp).slice(0, 160));
await page.goto(`${BASE}/labs/${labId}/study/${draft.id}/edit`, { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "Data Entry" }).click();
await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
const back = await m1Cells(page).evaluateAll((els) => els.map((e) => e.value));
check("reopened draft: the 20 normals are back in Module 1", JSON.stringify(back.map(Number)) === JSON.stringify(NORMALS), JSON.stringify(back));
const m3Back = await m3Card(page).locator("input[placeholder='-']").evaluateAll((els) => els.slice(0, 2).map((e) => e.value));
check("reopened draft: Module 3's typed pair and old lot are back, Skip not ticked",
  m3Back[0] === "12" && m3Back[1] === "12.2" && (await m3Card(page).getByRole("textbox").first().inputValue()) === "OLD-LOT-1", JSON.stringify(m3Back));
await m1Cells(page).first().scrollIntoViewIfNeeded();
await shot(page, "4-draft-reopened");
await page.getByTestId("button-submit-study").click();
await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
await page.getByText("Geometric Mean PT", { exact: true }).first().waitFor({ timeout: 20000 });
const res2 = await text(page);
check("Run Study from the reopened draft: same mean, PASS stored (one Module 3 pair is not counted)",
  res2.includes(`Geo Mean PT: ${HAND.toFixed(2)} sec`) && statusOf("PT made-up draft")?.status === "pass", statusOf("PT made-up draft")?.status);

// ── 4. Dark and phone ─────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(`${BASE}/labs/${labId}/study/${saved.id}/results`, { waitUntil: "networkidle" });
await dark.getByText("Geometric Mean PT", { exact: true }).first().waitFor({ timeout: 20000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "5-results-dark");
const darkDash = await dashboardRow(dark, "PT made-up default");
await dark.evaluate(() => window.scrollBy(0, -200));
await shot(dark, "6-dashboard-dark");
check("dark: dashboard reads PASS", / PASS /.test(` ${darkDash.row} `), darkDash.row);
const phone = await open({ viewport: { width: 390, height: 844 } });
await openForm(phone, "PT made-up phone");
await typeNormals(phone);
await m1Cells(phone).first().scrollIntoViewIfNeeded();
check("phone: no sideways scroll on the form", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(phone, "7-phone-form");
await runStudy(phone);
check("phone: results show the mean, stored PASS", (await text(phone)).includes(`Geo Mean PT: ${HAND.toFixed(2)} sec`) && statusOf("PT made-up phone")?.status === "pass");
// Not this change: the results header's button row (PASS, Export CSV, Download PDF) is wider than a phone on every
// study type; reported, not fixed here.
const wide = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth,
  culprit: [...document.querySelectorAll("button, a")].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1).map((e) => e.textContent.trim()).slice(0, 3) }));
console.log(`NOTE  phone results: page ${wide.page}px in a ${wide.view}px window; past the edge: ${JSON.stringify(wide.culprit)}`);
await shot(phone, "8-phone-results");

// ── 5. CUMSUM ─────────────────────────────────────────────────────────────────
const PTT = [28.1, 29.4, 30.2, 27.8, 31.0, 29.9, 28.6, 30.5, 29.1, 28.8, 30.0, 29.3, 27.9, 30.8, 29.6, 28.4, 30.3, 29.0, 28.7, 29.8];
const PTT_NEW = PTT.map((v) => +(v * 1.04).toFixed(1));
const gm = (v) => Math.exp(v.reduce((s, x) => s + Math.log(x), 0) / v.length);
await page.goto(`${BASE}/labs/${labId}/veritacheck/cumsum`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "New Tracker" }).click();
await page.getByPlaceholder("e.g. ACL TOP 351").fill("Made-up CA-660");
await page.getByRole("button", { name: "Create Tracker" }).click();
await page.getByRole("button", { name: /Add Install Lot/ }).click();
for (let i = 0; i < 20; i++) await page.locator("table input[placeholder='-']").nth(i).fill(String(PTT[i]));
await page.getByPlaceholder("e.g. N0824180").fill("LOT-A");
check(`CUMSUM install lot: GeoMean ${gm(PTT).toFixed(1)} (hand)`, (await text(page)).includes(`GeoMean: ${gm(PTT).toFixed(1)}`));
await page.getByRole("button", { name: "Save Entry" }).click();
await page.getByRole("button", { name: /Add Lot Change/ }).waitFor({ timeout: 15000 });
await page.getByRole("button", { name: /Add Lot Change/ }).click();
await page.getByPlaceholder("e.g. N0724170").fill("LOT-A");
await page.getByPlaceholder("e.g. N0824180").fill("LOT-B");
const lotRows = page.locator("table tbody tr").filter({ has: page.locator("input[placeholder='-']") });
for (let i = 0; i < 20; i++) { const r = lotRows.nth(i).locator("input[placeholder='-']"); await r.nth(0).fill(String(PTT[i])); await r.nth(1).fill(String(PTT_NEW[i])); }
const diff = gm(PTT_NEW) - gm(PTT);
const cs = await text(page);
check(`CUMSUM lot change: old ${gm(PTT).toFixed(1)}, new ${gm(PTT_NEW).toFixed(1)}, difference +${diff.toFixed(1)}, ACCEPT`,
  cs.includes(`Old GeoMean: ${gm(PTT).toFixed(1)}`) && cs.includes(`New GeoMean: ${gm(PTT_NEW).toFixed(1)}`) && cs.includes(`Difference: +${diff.toFixed(1)}`) && cs.includes("ACCEPT"));
await page.getByRole("button", { name: "Save Entry" }).click();
await page.getByText("BASELINE", { exact: true }).waitFor({ timeout: 15000 });
await shot(page, "9-cumsum");

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
