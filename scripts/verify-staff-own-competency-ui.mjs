// scripts/verify-staff-own-competency-ui.mjs
// Gate 3 receipt for Michael 2026-11-05 (Cathy Thornton, RFGH): a Staff login enters the factual data on their OWN competency record. Run against a LOCAL
// production build on a scratch database, with made-up people (it registers people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-own-competency-ui.mjs
// Signed in AS the made-up Staff login, in a real browser: types a specimen ID on their own record, saves, reloads and sees it persist; finds Pass and the observer
// disabled; finds another person's record read-only; adds a specimen on a waived record on both paths; sees the My sign-offs tile and row behave. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats directly to a scratch database.");
const PW = ["Own", "data", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const shot = (page, name, fullPage = true) => page.screenshot({ path: path.join(OUT, `site-staffcomp-${name}.png`), fullPage });

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const day = "2026-10-15", day2 = "2026-10-20";
const ownerEmail = `staffcomp-owner-${stamp}@example.test`, annEmail = `staffcomp-ann-${stamp}@example.test`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const ann = await call("POST", "/api/auth/register", { email: annEmail, password: PW, name: "Ann Self", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Own Data UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Own Data UI Lab", cliaNumber: "99D9999998", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).id;
const t = (analyte, complexity) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
await fetch(`${BASE}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: [
  { name: "Made-up Analyzer", category: "Hematology", tests: [t("Made-up WBC", "MODERATE")] },
  { name: "Made-up Meter", category: "Point of Care", tests: [t("Made-up Glucose", "WAIVED")] },
] }) });
const person = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).id;
const annId = await person("Self", "Ann"), benId = await person("Other", "Ben");
await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, owner.token);
const now = new Date().toISOString();
const openDb = () => new Database(process.env.SCRATCH_DB);
const sdb = openDb();
const instOf = (name) => sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId).id;
const ANALYZER = instOf("Made-up Analyzer"), METER = instOf("Made-up Meter");
const userId = (email) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
const oid = userId(ownerEmail), sid = userId(annEmail);
for (const [emp, inst] of [[annId, ANALYZER], [annId, METER], [benId, ANALYZER], [benId, METER]]) sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, inst, now);
sdb.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, sid, now, now, now);
sdb.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
  VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`).run(oid, annEmail, sid, now, now, `staffcomp-${stamp}`, labId, annId);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?)").run(sid, oid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999998' WHERE id = ?").run(labId);
sdb.close();

// The evaluator's own entries, which must stay put: Element 4 on Ann's analyzer (this also creates the implicit container), and on someone else's record for the read-only view.
const elements = [{ num: 4, dateObserved: day, observerInitials: "CT", passed: true }];
await call("PUT", `${L}/competency/employee/${annId}/test-system/${ANALYZER}`, { elements }, owner.token);
await call("PUT", `${L}/competency/employee/${benId}/test-system/${ANALYZER}`, { elements: [{ num: 1, specimenId: "BEN-1", observerInitials: "CT", passed: true }] }, owner.token);
// A program-based waived record, the shape Sylbera Austin has.
const compEmp = (() => { const d = openDb(); const r = d.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(annId, labId); d.close(); return r.id; })();
const prog = (await call("POST", `${L}/competency/programs`, { name: "Hematology waived testing competency", department: "Hematology", type: "waived" }, owner.token)).id;
const waivedRec = await call("POST", `${L}/competency/assessments`, { programId: prog, employeeId: compEmp, assessmentType: "initial", assessmentDate: day, evaluatorName: "Made Up Evaluator", evaluatorInitials: "ME", competencyType: "waived", status: "pass", items: [
  { methodNumber: 1, waivedMethodNumber: 1, waivedEvidence: "BS-1 from the evaluator", waivedDate: day, waivedInitials: "ME", passed: true, waivedSpecimens: [{ evidence: "BS-1 from the evaluator", date: day, initials: "ME", passed: true }] },
  { methodNumber: 3, waivedMethodNumber: 3, waivedEvidence: "", waivedDate: "", waivedInitials: "ME", passed: false },
] }, owner.token);
check("made-up lab, staff login, implicit container and waived record", !!labId && annId > 0 && !!waivedRec.id);

const browser = await chromium.launch();
const errors = [];
const open = async (session, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  // The account as the server reports it now, seat included, which is what a real sign-in stores.
  const me = await call("GET", "/api/auth/me", undefined, session.token);
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (scheme) localStorage.setItem("theme", scheme); }, [session.token, me, opts.colorScheme || "light"]);
  return page;
};
const own = `/labs/${labId}/veritacomp-app/employee/${annId}`;
const tab = (page, name) => page.getByTestId("test-system-tab").filter({ hasText: name }).first();
const savedToast = (page) => page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15000 });
const pageText = (page) => page.locator("body").innerText();
const copyChecks = async (page, where) => {
  const text = await pageText(page);
  check(`${where}: no em dash, and "Staff logins" wording`, !text.includes("—") && !/Staff Portal/.test(text), text.match(/.{0,40}(—|Staff Portal).{0,40}/)?.[0] || "");
};

