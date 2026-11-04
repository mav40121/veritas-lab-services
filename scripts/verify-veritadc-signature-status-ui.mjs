// scripts/verify-veritadc-signature-status-ui.mjs
//
// Browser receipt for who has signed a VeritaDC document (Michael 2026-11-04, Q161 = 1). On a local production build with a scratch DB, a
// made-up owner, a made-up approved document and made-up roster people:
//   S1. the tracker opens with everyone on the roster and how many have signed
//   S2. someone with no login is flagged; nobody-assigned people show as Not signed
//   S3. a Staff login assigned the document signs through My sign-offs: the roster and the assigned list both read signed, not Pending
//   S4. the filter shows only who still needs to sign
//   S5. the Staff login's bell lists a document still to sign, and not the one just signed
//   S6. the Excel report opens with the roster sheet
//   D1. dark mode and phone width read and do not overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-signature-status-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Sign", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `signui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Signature Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Signature Test Lab', '22D0000321', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const addEmp = (first, last) => Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Histotechnologist', 'active', ?, ?)", staffLab, labId, ownerId, last, first, now, now).lastInsertRowid);
const uploadDoc = async (title) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("Made-up text\n")], { type: "text/plain" }), "made-up.txt");
  fd.append("title", title);
  const d = await (await fetch(`${BASE}/api/labs/${labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", d.id);
  return d.id;
};
const doc = await uploadDoc("Made-up fire plan SAF_3");
const doc2 = await uploadDoc("Made-up second document");

// Ann has a Staff login and is assigned the document. Pat has a Staff login and isn't. Nia has no login.
const annEmail = `signui-ann-${stamp}@example.com`;
const annReg = await call("POST", "/api/auth/register", { email: annEmail, password: pw, name: "Ann Signer", hipaa_acknowledged: true });
const annId = Number(annReg.body.user?.id);
const annEmp = addEmp("Ann", "Signer");
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, annId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, annId);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)", ownerId, annEmail, annId, labId, annEmp);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", annId);
const annToken = (await call("POST", "/api/auth/login", { email: annEmail, password: pw })).body.token;
addEmp("Pat", "Sample");
addEmp("Nia", "Nologin");
const assigned = await call("POST", `/api/labs/${labId}/veritapolicy/documents/${doc}/attestations`, { assignedToUserIds: [annId] }, token);
check("S0. Ann is assigned the document", assigned.status === 201, `HTTP ${assigned.status}`);

const browser = await chromium.launch();
const openAs = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
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
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;
const openTracker = async (page) => {
  const row = page.locator("tr, div").filter({ hasText: "Made-up fire plan SAF_3" }).filter({ has: page.getByTestId("tracker-button") }).last();
  await row.getByTestId("tracker-button").first().click();
  await page.getByTestId("signature-roster").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500); // let the dialog finish opening, so a screenshot isn't mid-fade
};

// Before anyone signs
{
  const page = await openAs(token, POLICIES);
  await openTracker(page);
  const count = await page.getByTestId("roster-count").innerText();
  check("S1. the tracker opens with everyone on the roster", /0 of 3 on the roster have signed/.test(count), count);
  const text = await page.getByTestId("signature-roster").innerText();
  check("S2. someone with no login is flagged", /people have no login|person has no login/.test(text) && /Nologin, Nia[\s\S]*No login/.test(text));
  check("S2. people nobody assigned show as Not signed", /Sample, Pat[\s\S]*Not signed/.test(text));
  await page.context().close();
}

// Ann signs through My sign-offs, the real screen
{
  const page = await openAs(annToken, "/staff-access");
  await page.getByTestId("sp-tile-policies").click({ timeout: 15000 });
  await page.getByText("Made-up fire plan SAF_3").first().click();
  await page.getByTestId("sp-policies-typed-name").waitFor({ timeout: 15000 });
  await page.getByTestId("sp-policies-typed-name").fill("Ann Signer");
  await page.screenshot({ path: `${OUT}/signature-staff-sign.png` });
  await page.getByTestId("sp-policies-sign-submit").click();
  await page.waitForTimeout(1200);
  const saved = sql("SELECT typed_signature FROM staff_portal_policy_signatures WHERE document_id = ? AND staff_employee_id = ?", doc, annEmp);
  check("S3. Ann's signature saves through the real screen", !!saved?.typed_signature, JSON.stringify(saved));
  await page.context().close();
}

// The director's view after she signed
{
  const att = sql("SELECT completed_at, typed_signature FROM policy_attestations WHERE document_id = ? AND assigned_to_user_id = ?", doc, annId);
  check("S3. her assignment closed", !!att?.completed_at, JSON.stringify(att));
  const page = await openAs(token, POLICIES);
  await openTracker(page);
  const count = await page.getByTestId("roster-count").innerText();
  check("S3. the count moved", /1 of 3 on the roster have signed/.test(count), count);
  const row = await page.getByTestId(`roster-row-${annEmp}`).innerText();
  check("S3. the roster reads signed, with how", /Signed \d{4}-\d{2}-\d{2}/.test(row) && /Staff login/.test(row), row);
  const dialog = await page.getByRole("dialog").innerText();
  check("S3. the assigned list no longer says Pending or outstanding for her", /Attested:\s*1/.test(dialog) && /Outstanding:\s*0/.test(dialog), dialog.match(/Assigned:[\s\S]{0,70}/)?.[0]);
  await page.screenshot({ path: `${OUT}/signature-tracker.png` });
  await page.getByTestId("roster-open-only").check();
  const filtered = await page.getByTestId("signature-roster").innerText();
  check("S4. the filter shows only who still needs to sign", !/Signer, Ann/.test(filtered) && /Sample, Pat/.test(filtered) && /Nologin, Nia/.test(filtered));
  await page.screenshot({ path: `${OUT}/signature-open-only.png` });

  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Signature report/ }).click()]);
  const file = `${OUT}/signature-report.xlsx`;
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = wb.getWorksheet("Everyone on the Roster");
  const lines = [];
  sheet?.eachRow((r, n) => { if (n > 1) lines.push(`${r.getCell(1).value}: ${r.getCell(4).value}`); });
  check("S6. the Excel report has the roster sheet", lines.length === 3 && lines.some((l) => /Signer, Ann: Signed/.test(l)) && lines.some((l) => /Sample, Pat: Not signed/.test(l)), JSON.stringify(lines));
  await page.context().close();
}

// The Staff login's bell
{
  const bell = (await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, annToken)).body.policies.map((p) => p.document_id);
  check("S5. the bell lists the document still to sign, not the one signed", bell.includes(doc2) && !bell.includes(doc), JSON.stringify(bell));
  const page = await openAs(annToken, "/staff-access");
  const seen = await page.getByTestId("pending-staff-portal-bell").count();
  if (seen) {
    await page.getByTestId("pending-staff-portal-bell").click();
    check("S5. the bell shows it on screen", await page.getByTestId(`pending-policy-${doc2}`).isVisible());
    await page.screenshot({ path: `${OUT}/signature-bell.png` });
  } else check("S5. the bell shows on the page", false);
  await page.context().close();
}

// Dark mode and phone width
{
  const dark = await openAs(token, POLICIES, { dark: true });
  await openTracker(dark);
  await dark.screenshot({ path: `${OUT}/signature-dark.png` });
  check("D1. dark mode: the page does not overflow", await dark.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await dark.context().close();
  const phone = await openAs(token, POLICIES, { viewport: { width: 390, height: 844 } });
  await openTracker(phone);
  await phone.waitForTimeout(500);
  await phone.screenshot({ path: `${OUT}/signature-phone.png` });
  const box = await phone.getByTestId("signature-roster").boundingBox();
  check("D1. phone width: the roster fits the screen", !!box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  const status = await phone.getByTestId("roster-status").first().boundingBox();
  check("D1. phone width: a status is on screen", !!status && status.x + status.width <= 391, JSON.stringify(status));
  await phone.context().close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
