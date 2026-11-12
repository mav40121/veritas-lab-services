// scripts/verify-quiz-results-retake-ui.mjs
//
// Browser receipt (Gate 3 step 8) for Redington, 2026-11-11 (Cathy Thornton): a staff member took an assigned quiz on his staff
// login and failed, and she could find neither his result nor a way to let him take it again. On a LOCAL production build with a
// scratch database and made-up people, lab and quiz (it registers people and provisions a lab, so it refuses any other host):
//   R1. the quiz card counts the person who didn't pass, and has a Results button
//   R2. Results lists everyone assigned and every attempt: the failed attempt with its number, date, score and Fail
//   R3. View answers shows that attempt's answers, each question marked right or wrong, with the correct answer
//   R4. Assign a retake creates attempt 2, and attempt 1 stays on file as it was
//   R5. the staff login sees attempt 2 under My sign-offs, Take a Quiz, and takes it
//   R6. after a passing attempt 2, Results lists both attempts and offers no retake
//   plus dark mode and a phone width. Screenshots go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5255 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-quiz-results-retake-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5255", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Quiz", "retake", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `quizretake-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const emailOf = (tag) => `quizretake-${tag}-${stamp}@example.test`;
const reg = async (tag, name) => ({ ...(await call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true })).j, email: emailOf(tag) });
const owner = await reg("owner", "Made Up Director"), sam = await reg("sam", "Sam Retaker"), zed = await reg("zed", "Zed Coworker");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Made-up Retake UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Retake UI Lab", cliaNumber: "99D9999995", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const person = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const samId = await person("Retaker", "Sam"), zedId = await person("Coworker", "Zed");
const now = new Date().toISOString();
scratch((d) => {
  const uid = (tag) => d.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
  const oid = uid("owner");
  for (const [tag, rosterId] of [["sam", samId], ["zed", zedId]]) {
    d.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid(tag), now, now, now);
    d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
      .run(oid, emailOf(tag), uid(tag), now, now, `quizretake-${tag}-${stamp}`, labId, rosterId);
  }
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?, ?)").run(emailOf("owner"), emailOf("sam"), emailOf("zed"));
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
});
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical" }, owner.token)).j.id;
const QUESTIONS = [
  { id: "q1", question: "Made-up question: which tube is drawn first?", options: ["A. Made-up blue top", "B. Made-up red top", "C. Made-up green top"], correct_answer: "A", explanation: "Made-up explanation one." },
  { id: "q2", question: "Made-up question: what does a high made-up control mean?", options: ["A. Report it", "B. Repeat the made-up control", "C. Ignore it"], correct_answer: "B", explanation: "Made-up explanation two." },
  { id: "q3", question: "Made-up question: how long is the made-up reagent stable?", options: ["A. 1 day", "B. 7 days", "C. 30 days"], correct_answer: "C", explanation: "Made-up explanation three." },
  { id: "q4", question: "Made-up question: who reviews a made-up shift?", options: ["A. The supervisor", "B. Nobody", "C. The courier"], correct_answer: "A", explanation: "Made-up explanation four." },
];
const quizId = (await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Chemistry Quiz", questions: QUESTIONS }, owner.token)).j.id;
scratch((d) => d.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quizId));
const assigned = await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, zedId] }, owner.token);
// Attempt 1 on each staff login, through the same route the quiz screen uses: Sam gets 3 of 4 (75%, Fail), Zed all 4 (Pass).
const takeByApi = async (u, sid, picks, signature) => {
  const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, u.token);
  const open = (list.j.quizzes || []).find((q) => q.quiz_id === quizId && q.status === "assigned");
  return call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: sid, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] })), typed_signature: signature }, u.token);
};
const sam1 = await takeByApi(sam, samId, ["A", "A", "C", "A"], "Sam Retaker");
const zed1 = await takeByApi(zed, zedId, ["A", "B", "C", "A"], "Zed Coworker");
const rowsOf = (sid) => scratch((d) => d.prepare("SELECT * FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ? ORDER BY attempt_no").all(quizId, sid));
const attempt1 = rowsOf(samId)[0];
const attempt1Before = JSON.stringify(attempt1);
const result1Before = JSON.stringify(scratch((d) => d.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(attempt1.completed_result_id)));
check("setup: a made-up lab, a quiz assigned to two people, Sam failed attempt 1 (75%) and Zed passed",
  !!labId && !!quizId && assigned.s === 200 && sam1.s === 200 && sam1.j.score === 75 && sam1.j.passed === false && zed1.j.passed === true, `${assigned.s} ${sam1.s} ${JSON.stringify(sam1.j).slice(0, 120)}`);

