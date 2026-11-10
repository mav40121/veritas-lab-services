// scripts/verify-veritacheck-drafts-ui.mjs
// Gate 3 receipt for BUG-146 (found 2026-11-09 while fixing BUG-145; SCAHC's tech re-entered a PT/INR study three
// times that day): VeritaCheck Save Draft kept none of a form's entries for any study type but PT/INR, and Edit read
// back only a few forms. Run against a LOCAL production build on a scratch database with made-up values (it registers
// an owner, provisions a lab and writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5201 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritacheck-drafts-ui.mjs
// In a real browser, for precision, reagent lot verification, reference range and qualitative method comparison:
//   1. type entries, Save Draft, and the draft row holds them (it held the calibration grid);
//   2. open the draft with Edit and every entry is back in the form;
//   3. Run Study from the reopened precision and lot-to-lot drafts saves a finished study, and Edit of the finished
//      precision study brings its entries back;
//   4. a method comparison draft of 25 samples reopens with all 25 (Edit trimmed it to 20);
//   5. dark mode, no page errors, no failed API calls.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5201", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `bug146-${name}.png`), fullPage: full, animations: "disabled" });
const rowOf = (name) => scratch((d) => d.prepare("SELECT * FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));
const dpOf = (row) => { try { return JSON.parse(row?.data_points || "null"); } catch { return null; } };

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `drafts-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Draft", "all", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Drafts Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
});

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
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
};
const dataTab = async (page) => { await page.getByRole("tab", { name: "Data Entry" }).click(); await page.waitForTimeout(300); };
const setupTab = async (page) => { await page.getByRole("tab", { name: "Setup" }).click(); await page.waitForTimeout(300); };
const saveDraft = async (page) => {
  await page.getByTestId("button-save-draft").click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};
const reopen = async (page, id) => {
  await page.goto(`${BASE}/labs/${labId}/study/${id}/edit`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
};
const runStudy = async (page) => {
  if (await page.getByTestId("button-submit-study").isDisabled()) throw new Error("Run Study is disabled (the form has too few entries)");
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
};
const fieldBy = (page, label) => page.locator("div.space-y-1\\.5").filter({ has: page.locator("label", { hasText: new RegExp(`^${label.replace(/[#()]/g, "\\$&")}$`) }) }).locator("input").first();
const values = (loc) => loc.evaluateAll((els) => els.map((e) => e.value));
// Put a field at the top of the window (under the sticky header) so a screenshot shows the form's entries.
const toTop = async (page, loc) => { await loc.evaluate((e) => e.scrollIntoView({ block: "start" })); await page.evaluate(() => window.scrollBy(0, -90)); };
// A section that stops early (on main's build a lost draft leaves Run Study disabled) is one FAIL; the next still runs.
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const page = await open();
let refDraftId = null;

// ── 1. Precision ──────────────────────────────────────────────────────────────
await section("precision", async () => {
const PREC1 = ["5.1", "5.3", "5.2", "<4.5", "5.1", "4.9"];
const PREC2 = ["20.1", "20.3", "19.9", "20.4", "20.2"];
const PREC3 = ["12.1", "12.4", "11.9"];
await newForm(page, "Made-up precision draft", /Precision Verification/);
await dataTab(page);
// Not this change: on main too, Run Study for precision stays disabled until 3 levels each hold 3 values, though the
// counter beside it says 1 level is the minimum (reported, not fixed here). Shown here, then 3 levels are used.
{
  const cells = page.locator('input[title^="Enter a number"]');
  for (let i = 0; i < 5; i++) { await cells.nth(i).fill(PREC2[i]); await cells.nth(20 + i).fill(PREC2[i]); }
  console.log(`NOTE  precision with 2 levels of 5 values: Run Study ${await page.getByTestId("button-submit-study").isDisabled() ? "disabled" : "enabled"}; counter reads "${(await page.getByText(/levels? ready|minimum filled/).first().innerText()).trim()}"`);
  for (let i = 0; i < 5; i++) { await cells.nth(i).fill(""); await cells.nth(20 + i).fill(""); }
}
await page.getByText("Levels:", { exact: true }).locator("xpath=following-sibling::button[1]").click();
await page.getByRole("option", { name: "3", exact: true }).click();
await page.getByPlaceholder("Level 1").fill("Made-up Low");
const pCells = page.locator('input[title^="Enter a number"]');
for (let i = 0; i < PREC1.length; i++) await pCells.nth(i).fill(PREC1[i]);
for (let i = 0; i < PREC2.length; i++) await pCells.nth(20 + i).fill(PREC2[i]);
for (let i = 0; i < PREC3.length; i++) await pCells.nth(40 + i).fill(PREC3[i]);
await page.getByText("Optional precision parameters (vendor claim, target)").click();
await page.getByPlaceholder("e.g. 1.57").fill("0.12");
await page.getByPlaceholder("e.g. Technopath 103506230 exp 31 Dec 2025").fill("CTL-MU-1");
await page.keyboard.press("Tab");
await shot(page, "1-precision-typed");
await saveDraft(page);
const pRow = rowOf("Made-up precision draft");
const pDp = dpOf(pRow);
check("precision: Save Draft stores a draft holding the 3 levels' replicates, the censored one too (it held the calibration grid)",
  pRow?.status === "draft" && Array.isArray(pDp) && pDp.length === 3 && pDp[0]?.levelName === "Made-up Low" && pDp[0]?.values?.length === 6 && pDp[0].values[3]?.censored === true && pDp[1]?.values?.length === 5 && pDp[2]?.values?.length === 3,
  JSON.stringify(pDp).slice(0, 200));
check("precision: the draft row has the vendor SD and control lot", pRow?.vendor_sd === 0.12 && pRow?.control_lot === "CTL-MU-1", `${pRow?.vendor_sd} ${pRow?.control_lot}`);
await reopen(page, pRow.id);
await dataTab(page);
const pBack = await values(page.locator('input[title^="Enter a number"]'));
const precBackOk = (v) => JSON.stringify(v.slice(0, 6)) === JSON.stringify(PREC1) && JSON.stringify(v.slice(20, 25)) === JSON.stringify(PREC2) && JSON.stringify(v.slice(40, 43)) === JSON.stringify(PREC3) && v.length === 60;
check("precision: Edit of the draft shows every replicate back in its box, all 3 levels", precBackOk(pBack), JSON.stringify(pBack));
check("precision: the level name is back", (await page.getByPlaceholder("Level 1").inputValue()) === "Made-up Low");
await page.getByText("Optional precision parameters (vendor claim, target)").click();
check("precision: the vendor SD and control lot are back", (await page.getByPlaceholder("e.g. 1.57").inputValue()) === "0.12" && (await page.getByPlaceholder("e.g. Technopath 103506230 exp 31 Dec 2025").inputValue()) === "CTL-MU-1");
await page.getByPlaceholder("Level 1").scrollIntoViewIfNeeded();
await shot(page, "2-precision-draft-reopened");
await runStudy(page);
const pDone = rowOf("Made-up precision draft");
check("precision: Run Study from the reopened draft saves the finished study (PASS or FAIL, not draft) with the same replicates",
  (pDone?.status === "pass" || pDone?.status === "fail") && JSON.stringify(dpOf(pDone)?.[0]?.values) === JSON.stringify(pDp[0].values) && pDone?.vendor_sd === 0.12, pDone?.status);
await reopen(page, pDone.id);
await dataTab(page);
const pAgain = await values(page.locator('input[title^="Enter a number"]'));
check("precision: Edit of the finished study shows the replicates (it showed an empty form)", precBackOk(pAgain), JSON.stringify(pAgain.slice(0, 8)));

});

// ── 2. Reagent lot verification ───────────────────────────────────────────────
await section("lot-to-lot", async () => {
const PAIRS = [["300", "305"], ["280", "284"], ["310", "300"], ["295", "297"]];
await newForm(page, "Made-up lot draft", /Reagent Lot Verification/);
await dataTab(page);
await page.getByPlaceholder("e.g. Fibrinogen").fill("Made-up Fibrinogen");
await fieldBy(page, "Current Lot #").fill("CUR-MU-1");
await fieldBy(page, "New Lot #").fill("NEW-MU-1");
await fieldBy(page, "New Lot Expiration").fill("2027-06-30");
const lCells = page.locator("table").first().locator("input[placeholder='-']");
for (let i = 0; i < PAIRS.length; i++) { await lCells.nth(2 * i).fill(PAIRS[i][0]); await lCells.nth(2 * i + 1).fill(PAIRS[i][1]); }
await lCells.nth(8).fill("290");                       // a half-typed pair
await page.keyboard.press("Tab");
await saveDraft(page);
const lRow = rowOf("Made-up lot draft");
const lDp = dpOf(lRow);
check("lot-to-lot: Save Draft stores the pairs, the half-typed one, the lots and the new lot's expiration",
  lRow?.status === "draft" && lDp?.data?.[0]?.currentLot === 300 && lDp?.data?.[3]?.newLot === 297 && lDp?.data?.[4]?.currentLot === 290 && lDp?.data?.[4]?.newLot === null && lDp?.newLot === "NEW-MU-1" && lDp?.newLotExp === "2027-06-30",
  JSON.stringify(lDp).slice(0, 200));
await reopen(page, lRow.id);
await dataTab(page);
const lBack = await values(page.locator("table").first().locator("input[placeholder='-']"));
check("lot-to-lot: Edit of the draft shows every pair back, the half-typed one too",
  JSON.stringify(lBack.slice(0, 10)) === JSON.stringify([...PAIRS.flat(), "290", ""]), JSON.stringify(lBack.slice(0, 10)));
check("lot-to-lot: analyte, both lot numbers and the expiration are back",
  (await page.getByPlaceholder("e.g. Fibrinogen").inputValue()) === "Made-up Fibrinogen" && (await fieldBy(page, "Current Lot #").inputValue()) === "CUR-MU-1"
  && (await fieldBy(page, "New Lot #").inputValue()) === "NEW-MU-1" && (await fieldBy(page, "New Lot Expiration").inputValue()) === "2027-06-30");
await toTop(page, page.getByPlaceholder("e.g. Fibrinogen"));
await shot(page, "3-lot-draft-reopened");
await runStudy(page);
const lDone = rowOf("Made-up lot draft");
check("lot-to-lot: Run Study from the reopened draft saves the finished study with the same pairs",
  (lDone?.status === "pass" || lDone?.status === "fail") && dpOf(lDone)?.data?.[2]?.newLot === 300 && dpOf(lDone)?.currentLot === "CUR-MU-1", lDone?.status);

});

// ── 3. Reference range ────────────────────────────────────────────────────────
await section("reference range", async () => {
const REF = ["136", "140", "142", "138", "144", "139"];
await newForm(page, "Made-up reference range draft", /Reference Range Verification/);
await dataTab(page);
await page.getByPlaceholder("e.g. Sodium").fill("Made-up Sodium");
await page.getByPlaceholder("e.g. 135").fill("135");
await page.getByPlaceholder("e.g. 145").fill("145");
const rCells = page.locator('input[title^="Enter a number"]');
for (let i = 0; i < REF.length; i++) await rCells.nth(i).fill(REF[i]);
const refRow3Id = page.locator("table tbody tr").nth(2).locator("input").first();
await refRow3Id.fill("MU-03");
await page.keyboard.press("Tab");
await saveDraft(page);
const rRow = rowOf("Made-up reference range draft");
refDraftId = rRow?.id ?? null;
const rDp = dpOf(rRow);
check("reference range: Save Draft stores the values, the renamed specimen and the range",
  rRow?.status === "draft" && rDp?.specimens?.[1]?.value === 140 && rDp?.specimens?.[2]?.specimenId === "MU-03" && rDp?.refLow === 135 && rDp?.refHigh === 145 && rDp?.analyte === "Made-up Sodium",
  JSON.stringify(rDp).slice(0, 200));
await reopen(page, rRow.id);
await dataTab(page);
const rBack = await values(page.locator('input[title^="Enter a number"]'));
check("reference range: Edit of the draft shows every value back", JSON.stringify(rBack.slice(0, 7)) === JSON.stringify([...REF, ""]), JSON.stringify(rBack.slice(0, 7)));
check("reference range: the renamed specimen, analyte and range are back",
  (await page.locator("table tbody tr").nth(2).locator("input").first().inputValue()) === "MU-03" && (await page.getByPlaceholder("e.g. Sodium").inputValue()) === "Made-up Sodium"
  && (await page.getByPlaceholder("e.g. 135").inputValue()) === "135" && (await page.getByPlaceholder("e.g. 145").inputValue()) === "145");
await toTop(page, page.getByPlaceholder("e.g. Sodium"));
await shot(page, "4-reference-range-draft-reopened");

});

// ── 4. Qualitative method comparison ──────────────────────────────────────────
await section("qualitative", async () => {
const QUAL = [["Reactive", "Reactive"], ["Nonreactive", "Nonreactive"], ["Reactive", "Nonreactive"]];
await newForm(page, "Made-up qualitative draft", /Method Comparison: Multi-Instrument/);
await page.getByTestId("select-assay-type").click();
await page.getByRole("option", { name: /^Qualitative/ }).click();
await page.getByRole("combobox").filter({ hasText: "Positive / Negative" }).click();
await page.getByRole("option", { name: "Reactive / Nonreactive" }).click();
await page.getByTestId("select-qual-pass-threshold").click();
await page.getByRole("option", { name: "95%" }).click();
await dataTab(page);
for (let i = 0; i < QUAL.length; i++) {
  for (let c = 0; c < 2; c++) {
    await page.locator("table tbody tr").nth(i).getByRole("combobox").nth(c).click();
    await page.getByRole("option", { name: QUAL[i][c], exact: true }).click();
  }
}
await saveDraft(page);
const qRow = rowOf("Made-up qualitative draft");
const qDp = dpOf(qRow);
check("qualitative: Save Draft stores the assay type, categories, threshold and the typed categories (it stored only the grid)",
  qRow?.status === "draft" && qDp?.assayType === "qualitative" && JSON.stringify(qDp?.categories) === JSON.stringify(["Reactive", "Nonreactive"]) && qDp?.passThreshold === 0.95 && qDp?.points?.[2]?.expectedCategory === "Reactive",
  JSON.stringify(qDp).slice(0, 200));
await reopen(page, qRow.id);
await setupTab(page);
check("qualitative: Edit of the draft is qualitative again, with Reactive / Nonreactive and 95%",
  /Qualitative/.test(await page.getByTestId("select-assay-type").innerText()) && /Reactive \/ Nonreactive/.test(await page.getByRole("combobox").filter({ hasText: "Reactive / Nonreactive" }).first().innerText().catch(() => ""))
  && /95%/.test(await page.getByTestId("select-qual-pass-threshold").innerText()));
await page.getByTestId("select-assay-type").scrollIntoViewIfNeeded();
await shot(page, "5-qualitative-draft-reopened-setup");
await dataTab(page);
const qBack = [];
for (let i = 0; i < QUAL.length; i++) qBack.push(await page.locator("table tbody tr").nth(i).getByRole("combobox").evaluateAll((els) => els.map((e) => e.innerText.trim())));
check("qualitative: every typed category is back in its row", JSON.stringify(qBack) === JSON.stringify(QUAL), JSON.stringify(qBack));
await toTop(page, page.locator("table").first());
await shot(page, "6-qualitative-draft-reopened-data");

});

// ── 5. Method comparison with 25 samples ──────────────────────────────────────
await section("method comparison 25 samples", async () => {
const names = ["Made-up Reference", "Made-up Candidate"];
const quant = Array.from({ length: 25 }, (_, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { [names[0]]: 50 + i, [names[1]]: 50.5 + i } }));
const made = await call("POST", `/api/labs/${labId}/studies`, {
  testName: "Made-up 25 sample draft", instrument: names[0], analyst: "", date: "2026-11-09", studyType: "method_comparison", cliaAllowableError: 0.1,
  dataPoints: JSON.stringify(quant), instruments: JSON.stringify(names), teaIsPercentage: 1, teaUnit: "%", cliaPresetLabel: "Lab-defined", status: "draft",
}, reg.token, labId);
await reopen(page, made.id);
await dataTab(page);
const rows25 = await page.locator("table tbody tr").count();
const last = await page.locator("table tbody tr").nth(24).locator("input").evaluateAll((els) => els.map((e) => e.value)).catch(() => []);
check("method comparison: a 25-sample draft reopens with all 25 samples (Edit trimmed it to 20)", rows25 === 25 && last.includes("74") && last.includes("74.5"), `${rows25} rows, last ${JSON.stringify(last)}`);

});

// ── 6. Dark mode ──────────────────────────────────────────────────────────────
await section("dark", async () => {
  const dark = await open({ colorScheme: "dark" });
  if (refDraftId === null) throw new Error("no reference range draft to reopen");
  await reopen(dark, refDraftId);
  await dataTab(dark);
  check("dark: the page is in dark mode, the reopened draft's values showing", await dark.evaluate(() => document.documentElement.classList.contains("dark"))
    && (await dark.getByPlaceholder("e.g. Sodium").inputValue()) === "Made-up Sodium");
  await toTop(dark, dark.getByPlaceholder("e.g. Sodium"));
  await shot(dark, "7-reference-range-reopened-dark");
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