// ── My sign-offs ─────────────────────────────────────────────────────────────
const page = await open(ann);
await page.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
const tile = page.getByTestId("sp-tile-competency");
await tile.waitFor({ timeout: 20000 });
await page.getByTestId("sp-tile-competency-badge").waitFor({ timeout: 15000 });
const implicitOpen = (() => { const d = openDb(); const r = d.prepare(`SELECT COUNT(*) AS n FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? AND p.is_implicit = 1 AND a.employee_acknowledged = 0`).get(annId); d.close(); return r.n; })();
check("the unacknowledged implicit container is really there, and the tile still counts only the real record", implicitOpen === 1 && (await page.getByTestId("sp-tile-competency-badge").innerText()).trim() === "1", `${implicitOpen} ${await page.getByTestId("sp-tile-competency-badge").innerText()}`);
check("the banner counts one item, not two", /You have 1 item waiting/.test(await page.getByTestId("sp-pending-banner").innerText()));
await shot(page, "tiles");
await tile.click();
await page.getByTestId("sp-competency-own-record").waitFor({ timeout: 15000 });
check("the plain row opens the person's own record and shows the count", /My competency record/.test(await page.getByTestId("sp-competency-own-record").innerText()) && (await page.getByTestId("sp-competency-own-record-count").innerText()).trim() === "0 of 2 methods signed", await page.getByTestId("sp-competency-own-record").innerText());
const rowTitles = await page.getByTestId("sp-competency-row-title").allInnerTexts();
check("the implicit Competency row is gone; the real record stays", rowTitles.length === 1 && rowTitles[0] === "Hematology waived testing competency", JSON.stringify(rowTitles));
check("the plain row has no PASS and no acknowledgement ask", !/PASS|acknowledg/i.test(await page.getByTestId("sp-competency-own-record").innerText()));
await copyChecks(page, "My sign-offs list");
await shot(page, "signoffs-list");

