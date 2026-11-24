// scripts/verify-veritadc-document-control-ui.mjs
//
// Browser receipt for VeritaDC document control, B13 part 1. On a local production build with a scratch DB and made-up data only:
//   V1. An editor opens an earlier version from the version history: its own text, the superseded banner and the mark across it;
//       Back shows the current version with neither.
//   V2. A limited Staff login reads the approved version only: no version list and nothing to open. A view-only reviewer sees the
//       list as before, with nothing to open.
//   A1. Archived documents: the editor lists one, opens it marked archived, and restores it; it is back in the active list.
//   B1. Approve several: the signer picks three documents, one of which moves after the list is shown; two are signed and the one
//       that moved is refused by name, on one password.
//   N1. Email notices: off; the owner turns approval emails on and it stays on after a reload; an editor sees it and can't change it.
//   D1. Dark mode and phone width for each; nothing wider than the screen; no page errors; no em dash.
// Run: start dist/index.cjs on a scratch DB, then PW_BASE=http://localhost:<port> SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-document-control-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };

const pw = ["Control", "Ui", "13!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `controlui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labName = "Document Control Test Lab";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '22D0000013' WHERE id = ?", labId);
const staffLab = Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, '22D0000013', ?, ?, ?)", ownerId, labName, labId, now, now).lastInsertRowid);
const addSeat = async (tag, seatType, name) => {
  const e = `controlui-${tag}-${stamp}@example.com`;
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
    ownerId, e, id, now, now, seatType, labId, emp, seatType === "active" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}');
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { email: e, id, emp, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token, name };
};
const signer = await addSeat("signer", "active", "Made Up Signer");
const staff = await addSeat("staff", "staff_portal", "Rowan Quillby");
const reviewer = await addSeat("reviewer", "view_only", "Vic Reviewer");
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up approval route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer.id }, token);
const send = async (path, text, fields) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "made-up.txt");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return (await fetch(`${BASE}${P}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
};
const submit = (id) => call("POST", `${P}/documents/${id}/submit`, { workflowId: wf.body.id }, token);
const approve = async (id) => { await submit(id); return (await call("POST", `${P}/documents/${id}/approve`, { typedSignature: signer.name, password: pw }, signer.token)).body.status; };
const body = (marker, extra) => `Made-up Specimen Collection Manual\n${marker}\n${extra}\n${Array.from({ length: 14 }, (_, i) => `${i + 1}. Made-up step ${i + 1} of the procedure.`).join("\n")}\n`;
const TITLE = "Made-up Specimen Collection Manual";
const doc = await send("/documents", body("MADEUPMARKERONE", "Label every tube at the bedside."), { title: TITLE, doc_number: "SC 13" });
await call("POST", `${P}/read-sign`, { scope: "document", id: doc.id, everyone: true }, token);
check("S0. version 1.0 approved", (await approve(doc.id)) === "approved");
const v1 = sql("SELECT current_version_id AS v FROM policy_documents WHERE id = ?", doc.id).v;
await send(`/documents/${doc.id}/versions`, body("MADEUPMARKERTWO", "Label with two identifiers."), { is_major_revision: "false", change_summary: "Two identifiers" });
check("S0. version 1.1 approved", (await approve(doc.id)) === "approved");
const RETIRED = "Made-up Retired Analyzer Procedure";
const retired = await send("/documents", body("MADEUPMARKERRETIRED", "The analyzer is gone."), { title: RETIRED, doc_number: "RT 13" });
await approve(retired.id);
await call("POST", `${P}/documents/${retired.id}/archive`, {}, token);

const browser = await chromium.launch();
const errors = [];
const texts = [];
const open = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
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
  return { page, ctx };
};
const PHONE = { width: 390, height: 844 };
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
// The dialog on top, and whether anything in it is wider than it is.
const dialogFits = (page) => page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return !!d && d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const top = (page) => page.getByRole("dialog").last();
const keep = async (page) => { const t = await top(page).innerText(); texts.push(t); return t; };
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;

// ── V1. An editor reads an earlier version ──
const editorVersion = async (opts, name) => {
  const { page, ctx } = await open(token, POLICIES, opts);
  await page.locator("tr").filter({ hasText: TITLE }).getByRole("button", { name: /View/ }).first().click();
  await page.getByTestId("version-history").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const history = await page.getByTestId("version-history").innerText();
  const current = await keep(page);
  const before = { banner: await page.getByTestId("version-banner").count(), mark: await page.getByTestId("document-watermark").count() };
  await page.getByTestId(`version-open-${v1}`).click();
  await page.getByTestId("version-banner").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const old = await keep(page);
  const banner = await page.getByTestId("version-banner").innerText();
  const mark = await page.getByTestId("document-watermark").innerText();
  const share = await page.getByTestId("share-links").count();
  await page.getByTestId("version-banner").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const ok = await dialogFits(page);
  await shot(page, name);
  await page.getByTestId("version-back").click();
  await page.waitForTimeout(900);
  const back = await keep(page);
  const after = { banner: await page.getByTestId("version-banner").count(), mark: await page.getByTestId("document-watermark").count() };
  await ctx.close();
  return { history, current, before, old, banner, mark, share, ok, back, after };
};
{
  const r = await editorVersion({}, "V1_editor_superseded_light");
  check("V1. the history lists both versions with where they stand", /v1\.1\s*Current/i.test(r.history) && /v1\.0\s*Superseded/i.test(r.history), r.history);
  check("V1. the current version shows with no banner and no mark", r.current.includes("MADEUPMARKERTWO") && r.before.banner === 0 && r.before.mark === 0);
  check("V1. Open shows version 1.0's own text", r.old.includes("MADEUPMARKERONE") && !r.old.includes("MADEUPMARKERTWO"), r.old.slice(0, 200));
  check("V1. labelled superseded, naming the version in use", /Superseded\./.test(r.banner) && r.banner.includes("Version 1.1 is in use now. Version 1.0 is shown for reference only."), r.banner);
  check("V1. with the uncontrolled copy mark across it", r.mark.includes("SUPERSEDED - UNCONTROLLED COPY"), r.mark);
  check("V1. and no share link offered for it", r.share === 0);
  check("V1. Back shows the current version again, unmarked", r.back.includes("MADEUPMARKERTWO") && r.after.banner === 0 && r.after.mark === 0);
  const d = await editorVersion({ dark: true }, "V1_editor_superseded_dark");
  check("D1. dark: the same", d.banner === r.banner && d.mark === r.mark && d.ok);
  const p = await editorVersion({ viewport: PHONE }, "V1_editor_superseded_phone");
  check("D1. phone: the same, nothing wider than the dialog", p.banner === r.banner && p.ok);
  const pd = await editorVersion({ viewport: PHONE, dark: true }, "V1_editor_superseded_phone_dark");
  check("D1. phone dark: the same", pd.banner === r.banner && pd.ok);
}

// ── V2. A limited Staff login, and a view-only reviewer ──
{
  const { page, ctx } = await open(staff.token, POLICIES);
  await page.getByTestId("staff-doc-lookup-input").fill("Specimen");
  await page.getByTestId("staff-doc-lookup-results").waitFor({ timeout: 15000 });
  await page.getByTestId("staff-doc-lookup-open").first().click();
  await top(page).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  const t = await keep(page);
  check("V2. a Staff login reads the approved version, with no version list and nothing to open", t.includes("MADEUPMARKERTWO") && !t.includes("MADEUPMARKERONE") && (await page.getByTestId("version-history").count()) === 0 && (await page.getByTestId(`version-open-${v1}`).count()) === 0);
  check("V2. and no archived list, banner or mark", (await page.getByTestId("archived-open").isVisible()) === false && (await page.getByTestId("version-banner").count()) === 0 && (await page.getByTestId("document-watermark").count()) === 0);
  await shot(page, "V2_staff_approved_only_light");
  await ctx.close();
  const r = await open(reviewer.token, POLICIES);
  await r.page.locator("tr").filter({ hasText: TITLE }).getByRole("button", { name: /View/ }).first().click();
  await r.page.getByTestId("version-history").waitFor({ timeout: 15000 });
  const history = await r.page.getByTestId("version-history").innerText();
  check("V2. a view-only reviewer's list is as it was: both versions, no standing, nothing to open", /v1\.1/.test(history) && /v1\.0/.test(history) && !/Superseded|Current|Open|Reading/.test(history), history);
  await shot(r.page, "V2_reviewer_list_light");
  await r.ctx.close();
}

// ── A1. Archived documents ──
const archivedList = async (opts, name) => {
  const { page, ctx } = await open(token, POLICIES, opts);
  await page.getByTestId("archived-open").click();
  await page.getByTestId(`archived-row-${retired.id}`).waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  const text = await keep(page);
  const ok = (await dialogFits(page)) && (await fits(page));
  await shot(page, name);
  return { page, ctx, text, ok };
};
{
  const d = await archivedList({ dark: true }, "A1_archived_list_dark"); check("D1. dark: the archived list", d.ok && d.text.includes(RETIRED)); await d.ctx.close();
  const p = await archivedList({ viewport: PHONE }, "A1_archived_list_phone"); check("D1. phone: the archived list fits", p.ok); await p.ctx.close();
  const { page, ctx, text } = await archivedList({}, "A1_archived_list_light");
  check("A1. the list says what it was, when and by whom", text.includes(`RT 13${""}`) && text.includes(RETIRED) && /v1\.0, approved when archived on .+ by Riley Owner/.test(text), text);
  check("A1. it isn't in the active list", (await page.locator("tr").filter({ hasText: RETIRED }).count()) === 0);
  await page.getByTestId(`archived-open-${retired.id}`).click();
  await page.getByTestId("archived-banner").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const view = await keep(page);
  check("A1. Open shows it, marked archived", view.includes("MADEUPMARKERRETIRED") && /Archived\. This document is out of use/.test(view) && (await page.getByTestId("document-watermark").innerText()).includes("ARCHIVED - UNCONTROLLED COPY"));
  check("A1. with no share link and no linking on it", (await page.getByTestId("share-links").count()) === 0 && (await page.getByTestId("related-policies").count()) === 0);
  await shot(page, "A1_archived_open_light");
  await top(page).getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(400);
  await page.getByTestId(`archived-restore-${retired.id}`).click();
  await page.waitForTimeout(200);
  const confirm = await keep(page);
  check("A1. Restore asks first, and says what restoring does", /Restore it as approved\? Staff will read it as a procedure in use again/.test(confirm), confirm);
  await shot(page, "A1_archived_restore_confirm_light");
  await page.getByTestId(`archived-restore-yes-${retired.id}`).click();
  await page.getByTestId("archived-empty").waitFor({ timeout: 15000 });
  const signs = sql("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id = ?", retired.id).n;
  const d2 = sql("SELECT status, archived_at FROM policy_documents WHERE id = ?", retired.id);
  check("A1. restored: approved as it was, nothing signed again", d2.status === "approved" && d2.archived_at === null && signs === 1, JSON.stringify({ ...d2, signs }));
  await top(page).getByRole("button", { name: "Close" }).first().click();
  await page.locator("tr").filter({ hasText: RETIRED }).first().waitFor({ timeout: 15000 });
  check("A1. and it is back in the active list without a reload", true);
  await ctx.close();
}

// ── B1. Approve several ──
{
  const ids = [];
  for (let i = 1; i <= 4; i++) { const d = await send("/documents", body(`MADEUPBULK${i}`, "Made-up."), { title: `Made-up bulk procedure ${i}`, doc_number: `BK ${i}` }); await submit(d.id); ids.push(d.id); }
  for (const [opts, name] of [[{ dark: true }, "B1_bulk_list_dark"], [{ viewport: PHONE }, "B1_bulk_list_phone"]]) {
    const { page, ctx } = await open(signer.token, POLICIES, opts);
    await page.getByTestId("bulk-open").click();
    await page.getByTestId("bulk-list").waitFor({ timeout: 15000 });
    await page.getByTestId("bulk-all").click();
    await page.waitForTimeout(250);
    check(`D1. ${opts.dark ? "dark" : "phone"}: the list fits and Select all counts`, (await dialogFits(page)) && /Approve 4 documents/.test(await keep(page)));
    await shot(page, name);
    await ctx.close();
  }
  const { page, ctx } = await open(signer.token, POLICIES);
  await page.getByTestId("bulk-open").click();
  await page.getByTestId("bulk-list").waitFor({ timeout: 15000 });
  check("B1. nothing is picked to start, so nothing can be signed by accident", await page.getByTestId("bulk-sign").isDisabled());
  for (const id of ids.slice(0, 3)) await page.getByTestId(`bulk-pick-${id}`).click();
  check("B1. the typed name starts as the signer's, and the password is empty", (await page.getByTestId("bulk-name").inputValue()) === signer.name && (await page.getByTestId("bulk-password").inputValue()) === "" && (await page.getByTestId("bulk-sign").isDisabled()));
  // It moves after the list was shown.
  await send(`/documents/${ids[1]}/versions`, body("MADEUPBULK2REVISED", "Made-up revision."), { change_summary: "Revised meanwhile" });
  await submit(ids[1]);
  await page.getByTestId("bulk-password").fill("not-the-password");
  await page.getByTestId("bulk-sign").click();
  await page.waitForTimeout(1500);
  check("B1. a wrong password signs nothing and says so", sql("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id IN (?, ?, ?)", ids[0], ids[1], ids[2]).n === 0 && /^Nothing was signed\. Password incorrect/.test(await page.getByTestId("bulk-problem").innerText()));
  await page.getByTestId("bulk-password").fill(pw);
  await shot(page, "B1_bulk_list_light");
  await page.getByTestId("bulk-sign").click();
  await page.getByTestId("bulk-results").waitFor({ timeout: 20000 });
  const res = await keep(page);
  check("B1. it says what happened to each", /2 documents signed, 1 not signed\./.test(res) && (res.match(/Signed\. It is now approved\./g) || []).length === 2 && /Not signed\. It moved since the list was shown/.test(res), res);
  await shot(page, "B1_bulk_results_light");
  const st = ids.map((id) => sql("SELECT status FROM policy_documents WHERE id = ?", id).status);
  const n = ids.map((id) => sql("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id = ?", id).n);
  check("B1. two approved with one signature each, the one that moved and the one left alone unsigned", JSON.stringify(st) === JSON.stringify(["approved", "in_review", "approved", "in_review"]) && JSON.stringify(n) === JSON.stringify([1, 0, 1, 0]), JSON.stringify({ st, n }));
  await page.getByTestId("bulk-done").click();
  await page.waitForTimeout(1200);
  check("B1. the review card drops to the two still waiting", /Pending my review \(2\)/.test(await page.locator("body").innerText()));
  await ctx.close();
}

// ── N1. Email notices ──
const notices = async (tk, opts = {}) => {
  const { page, ctx } = await open(tk, POLICIES, opts);
  await page.getByTestId("reminder-emails-open").click();
  await page.getByTestId("email-notices").waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  return { page, ctx };
};
{
  const { page, ctx } = await notices(token);
  const state = (id) => page.getByTestId(id).getAttribute("aria-checked");
  check("N1. both notices start off", (await state("notice-approvals")) === "false" && (await state("notice-overdue")) === "false");
  await page.getByTestId("notice-approvals").click();
  await page.waitForTimeout(900);
  check("N1. the owner turns approval emails on", (await state("notice-approvals")) === "true" && sql("SELECT dc_notify_approvers AS a, dc_notify_overdue_signs AS o FROM labs WHERE id = ?", labId).a === 1);
  await keep(page);
  await shot(page, "N1_email_notices_light");
  await ctx.close();
  const again = await notices(token, { dark: true });
  check("N1. it stays on after a reload, and the other stays off", (await again.page.getByTestId("notice-approvals").getAttribute("aria-checked")) === "true" && (await again.page.getByTestId("notice-overdue").getAttribute("aria-checked")) === "false" && (await dialogFits(again.page)));
  await shot(again.page, "N1_email_notices_dark");
  await again.ctx.close();
  const phone = await notices(token, { viewport: PHONE });
  check("D1. phone: the notices fit", await dialogFits(phone.page));
  await shot(phone.page, "N1_email_notices_phone");
  await phone.ctx.close();
  const ed = await notices(signer.token);
  check("N1. an editor sees it and can't change it", (await ed.page.getByTestId("notice-approvals").isDisabled()) && (await ed.page.getByTestId("notice-overdue").isDisabled()) && /Ask your owner or an admin/.test(await ed.page.getByTestId("email-notices").innerText()));
  await ed.ctx.close();
}

check("D1. no em or en dash in any dialog", !texts.some((t) => /[–—]/.test(t)), texts.find((t) => /[–—]/.test(t))?.slice(0, 200));
check("D1. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
