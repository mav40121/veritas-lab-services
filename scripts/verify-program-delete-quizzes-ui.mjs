// scripts/verify-program-delete-quizzes-ui.mjs
// Gate 3 receipt for REQ-157 (Redington, 2026-11-18): on VeritaComp, the delete box for a program that still has quizzes says how many
// and why the program stays (a quiz shows on the Quiz tab only under its program), with no Delete button. If the list is out of date,
// the server's refusal lands in the same box. Once the quiz is gone the program deletes as before. Run against a LOCAL production build
// on a scratch database, with made-up people (it registers people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5263 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-program-delete-quizzes-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");

const BASE = process.env.PW_BASE || "http://localhost:5263", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up records directly to a scratch database.");
const PW = ["Quiz", "stays", "77!"].join("-");

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `programdelete-quizzes-${name}.png`) }); };

// ── Made-up lab, one owner, programs with one quiz, two quizzes, and one the list doesn't know about yet ──
const stamp = Date.now();
const email = `programquiz-${stamp}@example.test`;
const owner = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Program Quiz UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Program Quiz UI Lab", cliaNumber: "99D9999995", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mkProgram = async (name) => (await call("POST", `${L}/competency/programs`, { name, department: "Other", type: "technical" }, owner.token)).id;
const oneId = await mkProgram("Made-up Body Fluids"), twoId = await mkProgram("Made-up Two Quizzes"), staleId = await mkProgram("Made-up Out Of Date Program");

const now = new Date().toISOString();
const openDb = () => new Database(process.env.SCRATCH_DB);
const sdb = openDb();
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
sdb.close();
const addQuiz = (programId, title) => {
  const d = openDb();
  const id = d.prepare("INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)")
    .run(ownerId, programId, labId, title, ownerId, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now).lastInsertRowid;
  d.close();
  return Number(id);
};
const oneQuiz = addQuiz(oneId, "Made-up Body Fluid Quiz");
addQuiz(twoId, "Made-up Quiz One"); addQuiz(twoId, "Made-up Quiz Two");
const programRow = (id) => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) AS n FROM competency_programs WHERE id = ?").get(id).n; d.close(); return n; };
const quizzesOf = (id) => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) AS n FROM competency_quizzes WHERE program_id = ?").get(id).n; d.close(); return n; };
check("made-up lab, an owner, programs with one quiz, two quizzes and none yet", !!labId && quizzesOf(oneId) === 1 && quizzesOf(twoId) === 2 && quizzesOf(staleId) === 0);

// ── The browser ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = await call("GET", "/api/auth/me", undefined, owner.token);
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (scheme) localStorage.setItem("theme", scheme); }, [owner.token, me.user ?? me, opts.colorScheme || null]);
  return page;
};
const loadList = async (page) => {
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId(`program-card-${oneId}`).waitFor({ timeout: 20000 });
};
const card = (page, id) => page.getByTestId(`program-card-${id}`);
const trash = (page, id) => card(page, id).getByTestId("program-delete");
const dialog = (page) => page.getByRole("dialog");
const deleteCalls = (page) => { const seen = []; page.on("request", (r) => { if (r.method() === "DELETE" && r.url().includes("/competency/programs/")) seen.push(r.url()); }); return seen; };
const WHY = /A quiz shows on the Quiz tab only under its program, so the program stays while it has quizzes\./;

const page = await open();
const sent = deleteCalls(page);
await loadList(page);
await trash(page, oneId).click();
await dialog(page).waitFor({ timeout: 10000 });
const oneText = await dialog(page).innerText();
check("one quiz: the box says it can't be deleted, how many, and why", /This program can't be deleted/.test(oneText) && /This program has 1 quiz\./.test(oneText) && WHY.test(oneText), oneText);
check("one quiz: it says how to go on (delete a quiz first; one with results can't be)", /Delete a quiz first if it's no longer needed; a quiz with results can't be deleted\./.test(oneText), oneText);
check("one quiz: no Delete button, only Close", (await page.getByTestId("program-delete-confirm").count()) === 0 && (await page.getByTestId("program-delete-close").count()) === 1);
check("one quiz: no em dash", !oneText.includes("—"), oneText);
await shot(page, "refusal");
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
check("one quiz: nothing was sent; the program and its quiz are still there", sent.length === 0 && programRow(oneId) === 1 && quizzesOf(oneId) === 1, sent.join(" "));

await trash(page, twoId).click();
await dialog(page).waitFor({ timeout: 10000 });
const twoText = await dialog(page).innerText();
check("two quizzes: the words are plural", /This program has 2 quizzes\./.test(twoText), twoText);
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });

// The list is out of date: it says no quizzes, the server knows better, and the refusal lands in the same box.
addQuiz(staleId, "Made-up Late Quiz");
await trash(page, staleId).click();
await dialog(page).waitFor({ timeout: 10000 });
check("out of date: the list said none, so the confirm box opens", /Delete Program\?/.test(await dialog(page).innerText()));
const refused = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/competency/programs/${staleId}`));
await page.getByTestId("program-delete-confirm").click();
const refusedRes = await refused;
check("out of date: the server refuses with 409", refusedRes.status() === 409, String(refusedRes.status()));
await page.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
const staleText = await dialog(page).innerText();
check("out of date: the refusal lands in the same box, in the same words", /This program can't be deleted/.test(staleText) && /This program has 1 quiz\./.test(staleText) && WHY.test(staleText), staleText);
check("out of date: the Delete button is gone", (await page.getByTestId("program-delete-confirm").count()) === 0);
await shot(page, "refusal-from-server");
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
check("out of date: the program and its quiz are still there", programRow(staleId) === 1 && quizzesOf(staleId) === 1);

// Once its quiz is gone, the program deletes with the existing box.
const dq = await fetch(`${BASE}/api/veritacomp/quizzes/${oneQuiz}`, { method: "DELETE", headers: { Authorization: `Bearer ${owner.token}`, "X-Active-Lab-Id": String(labId) } });
check("the quiz with no results deletes", dq.status === 200, String(dq.status));
await loadList(page);
await trash(page, oneId).click();
await dialog(page).waitFor({ timeout: 10000 });
check("after its quiz is gone: the confirm box", /Delete Program\?/.test(await dialog(page).innerText()) && (await page.getByTestId("program-delete-confirm").count()) === 1);
const deleted = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/competency/programs/${oneId}`));
await page.getByTestId("program-delete-confirm").click();
check("after its quiz is gone: the delete succeeds", (await deleted).status() === 200);
await card(page, oneId).waitFor({ state: "detached", timeout: 10000 });
check("after its quiz is gone: the card goes and the row is gone", programRow(oneId) === 0 && (await card(page, oneId).count()) === 0);

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
await card(dark, twoId).waitFor({ timeout: 20000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await trash(dark, twoId).click();
await dark.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
await shot(dark, "refusal-dark");

const phone = await open({ viewport: { width: 375, height: 812 } });
await phone.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
await card(phone, twoId).waitFor({ timeout: 20000 });
await trash(phone, twoId).click();
await phone.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
const box = await dialog(phone).boundingBox();
check("phone: the box fits the screen", !!box && box.x >= 0 && box.x + box.width <= 375, JSON.stringify(box));
await shot(phone, "refusal-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
