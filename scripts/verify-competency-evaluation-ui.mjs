// scripts/verify-competency-evaluation-ui.mjs
//
// Browser receipt for new-hire evaluations (2026-10-16, Sampson REQ-076: Natalie Lamb's 30, 60 and 90-day evaluations,
// one per job title, titled Evaluation instead of Competency). LOCAL production build + scratch DB only (the account,
// lab, staff member and records are local test data). Drives the real screens:
//   1. Header "New-hire evaluation": add a job title with its own items; Continue opens the evaluation form
//   2. The form: titled New-Hire Evaluation, 30/60/90-Day choices only, the due date from the hire date, Evaluation
//      Items, Satisfactory / Unsatisfactory; a new hire with no instrument can be picked; nothing says Competency
//   3. Save: the card shows 60-Day and Satisfactory; the program shows the New-Hire Evaluation badge
//   4. Download PDF from the card: a PDF downloads, named Evaluation
//   5. The New-hire evaluation button now offers the saved job title; the Non-technical competency button does not
//   6. light, dark and 390px; no horizontal page scroll
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-evaluation-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const PW = ["Zq", "eval", "7x!"].join("-");
const email = `evaluation-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id, token = reg.body?.token, user = reg.body?.user;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
let staffId = null;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
  const now = new Date().toISOString();
  const sl = Number(d.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'Riverside Regional Medical Center (QA)', '22D0999999', ?, ?, ?)").run(uid, now, now, lab).lastInsertRowid);
  // A new hire with no instrument assignment: the person a new-hire evaluation is for.
  staffId = Number(d.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, 'Rivera', 'Sam', 'Phlebotomist', '2026-10-01', 0, 'active', ?, ?, ?)").run(sl, uid, lab, now, now).lastInsertRowid);
});
check("0. QA owner, lab and a new hire (hired 2026-10-01, no instrument) on the scratch DB", !!uid && !!lab && !!token && staffId > 0);

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const csp = [];

let programId = null;
// 1-3) set up a job title, record a 60-day evaluation
{
  const { ctx, page } = await signedIn("light", 1280);
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId("quick-evaluation").click();
  const dlg = page.getByTestId("evaluation-dialog");
  await dlg.waitFor({ timeout: 10000 });
  check("1a. the New-hire evaluation dialog opens on 'Add a job title' when none is set up", (await page.getByTestId("evaluation-job-title").innerText()).includes("Add a job title"));
  await page.getByTestId("evaluation-new-title").fill("Phlebotomist");
  await page.getByTestId("evaluation-department").click();
  await page.getByRole("option", { name: "Phlebotomy", exact: true }).click();
  const ta = page.getByTestId("checklist-editor").locator("textarea");
  check("1b. Continue is held until the first item has text", await page.getByTestId("evaluation-continue").isDisabled());
  await ta.nth(0).fill("Patient identification: two identifiers before every draw");
  await page.getByTestId("checklist-add-item").click();
  await ta.nth(1).fill("Order of draw");
  await page.getByTestId("checklist-add-item").click();
  await ta.nth(2).fill("Specimen labeling at the bedside");
  await dlg.screenshot({ path: `${OUT}/evaluation-dialog-light.png` });
  await page.getByTestId("evaluation-continue").click();
  await page.waitForURL(/\/veritacomp-app\/\d+/, { timeout: 15000 });
  programId = Number(page.url().match(/veritacomp-app\/(\d+)/)[1]);
  const row = scratch((d) => d.prepare("SELECT name, type, record_kind, department FROM competency_programs WHERE id = ?").get(programId));
  check("1c. Continue sets up 'Phlebotomist new-hire evaluation' as an evaluation", row?.name === "Phlebotomist new-hire evaluation" && row?.record_kind === "evaluation" && row?.type === "nontechnical" && row?.department === "Phlebotomy", JSON.stringify(row));

  // 2) the form
  const form = page.getByRole("dialog");
  await form.getByText("Evaluation Items").waitFor({ timeout: 15000 });
  const title = await form.locator("h2").first().innerText();
  check("2a. the form is titled New-Hire Evaluation", title.trim() === "New-Hire Evaluation", title);
  await page.getByTestId("assessment-employee-select").click();
  const samOpt = page.getByRole("option", { name: /Sam Rivera/ });
  check("2b. the new hire with no instrument can be picked", (await samOpt.count()) === 1);
  await samOpt.click();
  await page.getByTestId("nt-assessment-type").click();
  const opts = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
  check("2c. the only choices are 30-Day, 60-Day and 90-Day", opts.join(",") === "30-Day,60-Day,90-Day", opts.join(","));
  await page.getByRole("option", { name: "60-Day", exact: true }).click();
  const dueText = await page.getByTestId("evaluation-due").innerText();
  check("2d. the due date is the hire date + 60 days (2026-11-30)", dueText.includes("Due 2026-11-30"), dueText);
  const formText = await form.innerText();
  check("2e. Evaluation Items, Evaluation Date, Satisfactory / Unsatisfactory on the form", formText.includes("Evaluation Items") && formText.includes("Evaluation Date") && formText.includes("Satisfactory") && formText.includes("Unsatisfactory") && formText.includes("Save Evaluation"));
  const comp = formText.match(/[^\n]{0,50}(competenc|non-technical)[^\n]{0,50}/i);
  check("2f. the form never says competency or non-technical", !comp, comp ? comp[0] : "");
  check("2g. no review period, no CLIA evaluator-title rule, no instrument wording on an evaluation", !formText.includes("Review Period") && !formText.includes("Technical Consultant required") && !formText.includes("this program's instruments"));
  await page.screenshot({ path: `${OUT}/evaluation-form-light.png`, fullPage: false });
  await page.getByTestId("assessment-save").click();
  await page.getByRole("dialog").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});

  // 3) the saved card and the badge
  await page.getByRole("button", { name: "Assessments" }).click().catch(() => {});
  // .last(): the innermost element holding both is the card itself, not the whole page.
  const card = page.locator("div").filter({ hasText: "Sam Rivera" }).filter({ hasText: "60-Day" }).last();
  await card.waitFor({ timeout: 15000 });
  const cardText = await card.innerText();
  check("3a. the saved evaluation shows 60-Day and Satisfactory", cardText.includes("60-Day") && cardText.includes("Satisfactory"), cardText.slice(0, 160));
  const header = await page.locator("h1").first().locator("..").innerText();
  check("3b. the program header shows the New-Hire Evaluation badge", header.includes("New-Hire Evaluation"), header.slice(0, 120));
  const saved = scratch((d) => d.prepare("SELECT assessment_type, status FROM competency_assessments WHERE program_id = ?").get(programId));
  check("3c. saved as a 60-day evaluation", saved?.assessment_type === "60day" && saved?.status === "pass", JSON.stringify(saved));
  await page.screenshot({ path: `${OUT}/evaluation-program-light.png` });

  // 4) PDF from the card
  const dlP = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
  await page.getByTestId("assessment-pdf").first().click();
  const dl = await dlP;
  const file = dl ? await dl.path().catch(() => null) : null;
  const head = file ? fs.readFileSync(file).subarray(0, 5).toString() : "";
  const name = dl ? dl.suggestedFilename() : "";
  if (file) fs.copyFileSync(file, `${OUT}/evaluation-sample.pdf`);
  check("4a. Download PDF delivers a PDF named Evaluation", head === "%PDF-" && /^VeritaComp_Evaluation_.+\.pdf$/.test(name), `${name} ${file ? fs.statSync(file).size : 0} bytes`);
  await ctx.close();
}

// 5) the buttons afterwards
{
  const { ctx, page } = await signedIn("light", 1280);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app`, { waitUntil: "networkidle" });
  const listText = await page.locator("main").innerText().catch(async () => await page.locator("body").innerText());
  check("5a. the program list shows the evaluation with its New-Hire Evaluation badge", listText.includes("Phlebotomist new-hire evaluation") && listText.includes("New-Hire Evaluation"));
  await page.getByTestId("quick-evaluation").click();
  await page.getByTestId("evaluation-dialog").waitFor({ timeout: 10000 });
  check("5b. New-hire evaluation now offers the saved job title first", (await page.getByTestId("evaluation-job-title").innerText()).includes("Phlebotomist new-hire evaluation"));
  await page.keyboard.press("Escape");
  await page.getByTestId("quick-nontechnical").click();
  await page.getByTestId("quick-department").click();
  await page.getByRole("option", { name: "Phlebotomy", exact: true }).click();
  const willCreate = await page.getByTestId("quick-will-create").count();
  check("5c. Non-technical competency does not treat the evaluation as Phlebotomy's competency", willCreate === 1);
  await ctx.close();
}

// 6) dark and 390px
for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await signedIn(scheme, width);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  await page.locator("h1").first().waitFor({ timeout: 10000 });
  check(`6a. [${scheme} ${width}px] the evaluation page has no horizontal page scroll`, await noScroll(page));
  await page.screenshot({ path: `${OUT}/evaluation-program-${scheme}-${width}.png` });
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId("quick-evaluation").click();
  await page.getByTestId("evaluation-job-title").click();
  await page.getByRole("option", { name: "Add a job title..." }).click();
  await page.getByTestId("evaluation-dialog").waitFor({ timeout: 10000 });
  check(`6b. [${scheme} ${width}px] the New-hire evaluation dialog has no horizontal page scroll`, await noScroll(page));
  await page.getByTestId("evaluation-dialog").screenshot({ path: `${OUT}/evaluation-dialog-${scheme}-${width}.png` });
  await ctx.close();
}

check("7. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
