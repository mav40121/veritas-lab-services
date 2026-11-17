// scripts/verify-quiz-scores-ui.mjs
//
// Browser receipt (Gate 3 step 8) for Quiz scores (Michael 2026-11-17, Q347 = 1: "it is difficult to find peoples quiz
// scores"). On a local production build with a scratch DB and made-up people, a quiz and scores written through the app's
// own routes, never production:
//   Q1. VeritaComp's roster header shows "Quiz scores" beside Signed competencies; it opens the list of every scored quiz
//       (assigned attempts with their numbers, a quiz given on a record, typed Element 6 scores), newest first
//   Q2. the person, quiz, result and date filters cut the list, and the count says so
//   Q3. Download Excel saves VeritaComp_Quiz_Scores_<date>.xlsx holding exactly the rows shown (About first)
//   Q4. a person's page has a Quiz scores section with only their scores and no person filter
//   Q5. a Staff login reaches "My quiz scores" from their VeritaComp screen and sees only their own, naming no coworker
//   Q6. a view-only seat gets no section on a person's page, and the list says who may read it
//   Q7. phone width: no sideways scroll, the download button on screen
//   Q8. dark mode: the Pass and Fail badges read at 4.5:1 or better
// Screenshots go to OUT.
// Run: PW_BASE=http://localhost:5261 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-quiz-scores-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Quiz", "Scores", "88!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const day = "2026-10-15";

