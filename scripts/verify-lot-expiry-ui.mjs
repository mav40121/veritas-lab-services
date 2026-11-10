// scripts/verify-lot-expiry-ui.mjs
// Gate 3 step 8 receipt for BUG-158 (2026-11-10): a finished lot-to-lot study lost its lot expiration dates (only a
// draft kept them) and nothing showed them; the PT/INR form's Module 3 Old Lot Expiration was never saved. Run against
// a LOCAL production build on a scratch database with made-up values (it registers an owner, provisions a lab and
// writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5216 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-lot-expiry-ui.mjs
// (vls-ops/ui_run_repo_port.sh builds, serves and runs it.) In a real browser:
//   1. Lot-to-lot with both lots and their expiration dates typed, Run Study: the stored row holds both dates, the
//      results page's User Specifications lists each lot with its date, Download PDF delivers a PDF, and Edit of the
//      finished study shows both dates back in the form.
//   2. PT/INR with Module 3's old lot and its expiration typed, Run Study: the stored row holds the date, the results
//      page lists Module 3's old and new lots with their dates, and Edit shows the date back.
//   3. dark mode and a phone.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5216", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
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
const email = `lotexp-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Lot", "exp", "58!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Lot Expiry Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999158' WHERE id = ?").run(labId);
});

// Made-up values.
const CUR = Array.from({ length: 20 }, (_, i) => 200 + 10 * i);
const NEW = CUR.map((c, i) => +(c * (i % 2 ? 1.01 : 0.99)).toFixed(1));
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const M3X = Array.from({ length: 20 }, (_, i) => +(11 + i * 0.6).toFixed(1));
const M3Y = M3X.map((x) => +(x * 1.02).toFixed(2));

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
const field = (page, label) => page.locator("div.space-y-1\\.5").filter({ has: page.locator("label", { hasText: new RegExp(`^${label.replace(/[()#]/g, "\\$&")}$`) }) }).locator("input").first();
const runStudy = async (page) => {
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("User Specifications", { exact: true }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
};
const specsCard = (page) => page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("User Specifications", { exact: true }) }).last();
const specRow = async (page, label) => {
  const row = specsCard(page).locator("div.flex.justify-between").filter({ has: page.locator("span", { hasText: new RegExp(`^${label}$`) }) }).first();
  return (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ").trim() : null;
};
const openEdit = async (page, id) => {
  await page.goto(`${BASE}/labs/${labId}/study/${id}/edit`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.waitForTimeout(800);
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const page = await open();
const ids = {};

// ── 1. Lot-to-lot ─────────────────────────────────────────────────────────────
await section("lot-to-lot", async () => {
  const name = "Made-up lot expiry";
  await newForm(page, name, /Reagent Lot Verification/);
  await page.getByPlaceholder("e.g. Fibrinogen").fill("Made-up Glucose");
  await page.getByPlaceholder("e.g. mg/dL").fill("mg/dL");
  await field(page, "Current Lot #").fill("CUR-UI-158");
  await field(page, "Current Lot Expiration").fill("2027-01-31");
  await field(page, "New Lot #").fill("NEW-UI-158");
  await field(page, "New Lot Expiration").fill("2027-06-30");
  const cells = page.locator("table").first().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) { await cells.nth(2 * i).fill(String(CUR[i])); await cells.nth(2 * i + 1).fill(String(NEW[i])); }
  await page.keyboard.press("Tab");
  await field(page, "Current Lot #").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot(page, "bug158-1-lot-form");
  await runStudy(page);
  const row = rowOf(name);
  ids.lot = row?.id;
  const dp = dpOf(row);
  check("lot-to-lot: the stored row holds both expiration dates (Run Study dropped them)", dp?.currentLotExp === "2027-01-31" && dp?.newLotExp === "2027-06-30" && dp?.currentLot === "CUR-UI-158" && dp?.newLot === "NEW-UI-158",
    JSON.stringify({ c: dp?.currentLotExp, n: dp?.newLotExp }));
  const cur = await specRow(page, "Current Lot");
  const nw = await specRow(page, "New Lot");
  check("lot-to-lot: User Specifications lists Current Lot CUR-UI-158 (exp 2027-01-31)", cur === "Current Lot CUR-UI-158 (exp 2027-01-31)", String(cur));
  check("lot-to-lot: ... and New Lot NEW-UI-158 (exp 2027-06-30)", nw === "New Lot NEW-UI-158 (exp 2027-06-30)", String(nw));
  check("lot-to-lot: the verdict is unchanged by this (PASS, 20/20)", row?.status === "pass" && (await text(page)).includes("Overall: PASS, 20/20 results within TEa"), row?.status);
  await specsCard(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shot(page, "bug158-2-lot-results");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
  await dl.saveAs(path.join(OUT, "bug158-lot.pdf"));
  check("lot-to-lot: Download PDF delivers a PDF", fs.readFileSync(path.join(OUT, "bug158-lot.pdf")).subarray(0, 4).toString() === "%PDF");
  await openEdit(page, row.id);
  const back = { c: await field(page, "Current Lot Expiration").inputValue(), n: await field(page, "New Lot Expiration").inputValue(), cl: await field(page, "Current Lot #").inputValue() };
  check("lot-to-lot: Edit of the finished study shows both dates back (it showed them blank)", back.c === "2027-01-31" && back.n === "2027-06-30" && back.cl === "CUR-UI-158", JSON.stringify(back));
  await field(page, "Current Lot #").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot(page, "bug158-3-lot-edit");
});

// ── 2. PT/INR Module 3 ────────────────────────────────────────────────────────
await section("PT/INR", async () => {
  const name = "Made-up PT lot expiry";
  await newForm(page, name, /PT\/INR Geometric Mean/i);
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  await field(page, "Reagent Lot (New)").fill("NEW-PT-158");
  await field(page, "Reagent Expiration").fill("2027-06-30");
  const m1 = page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 1: Normal Patient Mean", { exact: false }) }).last().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) await m1.nth(i).fill(String(NORMALS[i]));
  const m3 = page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 3: Old Lot vs New Lot Comparison", { exact: true }) }).last();
  await field(page, "Old Lot #").fill("OLD-PT-158");
  await field(page, "Old Lot Expiration").fill("2026-12-31");
  const m3Cells = m3.locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) { await m3Cells.nth(2 * i).fill(String(M3X[i])); await m3Cells.nth(2 * i + 1).fill(String(M3Y[i])); }
  await page.keyboard.press("Tab");
  await field(page, "Old Lot #").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await shot(page, "bug158-4-ptinr-form");
  await runStudy(page);
  const row = rowOf(name);
  ids.pt = row?.id;
  const dp = dpOf(row);
  check("PT/INR: the stored Module 3 holds the old lot's expiration (it was never saved)", dp?.module3?.oldLotExp === "2026-12-31" && dp?.module3?.oldLot === "OLD-PT-158" && dp?.module3?.data?.length === 20,
    JSON.stringify(dp?.module3 && { oldLot: dp.module3.oldLot, oldLotExp: dp.module3.oldLotExp, n: dp.module3.data?.length }));
  const o = await specRow(page, "Module 3 Old Lot");
  const n = await specRow(page, "Module 3 New Lot");
  check("PT/INR: User Specifications lists Module 3 Old Lot OLD-PT-158 (exp 2026-12-31)", o === "Module 3 Old Lot OLD-PT-158 (exp 2026-12-31)", String(o));
  check("PT/INR: ... and Module 3 New Lot NEW-PT-158 (exp 2027-06-30), the reagent's date", n === "Module 3 New Lot NEW-PT-158 (exp 2027-06-30)", String(n));
  await specsCard(page).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shot(page, "bug158-5-ptinr-results");
  await openEdit(page, row.id);
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  const back = { exp: await field(page, "Old Lot Expiration").inputValue(), lot: await field(page, "Old Lot #").inputValue() };
  check("PT/INR: Edit of the finished study shows the old lot's expiration back", back.exp === "2026-12-31" && back.lot === "OLD-PT-158", JSON.stringify(back));
});

// ── 3. Dark and phone ─────────────────────────────────────────────────────────
await section("dark", async () => {
  const dark = await open({ colorScheme: "dark" });
  await dark.goto(`${BASE}/labs/${labId}/study/${ids.lot}/results`, { waitUntil: "networkidle" });
  await dark.getByText("User Specifications", { exact: true }).first().waitFor({ timeout: 20000 });
  check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
  check("dark: the lot rows read the same", (await specRow(dark, "New Lot")) === "New Lot NEW-UI-158 (exp 2027-06-30)");
  await specsCard(dark).scrollIntoViewIfNeeded();
  await dark.evaluate(() => window.scrollBy(0, -80));
  await shot(dark, "bug158-6-lot-results-dark");
});
await section("phone", async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await phone.goto(`${BASE}/labs/${labId}/study/${ids.pt}/results`, { waitUntil: "networkidle" });
  await phone.getByText("User Specifications", { exact: true }).first().waitFor({ timeout: 20000 });
  check("phone: the Module 3 lot rows read the same", (await specRow(phone, "Module 3 Old Lot")) === "Module 3 Old Lot OLD-PT-158 (exp 2026-12-31)");
  const card = await specsCard(phone).evaluate((e) => ({ right: e.getBoundingClientRect().right, view: window.innerWidth }));
  check("phone: the User Specifications card fits the screen", card.right <= card.view + 1, JSON.stringify(card));
  await specsCard(phone).scrollIntoViewIfNeeded();
  await phone.evaluate(() => window.scrollBy(0, -60));
  await shot(phone, "bug158-7-ptinr-results-phone");
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
