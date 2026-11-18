// scripts/verify-quiz-auto-retake-ui.mjs
//
// Browser receipt (Gate 3 step 8) for automatic retakes (Redington 2026-11-18, Michael Q3 = 1). On a LOCAL production build with a
// scratch database and made-up people, lab and quiz (it registers people and provisions a lab, so it refuses any other host):
//   A1. Edit Quiz has "Retake automatically after a failed attempt", off for this quiz; ticking it and Save Changes stores it, and
//       the quiz card says "retakes automatically"
//   A2. the staff login fails the quiz: the review marks the missed question, shows no correct answer, says why, and says
//       attempt 2 is open, with Take attempt 2
//   A3. Take attempt 2 opens attempt 2; picking the right answers scores 100%, PASS, and that review shows the answers
//   A4. the evaluator's Results lists attempt 1 (Fail) and attempt 2 (Pass)
//   plus dark mode and a phone width. Screenshots go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5271 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-quiz-auto-retake-ui.mjs
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
const PW = ["Quiz", "auto", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `quizauto-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const emailOf = (tag) => `quizauto-${tag}-${stamp}@example.test`;
const reg = async (tag, name) => ({ ...(await call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true })).j, email: emailOf(tag) });
const owner = await reg("owner", "Made Up Director"), sam = await reg("sam", "Sam Retrier");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Made-up Auto Retake UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Auto Retake UI Lab", cliaNumber: "99D9999992", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const samId = (await call("POST", `${L}/staff/employees`, { lastName: "Retrier", firstName: "Sam", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const now = new Date().toISOString();
scratch((d) => {
  const uid = (tag) => d.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
  d.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid("sam"), now, now, now);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
    .run(uid("owner"), emailOf("sam"), uid("sam"), now, now, `quizauto-sam-${stamp}`, labId, samId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(emailOf("owner"), emailOf("sam"));
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999992' WHERE id = ?").run(labId);
});
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, owner.token)).j.id;
const QUESTIONS = [
  { id: "q1", question: "Made-up question one: a made-up stain is read under oil.", options: ["True", "False"], correct_answer: "A", explanation: "Made-up reason one." },
  { id: "q2", question: "Made-up question two: which made-up slide shows the rods?", options: ["Image A", "Image B"], correct_answer: "B", explanation: "Made-up reason two." },
];
const quizId = (await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Auto Retake Quiz", questions: QUESTIONS }, owner.token)).j.id;
scratch((d) => d.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quizId));
await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId] }, owner.token);
check("setup: a made-up lab, a quiz with the setting off, assigned to one staff login", !!quizId && scratch((d) => d.prepare("SELECT auto_retake FROM competency_quizzes WHERE id = ?").get(quizId).auto_retake) === 0);

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

// A1. Turn it on in Edit Quiz.
const page = await openAs(owner);
await page.goto(quizzesUrl, { waitUntil: "networkidle" });
await page.getByText("Made-up Auto Retake Quiz").first().click();
await page.getByRole("button", { name: "Edit Quiz" }).click();
const box = page.getByTestId("quiz-edit-auto-retake");
await box.waitFor({ timeout: 15000 });
check("A1a. Edit Quiz has the setting, off for this quiz", (await box.getAttribute("data-state")) === "unchecked" && /Retake automatically after a failed attempt/.test(await page.getByRole("dialog").last().innerText()));
await box.click();
await shot(page, "edit");
await page.getByRole("button", { name: "Save Changes" }).click();
await page.waitForTimeout(1500);
check("A1b. Save Changes stores it", scratch((d) => d.prepare("SELECT auto_retake FROM competency_quizzes WHERE id = ?").get(quizId).auto_retake) === 1);
await page.goto(quizzesUrl, { waitUntil: "networkidle" });
await page.getByText("Made-up Auto Retake Quiz").first().waitFor({ timeout: 15000 });
check("A1c. the quiz card says retakes automatically", /retakes automatically/.test(await page.locator("body").innerText()));
await shot(page, "card");

// A2. Fail on the staff login.
const staff = await openAs(sam);
const pickAndSubmit = async (picks) => {
  await staff.getByTestId("sp-quiz-question").waitFor({ timeout: 15000 });
  for (let i = 0; i < QUESTIONS.length; i++) {
    const text = await staff.getByTestId("sp-quiz-question").innerText();
    const q = QUESTIONS.find((qq) => text.includes(qq.question));
    await staff.getByTestId(`sp-quiz-option-${picks[q.id]}`).check();
    if (i < QUESTIONS.length - 1) await staff.getByTestId("sp-quiz-next").click();
  }
  await staff.getByTestId("sp-quiz-submit").click();
};
await staff.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await staff.getByTestId("sp-tile-quizzes").click();
await staff.getByTestId("sp-quizzes-pending").waitFor({ timeout: 20000 });
await staff.getByTestId("sp-quizzes-pending").locator("[data-testid^='sp-quiz-card-']").first().click();
await pickAndSubmit({ q1: "A", q2: "A" });
await staff.getByTestId("sp-quiz-key-hidden").waitFor({ timeout: 15000 });
const review = await staff.locator("body").innerText();
const marks = await staff.getByTestId("sp-quiz-review-question").evaluateAll((els) => els.map((e) => e.getAttribute("data-correct")));
check("A2a. the review says Not passed, marks one question missed, and says the answers aren't shown", /Score: 50%, Not passed/.test(review) && JSON.stringify(marks.sort()) === JSON.stringify(["false", "true"]) && /correct answers aren't shown/.test(review), review.slice(0, 300));
check("A2b. no correct answer or explanation appears: Image B carries no check mark and the explanations are absent", !/Image B ✓/.test(review) && !/Made-up reason/.test(review));
check("A2c. it says attempt 2 is open, with Take attempt 2", /Attempt 2 is open now/.test(review) && await staff.getByTestId("sp-quiz-take-next").isVisible());
await shot(staff, "failed-review");

// A3. Take attempt 2 from the review.
await staff.getByTestId("sp-quiz-take-next").click();
await pickAndSubmit({ q1: "A", q2: "B" });
await staff.getByText("Score: 100%, PASS").first().waitFor({ timeout: 15000 });
const passReview = await staff.locator("body").innerText();
check("A3. attempt 2 scores 100%, PASS, and its review shows the explanations again", /Made-up reason one/.test(passReview) && (await staff.getByTestId("sp-quiz-key-hidden").count()) === 0 && (await staff.getByTestId("sp-quiz-take-next").count()) === 0);
await shot(staff, "passed");
const rows = scratch((d) => d.prepare("SELECT attempt_no, status, assigned_by_user_id FROM competency_quiz_assignments WHERE quiz_id = ? ORDER BY attempt_no").all(quizId));
check("A3b. stored: attempt 1 and 2 completed, attempt 2 opened by the system, no attempt 3", rows.length === 2 && rows.every((r) => r.status === "completed") && rows[1].assigned_by_user_id === 0, JSON.stringify(rows));

// A4. The evaluator's Results.
await page.goto(quizzesUrl, { waitUntil: "networkidle" });
await page.getByTestId(`quiz-results-btn-${quizId}`).waitFor({ timeout: 20000 });
await page.getByTestId(`quiz-results-btn-${quizId}`).click();
await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
const attempts = await page.getByTestId("quiz-results-attempt").allInnerTexts();
check("A4. Results lists attempt 1 Fail at 50% and attempt 2 Pass at 100%", attempts.length === 2 && /Attempt 1/.test(attempts[0]) && /50%/.test(attempts[0]) && /Fail/.test(attempts[0]) && /Attempt 2/.test(attempts[1]) && /100%/.test(attempts[1]) && /Pass/.test(attempts[1]), JSON.stringify(attempts));
await shot(page, "results");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await openAs(owner, { colorScheme: "dark" });
await dark.goto(quizzesUrl, { waitUntil: "networkidle" });
await dark.getByText("Made-up Auto Retake Quiz").first().click();
await dark.getByRole("button", { name: "Edit Quiz" }).click();
await dark.getByTestId("quiz-edit-auto-retake").waitFor({ timeout: 15000 });
check("dark: the page is in dark mode and the setting reads on", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await dark.getByTestId("quiz-edit-auto-retake").getAttribute("data-state")) === "checked");
await shot(dark, "edit-dark");
const phone = await openAs(sam, { viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await phone.getByTestId("sp-tile-quizzes").click();
await phone.getByTestId("sp-quizzes-completed").waitFor({ timeout: 20000 });
check("phone: the staff list fits with no sideways scroll and shows both attempts", await noSideways(phone) && /Attempt 2/.test(await phone.getByTestId("sp-quizzes-completed").innerText()));
await shot(phone, "staff-list-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
