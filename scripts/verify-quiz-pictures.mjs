// scripts/verify-quiz-pictures.mjs
//
// Pictures on VeritaComp quiz questions (Redington-Fairview REQ-074, 2026-10-14) and BUG-055 (an edit
// turned randomization off and an HTML-format quiz back to plain text). Boots the built server on a COPY
// of a production backup (never written) and checks, on Michaels Lab (lab 3; LAB=, PROGRAM= to change):
//   1. a quiz whose first question has a PNG picture is saved
//   2. the builder view returns the picture on question 1 and none on question 2
//   3. the employee-take view returns the picture (answer key still stripped)
//   4. a web-address picture is refused (400 QUIZ_IMAGE_INVALID)
//   5. a non-image data URL (text/html) is refused
//   6. an SVG picture is refused (SVG can carry script)
//   7. one picture over the size cap is refused
//   8. pictures over the whole-quiz cap are refused
//   9. Edit Quiz without the two settings keeps randomize on and the HTML format (BUG-055)
//  10. an edit that sends randomize off turns it off (the other branch)
//  11. an edit that removes the picture stores none
//  12. a staff login sees the picture on an assigned quiz, and in the scored result
// Usage: node scripts/verify-quiz-pictures.mjs <backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5181, SECRET = "quizpics-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-quiz-pictures.mjs <backup.db> (after npm run build)"); process.exit(2); }

