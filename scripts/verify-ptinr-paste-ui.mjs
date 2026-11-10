// scripts/verify-ptinr-paste-ui.mjs
// Gate 3 browser receipt for BUG-149 (SCAHC 2026-11-09: a tech pasting a column of normal PTs from Excel into the
// PT/INR Geometric Mean Calculator's Module 1 got only the first value, in the first of 20 fixed cells). Run against a
// LOCAL production build on a scratch database with made-up values (it registers an owner, provisions a lab and
// writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5203 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-ptinr-paste-ui.mjs
// In a real browser:
//   1. a 25-line column (Excel's CRLF, one "<9.0") pasted into Module 1's first cell fills 25 cells, in order;
//   2. a typed "<9.0" reads the same as the pasted one; Add Row adds ten cells; the grid says a censored value is
//      not used in the geometric mean;
//   3. Save Draft keeps all 24 numbers and the draft reopens with all 24 (it reopened with the first 20);
//   4. Run Study gives N 24 and the hand-calculated geometric mean of the 24 numbers;
//   5. a second instrument's grid takes a paste the same way;
//   6. light, dark and phone width screenshots, no sideways scroll on a phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5203", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let passes = 0, failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `ptinr-paste-${name}.png`), animations: "disabled" });
const text = async (page) => (await page.locator("body").innerText()).replace(/\s+/g, " ");

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `ptinr-paste-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Paste", "column", "25!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Paste Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
});
const rowOf = (name) => scratch((d) => d.prepare("SELECT id, status, data_points FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));

// 25 made-up normal PTs (seconds) as Excel copies a column: CRLF after every line. Line 13 is censored.
const LINES = Array.from({ length: 25 }, (_, i) => (i === 12 ? "<9.0" : (11.0 + ((i * 7) % 15) * 0.1).toFixed(1)));
const CLIP = LINES.map((l) => `${l}\r\n`).join("");
const NUMS = LINES.filter((l) => !l.startsWith("<")).map(Number);
const HAND = Math.exp(NUMS.reduce((s, v) => s + Math.log(v), 0) / NUMS.length);

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  if (opts.clipboard) await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  return page;
};
// Instrument n's normal-PT cells: the n-th 5-column grid in the Module 1 card (the same selector finds the cells
// before this fix, so the receipt can run against main and show what fails there).
const cells = (page, n = 1) => page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 1: Normal Patient Mean", { exact: false }) }).last()
  .locator("div.grid-cols-5").nth(n - 1).locator("input");
// A section that throws (a control that isn't there) is a FAIL, and the run goes on to the next section.
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran`, false, String(e?.message || e).split("\n")[0]); } };
const values = (page, n = 1) => cells(page, n).evaluateAll((els) => els.map((e) => e.value));
const openForm = async (page, testName) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /PT\/INR Geometric Mean/i }).click();
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
};
// A paste as the browser delivers it: a paste event carrying the clipboard text.
const paste = (locator, clip) => locator.evaluate((el, t) => {
  el.focus();
  const dt = new DataTransfer();
  dt.setData("text/plain", t);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, clip);
// What each cell should read after the paste: the number, or the censored value as any censored cell shows it.
const landed = (got) => got.length === 25 && LINES.every((l, i) => (l.startsWith("<") ? got[i] === "<9" : Number(got[i]) === Number(l)));

// ── 1. Paste a 25-line column into the first cell ─────────────────────────────
const page = await open();
let got = [];
let draftId = null;
await step("1. paste", async () => {
  await openForm(page, "PT made-up paste");
  check("Module 1 opens with 20 cells", (await cells(page).count()) === 20);
  await paste(cells(page).first(), CLIP);
  await page.waitForTimeout(300);
  got = await values(page);
  check("the 25-line column filled 25 cells, in order, including the censored one", landed(got), JSON.stringify(got));
  check('cell 13 holds the pasted "<9.0" as a censored value ("<9", as a typed one shows)', got[12] === "<9", got[12]);
  check("24 specimens ready (the censored one is not counted)", (await text(page)).includes("24 specimens ready"));
  check("the grid says the censored value is not used in the geometric mean", (await text(page)).includes("1 value entered with < or > is shown but not used in the geometric mean."));
});

// ── 2. Typed "<9.0" reads the same; Add Row ───────────────────────────────────
await step("2. typed value and Add Row", async () => {
  await page.getByTestId("pt-normals-1-add-row").click();
  check("Add Row adds ten cells (25 -> 35)", (await cells(page).count()) === 35);
  await cells(page).nth(25).fill("<9.0");
  await page.keyboard.press("Tab");
  check('a typed "<9.0" shows the same as the pasted one', (await cells(page).nth(25).inputValue()) === got[12], await cells(page).nth(25).inputValue());
  check("the note counts both censored values", (await text(page)).includes("2 values entered with < or > are shown but not used in the geometric mean."));
  await cells(page).nth(25).fill("");
  await page.keyboard.press("Tab");
  check("clearing the typed one leaves 1 censored value", (await text(page)).includes("1 value entered with < or > is shown"));
});
await page.getByText("Normal Patient PT Results (seconds)").first().scrollIntoViewIfNeeded().catch(() => {});
await page.evaluate(() => window.scrollBy(0, -120));
await shot(page, "light");

// ── 3. Save Draft, reopen ─────────────────────────────────────────────────────
await step("3. save draft and reopen", async () => {
  await page.getByTestId("button-save-draft").click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
  const draft = rowOf("PT made-up paste");
  draftId = draft?.id;
  const draftVals = JSON.parse(draft?.data_points || "null")?.module1Instruments?.[0]?.ptValues;
  check("Save Draft saved all 24 numbers (the censored one is not saved, as before)", draft?.status === "draft" && JSON.stringify(draftVals) === JSON.stringify(NUMS), JSON.stringify(draftVals));
  await page.goto(`${BASE}/labs/${labId}/study/${draft.id}/edit`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const back = await values(page);
  check("the reopened draft has all 24 numbers in 24 cells (it reopened with the first 20)", back.length === 24 && JSON.stringify(back.map(Number)) === JSON.stringify(NUMS), `${back.length} cells ${JSON.stringify(back)}`);
});

// ── 4. Run Study ──────────────────────────────────────────────────────────────
await step("4. run study", async () => {
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("Geometric Mean PT", { exact: true }).first().waitFor({ timeout: 20000 });
  const res = await text(page);
  check(`results: N 24, Geometric Mean PT ${HAND.toFixed(2)} sec (hand: exp(mean ln PT) of the 24 numbers)`, res.includes("N: 24") && res.includes(`Geo Mean PT: ${HAND.toFixed(2)} sec`), res.slice(0, 300));
  const ran = rowOf("PT made-up paste");
  check("stored: 24 numbers, PASS", ran?.status === "pass" && JSON.parse(ran.data_points).module1Instruments[0].ptValues.length === 24, ran?.status);
  await shot(page, "results");
});

// ── 5. A second instrument's grid ─────────────────────────────────────────────
await step("5. second instrument", async () => {
  await openForm(page, "PT made-up paste two");
  await page.getByTestId("pt-add-instrument").click();
  await paste(cells(page, 2).first(), CLIP);
  await page.waitForTimeout(300);
  check("Instrument 2's grid takes the same paste (25 cells, in order)", landed(await values(page, 2)));
  check("Instrument 1's grid is untouched by it (20 empty cells)", (await values(page, 1)).length === 20 && (await values(page, 1)).every((v) => v === ""));
});

// ── 5b. A real Ctrl+V through the system clipboard, as a tech pastes from Excel ──
await step("5b. real Ctrl+V", async () => {
  const kb = await open({ clipboard: true });
  await openForm(kb, "PT made-up paste keyboard");
  await kb.evaluate((t) => navigator.clipboard.writeText(t), CLIP);
  await cells(kb).first().click();
  await kb.keyboard.press("Control+V");
  await kb.waitForTimeout(300);
  check("a real Ctrl+V of the same column fills 25 cells, in order", landed(await values(kb)), JSON.stringify(await values(kb)));
  await kb.evaluate((t) => navigator.clipboard.writeText(t), "12.5");
  await cells(kb).nth(24).fill("");
  await cells(kb).nth(24).click();
  await kb.keyboard.press("Control+V");
  await kb.keyboard.press("Tab");
  check("a single value pasted with Ctrl+V goes into that one cell as before", (await values(kb)).length === 25 && (await cells(kb).nth(24).inputValue()) === "12.5", await cells(kb).nth(24).inputValue());
});

// ── 6. Dark and phone ─────────────────────────────────────────────────────────
await step("6. dark", async () => {
  const dark = await open({ colorScheme: "dark" });
  await openForm(dark, "PT made-up paste dark");
  await paste(cells(dark).first(), CLIP);
  await dark.waitForTimeout(300);
  check("dark: the page is in dark mode and the paste filled 25 cells", (await dark.evaluate(() => document.documentElement.classList.contains("dark"))) && landed(await values(dark)));
  await dark.getByText("Normal Patient PT Results (seconds)").first().scrollIntoViewIfNeeded();
  await dark.evaluate(() => window.scrollBy(0, -120));
  await shot(dark, "dark");
});
await step("6. phone", async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await openForm(phone, "PT made-up paste phone");
  await paste(cells(phone).first(), CLIP);
  await phone.waitForTimeout(300);
  check("phone: the paste filled 25 cells", landed(await values(phone)));
  await phone.getByText("Normal Patient PT Results (seconds)").first().scrollIntoViewIfNeeded();
  check("phone: no sideways scroll on the form", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(phone, "phone");
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(`\nPASS count: ${passes}/${passes + failures}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
