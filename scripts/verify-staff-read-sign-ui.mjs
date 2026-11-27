// scripts/verify-staff-read-sign-ui.mjs
//
// Browser receipt: a Staff login's read-and-sign with a real signature (BUG-188, 2026-11-27; mock 3; server/policyStaffSign.ts,
// client/src/pages/StaffPortalPage.tsx). LOCAL production build + scratch DB only. Made-up laboratory, person and documents, the ones
// mock 3 draws. As the Staff login, on My sign-offs at phone width (390 px):
//   1. the list says how many documents are to sign, and offers Sign several because two or more are opened at the version listed
//   2. Sign several ticks the opened ones; one never opened, and one opened at an older version, can't be ticked and say why
//   3. one is revised while the list is on screen; the name and password sign the other two, each its own row, and What happened
//      says the third wasn't signed and why, in the mock's words
//   4. one document on its own: the signature asks for the password; a wrong one is refused and nothing is signed; the right one signs
//   5. light and dark screenshots; nothing wider than the screen; no page errors or Content-Security-Policy refusals
// Run: PW_BASE=http://localhost:<port> SCRATCH_DB=<db> OUT=<dir> node scripts/verify-staff-read-sign-ui.mjs
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
const all = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB, { readonly: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };
const pw = ["Read", "sign", "Ui", "4!"].join("-");
const wrongPw = ["Not", "the", "one", "7"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();

// ── Setup: one lab, Sam Rivera on a Staff login, five documents assigned to everyone ──
const ownerEmail = `readsign-ui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: pw, name: "Morgan Example", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Sample Regional Medical Center (Read and Sign QA)", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?", ownerEmail);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Sample Regional Medical Center', '22D0999999', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const samEmail = `readsign-ui-sam-${stamp}@example.com`;
const samReg = await call("POST", "/api/auth/register", { email: samEmail, password: pw, name: "Sam Rivera", hipaa_acknowledged: true });
const samId = Number(samReg.body.user?.id);
const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, 'Rivera', 'Sam', 'Medical Laboratory Scientist', 'active', ?, ?)", staffLab, labId, ownerId, now, now).lastInsertRowid);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, samId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, samId);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')", ownerId, samEmail, samId, labId, emp);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", samId);
const samToken = (await call("POST", "/api/auth/login", { email: samEmail, password: pw })).body.token;

const P = `/api/labs/${labId}/veritapolicy`;
await call("POST", `${P}/read-sign`, { scope: "lab", everyone: true }, token);
const TEXT = {
  "Critical Result Reporting": "1. Purpose. This procedure says who is told about a critical result, how fast, and how the call is recorded.\n2. Who it applies to. All testing personnel who report results.\n3. Steps. Repeat the test when the procedure for that test says so. Call the person who can act on the result. Have them read it back. Record the name, the date and the time of the call.\n",
};
const uploadDoc = async (title, docNumber) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(TEXT[title] || `Made-up procedure text for ${title}.\n`)], { type: "text/plain" }), "made-up.txt");
  fd.append("title", title);
  fd.append("doc_number", docNumber);
  const d = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", d.id);
  return d.id;
};
const revise = async (id) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(`Made-up revised text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
  fd.append("change_summary", "Made-up revision");
  const v = await (await fetch(`${BASE}${P}/documents/${id}/versions`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", id);
  return v;
};
const critical = await uploadDoc("Critical Result Reporting", "GEN-014");
const labeling = await uploadDoc("Specimen Labeling", "GEN-006");
const pipette = await uploadDoc("Pipette Calibration Check", "GEN-022");
const hygiene = await uploadDoc("Chemical Hygiene Plan", "SAF-002");
const exposure = await uploadDoc("Exposure Control Plan", "SAF-004");
// Sam has opened four of them before today (each opening recorded with its version); one was revised since he opened it.
for (const id of [critical, labeling, pipette, exposure]) await fetch(`${BASE}/api/staff-portal-session/policies/${id}/render`, { headers: { Authorization: `Bearer ${samToken}` } });
const exposureV = await revise(exposure);
check("0. a lab, Sam's Staff login, five documents, four opened, one revised since", !!labId && !!samToken && [critical, labeling, pipette, hygiene, exposure].every(Boolean) && exposureV.version_label === "1.1", JSON.stringify({ labId, v: exposureV.version_label }));

const browser = await chromium.launch();
const problems = [];
const openSam = async (dark) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(String(e)));
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push(m.text()); });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, samToken]);
  await page.evaluate(([t, u, l, d]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (d) localStorage.setItem("theme", "dark");
  }, [samToken, me, labId, !!dark]);
  await page.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
  await page.getByTestId("sp-tile-policies").click({ timeout: 20000 });
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.getByTestId("sp-policies-row").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  return page;
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// A whole-page picture from the top, so the sticky header sits where it belongs.
const shot = async (page, name) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250); await page.screenshot({ path: `${OUT}/${name}`, fullPage: true }); };

