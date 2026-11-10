// scripts/verify-veritacheck-lot-refrange-ui.mjs
// Gate 3 step 8 receipt for BUG-157 (lot-to-lot "Abnormal Only" counted no pairs) and BUG-155 (reference range: with
// blank or censored results the saved PASS/FAIL could differ from the results page). Run against a LOCAL production
// build on a scratch database with made-up values (it registers an owner, provisions a lab and writes to SCRATCH_DB,
// so it refuses any other host):
//   PW_BASE=http://localhost:5205 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritacheck-lot-refrange-ui.mjs
// (vls-ops/ui_run_repo_port.sh builds, serves and runs it.) In a real browser, each case is typed into the form and run:
//   1. Abnormal Only, 20 pairs within 2%: the results page counts 20 pairs and reads PASS, the stored row is PASS with
//      its pairs labeled Abnormal, the PDF is built from those 20 pairs, the dashboard reads PASS (it read N 0, FAIL)
//   2. Abnormal Only, 20 pairs 20% apart: N 20 and FAIL everywhere (a real FAIL, not an empty one)
//   3. Reference range, 23 rows with 3 left blank: N 20, PASS on the page, in the stored row and in the PDF request
//      (the stored verdict counted the blanks as outside and read FAIL)
//   4. Reference range, 19 results and a censored "<120": N 19, FAIL (fewer than 20 results) on the page, in the stored
//      row and in the PDF request (the stored verdict read the censored result as in range and stored PASS)
//   5. dark mode and a phone
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5205", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full, animations: "disabled" });
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");
const rowOf = (name) => scratch((d) => d.prepare("SELECT * FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));
const dpOf = (row) => { try { return JSON.parse(row?.data_points || "null"); } catch { return null; } };

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `lotref-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Lot", "ref", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Lot Ref Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
});

// Made-up values. Lot: high glucose (mg/dL), current 200 to 390, new within 2% or 20% apart. Reference range: sodium 135 to 145.
const CUR = Array.from({ length: 20 }, (_, i) => 200 + 10 * i);
const WITHIN = CUR.map((c, i) => +(c * (i % 2 ? 1.02 : 0.98)).toFixed(1));
const APART = CUR.map((c) => +(c * 1.2).toFixed(1));
const IN_RANGE = (n) => Array.from({ length: n }, (_, i) => String(136 + (i % 9)));

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
const newForm = async (page, testName, typeLabel) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: typeLabel }).click();
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.waitForTimeout(300);
};
const fieldBox = (page, label) => page.locator("div.space-y-1\\.5").filter({ has: page.locator("label", { hasText: new RegExp(`^${label}$`) }) });
const runStudy = async (page) => {
  if (await page.getByTestId("button-submit-study").isDisabled()) throw new Error("Run Study is disabled");
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText(/^Overall: (PASS|FAIL)/).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
};
const overallLine = async (page) => (await page.getByText(/^Overall: (PASS|FAIL)/).first().innerText()).trim();
const pageVerdict = (line) => (/^Overall: PASS/.test(line) ? "pass" : "fail");
// Download PDF: the PDF is built from the results the page sends; keep them and check the file is a PDF.
const downloadPdf = async (page, file) => {
  const [req, dl] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/generate-pdf") && r.method() === "POST", { timeout: 60000 }),
    page.waitForEvent("download", { timeout: 90000 }),
    page.getByTestId("button-download-pdf").first().click(),
  ]);
  await dl.saveAs(path.join(OUT, file));
  return { results: JSON.parse(req.postData() || "{}").results || {}, isPdf: fs.readFileSync(path.join(OUT, file)).subarray(0, 4).toString() === "%PDF" };
};
const dashboardRow = async (page, name) => {
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
  const title = page.getByText(name, { exact: true }).first();
  await title.waitFor({ timeout: 15000 });
  await title.scrollIntoViewIfNeeded();
  return (await title.locator("xpath=ancestor::div[contains(@class,'flex')][2]").innerText()).replace(/\s+/g, " ");
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const toTop = async (page, loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: "start" })); await page.evaluate(() => window.scrollBy(0, -90)); };
const page = await open();
const ids = {};

// ── 1 and 2. Lot-to-lot, Abnormal Only ────────────────────────────────────────
const lotCase = async (name, news, want, shotPrefix) => {
  await newForm(page, name, /Reagent Lot Verification/);
  await page.getByPlaceholder("e.g. Fibrinogen").fill("Made-up Glucose");
  await page.getByPlaceholder("e.g. mg/dL").fill("mg/dL");
  await fieldBox(page, "Sample Type").getByRole("combobox").click();
  await page.getByRole("option", { name: "Abnormal Only" }).click();
  const cells = page.locator("table").first().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) { await cells.nth(2 * i).fill(String(CUR[i])); await cells.nth(2 * i + 1).fill(String(news[i])); }
  await page.keyboard.press("Tab");
  check(`${name}: the form reads Abnormal Only with one Specimen Data grid`, (await fieldBox(page, "Sample Type").innerText()).includes("Abnormal Only") && !(await text(page)).includes("Abnormal Cohort Specimen ID"));
  if (shotPrefix) { await toTop(page, fieldBox(page, "Sample Type")); await shot(page, `${shotPrefix}-form-light`); }
  await runStudy(page);
  const res = await text(page);
  const line = await overallLine(page);
  const row = rowOf(name);
  ids[name] = row?.id;
  const dp = dpOf(row);
  const pairs = want === "pass" ? 20 : 0;
  check(`${name}: results page shows the Abnormal cohort with N 20, ${want.toUpperCase()} (it showed N 0, FAIL)`,
    res.includes("Abnormal Cohort - Summary") && res.includes("N: 20") && line === `Overall: ${want.toUpperCase()}, ${pairs}/20 results within TEa`, `${line} | ${res.match(/N: \d+/)?.[0]}`);
  check(`${name}: the stored row is ${want.toUpperCase()}, the results page's verdict`, row?.status === want && pageVerdict(line) === row?.status, `stored ${row?.status}, page ${pageVerdict(line)}`);
  check(`${name}: the stored row holds 20 complete pairs labeled Abnormal`, dp?.sampleType === "abnormal" && dp?.data?.filter((d) => d.currentLot !== null && d.newLot !== null).length === 20 && dp.data.every((d) => d.cohort === "Abnormal"), JSON.stringify(dp?.data?.[0]));
  return { res, line };
};
await section("Abnormal Only, within 2%", async () => {
  const name = "Made-up Abnormal Only lot";
  await lotCase(name, WITHIN, "pass", "bug157-abnormal");
  await page.getByText("Abnormal Cohort - Summary").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -260));
  await shot(page, "bug157-abnormal-results-light");
  const pdf = await downloadPdf(page, "bug157-abnormal.pdf");
  check(`${name}: Download PDF delivers a PDF built from the Abnormal cohort's 20 pairs, PASS`,
    pdf.isPdf && pdf.results.cohorts?.length === 1 && pdf.results.cohorts[0].cohort === "Abnormal" && pdf.results.cohorts[0].n === 20 && pdf.results.passCount === 20 && pdf.results.overallPass === true,
    JSON.stringify({ isPdf: pdf.isPdf, cohorts: pdf.results.cohorts?.map((c) => [c.cohort, c.n]), pass: pdf.results.overallPass }));
  const dash = await dashboardRow(page, name);
  check(`${name}: the dashboard reads PASS, as the results page does`, / PASS /.test(` ${dash} `) && !/ FAIL /.test(` ${dash} `), dash);
});
await section("Abnormal Only, 20% apart", async () => {
  const name = "Made-up Abnormal Only lot apart";
  await lotCase(name, APART, "fail", null);
  const pdf = await downloadPdf(page, "bug157-abnormal-apart.pdf");
  check(`${name}: the PDF is built from 20 pairs, 0 within TEa, FAIL`, pdf.isPdf && pdf.results.cohorts?.[0]?.n === 20 && pdf.results.passCount === 0 && pdf.results.overallPass === false,
    JSON.stringify({ n: pdf.results.cohorts?.[0]?.n, passCount: pdf.results.passCount, pass: pdf.results.overallPass }));
});

