// scripts/verify-veritadc-history-load-ui.mjs
//
// Browser receipt for read-and-sign history carried over from a prior system (Michael 2026-11-06, Q207 = 1). On a local production build with
// a scratch DB, made-up documents loaded the real way, and made-up roster people:
//   S1. A staff member's list reads Signed for what they signed in the prior system, says where, and doesn't ask again. The bell agrees.
//   S2. Opening it says they signed there, with no signature box and no typed name.
//   S3. My Activity says it wasn't signed in VeritaAssure, with the original date and no made-up time.
//   S4. My Documents says where they signed.
//   E1. The owner's tracker reads Signed, carried over, with the original date and version.
//   E2. Someone inactive in the prior system shows as history, not on the roster list.
//   I1. The inspector link lists these apart, in those words, with no hash or typed name.
//   D1. Dark mode and phone width read and don't overflow.
// Run: UI_REPO=<worktree> UI_SCRIPT=verify-veritadc-history-load-ui.mjs UI_OUT=<dir> UI_DB=<db> bash /c/Users/veril/projects/vls-ops/ui_run_repo.sh
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, secret) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(secret ? { "x-admin-secret": secret } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Hist", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `historyui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labName = "History Test Lab";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const existing = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", labId);
const staffLab = existing?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, '22D0000987', ?, ?, ?)", ownerId, labName, labId, now, now).lastInsertRowid);
const addEmp = (first, last) => Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, can_view_audit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', 1, ?, ?)", staffLab, labId, ownerId, last, first, now, now).lastInsertRowid);
const addStaff = async (first, last) => {
  const e = `historyui-${first.toLowerCase()}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name: `${first} ${last}`, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  const emp = addEmp(first, last);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{\"mode\":\"view_all\"}')", ownerId, e, id, labId, emp);
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { email: e, id, emp, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token, name: `${first} ${last}` };
};
const ann = await addStaff("Ann", "Chem");
const bea = await addStaff("Bea", "Micro");
const loadDoc = async (docNumber, version, title) => {
  const meta = {
    labId, expectedLabName: labName, ownerUserId: ownerId, batch: "made-up-batch", loadedBy: "Veritas Lab Services", sourceSystem: "MediaLab", sourceStatus: "approved and current",
    docNumber, title, titleAsExported: title, version, effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20", nextReviewDue: "2027-01-20", reviewIntervalMonths: 12,
    remindersStartOn: new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10), author: "Made Up Author", approvalRows: 1, reviewRows: 0, versionCount: 1, manualPath: ["Made-up Chemistry"], alsoFiledIn: [],
  };
  const fd = new FormData();
  fd.append("meta", JSON.stringify(meta));
  fd.append("document", new Blob([Buffer.from(`Made-up text for ${title}\n`)]), "made-up.txt");
  fd.append("face_page", new Blob([Buffer.from(`<html><head><title>x</title></head><body><h1>${docNumber} ${title}</h1><p>Made-up face page.</p></body></html>`)], { type: "text/html" }), "face-page.html");
  const j = await (await fetch(`${BASE}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd })).json();
  return j.documentId;
};
const docSigned = await loadDoc("CH 1", "2.1", "Made-up Glucose procedure");
const docOwed = await loadDoc("CH 2", "1.0", "Made-up Cobas procedure");
await call("POST", `/api/labs/${labId}/veritapolicy/read-sign`, { scope: "lab", everyone: true }, token);
const loaded = await call("POST", "/api/admin/veritadc/history-load/rows", {
  labId, expectedLabName: labName, ownerUserId: ownerId, sourceSystem: "MediaLab", batch: "made-up-history", loadedBy: "Veritas Lab Services",
  rows: [
    { docNumber: "CH 1", version: "2.0", personName: "Chem, Ann", credentials: "MLS(ASCP)", assignedOn: "2025-02-03", signedOn: "2025-03-12", personState: "on_roster", employeeId: ann.emp },
    { docNumber: "CH 1", version: "2.0", personName: "Oldname, Pat", credentials: "MT", assignedOn: "2025-02-03", signedOn: "2025-02-14", personState: "inactive_in_prior_system" },
  ],
}, undefined, ADMIN);
check("S0. two made-up rows load", loaded.body.counts?.loaded === 2, JSON.stringify(loaded.body.counts));
const inspector = (await call("POST", `/api/labs/${labId}/veritapolicy/surveyor-links`, { label: "Made-up inspector" }, token)).body.token;