// ── Dark, phone: the list and Sign several, before anything is signed ──
{
  const page = await openSam(true);
  const head = await page.getByTestId("sp-policies-to-sign").innerText();
  check("1. the list says five documents to sign", /5 documents to sign/.test(head), head);
  check("1. Sign several shows, since two or more are opened at the version listed", await page.getByTestId("sp-policies-sign-several").count() === 1 && /3 documents opened and ready/.test(await page.getByTestId("sp-policies-several-bar").innerText()));
  check("5. dark list fits the phone", await fits(page));
  await shot(page, "readsign-list-dark-390.png");
  await page.getByTestId("sp-policies-sign-several").click();
  await page.getByTestId("sp-several-list").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  const rows = await page.getByTestId("sp-several-row").all();
  const state = [];
  for (const r of rows) state.push({ t: await r.getByTestId("sp-several-row-title").innerText(), on: await r.getByTestId("sp-several-tick").isChecked(), off: await r.getByTestId("sp-several-tick").isDisabled(), line: await r.getByTestId("sp-several-row-line").innerText() });
  const row = (t) => state.find((s) => s.t === t);
  check("2. the three opened at the version listed are ticked", ["Critical Result Reporting", "Specimen Labeling", "Pipette Calibration Check"].every((t) => row(t)?.on && !row(t)?.off) && /You opened it/.test(row("Critical Result Reporting")?.line || ""), JSON.stringify(state));
  check("2. one never opened can't be ticked, and says so", row("Chemical Hygiene Plan")?.off === true && row("Chemical Hygiene Plan")?.on === false && /SAF-002, v1\.0\. Open it before you sign it/.test(row("Chemical Hygiene Plan")?.line || ""), row("Chemical Hygiene Plan")?.line);
  check("2. one opened at an older version can't be ticked, and says which to open", row("Exposure Control Plan")?.off === true && /You opened v1\.0\. Open v1\.1 before you sign it/.test(row("Exposure Control Plan")?.line || ""), row("Exposure Control Plan")?.line);
  check("2. the signature says what it means, and asks for the password", /I have read each of the 3 documents ticked/.test(await page.getByTestId("sp-several-sign").innerText()) && await page.locator("#sp-several-password").count() === 1);
  check("5. dark Sign several fits the phone", await fits(page));
  await shot(page, "readsign-several-dark-390.png");
  await page.context().close();
}