// ── Program-based waived record in My sign-offs ──────────────────────────────
await page.getByTestId("sp-competency-row").first().click();
await page.getByTestId("sp-myinfo-waived").waitFor({ timeout: 15000 });
const M1 = "sp-myinfo-waived-1", M3 = "sp-myinfo-waived-3";
check("waived record: the evaluator's specimen shows, its evidence open, Pass and initials closed", (await page.getByTestId(`${M1}-specimen-0-evidence`).inputValue()) === "BS-1 from the evaluator" && await page.getByTestId(`${M1}-specimen-0-evidence`).isEnabled() && await page.getByTestId(`${M1}-specimen-0-pass`).isDisabled() && await page.getByTestId(`${M1}-specimen-0-pass`).isChecked() && await page.getByTestId(`${M1}-specimen-0-initials`).isDisabled());
check("waived record: a row the evaluator passed has no Remove", (await page.getByTestId(`${M1}-specimen-0-remove`).count()) === 0);
await page.getByTestId(`${M1}-add-specimen`).click();
await page.getByTestId(`${M1}-specimen-1-evidence`).fill("BS-2 entered by me");
await page.getByTestId(`${M1}-specimen-1-date`).fill(day2);
check("waived record: the new specimen's Pass and initials stay closed too", await page.getByTestId(`${M1}-specimen-1-pass`).isDisabled() && await page.getByTestId(`${M1}-specimen-1-initials`).isDisabled());
await page.getByTestId(`${M3}-evidence`).fill("Ran both QC levels");
await page.getByTestId(`${M3}-date`).fill(day2);
check("waived record: the plain method shows the evaluator's marks as text", /Not yet passed/.test(await page.getByTestId(`${M3}-evaluator`).innerText()) && /ME/.test(await page.getByTestId(`${M3}-evaluator`).innerText()));
await copyChecks(page, "Waived record in My sign-offs");
await page.getByTestId("sp-myinfo-save").click();
await page.getByTestId("sp-myinfo-saved").waitFor({ timeout: 15000 });
await shot(page, "waived-record");
await page.getByTestId("sp-competency-back-to-list").click();
await page.getByTestId("sp-competency-row").first().click();
await page.getByTestId("sp-myinfo-waived").waitFor({ timeout: 15000 });
check("waived record: reopened, both specimens and the method's entries are still there", (await page.getByTestId(`${M1}-specimen-1-evidence`).inputValue()) === "BS-2 entered by me" && (await page.getByTestId(`${M3}-evidence`).inputValue()) === "Ran both QC levels");
check("waived record: the evaluator's Pass stayed on the first specimen", await page.getByTestId(`${M1}-specimen-0-pass`).isChecked() && !(await page.getByTestId(`${M1}-specimen-1-pass`).isChecked()));
check("waived record: the acknowledgement stays available on a real record", (await page.getByTestId("sp-competency-sign-block").count()) === 1);
await page.getByTestId("sp-competency-sign-submit").click();
await page.getByTestId("sp-competency-list").waitFor({ timeout: 15000 });
check("after acknowledging it the row reads Signed", (await page.getByTestId("sp-competency-row-signed").count()) === 1);
await page.getByTestId("sp-competency-back").click();
await page.getByTestId("sp-tile-competency").waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
check("the tile badge and banner are gone: the container never held them up", (await page.getByTestId("sp-tile-competency-badge").count()) === 0 && (await page.getByTestId("sp-pending-banner").count()) === 0);
await shot(page, "tiles-clear");
await page.getByTestId("sp-tile-competency").click();

// ── Own record: technical ────────────────────────────────────────────────────
await page.getByTestId("sp-competency-own-record").click();
await page.waitForURL(new RegExp(`/labs/${labId}/veritacomp-app/employee/${annId}`), { timeout: 15000 });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
const note = await page.getByTestId("self-entry-note").innerText();
check("one plain sentence says what to fill in and what the evaluator sets", /specimen IDs, dates, evidence/.test(note) && /evaluator sets the observer, Pass and the final sign-off/.test(note) && (note.match(/\.\s/g) || []).length === 0, note);
const enabled = (id) => page.getByTestId(id).isEnabled();
const disabled = (id) => page.getByTestId(id).isDisabled();
for (const id of ["element-1-specimenId", "element-2-evidence", "element-2-date", "element-3-qcDate", "element-5-sampleType-0", "element-5-sampleId-0", "element-6-quizId", "element-6-score", "element-6-dateTaken", "save-test-system"]) check(`open to the person: ${id}`, await enabled(id));
for (const id of ["element-1-pass", "element-1-na", "element-1-observerInitials", "element-2-pass", "element-3-na", "element-4-dateObserved", "element-4-observerInitials", "element-4-pass", "element-4-na", "element-5-acceptable-0", "element-6-pass"]) check(`stays the evaluator's: ${id}`, await disabled(id));
check("the evaluator's Element 4 entry shows, and its Pass is ticked", (await page.getByTestId("element-4-dateObserved").inputValue()) === day && await page.getByTestId("element-4-pass").isChecked());
check("no sign-off controls for this person", (await page.getByTestId("method-sign-form").count()) === 0 && (await page.getByTestId("method-unlock").count()) === 0);
check("the old instruction to mark N/A isn't shown to them", !/mark N\/A with a reason/.test(await pageText(page)));
await copyChecks(page, "Own record");
await shot(page, "own-before");

