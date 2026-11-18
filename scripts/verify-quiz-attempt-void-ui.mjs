// scripts/verify-quiz-attempt-void-ui.mjs
//
// Browser receipt (Gate 3 step 8) for voiding a quiz attempt (Redington 2026-11-18, Michael Q2 = 1). On a LOCAL production build
// with a scratch database and made-up people, lab and quiz (it registers people and provisions a lab, so it refuses any other host):
//   V1. Results on the quiz card: a failed attempt has Void; Void opens a form that needs a reason; Void attempt 1 marks it
//       Voided with the reason, its score still shown, and Assign a retake is offered
//   V2. the quiz card's status counts the person as voided, awaiting a retake, not as not passed
//   V3. Quiz scores lists the attempt as Voided with its reason
//   V4. the staff login's own list (My sign-offs, Take a Quiz) shows the attempt Voided with its reason
//   plus dark mode and a phone width. Screenshots go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5267 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-quiz-attempt-void-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5267", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Quiz", "void", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `quizvoid-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const emailOf = (tag) => `quizvoid-${tag}-${stamp}@example.test`;
const reg = async (tag, name) => ({ ...(await call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true })).j, email: emailOf(tag) });
const owner = await reg("owner", "Made Up Director"), sam = await reg("sam", "Sam Voidable");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Made-up Void UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Void UI Lab", cliaNumber: "99D9999993", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const samId = (await call("POST", `${L}/staff/employees`, { lastName: "Voidable", firstName: "Sam", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const now = new Date().toISOString();
scratch((d) => {
  const uid = (tag) => d.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
  d.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid("sam"), now, now, now);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
    .run(uid("owner"), emailOf("sam"), uid("sam"), now, now, `quizvoid-sam-${stamp}`, labId, samId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(emailOf("owner"), emailOf("sam"));
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999993' WHERE id = ?").run(labId);
});
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Microbiology", department: "Microbiology", type: "technical" }, owner.token)).j.id;
const QUESTIONS = [
  { id: "q1", question: "Made-up question one?", options: ["True", "False"], correct_answer: "A" },
  { id: "q2", question: "Made-up question two?", options: ["Image A", "Image B"], correct_answer: "B" },
];
const quizId = (await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Gram Stain Quiz", questions: QUESTIONS }, owner.token)).j.id;
scratch((d) => d.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quizId));
await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId] }, owner.token);
const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${samId}`, undefined, sam.token);
const open = (list.j.quizzes || []).find((q) => q.quiz_id === quizId);
const took = await call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: samId, answers: [{ question_id: "q1", selected_answer: "A" }, { question_id: "q2", selected_answer: "A" }], typed_signature: "Sam Voidable" }, sam.token);
const resultId = took.j.id;
check("setup: a made-up lab and a quiz Sam took and failed at 50%", took.s === 200 && took.j.score === 50 && !!resultId);
const REASON = "Made-up: scored by a system error";

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
const openResults = async (page) => {
  await page.goto(quizzesUrl, { waitUntil: "networkidle" });
  await page.getByTestId(`quiz-results-btn-${quizId}`).waitFor({ timeout: 20000 });
  await page.getByTestId(`quiz-results-btn-${quizId}`).click();
  await page.getByTestId("quiz-results-person").first().waitFor({ timeout: 15000 });
};
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// V1. Void from Results.
const page = await openAs(owner);
await openResults(page);
check("V1a. the failed attempt has a Void button", await page.getByTestId(`quiz-void-btn-${resultId}`).isVisible());
await page.getByTestId(`quiz-void-btn-${resultId}`).click();
await page.getByTestId(`quiz-void-form-${resultId}`).waitFor({ timeout: 10000 });
check("V1b. Void attempt 1 waits for a reason", await page.getByTestId(`quiz-void-confirm-${resultId}`).isDisabled());
await page.getByTestId(`quiz-void-reason-${resultId}`).fill(REASON);
await shot(page, "form");
await page.getByTestId(`quiz-void-confirm-${resultId}`).click();
await page.getByTestId(`quiz-void-line-${resultId}`).waitFor({ timeout: 15000 });
const row = await page.getByTestId("quiz-results-attempt").first().innerText();
check("V1c. the attempt reads Voided with the reason, its score still shown", /Voided/.test(row) && row.includes(REASON) && /50%/.test(row) && !/\bFail\b/.test(row), row);
check("V1d. Void is gone from it and Assign a retake is offered", (await page.getByTestId(`quiz-void-btn-${resultId}`).count()) === 0 && await page.getByTestId(`quiz-retake-btn-${samId}`).isVisible());
check("V1e. no em dash in the dialog", !/—/.test(await page.getByTestId("quiz-results-dialog").innerText()));
await shot(page, "voided");
const stored = scratch((d) => d.prepare("SELECT voided_at, void_reason, score FROM competency_quiz_results WHERE id = ?").get(resultId));
check("V1f. stored: voided with the reason, score kept", !!stored?.voided_at && stored?.void_reason === REASON && stored?.score === 50, JSON.stringify(stored));

// V2. The card's status.
await page.goto(quizzesUrl, { waitUntil: "networkidle" });
await page.getByTestId(`quiz-status-${quizId}`).waitFor({ timeout: 20000 });
const status = await page.getByTestId(`quiz-status-${quizId}`).innerText();
check("V2. the card counts Sam as voided, awaiting a retake, not as not passed", /1 voided, awaiting a retake/.test(status) && !/not passed/.test(status) && /0 completed/.test(status), status);
await shot(page, "card");

// V3. Quiz scores.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/quiz-scores`, { waitUntil: "networkidle" });
await page.getByTestId("quiz-score-result").first().waitFor({ timeout: 20000 });
const badge = await page.getByTestId("quiz-score-result").first().innerText();
const reasonLine = await page.getByTestId("quiz-score-void-reason").first().innerText().catch(() => "");
check("V3. Quiz scores lists the attempt as Voided with its reason", badge.trim() === "Voided" && reasonLine.includes(REASON), `${badge} | ${reasonLine}`);
await shot(page, "scores");

// V4. The staff login's own list.
const staff = await openAs(sam);
await staff.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
await staff.getByTestId("sp-tile-quizzes").click();
await staff.getByTestId("sp-quizzes-completed").waitFor({ timeout: 20000 });
const done = await staff.getByTestId("sp-quizzes-completed").innerText();
check("V4. the staff login sees the attempt Voided with its reason", /Voided/.test(done) && done.includes(REASON) && !/Recorded/.test(done), done);
await shot(staff, "staff-list");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await openAs(owner, { colorScheme: "dark" });
await openResults(dark);
check("dark: the page is in dark mode and the Voided line shows", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && await dark.getByTestId(`quiz-void-line-${resultId}`).isVisible());
await shot(dark, "results-dark");
const phone = await openAs(owner, { viewport: { width: 390, height: 844 } });
await openResults(phone);
check("phone: Results fits with no sideways scroll", await noSideways(phone));
await shot(phone, "results-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