// ── Light, phone: Sign several, with one revised while the list is on screen ──
{
  const page = await openSam(false);
  check("5. light list fits the phone", await fits(page));
  await shot(page, "readsign-list-light-390.png");
  await page.getByTestId("sp-policies-sign-several").click();
  await page.getByTestId("sp-several-sign").waitFor({ timeout: 10000 });
  await revise(pipette); // the list on screen still shows 1.0
  await page.locator("#sp-several-password").fill(wrongPw);
  await page.getByTestId("sp-several-submit").click();
  await page.getByTestId("sp-several-error").waitFor({ timeout: 10000 });
  const wrongText = await page.getByTestId("sp-several-error").innerText();
  const afterWrong = all("SELECT id FROM staff_portal_policy_signatures WHERE staff_employee_id = ?", emp).length;
  check("3. a wrong password: nothing was signed, in the mock's words", /Nothing was signed\. Password incorrect; signature not recorded/.test(wrongText) && afterWrong === 0, wrongText);
  await page.locator("#sp-several-password").fill(pw);
  await page.getByTestId("sp-several-submit").click();
  await page.getByTestId("sp-several-outcome").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const out = await page.getByTestId("sp-several-outcome").innerText();
  check("3. What happened: 2 documents signed, 1 not signed", /2 documents signed, 1 not signed/.test(out), out);
  check("3. the revised one says why, in the mock's words", /Pipette Calibration Check\. Not signed\. It was revised since the list was shown\. Open it and read it again before you sign\./.test(out.replace(/\s+/g, " ")), out);
  const rows = all("SELECT document_id, signed_with, signed_together, signed_document_hash FROM staff_portal_policy_signatures WHERE staff_employee_id = ? ORDER BY document_id", emp);
  const hashes = all("SELECT d.id, v.file_hash_sha256 AS h FROM policy_documents d JOIN policy_versions v ON v.id = d.current_version_id WHERE d.id IN (?, ?)", critical, labeling);
  check("3. each signed document has its own row: password, signed together, the server's hash", rows.length === 2 && rows.every((r) => r.signed_with === "password" && r.signed_together === 2 && hashes.find((h) => h.id === r.document_id)?.h === r.signed_document_hash) && !rows.some((r) => r.document_id === pipette), JSON.stringify(rows));
  check("3. and its own audit row", all("SELECT id FROM policy_audit_log WHERE action = 'read_and_signed' AND user_id = ?", samId).length === 2);
  check("5. light outcome fits the phone", await fits(page));
  await shot(page, "readsign-several-outcome-light-390.png");
  await page.context().close();
}

// ── Dark, phone: one document on its own ──
{
  const page = await openSam(true);
  await page.getByText("Chemical Hygiene Plan").first().click();
  await page.getByTestId("sp-policies-sign-block").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const block = await page.getByTestId("sp-policies-sign-block").innerText();
  check("4. the signature asks for the full name and the password", /Your signature/.test(block) && /Full name/.test(block) && /Your password/.test(block) && /The server makes the hash from the file it shows you/.test(block), block);
  await page.getByTestId("sp-policies-password").fill(wrongPw);
  await page.getByTestId("sp-policies-sign-submit").click();
  await page.getByTestId("sp-policies-sign-error").waitFor({ timeout: 10000 });
  const err = await page.getByTestId("sp-policies-sign-error").innerText();
  check("4. a wrong password is refused and nothing is signed", /Password incorrect; signature not recorded/.test(err) && !sql("SELECT 1 AS x FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?", hygiene, emp), err);
  check("5. dark document screen fits the phone", await fits(page));
  await shot(page, "readsign-one-wrong-password-dark-390.png");
  await page.getByTestId("sp-policies-password").fill(pw);
  await page.getByTestId("sp-policies-sign-submit").click();
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const one = sql("SELECT signed_with, signed_together, typed_signature FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?", hygiene, emp);
  check("4. the right password signs it, alone, with the typed name", one?.signed_with === "password" && one?.signed_together == null && one?.typed_signature === "Sam Rivera", JSON.stringify(one));
  check("4. the list reads it signed", (await page.getByTestId("sp-policies-row-signed").count()) === 3);
  await shot(page, "readsign-list-after-dark-390.png");
  await page.context().close();
}

check("5. no page errors or Content-Security-Policy refusals", problems.length === 0, problems.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
