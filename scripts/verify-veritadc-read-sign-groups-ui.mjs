// scripts/verify-veritadc-read-sign-groups-ui.mjs
//
// Browser receipt for VeritaDC read-and-sign by group (Step D of Heywood's move out of MediaLab). On a local production build with a scratch DB,
// a made-up owner, made-up manuals and documents, and made-up roster people. Screens driven, as the people who use them:
//   E1. The owner opens a manual's Read-and-sign, picks a group and assigns it. It says no email goes out, and none does.
//   E2. A sub-manual's document shows it inherited the assignment, and says from where.
//   E3. One document goes to a named person; the Who still owes tab answers by group.
//   E4. The notice says what it will do and sends nothing until asked; cancel sends nothing.
//   E5. The document tracker shows who owes it, by group; the group filter narrows it.
//   S1. A Staff login in the group: My sign-offs lists only their documents, the rest not at all.
//   S2. They sign one: the row reads Signed and the roster shows it.
//   S3. The read-only lookup finds another approved document and opens it with nothing to sign; a draft isn't found.
//   S4. The main VeritaDC document list holds only their documents; no Tracker, no Compliance tab.
//   S5. A Staff login with nothing assigned sees an empty list that says so.
//   D1. Light, dark and phone width read and do not overflow.
// Run: UI_REPO=<worktree> UI_SCRIPT=verify-veritadc-read-sign-groups-ui.mjs UI_OUT=<dir> UI_DB=<db> bash /c/Users/veril/projects/vls-ops/ui_run_repo.sh
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Read", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `readsignui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Read Sign Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Read Sign Test Lab', '22D0000654', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const addEmp = (first, last) => Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', ?, ?)", staffLab, labId, ownerId, last, first, now, now).lastInsertRowid);
const addStaff = async (first, last) => {
  const e = `readsignui-${first.toLowerCase()}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name: `${first} ${last}`, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  const emp = addEmp(first, last);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')", ownerId, e, id, labId, emp);
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { email: e, id, emp, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token, name: `${first} ${last}` };
};
const P = `/api/labs/${labId}/veritapolicy`;
const ann = await addStaff("Ann", "Chem");
const bea = await addStaff("Bea", "Micro");
const dee = await addStaff("Dee", "Nothing");
const nia = addEmp("Nia", "Nologin");

// Groups, entered through the same route the Manage groups screen uses. Made-up names.
const mkGroup = async (name) => (await call("POST", `${P}/groups`, { name }, token)).body.groups.find((g) => g.name === name).id;
const chem = await mkGroup("Made-up Chemistry");
const micro = await mkGroup("Made-up Micro");
for (const emp of [ann.emp, nia]) await call("POST", `${P}/groups/${chem}/members`, { employee_id: emp }, token);
await call("POST", `${P}/groups/${micro}/members`, { employee_id: bea.emp }, token);

const mkManual = async (name, parentId) => (await call("POST", `${P}/manuals`, { name, ...(parentId ? { parentId } : {}) }, token)).body.id;
const hospital = await mkManual("Made-up Hospital");
const chemManual = await mkManual("Made-up Chemistry Manual", hospital);
const analyzers = await mkManual("Made-up Analyzers", chemManual);
const microManual = await mkManual("Made-up Micro Manual", hospital);
const uploadDoc = async (title, manualId, approve = true) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(`Made-up text for ${title}\n`)], { type: "text/plain" }), "made-up.txt");
  fd.append("title", title);
  fd.append("manual_id", String(manualId));
  const d = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  if (approve) sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", d.id);
  return d.id;
};
const docGlucose = await uploadDoc("Made-up Glucose procedure", chemManual);
const docCobas = await uploadDoc("Made-up Cobas procedure", analyzers);
const docGram = await uploadDoc("Made-up Gram stain procedure", microManual);
await uploadDoc("Made-up Secret draft", chemManual, false);

const browser = await chromium.launch();
const errors = [];
const openAs = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [tk, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const fits = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;
const SIGNOFFS = `/labs/${labId}/my-signoffs`;
const noticesSent = () => sql("SELECT COUNT(*) AS n FROM policy_audit_log WHERE lab_id = ? AND action = 'read_sign_notice_sent'", labId).n;

// ── The owner ───────────────────────────────────────────────────────────────
{
  const page = await openAs(token, POLICIES);
  const rowText = await page.getByTestId("doc-read-sign-targets").first().innerText();
  check("E0. the documents page says who a document goes to, nobody yet", /nobody yet/.test(rowText), rowText);
  await page.screenshot({ path: `${OUT}/readsign-owner-list.png` });
  await page.getByTestId(`manual-readsign-${chemManual}`).click();
  await page.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const cover = await page.getByTestId("readsign-coverage").innerText();
  check("E1. the manual says what it covers, sub-manuals and later documents", /2 documents in this manual and its sub-manuals today, and any added later/.test(cover), cover);
  check("E1. it says assigning sends no email", /sends no email/.test(await page.getByTestId("readsign-no-email").innerText()));
  await page.getByTestId(`readsign-pick-group-${chem}`).check();
  await page.screenshot({ path: `${OUT}/readsign-manual-assign.png` });
  await page.getByTestId("readsign-assign").click();
  await page.getByTestId("readsign-message").waitFor({ timeout: 15000 });
  const said = await page.getByTestId("readsign-message").innerText();
  check("E1. assigning says no email was sent", /No email was sent/.test(said), said);
  check("E1. no notice went out", noticesSent() === 0);
  const assigned = await page.getByTestId("readsign-current").innerText();
  check("E1. the group is listed with its people", /Made-up Chemistry/.test(assigned) && /2 people/.test(assigned), assigned);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/readsign-manual-assigned.png` });
  await page.getByTestId("readsign-close").click();
  await page.waitForTimeout(500);

  // The sub-manual's document inherits it.
  const cobasRow = page.locator("tr").filter({ hasText: "Made-up Cobas procedure" });
  await cobasRow.getByTestId("doc-readsign-button").click();
  await page.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const inherited = await page.getByTestId("readsign-current").innerText();
  check("E2. a sub-manual's document shows what it inherits, and from where", /Made-up Chemistry/.test(inherited) && /From Made-up Hospital › Made-up Chemistry Manual/.test(inherited), inherited);
  await page.screenshot({ path: `${OUT}/readsign-inherited.png` });

  // One document to a named person.
  await page.getByTestId("readsign-person-search").fill("Micro");
  await page.getByTestId(`readsign-pick-person-${bea.emp}`).check();
  await page.getByTestId("readsign-assign").click();
  await page.getByTestId("readsign-message").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  check("E3. a named person is added to one document", /Micro, Bea/.test(await page.getByTestId("readsign-current").innerText()));
  await page.getByTestId("readsign-close").click();
  await page.waitForTimeout(400);

  // The whole-lab view: by group.
  await page.getByTestId("readsign-open").click();
  await page.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await page.getByTestId("readsign-tab-owes").click();
  await page.getByTestId("readsign-tracker").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const counts = await page.getByTestId(`readsign-group-group:${chem}`).innerText();
  check("E3. Who still owes answers by group", /Made-up Chemistry/.test(counts) && /2 people, 2 documents: 0 signed, 4 still owed/.test(counts), counts);
  check("E3. it flags who can't sign yet", /no login/.test(await page.getByTestId("readsign-tracker").innerText()));
  await page.getByTestId(`readsign-group-group:${chem}`).getByTestId("readsign-group-toggle").click();
  await page.waitForTimeout(300);
  check("E3. a group opens to its people", /Chem, Ann/.test(await page.getByTestId(`readsign-person-${ann.emp}`).innerText()) && /No login/.test(await page.getByTestId(`readsign-person-${nia}`).innerText()));
  await page.screenshot({ path: `${OUT}/readsign-who-owes.png` });

  // The notice, deliberate and separate.
  await page.getByTestId("readsign-tab-assign").click();
  await page.getByTestId("readsign-notice-open").click();
  await page.getByTestId("readsign-notice-plan").waitFor({ timeout: 15000 });
  const plan = await page.getByTestId("readsign-notice-plan").innerText();
  check("E4. the notice says what it does before it does it", /emails 2 people/.test(plan) && /one email/.test(plan) && /won't repeat on its own/.test(plan) && /no login or address won't get it/.test(plan), plan);
  await page.screenshot({ path: `${OUT}/readsign-notice.png` });
  await page.getByTestId("readsign-notice-cancel").click();
  check("E4. cancelled, nothing went out", noticesSent() === 0);
  await page.getByTestId("readsign-close").click();
  await page.waitForTimeout(400);

  // The document tracker.
  const row = page.locator("tr").filter({ hasText: "Made-up Glucose procedure" });
  await row.getByTestId("tracker-button").click();
  await page.getByTestId("signature-roster").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const line = await page.getByTestId("roster-assigned").innerText();
  check("E5. the tracker says who it is assigned to and who still owes it", /Assigned to 2: 0 signed, 2 still owe it/.test(line) && /Made-up Chemistry/.test(line), line);
  check("E5. someone nobody assigned reads Not assigned", /Not assigned/.test(await page.getByTestId(`roster-row-${dee.emp}`).innerText()));
  await page.screenshot({ path: `${OUT}/readsign-tracker.png` });
  check("E5. the older per-person box doesn't contradict it", /per-person assignment/.test(await page.getByTestId("tracker-no-per-person").innerText()) && !/No one is assigned/.test(await page.getByRole("dialog").innerText()));
  await page.getByTestId(`roster-group-${chem}`).click();
  await page.waitForTimeout(200);
  const filtered = await page.getByTestId("signature-roster").innerText();
  check("E5. the group filter narrows the list", /Chem, Ann/.test(filtered) && !/Nothing, Dee/.test(filtered));
  await page.screenshot({ path: `${OUT}/readsign-tracker-by-group.png` });
  await page.context().close();
}

