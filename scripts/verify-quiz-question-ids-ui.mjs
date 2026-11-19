// scripts/verify-quiz-question-ids-ui.mjs
//
// Browser receipt (Gate 3 step 8) for unique quiz question ids (Redington 2026-11-19: the Microbiology Annual Quiz had two
// questions with id q8 and two with q9; Edit Quiz gave a new question "q<count + 1>"). On a LOCAL production build with a scratch
// database and made-up people, lab and quiz (it registers people and provisions a lab, so it refuses any other host):
//   C1. Edit Quiz on a quiz whose ids are q1, q3, q4: Add Question gives the new question q5 (it gave q4, a repeat), and Save
//       Changes stores four different ids
//   C2. removing question 1 and saving leaves the others' ids as they were (q3, q4, q5; it renumbered them to q1, q2, q3)
//   C3. the staff login takes the quiz: the last question's line names the questions still unanswered, a pick on one question
//       doesn't change another, and every key chosen scores 100%, PASS, with every question marked right
//   plus dark mode and a phone width. Screenshots go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5271 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-quiz-question-ids-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5271", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Quiz", "ids", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `quizids-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const emailOf = (tag) => `quizids-${tag}-${stamp}@example.test`;
const reg = async (tag, name) => ({ ...(await call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true })).j, email: emailOf(tag) });
const owner = await reg("owner", "Made Up Director"), sam = await reg("sam", "Sam Picker");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Made-up Question Id UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Question Id UI Lab", cliaNumber: "99D9999993", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const samId = (await call("POST", `${L}/staff/employees`, { lastName: "Picker", firstName: "Sam", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const now = new Date().toISOString();
scratch((d) => {
  const uid = (tag) => d.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
  d.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid("sam"), now, now, now);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
    .run(uid("owner"), emailOf("sam"), uid("sam"), now, now, `quizids-sam-${stamp}`, labId, samId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(emailOf("owner"), emailOf("sam"));
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999993' WHERE id = ?").run(labId);
});
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, owner.token)).j.id;
// Ids with a gap, as a quiz brought over or edited before could have.
const START = [
  { id: "q1", question: "Made-up question one: a made-up stain is read under oil.", options: ["True", "False"], correct_answer: "A", explanation: "" },
  { id: "q3", question: "Made-up question three: a made-up bottle can go back in the made-up incubator.", options: ["True", "True, if within 20 made-up minutes", "False", ""], correct_answer: "B", explanation: "" },
  { id: "q4", question: "Made-up question four: a made-up plate shows a made-up mold spot.", options: ["Plant it anyway", "Plant around it", "Use a new made-up plate", ""], correct_answer: "C", explanation: "" },
];
const quizId = (await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Question Id Quiz", questions: START }, owner.token)).j.id;
scratch((d) => d.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quizId));
const storedIds = () => scratch((d) => JSON.parse(d.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId).questions).map((q) => q.id));
check("setup: a made-up quiz with ids q1, q3, q4", JSON.stringify(storedIds()) === '["q1","q3","q4"]', JSON.stringify(storedIds()));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const errors = [];
const openAs = async (u, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, u.token)).j;
  await page.evaluate(([tk, usr, scheme, lab]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr)); localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); localStorage.setItem("theme", scheme); localStorage.setItem("veritas_active_lab_id", String(lab)); }, [u.token, me.user ?? me, opts.colorScheme || "light", labId]);
  return page;
};
const quizzesUrl = `${BASE}/labs/${labId}/veritacomp-app/${prog}?tab=quizzes`;
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openEdit = async (page) => {
  await page.goto(quizzesUrl, { waitUntil: "networkidle" });
  await page.getByText("Made-up Question Id Quiz").first().click();
  await page.getByRole("button", { name: "Edit Quiz" }).click();
  await page.getByTestId("quiz-edit-add-question").waitFor({ timeout: 15000 });
};

