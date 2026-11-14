// scripts/verify-veritadc-surveyor-review-overdue-ui.mjs
//
// Browser receipt for BUG-164 (Michael 2026-11-13, Q328 = 1; server/policyApprovedVersion.ts surveyorReads; routes.ts
// "Phase 8"; client/src/pages/SurveyorViewPage.tsx): an inspector's surveyor link shows a VeritaDC document whose review
// date has passed (the nightly sweep's 'expired'), marked "Review overdue" with the date the review was due. Before, the
// document dropped out of the inspector's view while staff logins and share links still showed it. On a local production
// build with a scratch DB and made-up data only:
//   U0. Two made-up documents approved through the signer's approve route; one's review date is put in the past and marked
//       review-overdue, as the sweep does; a surveyor link.
//   U1. The surveyor page, no login: both are listed; the overdue one carries the note with its due date, the other none.
//   U2. View on the overdue one: the note, its text, and its signature history with the approval.
//   D1. Dark mode and phone width: the note shows, no sideways scroll. No page errors; no em dash on the page.
// Run: UI_REPO=<worktree> UI_PORT=<free port> UI_SCRIPT=verify-veritadc-surveyor-review-overdue-ui.mjs UI_OUT=surveyor_overdue bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };

const pw = ["Surveyor", "Overdue", "164!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `surveyorod-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Surveyor Overdue Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '22D0000164' WHERE id = ?", labId);
const signerEmail = `surveyorod-signer-${stamp}@example.com`;
const signerId = Number((await call("POST", "/api/auth/register", { email: signerEmail, password: pw, name: "Made Up Signer", hipaa_acknowledged: true })).body.user?.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, signerId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, signerId);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', 'active', ?, '{\"mode\":\"edit_all\"}')", ownerId, signerEmail, signerId, now, now, labId);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", signerId);
const signerToken = (await call("POST", "/api/auth/login", { email: signerEmail, password: pw })).body.token;
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up approval route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signerId }, token);
const approve = async (id) => { await call("POST", `${P}/documents/${id}/submit`, { workflowId: wf.body.id }, token); return (await call("POST", `${P}/documents/${id}/approve`, { typedSignature: "Made Up Signer", password: pw }, signerToken)).body.status; };
const upload = async (title, text, num) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "made-up.txt");
  fd.append("title", title);
  fd.append("doc_number", num);
  return (await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json()).id;
};
const OVERDUE = "Made-up Specimen Rejection Procedure";
const CURRENT = "Made-up Hand Hygiene Procedure";
const od = await upload(OVERDUE, `${OVERDUE}\nVersion 1.0 (made-up). MADEUPOVERDUEMARKER\nReject an unlabeled specimen.\n`, "SR 164");
const cur = await upload(CURRENT, `${CURRENT}\nVersion 1.0 (made-up). MADEUPCURRENT\n`, "HH 164");
check("U0. both made-up documents are approved through the signer's approve route", (await approve(od)) === "approved" && (await approve(cur)) === "approved");
// What the nightly sweep does once the review date passes.
sql("UPDATE policy_documents SET next_review_date = '2026-10-01', status = 'expired' WHERE id = ?", od);
check("U0. one is review-overdue, as the nightly sweep leaves it", sql("SELECT status FROM policy_documents WHERE id = ?", od).status === "expired");
const link = await call("POST", `${P}/surveyor-links`, { label: "Made-up inspection", expiresInDays: 14 }, token);
check("U0. a surveyor link exists", link.status === 201 && typeof link.body.token === "string");

const browser = await chromium.launch();
const errors = [];
const SURVEYOR = `/surveyor/${link.body.token}`;
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (opts.dark) { await page.goto(`${BASE}/`); await page.evaluate(() => localStorage.setItem("theme", "dark")); }
  await page.goto(`${BASE}${SURVEYOR}`, { waitUntil: "networkidle" });
  await page.getByText(CURRENT).first().waitFor({ timeout: 20000 });
  return { page, ctx };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const noteOf = async (page, testid) => ((await page.getByTestId(testid).count()) ? (await page.getByTestId(testid).first().innerText()).trim() : "");
const NOTE_RE = /^Review overdue\. The review was due \S.*\.$/;

{
  const { page, ctx } = await open();
  const body = await page.locator("body").innerText();
  check("U1. the review-overdue document is listed (it dropped out of the link before)", body.includes(OVERDUE));
  check("U1. the current document is listed", body.includes(CURRENT));
  const note = await noteOf(page, `surveyor-overdue-note-${od}`);
  check("U1. the overdue one carries 'Review overdue' with the date its review was due", NOTE_RE.test(note) && /2026/.test(note), note);
  check("U1. the current one has no overdue note", (await page.getByTestId(`surveyor-overdue-note-${cur}`).count()) === 0);
  check("U1. no em dash on the page", !body.includes("—"));
  await shot(page, "U1_surveyor_list_review_overdue");
  // U2. View
  await page.locator("li").filter({ hasText: OVERDUE }).first().getByRole("button", { name: /View/ }).click();
  const modal = page.locator("div.fixed.inset-0").first();
  await modal.getByText(/Signature history/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const viewNote = await noteOf(page, "surveyor-view-overdue-note");
  const text = await modal.innerText();
  check("U2. View shows the overdue note", NOTE_RE.test(viewNote), viewNote);
  check("U2. ... the document's text", text.includes("MADEUPOVERDUEMARKER"));
  check("U2. ... and its signature history with the approval", /approved/i.test(text) && text.includes("Made Up Signer"));
  await shot(page, "U2_surveyor_view_review_overdue", false);
  await ctx.close();
}
{
  const { page, ctx } = await open({ dark: true });
  check("D1. dark mode: the note shows", NOTE_RE.test(await noteOf(page, `surveyor-overdue-note-${od}`)));
  await shot(page, "D1_surveyor_review_overdue_dark");
  await ctx.close();
  const phone = await open({ viewport: { width: 390, height: 844 } });
  check("D1. phone width: the note shows and nothing scrolls sideways", NOTE_RE.test(await noteOf(phone.page, `surveyor-overdue-note-${od}`)) && (await fits(phone.page)));
  await shot(phone.page, "D1_surveyor_review_overdue_phone");
  await phone.ctx.close();
}
check("D1. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
