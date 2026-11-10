// scripts/verify-veritadc-approved-version-ui.mjs
//
// Browser receipt for BUG-151 (server/policyApprovedVersion.ts): while a newer revision of a VeritaDC document is a draft or in
// review, a limited Staff login, the staff portal and a share link keep reading the approved version, and say so. On a local
// production build with a scratch DB and made-up data only:
//   E1. An editor's document is approved (the signer's real approve route); the editor uploads a revision on screen (the row's
//       Upload button and dialog). The editor's list reads it as a draft and the editor's View shows the revision's text; the
//       Share link section says links show v1.0.
//   S1. A limited Staff login, in the main app: the lookup finds the document with the note; Read opens version 1.0's text,
//       with the note, and never the revision's.
//   S2. The same login in the staff portal (My sign-offs): the lookup opens it read-only, with the note and 1.0's text.
//   L1. The share link, no login: version 1.0, the note, and 1.0's text in the frame.
//   A2. The revision is approved: Staff and the link read version 1.1 with no note.
//   D1. Dark mode and phone width for the share page and the staff portal; no overflow; no page errors; no em dash.
// Run: UI_REPO=<worktree> UI_PORT=<free port> UI_SCRIPT=verify-veritadc-approved-version-ui.mjs UI_OUT=approved_version UI_DB=approved_version.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
const NOTE = "A revision is in progress. This is the approved version.";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };

const pw = ["Approved", "Ui", "151!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `approvedui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labName = "Approved Version Test Lab";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '22D0000151' WHERE id = ?", labId);
const staffLab = Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, '22D0000151', ?, ?, ?)", ownerId, labName, labId, now, now).lastInsertRowid);
const addSeat = async (tag, seatType, name) => {
  const e = `approvedui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  let emp = null;
  if (seatType === "staff_portal") {
    const [first, last] = name.split(" ");
    emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', ?, ?)", staffLab, labId, ownerId, last, first, now, now).lastInsertRowid);
  }
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
    ownerId, e, id, now, now, seatType, labId, emp, seatType === "staff_portal" ? '{"mode":"view_all"}' : '{"mode":"edit_all"}');
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { email: e, id, emp, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token, name };
};
const signer = await addSeat("signer", "active", "Made Up Signer");
const staff = await addSeat("staff", "staff_portal", "Rowan Quillby");
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up approval route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer.id }, token);
const approve = async (docId) => {
  await call("POST", `${P}/documents/${docId}/submit`, { workflowId: wf.body.id }, token);
  return (await call("POST", `${P}/documents/${docId}/approve`, { typedSignature: "Made Up Signer", password: pw }, signer.token)).body.status;
};
const TITLE = "Made-up Specimen Collection Manual";
const V1 = Buffer.from(`${TITLE}\nVersion 1.0 (made-up). MADEUPMARKERONE\nLabel every tube at the bedside.\n`);
const V2 = Buffer.from(`${TITLE}\nVersion 1.1 (made-up). MADEUPMARKERTWO\nLabel every tube at the bedside with two identifiers.\n`);
const fd = new FormData();
fd.append("file", new Blob([V1], { type: "text/plain" }), "made-up-specimen-collection.txt");
fd.append("title", TITLE);
fd.append("doc_number", "SC 151");
const doc = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
await call("POST", `${P}/read-sign`, { scope: "document", id: doc.id, everyone: true }, token);
check("S0. the made-up document is approved through the signer's approve route", (await approve(doc.id)) === "approved");
const v1 = sql("SELECT current_version_id AS v FROM policy_documents WHERE id = ?", doc.id).v;
check("S0. v1 is recorded as the approved version", sql("SELECT approved_version_id AS a FROM policy_documents WHERE id = ?", doc.id).a === v1);
const shareTok = (await call("POST", `${P}/documents/${doc.id}/share-links`, { label: "Made-up nursing" }, token)).body.token;
check("S0. a share link exists for it", typeof shareTok === "string" && shareTok.length > 20);

const browser = await chromium.launch();
const errors = [];
const open = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (tk) {
    await page.goto(`${BASE}/`);
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
    await page.evaluate(([t, u, l, dark]) => {
      localStorage.setItem("veritas_token", t);
      localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
      localStorage.setItem("veritas_active_lab_id", String(l));
      if (dark) localStorage.setItem("theme", "dark");
    }, [tk, me, labId, !!opts.dark]);
  }
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { page, ctx };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;
const SIGNOFFS = `/labs/${labId}/my-signoffs`;
const SHARE = `/policy/${shareTok}`;

// ── E1. The editor uploads a revision on screen ──
{
  const { page, ctx } = await open(token, POLICIES);
  const row = page.locator("tr").filter({ hasText: TITLE }).first();
  await row.locator('button[title="Upload a new version; will reset status to draft"]').click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 15000 });
  await dlg.locator('input[type="file"]').setInputFiles({ name: "made-up-specimen-collection-v2.txt", mimeType: "text/plain", buffer: V2 });
  await dlg.locator("textarea").fill("Made-up revision: two identifiers");
  await dlg.getByRole("button", { name: "Upload new version" }).click();
  await page.waitForTimeout(1500);
  const d = sql("SELECT status, current_version_id AS cur, approved_version_id AS appr FROM policy_documents WHERE id = ?", doc.id);
  check("E1. the editor's upload makes v2 current and the document a draft", d.status === "draft" && d.cur !== v1, JSON.stringify(d));
  check("E1. v1 stays recorded as the approved version", d.appr === v1, JSON.stringify(d));
  const rowText = await page.locator("tr").filter({ hasText: TITLE }).first().innerText();
  // The version cell is styled uppercase, so the browser reads "V1.1".
  check("E1. the editor's list reads it as a draft at v1.1", /draft/i.test(rowText) && /v1\.1/i.test(rowText), rowText.replace(/\n/g, " | "));
  await shot(page, "E1_editor_list_revision_draft", false);
  await page.locator("tr").filter({ hasText: TITLE }).getByRole("button", { name: /View/ }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await page.getByTestId("share-links-shows-approved").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const dialogText = await page.getByRole("dialog").innerText();
  check("E1. the editor's View shows the revision's text, as before", dialogText.includes("MADEUPMARKERTWO") && !dialogText.includes("MADEUPMARKERONE"), dialogText.slice(0, 160));
  check("E1. the editor sees no staff note", (await page.getByTestId("view-revision-note").count()) === 0);
  const shareLine = await page.getByTestId("share-links-shows-approved").innerText();
  check("E1. the Share link section says links show the approved v1.0", shareLine.trim() === "A revision is in progress. Links show the approved version, v1.0, until the revision is approved.", shareLine);
  await page.getByTestId("share-links").scrollIntoViewIfNeeded();
  await shot(page, "E1_editor_view_revision_share_section", false);
  await ctx.close();
}

// ── S1. A limited Staff login in the main app ──
const staffMainRead = async (opts = {}, name) => {
  const { page, ctx } = await open(staff.token, POLICIES, opts);
  await page.getByTestId("staff-doc-lookup-input").fill("Specimen");
  await page.getByTestId("staff-doc-lookup-results").waitFor({ timeout: 15000 });
  await page.waitForTimeout(400);
  const rowNote = (await page.getByTestId("staff-doc-lookup-revision").count()) ? (await page.getByTestId("staff-doc-lookup-revision").first().innerText()).trim() : "";
  if (name) await shot(page, `${name}_lookup`, false);
  await page.getByTestId("staff-doc-lookup-open").first().click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const text = await page.getByRole("dialog").innerText();
  const note = (await page.getByTestId("view-revision-note").count()) ? (await page.getByTestId("view-revision-note").innerText()).trim() : "";
  if (name) await shot(page, name, false);
  await ctx.close();
  return { rowNote, text, note };
};
{
  const r = await staffMainRead({}, "S1_staff_main_read_approved_v1");
  check("S1. the Staff lookup row carries the note", r.rowNote === NOTE, r.rowNote);
  check("S1. Read opens version 1.0's text", r.text.includes("MADEUPMARKERONE"), r.text.slice(0, 160));
  check("S1. and never the revision's", !r.text.includes("MADEUPMARKERTWO"));
  check("S1. the dialog says a revision is in progress and this is the approved version", r.note === NOTE, r.note);
  check("S1. the note has no em dash", !r.note.includes("—"));
}
{
  const r = await staffMainRead({ dark: true }, "S1_staff_main_read_approved_v1_dark");
  check("D1. dark mode: the Staff dialog shows the note and 1.0", r.note === NOTE && r.text.includes("MADEUPMARKERONE"));
}

// ── S2. The staff portal ──
const portalRead = async (opts = {}, name) => {
  const { page, ctx } = await open(staff.token, SIGNOFFS, opts);
  await page.getByTestId("sp-tile-policies").click();
  await page.getByTestId("sp-policies-lookup-input").waitFor({ timeout: 15000 });
  const listText = await page.locator("body").innerText();
  await page.getByTestId("sp-policies-lookup-input").fill("Specimen");
  await page.getByTestId("sp-policies-lookup-results").waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  await page.getByTestId("sp-policies-lookup-row").first().click();
  await page.getByTestId("sp-policies-detail").waitFor({ timeout: 15000 });
  await page.getByTestId("sp-policies-detail-html").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const detail = await page.getByTestId("sp-policies-detail").innerText();
  const note = (await page.getByTestId("sp-policies-revision-note").count()) ? (await page.getByTestId("sp-policies-revision-note").innerText()).trim() : "";
  const readOnly = (await page.getByTestId("sp-policies-read-only").count()) ? (await page.getByTestId("sp-policies-read-only").innerText()).trim() : "";
  const signBlock = await page.getByTestId("sp-policies-sign-block").count();
  const fit = await fits(page);
  if (name) await shot(page, name);
  await ctx.close();
  return { listText, detail, note, readOnly, signBlock, fit };
};
{
  const r = await portalRead({}, "S2_staff_portal_read_approved_v1");
  check("S2. the staff portal opens version 1.0's text", r.detail.includes("MADEUPMARKERONE") && !r.detail.includes("MADEUPMARKERTWO"), r.detail.slice(0, 200));
  check("S2. with the note", r.note === NOTE, r.note);
  check("S2. read-only, with nothing to sign right now", r.signBlock === 0 && r.readOnly === "A revision is in progress, so there's nothing to sign right now. You're reading the approved version.", r.readOnly);
  check("S2. it reads Version 1.0", /Version 1\.0/.test(r.detail));
}
{
  const r = await portalRead({ viewport: { width: 390, height: 844 } }, "S2_staff_portal_read_approved_v1_phone");
  check("D1. phone width: the staff portal shows the note and 1.0 with no overflow", r.note === NOTE && r.detail.includes("MADEUPMARKERONE") && r.fit);
}

// ── L1. The share link, no login ──
const readShare = async (opts = {}, name) => {
  const { page, ctx } = await open(null, SHARE, opts);
  await page.getByTestId("share-title").waitFor({ timeout: 15000 });
  await page.getByTestId("share-viewer-html").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const version = (await page.getByTestId("share-version").innerText()).trim();
  const note = (await page.getByTestId("share-revision-note").count()) ? (await page.getByTestId("share-revision-note").innerText()).trim() : "";
  const frame = await page.frameLocator("[data-testid=share-viewer-html]").locator("body").innerText();
  const fit = await fits(page);
  const body = await page.locator("body").innerText();
  if (name) await shot(page, name);
  await ctx.close();
  return { version, note, frame, fit, body };
};
{
  const r = await readShare({}, "L1_share_link_approved_v1_light");
  check("L1. the link shows version 1.0", r.version === "1.0", r.version);
  check("L1. with the note", r.note === NOTE, r.note);
  check("L1. and 1.0's text, never the revision's", r.frame.includes("MADEUPMARKERONE") && !r.frame.includes("MADEUPMARKERTWO"), r.frame.slice(0, 120));
  check("L1. no em dash on the page", !r.body.includes("—"));
}
{
  const r = await readShare({ dark: true }, "L1_share_link_approved_v1_dark");
  check("D1. dark mode: the link shows the note and 1.0", r.note === NOTE && r.version === "1.0");
}
{
  const r = await readShare({ viewport: { width: 390, height: 844 } }, "L1_share_link_approved_v1_phone");
  check("D1. phone width: the link shows the note with no overflow", r.note === NOTE && r.fit);
}

// ── A2. The revision is approved ──
check("A2. setup: the revision is approved through the signer's route", (await approve(doc.id)) === "approved");
{
  const r = await staffMainRead({}, "A2_staff_main_read_v1_1");
  check("A2. the Staff Read opens 1.1's text with no note", r.text.includes("MADEUPMARKERTWO") && !r.text.includes("MADEUPMARKERONE") && r.note === "" && r.rowNote === "", JSON.stringify({ note: r.note, rowNote: r.rowNote }));
}
{
  const r = await readShare({}, "A2_share_link_v1_1");
  check("A2. the same link shows 1.1 with no note", r.version === "1.1" && r.note === "" && r.frame.includes("MADEUPMARKERTWO"), JSON.stringify({ v: r.version, note: r.note }));
}
check("D1. no page errors in any browser context", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