// ── Browser ──────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const errors = [];
const open = async (u, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, u.token)).j;
  await page.evaluate(([tk, usr, scheme, lab]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr)); localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); localStorage.setItem("theme", scheme); localStorage.setItem("veritas_active_lab_id", String(lab)); }, [u.token, me.user ?? me, opts.colorScheme || "light", labId]);
  return page;
};
const quizzesUrl = `${BASE}/labs/${labId}/veritacomp-app/${prog}?tab=quizzes`;
const openResults = async (page) => {
  await page.goto(quizzesUrl, { waitUntil: "networkidle" });
  await page.getByTestId(`quiz-results-btn-${quizId}`).waitFor({ timeout: 20000 });
  await page.getByTestId(`quiz-results-btn-${quizId}`).click();
  await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
};
const personBox = (page, sid) => page.locator(`[data-testid="quiz-results-person"][data-staff-id="${sid}"]`);
const attemptTexts = async (page, sid) => personBox(page, sid).getByTestId("quiz-results-attempt").allInnerTexts();
const dashFree = (text) => !/—/.test(text);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dialogFits = (page) => page.evaluate(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop(); return !!d && d.getBoundingClientRect().right <= window.innerWidth + 1 && d.scrollWidth <= d.clientWidth + 1; });

// R1. The quiz card
const page = await open(owner);
await page.goto(quizzesUrl, { waitUntil: "networkidle" });
await page.getByTestId(`quiz-status-${quizId}`).waitFor({ timeout: 20000 });
const status = await page.getByTestId(`quiz-status-${quizId}`).innerText();
check("R1a. the quiz card counts by person: 2 completed, 1 not passed, of 2 assigned", /2 completed/.test(status) && /1 not passed/.test(status) && /of 2 assigned/.test(status), status);
check("R1b. the card has a Results button beside Assign", await page.getByTestId(`quiz-results-btn-${quizId}`).isVisible() && await page.getByTestId(`quiz-assign-btn-${quizId}`).isVisible());
await shot(page, "card");

// R2. Results with the failed attempt
await page.getByTestId(`quiz-results-btn-${quizId}`).click();
await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
const names = await page.getByTestId("quiz-results-name").allInnerTexts();
check("R2a. Results lists everyone assigned", names.length === 2 && names.includes("Sam Retaker") && names.includes("Zed Coworker"), JSON.stringify(names));
const sam1Row = (await attemptTexts(page, samId)).join(" | ");
check("R2b. Sam's attempt 1: number, date, score and Fail", /Attempt 1/.test(sam1Row) && /Taken \d{4}-\d{2}-\d{2}/.test(sam1Row) && /75%/.test(sam1Row) && /Fail/.test(sam1Row), sam1Row);
check("R2c. Zed's attempt 1 reads Pass at 100%", /Attempt 1/.test((await attemptTexts(page, zedId)).join(" ")) && /100%/.test((await attemptTexts(page, zedId)).join(" ")) && /Pass/.test((await attemptTexts(page, zedId)).join(" ")));
check("R2d. Assign a retake is offered for Sam, not for Zed", await page.getByTestId(`quiz-retake-btn-${samId}`).isVisible() && (await page.getByTestId(`quiz-retake-btn-${zedId}`).count()) === 0);
check("R2e. no em dash in the dialog", dashFree(await page.getByTestId("quiz-results-dialog").innerText()));
await shot(page, "results-failed");

// R3. The answers view
await page.getByTestId(`quiz-results-view-${attempt1.id}`).click();
await page.getByTestId("quiz-attempt-answers").waitFor({ timeout: 15000 });
const marks = await page.getByTestId("quiz-answer-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-correct")));
check("R3a. every question is listed, marked right or wrong as scored (Q2 wrong)", JSON.stringify(marks) === JSON.stringify(["true", "false", "true", "true"]), JSON.stringify(marks));
const q2 = await page.getByTestId("quiz-answer-row").nth(1).innerText();
check("R3b. the wrong one shows their answer and the correct answer", /Wrong/.test(q2) && /A\. Report it\s*Their answer/.test(q2) && /B\. Repeat the made-up control\s*Correct answer/.test(q2), q2);
check("R3c. the header names the person, attempt, score and result", /Sam Retaker/.test(await page.getByTestId("quiz-attempt-answers").innerText()) && /Attempt 1/.test(await page.getByTestId("quiz-attempt-answers").innerText()) && /3 of 4 right/.test(await page.getByTestId("quiz-attempt-answers").innerText()));
check("R3d. no em dash in the answers view", dashFree(await page.getByTestId("quiz-attempt-answers").innerText()));
await shot(page, "answers");

// R4. Assign a retake
await page.getByTestId("quiz-results-back").click();
await page.getByTestId(`quiz-retake-btn-${samId}`).click();
await page.getByTestId(`quiz-retake-due-${samId}`).fill("2026-12-01");
check("R4a. the retake button says which attempt it makes", (await page.getByTestId(`quiz-retake-confirm-${samId}`).innerText()).trim() === "Assign attempt 2");
await shot(page, "retake-form");
await page.getByTestId(`quiz-retake-confirm-${samId}`).click();
await page.getByText("Attempt 2 assigned to Sam Retaker").first().waitFor({ timeout: 15000 });
await personBox(page, samId).locator('[data-testid="quiz-results-attempt"][data-attempt-no="2"]').waitFor({ timeout: 15000 });
const afterRetake = await attemptTexts(page, samId);
check("R4b. Results now lists attempt 2, not taken yet, with its due date; attempt 1 still Fail at 75%",
  afterRetake.length === 2 && /Attempt 1/.test(afterRetake[0]) && /75%/.test(afterRetake[0]) && /Fail/.test(afterRetake[0])
  && /Attempt 2/.test(afterRetake[1]) && /due 2026-12-01/.test(afterRetake[1]) && /Not taken yet/.test(afterRetake[1]), JSON.stringify(afterRetake));
