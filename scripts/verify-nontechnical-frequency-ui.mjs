// scripts/verify-nontechnical-frequency-ui.mjs
// Gate 3 step 8 receipt for the site-set non-technical competency frequency (Michael 2026-11-04, go Q216 = 1, 2026-11-06). Drives the real page: blank changes
// nothing a person sees, an owner sets it and the due list and a program's roster follow, an editor sees it read-only, a Staff login sees only their own date,
// a refused save says so, and clearing it puts everything back. Light, dark and phone. Runs against a LOCAL production build on a scratch database with made-up
// people (it registers people and writes rows, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5198 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-nontechnical-frequency-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");

const BASE = process.env.PW_BASE || "http://localhost:5198", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up records directly to a scratch database.");
const PW = ["Frequency", "made", "up", "77!"].join("-");

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const shot = async (page, name) => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, `site-ntfreq-${name}.png`) }); };

// Dates relative to today, so the receipt reads the same whenever it runs. Same month-end clamp as the server.
const monthsAgo = (n) => { const d = new Date(); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
const plusMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
const shown = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };

// ── Made-up lab, an owner, an editor, a Staff login, three people on one non-technical program and a new-hire evaluation ──
const stamp = Date.now();
const register = async (tag, name) => {
  const email = `ntfreq-${tag}-${stamp}@example.test`;
  const r = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
  return { email, token: r.token };
};
const OWNER = await register("owner", "Made Up Owner"), EDITOR = await register("editor", "Made Up Editor"), ANN = await register("ann", "Ann Self");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Frequency UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Frequency UI Lab", cliaNumber: "99D9999994", accreditationBody: "CLIA_ONLY", complexity: "high" }, OWNER.token);
const staff = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).id;
const annId = await staff("Self", "Ann"), benId = await staff("Reyes", "Ben"), caraId = await staff("Ng", "Cara"), deeId = await staff("Ortiz", "Dee");
const program = async (name, extra = {}) => (await call("POST", `${L}/competency/programs`, { name, department: "Core Lab", type: "nontechnical", checklistItems: [{ description: "Made-up item" }], ...extra }, OWNER.token)).id;
const safety = await program("Made-up Safety Rules"), evaluation = await program("Made-up New-Hire Evaluation", { recordKind: "evaluation" });

const annDate = monthsAgo(23);    // due in about a month at 24
const benDate = monthsAgo(30);    // overdue at 12 and 24; about 6 months out at 36
const caraDate = monthsAgo(2);    // well ahead at any setting
const now = new Date().toISOString();
const sdb = new Database(process.env.SCRATCH_DB);
const uid = (u) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(u.email).id;
const ownerId = uid(OWNER);
const comp = (staffId, name) => sdb.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(staffId, labId)?.id
  ?? sdb.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, ?, 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(ownerId, labId, name, staffId, now).lastInsertRowid;
const annC = Number(comp(annId, "Ann Self")), benC = Number(comp(benId, "Ben Reyes")), caraC = Number(comp(caraId, "Cara Ng")), deeC = Number(comp(deeId, "Dee Ortiz"));
const record = (programId, employeeId, date, status = "pass", type = "annual") => sdb.prepare(
  "INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, locked, completion_date, competency_type, created_at) VALUES (?, ?, ?, ?, 'Made Up Evaluator', ?, 1, ?, 'nontechnical', ?)"
).run(programId, employeeId, type, date, status, date, now);
record(safety, annC, annDate); record(safety, benC, benDate); record(safety, caraC, caraDate);
record(safety, deeC, monthsAgo(6), "remediation");
record(evaluation, benC, benDate, "pass", "30day");
for (const u of [EDITOR, ANN]) sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, uid(u), now, now, now);
const seat = (u, type, perms, rosterId) => sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)")
  .run(ownerId, u.email, uid(u), now, now, perms, `ntfreq-${uid(u)}-${stamp}`, labId, type, rosterId);