await page.getByTestId("element-1-specimenId").fill("SPEC-777");
await page.getByTestId("element-2-evidence").fill("Reviewed my own results");
await page.getByTestId("element-2-date").fill(day);
await page.getByTestId("element-3-qcDate").fill(day);
await page.getByTestId("element-5-sampleType-0").fill("PT");
await page.getByTestId("element-5-sampleId-0").fill("PT-1");
await page.getByTestId("element-5-add-sample").click();
await page.getByTestId("element-5-sampleType-1").fill("Blind");
await page.getByTestId("element-5-sampleId-1").fill("BL-2");
await page.getByTestId("element-6-quizId").fill("Q-1");
await page.getByTestId("element-6-score").fill("95");
await page.getByTestId("element-6-dateTaken").fill(day);
await page.getByTestId("save-test-system").click();
await savedToast(page);
await page.waitForLoadState("networkidle");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
check("reloaded: the specimen ID persisted", (await page.getByTestId("element-1-specimenId").inputValue()) === "SPEC-777", await page.getByTestId("element-1-specimenId").inputValue());
check("reloaded: both samples persisted", (await page.getByTestId("element-5-sampleId-0").inputValue()) === "PT-1" && (await page.getByTestId("element-5-sampleId-1").inputValue()) === "BL-2");
check("their own entry reads Needs review, never FAIL (Michael Q179 = 1)", (await page.getByTestId("element-1").getByTestId("needs-review-chip").count()) === 1 && !/\bFAIL\b/.test(await page.getByTestId("element-1").innerText()));
const stored = (() => { const d = openDb(); const r = d.prepare(`SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? AND i.instrument_id = ?`).all(annId, ANALYZER); d.close(); return r; })();
const elRow = (n) => stored.find((r) => Number(r.element_number) === n);
check("in the database: their data on the rows, the evaluator's marks unmoved", elRow(1)?.el1_specimen_id === "SPEC-777" && !elRow(1)?.passed && !elRow(1)?.el1_observer_initials && elRow(4)?.el4_observer_initials === "CT" && elRow(4)?.passed === 1 && elRow(4)?.el4_date_observed === day);
await shot(page, "own-after");