let LAB = 0;
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(token && LAB ? { "X-Active-Lab-Id": String(LAB) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const register = async (tag, name) => {
  const email = `quizscores-ui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  const id = Number(sql("SELECT id FROM users WHERE email = ?", email)?.id);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", id);
  return { email, token: reg.body.token, id };
};

// ── Fixture: made-up lab, people, a quiz, attempts, a quiz given on a record, typed Element 6 scores ──
const OWNER = await register("owner", "Made-up Owner Pell");
LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Quiz Lab", plan: "hospital" })).body.labId;
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790016', time_zone = 'America/New_York' WHERE id = ?", LAB);
const L = `/api/labs/${LAB}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Quiz Lab", cliaNumber: "22D7790016", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
const person = async (last, first) => Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "MLS", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).body.id);
const samId = await person("Retaker", "Sam"), zedId = await person("Quillfeather", "Zed"), noraId = await person("Paperquiz", "Nora");
const seatFor = async (tag, name, type, perms, rosterId) => {
  const u = await register(tag, name);
  sql(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`, LAB, u.id, now, now, now);
  sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    OWNER.id, u.email, u.id, now, now, perms, `quizscores-ui-${tag}-${stamp}`, LAB, type, rosterId);
  return u;
};
const SAM = await seatFor("sam", "Made-up Sam Retaker", "staff_portal", '{"mode":"view_all"}', samId);
const ZED = await seatFor("zed", "Made-up Zed Quillfeather", "staff_portal", '{"mode":"view_all"}', zedId);
const VIEWER = await seatFor("viewer", "Made-up Viewer", "view_only", '{"mode":"view_all"}', null);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).body.id;
const t = (analyte) => ({ analyte, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Made-up Chemistry Analyzer", category: "Chemistry", tests: [t("Analyte P")] },
  { name: "Made-up Second Analyzer", category: "Chemistry", tests: [t("Analyte U")] },
] }, OWNER.token);
const instOf = (name) => Number(sql("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?", name, mapId)?.id);
const P = instOf("Made-up Chemistry Analyzer"), U = instOf("Made-up Second Analyzer");
for (const [emp, inst] of [[noraId, P], [noraId, U], [samId, P], [zedId, P]]) sql("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)", emp, inst, now);
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical" }, OWNER.token)).body.id;
const QUESTIONS = [
  { id: "q1", question: "Made-up question one?", options: ["A. first", "B. second", "C. third"], correct_answer: "A", explanation: "Made-up reason one." },
  { id: "q2", question: "Made-up question two?", options: ["A. first", "B. second", "C. third"], correct_answer: "B", explanation: "Made-up reason two." },
  { id: "q3", question: "Made-up question three?", options: ["A. first", "B. second", "C. third"], correct_answer: "C", explanation: "Made-up reason three." },
];
const quizId = Number((await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Chemistry Quiz", questions: QUESTIONS }, OWNER.token)).body.id);
sql("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?", LAB, quizId);
await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, zedId] }, OWNER.token);
const take = async (u, sid, picks) => {
  const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, u.token);
  const open = (list.body.quizzes || []).find((q) => q.quiz_id === quizId && q.status === "assigned");
  return open ? call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: sid, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] })), typed_signature: "Made-up signature" }, u.token) : { status: 0 };
};
const s1 = await take(SAM, samId, ["A", "A", "C"]);
await call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, { staff_employee_id: samId }, OWNER.token);
const s2 = await take(SAM, samId, ["A", "B", "C"]);
const z1 = await take(ZED, zedId, ["A", "B", "C"]);
const put = (inst, el6) => call("PUT", `${L}/competency/employee/${noraId}/test-system/${inst}`, { elements: [{ num: 1, specimenId: "S-1" }, { num: 6, ...el6 }] }, OWNER.token);
const e1 = await put(P, { quizId: "Paper chemistry quiz", score: 90, dateTaken: day, passed: true });
await put(U, { quizId: "Outside chemistry quiz", score: 85, dateTaken: "2026-10-20" });
const noraComp = Number(sql("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?", noraId, LAB)?.id);
const given = await call("POST", "/api/veritacomp/quiz-results", { quizId, employeeId: noraComp, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: ["A", "A", "C"][i] })) }, OWNER.token);
check("setup: a made-up lab, 3 people, a quiz taken 3 times on staff logins, a quiz given on a record, 2 typed scores",
  LAB > 0 && s1.status === 200 && s2.status === 200 && z1.status === 200 && e1.status === 200 && given.status === 200, JSON.stringify({ s1: s1.status, s2: s2.status, z1: z1.status, e1: e1.status, given: given.status }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; return page.goto(url, opts); } };
const openAs = async (who, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, who.token]);
  await page.evaluate(([tk, usr, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, LAB]);
  await go(page, `${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const contrast = async (page, locator) => page.evaluate((el) => {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color);
  let n = el, bg = null;
  while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}, await locator.elementHandle());
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: true });
const rowCount = (page) => page.locator('[data-testid="quiz-score-row"]').count();
const countText = async (page) => (await page.locator('[data-testid="quiz-scores-count"]').textContent())?.trim();

try {
  // Q1. The roster link opens the list.
  const page = await openAs(OWNER, `/labs/${LAB}/veritacomp-app`);
  const link = page.locator('[data-testid="roster-quiz-scores-link"]');
  await link.first().waitFor({ timeout: 20000 });
  check("Q1a. the roster header shows Quiz scores beside Signed competencies", await link.first().isVisible() && await page.locator('[data-testid="roster-signed-link"]').first().isVisible());
  await link.first().click();
  await page.waitForURL(/\/veritacomp-app\/quiz-scores/, { timeout: 15000 });
  await page.locator('[data-testid="quiz-score-row"]').first().waitFor({ timeout: 15000 });
  check("Q1b. it opens Quiz scores with every score: 6 rows", (await page.locator('[data-testid="quiz-scores-title"]').textContent())?.trim() === "Quiz scores" && await rowCount(page) === 6 && await countText(page) === "6 quiz scores", `${await rowCount(page)} ${await countText(page)}`);
  const body = await page.locator('[data-testid="quiz-scores"]').innerText();
  check("Q1c. assigned attempts carry their numbers; the record and Element 6 kinds are named", /Assigned quiz, attempt 2/.test(body) && /Assigned quiz, attempt 1/.test(body) && /Taken on a record/.test(body) && /Entered on Element 6/.test(body), body.slice(0, 300));
  check("Q1d. no answers or answer key on the page", !/Made-up question|Made-up reason/.test(body));
  await shot(page, "quiz-scores-1-list-light.png");

  // Q2. Filters.
  await page.locator('[data-testid="quiz-scores-person"]').selectOption({ label: "Sam Retaker" });
  check("Q2a. person filter: Sam's two attempts", await rowCount(page) === 2 && await countText(page) === "2 of 6 quiz scores", await countText(page));
  await page.locator('[data-testid="quiz-scores-result"]').selectOption("fail");
  check("Q2b. and Fail: his first attempt only", await rowCount(page) === 1 && /attempt 1/.test(await page.locator('[data-testid="quiz-score-row"]').first().innerText()));
  await shot(page, "quiz-scores-2-filtered-light.png");
  await page.locator('[data-testid="quiz-scores-person"]').selectOption("");
  check("Q2c. Fail alone: Sam's first attempt and Nora's record", await rowCount(page) === 2);

  // Q3. Download the filtered rows.
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.locator('[data-testid="quiz-scores-download"]').click()]);
  const file = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet("Quiz Scores");
  const rows = ws.getSheetValues().slice(2).filter(Boolean);
  check("Q3. Download Excel saves the rows shown: VeritaComp_Quiz_Scores_<date>.xlsx, About first, 2 Fail rows",
    /^VeritaComp_Quiz_Scores_\d{4}-\d{2}-\d{2}\.xlsx$/.test(dl.suggestedFilename()) && wb.worksheets[0].name === "About" && rows.length === 2 && rows.every((r) => r[8] === "Fail"),
    `${dl.suggestedFilename()} ${rows.length}`);
  await page.locator('[data-testid="quiz-scores-result"]').selectOption("");
  await page.locator('[data-testid="quiz-scores-quiz"]').selectOption("Paper chemistry quiz");
  check("Q2d. quiz filter: the one typed paper quiz, which reads Pass", await rowCount(page) === 1 && (await page.locator('[data-testid="quiz-score-result"]').first().textContent())?.trim() === "Pass");
  await page.locator('[data-testid="quiz-scores-quiz"]').selectOption("");
  await page.locator('[data-testid="quiz-scores-from"]').fill("2026-10-16");
  await page.locator('[data-testid="quiz-scores-to"]').fill("2026-10-31");
  check("Q2e. date range: the one score taken 10/20", await rowCount(page) === 1 && /Outside chemistry quiz/.test(await page.locator('[data-testid="quiz-score-row"]').first().innerText()));
  await page.context().close();

  // Q4. The person page.
  const pp = await openAs(OWNER, `/labs/${LAB}/veritacomp-app/employee/${noraId}`);
  await pp.locator('[data-testid="person-quiz-scores"] [data-testid="quiz-score-row"]').first().waitFor({ timeout: 20000 });
  check("Q4. Nora's page: a Quiz scores section with her 3 scores and no person filter",
    (await pp.locator('[data-testid="quiz-scores-heading"]').textContent())?.trim() === "Quiz scores" && await pp.locator('[data-testid="person-quiz-scores"] [data-testid="quiz-score-row"]').count() === 3
    && await pp.locator('[data-testid="person-quiz-scores"] [data-testid="quiz-scores-person"]').count() === 0);
  await pp.locator('[data-testid="person-quiz-scores"]').scrollIntoViewIfNeeded();
  await shot(pp, "quiz-scores-3-person-page-light.png");
  await pp.context().close();

  // Q5. A Staff login's own.
  const sp = await openAs(SAM, `/labs/${LAB}/veritacomp-app`);
  const mine = sp.locator('[data-testid="staff-own-quiz-scores"]');
  await mine.waitFor({ timeout: 20000 });
  await mine.click();
  await sp.waitForURL(/\/veritacomp-app\/quiz-scores/, { timeout: 15000 });
  await sp.locator('[data-testid="quiz-score-row"]').first().waitFor({ timeout: 15000 });
  const spText = await sp.locator("main, body").first().innerText();
  check("Q5. a Staff login opens My quiz scores: their 2 attempts, no person filter, no coworker named",
    (await sp.locator('[data-testid="quiz-scores-title"]').textContent())?.trim() === "My quiz scores" && await rowCount(sp) === 2 && await sp.locator('[data-testid="quiz-scores-person"]').count() === 0 && !/Quillfeather|Paperquiz/.test(spText));
  await shot(sp, "quiz-scores-4-staff-own-light.png");
  await sp.context().close();

  // Q6. A view-only seat.
  const vp = await openAs(VIEWER, `/labs/${LAB}/veritacomp-app/employee/${noraId}`);
  await vp.waitForTimeout(1500);
  check("Q6a. a view-only seat gets no Quiz scores section on a person's page", await vp.locator('[data-testid="quiz-scores"]').count() === 0);
  await go(vp, `${BASE}/labs/${LAB}/veritacomp-app/quiz-scores`, { waitUntil: "networkidle" });
  await vp.locator('[data-testid="quiz-scores-error"]').waitFor({ timeout: 15000 });
  check("Q6b. and the list says who may read it", /owner or admin and anyone with edit access/.test(await vp.locator('[data-testid="quiz-scores-error"]').innerText()));
  await vp.context().close();

  // Q7. Phone width.
  const ph = await openAs(OWNER, `/labs/${LAB}/veritacomp-app/quiz-scores`, { viewport: { width: 375, height: 812 } });
  await ph.locator('[data-testid="quiz-score-row"]').first().waitFor({ timeout: 15000 });
  const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const btn = await ph.locator('[data-testid="quiz-scores-download"]').boundingBox();
  check("Q7. phone width: no sideways scroll, the download button on screen", overflow <= 0 && !!btn && btn.x >= 0 && btn.x + btn.width <= 375, `overflow ${overflow} btn ${JSON.stringify(btn)}`);
  await shot(ph, "quiz-scores-5-phone-light.png");
  await ph.context().close();

  // Q8. Dark mode.
  const dk = await openAs(OWNER, `/labs/${LAB}/veritacomp-app/quiz-scores`, { colorScheme: "dark" });
  await dk.locator('[data-testid="quiz-score-row"]').first().waitFor({ timeout: 15000 });
  const passBadge = dk.locator('[data-testid="quiz-score-row"][data-result="pass"] [data-testid="quiz-score-result"]').first();
  const failBadge = dk.locator('[data-testid="quiz-score-row"][data-result="fail"] [data-testid="quiz-score-result"]').first();
  const [cp, cf] = [await contrast(dk, passBadge), await contrast(dk, failBadge)];
  check("Q8. dark mode: Pass and Fail badges read at 4.5:1 or better", cp >= 4.5 && cf >= 4.5, `${cp.toFixed(2)} ${cf.toFixed(2)}`);
  await shot(dk, "quiz-scores-6-list-dark.png");
  await dk.context().close();
} catch (e) {
  failures++;
  console.log("FAIL  threw: " + (e?.stack || e));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