seat(EDITOR, "active", '{"mode":"edit_all"}', null);
seat(ANN, "staff_portal", '{"mode":"view_all"}', annId);
sdb.prepare(`UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (${[OWNER, EDITOR, ANN].map(uid).join(",")})`).run();
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
const stored = () => sdb.prepare("SELECT competency_nontechnical_months AS m FROM labs WHERE id = ?").get(labId).m;
const recordsNow = () => JSON.stringify(sdb.prepare("SELECT * FROM competency_assessments WHERE program_id IN (?, ?) ORDER BY id").all(safety, evaluation));
const recordsAtStart = recordsNow();
check("made-up lab, an owner, an editor, a Staff login, and records on a non-technical program", !!labId && !!safety && !!evaluation && stored() === null);

// ── The browser ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
const open = async (who, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = await call("GET", "/api/auth/me", undefined, who.token);
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (scheme) localStorage.setItem("theme", scheme); }, [who.token, me.user ?? me, opts.colorScheme || null]);
  return page;
};
const home = async (page) => { await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" }); };
const card = (page) => page.getByTestId("nt-frequency-card");
const openCard = async (page) => { await home(page); await card(page).waitFor({ timeout: 20000 }); await card(page).scrollIntoViewIfNeeded(); };
const programPage = async (page, id) => { await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${id}`, { waitUntil: "networkidle" }); };
const save = async (page, months) => {
  await page.getByTestId("nt-frequency-select").selectOption(months);
  const res = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().includes("/competency/nontechnical-frequency"));
  await page.getByTestId("nt-frequency-save").click();
  return (await res).status();
};
const roster = (page, id) => page.getByTestId(`roster-status-${id}`);
const rosterDue = (page, id) => page.getByTestId(`roster-nt-due-${id}`);
const reassessmentLabel = async (page) => {
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${safety}?newAssessment=1`, { waitUntil: "networkidle" });
  await page.getByTestId("nt-assessment-type").waitFor({ timeout: 20000 });
  await page.getByTestId("nt-assessment-type").click();
  const text = await page.getByTestId("nt-type-reassessment").innerText();
  await page.keyboard.press("Escape");
  return text.trim();
};

// Blank: what a lab has today.
const page = await open(OWNER);
await openCard(page);
const select = page.getByTestId("nt-frequency-select");
check("blank: the owner gets the setting, reading Not set", (await select.inputValue()) === "" && /Not set: no due dates/.test(await select.innerText()), await select.innerText());
check("the choices are every 12, 24 and 36 months", /Every 12 months/.test(await select.innerText()) && /Every 24 months/.test(await select.innerText()) && /Every 36 months/.test(await select.innerText()));
check("blank: Save stays off until something changes", await page.getByTestId("nt-frequency-save").isDisabled());
check("blank: no due list", (await page.getByTestId("nt-due-list").count()) === 0 && (await page.getByTestId("nt-due-none").count()) === 0);
const help = await page.getByTestId("nt-frequency-help").innerText();
check("the words: TJC by the current standard, no year, no quoted text, no em dash", /current TJC standard requires non-technical competency every 2 years; other accrediting bodies do not\./.test(help) && !/\b(19|20)\d{2}\b/.test(help) && !help.includes("—") && !help.includes('"'), help);
check("the words: technical and waived timing and new-hire evaluations don't change, and no record is changed", /Technical and waived competency timing and new-hire evaluations do not change/.test(help) && /No record on file is changed/.test(help), help);
await shot(page, "blank");
await programPage(page, safety);
await roster(page, benC).waitFor({ timeout: 20000 });
check("blank: a program's roster reads as it does today, Current with no date, however old the record", (await roster(page, benC).innerText()) === "Current" && (await rosterDue(page, benC).count()) === 0 && (await page.getByTestId("program-nt-frequency").count()) === 0);
check("blank: remediation and Not assessed read as today", (await roster(page, deeC).innerText()) === "Remediation");
check("blank: the assessment form still offers 2-Year Reassessment", (await reassessmentLabel(page)) === "2-Year Reassessment");