const LAB = Number(process.env.LAB || 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quizpics-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const ro = new Database(dbPath, { readonly: true });
const owner = ro.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
const program = Number(process.env.PROGRAM || ro.prepare("SELECT id FROM competency_programs WHERE lab_id = ? ORDER BY id LIMIT 1").get(LAB).id);
const seat = ro.prepare("SELECT seat_user_id, staff_employee_id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL ORDER BY id LIMIT 1").get(LAB);
ro.close();
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const hdr = (userId) => ({ "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ svc: true, userId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(LAB) });
const H = hdr(owner);
const API = `http://localhost:${PORT}/api`;
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const send = (url, body, method = "POST", h = H) => fetch(url, { method, headers: h, body: JSON.stringify(body) });

// A real 1 x 1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const q = (id, image) => ({ id, question: `QA picture question ${id}`, type: "multiple_choice", options: ["A. one", "B. two", "C. three", "D. four"], correct_answer: "B", explanation: "QA", ...(image === undefined ? {} : { image }) });
const quizBody = (questions, extra = {}) => ({ title: "QA quiz pictures", questions, ...extra });

const r1 = await send(`${API}/veritacomp/programs/${program}/quizzes`, quizBody([q("q1", PNG), q("q2")], { randomizeQuestions: true, questionFormat: "html" }));
const quiz = await j(r1);
check("1. a quiz with a PNG picture on question 1 is saved", r1.ok && !!quiz.id, `${r1.status} ${JSON.stringify(quiz)}`);
const full = await j(await fetch(`${API}/veritacomp/quizzes/${quiz.id}?withAnswers=1`, { headers: H }));
const fq = full.questions || [];
check("2. the builder view returns the picture on question 1 and none on question 2", fq[0]?.image === PNG && !fq[1]?.image, JSON.stringify(fq.map((x) => (x.image || "").slice(0, 30))));
const take = await j(await fetch(`${API}/veritacomp/quizzes/${quiz.id}`, { headers: H }));
const tq1 = (take.questions || []).find((x) => x.id === "q1");
check("3. the employee-take view returns the picture, without the answer key", tq1?.image === PNG && tq1.correct_answer === undefined, JSON.stringify(tq1 ? { ...tq1, image: (tq1.image || "").slice(0, 30) } : null));

const bad = async (label, image) => {
  const r = await send(`${API}/veritacomp/programs/${program}/quizzes`, quizBody([q("q1", image)]));
  const e = await j(r);
  check(label, r.status === 400 && e.code === "QUIZ_IMAGE_INVALID", `${r.status} ${JSON.stringify(e).slice(0, 160)}`);
};
await bad("4. a web-address picture is refused", "https://example.com/smear.png");
await bad("5. a non-image data URL is refused", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==");
await bad("6. an SVG picture is refused", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=");
await bad("7. one picture over the size cap is refused", "data:image/png;base64," + "A".repeat(900_001));
{
  const big = "data:image/png;base64," + "A".repeat(880_000);
  const r = await send(`${API}/veritacomp/programs/${program}/quizzes`, quizBody([1, 2, 3, 4, 5].map((n) => q(`q${n}`, big))));
  const e = await j(r);
  check("8. pictures over the whole-quiz cap are refused", r.status === 400 && e.code === "QUIZ_IMAGE_INVALID" && /too many pictures/.test(e.error || ""), `${r.status} ${JSON.stringify(e).slice(0, 160)}`);
}

// Edit Quiz sends title, method groups and questions only (no randomize / format).
const r9 = await send(`${API}/veritacomp/quizzes/${quiz.id}`, quizBody([q("q1", PNG), q("q2")], { title: "QA quiz pictures edited" }), "PUT");
const after9 = await j(await fetch(`${API}/veritacomp/quizzes/${quiz.id}?withAnswers=1`, { headers: H }));
check("9. an edit without the two settings keeps randomize on and the HTML format", r9.ok && after9.randomize_questions === 1 && after9.question_format === "html", `${r9.status} randomize=${after9.randomize_questions} format=${after9.question_format}`);
const r10 = await send(`${API}/veritacomp/quizzes/${quiz.id}`, quizBody([q("q1", PNG), q("q2")], { randomizeQuestions: false, questionFormat: "plain" }), "PUT");
const after10 = await j(await fetch(`${API}/veritacomp/quizzes/${quiz.id}?withAnswers=1`, { headers: H }));
check("10. an edit that sends randomize off and plain format applies them", r10.ok && after10.randomize_questions === 0 && after10.question_format === "plain", `${r10.status} randomize=${after10.randomize_questions} format=${after10.question_format}`);
const r11 = await send(`${API}/veritacomp/quizzes/${quiz.id}`, quizBody([q("q1", null), q("q2")]), "PUT");
const after11 = await j(await fetch(`${API}/veritacomp/quizzes/${quiz.id}?withAnswers=1`, { headers: H }));
check("11. an edit that removes the picture stores none", r11.ok && !after11.questions?.[0]?.image, `${r11.status} ${(after11.questions?.[0]?.image || "").slice(0, 30)}`);

if (seat) {
  // Put the picture back, assign the quiz to the lab's staff login, and read it as that person.
  await send(`${API}/veritacomp/quizzes/${quiz.id}`, quizBody([q("q1", PNG), q("q2")]), "PUT");
  const ra = await send(`${API}/veritacomp/quizzes/${quiz.id}/assignments`, { staff_employee_ids: [seat.staff_employee_id] });
  const assigned = await j(ra);
  const HS = hdr(seat.seat_user_id);
  const list = await j(await fetch(`${API}/staff-portal-session/quizzes?employee_id=${seat.staff_employee_id}`, { headers: HS }));
  const rows = Array.isArray(list) ? list : (list.assignments || list.quizzes || []);
  const mine = rows.find((a) => Number(a.quiz_id) === Number(quiz.id));
  const assignmentId = mine?.assignment_id ?? mine?.id;
  const detail = await j(await fetch(`${API}/staff-portal-session/quizzes/${assignmentId}?employee_id=${seat.staff_employee_id}`, { headers: HS }));
  const dq1 = (detail.questions || []).find((x) => x.id === "q1");
  const attempt = await j(await send(`${API}/staff-portal-session/quizzes/${assignmentId}/attempt`,
    { employee_id: seat.staff_employee_id, answers: [{ question_id: "q1", selected_answer: "B" }, { question_id: "q2", selected_answer: "B" }], typed_signature: "QA Staff" }, "POST", HS));
  const resQs = attempt.questions || attempt.result?.questions || [];
  const rq1 = resQs.find((x) => x.id === "q1");
  check("12. a staff login sees the picture on the assigned quiz and in the scored result", ra.ok && dq1?.image === PNG && rq1?.image === PNG,
    `assign ${ra.status} ${JSON.stringify(assigned).slice(0, 80)} assignment=${assignmentId} take=${(dq1?.image || "none").slice(0, 25)} result=${(rq1?.image || "none").slice(0, 25)} ${JSON.stringify(attempt).slice(0, 160)}`);
} else console.log("SKIP  12. no staff login on this lab in the copy");

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