// ── Own record: waived ───────────────────────────────────────────────────────
await tab(page, "Made-up Meter").click();
await page.getByTestId("waived-panel").waitFor({ timeout: 15000 });
const M = "waived-method-1";
check("waived system: the note names what the evaluator keeps", /evaluator sets Pass, the evaluator initials and the final sign-off/.test(await page.getByTestId("self-entry-note").innerText()));
check("waived system: evidence and date open; Pass and initials closed", await enabled(`${M}-specimen-0-evidence`) && await enabled(`${M}-specimen-0-date`) && await disabled(`${M}-specimen-0-pass`) && await disabled(`${M}-specimen-0-initials`) && await enabled("waived-method-2-evidence") && await enabled("waived-method-2-date") && await disabled("waived-method-2-passed") && await disabled("waived-method-2-initials"));
await page.getByTestId(`${M}-specimen-0-evidence`).fill("BS-1 glucose 92");
await page.getByTestId(`${M}-specimen-0-date`).fill(day);
await page.getByTestId(`${M}-add-specimen`).click();
await page.getByTestId(`${M}-specimen-1-evidence`).fill("BS-2 glucose 180");
await page.getByTestId(`${M}-specimen-1-date`).fill(day2);
await page.getByTestId("waived-method-3-evidence").fill("QC reviewed");
await page.getByTestId("waived-method-3-date").fill(day2);
await shot(page, "own-waived-entry");
await page.getByTestId("save-test-system").click();
await savedToast(page);
await page.waitForLoadState("networkidle");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Meter").click();
await page.getByTestId("waived-panel").waitFor({ timeout: 15000 });
check("reloaded: both specimens and the method persisted", (await page.getByTestId(`${M}-specimen-1-evidence`).inputValue()) === "BS-2 glucose 180" && (await page.getByTestId("waived-method-3-evidence").inputValue()) === "QC reviewed");
check("0 of 2 passed: entering evidence doesn't pass anything", /0 of 2 required methods passed/.test(await page.getByTestId("waived-count").innerText()));
check("their entries read Needs review, not Not passed", (await page.getByTestId("waived-method-3").getByTestId("needs-review-chip").count()) === 1 && !/Not passed/.test(await page.getByTestId("waived-panel").innerText()));
await shot(page, "own-waived-saved");

// ── Someone else's record ────────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${benId}`, { waitUntil: "networkidle" });
await page.getByTestId("test-system-list").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
const openFields = await page.locator('[data-testid^="element-"] input:not([disabled]), [data-testid^="element-"] button:not([disabled]), [data-testid^="waived-"] input:not([disabled])').count();
check("another person's record: every field disabled, no Save, no note", openFields === 0 && (await page.getByTestId("save-test-system").count()) === 0 && (await page.getByTestId("self-entry-note").count()) === 0, String(openFields));
check("another person's record: their entries show as before", (await page.getByTestId("element-1-specimenId").inputValue()) === "BEN-1");
await shot(page, "other-person");
await tab(page, "Made-up Meter").click();
await page.getByTestId("waived-panel").waitFor({ timeout: 15000 });
check("another person's waived system: no Add specimen and everything closed", (await page.getByTestId(`${M}-add-specimen`).count()) === 0 && await disabled(`${M}-specimen-0-evidence`) && await disabled("waived-method-2-evidence"));

