// scripts/verify-quiz-option-letters-ui.mjs
//
// Browser receipt (Gate 3 step 8) for Redington, 2026-11-18: two quizzes brought over from MediaLab graded every pick wrong.
// Their options were typed without "A." / "B." ("True", "False", "Image A", "Image B"), and the quiz screen took each option's
// first character as its letter while the answer key names options by position. On a LOCAL production build with a scratch
// database and made-up people, lab and quiz (it registers people and provisions a lab, so it refuses any other host):
//   O1. My sign-offs, Take a Quiz: each question shows its typed options and no blank slot; picking "Image B" leaves
//       "Image A" unpicked (the two used to share the letter I)
//   O2. picking the keyed option on every question by its text (True, Image B, Yeast, B. No) scores 100%, PASS
//   O3. the result screen marks each picked option right, and the stored answers are position letters
//   O4. the quiz card's Results shows the attempt at 100% Pass, and View answers marks every question right
//   plus dark mode and a phone width. Screenshots go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5265 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-quiz-option-letters-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5265", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Quiz", "letters", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `quizletters-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const emailOf = (tag) => `quizletters-${tag}-${stamp}@example.test`;
const reg = async (tag, name) => ({ ...(await call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true })).j, email: emailOf(tag) });
const owner = await reg("owner", "Made Up Director"), sam = await reg("sam", "Sam Letters");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Made-up Letters UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Letters UI Lab", cliaNumber: "99D9999994", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const samId = (await call("POST", `${L}/staff/employees`, { lastName: "Letters", firstName: "Sam", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const now = new Date().toISOString();
scratch((d) => {
  const uid = (tag) => d.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
  d.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid("sam"), now, now, now);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
    .run(uid("owner"), emailOf("sam"), uid("sam"), now, now, `quizletters-sam-${stamp}`, labId, samId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(emailOf("owner"), emailOf("sam"));
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
});
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, owner.token)).j.id;
// The shapes of the reported quizzes, with made-up words: options typed without letters, two starting alike, blank slots.
const QUESTIONS = [
  { id: "q1", question: "Made-up question one: a made-up stain is read under oil.", options: ["True", "False"], correct_answer: "A", pick: "True" },
  { id: "q2", question: "Made-up question two: which made-up slide shows the made-up rods?", options: ["Image A", "Image B"], correct_answer: "B", pick: "Image B" },
  { id: "q3", question: "Made-up question three: what is the made-up budding form?", options: ["Artifact", "Gram-positive cocci", "Yeast", "Bacilli"], correct_answer: "C", pick: "Yeast" },
  { id: "q4", question: "Made-up question four: is a made-up smear read wet?", options: ["A. Yes", "B. No", "", ""], correct_answer: "B", pick: "B. No" },
];
const quizId = (await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Gram Stain Quiz", questions: QUESTIONS.map(({ pick, ...q }) => q) }, owner.token)).j.id;
scratch((d) => d.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quizId));
await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId] }, owner.token);
const assignment = scratch((d) => d.prepare("SELECT id FROM competency_quiz_assignments WHERE quiz_id = ? AND staff_employee_id = ?").get(quizId, samId));
check("setup: a made-up lab and a four-question quiz assigned to one staff login", !!labId && !!quizId && !!assignment?.id);

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
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const startQuiz = async (page) => {
  await page.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
  await page.getByTestId("sp-tile-quizzes").click();
  await page.getByTestId("sp-quizzes-pending").waitFor({ timeout: 20000 });
  await page.getByTestId(`sp-quiz-card-${assignment.id}`).click();
  await page.getByTestId("sp-quiz-question").waitFor({ timeout: 15000 });
};
const questionOnScreen = async (page) => { const text = await page.getByTestId("sp-quiz-question").innerText(); return QUESTIONS.find((q) => text.includes(q.question)); };
const optionLabels = (page) => page.getByTestId("sp-quiz-question").locator("label");

