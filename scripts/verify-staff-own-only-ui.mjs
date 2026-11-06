// scripts/verify-staff-own-only-ui.mjs
// Gate 3 receipt for Michael 2026-11-05, Q182 = 1: VeritaComp on screen for a Staff login shows only their own name and record, with no dead links, no empty
// error screens and no lists of coworkers. Owners and editors see what they always saw. Run against a LOCAL production build on a scratch database, with made-up
// people (it registers people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-own-only-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
const PW = ["Own", "only", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `site-staffonly-${name}.png`), fullPage });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const day = "2026-10-15";
const emailOf = (tag) => `staffonly-${tag}-${stamp}@example.test`;
const reg = (tag, name) => call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true });
const owner = await reg("owner", "Made Up Owner"), ann = await reg("ann", "Ann Self"), editor = await reg("editor", "Eddie Editor"), nell = await reg("nell", "Nell Unlinked"), tracker = await reg("tracker", "Terry Tracks");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: emailOf("owner"), labName: "Own Only UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Own Only UI Lab", cliaNumber: "99D9999997", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).id;
const t = (analyte, complexity) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
await fetch(`${BASE}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: [
  { name: "Made-up Analyzer", category: "Hematology", tests: [t("Made-up WBC", "MODERATE")] },
  { name: "Made-up Meter", category: "Point of Care", tests: [t("Made-up Glucose", "WAIVED")] },
  { name: "Made-up Unassigned", category: "Hematology", tests: [t("Made-up MCV", "MODERATE")] },
] }) });
const person = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).id;
const annId = await person("Self", "Ann"), benId = await person("Quillfeather", "Ben"), ediId = await person("Editor", "Eddie"), terryId = await person("Tracks", "Terry");
const tc = (await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, owner.token)).id;
await call("POST", `${L}/staff/employees`, { lastName: "Vance", firstName: "Nora", highestComplexity: "H", roles: [{ role: "TS", specialtyNumber: 8 }] }, owner.token);
const now = new Date().toISOString();
const openDb = () => new Database(process.env.SCRATCH_DB);
const sdb = openDb();
const instOf = (name) => sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId).id;
const ANALYZER = instOf("Made-up Analyzer"), METER = instOf("Made-up Meter"), UNASSIGNED = instOf("Made-up Unassigned");
const userId = (tag) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
const oid = userId("owner");
for (const [emp, inst] of [[annId, ANALYZER], [annId, METER], [benId, ANALYZER], [benId, METER], [ediId, ANALYZER]]) sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, inst, now);
const seat = (tag, type, perms, rosterId) => {
  const uid = userId(tag);
  sdb.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid, now, now, now);
  sdb.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`)
    .run(oid, emailOf(tag), uid, now, now, perms, `staffonly-${tag}-${stamp}`, labId, type, rosterId);
};
seat("ann", "staff_portal", '{"mode":"view_all"}', annId);
seat("nell", "staff_portal", '{"mode":"view_all"}', null);
seat("editor", "active", '{"mode":"edit_all"}', ediId); // an editor who also has a staff card
seat("tracker", "staff_portal", '{"mode":"view_all","overrides":{"veritatrack":"edit"}}', terryId); // a Staff seat given edit on VeritaTrack: its task-owner picker needs names
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?, ?, ?, ?)").run(oid, userId("ann"), userId("nell"), userId("editor"), userId("tracker"));
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999997' WHERE id = ?").run(labId);
sdb.close();

