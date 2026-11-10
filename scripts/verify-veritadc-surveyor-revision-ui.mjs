// scripts/verify-veritadc-surveyor-revision-ui.mjs
//
// Browser receipt for BUG-152 (server/policyApprovedVersion.ts surveyorReads; routes.ts "Phase 8"): while a newer revision of a
// VeritaDC document is a draft or in review, an inspector's surveyor link keeps listing and showing the approved version, and
// says so. Before, the document dropped out of the inspector's view until the revision was approved. On a local production
// build with a scratch DB and made-up data only:
//   U0. Two made-up documents approved through the signer's approve route, and a surveyor link. One gets a revision (draft),
//       which the signer then rejects back to draft, so its own sign-off row exists.
//   U1. The surveyor page, no login: the revised document is listed at v1.0 with the note; the other has no note.
//   U2. View: the note with its version, 1.0's text and never the revision's, and a signature history with the approval
//       and not the revision's rejection.
//   D1. Dark mode and phone width: the note shows, no overflow.
//   A2. The revision is approved: listed at v1.1 with no note; View shows 1.1's text.
//   D2. No page errors; no em dash on the page.
// Run: UI_REPO=<worktree> UI_PORT=<free port> UI_SCRIPT=verify-veritadc-surveyor-revision-ui.mjs UI_OUT=surveyor_revision UI_DB=surveyor_revision.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
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

const pw = ["Surveyor", "Ui", "152!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `surveyorui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labName = "Surveyor Revision Test Lab";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '22D0000152' WHERE id = ?", labId);
const signerEmail = `surveyorui-signer-${stamp}@example.com`;
const signerId = Number((await call("POST", "/api/auth/register", { email: signerEmail, password: pw, name: "Made Up Signer", hipaa_acknowledged: true })).body.user?.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, signerId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, signerId);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'active', ?, '{\"mode\":\"edit_all\"}')", ownerId, signerEmail, signerId, now, now, labId);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", signerId);
const signerToken = (await call("POST", "/api/auth/login", { email: signerEmail, password: pw })).body.token;
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up approval route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signerId }, token);
const submit = (id) => call("POST", `${P}/documents/${id}/submit`, { workflowId: wf.body.id }, token);
const decide = async (id, verb) => (await call("POST", `${P}/documents/${id}/${verb}`, { typedSignature: "Made Up Signer", password: pw, comment: verb === "reject" ? "Made-up rejection" : undefined }, signerToken)).body.status;
const approve = async (id) => { await submit(id); return decide(id, "approve"); };
const upload = async (title, text, num) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "made-up.txt");
  fd.append("title", title);
  fd.append("doc_number", num);
  return (await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json()).id;
};
const TITLE = "Made-up Specimen Collection Manual";
const OTHER = "Made-up Hand Hygiene Procedure";
const doc = await upload(TITLE, `${TITLE}\nVersion 1.0 (made-up). MADEUPMARKERONE\nLabel every tube at the bedside.\n`, "SC 152");
const other = await upload(OTHER, `${OTHER}\nVersion 1.0 (made-up). MADEUPOTHER\n`, "HH 152");
check("U0. both made-up documents are approved through the signer's approve route", (await approve(doc)) === "approved" && (await approve(other)) === "approved");
const link = await call("POST", `${P}/surveyor-links`, { label: "Made-up inspection", expiresInDays: 14 }, token);
check("U0. a surveyor link exists", link.status === 201 && typeof link.body.token === "string");
const fd2 = new FormData();
fd2.append("file", new Blob([Buffer.from(`${TITLE}\nVersion 1.1 (made-up). MADEUPMARKERTWO\nLabel every tube with two identifiers.\n`)], { type: "text/plain" }), "made-up-v2.txt");
fd2.append("is_major_revision", "0");
fd2.append("change_summary", "Made-up revision: two identifiers");
const v2 = (await (await fetch(`${BASE}${P}/documents/${doc}/versions`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd2 })).json()).version_id;
await submit(doc);
check("U0. the revision is uploaded, submitted and rejected back to draft", !!v2 && (await decide(doc, "reject")) === "draft" && sql("SELECT status FROM policy_documents WHERE id = ?", doc).status === "draft");
check("U0. the rejection is a sign-off row on the revision", sql("SELECT COUNT(*) AS n FROM policy_signoffs WHERE document_id = ? AND version_id = ? AND action = 'rejected'", doc, v2).n === 1);