// C1. Add a question in Edit Quiz.
const page = await openAs(owner);
await openEdit(page);
await page.getByTestId("quiz-edit-add-question").click();
await page.getByTestId("quiz-edit-question-3").fill("Made-up question five: a made-up control is run each made-up shift.");
await page.getByTestId("quiz-edit-option-3-0").fill("True");
await page.getByTestId("quiz-edit-option-3-1").fill("False");
await page.getByTestId("quiz-edit-option-3-2").fill("");
await page.getByTestId("quiz-edit-option-3-3").fill("");
await shot(page, "edit-added");
await page.getByRole("button", { name: "Save Changes" }).click();
await page.waitForTimeout(1500);
check("C1. Add Question gives the new question q5, not the repeat q4, and Save Changes stores four different ids", JSON.stringify(storedIds()) === '["q1","q3","q4","q5"]', JSON.stringify(storedIds()));

// C2. Remove question 1.
await openEdit(page);
await page.getByTestId("quiz-edit-remove-0").click();
await page.getByRole("button", { name: "Save Changes" }).click();
await page.waitForTimeout(1500);
check("C2. removing question 1 leaves the others' ids as they were (q3, q4, q5)", JSON.stringify(storedIds()) === '["q3","q4","q5"]', JSON.stringify(storedIds()));

// C3. The staff login takes it.
const QUIZ = scratch((d) => JSON.parse(d.prepare("SELECT questions FROM competency_quizzes WHERE id = ?").get(quizId).questions));
await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId] }, owner.token);
const staff = await openAs(sam);
await staff.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await staff.getByTestId("sp-tile-quizzes").click();
await staff.getByTestId("sp-quizzes-pending").waitFor({ timeout: 20000 });
await staff.getByTestId("sp-quizzes-pending").locator("[data-testid^='sp-quiz-card-']").first().click();
await staff.getByTestId("sp-quiz-question").waitFor({ timeout: 15000 });
const pick = async () => {
  const text = await staff.getByTestId("sp-quiz-question").innerText();
  const q = QUIZ.find((qq) => text.includes(qq.question));
  await staff.getByTestId(`sp-quiz-option-${q.correct_answer}`).check();
  return q;
};
const q1 = await pick();
await staff.getByTestId("sp-quiz-next").click();
const q2 = await pick();
await staff.getByTestId("sp-quiz-prev").click();
const backChecked = await staff.getByTestId(`sp-quiz-option-${q1.correct_answer}`).isChecked();
check("C3a. a pick on question 2 doesn't change question 1 (back on question 1, its own pick is still there)", backChecked && q1.id !== q2.id, `${backChecked} ${q1.id} ${q2.id}`);
await staff.getByTestId("sp-quiz-next").click();
await staff.getByTestId("sp-quiz-next").click();
const lastLine = await staff.getByTestId("sp-quiz-answered-line").innerText();
check("C3b. on the last question, before it is answered, the line names it: Not answered: question 3", /Not answered: question 3\./.test(lastLine) && await staff.getByTestId("sp-quiz-submit").isDisabled(), lastLine);
await shot(staff, "take-unanswered");
await pick();
check("C3c. once every question is answered the line says so", /All answered/.test(await staff.getByTestId("sp-quiz-answered-line").innerText()));
await staff.getByTestId("sp-quiz-signature").fill("Sam Picker");
await staff.getByTestId("sp-quiz-submit").click();
await staff.getByText("Score: 100%, PASS").first().waitFor({ timeout: 15000 });
const marks = await staff.getByTestId("sp-quiz-review-question").evaluateAll((els) => els.map((e) => e.getAttribute("data-correct")));
check("C3d. every key chosen scores 100%, PASS, and every question is marked right", marks.length === 3 && marks.every((m) => m === "true"), JSON.stringify(marks));
await shot(staff, "passed");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await openAs(owner, { colorScheme: "dark" });
await openEdit(dark);
check("dark: the page is in dark mode and Edit Quiz shows three questions with Add Question", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await dark.locator("[data-testid^='quiz-edit-question-']").count()) === 3);
await shot(dark, "edit-dark");
const phone = await openAs(sam, { viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await phone.getByTestId("sp-tile-quizzes").click();
await phone.getByTestId("sp-quizzes-completed").waitFor({ timeout: 20000 });
check("phone: the staff quiz list fits with no sideways scroll", await noSideways(phone));
await shot(phone, "staff-list-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
