// scripts/verify-veritadc-minor-revisions-ui.mjs
//
// Browser receipt for the VeritaDC minor-revision rule (Michael 2026-11-03, Q154 = 1; server/policyMinorRevision.ts). On a
// local production build with a scratch DB, a made-up owner, a made-up staff login and a made-up document signed at 1.0
// and revised to 1.1:
//   M1. the Document types dialog shows the lab's choice, defaulting to "Staff read and sign again"
//   M2. with that default the staff login's list says the document needs a signature
//   M3. choosing "Signatures carry forward" in the dialog saves the setting
//   M4. the staff login's list then shows it signed, with the notice that it changed since they signed version 1.0
//   M5. opening it says they signed version 1.0 and 1.1 is a minor revision, with no signature box
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-minor-revisions-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Minor", "Rev", "77!"].join("-");

// A made-up owner and lab
const email = `minorrev-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Minor Revision Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;

// A made-up staff login on that lab
const now = new Date().toISOString();
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Minor Revision Test Lab', '22D0000097', ?, ?, ?)", ownerId, labId, now, now).lastInsertRowid);
const emp = Number(sql("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, 'Example', 'Sam', 'active', ?, ?)", staffLab, ownerId, now, now).lastInsertRowid);
const staffEmail = `minorrev-staff-${Date.now()}@example.com`;
const staffUid = Number(sql("INSERT INTO users (email, password_hash, name, plan, created_at, hipaa_acknowledged, hipaa_acknowledged_at, hipaa_ack_source, has_completed_onboarding, onboarding_seen) VALUES (?, ?, 'Sam Example', 'free', ?, 1, ?, 'signup', 1, 1)", staffEmail, bcrypt.hashSync(pw, 4), now, now).lastInsertRowid);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?)", ownerId, staffEmail, staffUid, labId, emp);
const login = await call("POST", "/api/auth/login", { email: staffEmail, password: pw });
const staffToken = login.body.token;

// A made-up document: approved at 1.0, signed by the staff member, revised to 1.1 and approved
const upload = async (fields, p = `/api/labs/${labId}/veritapolicy/documents`) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(`Made-up procedure text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return (await fetch(BASE + p, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
};
// Since Step D a Staff login sees only what's assigned; this check is about minor revisions, so everything goes to everyone.
await call("POST", `/api/labs/${labId}/veritapolicy/read-sign`, { scope: "lab", everyone: true }, token);
const doc = await upload({ title: "Specimen Rejection Procedure (made-up)", doc_number: "HH 40" });
sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", doc.id);
const staffList = async () => ((await call("GET", `/api/staff-portal-session/policies?employee_id=${emp}`, undefined, staffToken)).body.policies || []).find((p) => p.document_id === doc.id);
const first = await staffList();
const signed = await call("POST", `/api/staff-portal-session/policies/${doc.id}/sign`, { employee_id: emp, version_id: first?.version_id, typed_signature: "Sam Example" }, staffToken);
const v11 = await upload({ change_summary: "Corrected a phone number" }, `/api/labs/${labId}/veritapolicy/documents/${doc.id}/versions`);
sql("UPDATE policy_documents SET status = 'approved' WHERE id = ?", doc.id);
check("setup: staff login signed 1.0, the document is now 1.1", !!staffToken && signed.status < 300 && v11.version_label === "1.1", `login ${login.status} sign ${signed.status} v ${v11.version_label}`);

const browser = await chromium.launch();
const openAs = async (tk, path) => {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [tk, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const toPolicies = async (page) => {
  await page.getByTestId("sp-tile-policies").waitFor({ timeout: 20000 }).catch(() => {});
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-row").first().waitFor({ timeout: 15000 }).catch(() => {});
};

// M1
const ownerPage = await openAs(token, `/labs/${labId}/veritapolicy-app/my-policies`);
await ownerPage.getByTestId("doc-types-open").click();
await ownerPage.getByTestId("minor-revision-select").waitFor({ timeout: 10000 }).catch(() => {});
await ownerPage.waitForTimeout(600);
const shown = ((await ownerPage.getByTestId("minor-revision-select").textContent().catch(() => "")) || "").trim();
check("M1. the dialog defaults to staff signing again", shown === "Staff read and sign again", shown);

// M2
const staffPage = await openAs(staffToken, `/labs/${labId}/my-signoffs`);
await toPolicies(staffPage);
const needs = await staffPage.getByTestId("sp-policies-row-unsigned").count();
check("M2. with the default, the staff list asks for a signature on 1.1", needs === 1, `${needs} unsigned`);

// M3
await ownerPage.getByTestId("minor-revision-select").click();
await ownerPage.getByRole("option", { name: /Signatures carry forward/ }).click();
await ownerPage.waitForTimeout(1200);
const setting = (await call("GET", `/api/labs/${labId}/veritapolicy/settings/minor-revisions`, undefined, token)).body.carryForward;
check("M3. choosing carry forward saves the setting", setting === true, String(setting));
await ownerPage.screenshot({ path: `${OUT}/minorrev-dialog.png` });

// M4
await staffPage.reload({ waitUntil: "networkidle" });
await toPolicies(staffPage);
const notice = ((await staffPage.getByTestId("sp-policies-row-updated").first().textContent().catch(() => "")) || "").trim();
const signedTag = await staffPage.getByTestId("sp-policies-row-signed").count();
check("M4. the staff list shows it signed, with the notice that it changed since version 1.0", signedTag === 1 && notice.includes("Updated since you signed version 1.0"), notice);
await staffPage.screenshot({ path: `${OUT}/minorrev-staff-list.png` });

// M5
await staffPage.getByTestId("sp-policies-row").first().click();
await staffPage.getByTestId("sp-policies-carried").waitFor({ timeout: 15000 }).catch(() => {});
const carried = ((await staffPage.getByTestId("sp-policies-carried").textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const boxes = await staffPage.getByTestId("sp-policies-sign-block").count();
check("M5. opening it names the signed version and the minor revision, with no signature box",
  /You signed version 1\.0/.test(carried) && /Version 1\.1 is a minor revision/.test(carried) && boxes === 0, carried);
await staffPage.screenshot({ path: `${OUT}/minorrev-staff-detail.png` });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
