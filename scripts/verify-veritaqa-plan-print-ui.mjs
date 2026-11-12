// scripts/verify-veritaqa-plan-print-ui.mjs
//
// Browser receipt (Gate 3 step 8) for printing VeritaQA's PI plan (SCAHC 2026-11-12: Chineme "cannot export the plan";
// the Plan tab had no export). On a local production build with a scratch DB and a made-up owner, lab, plan, departments,
// indicators, priority and review, written through the app's own routes, never production:
//   P1. the Plan tab shows "Print / Save as PDF" once a plan is saved, and clicking it opens the browser's print
//   P2. on screen the printed layout stays hidden; in print it is the only thing on the page
//   P3. the printout carries the plan's title, the lab's name and CLIA, the effective year and every plan section
//   P4. every active indicator, by department in the list's order with its count, goal (≤ or ≥, TAT minutes) and how
//       it's measured; an inactive indicator is left out
//   P5. the improvement priority and the leadership review print; no em dash anywhere in the printout
//   P6. a typed change not yet saved shows the note and stays out of the printout
//   P7. the browser saves it as a PDF (OUT/qa-plan-print.pdf)
// Run: PW_BASE=http://localhost:5254 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritaqa-plan-print-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Qa", "Plan", "77!"].join("-");
const stamp = Date.now();