// ── 3 and 4. Reference range ──────────────────────────────────────────────────
const refCase = async (name, rows, values, want, n, shotName) => {
  await newForm(page, name, /Reference Range Verification/);
  await page.getByPlaceholder("e.g. Sodium").fill("Made-up Sodium");
  await page.getByPlaceholder("e.g. mmol/L").fill("mmol/L");
  await page.getByPlaceholder("e.g. 135").fill("135");
  await page.getByPlaceholder("e.g. 145").fill("145");
  if (rows !== 20) { await page.getByTestId("ref-num-specimens-input").fill(String(rows)); await page.keyboard.press("Tab"); await page.waitForTimeout(300); }
  const cells = page.locator('input[title^="Enter a number"]');
  check(`${name}: the form has ${rows} specimen rows`, (await cells.count()) === rows, String(await cells.count()));
  for (let i = 0; i < values.length; i++) await cells.nth(i).fill(values[i]);
  await page.keyboard.press("Tab");
  await runStudy(page);
  const res = await text(page);
  const line = await overallLine(page);
  const row = rowOf(name);
  ids[name] = row?.id;
  check(`${name}: results page shows ${n} specimens, ${want.toUpperCase()}`, res.includes(`${n} Total Specimens`) && line.startsWith(`Overall: ${want.toUpperCase()}`), `${line} | ${res.match(/\d+ Total Specimens/)?.[0]}`);
  check(`${name}: the stored row is ${want.toUpperCase()}, the results page's verdict`, row?.status === want && pageVerdict(line) === row?.status, `stored ${row?.status}, page ${pageVerdict(line)}`);
  await page.getByText("Total Specimens").first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -200));
  await shot(page, shotName);
  const pdf = await downloadPdf(page, `${shotName}.pdf`);
  check(`${name}: Download PDF delivers a PDF built from N ${n}, ${want.toUpperCase()}`, pdf.isPdf && pdf.results.n === n && pdf.results.overallPass === (want === "pass"),
    JSON.stringify({ isPdf: pdf.isPdf, n: pdf.results.n, pass: pdf.results.overallPass }));
  return res;
};
await section("reference range with 3 blank rows", async () => {
  await refCase("Made-up reference range blanks", 23, IN_RANGE(20), "pass", 20, "bug155-refrange-blanks-light");
});
await section("reference range with a censored result", async () => {
  const res = await refCase("Made-up reference range censored", 20, [...IN_RANGE(19), "<120"], "fail", 19, "bug155-refrange-censored-light");
  check("censored case: the page says why (19 results, 20 required)", res.includes("Insufficient specimens: 19 provided, minimum 20 required"), res.slice(0, 200));
  const row = rowOf("Made-up reference range censored");
  check("censored case: the stored row keeps the censored entry as typed", dpOf(row)?.specimens?.[19]?.value?.censored === true && dpOf(row).specimens[19].value.censor_value === 120, JSON.stringify(dpOf(row)?.specimens?.[19]));
});