const browser = await chromium.launch();
const errors = [];
const SURVEYOR = `/surveyor/${link.body.token}`;
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (opts.dark) { await page.goto(`${BASE}/`); await page.evaluate(() => localStorage.setItem("theme", "dark")); }
  await page.goto(`${BASE}${SURVEYOR}`, { waitUntil: "networkidle" });
  await page.getByText(TITLE).first().waitFor({ timeout: 20000 });
  return { page, ctx };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const noteOf = async (page, testid) => ((await page.getByTestId(testid).count()) ? (await page.getByTestId(testid).first().innerText()).trim() : "");
const row = (page, title) => page.locator("li").filter({ hasText: title }).first();
const view = async (page, title) => {
  await row(page, title).getByRole("button", { name: /View/ }).click();
  const modal = page.locator("div.fixed.inset-0").first();
  await modal.getByText(/Signature history/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  return { modal, text: await modal.innerText(), note: await noteOf(page, "surveyor-view-revision-note") };
};

// ── U1 / U2. The surveyor page while the revision is a draft ──
{
  const { page, ctx } = await open();
  const rowText = await row(page, TITLE).innerText();
  check("U1. the revised document is listed", rowText.includes(TITLE), rowText.replace(/\n/g, " | "));
  check("U1. at the approved v1.0", /v1\.0/.test(rowText) && !/v1\.1/.test(rowText), rowText.replace(/\n/g, " | "));
  check("U1. with the note", (await noteOf(page, `surveyor-revision-note-${doc}`)) === NOTE);
  check("U1. the other document has no note", (await page.getByTestId(`surveyor-revision-note-${other}`).count()) === 0);
  check("U1. no em dash on the page", !(await page.locator("body").innerText()).includes("—"));
  await shot(page, "U1_surveyor_list_revision_in_progress");
  const v = await view(page, TITLE);
  check("U2. View says a revision is in progress, with the version shown", v.note === `${NOTE} Version 1.0.`, v.note);
  check("U2. View shows 1.0's text", v.text.includes("MADEUPMARKERONE"), v.text.slice(0, 200));
  check("U2. and never the revision's", !v.text.includes("MADEUPMARKERTWO"));
  check("U2. the signature history holds the approval", /approved/i.test(v.text), v.text.slice(0, 300));
  check("U2. and not the revision's rejection", !/rejected/i.test(v.text) && !v.text.includes("Made-up rejection"));
  await shot(page, "U2_surveyor_view_approved_v1", false);
  await ctx.close();
}
// ── D1. Dark and phone ──
{
  const { page, ctx } = await open({ dark: true });
  check("D1. dark mode: the note shows", (await noteOf(page, `surveyor-revision-note-${doc}`)) === NOTE);
  await shot(page, "D1_surveyor_list_revision_dark");
  const v = await view(page, TITLE);
  check("D1. dark mode: View shows the note and 1.0", v.note.startsWith(NOTE) && v.text.includes("MADEUPMARKERONE"));
  await shot(page, "D1_surveyor_view_dark", false);
  await ctx.close();
}
{
  const { page, ctx } = await open({ viewport: { width: 390, height: 844 } });
  check("D1. phone width: the note shows with no overflow", (await noteOf(page, `surveyor-revision-note-${doc}`)) === NOTE && (await fits(page)));
  await shot(page, "D1_surveyor_list_revision_phone");
  await ctx.close();
}

// ── A2. The revision is approved ──
check("A2. setup: the revision is approved through the signer's route", (await approve(doc)) === "approved");
{
  const { page, ctx } = await open();
  const rowText = await row(page, TITLE).innerText();
  check("A2. listed at v1.1 with no note", /v1\.1/.test(rowText) && (await page.getByTestId(`surveyor-revision-note-${doc}`).count()) === 0, rowText.replace(/\n/g, " | "));
  const v = await view(page, TITLE);
  check("A2. View shows 1.1's text with no note", v.text.includes("MADEUPMARKERTWO") && !v.text.includes("MADEUPMARKERONE") && v.note === "", JSON.stringify({ note: v.note }));
  await shot(page, "A2_surveyor_view_v1_1", false);
  await ctx.close();
}
check("D2. no page errors in any browser context", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