// The evaluator's entries: a signed method for each person, so the signed list has a coworker to leave out.
const signedEls = (spec) => [
  { num: 1, specimenId: spec, observerInitials: "CT", passed: true }, { num: 2, evidence: "Made-up evidence", date: day, passed: true }, { num: 3, qcDate: day, passed: true },
  { num: 4, dateObserved: day, observerInitials: "CT", passed: true }, { num: 5, sampleType: "PT", sampleId: "P", acceptable: true, passed: true }, { num: 6, quizId: "Q", score: 100, dateTaken: day, passed: true },
];
for (const [emp, spec] of [[annId, "ANN-SIGNED"], [benId, "QUILLFEATHER-SIGNED"]]) {
  await call("PUT", `${L}/competency/employee/${emp}/test-system/${ANALYZER}`, { elements: signedEls(spec) }, owner.token);
  await call("POST", `${L}/competency/employee/${emp}/test-system/${ANALYZER}/sign`, { signerStaffEmployeeId: tc, signerInitials: "CT" }, owner.token);
}
await call("PUT", `${L}/competency/employee/${annId}/test-system/${ANALYZER}`, { elements: [{ num: 4, dateObserved: day, observerInitials: "CT", passed: true }] }, owner.token);
const compOf = (emp) => { const d = openDb(); const r = d.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(emp, labId); d.close(); return r.id; };
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Hematology Program", department: "Hematology", type: "technical" }, owner.token)).id;
const progOther = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry Program", department: "Chemistry", type: "technical" }, owner.token)).id;
const rec = (emp, spec, programId) => call("POST", `${L}/competency/assessments`, { programId, employeeId: compOf(emp), assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up Evaluator", competencyType: "technical", status: "pass",
  items: [{ methodNumber: 1, elementNumber: 1, itemLabel: "Made-up", el1SpecimenId: spec, el1ObserverInitials: "CT", passed: true }] }, owner.token);
const annRec = await rec(annId, "ANN-PROGRAM", prog);
await rec(benId, "QUILLFEATHER-PROGRAM", prog);
await rec(benId, "QUILLFEATHER-CHEM", progOther);
check("made-up lab, Staff login, unlinked Staff login, an editor with a staff card, coworker records", !!labId && annId > 0 && !!annRec.id && !!prog && !!progOther);

const browser = await chromium.launch();
const errors = [];
const apiErrors = [];
const open = async (session, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/`);
  const me = await call("GET", "/api/auth/me", undefined, session.token);
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (scheme) localStorage.setItem("theme", scheme); }, [session.token, me.user ?? me, opts.colorScheme || null]);
  return page;
};
const labPath = (p) => `${BASE}/labs/${labId}${p}`;
const pageText = (page) => page.locator("main").innerText();
// Casey Tate is left out on purpose: she observed and signed Ann's own record, so her name belongs on it. Nora Vance has nothing to do with Ann's record.
const COWORKER = /Quillfeather|\bBen\b|Vance|Eddie/;
const noCoworkers = async (page, where) => {
  const text = await pageText(page);
  check(`${where}: no coworker's name on the screen`, !COWORKER.test(text), text.match(/.{0,40}(Quillfeather|\bBen\b|Vance|Eddie).{0,40}/)?.[0] || "");
};
const copyChecks = async (page, where) => {
  const text = await pageText(page);
  check(`${where}: no em dash, and no "Staff Portal" wording`, !text.includes("—") && !/Staff Portal/.test(text), text.match(/.{0,40}(—|Staff Portal).{0,40}/)?.[0] || "");
};
const noError = async (page, where) => {
  const text = await pageText(page);
  check(`${where}: no error screen`, !/Could not load|Failed to load|Program not found|Failed to|Unauthorized|Forbidden/i.test(text), text.slice(0, 160));
};

