// scripts/verify-program-delete-refusal-ui.mjs
// Gate 3 receipt for Michael 2026-11-06, Q184 = 1: on VeritaComp, the delete box for a program holding competency records says how many it holds and that they
// can't be deleted that way, with no Delete button. If the list is out of date, the server's refusal lands in the same box. An empty program still deletes with
// the existing confirm box. Run against a LOCAL production build on a scratch database, with made-up people (it registers people and provisions a lab, so it
// refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-program-delete-refusal-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");

const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up records directly to a scratch database.");
const PW = ["Delete", "refused", "77!"].join("-");

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
// The box fades in, so wait it out or the picture shows it half see-through.
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `site-programdelete-${name}.png`) }); };

// ── Made-up lab, one owner, programs with and without records ────────────────
const stamp = Date.now();
const email = `programdelete-${stamp}@example.test`;
const owner = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Program Delete UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Program Delete UI Lab", cliaNumber: "99D9999996", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const staffId = (await call("POST", `${L}/staff/employees`, { lastName: "Self", firstName: "Ann", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).id;
const mkProgram = async (name) => (await call("POST", `${L}/competency/programs`, { name, department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, owner.token)).id;
const fullId = await mkProgram("Made-up Full Program"), oneId = await mkProgram("Made-up One Record Program"), staleId = await mkProgram("Made-up Out Of Date Program"), emptyId = await mkProgram("Made-up Empty Program"), failingId = await mkProgram("Made-up Failing Program");

const now = new Date().toISOString();
const openDb = () => new Database(process.env.SCRATCH_DB);
const sdb = openDb();
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
const compId = sdb.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(staffId, labId)?.id
  ?? sdb.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, status, staff_employee_id, created_at) VALUES (?, ?, 'Ann Self', 'Made-up Tech', '2019-03-01', 'active', ?, ?)").run(ownerId, labId, staffId, now).lastInsertRowid;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999996' WHERE id = ?").run(labId);
sdb.close();
const addRecord = (programId) => {
  const d = openDb();
  const id = d.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, status, created_at) VALUES (?, ?, 'annual', '2026-10-15', 'Made Up Evaluator', 'pass', ?)").run(programId, compId, now).lastInsertRowid;
  d.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, item_label, passed) VALUES (?, 1, 'Made-up item', 1)").run(id);
  d.close();
};
addRecord(fullId); addRecord(fullId); addRecord(fullId);
addRecord(oneId);
const programRow = (id) => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) AS n FROM competency_programs WHERE id = ?").get(id).n; d.close(); return n; };
const recordsOf = (id) => { const d = openDb(); const n = d.prepare("SELECT COUNT(*) AS n FROM competency_assessments WHERE program_id = ?").get(id).n; d.close(); return n; };
check("made-up lab, an owner, programs with three records, one record and none", !!labId && !!compId && recordsOf(fullId) === 3 && recordsOf(oneId) === 1 && recordsOf(emptyId) === 0);

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
  await page.getByTestId(`program-card-${fullId}`).waitFor({ timeout: 20000 });
};
const card = (page, id) => page.getByTestId(`program-card-${id}`);
const trash = (page, id) => card(page, id).getByTestId("program-delete");
const dialog = (page) => page.getByRole("dialog");
const deleteCalls = (page) => { const seen = []; page.on("request", (r) => { if (r.method() === "DELETE" && r.url().includes("/competency/programs/")) seen.push(r.url()); }); return seen; };
const copyClean = async (page, where) => {
  const text = await dialog(page).innerText();
  check(`${where}: no em dash, and no "Staff Portal" wording`, !text.includes("—") && !/Staff Portal/.test(text), text);
};

// A program holding records: the box says so as soon as it opens.
const page = await open();
const sent = deleteCalls(page);
await loadList(page);
await trash(page, fullId).click();
await dialog(page).waitFor({ timeout: 10000 });
const fullText = await dialog(page).innerText();
check("three records: the box says it can't be deleted", /This program can't be deleted/.test(fullText), fullText);
check("three records: says how many, and that they can't be deleted that way", /holds 3 competency records\./.test(fullText) && /can't be deleted by deleting the program/.test(fullText), fullText);
check("three records: there is no Delete button to try, only Close", (await page.getByTestId("program-delete-confirm").count()) === 0 && (await page.getByTestId("program-delete-close").count()) === 1);
check("three records: the old warning about removing everything isn't shown", !/permanently removed/.test(fullText), fullText);
await copyClean(page, "three records");
await shot(page, "refusal");
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
check("three records: nothing was sent, and the program and its records are still there", sent.length === 0 && programRow(fullId) === 1 && recordsOf(fullId) === 3 && (await card(page, fullId).count()) === 1, sent.join(" "));

await trash(page, oneId).click();
await dialog(page).waitFor({ timeout: 10000 });
const oneText = await dialog(page).innerText();
check("one record: the words are singular", /holds 1 competency record\./.test(oneText), oneText);
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });

