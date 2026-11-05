// scripts/verify-competency-needs-review-ui.mjs
// Gate 3 receipt for Michael 2026-11-05, Q179 = 1. Run against a LOCAL production build on a scratch database, with made-up people (it registers people and provisions a
// lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-needs-review-ui.mjs
// Signed in as the evaluator, in a real browser: entries with no Pass read Needs review and never FAIL; the form opens with nothing chosen and no remediation box; a Pass is
// refused with the on-form message (the server's own text); ticking the boxes lets it sign; a Remediation sign-off on unmarked entries still works; the signed record
// shows its real result. Downloads the record PDF and reads its text. Light, dark and phone.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Needs", "review", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `site-needsreview-${name}.png`), fullPage });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const day = "2026-10-15";
const ownerEmail = `needsreview-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Evaluator", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Needs Review UI Lab", plan: "hospital" })).j.labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Needs Review UI Lab", cliaNumber: "99D9999997", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).j.id;
const t = (analyte, complexity) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
await fetch(`${BASE}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: [
  { name: "Made-up Analyzer", category: "Hematology", tests: [t("Made-up WBC", "MODERATE")] },
  { name: "Made-up Second", category: "Hematology", tests: [t("Made-up RBC", "MODERATE")] },
  { name: "Made-up Third", category: "Hematology", tests: [t("Made-up PLT", "MODERATE")] },
  { name: "Made-up Meter", category: "Point of Care", tests: [t("Made-up Glucose", "WAIVED")] },
] }) });
const person = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j.id;
const pat = await person("Tester", "Pat"), kim = await person("Second", "Kim"), nan = await person("Third", "Nan");
await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, owner.token);
const now = new Date().toISOString();
const sdb = new Database(process.env.SCRATCH_DB);
const instOf = (name) => sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId).id;
const ANALYZER = instOf("Made-up Analyzer"), SECOND = instOf("Made-up Second"), THIRD = instOf("Made-up Third"), METER = instOf("Made-up Meter");
for (const [emp, inst] of [[pat, ANALYZER], [pat, SECOND], [pat, THIRD], [pat, METER], [kim, ANALYZER], [nan, ANALYZER]]) sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, inst, now);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999997' WHERE id = ?").run(labId);
sdb.close();
const entries = (marks = {}) => [
  { num: 1, specimenId: "S-1", observerInitials: "CT", ...marks[1] },
  { num: 2, evidence: "Reviewed", date: day, ...marks[2] },
  { num: 3, qcDate: day, ...marks[3] },
  { num: 4, dateObserved: day, observerInitials: "CT", ...marks[4] },
  { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1" }], ...marks[5] },
  { num: 6, quizId: "Q-1", score: 90, dateTaken: day, ...marks[6] },
];
const allPass = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { passed: true }]));
const put = (emp, inst, body) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, owner.token);
for (const [emp, inst] of [[pat, ANALYZER], [pat, THIRD], [kim, ANALYZER], [nan, ANALYZER]]) await put(emp, inst, { elements: entries() });
await put(pat, SECOND, { elements: entries(allPass) });
await put(pat, METER, { waivedMethods: [{ num: 2, evidence: "Observed by the supervisor", date: day }, { num: 3, evidence: "QC reviewed", date: day }] });
// A program record with a Pass status and unmarked rows.
const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Technical Program", department: "Hematology", type: "technical", methodGroups: [{ name: "Made-up Analyzer", instruments: ["Made-up Analyzer"], analytes: [] }] }, owner.token)).j.id;
const scratchRead = (sql, ...args) => { const d = new Database(process.env.SCRATCH_DB); const r = d.prepare(sql).get(...args); d.close(); return r; };
const mgId = scratchRead("SELECT id FROM competency_method_groups WHERE program_id = ?", prog).id;
const kimComp = scratchRead("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?", kim, labId).id;
const rec = await call("POST", `${L}/competency/assessments`, { programId: prog, employeeId: kimComp, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up Evaluator", competencyType: "technical", status: "pass", items: [1, 2, 3, 4, 5, 6].map((n) => ({
  methodNumber: n, elementNumber: n, methodGroupId: mgId, methodGroupName: "Made-up Analyzer",
  ...(n === 1 ? { el1SpecimenId: "S" } : n === 2 ? { el2Evidence: "E", el2Date: day } : n === 3 ? { el3QcDate: day } : n === 4 ? { el4DateObserved: day } : n === 5 ? { el5SampleId: "P" } : { el6QuizId: "Q" }),
})) }, owner.token);
check("made-up lab, people, entries and a program record", !!labId && pat > 0 && !!rec.j.id);

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  return page;
};
const recordUrl = (emp) => `${BASE}/labs/${labId}/veritacomp-app/employee/${emp}`;
const tab = (page, name) => page.getByTestId("test-system-tab").filter({ hasText: name }).first();
const openMethod = async (page, emp, name) => {
  await page.goto(recordUrl(emp), { waitUntil: "networkidle" });
  await page.getByTestId("test-system-list").waitFor({ timeout: 20000 });
  await tab(page, name).click();
};
const savedToast = async (page) => { await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 }); await page.waitForLoadState("networkidle"); };
const readPdf = (file, png) => {
  const py = "import fitz,json,re,sys\nd=fitz.open(sys.argv[1])\nd[0].get_pixmap(dpi=110).save(sys.argv[2])\nprint(json.dumps({'pages':[re.sub(r'\\s+',' ',p.get_text()) for p in d]}))";
  const out = spawnSync("python", ["-c", py, file, png], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(out.stderr.slice(0, 400));
  return JSON.parse(out.stdout).pages.join(" ");
};

// ── Pat: the label, the counts, the form ─────────────────────────────────────
const page = await open();
await openMethod(page, pat, "Made-up Analyzer");
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
const chipCount = await page.getByTestId("needs-review-chip").count();
const entriesText = await page.locator('[data-testid^="element-"]').allInnerTexts();
check("the evaluator sees Needs review on all six entries", chipCount === 6, String(chipCount));
check("no FAIL anywhere on the entries", !entriesText.some((x) => /\bFAIL\b/.test(x)));
check("the method reads Needs review, not ready to sign", /Initial needs review/.test(await tab(page, "Made-up Analyzer").innerText()) && !/ready to sign/i.test(await tab(page, "Made-up Analyzer").innerText()));
const summary = await page.getByTestId("signoff-summary").innerText();
check("the count line follows: 1 ready to sign (the marked one), 3 need review", /1 ready to sign/.test(summary) && /3 need review/.test(summary), summary);
check("the fully marked method still reads ready to sign", /Initial ready to sign/.test(await tab(page, "Made-up Second").innerText()));
const form = page.getByTestId("method-sign-form");
await form.waitFor({ timeout: 15000 });
check("the form opens with nothing chosen", (await page.getByTestId("determination-select").inputValue()) === "");
check("no remediation box just because entries are unmarked", (await page.getByTestId("remediation-box").count()) === 0);
check("Sign can't be clicked until a determination is chosen", await page.getByTestId("sign-method").isDisabled());
const message = (await page.getByTestId("pass-blocked").innerText()).trim();
check("the Pass rule shows on the form before anyone tries, naming the elements", /Elements 1, 2, 3, 4, 5 and 6 are not marked Pass or N\/A/.test(message), message);
await shot(page, "unmarked");
await page.getByTestId("determination-select").selectOption("pass");
check("choosing Pass: Sign stays disabled and the message stays", await page.getByTestId("sign-method").isDisabled() && (await page.getByTestId("pass-blocked").innerText()).trim() === message);
await shot(page, "pass-refused");
// The form won't send it, so send it from the browser the way a hand-made request would: an eligible signer, a Pass, unmarked entries.
const signerId = scratchRead("SELECT id FROM staff_employees WHERE last_name = 'Tate' AND tier2_lab_id = ?", labId).id;
const refused = await page.evaluate(async ([u, tk, signer]) => {
  const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk}` }, body: JSON.stringify({ signerStaffEmployeeId: signer, signerInitials: "CT", determination: "pass" }) });
  return { s: r.status, j: await r.json() };
}, [`${L}/competency/employee/${pat}/test-system/${ANALYZER}/sign`, owner.token, signerId]);
check("the server refuses a Pass with the same words the form shows", refused.s === 409 && refused.j.error === message, `${refused.s} ${refused.j.error}`);
check("the refused request wrote nothing", scratchRead("SELECT COUNT(*) AS n FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ?", pat, ANALYZER).n === 0);

// Tick the boxes
for (const n of [1, 2, 3, 4, 5, 6]) await page.getByTestId(`element-${n}-pass`).check();
await page.getByTestId("save-test-system").click();
await savedToast(page);
await page.getByTestId("element-1").getByText("PASS", { exact: true }).waitFor({ timeout: 15000 });
check("ticked and saved: PASS on every element, no Needs review, the message is gone", (await page.getByTestId("needs-review-chip").count()) === 0 && (await page.getByTestId("pass-blocked").count()) === 0);
check("ticked and saved: the method reads ready to sign", /Initial ready to sign/.test(await tab(page, "Made-up Analyzer").innerText()));
check("the determination is still the evaluator's to choose", ["", "pass"].includes(await page.getByTestId("determination-select").inputValue()));
await page.getByTestId("determination-select").selectOption("pass");
check("with Pass chosen, Sign is enabled", await page.getByTestId("sign-method").isEnabled());
await shot(page, "ready");
await page.getByTestId("sign-method").click();
await page.getByTestId("method-signed").waitFor({ timeout: 15000 });
const banner = await page.getByTestId("method-signed").innerText();
check("it signs as a Pass", /Initial signed/.test(banner) && /Pass/.test(await page.getByTestId("method-determination").innerText()), banner);
await page.getByTestId("method-view-entries").click();
await page.getByTestId("signed-element-1").waitFor({ timeout: 10000 });
check("the signed record shows PASS on its elements", /PASS/.test(await page.getByTestId("signed-element-1").innerText()));
await shot(page, "signed-pass");

// Waived
await tab(page, "Made-up Meter").click();
await page.getByTestId("waived-panel").waitFor({ timeout: 15000 });
const waivedText = await page.getByTestId("waived-panel").innerText();
check("waived: an entry with no Pass reads Needs review, not Not passed", (await page.getByTestId("waived-method-2").getByTestId("needs-review-chip").count()) === 1 && !/Not passed/.test(waivedText));
check("waived: the method reads Needs review", /Initial needs review/.test(await tab(page, "Made-up Meter").innerText()));
check("waived: the required-methods rule still keeps the form closed", (await page.getByTestId("method-sign-form").count()) === 0 && /0 of 2/.test(await page.getByTestId("waived-count").innerText()));
await shot(page, "waived");

// The record PDF, with one method signed Pass and one unmarked
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("download-record-pdf").click()]);
const patPdf = path.join(OUT, "site-needsreview-record-unsigned.pdf");
await dl.saveAs(patPdf);
const patText = readPdf(patPdf, path.join(OUT, "site-needsreview-record-unsigned-p1.png"));
check("record PDF: reads Needs review", /Needs review/.test(patText));
check("record PDF: prints no FAIL for unmarked entries", !/\bFAIL\b/.test(patText), patText.slice(0, 400));
check("record PDF: the signed method reads Competent", /Competent/.test(patText));
check("record PDF: the marked, unsigned method still reads Ready to sign", /Ready to sign/.test(patText));
for (const bad of ["/#/", "localhost", "127.0.0.1", "radiant-quietude", "—"]) check(`record PDF: no ${JSON.stringify(bad)}`, !patText.includes(bad));

// ── Kim: Remediation Required on unmarked entries ────────────────────────────
await openMethod(page, kim, "Made-up Analyzer");
await page.getByTestId("method-sign-form").waitFor({ timeout: 15000 });
await page.getByTestId("determination-select").selectOption("remediation");
check("choosing Remediation Required opens its box, and the Pass rule steps aside", (await page.getByTestId("remediation-box").count()) === 1 && (await page.getByTestId("pass-blocked").count()) === 0);
check("its action plan is still required", await page.getByTestId("sign-method").isDisabled());
await page.getByTestId("remediation-plan").fill("Made-up retraining plan and reassessment");
check("with a plan it can be signed, entries unmarked", await page.getByTestId("sign-method").isEnabled() && (await page.getByTestId("needs-review-chip").count()) === 6);
await shot(page, "remediation-choice");
await page.getByTestId("sign-method").click();
await page.getByTestId("method-signed").waitFor({ timeout: 15000 });
check("Remediation Required is recorded", /Remediation Required/.test(await page.getByTestId("method-determination").innerText()));
await page.getByTestId("method-view-entries").click();
await page.getByTestId("signed-element-1").waitFor({ timeout: 10000 });
check("that signed record keeps its real result: FAIL on the elements", /FAIL/.test(await page.getByTestId("signed-element-1").innerText()));
await shot(page, "signed-remediation");
const [kd] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("download-record-pdf").click()]);
const kimPdf = path.join(OUT, "site-needsreview-record-remediation.pdf");
await kd.saveAs(kimPdf);
const kimText = readPdf(kimPdf, path.join(OUT, "site-needsreview-record-remediation-p1.png"));
check("record PDF, signed Remediation: prints FAIL and Remediation required, not Needs review", /\bFAIL\b/.test(kimText) && /Remediation required/.test(kimText) && !/Needs review/.test(kimText), kimText.slice(0, 300));

// ── Nan: an N/A counts as marked ─────────────────────────────────────────────
await openMethod(page, nan, "Made-up Analyzer");
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
for (const n of [1, 2, 4, 5, 6]) await page.getByTestId(`element-${n}-pass`).check();
await page.getByTestId("element-3-na").check();
await page.getByTestId("element-3-na-just").fill("Made-up reason: no QC on this method");
await page.getByTestId("save-test-system").click();
await savedToast(page);
await page.getByTestId("element-1").getByText("PASS", { exact: true }).waitFor({ timeout: 15000 });
check("an N/A plus five ticks: no block message, ready to sign", (await page.getByTestId("pass-blocked").count()) === 0 && /Initial ready to sign/.test(await tab(page, "Made-up Analyzer").innerText()));
await page.getByTestId("determination-select").selectOption("pass");
await page.getByTestId("sign-method").click();
await page.getByTestId("method-signed").waitFor({ timeout: 15000 });
check("it signs as a Pass", /Pass/.test(await page.getByTestId("method-determination").innerText()));

// ── Ola: the two facts the form states beside the choice ─────────────────────
const ola = await person("Fourth", "Ola");
{ const d = new Database(process.env.SCRATCH_DB); for (const inst of [ANALYZER, METER]) d.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(ola, inst, now); d.close(); }
await put(ola, ANALYZER, { elements: entries({ 5: { samples: [{ sampleType: "PT", sampleId: "PT-9", acceptable: false }] } }) });
await put(ola, METER, { waivedMethods: [{ num: 1, evidence: "BS-1", date: day, initials: "CT", passed: true }, { num: 2, evidence: "Observed", date: day, initials: "CT", passed: true }, { num: 3, evidence: "QC reviewed", date: day }] });
await openMethod(page, ola, "Made-up Analyzer");
await page.getByTestId("method-sign-form").waitFor({ timeout: 15000 });
check("a sample marked not acceptable is stated as a fact, and nothing is chosen for them", /Element 5 has a sample marked not acceptable/.test(await page.getByTestId("sample-not-acceptable").innerText()) && (await page.getByTestId("determination-select").inputValue()) === "" && (await page.getByTestId("remediation-box").count()) === 0);
await shot(page, "sample-not-acceptable");
await tab(page, "Made-up Meter").click();
await page.getByTestId("method-sign-form").waitFor({ timeout: 15000 });
check("waived, two passed plus an unmarked third: the method reads Needs review", /Initial needs review/.test(await tab(page, "Made-up Meter").innerText()));
check("the form says what happens to the unmarked one", /Method 3 has an entry with no Pass/.test(await page.getByTestId("waived-unmarked-note").innerText()));
check("the required-methods rule decides the Pass: no block, and it can be signed", (await page.getByTestId("pass-blocked").count()) === 0);
await page.getByTestId("determination-select").selectOption("pass");
check("with Pass chosen, Sign is enabled", await page.getByTestId("sign-method").isEnabled());
await shot(page, "waived-extra-unmarked");
await page.getByTestId("sign-method").click();
await page.getByTestId("method-signed").waitFor({ timeout: 15000 });
check("it signs as a Pass", /Pass/.test(await page.getByTestId("method-determination").innerText()));

// ── By instrument ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/instrument/${THIRD}`, { waitUntil: "networkidle" });
await page.getByTestId("person-panel").waitFor({ timeout: 20000 });
const instText = await page.getByTestId("person-panel").innerText();
check("By instrument: the entries read Needs review, no FAIL", /Needs review/.test(instText) && !/\bFAIL\b/.test(instText), instText.slice(0, 200));
check("By instrument: the summary counts it as needing review, not ready", /1 needs review/.test(await page.getByTestId("instrument-summary").innerText()) && !/ready to sign/.test(await page.getByTestId("instrument-summary").innerText()));
check("By instrument: the sign form shows the same rule", /Elements 1, 2, 3, 4, 5 and 6 are not marked/.test(await page.getByTestId("pass-blocked").innerText()));
await shot(page, "by-instrument");
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/instruments`, { waitUntil: "networkidle" });
await page.getByTestId("instrument-needs-review").first().waitFor({ timeout: 20000 });
check("the instrument list shows a Needs review count", /1 needs review/.test(await page.getByTestId("instrument-needs-review").first().innerText()));

// ── A program record ─────────────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${prog}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Assessments/ }).first().click();
await page.getByTestId("record-pass-blocked").waitFor({ timeout: 20000 });
check("program record: the card reads Needs review, and the rule shows before anyone tries", /Needs review/.test(await page.locator("body").innerText()) && /can't be signed as a Pass yet/.test(await page.getByTestId("record-pass-blocked").innerText()));
await page.getByRole("button", { name: /Sign & Complete/ }).first().click();
await page.getByText("Cannot sign as a Pass", { exact: true }).first().waitFor({ timeout: 8000 });
check("program record: Sign & Complete refuses a Pass with the same message", true);
const recSign = await call("POST", `${L}/competency/assessments/${rec.j.id}/sign`, {}, owner.token);
check("program record: so does the server", recSign.s === 409 && recSign.j.error === (await page.getByTestId("record-pass-blocked").innerText()).trim(), `${recSign.s} ${recSign.j.error}`);
await shot(page, "program-record");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await openMethod(dark, pat, "Made-up Third");
await dark.getByTestId("method-sign-form").waitFor({ timeout: 15000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await dark.getByTestId("determination-select").selectOption("pass");
await shot(dark, "pass-refused-dark");
await dark.getByTestId("determination-select").selectOption("remediation");
await shot(dark, "remediation-dark");
await dark.goto(`${BASE}/labs/${labId}/veritacomp-app/instrument/${THIRD}`, { waitUntil: "networkidle" });
await dark.getByTestId("person-panel").waitFor({ timeout: 20000 });
await shot(dark, "by-instrument-dark");

const phone = await open({ viewport: { width: 375, height: 812 } });
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await openMethod(phone, pat, "Made-up Third");
await phone.getByTestId("method-sign-form").waitFor({ timeout: 15000 });
check("phone: no sideways scroll on the evaluator's view with the form open", await noSideways(phone));
const chipsInside = await phone.evaluate(() => Array.from(document.querySelectorAll('[data-testid="needs-review-chip"]')).every((chip) => {
  const card = chip.closest('[data-testid^="element-"], [data-testid^="waived-method-"]');
  return card && chip.getBoundingClientRect().right <= card.getBoundingClientRect().right;
}));
check("phone: every Needs review chip stays inside its card", chipsInside);
await phone.getByTestId("determination-select").selectOption("pass");
await shot(phone, "pass-refused-phone");
await phone.goto(`${BASE}/labs/${labId}/veritacomp-app/${prog}`, { waitUntil: "networkidle" });
await phone.getByRole("button", { name: /^Assessments/ }).first().click();
await phone.getByTestId("record-pass-blocked").waitFor({ timeout: 20000 });
check("phone: program record has no sideways scroll", await noSideways(phone));
await shot(phone, "program-record-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