// ── VeritaComp home ──────────────────────────────────────────────────────────
const page = await open(ann);
await page.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-home").waitFor({ timeout: 20000 });
check("home: their own name and count", (await page.getByTestId("staff-own-name").innerText()) === "Ann Self" && /1 of 2 methods signed/.test(await page.getByTestId("staff-own-count").innerText()), await page.getByTestId("staff-own-count").innerText());
for (const [id, label] of [["employee-roster-row", "the employee list"], ["instrument-roster-row", "the instrument list"], ["roster-signed-link", "the whole-lab signed link"], ["owed-section-toggle", "Competencies owed"], ["coverage-map-toggle", "the coverage map"], ["quick-waived", "the evaluator's buttons"], ["button-competency-register", "the register button"], ["veritacomp-more", "the More menu"]]) {
  check(`home: ${label} isn't there`, (await page.getByTestId(id).count()) === 0);
}
const progRows = await page.getByTestId("staff-own-program").allInnerTexts();
check("home: program names stay visible", progRows.some((r) => r.includes("Made-up Hematology Program")) && progRows.some((r) => r.includes("Made-up Chemistry Program")), JSON.stringify(progRows));
check("home: a program with their record says so; one without says that too", progRows.find((r) => r.includes("Hematology Program"))?.includes("1 record of yours") && progRows.find((r) => r.includes("Chemistry Program"))?.includes("No record of yours"), JSON.stringify(progRows));
check("home: no counts of other people or their assessments", !/\d+ employees?|\d+ assessments?/i.test(await pageText(page)));
await noCoworkers(page, "home");
await copyChecks(page, "home");
await shot(page, "home");

// Every link on the page opens something real.
const hrefs = await page.getByTestId("staff-own-home").locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
check("home: it has links to follow", hrefs.length >= 4, JSON.stringify(hrefs));
apiErrors.length = 0;
for (const href of hrefs) {
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  await noError(page, `link ${href.replace(/^\/labs\/\d+/, "")}`);
  await noCoworkers(page, `link ${href.replace(/^\/labs\/\d+/, "")}`);
}
check("no link on the home page got a refused or failed call", apiErrors.length === 0, apiErrors.join(" | "));

// ── Own record: still works ──────────────────────────────────────────────────
await page.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-record").click();
await page.waitForURL(new RegExp(`/veritacomp-app/employee/${annId}`), { timeout: 15000 });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
const tab = (p, name) => p.getByTestId("test-system-tab").filter({ hasText: name }).first();
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
const back = await page.locator("main a", { hasText: "VeritaComp" }).first().innerText();
check("own record: the back link goes to their VeritaComp page, not All employees", /VeritaComp/.test(back) && !/All employees/.test(await pageText(page)), back);
check("own record: no false note about the lab having no observers", (await page.getByTestId("element-1-observerInitials-empty").count()) === 0);
check("own record: the observer named on their record shows, locked", /CT : Tate, Casey/.test(await page.getByTestId("element-4-observerInitials").innerText()) && await page.getByTestId("element-4-observerInitials").isDisabled(), await page.getByTestId("element-4-observerInitials").innerText());
check("own record: no sign-off form", (await page.getByTestId("method-sign-form").count()) === 0);
await page.getByTestId("element-1-specimenId").fill("SPEC-182");
await page.getByTestId("save-test-system").click();
await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
await page.waitForLoadState("networkidle");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
check("own record: self-entry save still persists", (await page.getByTestId("element-1-specimenId").inputValue()) === "SPEC-182");
await copyChecks(page, "own record");
await shot(page, "own-record");
const [ownPdf] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("download-record-pdf").click()]);
check("own record: their PDF downloads", /VeritaComp_Record_Ann Self/.test(ownPdf.suggestedFilename()), ownPdf.suggestedFilename());

// ── My signed competencies ───────────────────────────────────────────────────
await page.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-signed").click();
await page.getByTestId("signed-row").first().waitFor({ timeout: 20000 });
const signedRows = await page.getByTestId("signed-row").allInnerTexts();
check("signed list: only their own", signedRows.length === 1 && /Ann Self/.test(signedRows[0]), JSON.stringify(signedRows));
check("signed list: the heading says it's theirs", /My signed competencies/.test(await pageText(page)) && !/in this lab/.test(await pageText(page)));
await copyChecks(page, "signed list");
await shot(page, "signed");
await page.getByTestId("signed-row").first().click();
await page.waitForURL(new RegExp(`/veritacomp-app/employee/${annId}`), { timeout: 15000 });
await page.getByTestId("test-system-list").waitFor({ timeout: 20000 });
await noError(page, "signed row opens their record");