// The list is out of date: it says none, the server knows better, and the refusal lands in the same box.
addRecord(staleId);
await trash(page, staleId).click();
await dialog(page).waitFor({ timeout: 10000 });
check("out of date: the list said none, so the confirm box opens", /Delete Program\?/.test(await dialog(page).innerText()));
const refused = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/competency/programs/${staleId}`));
await page.getByTestId("program-delete-confirm").click();
const refusedRes = await refused;
check("out of date: the server refuses with 409", refusedRes.status() === 409, String(refusedRes.status()));
await page.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
const staleText = await dialog(page).innerText();
check("out of date: the refusal lands in the same box, in the same words", /This program can't be deleted/.test(staleText) && /holds 1 competency record\./.test(staleText) && /can't be deleted by deleting the program/.test(staleText), staleText);
check("out of date: the Delete button is gone", (await page.getByTestId("program-delete-confirm").count()) === 0);
await shot(page, "refusal-from-server");
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
check("out of date: the program and its record are still there", programRow(staleId) === 1 && recordsOf(staleId) === 1 && (await card(page, staleId).count()) === 1);
await card(page, staleId).getByText("1 assessment").waitFor({ timeout: 10000 });
await trash(page, staleId).click();
await page.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
check("out of date: the list has caught up, so the box now says so as it opens", (await page.getByTestId("program-delete-confirm").count()) === 0);
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });

// Some other failure: plain words, and it doesn't stick.
await page.route(`**/competency/programs/${failingId}`, (route) => (route.request().method() === "DELETE" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.fallback()));
await trash(page, failingId).click();
await dialog(page).waitFor({ timeout: 10000 });
await page.getByTestId("program-delete-confirm").click();
await page.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
const failedText = await dialog(page).innerText();
check("another failure: says it could not be deleted, with no count", /could not be deleted\. Please try again\./.test(failedText) && !/competency record/.test(failedText), failedText);
await page.getByTestId("program-delete-close").click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
await trash(page, failingId).click();
await dialog(page).waitFor({ timeout: 10000 });
check("another failure: it doesn't stick after Close, reopening shows the confirm box again", /Delete Program\?/.test(await dialog(page).innerText()) && (await page.getByTestId("program-delete-confirm").count()) === 1);
await page.getByTestId("program-delete-confirm").click();
await page.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
await page.keyboard.press("Escape");
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
await page.unroute(`**/competency/programs/${failingId}`);
await trash(page, failingId).click();
await dialog(page).waitFor({ timeout: 10000 });
check("another failure: it doesn't stick after Escape either", /Delete Program\?/.test(await dialog(page).innerText()) && (await page.getByTestId("program-delete-confirm").count()) === 1);
await page.getByRole("button", { name: "Cancel" }).click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });

// An empty program: the existing box, and it deletes.
await trash(page, emptyId).click();
await dialog(page).waitFor({ timeout: 10000 });
const emptyText = await dialog(page).innerText();
check("empty: the existing confirm box, with the program's name", /Delete Program\?/.test(emptyText) && /Are you sure you want to delete "Made-up Empty Program"\?/.test(emptyText), emptyText);
await copyClean(page, "empty");
await shot(page, "confirm-empty");
await page.getByRole("button", { name: "Cancel" }).click();
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
check("empty: Cancel keeps it", programRow(emptyId) === 1 && (await card(page, emptyId).count()) === 1);
await trash(page, emptyId).click();
await dialog(page).waitFor({ timeout: 10000 });
const deleted = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes(`/competency/programs/${emptyId}`));
await page.getByTestId("program-delete-confirm").click();
check("empty: the delete succeeds", (await deleted).status() === 200);
await dialog(page).waitFor({ state: "hidden", timeout: 10000 });
await card(page, emptyId).waitFor({ state: "detached", timeout: 10000 });
check("empty: the box closes, the card goes, and the row is gone", programRow(emptyId) === 0 && (await card(page, emptyId).count()) === 0);
await shot(page, "after-empty-delete");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await loadList(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await trash(dark, fullId).click();
await dark.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
await shot(dark, "refusal-dark");
await dark.getByTestId("program-delete-close").click();
await dialog(dark).waitFor({ state: "hidden", timeout: 10000 });
await trash(dark, failingId).click();
await dialog(dark).waitFor({ timeout: 10000 });
await shot(dark, "confirm-empty-dark");

const phone = await open({ viewport: { width: 375, height: 812 } });
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await loadList(phone);
await trash(phone, fullId).click();
await phone.getByTestId("program-delete-refusal").waitFor({ timeout: 10000 });
check("phone: the refusal has no sideways scroll", await noSideways(phone));
const box = await dialog(phone).boundingBox();
check("phone: the box fits the screen", !!box && box.x >= 0 && box.x + box.width <= 375, JSON.stringify(box));
await shot(phone, "refusal-phone");
await phone.getByTestId("program-delete-close").click();
await dialog(phone).waitFor({ state: "hidden", timeout: 10000 });
await trash(phone, failingId).click();
await dialog(phone).waitFor({ timeout: 10000 });
check("phone: the confirm box has no sideways scroll", await noSideways(phone));
await shot(phone, "confirm-empty-phone");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
