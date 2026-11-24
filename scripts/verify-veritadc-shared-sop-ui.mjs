// scripts/verify-veritadc-shared-sop-ui.mjs
//
// Browser receipt for one controlled procedure sent to several laboratories (B1). On a local production build with a scratch DB and
// made-up data only:
//   S1. In the organization's repository, its admin sends an approved document to a roll-up group from the document's own row.
//   L1. In a laboratory: the notice, the chip on the row, and the document's panel; an addendum typed there shows in the same view.
//   L2. A laboratory declines with a reason, and takes it up again from the list of everything received.
//   L3. A view-only reviewer and a Staff login see the label and get no action; the Staff login reads the approved addendum.
//   P1. Print in order opens one PDF.
//   V1. The organization's view: filters, counts, the Excel file. A laboratory's owner sees only its own laboratory.
//   I1. The inspector's link and a share link show the addendum with the document.
//   D1. Light, dark and phone width for each; nothing wider than the screen; no page errors; no em dash.
// Run: start dist/index.cjs on a scratch DB, then PW_BASE=http://localhost:<port> SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-shared-sop-ui.mjs
import fs from "node:fs";
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

const pw = ["Shared", "Ui", "1!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const register = async (tag, name) => {
  const email = `sharedui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, name, token: r.body.token, id: Number(r.body.user?.id) };
};
const mkLab = async (tag, labName, clia) => {
  const o = await register(tag, `Riley ${tag[0].toUpperCase()}${tag.slice(1)}`);
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: o.email, labName, plan: "hospital", isWarehouse: true })).body.labId;
  sql("UPDATE labs SET clia_number = ? WHERE id = ?", clia, labId);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", o.id);
  return { ...o, labId, labName, P: `/api/labs/${labId}/veritapolicy` };
};
const R = await mkLab("library", "Made-up System Library", "22D0000B10");
const A = await mkLab("north", "Made-up North Laboratory", "22D0000B11");
const B = await mkLab("south", "Made-up South Laboratory", "22D0000B12");
const C = await mkLab("coast", "Made-up Coast Laboratory", "22D0000B13");
const org = Number(sql("INSERT INTO organizations (name, billing_owner_user_id, plan, created_at, updated_at) VALUES ('Made-up Health System', ?, 'hospital', ?, ?)", R.id, now, now).lastInsertRowid);
for (const L of [R, A, B, C]) sql("UPDATE labs SET organization_id = ? WHERE id = ?", org, L.labId);
sql("UPDATE labs SET is_repository = 1 WHERE id = ?", R.labId);
const admin = await register("orgadmin", "Oda Orgadmin");
sql("INSERT INTO organization_members (organization_id, user_id, org_role, status, created_at, updated_at) VALUES (?, ?, 'org_admin', 'active', ?, ?)", org, admin.id, now, now);
const seat = async (L, tag, name, type) => {
  const p = await register(tag, name);
  let emp = null;
  if (type === "staff_portal") {
    const staffLab = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", L.labId)?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", L.id, L.labName, `S${L.labId}`, L.labId, now, now).lastInsertRowid);
    const [first, last] = name.split(" ");
    emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'Medical Technologist', 'active', ?, ?)", staffLab, L.labId, L.id, last, first, now, now).lastInsertRowid);
  }
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", L.labId, p.id, now, now, now);
  sql("UPDATE users SET lab_id = ? WHERE id = ?", L.labId, p.id);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, staff_employee_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)", L.id, p.email, p.id, now, now, type, L.labId, emp, type === "active" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}');
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", p.id);
  return { ...p, emp, token: (await call("POST", "/api/auth/login", { email: p.email, password: pw })).body.token };
};
const signers = {};
for (const [L, tag] of [[R, "rsign"], [A, "asign"], [B, "bsign"], [C, "csign"]]) {
  signers[L.labId] = await seat(L, tag, `Sam ${L.labName.split(" ")[1]}`, "active");
  await call("GET", `${L.P}/manuals`, undefined, L.token);
  const wf = await call("POST", `${L.P}/workflows`, { name: "Made-up approval route" }, L.token);
  await call("POST", `${L.P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signers[L.labId].id }, L.token);
  await call("PUT", `${L.P}/workflows/${wf.body.id}`, { isDefault: true }, L.token);
  L.wf = wf.body.id;
}
const reviewer = await seat(A, "reviewer", "Vic Reviewer", "view_only");
const staff = await seat(A, "staff", "Rowan Quillby", "staff_portal");
const upload = async (L, path, text, fields) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(text)], { type: "text/plain" }), "made-up.txt");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return (await fetch(`${BASE}${L.P}${path}`, { method: "POST", headers: { Authorization: `Bearer ${L.token}` }, body: fd })).json();
};
const approve = async (L, id) => { await call("POST", `${L.P}/documents/${id}/submit`, { workflowId: L.wf }, L.token); return (await call("POST", `${L.P}/documents/${id}/approve`, { typedSignature: signers[L.labId].name, password: pw }, signers[L.labId].token)).body.status; };
const text = (marker) => `Made-up Specimen Labeling Procedure for <<LAB_NAME>>\n${marker}\n\nPurpose: every tube is labeled at the bedside with two identifiers.\n${Array.from({ length: 10 }, (_, i) => `${i + 1}. Made-up step ${i + 1} of the procedure.`).join("\n")}\n`;
const TITLE = "Made-up Specimen Labeling Procedure";
const chem = sql("SELECT id FROM policy_manuals WHERE lab_id = ? AND name = 'Chemistry'", R.labId).id;
const master = (await upload(R, "/documents", text("MADEUPONE"), { title: TITLE, doc_number: "SYS 14", doc_type: "procedure", manual_id: String(chem) })).id;
check("S0. the master is approved in the repository", (await approve(R, master)) === "approved");
const second = (await upload(R, "/documents", text("MADEUPSECOND"), { title: "Made-up Critical Result Call Procedure", doc_number: "SYS 20", doc_type: "procedure" })).id;
await approve(R, second);
const group = (await call("POST", "/api/rollup-groups", { name: "North region", kind: "region", organizationId: org, labIds: [A.labId, B.labId] }, admin.token)).body.id;

