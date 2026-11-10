// scripts/verify-veritacheck-edit-criterion-ui.mjs
// Gate 3 receipt for BUG-153 and BUG-154 (found 2026-11-10 while fixing BUG-146). VeritaCheck Edit left the criterion
// picker on its first preset (ALT/SGPT, ±15% or ±6 U/L), so a re-run from Edit was judged and saved on ALT; the study
// PUTs didn't save a changed criterion's units or floor, and a draft re-save cleared its preset label. Run against a
// LOCAL production build on a scratch database with made-up values (it registers an owner, provisions a lab and
// writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5204 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritacheck-edit-criterion-ui.mjs
// In a real browser:
//   1. save a calibration verification with Sodium (±4 mmol/L) through the picker; one level misses by 5 mmol/L (FAIL);
//   2. open it with Edit: the picker shows Sodium and the active criterion reads ±4 mmol/L; Run Study again and the
//      saved criterion (value, units, floor, label) and the FAIL are unchanged;
//   3. Edit again and pick Glucose (±8% or ±6 mg/dL): Run Study saves the whole new criterion (percent, its floor);
//   4. a Sodium draft re-saved from Edit keeps its label and units;
//   5. a study saved with no preset label shows "As saved with this study" and a re-run keeps it exactly;
//   6. dark mode and phone width, no page errors, no failed API calls.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5204", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
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
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `bug153-${name}.png`), fullPage: full, animations: "disabled" });
const rowOf = (name) => scratch((d) => d.prepare("SELECT * FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));
const COLS = ["clia_allowable_error", "tea_is_percentage", "tea_unit", "clia_absolute_floor", "clia_absolute_unit", "clia_preset_label"];
const crit = (row) => Object.fromEntries(COLS.map((c) => [c, row?.[c] ?? null]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SODIUM = "Sodium (±4 mmol/L)", GLUCOSE = "Glucose (±8% or ±6 mg/dL)";
const SODIUM_COLS = { clia_allowable_error: 4, tea_is_percentage: 0, tea_unit: "mmol/L", clia_absolute_floor: null, clia_absolute_unit: null, clia_preset_label: SODIUM };
const GLUCOSE_COLS = { clia_allowable_error: 0.08, tea_is_percentage: 1, tea_unit: "%", clia_absolute_floor: 6, clia_absolute_unit: "mg/dL", clia_preset_label: GLUCOSE };

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `edit-crit-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Edit", "crit", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Criterion Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
});

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", ...(opts.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  return page;
};
const newCalVer = async (page, testName) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /^Calibration Verification \(CLSI EP06\)/ }).click();
};
const dataTab = async (page) => { await page.getByRole("tab", { name: "Data Entry" }).click(); await page.waitForTimeout(300); };
const setupTab = async (page) => { await page.getByRole("tab", { name: "Setup" }).click(); await page.waitForTimeout(300); };
// The criterion picker. main's build has no test id on it, so the bite run finds the criterion card's own combobox.
const trigger = async (page) => {
  const t = page.getByTestId("tea-preset-trigger");
  if (await t.count()) return t;
  return page.locator("xpath=//*[text()[starts-with(normalize-space(.), 'Adopted ')]]/ancestor::*[.//button[@role='combobox']][1]//button[@role='combobox']").first();
};
const pickCriterion = async (page, label) => {
  await setupTab(page);
  await (await trigger(page)).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForTimeout(200);
};
const fillGrid = async (page, rows) => {
  await dataTab(page);
  for (let i = 0; i < rows.length; i++) {
    await page.getByTestId(`input-dp-expected-${i}`).fill(String(rows[i][0]));
    await page.getByTestId(`input-dp-value-${i}-1`).fill(String(rows[i][1]));
  }
  await page.keyboard.press("Tab");
};
const reopen = async (page, id) => {
  await page.goto(`${BASE}/labs/${labId}/study/${id}/edit`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
};
const runStudy = async (page) => {
  if (await page.getByTestId("button-submit-study").isDisabled()) throw new Error("Run Study is disabled");
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
};
const saveDraft = async (page) => {
  await page.getByTestId("button-save-draft").click();
  await page.waitForURL(/dashboard/, { timeout: 30000 });
};
const pickerText = async (page) => (await (await trigger(page)).innerText()).trim();
const activeTea = async (page) => (await page.getByText(/^Active TEa:/).first().innerText()).trim();
const showPicker = async (page) => {
  await setupTab(page);
  await page.getByText(/^Adopted Acceptance Criterion/).first().evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -100));
  await page.waitForTimeout(200);
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const page = await open();
let sodiumId = null;

// ── 1-2. Sodium through the picker, then Edit and Run Study again ──────────────
await section("sodium", async () => {
  const NAME = "Made-up Sodium cal ver";
  await newCalVer(page, NAME);
  await pickCriterion(page, SODIUM);
  check("1. new study: the picker shows Sodium and the active criterion reads ±4 mmol/L", (await pickerText(page)).includes(SODIUM) && /±4 mmol\/L/.test(await activeTea(page)), `${await pickerText(page)} | ${await activeTea(page)}`);
  await fillGrid(page, [[120, 121], [140, 145], [160, 158]]);
  await runStudy(page);
  const first = rowOf(NAME);
  sodiumId = first?.id ?? null;
  check("1. Run Study saves the Sodium criterion as typed (4, units, mmol/L, no floor, its label) and FAIL (145 vs 140 is 5 mmol/L off)",
    same(crit(first), SODIUM_COLS) && first?.status === "fail", `${JSON.stringify(crit(first))} ${first?.status}`);
  await reopen(page, first.id);
  await showPicker(page);
  check("2. Edit: the picker shows Sodium (it showed ALT/SGPT)", (await pickerText(page)).includes(SODIUM), await pickerText(page));
  check("2. Edit: the active criterion reads ±4 mmol/L", /Active TEa: ±4 mmol\/L/.test(await activeTea(page)), await activeTea(page));
  await shot(page, "1-edit-picker-sodium");
  await runStudy(page);
  const again = rowOf(NAME);
  check("2. Run Study again from Edit: the saved criterion is unchanged (value, units, floor, label)", same(crit(again), crit(first)), JSON.stringify(crit(again)));
  check("2. ... and it is still FAIL (it was saved PASS on ALT ±15%)", again?.status === "fail", again?.status);
});

// ── 3. Edit, pick Glucose, Run Study: the whole new criterion is saved ─────────
await section("change to glucose", async () => {
  const NAME = "Made-up Sodium changed to Glucose";
  await newCalVer(page, NAME);
  await pickCriterion(page, SODIUM);
  await fillGrid(page, [[50, 55], [100, 103], [300, 306]]);
  await runStudy(page);
  const first = rowOf(NAME);
  await reopen(page, first.id);
  await pickCriterion(page, GLUCOSE);
  check("3. Edit, pick Glucose: the active criterion reads ±8.0% or ±6 mg/dL", /±8\.0% or ±6 mg\/dL/.test(await activeTea(page)), await activeTea(page));
  await runStudy(page);
  const after = rowOf(NAME);
  check("3. Run Study saves the whole Glucose criterion: percent, 0.08, its ±6 mg/dL floor and label (it kept units and mmol/L)", same(crit(after), GLUCOSE_COLS), JSON.stringify(crit(after)));
  check("3. ... judged on it: PASS (5 mg/dL at 50 is within the floor)", after?.status === "pass", after?.status);
});

// ── 4. A Sodium draft re-saved from Edit keeps its label and units ────────────
await section("draft", async () => {
  const NAME = "Made-up Sodium draft";
  await newCalVer(page, NAME);
  await pickCriterion(page, SODIUM);
  await fillGrid(page, [[120, 121], [140, 141]]);
  await saveDraft(page);
  const first = rowOf(NAME);
  check("4. Save Draft stores the Sodium criterion", first?.status === "draft" && same(crit(first), SODIUM_COLS), JSON.stringify(crit(first)));
  await reopen(page, first.id);
  await showPicker(page);
  check("4. Edit of the draft: the picker shows Sodium", (await pickerText(page)).includes(SODIUM), await pickerText(page));
  await saveDraft(page);
  const again = rowOf(NAME);
  check("4. Save Draft again from Edit keeps the label and the units criterion (the label was cleared)", again?.status === "draft" && same(crit(again), SODIUM_COLS), JSON.stringify(crit(again)));
});

// ── 5. A study saved with no preset label is held as saved ─────────────────────
await section("held", async () => {
  const NAME = "Made-up study with no preset label";
  const names = ["Instrument 1", "Instrument 2"];
  const grid = [[3, 3.25], [100, 107], [200, 210]].map(([e, v], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { [names[0]]: v, [names[1]]: null } }));
  const made = await call("POST", `/api/labs/${labId}/studies`, {
    testName: NAME, instrument: names[0], analyst: "Made Up", date: "2026-11-10", studyType: "cal_ver", cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%",
    cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL", dataPoints: JSON.stringify(grid), instruments: JSON.stringify(names), status: "pass", createdAt: new Date().toISOString(),
  }, reg.token, labId);
  const first = rowOf(NAME);
  await reopen(page, made.id);
  await showPicker(page);
  check("5. Edit of a study with no preset label: the picker shows it as saved, ±8.0% or ±6 mg/dL", /No preset named: ±8\.0% or ±6 mg\/dL/.test(await pickerText(page)) && (await page.getByTestId("tea-as-saved-note").count()) > 0, await pickerText(page));
  await shot(page, "4-edit-held-criterion");
  await runStudy(page);
  const again = rowOf(NAME);
  check("5. Run Study again keeps it exactly, no label added, same verdict", same(crit(again), crit(first)) && again?.status === first?.status, `${JSON.stringify(crit(again))} ${first?.status}->${again?.status}`);
});

// ── 6. Dark mode and phone width ──────────────────────────────────────────────
await section("dark", async () => {
  if (sodiumId === null) throw new Error("no Sodium study to reopen");
  const dark = await open({ colorScheme: "dark" });
  await reopen(dark, sodiumId);
  await showPicker(dark);
  check("6. dark: the page is in dark mode and Edit's picker shows Sodium", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await pickerText(dark)).includes(SODIUM), await pickerText(dark));
  await shot(dark, "2-edit-picker-sodium-dark");
});
await section("phone", async () => {
  if (sodiumId === null) throw new Error("no Sodium study to reopen");
  const phone = await open({ viewport: { width: 390, height: 844 }, mobile: true });
  await reopen(phone, sodiumId);
  await showPicker(phone);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("6. phone: Edit's picker shows Sodium, no sideways scroll", (await pickerText(phone)).includes(SODIUM) && overflow <= 1, `${await pickerText(phone)} overflow ${overflow}`);
  await shot(phone, "3-edit-picker-sodium-phone");
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
