// scripts/verify-veritaqa-by-lab-ui.mjs
//
// Browser receipt for VeritaQA by laboratory, an organization's indicators, the reports and the links to findings (B15). On a
// local production build with a scratch DB: made-up labs, people and numbers only.
//   U1. VeritaQA opens for one laboratory; an account-wide indicator is labelled, with Assign on its Data Entry row
//   U2. Assign names the indicator, the laboratory and how many entries go; afterwards the other laboratory no longer shows it
//   U3. a system's admin defines an indicator and turns it on in two laboratories; each shows it beside its own
//   U4. numerator and denominator are entered, the value is worked out on screen and saved; a row with no entry says so
//   U5. the report across laboratories: value, No entry, the total from the sums; group and department; PDF and Excel download
//   U6. a change is a new version; the entry on file keeps its target
//   U7. one laboratory's report for a month, a quarter and a year; PDF and Excel download
//   U8. a finding is linked to a missed month and shows on both screens
//   U9. the account-wide plan is labelled; a laboratory starts its own
//   U10. a laboratory's owner is refused the system page; the older address opens the person's own laboratory
//   U11. dark mode and phone width: no sideways scroll of the page
// Run: PW_BASE=http://localhost:5315 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritaqa-by-lab-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const withDb = (fn) => { const db = new Database(process.env.SCRATCH_DB); db.pragma("foreign_keys = OFF"); db.pragma("busy_timeout = 8000"); try { return fn(db); } finally { db.close(); } };
const sql = (q, ...a) => withDb((db) => (/^\s*select/i.test(q) ? db.prepare(q).get(...a) : Number(db.prepare(q).run(...a).lastInsertRowid)));
const insert = (table, values) => withDb((db) => {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /INT|REAL/.test(c.type) ? 0 : "made-up";
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
});
const pw = ["Qa", "Lab", "77!"].join("-");
const stamp = Date.now();
const register = async (tag, name) => {
  const email = `qalab-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  const id = Number(sql("SELECT id FROM users WHERE email = ?", email).id);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", id);
  return { email, name, token: r.body.token, id };
};
const lab = async (owner, name, clia) => {
  const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: name, plan: "hospital" })).body.labId;
  sql("UPDATE labs SET has_completed_onboarding = 1, is_demo = 0, clia_number = ?, time_zone = 'America/New_York', subscription_status = 'active', subscription_expires_at = '2099-12-31' WHERE id = ?", clia, id);
  return id;
};

// ── Made-up world ──
const OWNER = await register("owner", "Avery Owner"), LEADER = await register("leader", "Lee Leader");
const A = await lab(OWNER, "Made-up North Hospital Laboratory", "22D7790101");
const B = Number(sql("INSERT INTO labs (lab_name, clia_number, owner_user_id, plan, subscription_status, subscription_expires_at, has_completed_onboarding, time_zone, created_at, updated_at) SELECT 'Made-up South Clinic Laboratory', '22D7790102', owner_user_id, plan, subscription_status, subscription_expires_at, 1, time_zone, created_at, updated_at FROM labs WHERE id = ?", A));
insert("lab_members", { lab_id: B, user_id: OWNER.id, role: "owner", status: "active", permissions_json: "{}" });
const ORG = insert("organizations", { name: "Made-up Health System", billing_owner_user_id: OWNER.id, plan: "enterprise" });
sql("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)", ORG, A, B);
insert("organization_members", { organization_id: ORG, user_id: LEADER.id, org_role: "org_admin", status: "active" });
const now = new Date(), YEAR = now.getFullYear(), MONTH = now.getMonth() + 1;
// Rows from before B15 on an account with two laboratories: account-wide.
const wideDept = insert("pi_departments", { account_id: OWNER.id, name: "Chemistry", sort_order: 0, active: 1 });
const wide = insert("pi_metrics", { department_id: wideDept, account_id: OWNER.id, name: "Hemolyzed specimens", unit: "%", direction: "lower_is_better", benchmark_green: 2, benchmark_yellow: 3, sort_order: 0, active: 1 });
for (let m = 1; m <= 5; m++) insert("pi_entries", { metric_id: wide, account_id: OWNER.id, year: YEAR, month: m, value: [1.4, 1.9, 3.6, 2.2, 1.2][m - 1], volume: 400 + m });
insert("pi_plan", { account_id: OWNER.id, title: "Laboratory quality plan", effective_year: YEAR, status: "active", program_scope: "Every department" });
const ownDept = (await call("POST", `/api/labs/${A}/veritaqa/pi/departments`, { name: "Hematology", sort_order: 1 }, OWNER.token)).body.id;
const own = (await call("POST", `/api/labs/${A}/veritaqa/pi/metrics`, { department_id: ownDept, name: "Clotted CBC specimens", unit: "%", direction: "lower_is_better", benchmark_green: 1, benchmark_yellow: 2 }, OWNER.token)).body.id;
await call("POST", `/api/labs/${A}/veritaqa/pi/entries`, { metric_id: own, year: YEAR, month: MONTH, value: 3.1, volume: 900, notes: "New draw site" }, OWNER.token);
const finding = insert("findings", { user_id: OWNER.id, lab_id: A, accreditor: "CAP", finding_number: "2026-04", standard_ref: "Made-up item 7", status: "open", source_type: "inspection", description: "Made-up" });
check("setup", !!OWNER.token && A > 0 && B > 0 && wide > 0 && own > 0 && finding > 0, JSON.stringify({ A, B, wide, own, finding }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const openAs = async (who, labId, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page error", false, String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, usr, l, dark]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); if (dark) localStorage.setItem("theme", "dark"); }, [who.token, me, labId, opts.colorScheme === "dark"]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (opts.colorScheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
const entryTab = async (page) => { await page.getByRole("button", { name: "Data Entry" }).click(); await page.waitForTimeout(400); };
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const pickMonth = async (page, m) => { const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]; await page.getByRole("combobox").filter({ hasText: new RegExp(names.join("|")) }).first().click(); await page.getByRole("option", { name: names[m - 1], exact: true }).click(); await page.waitForTimeout(200); };
const downloads = async (page, testId) => { const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId(testId).click()]); return d.suggestedFilename(); };

try {
  // U1
  const page = await openAs(OWNER, A, `/labs/${A}/veritabench/pi`);
  await page.getByTestId("qa-department-select").waitFor({ timeout: 30000 });
  const text1 = await page.locator("body").innerText();
  check("U1a. the laboratory's own and the account-wide indicators are both there", text1.includes("Hemolyzed specimens") && text1.includes("Clotted CBC specimens"));
  check("U1b. the account-wide one is labelled", (await page.getByTestId("qa-account-wide").count()) === 1 && (await page.getByTestId("qa-account-wide").first().innerText()) === "Account-wide, not assigned to a laboratory");
  await entryTab(page);
  check("U1c. Assign is offered on the account-wide row only", (await page.getByTestId(`qa-assign-${wide}`).count()) === 1 && (await page.getByTestId(`qa-assign-${own}`).count()) === 0);

  // U2
  await page.getByTestId(`qa-assign-${wide}`).click();
  await page.getByText(/Its 5 entries/).waitFor({ timeout: 15000 });
  const dlg = await page.getByTestId("qa-assign-dialog").innerText();
  check("U2a. the confirm names the indicator, the laboratory, its entries and the other laboratory", /Assign "Hemolyzed specimens" to Made-up North Hospital Laboratory\?/.test(dlg) && /Its 5 entries \(\d{4}-01 to \d{4}-05\) go with it\./.test(dlg) && /stops showing in the account's other laboratory/.test(dlg), dlg);
  await page.screenshot({ path: `${OUT}/b15_assign_light.png` });
  await page.getByTestId("qa-assign-confirm").click();
  await page.getByTestId("qa-assign-dialog").waitFor({ state: "detached", timeout: 15000 });
  await page.waitForTimeout(800);
  check("U2b. it is the laboratory's now", sql("SELECT lab_id FROM pi_metrics WHERE id = ?", wide).lab_id === A && (await page.getByTestId("qa-account-wide").count()) === 0 && (await page.locator("body").innerText()).includes("Hemolyzed specimens"));
  const south = await openAs(OWNER, B, `/labs/${B}/veritabench/pi`);
  await south.waitForTimeout(500);
  check("U2c. the other laboratory no longer shows it", !(await south.locator("body").innerText()).includes("Hemolyzed specimens"));
  await south.context().close();

  // U3
  const lead = await openAs(LEADER, A, `/labs/${A}/readiness`);
  await lead.getByTestId("system-quality-link").waitFor({ timeout: 30000 });
  await lead.getByTestId("system-quality-link").click();
  await lead.getByTestId("system-quality-empty").waitFor({ timeout: 20000 });
  check("U3a. Quality indicators sits beside Open findings on the system page, and says when nothing is turned on", await lead.getByTestId("system-quality-empty").isVisible());
  await lead.getByTestId("system-quality-tab-indicators").click();
  await lead.getByTestId("system-quality-new").click();
  await lead.getByTestId("oq-name").fill("Contaminated blood cultures");
  await lead.getByTestId("oq-department").fill("Microbiology");
  await lead.getByTestId("oq-definition").fill("Blood culture sets that grew skin flora only.");
  await lead.getByTestId("oq-numerator").fill("Contaminated sets");
  await lead.getByTestId("oq-denominator").fill("Sets collected");
  await lead.getByTestId("oq-target").fill("3");
  await lead.getByTestId("oq-save").click();
  await lead.getByTestId("system-quality-form").waitFor({ state: "detached", timeout: 15000 });
  const IND = sql("SELECT id FROM org_quality_indicators ORDER BY id DESC LIMIT 1").id;
  await lead.getByTestId(`system-quality-labs-${IND}`).click();
  await lead.getByTestId(`system-quality-lab-${A}`).check();
  await lead.getByTestId(`system-quality-lab-${B}`).check();
  await lead.getByTestId("system-quality-labs-save").click();
  await lead.getByTestId("system-quality-labs-dialog").waitFor({ state: "detached", timeout: 15000 });
  await lead.waitForTimeout(500);
  check("U3b. defined once and on in both laboratories", (await lead.getByTestId(`system-quality-labs-${IND}`).innerText()).includes("On in 2 of 2"));
  const mA = sql("SELECT id FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", IND, A).id;
  await page.reload({ waitUntil: "networkidle" });
  const text3 = await page.locator("body").innerText();
  check("U3c. the laboratory shows it beside its own", text3.includes("Contaminated blood cultures") && text3.includes("Made-up Health System indicator") && text3.includes("Clotted CBC specimens"));

  // U4
  await entryTab(page);
  check("U4a. it asks for a numerator and a denominator, and reads No entry until there is one", (await page.getByTestId(`qa-value-${mA}`).innerText()) === "No entry" && /Numerator: Contaminated sets\. Denominator: Sets collected/.test(await page.getByTestId(`qa-org-${mA}`).innerText()) && /Target: At most 3%/.test(await page.getByTestId(`qa-org-${mA}`).innerText()));
  await page.getByTestId(`qa-numerator-${mA}`).fill("12");
  await page.getByTestId(`qa-denominator-${mA}`).fill("300");
  check("U4b. the value is worked out as it is typed", (await page.getByTestId(`qa-value-${mA}`).innerText()) === "4%");
  await page.getByRole("button", { name: "Save All" }).click();
  await page.waitForTimeout(1200);
  const saved = sql("SELECT * FROM pi_entries WHERE metric_id = ? AND year = ? AND month = ?", mA, YEAR, MONTH);
  check("U4c. saved with the target it was entered under", saved?.value === 4 && saved?.numerator === 12 && saved?.denominator === 300 && saved?.target_value === 3 && saved?.lab_id === A, JSON.stringify(saved));
  await page.reload({ waitUntil: "networkidle" });
  await entryTab(page);
  check("U4d. ... and shown again after a reload", (await page.getByTestId(`qa-numerator-${mA}`).inputValue()) === "12");
  await page.screenshot({ path: `${OUT}/b15_data_entry_light.png`, fullPage: true });

  // U5
  await call("POST", "/api/rollup-groups", { name: "North region", kind: "region", organizationId: ORG, labIds: [A] }, LEADER.token);
  await lead.goto(`${BASE}/labs/${A}/readiness/quality?org=${ORG}`, { waitUntil: "networkidle" });
  const rowB = lead.getByTestId(`system-quality-row-${IND}-${B}`), rowA = lead.getByTestId(`system-quality-row-${IND}-${A}`);
  await rowA.waitFor({ timeout: 20000 });
  const clean = async (l) => (await l.innerText()).replace(/\s+/g, " ").trim();
  check("U5a. a laboratory that entered: numerator, denominator, value, target, Missed", /12 300 4% At most 3% Missed 1 of 1/.test(await clean(rowA)), await clean(rowA));
  check("U5b. one that didn't: No entry, neither met nor missed", /No entry At most 3% No entry 0 of 1/.test(await clean(rowB)), await clean(rowB));
  check("U5c. the total is from the sums and says how many laboratories it counts", /Total \(1 of 2 with an entry\) 12 300 4%/.test(await clean(lead.getByTestId(`system-quality-total-${IND}`))));
  const mB = sql("SELECT id FROM pi_metrics WHERE org_indicator_id = ? AND lab_id = ?", IND, B).id;
  await call("POST", `/api/labs/${B}/veritaqa/pi/entries`, { metric_id: mB, year: YEAR, month: MONTH, numerator: 1, denominator: 100 }, OWNER.token);
  await lead.reload({ waitUntil: "networkidle" });
  await rowA.waitFor({ timeout: 20000 });
  check("U5d. both entered: 13 of 400 is 3.25%, not the average of 4% and 1%", /Total \(2 of 2 with an entry\) 13 400 3\.25%/.test(await clean(lead.getByTestId(`system-quality-total-${IND}`))), await clean(lead.getByTestId(`system-quality-total-${IND}`)));
  await lead.getByTestId("qa-report-period").selectOption("year");
  await lead.waitForTimeout(900);
  check("U5e. the year", /of 12/.test(await clean(rowA)));
  await lead.getByTestId("qa-report-period").selectOption("month");
  await lead.waitForTimeout(900);
  await lead.screenshot({ path: `${OUT}/b15_system_report_light.png`, fullPage: true });
  await lead.getByTestId("system-quality-group").selectOption({ label: "North region (1)" });
  await lead.waitForTimeout(900);
  check("U5f. a group takes laboratories away", (await rowB.count()) === 0 && /Total \(1 of 1 with an entry\) 12 300/.test(await clean(lead.getByTestId(`system-quality-total-${IND}`))));
  await lead.getByTestId("system-quality-group").selectOption("");
  await lead.getByTestId("system-quality-department").selectOption("Microbiology");
  await lead.waitForTimeout(700);
  check("U5g. a department filter", await rowA.isVisible());
  check("U5h. PDF and Excel download", /^VeritaQA_System_Report_Made-up_Health_System_.*\.pdf$/.test(await downloads(lead, "system-quality-pdf")) && /\.xlsx$/.test(await downloads(lead, "system-quality-xlsx")));

  // U6
  await lead.getByTestId("system-quality-tab-indicators").click();
  await lead.getByTestId(`system-quality-edit-${IND}`).click();
  await lead.getByTestId("oq-target").fill("2");
  await lead.getByTestId("oq-save").click();
  await lead.getByTestId("system-quality-form").waitFor({ state: "detached", timeout: 15000 });
  await lead.waitForTimeout(500);
  check("U6a. the change is version 2, with the month it starts in", /2 versions/.test(await lead.getByTestId(`system-quality-definition-${IND}`).innerText()) && sql("SELECT effective_from FROM org_quality_indicator_versions WHERE indicator_id = ? AND version = 2", IND).effective_from === `${YEAR}-${String(MONTH).padStart(2, "0")}`);
  check("U6b. the entry on file keeps the target it was entered under", sql("SELECT target_value FROM pi_entries WHERE id = ?", saved.id).target_value === 3);
  await lead.screenshot({ path: `${OUT}/b15_indicators_light.png`, fullPage: true });

  // U7
  await page.getByTestId("qa-tab-report").click();
  await page.getByTestId("qa-report-summary").waitFor({ timeout: 20000 });
  const rep = await page.getByTestId("qa-lab-report").innerText();
  check("U7a. the month: every indicator, its result or No entry", /Contaminated blood cultures/.test(rep) && /Clotted CBC specimens/.test(rep) && /Missed/.test(rep) && /No entry/.test(rep) && /12 \/ 300/.test(rep) && /At most 3%/.test(await page.getByTestId(`qa-report-row-${mA}`).innerText()), rep.slice(0, 500));
  await page.screenshot({ path: `${OUT}/b15_lab_report_light.png`, fullPage: true });
  await page.getByTestId("qa-report-period").selectOption("quarter");
  await page.waitForTimeout(800);
  check("U7b. the quarter has a period total only for what was counted", /Period total/.test(await page.getByTestId("qa-lab-report").innerText()));
  await page.getByTestId("qa-report-period").selectOption("year");
  await page.waitForTimeout(800);
  const yr = await page.getByTestId(`qa-report-row-${wide}`).innerText();
  check("U7c. the year lists the months and averages nothing", /1\.4/.test(yr) && /Met 3 of 5/.test(yr) && !/2\.06/.test(yr), yr);
  const cells = await page.getByTestId(`qa-report-row-${wide}`).locator("td").allTextContents();
  check("U7e. a missed month reads M beside its number, a watch W, an empty one No entry", /^3\.6M/.test(cells[4]) && /^2\.2W/.test(cells[5]) && cells[2] === "1.4" && cells[7] === "No entry", JSON.stringify(cells));
  const lefts = await page.getByTestId("qa-lab-report").locator("thead tr").evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => Math.round(c.getBoundingClientRect().left)).join(",")));
  check("U7f. every department's columns are at the same places", lefts.length >= 3 && new Set(lefts).size === 1, JSON.stringify(lefts));
  const spill = await page.getByTestId("qa-lab-report").locator("td").evaluateAll((tds) => tds.filter((t) => t.scrollWidth > t.clientWidth + 1).map((t) => t.textContent));
  check("U7g. nothing runs over its cell", spill.length === 0, JSON.stringify(spill));
  await page.screenshot({ path: `${OUT}/b15_lab_report_year_light.png`, fullPage: true });
  check("U7d. PDF and Excel download", /^VeritaQA_Report_Made-up_North_Hospital_Laboratory_\d{4}\.pdf$/.test(await downloads(page, "qa-report-pdf")) && /\.xlsx$/.test(await downloads(page, "qa-report-xlsx")));

  // U8
  await entryTab(page);
  await page.getByTestId(`qa-findings-${own}`).click();
  await page.getByTestId("qa-findings-dialog").waitFor();
  await page.getByTestId(`qa-link-${finding}`).click();
  await page.getByTestId(`qa-unlink-${finding}`).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/b15_findings_light.png` });
  await page.keyboard.press("Escape");
  check("U8a. the finding shows on the indicator's row", (await page.getByTestId(`qa-links-${own}`).innerText()).includes("CAP 2026-04 Made-up item 7"));
  await page.goto(`${BASE}/labs/${A}/veritaresponse/${finding}`, { waitUntil: "networkidle" });
  await page.getByTestId("finding-indicators").waitFor({ timeout: 20000 });
  const card = await page.getByTestId("finding-indicators").innerText();
  check("U8b. the indicator's month shows on the finding", /Clotted CBC specimens/.test(card) && /3\.1%, target at most 1%/.test(card) && /Missed/.test(card), card);
  check("U8c. nothing was opened by itself", sql("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n === 1);

  // U9
  await page.goto(`${BASE}/labs/${B}/veritabench/pi`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.getByTestId("pi-plan-scope").waitFor({ timeout: 15000 });
  check("U9a. the account-wide plan says it covers every laboratory", /account-wide plan\. It covers every laboratory on the account/.test(await page.getByTestId("pi-plan-scope").innerText()));
  await page.getByTestId("pi-plan-start-lab").click();
  await page.getByRole("button", { name: "Start the plan" }).click();
  await page.getByTestId("pi-plan-scope-account").waitFor({ timeout: 15000 });
  check("U9b. the laboratory starts its own, blank, and can still open the account-wide one", sql("SELECT COUNT(*) AS n FROM pi_plan WHERE lab_id = ?", B).n === 1 && sql("SELECT title FROM pi_plan WHERE lab_id = ?", B).title === null);
  await page.getByTestId("pi-plan-scope-account").click();
  await page.waitForTimeout(800);
  check("U9c. ... which is as it was", (await page.locator("input[placeholder='Laboratory Performance Improvement Plan']").inputValue()) === "Laboratory quality plan");

  // U10
  const refused = await openAs(OWNER, A, `/labs/${A}/readiness/quality`);
  await refused.getByTestId("system-quality-refused").waitFor({ timeout: 20000 });
  check("U10a. a laboratory's owner who doesn't run the system is refused", /owner or an admin of a system/.test(await refused.getByTestId("system-quality-refused").innerText()));
  await refused.goto(`${BASE}/veritabench/pi`, { waitUntil: "networkidle" });
  await refused.waitForTimeout(800);
  check("U10b. the older address opens the person's laboratory", /\/labs\/\d+\/veritabench\/pi/.test(refused.url()), refused.url());
  await refused.context().close();

  // U11
  const darkSys = await openAs(LEADER, A, `/labs/${A}/readiness/quality?org=${ORG}`, { colorScheme: "dark" });
  await darkSys.getByTestId(`system-quality-row-${IND}-${A}`).waitFor({ timeout: 20000 });
  await darkSys.screenshot({ path: `${OUT}/b15_system_report_dark.png`, fullPage: true });
  await darkSys.getByTestId("system-quality-tab-indicators").click();
  await darkSys.waitForTimeout(300);
  await darkSys.screenshot({ path: `${OUT}/b15_indicators_dark.png`, fullPage: true });
  await darkSys.context().close();
  const darkLab = await openAs(OWNER, A, `/labs/${A}/veritabench/pi`, { colorScheme: "dark" });
  await entryTab(darkLab);
  await darkLab.waitForTimeout(500);
  await darkLab.screenshot({ path: `${OUT}/b15_data_entry_dark.png`, fullPage: true });
  await darkLab.getByTestId("qa-tab-report").click();
  await darkLab.getByTestId("qa-report-summary").waitFor({ timeout: 20000 });
  await darkLab.screenshot({ path: `${OUT}/b15_lab_report_dark.png`, fullPage: true });
  await darkLab.getByTestId("qa-report-period").selectOption("year");
  await darkLab.waitForTimeout(800);
  await darkLab.screenshot({ path: `${OUT}/b15_lab_report_year_dark.png`, fullPage: true });
  await darkLab.context().close();
  const phone = { viewport: { width: 390, height: 844 } };
  const pSys = await openAs(LEADER, A, `/labs/${A}/readiness/quality?org=${ORG}`, phone);
  await pSys.getByTestId(`system-quality-row-${IND}-${A}`).waitFor({ timeout: 20000 });
  check("U11a. phone: the system report doesn't scroll the page sideways", await noSideScroll(pSys));
  await pSys.screenshot({ path: `${OUT}/b15_system_report_phone.png`, fullPage: false });
  await pSys.getByTestId("system-quality-tab-indicators").click();
  await pSys.waitForTimeout(300);
  check("U11b. ... nor does the indicators view", await noSideScroll(pSys));
  await pSys.context().close();
  const pLab = await openAs(OWNER, A, `/labs/${A}/veritabench/pi`, phone);
  check("U11c. phone: VeritaQA's dashboard", await noSideScroll(pLab));
  await entryTab(pLab);
  check("U11d. ... Data Entry", await noSideScroll(pLab));
  await pLab.getByTestId("qa-tab-report").click();
  await pLab.getByTestId("qa-report-summary").waitFor({ timeout: 20000 });
  check("U11e. ... and the report", await noSideScroll(pLab));
  await pLab.context().close();
} catch (e) {
  check("the script ran to the end", false, String(e?.stack || e).slice(0, 900));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