check("R4c. no second retake offered while attempt 2 is open", (await page.getByTestId(`quiz-retake-btn-${samId}`).count()) === 0);
const samRows = rowsOf(samId);
check("R4d. stored: attempt 2 is a new assignment, and attempt 1 and its result are as they were",
  samRows.length === 2 && samRows[1].attempt_no === 2 && samRows[1].status === "assigned" && JSON.stringify(samRows[0]) === attempt1Before
  && JSON.stringify(scratch((d) => d.prepare("SELECT * FROM competency_quiz_results WHERE id = ?").get(attempt1.completed_result_id))) === result1Before);
check("R4e. the retake is audited", scratch((d) => d.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'quiz_retake' AND entity_id = ?").get(String(samRows[1].id)).n) === 1);
await shot(page, "retake-created");

// R5. The staff login sees attempt 2 and takes it
const staff = await open(sam);
await staff.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await staff.getByTestId("sp-tile-quizzes").click();
await staff.getByTestId("sp-quizzes-pending").waitFor({ timeout: 20000 });
const pendingCard = staff.getByTestId(`sp-quiz-card-${samRows[1].id}`);
check("R5a. under Take a Quiz, attempt 2 is pending with its due date", await pendingCard.isVisible() && /Attempt 2/.test(await pendingCard.innerText()) && /Due 2026-12-01/.test(await pendingCard.innerText()), await pendingCard.innerText());
check("R5b. attempt 1 is listed as completed at 75%", /75%/.test(await staff.getByTestId("sp-quizzes-completed").innerText()));
const staffText = await staff.locator("body").innerText();
check("R5c. nothing of the coworker's on the staff login's screen", !/Zed|Coworker/.test(staffText));
await shot(staff, "staff-list");
await pendingCard.click();
await staff.getByTestId("sp-quiz-question").waitFor({ timeout: 15000 });
for (let i = 0; i < QUESTIONS.length; i++) {
  const text = await staff.getByTestId("sp-quiz-question").innerText();
  const q = QUESTIONS.find((qq) => text.includes(qq.question));
  await staff.getByTestId(`sp-quiz-option-${q.correct_answer}`).check();
  if (i < QUESTIONS.length - 1) await staff.getByTestId("sp-quiz-next").click();
}
await staff.getByTestId("sp-quiz-submit").click();
await staff.getByText("Score: 100%, PASS").first().waitFor({ timeout: 15000 });
check("R5d. attempt 2 passes at 100%", true);
await shot(staff, "staff-passed");
await staff.getByTestId("sp-quizzes-back-from-result").click();
await staff.getByTestId("sp-quizzes-completed").waitFor({ timeout: 15000 });
const doneText = await staff.getByTestId("sp-quizzes-completed").innerText();
check("R5e. back on the list, both attempts are completed and nothing is pending", /Attempt 2/.test(doneText) && /100%/.test(doneText) && /75%/.test(doneText) && (await staff.getByTestId("sp-quizzes-pending").count()) === 0, doneText);

// R6. Results after the passing attempt 2
await openResults(page);
const both = await attemptTexts(page, samId);
check("R6a. Results lists both attempts: 1 Fail at 75%, 2 Pass at 100%", both.length === 2 && /Attempt 1/.test(both[0]) && /75%/.test(both[0]) && /Fail/.test(both[0]) && /Attempt 2/.test(both[1]) && /100%/.test(both[1]) && /Pass/.test(both[1]), JSON.stringify(both));
check("R6b. no retake offered after the pass", (await page.getByTestId(`quiz-retake-btn-${samId}`).count()) === 0);
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId(`quiz-status-${quizId}`).waitFor({ timeout: 20000 });
const status2 = await page.getByTestId(`quiz-status-${quizId}`).innerText();
check("R6c. the card no longer counts anyone as not passed", /2 completed/.test(status2) && !/not passed/.test(status2) && /of 2 assigned/.test(status2), status2);
await page.getByTestId(`quiz-results-btn-${quizId}`).click();
await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
await shot(page, "results-both");
const attempt2 = rowsOf(samId)[1];
await page.getByTestId(`quiz-results-view-${attempt2.id}`).click();
await page.getByTestId("quiz-attempt-answers").waitFor({ timeout: 15000 });
const marks2 = await page.getByTestId("quiz-answer-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-correct")));
check("R6d. attempt 2's answers are all right", marks2.length === 4 && marks2.every((m) => m === "true"), JSON.stringify(marks2));
await shot(page, "answers-attempt2");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open(owner, { colorScheme: "dark" });
await openResults(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "results-dark");
const phone = await open(owner, { viewport: { width: 390, height: 844 } });
await openResults(phone);
check("phone: the results dialog fits the screen, with no sideways scroll", await dialogFits(phone) && await noSideways(phone));
await shot(phone, "results-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
