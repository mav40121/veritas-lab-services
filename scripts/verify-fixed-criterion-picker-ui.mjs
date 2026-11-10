// scripts/verify-fixed-criterion-picker-ui.mjs
// Gate 3 step 8 receipt for BUG-160 (2026-11-10): six study types store their own fixed criterion, yet the form showed
// the shared criterion picker on five of them, and all six saved the picker's label (ALT/SGPT unless someone changed
// it). Run against a LOCAL production build on a scratch database with made-up values (it registers an owner,
// provisions a lab and writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5217 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-fixed-criterion-picker-ui.mjs
// (vls-ops/ui_run_repo_port.sh builds, serves and runs it.) In a real browser:
//   1. picking each of the six types shows no criterion picker; lot-to-lot, precision and calibration verification
//      still show it
//   2. Run Study on a reference range and a PT/INR study saves "Set by study type", not the picker's ALT/SGPT
//   3. Run Study on a lot-to-lot study still saves the picker's label
//   4. a phone
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5217", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
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
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), animations: "disabled" });
const rowOf = (name) => scratch((d) => d.prepare("SELECT * FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `fixedcrit-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Fixed", "crit", "60!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Fixed Criterion Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999160' WHERE id = ?").run(labId);
});
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const CUR = Array.from({ length: 20 }, (_, i) => 200 + 10 * i);
const NEW = CUR.map((c, i) => +(c * (i % 2 ? 1.01 : 0.99)).toFixed(1));

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  return page;
};
const pickType = async (page, testName, typeLabel) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: typeLabel }).click();
  await page.waitForTimeout(400);
};
const pickerShown = async (page) => (await page.getByTestId("tea-preset-trigger").count()) > 0;
const runStudy = async (page) => {
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("User Specifications", { exact: true }).first().waitFor({ timeout: 20000 });
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const page = await open();

// ── 1. Which types show the picker ────────────────────────────────────────────
const FIXED = [
  ["PT/INR", /PT\/INR Geometric Mean/i],
  ["QC lot verification", /QC Lot Verification/i],
  ["multi-analyte coag", /Multi-Analyte/i],
  ["reference range", /Reference Range Verification/i],
  ["carryover", /Carryover/i],
  ["sensitivity", /Sensitivity Verification/i],
];
const PICKER = [
  ["lot-to-lot", /Reagent Lot Verification/i],
  ["precision", /Precision Verification/i],
  ["calibration verification", /^Calibration Verification \(CLSI EP06\)/i],
];
await section("picker by type", async () => {
  for (const [label, re] of FIXED) {
    await pickType(page, `Made-up ${label}`, re);
    check(`${label}: no criterion picker${label === "sensitivity" ? " (already hidden; its save is checked in verify-fixed-criterion-label)" : " (it showed ALT/SGPT, which this type never uses)"}`, !(await pickerShown(page)));
  }
  await shot(page, "bug160-1-sensitivity-setup");
  await pickType(page, "Made-up PT setup", FIXED[0][1]);
  // The bottom of the Setup tab: the picker card used to sit last, under the Instruments card.
  await page.getByTestId("button-submit-study").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(300);
  await shot(page, "bug160-2-ptinr-setup");
  for (const [label, re] of PICKER) {
    await pickType(page, `Made-up ${label}`, re);
    check(`${label}: the criterion picker is still there`, await pickerShown(page));
  }
  await pickType(page, "Made-up lot setup", PICKER[0][1]);
  await page.getByTestId("tea-preset-trigger").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -300));
  await shot(page, "bug160-3-lot-setup");
});

// ── 2. What a fixed type saves ────────────────────────────────────────────────
await section("reference range saves", async () => {
  const name = "Made-up Sodium ref range";
  await pickType(page, name, /Reference Range Verification/i);
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByPlaceholder("e.g. Sodium").fill("Made-up Sodium");
  await page.getByPlaceholder("e.g. mmol/L").fill("mmol/L");
  await page.getByPlaceholder("e.g. 135").fill("135");
  await page.getByPlaceholder("e.g. 145").fill("145");
  const cells = page.locator('input[title^="Enter a number"]');
  for (let i = 0; i < 20; i++) await cells.nth(i).fill(String(136 + (i % 9)));
  await page.keyboard.press("Tab");
  await runStudy(page);
  const row = rowOf(name);
  check("reference range: saved with 'Set by study type' (it saved the picker's ALT/SGPT)", row?.clia_preset_label === "Set by study type", String(row?.clia_preset_label));
  check("reference range: its own criterion and verdict are unchanged (0.1, PASS)", row?.clia_allowable_error === 0.1 && row?.status === "pass", `${row?.clia_allowable_error} ${row?.status}`);
});
await section("PT/INR saves", async () => {
  const name = "Made-up PT fixed";
  await pickType(page, name, /PT\/INR Geometric Mean/i);
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  const m1 = page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 1: Normal Patient Mean", { exact: false }) }).last().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) await m1.nth(i).fill(String(NORMALS[i]));
  await page.keyboard.press("Tab");
  await runStudy(page);
  const row = rowOf(name);
  check("PT/INR: saved with 'Set by study type' (it saved the picker's ALT/SGPT)", row?.clia_preset_label === "Set by study type", String(row?.clia_preset_label));
  check("PT/INR: verdict unchanged (PASS)", row?.status === "pass", row?.status);
});

// ── 3. A picker type keeps the picker's label ─────────────────────────────────
await section("lot-to-lot saves", async () => {
  const name = "Made-up lot picker";
  await pickType(page, name, /Reagent Lot Verification/i);
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByPlaceholder("e.g. Fibrinogen").fill("Made-up Glucose");
  const cells = page.locator("table").first().locator("input[placeholder='-']");
  for (let i = 0; i < 20; i++) { await cells.nth(2 * i).fill(String(CUR[i])); await cells.nth(2 * i + 1).fill(String(NEW[i])); }
  await page.keyboard.press("Tab");
  await runStudy(page);
  const row = rowOf(name);
  check("lot-to-lot: still saved with the picker's label (ALT/SGPT, the default pick)", String(row?.clia_preset_label || "").startsWith("ALT/SGPT"), String(row?.clia_preset_label));
});

// ── 4. Phone ──────────────────────────────────────────────────────────────────
await section("phone", async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await pickType(phone, "Made-up PT phone", /PT\/INR Geometric Mean/i);
  check("phone: PT/INR shows no criterion picker", !(await pickerShown(phone)));
  check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot(phone, "bug160-4-ptinr-setup-phone");
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
