// scripts/verify-veritaqa-all-departments-ui.mjs
//
// Browser receipt (Gate 3 step 8) for VeritaQA's All departments choice (Michael 2026-11-12, "in qa, we need an option
// to 'see all' instead of only by department"). On a local production build with a scratch DB and a made-up owner, lab,
// departments and metrics, written through the app's own routes, never production:
//   A1. VeritaQA opens on All departments: each department is a heading, in the department list's order, with its count,
//       its metric cards under it, and the summary tiles count every metric
//   A2. picking one department shows only its cards, with no headings, as before
//   A3. Data Entry in All departments: a department row heads each department's metrics; Add Metric is off with the hint
//       "Pick a department to add a metric to it."; a value typed on another department's row saves to that metric
//   A4. editing a metric from All departments saves the edit and leaves the metric in its own department
//   A5. phone width: no sideways scroll; dark mode: the department heading reads at 4.5:1 or better
// Screenshots go to OUT. Run: PW_BASE=http://localhost:5253 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritaqa-all-departments-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Qa", "All", "77!"].join("-");
const stamp = Date.now();
const YEAR = new Date().getFullYear();

let LAB = 0;
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(token && LAB ? { "X-Active-Lab-Id": String(LAB) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};

const email = `qa-all-ui-owner-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: pw, name: "Made-up Owner Tolliver", hipaa_acknowledged: true });
const OWNER = { email, token: reg.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up QA All Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790014', time_zone = 'America/New_York' WHERE id = ?", LAB);

// Made-up departments and metrics, through the module's own routes.
const dept = async (name, sort_order) => (await call("POST", "/api/pi/departments", { name, sort_order }, OWNER.token)).body.id;
const metric = async (department_id, name, benchmark_green) =>
  (await call("POST", "/api/pi/metrics", { department_id, name, unit: "%", direction: "lower_is_better", benchmark_green }, OWNER.token)).body.id;
const D = { chem: await dept("San Carlos: Chemistry", 0), heme: await dept("Bylas: Hematology", 1), bb: await dept("San Carlos: Blood Bank", 2) };
const M = {
  hemo: await metric(D.chem, "Hemolysis rate", 2),
  redraw: await metric(D.chem, "Redraws", 1),
  clot: await metric(D.heme, "Clotted CBCs", 1),
  waste: await metric(D.bb, "Wasted product rate", 2),
};
for (const [id, month, value] of [[M.hemo, 1, 1.4], [M.redraw, 1, 2.6], [M.waste, 1, 1.1]]) {
  await call("POST", "/api/pi/entries", { metric_id: id, year: YEAR, month, value, volume: 300 }, OWNER.token);
}
check("setup: a made-up owner, lab, 3 departments and 4 metrics", LAB > 0 && Object.values(D).every((x) => x > 0) && Object.values(M).every((x) => x > 0), JSON.stringify({ LAB, D, M }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; return page.goto(url, opts); } };
const openAs = async (path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, OWNER.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [OWNER.token, me, LAB]);
  await go(page, `${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const tileNumber = async (page, label) => Number((await page.locator("div.uppercase", { hasText: label }).locator("xpath=following-sibling::div[1]").first().innerText()).replace(/[^\d]/g, ""));
const contrast = async (page, locator) => page.evaluate((el) => {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color);
  let n = el, bg = null;
  while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}, await locator.elementHandle());

try {
  // A1. Opens on All departments.
  const page = await openAs(`/labs/${LAB}/veritabench/pi`);
  const picker = page.getByTestId("qa-department-select");
  await picker.waitFor({ timeout: 20000 });
  check("A1a. the department picker opens on All departments", (await picker.innerText()).trim() === "All departments", await picker.innerText());
  const heads = (await page.locator("section[data-testid^='qa-dept-group-'] > h2").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  check("A1b. one heading per department, in the list's order, each with its count",
    JSON.stringify(heads) === JSON.stringify(["San Carlos: Chemistry (2)", "Bylas: Hematology (1)", "San Carlos: Blood Bank (1)"]), JSON.stringify(heads));
  const chemText = await page.getByTestId(`qa-dept-group-${D.chem}`).innerText();
  check("A1c. a department's cards sit under its heading", chemText.includes("Hemolysis rate") && chemText.includes("Redraws") && !chemText.includes("Clotted CBCs"), chemText.slice(0, 200));
  check("A1d. Metrics Tracked counts all 4", (await tileNumber(page, "Metrics Tracked")) === 4);
  await page.screenshot({ path: `${OUT}/qa-all-dashboard-light.png`, fullPage: true });

  // A2. One department.
  await picker.click();
  await page.getByRole("option", { name: "San Carlos: Chemistry", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  check("A2a. one department shows no department headings", (await page.locator("section[data-testid^='qa-dept-group-']").count()) === 0);
  const oneText = await page.locator("body").innerText();
  check("A2b. ... only its 2 cards, and Metrics Tracked 2", oneText.includes("Hemolysis rate") && oneText.includes("Redraws") && !oneText.includes("Clotted CBCs") && (await tileNumber(page, "Metrics Tracked")) === 2);
  await page.screenshot({ path: `${OUT}/qa-one-department-light.png`, fullPage: false });

  // A3. Data Entry in All departments.
  await picker.click();
  await page.getByRole("option", { name: "All departments", exact: true }).click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Data Entry" }).click();
  await page.waitForTimeout(400);
  const deptRows = (await page.locator("tr[data-testid^='qa-dept-row-']").allInnerTexts()).map((t) => t.trim());
  check("A3a. a department row heads each department's metrics, in order",
    JSON.stringify(deptRows) === JSON.stringify(["San Carlos: Chemistry", "Bylas: Hematology", "San Carlos: Blood Bank"]), JSON.stringify(deptRows));
  const rowOrder = await page.locator("tbody tr").evaluateAll((trs) => trs.map((tr) => (tr.getAttribute("data-testid") || "") + "|" + (tr.querySelector("td .font-medium")?.textContent || tr.textContent || "").trim()));
  const flat = rowOrder.map((r) => r.split("|")[1]);
  check("A3b. the metric rows sit under their department rows",
    JSON.stringify(flat) === JSON.stringify(["San Carlos: Chemistry", "Hemolysis rate", "Redraws", "Bylas: Hematology", "Clotted CBCs", "San Carlos: Blood Bank", "Wasted product rate"]), JSON.stringify(flat));
  check("A3c. Add Metric is off, with the hint", await page.getByTestId("qa-add-metric").isDisabled() && (await page.getByTestId("qa-add-metric-hint").innerText()).trim() === "Pick a department to add a metric to it.");
  const month = new Date().getMonth() + 1; // the Data Entry tab opens on this month
  const clotRow = page.locator("tbody tr", { hasText: "Clotted CBCs" });
  await clotRow.locator("input").first().fill("0.7");
  await page.screenshot({ path: `${OUT}/qa-all-data-entry-light.png`, fullPage: true });
  await page.getByRole("button", { name: /Save All/ }).click();
  await page.waitForTimeout(1200);
  const saved = sql("SELECT value FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ?", M.clot, YEAR, month);
  check("A3d. a value typed on Bylas's row from All departments saves to that metric", saved?.value === 0.7, JSON.stringify(saved));
  const others = sql("SELECT COUNT(*) AS n FROM pi_entries WHERE account_id = ?", OWNER.id);
  check("A3e. ... and only that value is added (3 before, 4 after)", Number(others?.n) === 4, JSON.stringify(others));

  // A4. Edit from All departments.
  const wasteRow = page.locator("tbody tr", { hasText: "Wasted product rate" });
  const btns = wasteRow.locator("button");
  await btns.nth((await btns.count()) - 2).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  check("A4a. the edit dialog opens on that metric", (await dialog.locator("input").first().inputValue()) === "Wasted product rate");
  await dialog.locator("input").first().fill("Wasted product rate, all products");
  await dialog.getByRole("button", { name: /save|update/i }).last().click();
  await page.waitForTimeout(1200);
  const edited = sql("SELECT name, department_id FROM pi_metrics WHERE id = ?", M.waste);
  check("A4b. the edit saves and the metric stays in its own department", edited?.name === "Wasted product rate, all products" && edited?.department_id === D.bb, JSON.stringify(edited));

  // A5. Phone and dark.
  const phone = await openAs(`/labs/${LAB}/veritabench/pi`, { viewport: { width: 375, height: 812 } });
  await phone.getByTestId("qa-department-select").waitFor({ timeout: 20000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const wide = await phone.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll("body *")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > w + 1 && r.width > 0)
      .slice(0, 6)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${String(el.className || "").slice(0, 60)} right=${Math.round(r.right)}`);
  });
  check("A5a. phone width: the All view has no sideways scroll", sideways <= 1, `scrollWidth - clientWidth = ${sideways}; wide: ${JSON.stringify(wide)}`);
  await phone.screenshot({ path: `${OUT}/qa-all-phone.png`, fullPage: false });
  const dark = await openAs(`/labs/${LAB}/veritabench/pi`, { colorScheme: "dark" });
  await dark.getByTestId("qa-department-select").waitFor({ timeout: 20000 });
  const head = dark.locator("section[data-testid^='qa-dept-group-'] > h2").first();
  const ratio = await contrast(dark, head);
  check("A5b. dark mode: the department heading reads at 4.5:1 or better", ratio >= 4.5, ratio.toFixed(2));
  await dark.screenshot({ path: `${OUT}/qa-all-dashboard-dark.png`, fullPage: false });
} finally {
  await browser.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