// ── A Staff login in the group ──────────────────────────────────────────────
{
  const page = await openAs(ann.token, SIGNOFFS);
  const badge = await page.getByTestId("sp-tile-policies-badge").innerText();
  check("S1. the tile counts only their documents", badge.trim() === "2", badge);
  await page.screenshot({ path: `${OUT}/readsign-staff-tiles.png` });
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const list = await page.getByTestId("sp-policies-list").innerText();
  check("S1. My sign-offs lists their documents", /Made-up Glucose procedure/.test(list) && /Made-up Cobas procedure/.test(list), list.slice(0, 200));
  check("S1. and nothing else", !/Gram stain/.test(list) && !/Secret draft/.test(list));
  check("S1. each row names its manual", /Made-up Hospital › Made-up Chemistry Manual/.test(list));
  await page.screenshot({ path: `${OUT}/readsign-staff-list.png` });

  // They sign one.
  await page.getByText("Made-up Glucose procedure").first().click();
  await page.getByTestId("sp-policies-typed-name").waitFor({ timeout: 15000 });
  await page.getByTestId("sp-policies-sign-submit").click();
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const saved = sql("SELECT typed_signature, version_id, signed_at FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?", docGlucose, ann.emp);
  const current = sql("SELECT current_version_id AS v FROM policy_documents WHERE id = ?", docGlucose).v;
  check("S2. the signature records who, when and the version", saved?.typed_signature === ann.name && saved?.version_id === current && !!saved?.signed_at, JSON.stringify(saved));
  check("S2. the row reads Signed", await page.getByTestId("sp-policies-row-signed").count() === 1);

  // The read-only lookup.
  await page.getByTestId("sp-policies-lookup-input").fill("Gram");
  await page.getByTestId("sp-policies-lookup-results").waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  const found = await page.getByTestId("sp-policies-lookup-results").innerText();
  check("S3. the lookup finds another approved document, read only", /Made-up Gram stain procedure/.test(found) && /Read only/.test(found), found);
  await page.screenshot({ path: `${OUT}/readsign-staff-lookup.png` });
  await page.getByTestId("sp-policies-lookup-row").first().click();
  await page.getByTestId("sp-policies-read-only").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  check("S3. it opens with nothing to sign", await page.getByTestId("sp-policies-sign-block").count() === 0 && /nothing to sign/.test(await page.getByTestId("sp-policies-read-only").innerText()));
  check("S3. and shows the document", /Made-up text for Made-up Gram stain procedure/.test(await page.getByTestId("sp-policies-detail").innerText()));
  await page.screenshot({ path: `${OUT}/readsign-staff-read-only.png` });
  await page.getByTestId("sp-policies-back-to-list").click();
  await page.getByTestId("sp-policies-lookup-input").fill("Secret");
  await page.getByTestId("sp-policies-lookup-none").waitFor({ timeout: 15000 });
  check("S3. a draft isn't found", true);

  // The main VeritaDC list.
  await page.goto(`${BASE}${POLICIES}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const main = await page.locator("body").innerText();
  check("S4. the document list holds only their documents", /Made-up Glucose procedure/.test(main) && /Made-up Cobas procedure/.test(main) && !/Gram stain/.test(main) && !/Secret draft/.test(main));
  check("S4. each says where they stand", /You signed this version/.test(main) && /Needs your signature/.test(main));
  check("S4. no Tracker, no Assign", !(await page.getByTestId("tracker-button").first().isVisible().catch(() => false)) && !(await page.getByTestId("doc-readsign-button").first().isVisible().catch(() => false)));
  check("S4. no Compliance tab", await page.getByTestId("veritapolicy-tab-compliance").count() === 0);
  await page.screenshot({ path: `${OUT}/readsign-staff-documents.png` });
  await page.getByTestId("staff-doc-lookup-input").fill("Gram");
  await page.getByTestId("staff-doc-lookup-results").waitFor({ timeout: 15000 });
  await page.getByTestId("staff-doc-lookup-open").first().click();
  await page.getByText("Made-up text for Made-up Gram stain procedure").first().waitFor({ timeout: 15000 });
  check("S4. the main app's lookup opens it too", true);
  await page.waitForTimeout(400);
  check("S4. with no audit trail or signature report", await page.getByTestId("audit-trail-button").isVisible().catch(() => false) === false && await page.getByTestId("signature-report-button").count() === 0);
  await page.screenshot({ path: `${OUT}/readsign-staff-main-read.png` });
  await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/compliance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("S4. the compliance page says it's for owners and editors", /for owners and editors/.test(await page.getByTestId("compliance-staff-note").innerText()));
  await page.context().close();
}

// ── A Staff login with nothing assigned ─────────────────────────────────────
{
  const page = await openAs(dee.token, SIGNOFFS);
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-none-assigned").waitFor({ timeout: 15000 });
  check("S5. an empty list says so", /No documents are assigned to you/.test(await page.getByTestId("sp-policies-none-assigned").innerText()));
  await page.screenshot({ path: `${OUT}/readsign-staff-empty.png` });
  await page.goto(`${BASE}${POLICIES}`, { waitUntil: "networkidle" });
  await page.getByTestId("documents-empty").waitFor({ timeout: 15000 });
  check("S5. so does the document list", /No documents are assigned to you/.test(await page.getByTestId("documents-empty").innerText()));
  await page.context().close();
}

// ── After signing: the owner's roster ───────────────────────────────────────
{
  const page = await openAs(token, POLICIES);
  const row = page.locator("tr").filter({ hasText: "Made-up Glucose procedure" });
  await row.getByTestId("tracker-button").click();
  await page.getByTestId("signature-roster").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const line = await page.getByTestId("roster-assigned").innerText();
  check("S2. the owner's tracker moved", /Assigned to 2: 1 signed, 1 still owe it/.test(line), line);
  check("S2. her row reads signed", /Signed \d{4}-\d{2}-\d{2}/.test(await page.getByTestId(`roster-row-${ann.emp}`).innerText()));
  await page.getByTestId("roster-open-only").check();
  await page.waitForTimeout(200);
  const open = await page.getByTestId("signature-roster").innerText();
  check("S2. Only who still owes it leaves out her and anyone not assigned", !/Chem, Ann/.test(open) && !/Nothing, Dee/.test(open) && /Nologin, Nia/.test(open), open.slice(0, 300));
  await page.context().close();
}

// ── Dark and phone ──────────────────────────────────────────────────────────
{
  const dark = await openAs(token, POLICIES, { dark: true });
  await dark.getByTestId("readsign-open").click();
  await dark.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await dark.waitForTimeout(500);
  await dark.screenshot({ path: `${OUT}/readsign-dark-assign.png` });
  await dark.getByTestId("readsign-tab-owes").click();
  await dark.getByTestId("readsign-tracker").waitFor({ timeout: 15000 });
  await dark.waitForTimeout(400);
  await dark.screenshot({ path: `${OUT}/readsign-dark-who-owes.png` });
  check("D1. dark mode: the page doesn't overflow", await fits(dark));
  await dark.getByTestId("readsign-close").click();
  await dark.waitForTimeout(300);
  const row = dark.locator("tr").filter({ hasText: "Made-up Glucose procedure" });
  await row.getByTestId("tracker-button").click();
  await dark.getByTestId("signature-roster").waitFor({ timeout: 15000 });
  await dark.waitForTimeout(500);
  await dark.screenshot({ path: `${OUT}/readsign-dark-tracker.png` });
  await dark.context().close();

  const darkStaff = await openAs(ann.token, SIGNOFFS, { dark: true });
  await darkStaff.getByTestId("sp-tile-policies").click();
  await darkStaff.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await darkStaff.getByTestId("sp-policies-lookup-input").fill("Gram");
  await darkStaff.getByTestId("sp-policies-lookup-results").waitFor({ timeout: 15000 });
  await darkStaff.waitForTimeout(400);
  await darkStaff.screenshot({ path: `${OUT}/readsign-dark-staff.png` });
  check("D1. dark mode, Staff login: doesn't overflow", await fits(darkStaff));
  await darkStaff.context().close();

  const phone = await openAs(token, POLICIES, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId("manuals-open").click();
  await phone.getByTestId(`manuals-readsign-${chemManual}`).waitFor({ timeout: 15000 });
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${OUT}/readsign-phone-manuals.png` });
  const manualBtn = await phone.getByTestId(`manuals-readsign-${chemManual}`).boundingBox();
  check("D1. phone width: a manual's Read-and-sign button is on screen", !!manualBtn && manualBtn.x >= 0 && manualBtn.x + manualBtn.width <= 391, JSON.stringify(manualBtn));
  await phone.getByTestId(`manuals-readsign-${chemManual}`).click();
  await phone.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await phone.getByTestId("readsign-close").click();
  await phone.waitForTimeout(400);
  await phone.getByTestId("readsign-open").click();
  await phone.getByTestId("readsign-dialog").waitFor({ timeout: 15000 });
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${OUT}/readsign-phone-assign.png` });
  const box = await phone.getByTestId("readsign-dialog").boundingBox();
  check("D1. phone width: the dialog fits the screen", !!box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  await phone.getByTestId("readsign-tab-owes").click();
  await phone.getByTestId("readsign-tracker").waitFor({ timeout: 15000 });
  await phone.waitForTimeout(400);
  await phone.screenshot({ path: `${OUT}/readsign-phone-who-owes.png` });
  const counts = await phone.getByTestId("readsign-group-counts").first().boundingBox();
  check("D1. phone width: the counts are on screen", !!counts && counts.x + counts.width <= 391, JSON.stringify(counts));
  await phone.getByTestId("readsign-close").click();
  await phone.waitForTimeout(300);
  await phone.context().close();

  const phoneStaff = await openAs(ann.token, SIGNOFFS, { viewport: { width: 390, height: 844 } });
  await phoneStaff.getByTestId("sp-tile-policies").click();
  await phoneStaff.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await phoneStaff.getByTestId("sp-policies-lookup-input").fill("Gram");
  await phoneStaff.getByTestId("sp-policies-lookup-results").waitFor({ timeout: 15000 });
  await phoneStaff.waitForTimeout(400);
  await phoneStaff.screenshot({ path: `${OUT}/readsign-phone-staff.png`, fullPage: true });
  check("D1. phone width, Staff login: doesn't overflow", await fits(phoneStaff));
  await phoneStaff.context().close();
}

check("no page threw an error", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