let LAB = 0;
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(token && LAB ? { "X-Active-Lab-Id": String(LAB) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};

const email = `qa-plan-ui-owner-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: pw, name: "Made-up Owner Ashcombe", hipaa_acknowledged: true });
const OWNER = { email, token: reg.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Plan Print Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790015', time_zone = 'America/New_York' WHERE id = ?", LAB);

// Made-up plan, through the module's own routes.
const T = OWNER.token;
const savedPlan = await call("PUT", "/api/pi/plan", {
  title: "Made-up QA/QI Plan", effective_year: 2027,
  program_scope: "Both made-up sites, all sections.", measurement_methods: "Monthly counts from saved reports.",
  analysis_methods: "Each month against its goal.", remediation_methods: "An action plan when a goal is missed.",
  monitor_sustain_methods: "Three months at goal before closing.",
}, T);
const planId = savedPlan.body?.id; // PUT /api/pi/plan answers with the plan row
const dept = async (name, sort_order) => (await call("POST", "/api/pi/departments", { name, sort_order }, T)).body.id;
const metric = async (department_id, name, extra) =>
  (await call("POST", "/api/pi/metrics", { department_id, name, unit: "%", direction: "lower_is_better", ...extra }, T)).body.id;
const D = { chem: await dept("San Carlos: Chemistry", 0), heme: await dept("Bylas: Hematology", 1) };
const M = {
  hemo: await metric(D.chem, "Hemolysis rate", { benchmark_green: 2, measurement_methodology: "Hemolyzed rejections / chemistry specimens received." }),
  tat: await metric(D.chem, "STAT potassium TAT", { direction: "higher_is_better", benchmark_green: 90, is_tat: true, tat_start_event: "Received", tat_end_event: "Verified", tat_threshold_minutes: 45, measurement_methodology: "Meditech TAT report." }),
  old: await metric(D.chem, "Retired made-up indicator", { benchmark_green: 1 }),
  clot: await metric(D.heme, "Clotted CBCs", { benchmark_green: 1, benchmark_yellow: 2, measurement_methodology: "Clotted CBC rejections / CBCs received." }),
};
await call("PUT", `/api/pi/metrics/${M.old}`, { active: 0 }, T);
await call("POST", "/api/pi/plan/priorities", { plan_id: planId, process_name: "Critical value calls", goal: "Within 30 minutes", linked_department_id: D.chem, sort_order: 0 }, T);
await call("POST", "/api/pi/plan/reviews", { plan_id: planId, reviewed_by: "Made-up Director", reviewer_title: "Medical Director", review_date: "2026-11-01", changes_summary: "Adopted for 2027." }, T);
check("setup: a made-up plan, 2 departments, 4 indicators (1 inactive), a priority and a review",
  !!planId && Object.values(D).every((x) => x > 0) && Object.values(M).every((x) => x > 0) && Number(sql("SELECT active FROM pi_metrics WHERE id = ?", M.old)?.active) === 0,
  JSON.stringify({ planId, D, M }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; return page.goto(url, opts); } };

try {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, T]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, LAB]);
  await go(page, `${BASE}/labs/${LAB}/veritabench/pi`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Plan" }).click();
  const btn = page.getByTestId("pi-plan-print");
  await btn.waitFor({ timeout: 20000 });
  await page.getByTestId("pi-plan-print-area").getByText("Clotted CBCs", { exact: true }).waitFor({ state: "attached", timeout: 20000 });

  // P1.
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  check("P1a. the Plan tab shows Print / Save as PDF", (await btn.innerText()).trim() === "Print / Save as PDF");
  await btn.click();
  check("P1b. clicking it opens the browser's print", (await page.evaluate(() => window.__printCalls)) === 1);
  await page.screenshot({ path: `${OUT}/qa-plan-tab-button.png`, fullPage: false });

  // P2.
  const area = page.getByTestId("pi-plan-print-area");
  check("P2a. on screen the printed layout stays hidden", !(await area.isVisible()));
  await page.emulateMedia({ media: "print" });
  check("P2b. in print the layout shows", await area.isVisible());
  const navVisible = await page.evaluate(() => { const n = document.querySelector("nav, header"); return n ? getComputedStyle(n).visibility : "none"; });
  check("P2c. in print the site's navigation is hidden", navVisible === "hidden" || navVisible === "none", navVisible);

  // P3.
  const text = (await area.innerText()).replace(/\s+/g, " ");
  check("P3a. the plan's title, the lab's name and CLIA, and the effective year",
    text.includes("Made-up QA/QI Plan") && text.includes("Made-up Plan Print Lab") && text.includes("CLIA: 22D7790015") && text.includes("Effective 2027"), text.slice(0, 300));
  check("P3b. every plan section with its saved text",
    ["Program scope Both made-up sites, all sections.", "Measurement methods Monthly counts from saved reports.", "Analysis methods Each month against its goal.",
     "Remediation methods An action plan when a goal is missed.", "Monitor and sustain methods Three months at goal before closing."].every((s) => text.includes(s)), text.slice(0, 900));

  // P4.
  const deptHeads = await area.locator("[data-testid^='pi-plan-print-dept-'] h3").allInnerTexts();
  check("P4a. indicators by department, in the list's order, each with its count; 3 active in all",
    JSON.stringify(deptHeads.map((s) => s.trim())) === JSON.stringify(["San Carlos: Chemistry (2)", "Bylas: Hematology (1)"]) && text.includes("Quality indicators (3)"), JSON.stringify(deptHeads));
  const rows = await area.locator("[data-testid^='pi-plan-print-dept-'] tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())));
  check("P4b. each row: indicator, unit, goal (≤ / ≥, yellow, TAT minutes) and how it's measured", JSON.stringify(rows) === JSON.stringify([
    ["Hemolysis rate", "%", "≤ 2", "Hemolyzed rejections / chemistry specimens received."],
    ["STAT potassium TAT", "%", "≥ 90; within 45 min", "Meditech TAT report."],
    ["Clotted CBCs", "%", "≤ 1; yellow ≤ 2", "Clotted CBC rejections / CBCs received."],
  ]), JSON.stringify(rows));
  check("P4c. the inactive indicator is left out", !text.includes("Retired made-up indicator"));

  // P5.
  check("P5a. the improvement priority prints with its goal and department", text.includes("Critical value calls") && text.includes("Goal: Within 30 minutes") && text.includes("Department: San Carlos: Chemistry"));
  check("P5b. the leadership review prints", text.includes("Made-up Director") && text.includes("Medical Director") && text.includes("2026-11-01") && text.includes("Adopted for 2027.") && text.includes("2027-11-01"), text.slice(-500));
  check("P5c. the footer, and no em dash anywhere in the printout", text.includes("VeritaAssure® | VeritaQA™ | Confidential, For Internal Lab Use Only") && !text.includes("—"));

  // P7 (before P6 edits the form).
  const pages = (buf) => (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const pdf1 = await page.pdf({ path: `${OUT}/qa-plan-print.pdf`, format: "Letter", printBackground: true });
  await page.screenshot({ path: `${OUT}/qa-plan-print-media.png`, fullPage: true });
  check("P7a. the browser saves it as a PDF of exactly 1 page (no blank pages after the plan)", pages(pdf1) === 1, `pages=${pages(pdf1)}`);

  // P6.
  await page.emulateMedia({ media: "screen" });
  await page.locator("textarea").first().fill("Typed and not saved.");
  check("P6a. a typed change not yet saved shows the note", (await page.getByTestId("pi-plan-print-unsaved").innerText()).trim() === "Save the plan to include your changes in the printout.");
  await page.emulateMedia({ media: "print" });
  const after = (await area.innerText()).replace(/\s+/g, " ");
  check("P6b. ... and the printout keeps the saved text", after.includes("Both made-up sites, all sections.") && !after.includes("Typed and not saved."));

  // P7b. A plan the size of SCAHC's (54 indicators across 10 departments) breaks across pages and ends with the footer.
  for (let d = 0; d < 8; d++) {
    const id = await dept(`Made-up Site: Section ${d + 1}`, d + 2);
    for (let i = 0; i < 6; i++) await metric(id, `Made-up indicator ${d + 1}.${i + 1}`, { benchmark_green: 5, measurement_methodology: "Made-up numerator / made-up denominator, from a saved monthly report." });
  }
  await page.emulateMedia({ media: "screen" });
  await go(page, `${BASE}/labs/${LAB}/veritabench/pi`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Plan" }).click();
  await page.getByTestId("pi-plan-print").waitFor({ timeout: 20000 });
  // The Plan tab reads each department's indicators after it opens; wait for the last one rather than for the network.
  await area.getByText("Made-up indicator 8.6", { exact: true }).waitFor({ state: "attached", timeout: 20000 });
  await page.emulateMedia({ media: "print" });
  const big = (await area.innerText()).replace(/\s+/g, " ");
  const pdf2 = await page.pdf({ path: `${OUT}/qa-plan-print-long.pdf`, format: "Letter", printBackground: true });
  check("P7b. a 51-indicator plan prints every indicator, ending with the footer", big.includes("Quality indicators (51)") && big.includes("Made-up indicator 8.6") && /Confidential, For Internal Lab Use Only$/.test(big.trim()), big.slice(-200));
  check("P7c. ... across 3 to 5 pages, with no blank pages after", pages(pdf2) >= 3 && pages(pdf2) <= 5, `pages=${pages(pdf2)}`);
} finally {
  await browser.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