// O1 + O2. Take the quiz on the staff login, picking by the option's text.
const staff = await open(sam);
await startQuiz(staff);
const seen = {};
for (let i = 0; i < QUESTIONS.length; i++) {
  const q = await questionOnScreen(staff);
  const labels = (await optionLabels(staff).allInnerTexts()).map((t) => t.trim());
  seen[q.id] = labels;
  if (q.id === "q2") {
    await optionLabels(staff).filter({ hasText: "Image B" }).locator("input").check();
    const checked = await optionLabels(staff).locator("input").evaluateAll((els) => els.map((e) => e.checked));
    check("O1b. picking Image B leaves Image A unpicked", JSON.stringify(checked) === JSON.stringify([false, true]), JSON.stringify(checked));
    await shot(staff, "take-two-alike");
  } else {
    await optionLabels(staff).filter({ hasText: new RegExp(`^\\s*${q.pick.replace(/[.]/g, "\\.")}\\s*$`) }).locator("input").check();
  }
  if (i < QUESTIONS.length - 1) await staff.getByTestId("sp-quiz-next").click();
}
check("O1a. each question shows its typed options, and the blank slots aren't shown",
  JSON.stringify(seen) === JSON.stringify({ q1: ["True", "False"], q2: ["Image A", "Image B"], q3: ["Artifact", "Gram-positive cocci", "Yeast", "Bacilli"], q4: ["A. Yes", "B. No"] }), JSON.stringify(seen));
await staff.getByTestId("sp-quiz-submit").click();
const passed = await staff.getByText("Score: 100%, PASS").first().waitFor({ timeout: 15000 }).then(() => true, () => false);
check("O2. picking the keyed option on every question scores 100%, PASS", passed, (await staff.locator("body").innerText()).slice(0, 300));
await shot(staff, "result");

// O3. The result screen and what was stored.
const resultText = await staff.locator("body").innerText();
const wrongMarks = (resultText.match(/✗/g) || []).length, rightMarks = (resultText.match(/✓/g) || []).length;
check("O3a. the result screen marks the four picks right and none wrong", rightMarks === 4 && wrongMarks === 0, `right ${rightMarks} wrong ${wrongMarks}`);
const stored = scratch((d) => d.prepare("SELECT r.answers, r.score, r.passed FROM competency_quiz_results r JOIN competency_quiz_assignments a ON a.completed_result_id = r.id WHERE a.id = ?").get(assignment.id));
const storedPicks = JSON.parse(stored?.answers || "[]").map((a) => a.selected_answer);
check("O3b. stored: score 100, passed, answers are the position letters A, B, C, B", stored?.score === 100 && stored?.passed === 1 && JSON.stringify(storedPicks) === JSON.stringify(["A", "B", "C", "B"]), JSON.stringify({ score: stored?.score, storedPicks }));

// O4. The owner's Results and View answers.
const page = await open(owner);
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${prog}?tab=quizzes`, { waitUntil: "networkidle" });
await page.getByTestId(`quiz-results-btn-${quizId}`).waitFor({ timeout: 20000 });
await page.getByTestId(`quiz-results-btn-${quizId}`).click();
await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
const attemptRow = (await page.getByTestId("quiz-results-attempt").allInnerTexts()).join(" | ");
check("O4a. Results shows the attempt at 100% Pass", /100%/.test(attemptRow) && /Pass/.test(attemptRow), attemptRow);
await page.getByTestId(`quiz-results-view-${assignment.id}`).click();
await page.getByTestId("quiz-attempt-answers").waitFor({ timeout: 15000 });
const marks = await page.getByTestId("quiz-answer-row").evaluateAll((els) => els.map((e) => e.getAttribute("data-correct")));
check("O4b. View answers marks every question right", JSON.stringify(marks) === JSON.stringify(["true", "true", "true", "true"]), JSON.stringify(marks));
const q2Row = await page.getByTestId("quiz-answer-row").nth(1).innerText();
check("O4c. View answers shows Image B as their answer and the correct answer", /Image B/.test(q2Row), q2Row);
await shot(page, "results-answers");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open(sam, { colorScheme: "dark" });
await dark.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await dark.getByTestId("sp-tile-quizzes").click();
await dark.getByTestId("sp-quizzes-completed").waitFor({ timeout: 20000 });
check("dark: the page is in dark mode and the completed quiz is listed at 100%", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && /100%/.test(await dark.getByTestId("sp-quizzes-completed").innerText()));
await shot(dark, "list-dark");
const phone = await open(owner, { viewport: { width: 390, height: 844 } });
await phone.goto(`${BASE}/labs/${labId}/veritacomp-app/${prog}?tab=quizzes`, { waitUntil: "networkidle" });
await phone.getByTestId(`quiz-results-btn-${quizId}`).waitFor({ timeout: 20000 });
await phone.getByTestId(`quiz-results-btn-${quizId}`).click();
await phone.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
check("phone: Results fits with no sideways scroll", await noSideways(phone));
await shot(phone, "results-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