const browser = await chromium.launch();
const errors = [];
const openAs = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  if (tk) {
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
    await page.evaluate(([t, u, l, dark]) => {
      localStorage.setItem("veritas_token", t);
      localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
      localStorage.setItem("veritas_active_lab_id", String(l));
      if (dark) localStorage.setItem("theme", "dark");
    }, [tk, me, labId, !!opts.dark]);
  } else if (opts.dark) await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const SIGNOFFS = `/labs/${labId}/my-signoffs`;
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;
const openTracker = async (page) => {
  await page.locator("tr").filter({ hasText: "Made-up Glucose procedure" }).getByTestId("tracker-button").click();
  await page.getByTestId("signature-roster").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
};
const openInspector = async (page) => {
  await page.getByText("Made-up Glucose procedure").first().waitFor({ timeout: 15000 });
  await page.locator("li").filter({ hasText: "Made-up Glucose procedure" }).getByRole("button", { name: /View/ }).click();
  await page.getByTestId("surveyor-prior-signatures").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
};

// ── Staff ──
{
  const page = await openAs(ann.token, SIGNOFFS);
  const badge = await page.getByTestId("sp-tile-policies-badge").innerText();
  check("S1. the tile counts only what's still owed", badge.trim() === "1", badge);
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const row = page.getByTestId("sp-policies-row").filter({ hasText: "Made-up Glucose procedure" });
  const rowText = await row.innerText();
  check("S1. the row reads Signed", /Signed/.test(await row.getByTestId("sp-policies-row-signed").innerText()));
  check("S1. and says where, with the original date and version", /Signed v2\.0 in MediaLab on 2025-03-12, carried over/.test(rowText), rowText);
  check("S1. the other document still needs a signature", await page.getByTestId("sp-policies-row").filter({ hasText: "Made-up Cobas procedure" }).getByTestId("sp-policies-row-unsigned").count() === 1);
  await page.screenshot({ path: `${OUT}/history-staff-list.png` });
  await row.click();
  await page.getByTestId("sp-policies-signed-prior-system").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const said = await page.getByTestId("sp-policies-signed-prior-system").innerText();
  check("S2. opening it says they signed there, and asks for nothing", /You signed version 2\.0 on 2025-03-12 in MediaLab, your lab's prior system/.test(said) && /no new signature is needed/.test(said), said);
  check("S2. no signature box", await page.getByTestId("sp-policies-sign-block").count() === 0);
  check("S2. no 'signature on file'", !/Signature on file/.test(said));
  await page.screenshot({ path: `${OUT}/history-staff-detail.png` });
  const bell = (await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, ann.token)).body.policies.map((p) => p.document_id);
  check("S1. the bell lists only what's still owed", bell.includes(docOwed) && !bell.includes(docSigned), JSON.stringify(bell));
  await page.goto(`${BASE}${SIGNOFFS}`, { waitUntil: "networkidle" });
  await page.getByTestId("sp-tile-audit").click();
  await page.getByTestId("sp-activity-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const act = await page.getByTestId("sp-activity-row").first().innerText();
  check("S3. My Activity says it wasn't signed in VeritaAssure", /Carried over from that system, not signed in VeritaAssure/.test(act), act);
  check("S3. with the original date and no made-up time", /2025-03-12/.test(act) && !/\d:\d\d/.test(act), act);
  await page.screenshot({ path: `${OUT}/history-staff-activity.png` });
  await page.goto(`${BASE}${POLICIES}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  check("S4. My Documents says where they signed", /You signed v2\.0 in MediaLab on 2025-03-12/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: `${OUT}/history-staff-documents.png` });
  await page.context().close();
}
// ── A coworker sees none of it ──
{
  const page = await openAs(bea.token, SIGNOFFS);
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const text = await page.getByTestId("sp-policies-list").innerText();
  check("S5. someone who didn't sign it still owes it", /Made-up Glucose procedure/.test(text) && !/carried over/.test(text));
  await page.context().close();
}
// ── Owner ──
{
  const page = await openAs(token, POLICIES);
  await openTracker(page);
  const annRow = await page.getByTestId(`roster-row-${ann.emp}`).innerText();
  check("E1. the tracker reads signed, carried over, with the original date and version", /Signed 2025-03-12 on v2\.0 in MediaLab, carried over/.test(annRow), annRow);
  check("E1. it doesn't read as a Staff login signature", !/Staff login/.test(annRow));
  const line = await page.getByTestId("roster-assigned").innerText();
  check("E1. the count moved", /1 signed, 1 still owe it/.test(line), line);
  await page.getByTestId("roster-prior-history").locator("summary").click();
  await page.waitForTimeout(300);
  const hist = await page.getByTestId("roster-prior-history").innerText();
  check("E2. someone inactive shows as history, owing nothing", /Oldname, Pat/.test(hist) && /Signed 2025-02-14 on v2\.0/.test(hist) && /owe nothing/.test(hist), hist.slice(0, 200));
  check("E2. and isn't on the roster list", !/Oldname/.test(await page.getByTestId("signature-roster").locator("[data-testid^='roster-row-']").allInnerTexts().then((a) => a.join(" "))));
  await page.screenshot({ path: `${OUT}/history-owner-tracker.png` });
  await page.context().close();
  const comp = await openAs(token, `/labs/${labId}/veritapolicy-app/compliance`);
  await comp.getByTestId("compliance-carried-count").first().waitFor({ timeout: 15000 });
  check("E3. the compliance page counts it apart", /1/.test(await comp.getByTestId("compliance-carried-count").first().innerText()));
  await comp.context().close();
}
// ── Inspector ──
{
  const page = await openAs(null, `/surveyor/${inspector}`);
  await openInspector(page);
  const text = await page.getByTestId("surveyor-prior-signatures").innerText();
  check("I1. the inspector sees these listed apart, in those words", /Read-and-sign in MediaLab, the lab's prior system \(2\)/.test(text) && /These people signed there, not in VeritaAssure/.test(text), text.slice(0, 220));
  check("I1. with the name, version and original date", /Chem, Ann/.test(text) && /signed v2\.0 on 2025-03-12/.test(text) && /Oldname, Pat/.test(text));
  check("I1. and no hash or typed name", !/sha256/.test(text));
  check("I1. it isn't under Staff signatures", !/Staff signatures/.test(await page.locator("body").innerText()));
  await page.screenshot({ path: `${OUT}/history-inspector.png` });
  await page.context().close();
}
// ── Dark and phone ──
{
  const dark = await openAs(token, POLICIES, { dark: true });
  await openTracker(dark);
  await dark.getByTestId("roster-prior-history").locator("summary").click();
  await dark.waitForTimeout(300);
  await dark.screenshot({ path: `${OUT}/history-dark-tracker.png` });
  check("D1. dark mode: the page doesn't overflow", await fits(dark));
  await dark.context().close();
  const darkStaff = await openAs(ann.token, SIGNOFFS, { dark: true });
  await darkStaff.getByTestId("sp-tile-policies").click();
  await darkStaff.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await darkStaff.waitForTimeout(400);
  await darkStaff.screenshot({ path: `${OUT}/history-dark-staff.png` });
  check("D1. dark mode, staff list: doesn't overflow", await fits(darkStaff));
  await darkStaff.getByTestId("sp-policies-row").filter({ hasText: "Made-up Glucose procedure" }).click();
  await darkStaff.getByTestId("sp-policies-signed-prior-system").waitFor({ timeout: 15000 });
  await darkStaff.waitForTimeout(400);
  await darkStaff.screenshot({ path: `${OUT}/history-dark-staff-detail.png` });
  await darkStaff.context().close();
  const darkInsp = await openAs(null, `/surveyor/${inspector}`, { dark: true });
  await openInspector(darkInsp);
  await darkInsp.screenshot({ path: `${OUT}/history-dark-inspector.png` });
  check("D1. dark mode, inspector: doesn't overflow", await fits(darkInsp));
  await darkInsp.context().close();

  const phone = await openAs(token, POLICIES, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId("tracker-button").first().scrollIntoViewIfNeeded();
  await openTracker(phone);
  await phone.getByTestId(`roster-row-${ann.emp}`).scrollIntoViewIfNeeded();
  await phone.waitForTimeout(300);
  await phone.screenshot({ path: `${OUT}/history-phone-tracker.png` });
  const box = await phone.getByTestId(`roster-row-${ann.emp}`).boundingBox();
  check("D1. phone width: the roster row fits", !!box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  await phone.context().close();
  const phoneStaff = await openAs(ann.token, SIGNOFFS, { viewport: { width: 390, height: 844 } });
  await phoneStaff.getByTestId("sp-tile-policies").click();
  await phoneStaff.getByTestId("sp-policies-list").waitFor({ timeout: 15000 });
  await phoneStaff.waitForTimeout(400);
  await phoneStaff.screenshot({ path: `${OUT}/history-phone-staff.png` });
  check("D1. phone width, staff list: doesn't overflow", await fits(phoneStaff));
  await phoneStaff.context().close();
  const phoneInsp = await openAs(null, `/surveyor/${inspector}`, { viewport: { width: 390, height: 844 } });
  await openInspector(phoneInsp);
  await phoneInsp.getByTestId("surveyor-prior-signatures").scrollIntoViewIfNeeded();
  await phoneInsp.waitForTimeout(300);
  await phoneInsp.screenshot({ path: `${OUT}/history-phone-inspector.png` });
  check("D1. phone width, inspector: doesn't overflow", await fits(phoneInsp));
  await phoneInsp.context().close();
}
check("no page threw an error", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
