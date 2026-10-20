// scripts/verify-new-hire-eval-person-hire-date-ui.mjs
//
// Browser receipt for BUG-090 (Sampson, 2026-10-20). Natalie Lamb: "For the new hire evals, it's not pulling in the
// hire date from the staff tab. I entered some partial info in on Natalie Edge ... and now I cannot find it." The
// form had preselected the first name on the list (the entry was filed under another employee), and the hire date
// came from a stale VeritaComp copy. LOCAL production build + scratch DB only (all records are local test data).
// Drives the real screens:
//   1. a new evaluation opens with NO person chosen ("Choose a person...") and Save disabled
//   2. choosing the new hire fills Date of Hire from VeritaStaff (the VeritaComp copy is blank, as at Sampson) and
//      shows the due date
//   3. a partly filled evaluation saves under the chosen person, and its card reads "In progress", not Satisfactory
//   4. light, dark and 390px; no horizontal page scroll; no CSP violations
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-new-hire-eval-person-hire-date-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const PW = ["Zq", "hire", "7x!"].join("-");
const email = `eval-hire-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id, token = reg.body?.token, user = reg.body?.user;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
let samStaff = null, samComp = null;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
  const now = new Date().toISOString();
  const sl = Number(d.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'Riverside Regional Medical Center (QA)', '22D0999999', ?, ?, ?)").run(uid, now, now, lab).lastInsertRowid);
  // Alphabetically first person, as Amanda Tyndall was at Sampson: the old form preselected her.
  d.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, 'Abbott', 'Amanda', 'Lab Tech', '2024-03-01', 1, 'active', ?, ?, ?)").run(sl, uid, lab, now, now);
  samStaff = Number(d.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, 'Rivera', 'Sam', 'Lab Assistant', '2026-10-19', 1, 'active', ?, ?, ?)").run(sl, uid, lab, now, now).lastInsertRowid);
  // The Sampson shape: Sam's VeritaComp row was bridged before the VeritaStaff hire date existed, so its copy is blank.
  samComp = Number(d.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, lis_initials, status, created_at, staff_employee_id) VALUES (?, ?, 'Sam Rivera', '', NULL, NULL, 'active', ?, ?)").run(uid, lab, now, samStaff).lastInsertRowid);
});
const prog = await call("POST", `/api/labs/${lab}/competency/programs`, { name: "Lab Assistant new-hire evaluation", department: "Specimen Processing", type: "nontechnical", recordKind: "evaluation",
  checklistItems: [{ description: "Orientation checklist", stage: "30day" }, { description: "Department training sign-off", stage: "30day" }, { description: "Second department", stage: "60day" }] }, token, lab);
const programId = Number(prog.body?.id);
check("0. QA owner, lab, two VeritaStaff people (one with a blank VeritaComp hire date) and an evaluation", !!uid && !!lab && samComp > 0 && programId > 0);

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const csp = [];

{
  const { ctx, page } = await signedIn("light", 1280);
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}?newAssessment=1`, { waitUntil: "networkidle" });
  const form = page.getByRole("dialog");
  await form.getByText("Evaluation Items").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500); // let the roster list arrive: the old form preselected once it did
  const picker = (await page.getByTestId("assessment-employee-select").innerText()).trim();
  const saveDisabled = await page.getByTestId("assessment-save").isDisabled();
  check("1a. a new evaluation opens with no person chosen", /Choose a person/.test(picker), picker);
  check("1b. Save Evaluation stays disabled until a person is chosen", saveDisabled === true);
  await form.screenshot({ path: `${OUT}/eval-no-person-light.png` });

  await page.getByTestId("assessment-employee-select").click();
  await page.getByRole("option", { name: /Sam Rivera/ }).click();
  const hire = await form.locator("label", { hasText: "Date of Hire" }).locator("xpath=following-sibling::input").inputValue();
  const formText = (await form.innerText()).replace(/\s+/g, " ");
  check("2a. Date of Hire comes from VeritaStaff (the VeritaComp copy is blank)", hire === "2026-10-19", hire);
  check("2b. the due date shows, counted from the hire date", /Due .{0,20}from the hire date/.test(formText), (formText.match(/Due .{0,40}hire date/) || [""])[0]);

  // Fill the first item only, so the evaluation is part done.
  const row = form.locator("table").filter({ hasText: "Date Met" }).locator("tbody tr").first();
  await row.locator("input[type=date]").fill("2026-10-20");
  const inits = row.locator("input[placeholder=Init]");
  await inits.nth(0).fill("SR");
  await inits.nth(1).fill("NL");
  await form.screenshot({ path: `${OUT}/eval-sam-partial-light.png` });
  await page.getByTestId("assessment-save").click();
  await form.waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const saved = scratch((d) => d.prepare("SELECT a.id, a.employee_id, e.name FROM competency_assessments a JOIN competency_employees e ON e.id = a.employee_id WHERE a.program_id = ?").all(programId));
  check("3a. the partial evaluation saved once, under Sam Rivera (not the first name on the list)", saved.length === 1 && saved[0].employee_id === samComp, JSON.stringify(saved));
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" }); // without ?newAssessment=1, which reopens the form
  await page.getByRole("button", { name: "Assessments" }).click();
  await page.getByText("Sam Rivera").first().waitFor({ timeout: 10000 });
  const cardText = (await page.locator("[class*=rounded]").filter({ hasText: "Sam Rivera" }).filter({ hasText: /In progress|Satisfactory/ }).last().innerText()).replace(/\s+/g, " ");
  check("3b. the part-done evaluation reads In progress, not Satisfactory", /In progress/.test(cardText) && !/Satisfactory/.test(cardText), cardText.slice(0, 120));
  const itemsBox = (await page.getByTestId("assessment-card-items").first().innerText()).replace(/\s+/g, " ");
  const pageText = (await page.locator("main, body").first().innerText()).replace(/\s+/g, " ");
  check("3f. the card lists the evaluation's own items: A Met with its date, B Not yet",
    /Evaluation items/.test(itemsBox) && /Orientation checklist Met 2026-10-20/.test(itemsBox) && /Department training sign-off Not yet/.test(itemsBox), itemsBox.slice(0, 160));
  check("3g. an evaluation card no longer shows the 6 CLIA competency elements", !/6 CLIA Competency Elements/.test(pageText));
  await page.screenshot({ path: `${OUT}/eval-in-progress-light.png` });

  // Reopen with Edit: the finished item keeps its entries; the unfinished item stays blank (no stamped date or initials).
  await page.getByTestId("edit-assessment").first().click();
  const editForm = page.getByRole("dialog");
  await editForm.getByText("Evaluation Items").waitFor({ timeout: 15000 });
  const rows = editForm.locator("table").filter({ hasText: "Date Met" }).locator("tbody tr");
  const rowVals = async (i) => {
    const r = rows.nth(i);
    return [await r.locator("input[type=date]").inputValue(), await r.locator("input[placeholder=Init]").nth(0).inputValue(), await r.locator("input[placeholder=Init]").nth(1).inputValue()].join("/");
  };
  const done = await rowVals(0), open = await rowVals(1);
  check("3c. reopened with Edit, the finished item keeps its date and both initials", done === "2026-10-20/SR/NL", done);
  check("3d. the unfinished item is still blank, with no date or initials stamped on it", open === "//", open);
  const stored = scratch((d) => d.prepare("SELECT i.nt_item_label, i.nt_date_met, i.nt_supervisor_initials, i.passed FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id WHERE a.program_id = ? ORDER BY i.id").all(programId));
  check("3e. stored: item A met; item B not met and has no date or supervisor initials",
    stored.length === 2 && stored[0].passed === 1 && stored[1].passed === 0 && !stored[1].nt_date_met && !stored[1].nt_supervisor_initials, JSON.stringify(stored));
  await editForm.screenshot({ path: `${OUT}/eval-reopened-light.png` });
  await ctx.close();
}

for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await signedIn(scheme, width);
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}?newAssessment=1`, { waitUntil: "networkidle" });
  await page.getByRole("dialog").getByText("Evaluation Items").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const picker = (await page.getByTestId("assessment-employee-select").innerText()).trim();
  check(`4a. [${scheme} ${width}px] the form opens with no person chosen`, /Choose a person/.test(picker), picker);
  check(`4b. [${scheme} ${width}px] no horizontal page scroll`, await noScroll(page));
  await page.screenshot({ path: `${OUT}/eval-no-person-${scheme}-${width}.png` });
  await ctx.close();
}

check("4c. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