// A refused save says so and leaves the screen honest.
await openCard(page);
await page.route("**/competency/nontechnical-frequency", (route) => (route.request().method() === "PUT" ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Only the lab's owner or an admin can change this.", code: "OWNER_OR_ADMIN_ONLY" }) }) : route.fallback()));
const refused = await save(page, "24");
check("a refused save: the server's words show, and nothing is stored", refused === 403 && /Only the lab's owner or an admin/.test(await page.locator("body").innerText()) && stored() === null);
await page.unroute("**/competency/nontechnical-frequency");

// Set it.
await openCard(page);
const saved = await save(page, "24");
await page.getByTestId("nt-due-list").waitFor({ timeout: 10000 });
const bodyAfter = await page.locator("body").innerText();
check("every 24 months: saved, and the toast says how many and that no record changed", saved === 200 && stored() === 24 && /every 24 months/.test(bodyAfter) && /1 overdue, 2 due in the next 90 days\. No record was changed\./.test(bodyAfter), bodyAfter.slice(0, 200));
const counts = await page.getByTestId("nt-due-counts").innerText();
check("the counts: one overdue, two due soon, one current", /1 overdue/.test(counts) && /2 due in the next 90 days/.test(counts) && /1 current/.test(counts), counts);
const rows = await page.getByTestId("nt-due-row").allInnerTexts();
const line = (name) => rows.find((r) => r.includes(name)) || "";
check("Ben is overdue, with the date from his last pass", line("Ben Reyes").includes(`Overdue, due ${shown(plusMonths(benDate, 24))}`) && line("Ben Reyes").includes("Made-up Safety Rules"), rows.join(" | "));
check("Ann is due next, with her date", line("Ann Self").includes(`Due ${shown(plusMonths(annDate, 24))}`), rows.join(" | "));
check("Dee, with remediation open, reads Reassessment due", line("Dee Ortiz").includes("Reassessment due"), rows.join(" | "));
check("Cara, well ahead, isn't listed", !line("Cara Ng"), rows.join(" | "));
check("the evaluation record isn't listed", rows.every((r) => !r.includes("Evaluation")), rows.join(" | "));
await card(page).scrollIntoViewIfNeeded();
await shot(page, "set");
await home(page);
await card(page).waitFor({ timeout: 20000 });
check("after a reload it still reads every 24 months", (await page.getByTestId("nt-frequency-select").inputValue()) === "24");

// A row opens the program, and its roster follows.
await page.getByTestId("nt-due-row").first().click();
await roster(page, benC).waitFor({ timeout: 20000 });
check("a row opens the program, and Ben's badge is Overdue with his date", page.url().includes(`/veritacomp-app/${safety}`) && (await roster(page, benC).innerText()) === "Overdue" && (await rosterDue(page, benC).innerText()).includes(shown(plusMonths(benDate, 24))), page.url());
check("Cara stays Current, now with a date", (await roster(page, caraC).innerText()) === "Current" && (await rosterDue(page, caraC).innerText()) === `Due ${shown(plusMonths(caraDate, 24))}`);
check("Dee's remediation stays Remediation and says a reassessment is due", (await roster(page, deeC).innerText()) === "Remediation" && (await rosterDue(page, deeC).innerText()) === "Reassessment due");
check("the program says how often it comes due", /Every 24 months/.test(await page.getByTestId("program-nt-frequency").innerText()));
await shot(page, "program");
check("set: the form's label no longer says 2-Year", (await reassessmentLabel(page)) === "Reassessment");
await programPage(page, evaluation);
await page.getByText("Employee Roster").waitFor({ timeout: 20000 });
check("a new-hire evaluation follows none of it", (await page.getByTestId("program-nt-frequency").count()) === 0 && (await rosterDue(page, benC).count()) === 0 && (await roster(page, benC).innerText()) === "Current");

// Another choice moves the dates.
await openCard(page);
await save(page, "36");
await page.getByTestId("nt-due-counts").filter({ hasText: "0 overdue" }).waitFor({ timeout: 10000 });
const counts36 = await page.getByTestId("nt-due-counts").innerText();
check("every 36 months: nobody overdue now, and Ben is off the list", /0 overdue/.test(counts36) && (await page.getByTestId("nt-due-row").allInnerTexts()).every((r) => !r.includes("Ben Reyes")), counts36);
await save(page, "24");
await page.getByTestId("nt-due-counts").filter({ hasText: "1 overdue" }).waitFor({ timeout: 10000 });

// An editor sees it and can't change it.
const editor = await open(EDITOR);
await openCard(editor);
check("an editor sees the setting as words, with no control", (await editor.getByTestId("nt-frequency-select").count()) === 0 && (await editor.getByTestId("nt-frequency-save").count()) === 0 && (await editor.getByTestId("nt-frequency-value").innerText()) === "Every 24 months");
check("an editor is told who can change it", /Only the lab's owner or an admin can change this\./.test(await editor.getByTestId("nt-frequency-readonly").innerText()));
check("an editor sees the same due list", (await editor.getByTestId("nt-due-row").count()) === 3);
await card(editor).scrollIntoViewIfNeeded();
await shot(editor, "editor");

// A Staff login sees only their own date.
const staffPage = await open(ANN);
await home(staffPage);
await staffPage.getByTestId("staff-own-home").waitFor({ timeout: 20000 });
await staffPage.getByTestId("staff-own-nt-due").waitFor({ timeout: 20000 });
const staffText = await staffPage.getByTestId("staff-own-home").innerText();
check("a Staff login sees their own due date on their program", (await staffPage.getByTestId("staff-own-nt-due").innerText()) === `Due ${shown(plusMonths(annDate, 24))}`, staffText);
check("a Staff login sees nobody else, and no setting to change", !/Ben Reyes|Cara Ng|Dee Ortiz/.test(staffText) && (await staffPage.getByTestId("nt-frequency-card").count()) === 0, staffText);
await shot(staffPage, "staff");

// Dark and phone.
const dark = await open(OWNER, { colorScheme: "dark" });
await openCard(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "set-dark");
await programPage(dark, safety);
await roster(dark, benC).waitFor({ timeout: 20000 });
await roster(dark, benC).scrollIntoViewIfNeeded();
await shot(dark, "program-dark");

const phone = await open(OWNER, { viewport: { width: 375, height: 812 } });
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await openCard(phone);
check("phone: VeritaComp has no sideways scroll", await noSideways(phone));
const box = await phone.getByTestId("nt-frequency-select").boundingBox();
check("phone: the control fits the screen", !!box && box.x >= 0 && box.x + box.width <= 375, JSON.stringify(box));
await shot(phone, "set-phone");
await programPage(phone, safety);
await roster(phone, benC).waitFor({ timeout: 20000 });
check("phone: the roster has no sideways scroll", await noSideways(phone));
await roster(phone, benC).scrollIntoViewIfNeeded();
await shot(phone, "program-phone");

// Clear it: everything back.
await openCard(page);
const clearedStatus = await save(page, "");
await page.getByTestId("nt-due-list").waitFor({ state: "detached", timeout: 10000 });
check("cleared: stored blank, the toast says so, and the due list goes", clearedStatus === 200 && stored() === null && /Non-technical frequency cleared/.test(await page.locator("body").innerText()));
// Open the program from here, in the same session, so nothing the page remembered from before the save can show.
await page.getByTestId(`program-card-${safety}`).getByRole("link", { name: /open/i }).or(page.getByTestId(`program-card-${safety}`).getByRole("button", { name: /open/i })).first().click();
await roster(page, benC).waitFor({ timeout: 20000 });
check("cleared, in the same session: the roster shows no old date", (await roster(page, benC).innerText()) === "Current" && (await rosterDue(page, benC).count()) === 0 && (await page.getByTestId("program-nt-frequency").count()) === 0);
await programPage(page, safety);
await roster(page, benC).waitFor({ timeout: 20000 });
check("cleared: the roster reads as it did, Current with no date", (await roster(page, benC).innerText()) === "Current" && (await rosterDue(page, benC).count()) === 0 && (await page.getByTestId("program-nt-frequency").count()) === 0);
check("cleared: the form says 2-Year Reassessment again", (await reassessmentLabel(page)) === "2-Year Reassessment");
check("through all of it, no competency record changed", recordsNow() === recordsAtStart);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
sdb.close();
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
