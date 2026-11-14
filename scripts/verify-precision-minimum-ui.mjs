// scripts/verify-precision-minimum-ui.mjs
// Gate 3 receipt for BUG-156 (found 2026-11-10 while fixing BUG-146): Run Study for precision stayed disabled until 3
// levels each held 3 values, though the count under the form said 1 level was enough and the form opens on 2 levels,
// so a 2-level precision study couldn't be run without adding a third level. Run against a LOCAL production build on a
// scratch database with made-up values (it registers an owner, provisions a lab and writes to SCRATCH_DB, so it
// refuses any other host):
//   PW_BASE=http://localhost:5203 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-precision-minimum-ui.mjs
// In a real browser:
//   1. precision on its default 2 levels, level 1 filled: Run Study disabled, the count reads 1 / 2, and the panel says
//      one more level needs 3 measurements;
//   2. both levels filled: Run Study enabled, "2 levels ready", no panel; switching to 3 levels blocks it again (2 / 3),
//      and to 1 level runs with "1 level ready";
//   3. Run Study on 2 levels saves a finished study with 2 levels of 3 values and opens its results;
//   4. carryover's count now reads the button's 12 (it read 3), in results;
//   5. dark mode, no page errors, no failed API calls.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5203", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
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
const shot = (page, name, full = false) => page.screenshot({ path: path.join(OUT, `bug156-${name}.png`), fullPage: full, animations: "disabled" });

const email = `minimums-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Min", "levels", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Minimums Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
});

const browser = await chromium.launch();
const pageErrors = [], failedCalls = [];
const open = async (colorScheme = "light") => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, colorScheme });
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
const levels = async (page, n) => {
  await page.getByText("Levels:", { exact: true }).locator("xpath=following-sibling::button[1]").click();
  await page.getByRole("option", { name: String(n), exact: true }).click();
  await page.waitForTimeout(200);
};
const fillLevel = async (page, level, vals) => {
  const cells = page.locator('input[title^="Enter a number"]');
  for (let i = 0; i < vals.length; i++) await cells.nth(level * 20 + i).fill(vals[i]);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(200);
};
const runBtn = (page) => page.getByTestId("button-submit-study");
const countText = async (page) => (await page.getByTestId("text-filled-count").innerText().catch(() => "(no count)")).trim();
const panel = (page) => page.getByTestId("panel-generate-blocking-reasons");
const toBottom = async (page) => { await runBtn(page).scrollIntoViewIfNeeded(); await page.evaluate(() => window.scrollBy(0, 120)); };

// ── 1-3. Precision ────────────────────────────────────────────────────────────
const page = await open();
try {
  await newForm(page, "Made-up precision minimum", /Precision Verification/);
  check("1. the form opens on 2 levels", (await page.getByText("Levels:", { exact: true }).locator("xpath=following-sibling::button[1]").innerText()).trim() === "2");
  await fillLevel(page, 0, ["5.1", "5.3", "5.2"]);
  check("1. level 1 filled: Run Study is disabled", await runBtn(page).isDisabled());
  check("1. ... the count reads 1 / 2", (await countText(page)) === "1 / 2 minimum filled", await countText(page));
  const p1 = (await panel(page).innerText().catch(() => "")).replace(/\s+/g, " ");
  check("1. ... the panel says one more level needs 3 measurements", /Enter at least 3 measurements in 1 more level on the Data Entry tab \(each of the 2 levels chosen needs 3\)/.test(p1), p1);
  await toBottom(page); await shot(page, "1-precision-one-of-two");

  await fillLevel(page, 1, ["20.1", "20.3", "19.9"]);
  check("2. both levels filled: Run Study is enabled (it stayed disabled until a third level)", !(await runBtn(page).isDisabled()));
  check("2. ... the count reads 2 levels ready", (await countText(page)) === "✓ 2 levels ready", await countText(page));
  check("2. ... no blocking panel", (await panel(page).count()) === 0);
  await toBottom(page); await shot(page, "2-precision-two-of-two");
  await levels(page, 3);
  check("2. 3 levels chosen with 2 filled: disabled, 2 / 3", (await runBtn(page).isDisabled()) && (await countText(page)) === "2 / 3 minimum filled", await countText(page));
  await levels(page, 1);
  check("2. 1 level chosen: enabled, 1 level ready", !(await runBtn(page).isDisabled()) && (await countText(page)) === "✓ 1 level ready", await countText(page));
  await levels(page, 2);
  check("2. back to 2 levels: enabled again with both filled", !(await runBtn(page).isDisabled()) && (await countText(page)) === "✓ 2 levels ready", await countText(page));

  await runBtn(page).click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  const row = scratch((d) => d.prepare("SELECT status, data_points FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get("Made-up precision minimum"));
  let dp = []; try { dp = JSON.parse(row?.data_points || "[]"); } catch { /* bad */ }
  check("3. Run Study on 2 levels saves a finished study (not a draft) and opens its results", !!row && row.status !== "draft" && /\/results/.test(page.url()), `${row?.status} ${page.url()}`);
  check("3. ... with 2 levels of 3 values each", Array.isArray(dp) && dp.length === 2 && dp.every((l) => Array.isArray(l.values) && l.values.length === 3), JSON.stringify(dp).slice(0, 200));
  await page.waitForTimeout(800);
  await shot(page, "3-precision-results");
} catch (e) { check("precision section ran to the end", false, String(e?.message || e).split("\n")[0]); }

// ── 4. Carryover's count ─────────────────────────────────────────────────────
try {
  await newForm(page, "Made-up carryover minimum", /Carryover/);
  check("4. carryover's count reads the button's minimum, 12 (it read 3)", (await countText(page)) === "0 / 12 minimum filled", await countText(page));
  const pc = (await panel(page).innerText().catch(() => "")).replace(/\s+/g, " ");
  check("4. ... and the panel counts results", /Fill 12 more results on the Data Entry tab \(12 results required for Carryover Verification\)/.test(pc), pc);
  await toBottom(page); await shot(page, "4-carryover-count");
} catch (e) { check("carryover section ran to the end", false, String(e?.message || e).split("\n")[0]); }

// ── 5. Dark mode ─────────────────────────────────────────────────────────────
try {
  const dark = await open("dark");
  await newForm(dark, "Made-up precision dark", /Precision Verification/);
  await fillLevel(dark, 0, ["5.1", "5.3", "5.2"]);
  await toBottom(dark); await shot(dark, "5-precision-one-of-two-dark");
  await fillLevel(dark, 1, ["20.1", "20.3", "19.9"]);
  check("5. dark mode: 2 levels filled, Run Study enabled", !(await runBtn(dark).isDisabled()) && (await countText(dark)) === "✓ 2 levels ready");
  await toBottom(dark); await shot(dark, "5-precision-two-of-two-dark");
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("5. no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
check("5. no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 5).join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
