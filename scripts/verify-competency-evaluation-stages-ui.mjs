// scripts/verify-competency-evaluation-stages-ui.mjs
//
// Browser receipt for new-hire evaluation stages (2026-10-19, Sampson REQ-076: Natalie Lamb's forms list different
// items for the 30, 60 and 90-day evaluations). LOCAL production build + scratch DB only (all records are local test
// data). Drives the real screens:
//   1. New-hire evaluation dialog: each item picks its stage (30-Day, 60-Day, 90-Day or Every stage)
//   2. The evaluation form shows the chosen stage's items plus the every-stage item, and changes with the stage
//   3. Saving a 30-day evaluation keeps only the items it showed
//   4. The Overview checklist shows each item's stage; Edit checklist keeps the stage pickers
//   5. light, dark and 390px; no horizontal page scroll; no CSP violations
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-evaluation-stages-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const PW = ["Zq", "stage", "7x!"].join("-");
const email = `eval-stages-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id, token = reg.body?.token, user = reg.body?.user;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
let staffId = null;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
  const now = new Date().toISOString();
  const sl = Number(d.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'Riverside Regional Medical Center (QA)', '22D0999999', ?, ?, ?)").run(uid, now, now, lab).lastInsertRowid);
  staffId = Number(d.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, 'Rivera', 'Sam', 'Lab Assistant', '2026-10-01', 0, 'active', ?, ?, ?)").run(sl, uid, lab, now, now).lastInsertRowid);
});
check("0. QA owner, lab and a new hire on the scratch DB", !!uid && !!lab && !!token && staffId > 0);

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const pickStage = async (page, i, name) => { await page.getByTestId(`checklist-stage-${i}`).click(); await page.getByRole("option", { name, exact: true }).click(); };
const csp = [];
const ITEMS = [["Orientation checklist", "30-Day"], ["Second department", "60-Day"], ["Waived testing", "90-Day"], ["Review error log", "Every stage"]];

let programId = null;
{
  const { ctx, page } = await signedIn("light", 1280);
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId("quick-evaluation").click();
  const dlg = page.getByTestId("evaluation-dialog");
  await dlg.waitFor({ timeout: 10000 });
  await page.getByTestId("evaluation-new-title").fill("Lab Assistant");
  const ta = page.getByTestId("checklist-editor").locator("textarea");
  for (let i = 0; i < ITEMS.length; i++) {
    if (i > 0) await page.getByTestId("checklist-add-item").click();
    await ta.nth(i).fill(ITEMS[i][0]);
    if (ITEMS[i][1] !== "Every stage") await pickStage(page, i, ITEMS[i][1]);
  }
  const shown = await Promise.all(ITEMS.map((_, i) => page.getByTestId(`checklist-stage-${i}`).innerText()));
  check("1a. each item shows its stage picker with the chosen stage", shown.map((s) => s.trim()).join(",") === "30-Day,60-Day,90-Day,Every stage", shown.join(","));
  await dlg.screenshot({ path: `${OUT}/stages-dialog-light.png` });
  await page.getByTestId("evaluation-continue").click();
  await page.waitForURL(/\/veritacomp-app\/\d+/, { timeout: 15000 });
  programId = Number(page.url().match(/veritacomp-app\/(\d+)/)[1]);
  const rows = scratch((d) => d.prepare("SELECT label, description, stage FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(programId));
  check("1b. the stages are saved with the job title", rows.map((r) => `${r.label}:${r.stage ?? "-"}`).join(",") === "A:30day,B:60day,C:90day,D:-", JSON.stringify(rows));

  const form = page.getByRole("dialog");
  await form.getByText("Evaluation Items").waitFor({ timeout: 15000 });
  const itemsTable = form.locator("table").filter({ hasText: "Date Met" });
  const itemText = async () => (await itemsTable.innerText()).replace(/\s+/g, " ");
  const t30 = await itemText();
  check("2a. the 30-day form shows Orientation checklist and Review error log only", t30.includes("Orientation checklist") && t30.includes("Review error log") && !t30.includes("Second department") && !t30.includes("Waived testing"), t30.slice(0, 200));
  await page.getByTestId("nt-assessment-type").click();
  await page.getByRole("option", { name: "60-Day", exact: true }).click();
  const t60 = await itemText();
  check("2b. switching to 60-Day shows Second department and Review error log only", t60.includes("Second department") && t60.includes("Review error log") && !t60.includes("Orientation checklist") && !t60.includes("Waived testing"), t60.slice(0, 200));
  await page.getByTestId("nt-assessment-type").click();
  await page.getByRole("option", { name: "90-Day", exact: true }).click();
  const t90 = await itemText();
  check("2c. switching to 90-Day shows Waived testing and Review error log only", t90.includes("Waived testing") && t90.includes("Review error log") && !t90.includes("Orientation checklist") && !t90.includes("Second department"), t90.slice(0, 200));
  await page.getByTestId("nt-assessment-type").click();
  await page.getByRole("option", { name: "30-Day", exact: true }).click();
  await page.getByTestId("assessment-employee-select").click();
  await page.getByRole("option", { name: /Sam Rivera/ }).click();
  await page.screenshot({ path: `${OUT}/stages-form-30day-light.png` });
  await page.getByTestId("assessment-save").click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const saved = scratch((d) => {
    const a = d.prepare("SELECT id, assessment_type FROM competency_assessments WHERE program_id = ?").get(programId);
    const it = a ? d.prepare("SELECT nt_item_label, nt_item_description FROM competency_assessment_items WHERE assessment_id = ? ORDER BY id").all(a.id) : [];
    return { type: a?.assessment_type, items: it.map((r) => `${r.nt_item_label}:${r.nt_item_description}`) };
  });
  check("3a. the saved 30-day evaluation keeps only the two items it showed", saved.type === "30day" && saved.items.join("|") === "A:Orientation checklist|D:Review error log", JSON.stringify(saved));

  await page.getByRole("button", { name: "Overview" }).click().catch(() => {});
  const card = page.getByTestId("checklist-card");
  await card.waitFor({ timeout: 10000 });
  const badges = await Promise.all(["A", "B", "C", "D"].map((l) => page.getByTestId(`checklist-stage-badge-${l}`).innerText().catch(() => "")));
  check("4a. the Overview checklist shows each item's stage", badges.map((b) => b.trim()).join(",") === "30-Day,60-Day,90-Day,Every stage", badges.join(","));
  await card.screenshot({ path: `${OUT}/stages-overview-light.png` });
  await page.getByTestId("checklist-edit").click();
  check("4b. Edit checklist keeps the stage pickers", (await page.getByTestId("checklist-stage-1").innerText()).trim() === "60-Day");
  await ctx.close();
}

for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await signedIn(scheme, width);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Overview" }).click().catch(() => {});
  await page.getByTestId("checklist-card").waitFor({ timeout: 10000 });
  await page.getByTestId("checklist-edit").click();
  await page.getByTestId("checklist-stage-0").waitFor({ timeout: 10000 });
  check(`5a. [${scheme} ${width}px] the checklist editor with stage pickers has no horizontal page scroll`, await noScroll(page));
  const ta = await page.getByTestId("checklist-editor").locator("textarea").first().evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, bottom: r.bottom }; });
  const pick = await page.getByTestId("checklist-stage-0").evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, top: r.top }; });
  // Narrow screens: the picker drops under the text and both take the row's width; wide screens: side by side.
  const ok = width < 640 ? pick.top >= ta.bottom - 1 && Math.abs(pick.w - ta.w) <= 2 && ta.w >= 150 : ta.w >= 300;
  check(`5c. [${scheme} ${width}px] the item text keeps the row's width (picker ${width < 640 ? "below it" : "beside it"})`, ok, `text ${Math.round(ta.w)}px, picker ${Math.round(pick.w)}px`);
  await page.getByTestId("checklist-card").screenshot({ path: `${OUT}/stages-overview-edit-${scheme}-${width}.png` });
  await ctx.close();
}

check("5b. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