// ── The owner sees no change ─────────────────────────────────────────────────
const ownerPage = await open(owner);
await ownerPage.goto(`${BASE}${own}`, { waitUntil: "networkidle" });
await ownerPage.getByTestId("test-system-list").waitFor({ timeout: 20000 });
await tab(ownerPage, "Made-up Analyzer").click();
await ownerPage.getByTestId("element-1").waitFor({ timeout: 15000 });
check("owner: no self-entry note; Pass, N/A and observer open; the person's data is there", (await ownerPage.getByTestId("self-entry-note").count()) === 0 && await ownerPage.getByTestId("element-1-pass").isEnabled() && await ownerPage.getByTestId("element-1-na").isEnabled() && await ownerPage.getByTestId("element-4-dateObserved").isEnabled() && await ownerPage.getByTestId("element-5-acceptable-0").isEnabled() && (await ownerPage.getByTestId("element-1-specimenId").inputValue()) === "SPEC-777");
check("owner: the same entry reads Needs review for the evaluator too, until they mark Pass", (await ownerPage.getByTestId("element-1").getByTestId("needs-review-chip").count()) === 1 && !/\bFAIL\b/.test(await ownerPage.getByTestId("element-1").innerText()));
await shot(ownerPage, "owner-view");
await ownerPage.getByTestId("element-1-pass").check();
await ownerPage.getByTestId("save-test-system").click();
await savedToast(ownerPage);
await page.goto(`${BASE}${own}`, { waitUntil: "networkidle" });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
check("after the evaluator marks Pass the person sees it, locked, and their samples kept", await page.getByTestId("element-1-pass").isChecked() && await disabled("element-1-pass") && /PASS/.test(await page.getByTestId("element-1").innerText()) && (await page.getByTestId("element-5-sampleId-1").inputValue()) === "BL-2");
await page.getByTestId("element-1-specimenId").fill("SPEC-778");
await page.getByTestId("save-test-system").click();
await savedToast(page);
await page.waitForLoadState("networkidle");
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(page, "Made-up Analyzer").click();
await page.getByTestId("element-1").waitFor({ timeout: 15000 });
check("a later correction by the person saves and the evaluator's Pass stays", (await page.getByTestId("element-1-specimenId").inputValue()) === "SPEC-778" && await page.getByTestId("element-1-pass").isChecked());

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open(ann, { colorScheme: "dark" });
await dark.goto(`${BASE}${own}`, { waitUntil: "networkidle" });
await dark.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(dark, "Made-up Analyzer").click();
await dark.getByTestId("element-1").waitFor({ timeout: 15000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "own-dark");
await tab(dark, "Made-up Meter").click();
await dark.getByTestId("waived-panel").waitFor({ timeout: 15000 });
await shot(dark, "own-waived-dark");
await dark.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
await dark.getByTestId("sp-tile-competency").click();
await dark.getByTestId("sp-competency-own-record").waitFor({ timeout: 15000 });
await shot(dark, "signoffs-dark");
// A second, unacknowledged record, so the entry block itself is seen in dark.
await call("POST", `${L}/competency/assessments`, { programId: prog, employeeId: compEmp, assessmentType: "annual", assessmentDate: day2, evaluatorName: "Made Up Evaluator", evaluatorInitials: "ME", competencyType: "waived", status: "pass", items: [
  { methodNumber: 1, waivedMethodNumber: 1, waivedEvidence: "BS-9 from the evaluator", waivedDate: day2, waivedInitials: "ME", passed: true, waivedSpecimens: [{ evidence: "BS-9 from the evaluator", date: day2, initials: "ME", passed: true }] },
  { methodNumber: 2, waivedMethodNumber: 2, waivedEvidence: "", waivedDate: "", waivedInitials: "ME", passed: false },
] }, owner.token);
await dark.reload({ waitUntil: "networkidle" });
await dark.getByTestId("sp-tile-competency").click();
await dark.getByTestId("sp-competency-row").filter({ hasText: "annual" }).first().click();
await dark.getByTestId("sp-myinfo-waived").waitFor({ timeout: 15000 });
await shot(dark, "waived-record-dark");

const phone = await open(ann, { viewport: { width: 375, height: 812 } });
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await phone.goto(`${BASE}${own}`, { waitUntil: "networkidle" });
await phone.getByTestId("self-entry-note").waitFor({ timeout: 20000 });
await tab(phone, "Made-up Analyzer").click();
await phone.getByTestId("element-1").waitFor({ timeout: 15000 });
check("phone: own record has no sideways scroll", await noSideways(phone));
check("phone: the specimen field can be used", await phone.getByTestId("element-1-specimenId").isEnabled());
// The "Needs review" chip is longer than the others; it must stay inside its card.
const chipsInside = await phone.evaluate(() => Array.from(document.querySelectorAll('[data-testid="needs-review-chip"]')).every((chip) => {
  const card = chip.closest('[data-testid^="element-"], [data-testid^="waived-method-"]');
  return card && chip.getBoundingClientRect().right <= card.getBoundingClientRect().right;
}));
check("phone: every Needs review chip stays inside its card", chipsInside);
await shot(phone, "own-phone");
await tab(phone, "Made-up Meter").click();
await phone.getByTestId("waived-panel").waitFor({ timeout: 15000 });
check("phone: waived system has no sideways scroll", await noSideways(phone));
await shot(phone, "own-waived-phone");
await phone.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
await phone.getByTestId("sp-tile-competency").click();
await phone.getByTestId("sp-competency-own-record").waitFor({ timeout: 15000 });
check("phone: My sign-offs list has no sideways scroll", await noSideways(phone));
await shot(phone, "signoffs-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