// ── 5. Dark and phone ─────────────────────────────────────────────────────────
await section("dark", async () => {
  const dark = await open({ colorScheme: "dark" });
  await dark.goto(`${BASE}/labs/${labId}/study/${ids["Made-up Abnormal Only lot"]}/results`, { waitUntil: "networkidle" });
  await dark.getByText("Abnormal Cohort - Summary").waitFor({ timeout: 20000 });
  check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
  check("dark: Abnormal Only results read N 20, PASS", (await text(dark)).includes("N: 20") && (await overallLine(dark)).startsWith("Overall: PASS"));
  await dark.getByText("Abnormal Cohort - Summary").scrollIntoViewIfNeeded();
  await dark.evaluate(() => window.scrollBy(0, -260));
  await shot(dark, "bug157-abnormal-results-dark");
  await dark.goto(`${BASE}/labs/${labId}/study/${ids["Made-up reference range censored"]}/results`, { waitUntil: "networkidle" });
  await dark.getByText("Total Specimens").first().waitFor({ timeout: 20000 });
  check("dark: censored reference range reads 19 specimens, FAIL", (await text(dark)).includes("19 Total Specimens") && (await overallLine(dark)).startsWith("Overall: FAIL"));
  await dark.getByText("Total Specimens").first().scrollIntoViewIfNeeded();
  await dark.evaluate(() => window.scrollBy(0, -200));
  await shot(dark, "bug155-refrange-censored-dark");
});
await section("phone", async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await newForm(phone, "Made-up Abnormal Only phone", /Reagent Lot Verification/);
  await fieldBox(phone, "Sample Type").getByRole("combobox").click();
  await phone.getByRole("option", { name: "Abnormal Only" }).click();
  const cells = phone.locator("table").first().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) { await cells.nth(2 * i).fill(String(CUR[i])); await cells.nth(2 * i + 1).fill(String(WITHIN[i])); }
  await phone.keyboard.press("Tab");
  check("phone: no sideways scroll on the Abnormal Only form", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await toTop(phone, fieldBox(phone, "Sample Type"));
  await shot(phone, "bug157-abnormal-form-phone");
  await runStudy(phone);
  check("phone: results read N 20, PASS, stored PASS", (await text(phone)).includes("N: 20") && (await overallLine(phone)).startsWith("Overall: PASS") && rowOf("Made-up Abnormal Only phone")?.status === "pass");
  await phone.getByText("Abnormal Cohort - Summary").scrollIntoViewIfNeeded();
  await phone.evaluate(() => window.scrollBy(0, -120));
  await shot(phone, "bug157-abnormal-results-phone");
  await phone.goto(`${BASE}/labs/${labId}/study/${ids["Made-up reference range blanks"]}/results`, { waitUntil: "networkidle" });
  await phone.getByText("Total Specimens").first().waitFor({ timeout: 20000 });
  check("phone: the reference range with blanks reads 20 specimens, PASS", (await text(phone)).includes("20 Total Specimens") && (await overallLine(phone)).startsWith("Overall: PASS"));
  await phone.getByText("Total Specimens").first().scrollIntoViewIfNeeded();
  await phone.evaluate(() => window.scrollBy(0, -120));
  await shot(phone, "bug155-refrange-blanks-phone");
  // Not this change: the results header's button row is wider than a phone on every study type (reported on 11/9).
  const wide = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth, view: window.innerWidth }));
  console.log(`NOTE  phone results: page ${wide.page}px in a ${wide.view}px window`);
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
