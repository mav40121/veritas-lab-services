// scripts/verify-quiz-follows-group-ui.mjs
// Gate 3 receipt for REQ-131 (Cathy Thornton, Redington): a quiz follows the lab's method group. Run against a LOCAL production build on a scratch database, with made-up people (it
// registers people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-quiz-follows-group-ui.mjs
// In a real browser, on the real tab: group an analyzer that no program row names, then see it on the quiz card, on Edit Quiz, on New Quiz and on the "Tests knowledge of" choice. The quiz
// stays labeled as it was. The Element 6 picker on an unsigned record finds the quiz through the group and says no quiz once the group is split. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Quiz", "group", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `site-quizgroup-${name}.png`), fullPage: false, animations: "disabled" });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const day = "2026-10-15";
const ownerEmail = `quizgroup-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Quiz Group UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Quiz Group UI Lab", cliaNumber: "99D9999996", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).j.id;
const t = (analyte) => ({ analyte, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
await fetch(`${BASE}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: [
  { name: "Made-up Chem One", category: "Chemistry", tests: [t("Made-up Sodium")] },
  { name: "Made-up Chem Two", category: "Chemistry", tests: [t("Made-up Potassium")] },
  { name: "Made-up Fast Kit", category: "Chemistry", tests: [t("Made-up Troponin")] },
  { name: "Made-up Heme", category: "Hematology", tests: [{ ...t("Made-up WBC"), specialty: "Hematology" }] },
] }) });
const pat = (await call("POST", `${L}/staff/employees`, { lastName: "Tester", firstName: "Pat", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999996' WHERE id = ?").run(labId);
  d.prepare("INSERT OR IGNORE INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) SELECT owner_user_id, id, 'Pat Tester', 'Made-up Tech', '2019-03-01', 'active', ?, ? FROM labs WHERE id = ?").run(pat, new Date().toISOString(), labId);
});
const group = (name, instrument) => ({ name, instruments: [instrument], analytes: [] });
// Her program: no row names the fast kit. A second program has a row for it, to reach the Element 6 picker.
const chem = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical", methodGroups: [group("Chemistry - One", "Made-up Chem One"), group("Chemistry - Two", "Made-up Chem Two"), group("Hematology", "Made-up Heme")] }, owner.token)).j.id;
const second = (await call("POST", `${L}/competency/programs`, { name: "Made-up Second", department: "Chemistry", type: "technical", methodGroups: [group("Second - One", "Made-up Chem One"), group("Second - Fast", "Made-up Fast Kit")] }, owner.token)).j.id;
const rowsOf = (programId) => scratch((d) => d.prepare("SELECT * FROM competency_method_groups WHERE program_id = ? ORDER BY id").all(programId));
const [rowOne, rowTwo, rowHeme] = rowsOf(chem), [secondOne, secondFast] = rowsOf(second);
const questions = [{ id: "q1", question: "Made-up question?", options: ["A. one", "B. two"], correct_answer: "A", explanation: "" }];
const quiz = async (programId, title, ids) => (await call("POST", `/api/veritacomp/programs/${programId}/quizzes`, { title, methodGroupIds: ids, methodGroupId: ids.length === 1 ? ids[0] : null, methodGroupName: null, questions }, owner.token)).j.id;
await quiz(chem, "Made-up Chem Quiz", [rowOne.id, rowTwo.id]);
await quiz(chem, "Made-up Heme Quiz", [rowHeme.id]);
await quiz(second, "Made-up Second Quiz", [secondOne.id]);
const quizzesRaw = () => scratch((d) => JSON.stringify(d.prepare("SELECT id, method_group_id, method_group_name, method_group_ids, questions FROM competency_quizzes WHERE program_id IN (?, ?) ORDER BY id").all(chem, second)));
const rowsRaw = () => JSON.stringify([...rowsOf(chem), ...rowsOf(second)]);
const quizzesBefore = quizzesRaw(), rowsBefore = rowsRaw();
const compId = scratch((d) => d.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(pat, labId))?.id;
const record = await call("POST", `${L}/competency/assessments`, { programId: second, employeeId: compId, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up Director", competencyType: "technical", status: "pass", items: [secondOne, secondFast].flatMap((mg) => [1, 2, 3, 4, 5, 6].map((n) => ({ methodNumber: n, elementNumber: n, methodGroupId: mg.id, methodGroupName: mg.name }))) }, owner.token);
check("made-up lab, programs, quizzes and an unsigned record", !!labId && !!rowOne && !!rowHeme && !!secondFast && !!record.j.id, JSON.stringify(record.j).slice(0, 200));

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  return page;
};
const quizzesUrl = (programId, extra = "") => `${BASE}/labs/${labId}/veritacomp-app/${programId}?tab=quizzes${extra}`;
const card = (page, title) => page.locator(".cursor-pointer", { hasText: title }).first();
const openCards = async (page) => { await page.goto(quizzesUrl(chem), { waitUntil: "networkidle" }); await page.getByText("Made-up Chem Quiz").first().waitFor({ timeout: 20000 }); };
const openEdit = async (page) => {
  await openCards(page);
  await card(page, "Made-up Chem Quiz").click();
  await page.getByRole("button", { name: "Edit Quiz" }).click();
  await page.getByRole("heading", { name: "Edit Quiz" }).waitFor({ timeout: 15000 });
};
const optionTexts = async (scope) => scope.getByTestId("quiz-group-option").allInnerTexts();
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Edit Quiz opens over the quiz preview, so the top dialog is the last one.
const dialogFits = (page) => page.evaluate(() => { const d = Array.from(document.querySelectorAll('[role="dialog"]')).pop(); return !!d && d.getBoundingClientRect().right <= window.innerWidth + 1 && d.scrollWidth <= d.clientWidth + 1; });
const dashFree = (text) => !/—/.test(text);

// ── Before: nothing about a group ────────────────────────────────────────────
const page = await open();
await openEdit(page);
const before = (await optionTexts(page)).join(" | ");
check("before: the options are the program's rows", /Chemistry - One/.test(before) && /Chemistry - Two/.test(before) && /Hematology/.test(before), before);
check("before: no group line, and the fast kit isn't there (what Cathy saw)", (await page.getByTestId("quiz-group-note").count()) === 0 && !/Fast Kit/.test(before));
await shot(page, "before-edit");
await openCards(page);
check("before: the card has no group line", (await page.getByTestId("quiz-follows-group").count()) === 0);

// ── Her step, on the real tab ────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/method-groups`, { waitUntil: "networkidle" });
await page.getByTestId("make-group").waitFor({ timeout: 20000 });
for (const name of ["Made-up Chem One", "Made-up Chem Two", "Made-up Fast Kit"]) await page.getByTestId("make-group").locator("label", { hasText: name }).getByTestId("pick-instrument").check();
await page.getByTestId("new-group-name").fill("Made-up Chem Group");
await page.getByTestId("create-group").click();
await page.getByTestId("lab-group").filter({ hasText: "Made-up Chem Group" }).waitFor({ timeout: 15000 });
check("the tab shows the group with the fast kit in it", /Made-up Fast Kit/.test(await page.getByTestId("lab-group").filter({ hasText: "Made-up Chem Group" }).innerText()));
await shot(page, "tab");

// ── After: the card ──────────────────────────────────────────────────────────
await openCards(page);
const line = page.getByTestId("quiz-follows-group");
check("the quiz card now shows the group with the fast kit", (await line.count()) === 1 && (await line.innerText()) === 'Follows method group "Made-up Chem Group": Made-up Chem One, Made-up Chem Two, Made-up Fast Kit', (await line.count()) ? await line.first().innerText() : "no line");
check("the line is on the chem quiz's card", (await card(page, "Made-up Chem Quiz").getByTestId("quiz-follows-group").count()) === 1);
check("the heme quiz's card has no line", (await card(page, "Made-up Heme Quiz").getByTestId("quiz-follows-group").count()) === 0);
check("the quiz's own label still reads its two rows", /Chemistry - One, Chemistry - Two/.test(await card(page, "Made-up Chem Quiz").innerText()));
await shot(page, "card");

// ── After: Edit Quiz ─────────────────────────────────────────────────────────
await openEdit(page);
const notes = await page.getByTestId("quiz-group-note").allInnerTexts();
check("Edit Quiz: the option now shows the fast kit", notes.some((n) => n === 'In group "Made-up Chem Group" with Made-up Chem Two, Made-up Fast Kit'), notes.join(" | "));
check("Edit Quiz: each of the two rows has its line, the heme row doesn't", notes.length === 2, notes.join(" | "));
check("Edit Quiz: what's checked is what it was", /Method Groups Covered \(2 of 3\)/.test(await page.getByRole("dialog").last().innerText()));
const choices = await page.locator('select[aria-label="Method group this question tests"]').first().locator("option").allInnerTexts();
check("Edit Quiz: the question's choice shows it too", choices.some((c) => c === "Tests knowledge of: Chemistry - One (with Made-up Chem Two, Made-up Fast Kit)"), choices.join(" | "));
check("Edit Quiz: a row in no group reads as it always did", choices.includes("Tests knowledge of: Hematology"), choices.join(" | "));
check("Edit Quiz: no em dash in the new words", dashFree(notes.join(" ")) && dashFree(choices.join(" ")));
await shot(page, "edit");
await page.getByRole("dialog").last().getByRole("button", { name: /Save Changes/ }).click();
await page.getByText("Quiz saved").first().waitFor({ timeout: 15000 });
check("saving the quiz with no change leaves its label alone", JSON.parse(quizzesRaw()).find((q) => JSON.parse(q.method_group_ids || "[]").length === 2)?.method_group_ids === JSON.stringify([rowOne.id, rowTwo.id]));

// ── After: New Quiz ──────────────────────────────────────────────────────────
await page.goto(quizzesUrl(chem, "&newQuiz=1"), { waitUntil: "networkidle" });
await page.getByRole("heading", { name: "New Quiz" }).waitFor({ timeout: 15000 });
const newNotes = await page.getByTestId("quiz-group-note").allInnerTexts();
check("New Quiz: the options show the fast kit", newNotes.some((n) => /Made-up Fast Kit/.test(n)) && newNotes.length === 2, newNotes.join(" | "));
await shot(page, "new");

// ── Nothing stored ───────────────────────────────────────────────────────────
check("nothing stored: the program rows are unchanged", rowsRaw() === rowsBefore);
check("nothing stored: no row names the fast kit in her program", !rowsOf(chem).some((r) => /Fast Kit/.test(r.instruments)));

// ── The Element 6 picker, on an unsigned record ──────────────────────────────
const openRecord = async (p) => {
  await p.goto(`${BASE}/labs/${labId}/veritacomp-app/${second}`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Assessments" }).click();
  await p.getByTestId("edit-assessment").first().click();
  await p.getByRole("button", { name: "Second - Fast" }).click();
  await p.getByText("Element 6: Problem-Solving Assessment - Quiz").first().waitFor({ timeout: 15000 });
};
await openRecord(page);
check("Element 6: the fast kit's row finds the quiz through the group", await page.getByRole("button", { name: "Take Quiz" }).isVisible());
await page.getByText("Element 6: Problem-Solving Assessment - Quiz").first().scrollIntoViewIfNeeded();
await shot(page, "element6");

// ── Light, dark, phone ───────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await openCards(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
check("dark: the card shows the line", (await dark.getByTestId("quiz-follows-group").count()) === 1);
await shot(dark, "card-dark");
await openEdit(dark);
check("dark: Edit Quiz shows the line", (await dark.getByTestId("quiz-group-note").count()) === 2);
await shot(dark, "edit-dark");

const phone = await open({ viewport: { width: 390, height: 844 } });
await openCards(phone);
check("phone: the card shows the line", (await phone.getByTestId("quiz-follows-group").count()) === 1);
check("phone: the card has no sideways scroll", await noSideways(phone));
await shot(phone, "card-phone");
await openEdit(phone);
check("phone: Edit Quiz shows the line", (await phone.getByTestId("quiz-group-note").count()) === 2);
check("phone: Edit Quiz fits the screen", await dialogFits(phone));
await phone.getByTestId("quiz-group-note").first().scrollIntoViewIfNeeded();
await shot(phone, "edit-phone");

// ── Split: back to how it was ────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/method-groups`, { waitUntil: "networkidle" });
await page.getByTestId("lab-group").filter({ hasText: "Made-up Chem Group" }).getByTestId("split-group").click();
await page.getByTestId("lab-group").filter({ hasText: "Made-up Chem Group" }).waitFor({ state: "detached", timeout: 15000 });
await openCards(page);
check("split: the card line is gone", (await page.getByTestId("quiz-follows-group").count()) === 0);
check("split: the quiz still reads its two rows", /Chemistry - One, Chemistry - Two/.test(await card(page, "Made-up Chem Quiz").innerText()));
await openEdit(page);
check("split: Edit Quiz has no group line", (await page.getByTestId("quiz-group-note").count()) === 0);
await openRecord(page);
check("split: Element 6 goes back to no quiz for the fast kit's row", await page.getByText("Quiz not yet assigned for this method group.").first().isVisible());
check("split: the rows are still unchanged", rowsRaw() === rowsBefore);
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