// ── A program ────────────────────────────────────────────────────────────────
await page.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-program").filter({ hasText: "Hematology Program" }).click();
await page.getByTestId("staff-own-program-page").waitFor({ timeout: 20000 });
await page.getByTestId("staff-own-assessment").first().waitFor({ timeout: 15000 });
check("program: only their own record", (await page.getByTestId("staff-own-assessment").count()) === 1);
for (const label of ["Overview", "Employees", "Settings", "New Assessment", "Print Blank Template"]) check(`program: the evaluator's "${label}" isn't there`, (await page.getByRole("button", { name: label }).count()) === 0);
await noCoworkers(page, "program");
await copyChecks(page, "program");
await shot(page, "program");
const [progPdf] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("staff-own-assessment-pdf").first().click()]);
check("program: their own record's PDF downloads", /\.pdf$/.test(progPdf.suggestedFilename()), progPdf.suggestedFilename());
await page.goto(labPath(`/veritacomp-app/${progOther}`), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-program-empty").waitFor({ timeout: 20000 });
await noCoworkers(page, "a program with no record of theirs");
await shot(page, "program-empty");
await page.goto(labPath("/veritacomp-app/999999"), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-program-missing").waitFor({ timeout: 20000 });
check("a program that doesn't exist: a plain sentence with a way back", (await page.getByTestId("staff-own-back").count()) === 1);

// ── Someone else's record, and the whole-lab pages ───────────────────────────
await page.goto(labPath(`/veritacomp-app/employee/${benId}`), { waitUntil: "networkidle" });
await page.getByTestId("staff-own-refused").waitFor({ timeout: 20000 });
check("another person's record: refused in a plain sentence", /You can only open your own competency record/.test(await page.getByTestId("staff-own-refused").innerText()));
check("another person's record: no name and no fields", (await page.getByTestId("test-system-list").count()) === 0 && (await page.locator("main h1").count()) === 0);
await noCoworkers(page, "another person's record");
await shot(page, "other-person");
await page.getByTestId("staff-own-open-mine").click();
await page.waitForURL(new RegExp(`/veritacomp-app/employee/${annId}`), { timeout: 15000 });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
check("another person's record: Open my record goes to their own", true);
for (const [label, p] of [["by instrument", "/veritacomp-app/instruments"], ["one instrument", `/veritacomp-app/instrument/${ANALYZER}`], ["an instrument not theirs", `/veritacomp-app/instrument/${UNASSIGNED}`], ["method groups", "/veritacomp-app/method-groups"]]) {
  apiErrors.length = 0;
  await page.goto(labPath(p), { waitUntil: "networkidle" });
  await page.getByTestId("staff-own-home").waitFor({ timeout: 20000 });
  check(`${label}: opens their own VeritaComp page, with no refused call behind it`, apiErrors.length === 0, apiErrors.join(" | "));
}

// ── VeritaStaff and My sign-offs ─────────────────────────────────────────────
await page.goto(labPath("/veritastaff-app"), { waitUntil: "networkidle" });
await page.getByText("Self", { exact: false }).first().waitFor({ timeout: 20000 });
const roster = await pageText(page);
check("VeritaStaff: their own row is there", /Self/.test(roster) && /Ann/.test(roster));
check("VeritaStaff: no coworker on the roster", !/Quillfeather|Eddie/.test(roster), roster.match(/.{0,40}(Quillfeather|Eddie).{0,40}/)?.[0] || "");
check("VeritaStaff: no competency register to download", (await page.getByTestId("button-competency-register").count()) === 0);
await shot(page, "roster");
await page.goto(labPath("/my-signoffs"), { waitUntil: "networkidle" });
await page.getByTestId("sp-tile-competency").click();
await page.getByTestId("sp-competency-own-record").waitFor({ timeout: 15000 });
check("My sign-offs: their own-record row and their program record still list", /1 of 2 methods signed/.test(await page.getByTestId("sp-competency-own-record-count").innerText()) && (await page.getByTestId("sp-competency-row").count()) === 1);
await noCoworkers(page, "My sign-offs");
await shot(page, "signoffs");

// ── A Staff seat with no staff record linked ─────────────────────────────────
const unlinked = await open(nell);
await unlinked.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await unlinked.getByTestId("staff-own-unlinked").waitFor({ timeout: 20000 });
check("unlinked seat: says what to do, and offers nothing that needs a staff record", /Ask your lab director or supervisor to link it/.test(await unlinked.getByTestId("staff-own-unlinked").innerText()) && (await unlinked.getByTestId("staff-own-record").count()) === 0 && (await unlinked.getByTestId("staff-own-signed").count()) === 0 && (await unlinked.getByTestId("staff-own-signoffs").count()) === 0);
check("unlinked seat: program names still show, with no record of theirs", (await unlinked.getByTestId("staff-own-program").count()) === 2 && (await unlinked.locator('a[data-testid="staff-own-program"]').count()) === 0);
await noCoworkers(unlinked, "unlinked seat");
await shot(unlinked, "unlinked");
await unlinked.goto(labPath(`/veritacomp-app/employee/${benId}`), { waitUntil: "networkidle" });
await unlinked.getByTestId("staff-own-refused").waitFor({ timeout: 20000 });
check("unlinked seat: another person's record is refused, with no button to a record they don't have", (await unlinked.getByTestId("staff-own-open-mine").count()) === 0 && !COWORKER.test(await pageText(unlinked)));

// ── An editor, and the owner: what they always saw ───────────────────────────
const edPage = await open(editor);
await edPage.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await edPage.getByTestId("employee-roster-row").first().waitFor({ timeout: 20000 });
check("editor with a staff card: the employee list holds everyone", /Quillfeather/.test((await edPage.getByTestId("employee-roster-row").allInnerTexts()).join(" ")) && (await edPage.getByTestId("staff-own-home").count()) === 0);
check("editor: the buttons and sections are all there", (await edPage.getByTestId("quick-waived").count()) === 1 && (await edPage.getByTestId("button-competency-register").count()) === 1);
await shot(edPage, "editor-list");
await edPage.goto(labPath(`/veritacomp-app/employee/${benId}`), { waitUntil: "networkidle" });
await edPage.getByTestId("test-system-list").waitFor({ timeout: 20000 });
await tab(edPage, "Made-up Analyzer").click();
await edPage.getByTestId("element-1").waitFor({ timeout: 15000 });
check("editor: opens another person's record, with the fields open and All employees back", await edPage.getByTestId("element-1-pass").isEnabled() && /All employees/.test(await pageText(edPage)));
await shot(edPage, "editor-record");
await edPage.goto(labPath(`/veritacomp-app/${prog}`), { waitUntil: "networkidle" });
await edPage.getByRole("button", { name: "Employees" }).click();
check("editor: the program's Employees tab lists the coworker", /Quillfeather/.test(await pageText(edPage)));
await edPage.goto(labPath("/veritastaff-app"), { waitUntil: "networkidle" });
await edPage.getByText("Quillfeather", { exact: false }).first().waitFor({ timeout: 20000 });
check("editor: the roster lists everyone", true);
const ownerPage = await open(owner);
await ownerPage.goto(labPath(`/veritacomp-app/signed`), { waitUntil: "networkidle" });
await ownerPage.getByTestId("signed-row").first().waitFor({ timeout: 20000 });
check("owner: Signed competencies is the whole lab, with its own heading", (await ownerPage.getByTestId("signed-row").count()) === 2 && /Every signed competency in this lab/.test(await pageText(ownerPage)));

// ── The two pickers that read the roster ─────────────────────────────────────
const ownerOptions = async (p, where) => {
  await p.goto(labPath("/veritatrack-app"), { waitUntil: "networkidle" });
  await p.getByTestId("add-task-button").first().click();
  const dialog = p.getByRole("dialog");
  await dialog.getByText("Owner", { exact: true }).waitFor({ timeout: 15000 });
  await p.waitForLoadState("networkidle");
  await dialog.locator('div:has(> label:text-is("Owner")) [role="combobox"]').click();
  const options = await p.getByRole("option").allInnerTexts();
  await p.keyboard.press("Escape");
  check(`${where}: the VeritaTrack task-owner picker lists coworkers`, options.some((o) => /Quillfeather, Ben/.test(o)) && options.some((o) => /Self, Ann/.test(o)), JSON.stringify(options));
};
await ownerOptions(ownerPage, "owner");
const trackerPage = await open(tracker);
await ownerOptions(trackerPage, "a Staff seat with edit on VeritaTrack");
await trackerPage.goto(labPath("/veritastaff-app"), { waitUntil: "networkidle" });
await trackerPage.getByText("Tracks", { exact: false }).first().waitFor({ timeout: 20000 });
check("that same seat's VeritaStaff roster is still only their own row", !/Quillfeather/.test(await pageText(trackerPage)));
const ptRoster = ownerPage.waitForResponse((r) => r.url().includes("/staff/employees?names=1"), { timeout: 20000 });
await ownerPage.goto(labPath("/veritapt/app"), { waitUntil: "networkidle" });
const ptBody = await (await ptRoster).json();
check("owner: VeritaPT's Tested by still loads the whole roster", ptBody.some((e) => e.last_name === "Quillfeather") && ptBody.some((e) => e.last_name === "Self"), `${ptBody.length}`);

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open(ann, { colorScheme: "dark" });
await dark.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await dark.getByTestId("staff-own-home").waitFor({ timeout: 20000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "home-dark");
await dark.goto(labPath(`/veritacomp-app/${prog}`), { waitUntil: "networkidle" });
await dark.getByTestId("staff-own-assessment").first().waitFor({ timeout: 20000 });
await shot(dark, "program-dark");
await dark.goto(labPath(`/veritacomp-app/employee/${benId}`), { waitUntil: "networkidle" });
await dark.getByTestId("staff-own-refused").waitFor({ timeout: 20000 });
await shot(dark, "other-person-dark");
await dark.goto(labPath(`/veritacomp-app/employee/${annId}`), { waitUntil: "networkidle" });
await dark.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await shot(dark, "own-record-dark");
await dark.goto(labPath("/veritacomp-app/signed"), { waitUntil: "networkidle" });
await dark.getByTestId("signed-row").first().waitFor({ timeout: 20000 });
await shot(dark, "signed-dark");
const darkUnlinked = await open(nell, { colorScheme: "dark" });
await darkUnlinked.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await darkUnlinked.getByTestId("staff-own-unlinked").waitFor({ timeout: 20000 });
await shot(darkUnlinked, "unlinked-dark");

const phone = await open(ann, { viewport: { width: 375, height: 812 } });
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await phone.goto(labPath("/veritacomp-app"), { waitUntil: "networkidle" });
await phone.getByTestId("staff-own-home").waitFor({ timeout: 20000 });
check("phone: home has no sideways scroll", await noSideways(phone));
await shot(phone, "home-phone");
await phone.goto(labPath(`/veritacomp-app/${prog}`), { waitUntil: "networkidle" });
await phone.getByTestId("staff-own-assessment").first().waitFor({ timeout: 20000 });
check("phone: a program has no sideways scroll", await noSideways(phone));
await shot(phone, "program-phone");
await phone.goto(labPath(`/veritacomp-app/employee/${benId}`), { waitUntil: "networkidle" });
await phone.getByTestId("staff-own-refused").waitFor({ timeout: 20000 });
check("phone: the refusal has no sideways scroll", await noSideways(phone));
await shot(phone, "other-person-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