const browser = await chromium.launch();
const errors = [], texts = [];
const PHONE = { width: 390, height: 844 };
const open = async (who, labId, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e}`));
  await page.goto(`${BASE}/`);
  if (who) {
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
    await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, labId]);
  }
  await page.evaluate((dark) => { if (dark) localStorage.setItem("theme", "dark"); else localStorage.setItem("theme", "light"); }, !!opts.dark);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { page, ctx };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const dialogFits = (page) => page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return !!d && d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= innerWidth + 1; });
const top = (page) => page.getByRole("dialog").last();
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const keep = async (loc) => { const t = await loc.innerText(); texts.push(t); return t; };
const docs = (L) => `/labs/${L.labId}/veritapolicy-app/my-policies`;
const NUMBER = { [TITLE]: "SYS 14" };
const rowOf = (page, title = TITLE) => page.locator("tr").filter({ hasText: NUMBER[title] ?? title }).first(); // by number: an addendum's row names the document too
const view = async (page, title = TITLE) => { await rowOf(page, title).getByRole("button", { name: /View/ }).first().click(); await page.getByTestId("system-document-panel").waitFor({ timeout: 15000 }); await page.waitForTimeout(700); };

// ── S1. Sending, from the repository ──
{
  const { page, ctx } = await open(admin, R.labId, docs(R));
  await page.getByTestId(`send-${master}`).click();
  await page.getByTestId("send-labs").waitFor({ timeout: 15000 });
  const t = await keep(top(page));
  check("S1. the dialog says what sending does, and lists the organization's laboratories", /Nothing takes effect until that laboratory approves it, and no signature is carried/.test(t) && t.includes(A.labName) && t.includes(B.labName) && t.includes(C.labName) && !t.includes(R.labName), t);
  await page.getByTestId(`send-group-${group}`).click();
  check("S1. a group picks its laboratories", await page.getByTestId(`send-lab-${A.labId}`).isChecked() && await page.getByTestId(`send-lab-${B.labId}`).isChecked() && !(await page.getByTestId(`send-lab-${C.labId}`).isChecked()));
  await shot(page, "b1_send_light");
  await page.getByTestId("send-go").click();
  await page.getByTestId("send-results").waitFor({ timeout: 15000 });
  const r = await keep(page.getByTestId("send-results"));
  check("S1. it says what happened in each", (r.match(/is a draft there/g) || []).length === 2, r);
  await top(page).getByRole("button", { name: "Close" }).first().click();
  await page.waitForTimeout(800);
  check("S1. the row says how far it got", /Sent to 2 laboratories: 0 approved this version, 2 waiting/.test(await keep(page.getByTestId(`sent-chip-${master}`))));
  await ctx.close();
  const dark = await open(admin, R.labId, docs(R), { dark: true });
  await dark.page.getByTestId(`send-${second}`).click();
  await dark.page.getByTestId("send-labs").waitFor({ timeout: 15000 });
  await dark.page.waitForTimeout(300);
  await shot(dark.page, "b1_send_dark");
  await dark.ctx.close();
  const ph = await open(admin, R.labId, docs(R), { viewport: PHONE });
  await ph.page.getByTestId(`send-${second}`).scrollIntoViewIfNeeded();
  await ph.page.getByTestId(`send-${second}`).click();
  await ph.page.getByTestId("send-labs").waitFor({ timeout: 15000 });
  check("D1. the send dialog fits a phone", await dialogFits(ph.page));
  await ph.ctx.close();
}
await call("POST", `${R.P}/shared/masters/${second}/send`, { all: true }, admin.token);
const aDoc = sql("SELECT document_id AS id FROM policy_shared_copies WHERE master_document_id = ? AND lab_id = ?", master, A.labId).id;
const bDoc = sql("SELECT document_id AS id FROM policy_shared_copies WHERE master_document_id = ? AND lab_id = ?", master, B.labId).id;

// ── L1. In a laboratory ──
{
  const { page, ctx } = await open(A, A.labId, docs(A));
  const n = await keep(page.getByTestId("system-documents-notice"));
  check("L1. a notice says what is waiting, and from where", /System documents waiting \(2\)/.test(n) && n.includes(TITLE) && /All from Made-up Health System \(2\)/.test(n), n);
  check("L1. its row is labelled System document, version 1.0", /System document, version 1\.0/.test(await keep(rowOf(page))));
  await shot(page, "b1_received_light");
  await view(page);
  const p = await keep(page.getByTestId("system-document-panel"));
  check("L1. the document says where it came from, that nothing is in use yet, and who sent it", /From Made-up Health System\. Your laboratory approves each version before it is used here/.test(p) && /Sent .* by Oda Orgadmin/.test(p) && /In use here: nothing yet/.test(p) && /Nothing is in use until your laboratory submits and approves it/.test(p), p);
  await page.getByTestId("system-add-addendum").click();
  await page.getByTestId("addendum-title").fill("North site addendum");
  await page.getByTestId("addendum-text").fill("MADEUPADDENDUM. At North, use the blue rack in the send-out room.");
  await page.getByTestId("addendum-save").click();
  await page.getByTestId("addenda-view").waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  const addendum = await keep(page.getByTestId("addenda-view"));
  check("L1. the addendum shows under it in the same view, marked as not approved yet", /Site addendum 1/.test(addendum) && addendum.includes("North site addendum") && /Not approved yet/.test(addendum), addendum);
  const framed = page.frameLocator('[data-testid^="addendum-html-"]').locator("body");
  check("L1. with its text", (await framed.innerText()).includes("MADEUPADDENDUM"));
  await page.getByTestId("addenda-view").scrollIntoViewIfNeeded();
  check("D1. the view fits its dialog", await dialogFits(page));
  await shot(page, "b1_addendum_light");
  await ctx.close();
  const dark = await open(A, A.labId, docs(A), { dark: true });
  await shot(dark.page, "b1_received_dark");
  await view(dark.page);
  await shot(dark.page, "b1_document_dark");
  await dark.ctx.close();
  const lt = await open(A, A.labId, docs(A));
  await view(lt.page);
  check("L1. the document's own panel, not the addendum's", (await lt.page.getByTestId("system-document-label").innerText()) === "System document, version 1.0");
  await shot(lt.page, "b1_document_light");
  await lt.ctx.close();
  const ph = await open(A, A.labId, docs(A), { viewport: PHONE });
  check("D1. the list page fits a phone", await fits(ph.page));
  await ph.page.getByTestId(`system-waiting-${aDoc}`).getByRole("button", { name: /View/ }).click();
  await ph.page.getByTestId("system-document-panel").waitFor({ timeout: 15000 });
  await ph.page.waitForTimeout(700);
  check("D1. the document and its addendum fit a phone", await dialogFits(ph.page));
  await shot(ph.page, "b1_document_phone");
  await ph.ctx.close();
}

// ── L2. Declining, and taking it up again ──
{
  const { page, ctx } = await open(B, B.labId, docs(B));
  await view(page);
  await page.getByTestId("system-decline").click();
  check("L2. it can't be declined without a reason", await page.getByTestId("system-decline-yes").isDisabled());
  await page.getByTestId("system-decline-reason").fill("Not performed at this site.");
  await keep(page.getByTestId("system-document-panel"));
  await shot(page, "b1_decline_light");
  await page.getByTestId("system-decline-yes").click();
  await page.waitForTimeout(1500);
  check("L2. a declined document leaves the list", (await page.locator("tr").filter({ hasText: TITLE }).count()) === 0 && !!sql("SELECT archived_at AS a FROM policy_documents WHERE id = ?", bDoc).a);
  await page.getByTestId("system-documents-all").click();
  const list = await keep(page.getByTestId("system-documents-list"));
  check("L2. everything received still lists it, with the reason", /Declined .*: Not performed at this site\./.test(list), list);
  await page.getByRole("button", { name: "Take it up" }).click();
  await page.waitForTimeout(1200);
  check("L2. taking it up again brings the draft back", sql("SELECT archived_at AS a FROM policy_documents WHERE id = ?", bDoc).a === null);
  await ctx.close();
}

// ── Approvals, a new version, and the counts, through the routes ──
check("S2. North approves it and its addendum", (await approve(A, aDoc)) === "approved" && (await approve(A, sql("SELECT addendum_document_id AS id FROM policy_addenda WHERE document_id = ?", aDoc).id)) === "approved");
check("S2. South approves version 1.0", (await approve(B, bDoc)) === "approved");
await call("POST", `${A.P}/read-sign`, { scope: "document", id: aDoc, everyone: true }, A.token);
await upload(R, `/documents/${master}/versions`, text("MADEUPTWO"), { change_summary: "Two identifiers on every tube" });
await approve(R, master);
await approve(A, aDoc);
const bSecond = sql("SELECT id, document_id AS d FROM policy_shared_copies WHERE master_document_id = ? AND lab_id = ?", second, B.labId);
await call("POST", `${B.P}/shared/received/${bSecond.id}/decline`, { reason: "Results are called from the core laboratory." }, B.token);
await approve(C, sql("SELECT document_id AS d FROM policy_shared_copies WHERE master_document_id = ? AND lab_id = ?", second, C.labId).d);

// ── L3. Readers with no say ──
{
  const { page, ctx } = await open(reviewer, A.labId, docs(A));
  await view(page);
  const p = await keep(page.getByTestId("system-document-panel"));
  check("L3. a view-only reviewer reads the label and gets no action", /System document, version 1\.1/.test(p) && (await page.getByTestId("system-own").count()) === 0 && (await page.getByTestId("system-add-addendum").count()) === 0, p);
  await ctx.close();
  const s = await open(staff, A.labId, docs(A));
  await rowOf(s.page).getByRole("button", { name: /View/ }).first().click();
  await s.page.getByTestId("addenda-view").waitFor({ timeout: 15000 });
  await s.page.waitForTimeout(700);
  check("L3. a Staff login reads the approved addendum with the document, and gets no action", (await s.page.frameLocator('[data-testid^="addendum-html-"]').locator("body").innerText()).includes("MADEUPADDENDUM") && (await s.page.getByTestId("system-own").count()) === 0 && (await s.page.getByTestId("system-documents-notice").count()) === 0);
  await s.ctx.close();
  const m = await open(staff, A.labId, `/labs/${A.labId}/my-signoffs`);
  await m.page.waitForTimeout(1200);
  const tile = m.page.getByText(/Policies|Documents to read/i).first();
  if (await tile.count()) { await tile.click(); await m.page.waitForTimeout(1200); }
  const inList = m.page.getByText(TITLE).first();
  if (await inList.count()) {
    await inList.click();
    await m.page.getByTestId("sp-policies-addenda").waitFor({ timeout: 15000 });
    check("L3. My sign-offs shows the addendum under the document it signs", (await m.page.getByTestId("sp-policies-addenda").innerText()).includes("North site addendum"));
    await shot(m.page, "b1_signoff_light");
  } else check("L3. My sign-offs lists the document", false, (await m.page.locator("body").innerText()).slice(0, 400));
  await m.ctx.close();
}

// ── P1. One print order ──
{
  const { page, ctx } = await open(A, A.labId, docs(A));
  await view(page);
  const [res, tab] = await Promise.all([page.waitForResponse((r) => r.url().includes("/print.pdf"), { timeout: 60000 }), ctx.waitForEvent("page", { timeout: 60000 }), page.getByTestId("system-document-print").click()]);
  check("P1. Print in order opens one PDF in a new tab", res.status() === 200 && /application\/pdf/.test(res.headers()["content-type"] || "") && !!tab);
  const pdf = await fetch(`${BASE}${A.P}/documents/${aDoc}/print.pdf`, { headers: { Authorization: `Bearer ${A.token}` } });
  fs.writeFileSync(`${OUT}/b1_print.pdf`, Buffer.from(await pdf.arrayBuffer()));
  await ctx.close();
}

// ── V1. The organization's view ──
{
  const { page, ctx } = await open(admin, A.labId, `/labs/${A.labId}/readiness/system-documents`);
  await page.getByTestId("system-documents-list").waitFor({ timeout: 20000 });
  const t = await keep(page.locator("main, #root").first());
  check("V1. each document, and where each laboratory stands", t.includes(TITLE) && /System version 1\.1/.test(t) && /Made-up North Laboratory/.test(t) && /Version 1\.1\s+since/.test(t), t.slice(0, 600));
  check("V1. read and sign is counts, and no one is named", /0 signed, 1 owed/.test(t) && !/Quillby|Sam North|Vic Reviewer/.test(t));
  check("V1. a declined laboratory shows its reason", /Results are called from the core laboratory/.test(t));
  await shot(page, "b1_system_light");
  await page.getByTestId("system-documents-group").selectOption(String(group));
  const g = await keep(page.getByTestId("system-documents-list"));
  check("V1. a group filter takes the other laboratories away", g.includes("North") && !g.includes("Coast"), g.slice(0, 300));
  await page.getByTestId("system-documents-status").selectOption("declined");
  check("V1. so does a status", (await page.getByTestId("system-documents-summary").innerText()).startsWith("1 document"));
  await page.getByTestId("system-documents-status").selectOption("");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("system-documents-excel").click()]);
  const file = `${OUT}/b1_export.xlsx`;
  await dl.saveAs(file);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const cells = JSON.stringify(wb.getWorksheet("System documents").getSheetValues());
  check("V1. Excel gives the rows on screen", wb.worksheets[0].name === "About" && cells.includes("North Laboratory") && !cells.includes("Coast Laboratory"), wb.worksheets.map((w) => w.name).join());
  await ctx.close();
  const dark = await open(admin, A.labId, `/labs/${A.labId}/readiness/system-documents`, { dark: true });
  await dark.page.getByTestId("system-documents-list").waitFor({ timeout: 20000 });
  await shot(dark.page, "b1_system_dark");
  await dark.ctx.close();
  const ph = await open(admin, A.labId, `/labs/${A.labId}/readiness/system-documents`, { viewport: PHONE });
  await ph.page.getByTestId("system-documents-list").waitFor({ timeout: 20000 });
  check("D1. the organization's view fits a phone", await fits(ph.page));
  await shot(ph.page, "b1_system_phone");
  await ph.ctx.close();
  const own = await open(A, A.labId, `/labs/${A.labId}/readiness/system-documents`);
  await own.page.getByTestId("system-documents-list").waitFor({ timeout: 20000 });
  const o = await own.page.getByTestId("system-documents-list").innerText();
  check("V1. a laboratory's owner sees only its own laboratory", o.includes("North") && !o.includes("South") && !o.includes("Coast"));
  await own.ctx.close();
  const rd = await open(admin, A.labId, `/labs/${A.labId}/readiness`);
  await rd.page.getByTestId("system-documents-link").waitFor({ timeout: 20000 });
  await rd.page.getByTestId("system-documents-link").click();
  await rd.page.getByTestId("system-documents-list").waitFor({ timeout: 20000 });
  check("V1. it's reached from Inspection Readiness", true);
  await rd.ctx.close();
}

// ── I1. Outside readers ──
{
  const surv = (await call("POST", `${A.P}/surveyor-links`, { label: "Made-up visit" }, A.token)).body.token;
  const { page, ctx } = await open(null, null, `/surveyor/${surv}`);
  await page.locator("li").filter({ hasText: TITLE }).first().getByRole("button", { name: /View/ }).click();
  await page.getByTestId("addenda-view").waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  check("I1. an inspector reads the addendum with the document", (await page.frameLocator('[data-testid^="addendum-html-"]').locator("body").innerText()).includes("MADEUPADDENDUM"));
  await ctx.close();
  const share = (await call("POST", `${A.P}/documents/${aDoc}/share-links`, { label: "Made-up nursing" }, A.token)).body.token;
  const s = await open(null, null, `/policy/${share}`, { viewport: PHONE });
  await s.page.getByTestId("addenda-view").waitFor({ timeout: 15000 });
  check("I1. a share link shows it too, and fits a phone", (await s.page.getByTestId("addenda-view").innerText()).includes("North site addendum") && await fits(s.page));
  await s.ctx.close();
}

await browser.close();
check("D1. no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
check("D1. no em dash in anything shown", !texts.some((t) => t.includes(String.fromCharCode(0x2014))), texts.find((t) => t.includes(String.fromCharCode(0x2014)))?.slice(0, 200));
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
