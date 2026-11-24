// scripts/verify-inspection-ui.mjs
//
// Browser receipt for assigning, carried and bulk answers, and direct VeritaDC links (B6, B7, B8, 2026-11-24;
// server/inspectionAssign.ts, server/veritascanCarry.ts, server/inspectionLinks.ts). On a local production build with a
// scratch DB: made-up labs, people, documents and answers only.
//   U1. a finding is assigned on its page; the list names the person; Assigned to me is theirs; a Staff login reads, can't assign
//   U2. a scan item is assigned; an auto-save afterwards doesn't undo it; Assigned to me on VeritaScan
//   U3. a failed study opens a finding, named and linked both ways; a passing one doesn't offer it
//   U4. a new scan begins from an earlier one: Compliant and N/A ticked, carried banner, nothing counted until reviewed
//   U5. several items set together with the count in the confirm; a reload shows them
//   U6. a system admin copies answers to another lab; an editor isn't offered it
//   U7. a VeritaDC document as evidence: picked, opened in the app, flagged on Inspection Proof when past review
//   U8. suggested SOPs on a finding with reasons; linked by a click; the finding and the document name each other
//   U9. dark mode and phone width: no sideways scroll of the page
// Run: PW_BASE=http://localhost:5231 SCRATCH_DB=<db> POLICY_DIR=<POLICY_STORAGE_ROOT> OUT=<dir> node scripts/verify-inspection-ui.mjs
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".", POLICY_DIR = process.env.POLICY_DIR;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const withDb = (fn) => { const db = new Database(process.env.SCRATCH_DB); db.pragma("foreign_keys = OFF"); try { return fn(db); } finally { db.close(); } };
const sql = (q, ...a) => withDb((db) => (/^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid));
const insert = (table, values) => withDb((db) => {
  const row = { ...values };
  for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /INT|REAL/.test(c.type) ? 0 : "made-up";
  const keys = Object.keys(row);
  return Number(db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
});
const pw = ["Insp", "Ready", "77!"].join("-");
const stamp = Date.now();
const register = async (tag, name) => {
  const email = `insp-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, name, token: r.body.token, id: sql("SELECT id FROM users WHERE email = ?", email).id };
};
const member = (lab, u, role = "staff") => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))", lab, u.id, role);

// Made-up people, labs, documents and answers on the scratch DB only
const owner = await register("owner", "Avery Owner"), editor = await register("editor", "Ed Editor"), staff = await register("staff", "Stef Staff"), leader = await register("leader", "Lee Leader"), reviewer = await register("reviewer", "Vic Viewer");
let seq = 0;
const labFor = async (name) => {
  const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: name, plan: "hospital" })).body.labId;
  sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = ?, clia_number = ?, is_demo = 0, plan = 'hospital', subscription_status = 'active', accreditation_cap = 1 WHERE id = ?", name, `22D${String((stamp + seq++) % 10000000).padStart(7, "0")}`, id);
  return id;
};
const A = await labFor("Alder Creek Lab"), B = await labFor("Birch Point Lab");
const ORG = insert("organizations", { name: "Prairie Regional System", billing_owner_user_id: owner.id, plan: "enterprise" });
for (const l of [A, B]) sql("UPDATE labs SET organization_id = ? WHERE id = ?", ORG, l);
insert("organization_members", { organization_id: ORG, user_id: leader.id, org_role: "org_admin", status: "active" });
member(A, editor); member(A, staff); member(A, reviewer);
const staffLab = sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", A)?.id ?? insert("staff_labs", { user_id: owner.id, tier2_lab_id: A, lab_name: "Alder Creek Lab" });
const emp = insert("staff_employees", { user_id: owner.id, lab_id: staffLab, tier2_lab_id: A, first_name: "Stef", last_name: "Staff", status: "active" });
const seat = (u, type, perms, roster = null) => insert("user_seats", { owner_user_id: owner.id, seat_email: u.email, seat_user_id: u.id, status: "active", permissions: JSON.stringify(perms), invite_token: `insp-${stamp}-${u.id}`, lab_id: A, seat_type: type, staff_employee_id: roster, invited_at: "2026-11-01", accepted_at: "2026-11-01" });
seat(editor, "active", { mode: "edit_all" }); seat(staff, "staff_portal", {}, emp); seat(reviewer, "view_only", { mode: "view_all" });
const finding = async (o) => (await call("POST", `/api/labs/${A}/findings`, { accreditor: "CMS", anchor_date: "2026-11-20", ...o }, editor.token)).body.id;
const f1 = await finding({ finding_number: "D5411", standard_ref: "42 CFR 493.1253(b)(1)", description: "Made-up: the refrigerator temperature was not recorded on two days" });
await finding({ finding_number: "D5291", standard_ref: "42 CFR 493.1256" });
const study = (status, name) => insert("studies", { user_id: owner.id, lab_id: A, test_name: name, instrument: "Alphamatic 500", analyst: "AB", date: "2026-11-20", study_type: "cal_ver", clia_allowable_error: 0.1, tea_is_percentage: 1, instruments: JSON.stringify(["Alphamatic 500"]), status,
  data_points: JSON.stringify([1, 2, 3, 4, 5].map((l) => ({ level: l, expectedValue: l * 100, instrumentValues: { "Alphamatic 500": l * 100 * (status === "fail" ? 1.4 : 1.01) } }))), created_at: "2026-11-20T12:00:00Z" });
const bad = study("fail", "Glucose"), good = study("pass", "Sodium");
const docFile = (id, n, text) => { const rel = `ui/${id}/v${n}.html`, abs = path.join(POLICY_DIR, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); const b = Buffer.from(`<h1>${text}</h1><p>Made-up procedure text.</p>`); fs.writeFileSync(abs, b);
  return insert("policy_versions", { document_id: id, version_number: n, file_path: rel, file_format: "html", file_size_bytes: b.length, file_hash_sha256: createHash("sha256").update(b).digest("hex"), uploaded_by: owner.id }); };
const policy = (title, status, due, extra = {}) => { const id = insert("policy_documents", { lab_id: A, title, status, owner_user_id: owner.id, next_review_date: due, ...extra }); const v = docFile(id, 1, title); sql("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?", v, v, id); return id; };
const pTemp = policy("Refrigerator Temperature Monitoring", "approved", "2099-01-01", { doc_number: "LAB-101" }), pLate = policy("Hemolysis Index", "expired", "2026-01-15", { doc_number: "LAB-330" });
policy("Performance Verification", "approved", "2099-01-01", { doc_number: "LAB-202", description: "Meets 42 CFR 493.1253" });
const pRev = policy("Centrifuge Maintenance", "approved", "2099-01-01", { doc_number: "LAB-404" });
sql("UPDATE policy_documents SET status = 'draft', current_version_id = ? WHERE id = ?", docFile(pRev, 2, "Draft two"), pRev);
// A finished scan to begin from
const src = (await call("POST", `/api/labs/${A}/veritascan/scans`, { name: "Annual 2025" }, editor.token)).body.id;
await call("PUT", `/api/labs/${A}/veritascan/scans/${src}/items`, { items: [...Array(173)].map((_, i) => ({ itemId: i + 1, status: i < 20 ? "Compliant" : i < 24 ? "N/A" : i < 27 ? "Needs Attention" : "Not Assessed", notes: i === 0 ? "Made-up: binder 3" : "", owner: i === 0 ? "Typed Owner" : "", dueDate: i === 24 ? "2026-12-15" : "" })) }, editor.token);

const browser = await chromium.launch();
const openAs = async (who, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page error", false, String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, u, l, dark]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); if (dark) { localStorage.setItem("theme", "dark"); localStorage.setItem("vite-ui-theme", "dark"); localStorage.setItem("veritas-theme", "dark"); } }, [who.token, me, opts.lab ?? A, opts.colorScheme === "dark"]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  if (opts.colorScheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
const tid = (id) => `[data-testid="${id}"]`;
const text = async (page, s) => (await page.locator(s).first().innerText()).replace(/\s+/g, " ").trim();
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const choose = async (page, trigger, option) => { await page.click(tid(trigger)); await page.getByRole("option", { name: option, exact: true }).click(); };

// U1
let page = await openAs(editor, `/labs/${A}/veritaresponse/${f1}`);
await page.waitForSelector(tid("finding-assign"), { timeout: 20000 });
check("U1. a new finding is assigned to no one", (await text(page, tid("finding-assignee-name"))) === "no one");
await page.click(tid("finding-assign"));
await page.waitForSelector(tid(`assign-pick-${staff.id}`));
check("U1. the picker lists the lab's people and not the system's admin", (await page.locator(tid(`assign-pick-${owner.id}`)).count()) === 1 && (await page.locator(tid(`assign-pick-${leader.id}`)).count()) === 0);
await page.click(tid(`assign-pick-${staff.id}`));
check("U1. the card names the person", await until(async () => (await text(page, tid("finding-assignee-name"))) === "Stef Staff"));
check("U1. the history says so", await until(async () => /Assigned to Stef Staff/.test(await text(page, tid("finding-history")))));
await page.locator(tid("finding-assignee")).scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/b678_assign_light.png` });
await page.goto(`${BASE}/labs/${A}/veritaresponse`, { waitUntil: "networkidle" });
check("U1. the list's column names them", (await text(page, tid(`finding-assignee-${f1}`))) === "Stef Staff");
await page.click(tid("findings-mine"));
check("U1. Assigned to me is empty for the editor", await page.getByText("No findings are assigned to you.").isVisible());
page = await openAs(staff, `/labs/${A}/veritaresponse`);
await page.waitForSelector(tid("findings-mine"));
check("U1. the assignee's button counts it", (await text(page, tid("findings-mine"))) === "Assigned to me (1 open)");
await page.click(tid("findings-mine"));
check("U1. and the list shows theirs only, as You", (await page.locator("table tbody tr").count()) === 1 && (await text(page, tid(`finding-assignee-${f1}`))) === "You");
await page.goto(`${BASE}/labs/${A}/veritaresponse/${f1}`, { waitUntil: "networkidle" });
check("U1. a Staff login reads the assignment and can't change it", (await text(page, tid("finding-assignee-name"))) === "Stef Staff (you)" && (await page.locator(tid("finding-assign")).count()) === 0 && (await page.locator(tid("finding-assign-clear")).count()) === 0);

// U2
page = await openAs(editor, `/labs/${A}/veritascan-app/${src}`);
await page.waitForSelector(tid("item-assign-25"), { timeout: 20000 });
await page.click(tid("item-assign-25"));
await page.waitForSelector(tid(`assign-pick-${staff.id}`)); await page.click(tid(`assign-pick-${staff.id}`));
check("U2. the item shows the person", await until(async () => (await page.locator(tid("item-owner-25")).count()) === 1 && /Stef Staff/.test(await text(page, tid("item-owner-25")))));
const row26 = page.locator("div.px-3", { has: page.locator(tid("item-assign-26")) }).last();
await row26.locator('input[placeholder="Owner"]').fill("Typed Later");
check("U2. an auto-save afterwards keeps the person and saves the typed name", await until(() => sql("SELECT owner FROM veritascan_items WHERE scan_id = ? AND item_id = 26", src).owner === "Typed Later") && sql("SELECT owner_user_id AS u FROM veritascan_items WHERE scan_id = ? AND item_id = 25", src).u === staff.id);
page = await openAs(staff, `/labs/${A}/veritascan-app`);
await page.waitForSelector(tid("scan-assigned-to-me"), { timeout: 20000 });
check("U2. VeritaScan lists it under Assigned to me", /Assigned to me \(1\)/.test(await text(page, tid("scan-assigned-to-me"))) && /Annual 2025/.test(await text(page, tid("scan-assigned-to-me"))));
await page.click(tid(`assigned-${src}-25`));
await page.waitForSelector(tid("item-owner-25"));
check("U2. in the scan a Staff login sees it as theirs, with no way to reassign", /\(you\)/.test(await text(page, tid("item-owner-25"))) && (await page.locator(tid("item-reassign-25")).count()) === 0 && (await page.locator(tid("item-assign-26")).count()) === 0);
check("U2. and no bulk selecting, no review buttons", (await page.locator(tid("scan-select-toggle")).count()) === 0);
await page.click(tid("scan-show-mine"));
check("U2. the filter shows that item alone", await until(async () => (await page.locator('[data-testid^="item-owner-"]').count()) === 1));

// U3
page = await openAs(editor, `/labs/${A}/study/${good}/results`);
await page.waitForSelector(tid("lifecycle-panel"), { timeout: 20000 });
check("U3. a passing study offers nothing", (await page.locator(tid("study-finding-panel")).count()) === 0);
await page.goto(`${BASE}/labs/${A}/study/${bad}/results`, { waitUntil: "networkidle" });
await page.waitForSelector(tid("study-open-finding"), { timeout: 20000 });
const before = sql("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n;
await page.click(tid("study-open-finding"));
await page.waitForSelector(tid("study-open-finding-confirm"));
check("U3. nothing is made before the confirm", sql("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n === before);
await page.click(tid("study-open-finding-confirm"));
await page.waitForSelector(tid("finding-study"), { timeout: 20000 });
check("U3. it lands on the finding, which names the study", /Glucose, Calibration Verification \/ Linearity/.test(await text(page, tid("finding-study"))) && (await page.getByText("Internal Event").first().isVisible()));
await page.locator(`${tid("finding-study")} a`).click();
await page.waitForSelector(tid("study-finding-panel"), { timeout: 20000 });
check("U3. the study names the finding and offers no second one", /finding #\d+ \(Open\)/.test(await text(page, tid("study-finding-panel"))) && (await page.locator(tid("study-open-finding")).count()) === 0);

// U4
page = await openAs(editor, `/labs/${A}/veritascan-app`);
await page.getByRole("button", { name: "New Scan" }).first().click();
await page.getByPlaceholder("Scan name…").fill("Annual 2026");
await page.click(tid("new-scan-from")); await page.getByRole("option", { name: /Annual 2025/ }).click();
await page.waitForSelector(tid("carry-count"));
check("U4. Compliant and N/A are ticked to start with: 24 of 27", await until(async () => (await text(page, tid("carry-count"))) === "24 of 27 ticked"), await text(page, tid("carry-count")));
await page.click(tid("carry-item-25"));
check("U4. ticking one more is 25", (await text(page, tid("carry-count"))) === "25 of 27 ticked" && (await text(page, tid("new-scan-create"))) === "Create Scan with 25 carried");
await page.click(tid("new-scan-create"));
await page.waitForSelector(tid("carried-1"), { timeout: 20000 });
const dst = Number(page.url().split("/").pop());
check("U4. the item says where it was carried from and that nobody has reviewed it", /^Carried from Annual 2025, \d{4}-\d{2}-\d{2}, not yet reviewed\. Answer there: Compliant/.test(await text(page, tid("carried-1"))), await text(page, tid("carried-1")));
check("U4. the header counts 25 carried and 0 assessed, and the score is blank", (await text(page, tid("carried-count"))) === "25 carried, not reviewed" && (await page.getByText("0/173 assessed").first().isVisible()) && (await page.locator("aside .text-3xl").innerText()).trim() === "-");
await page.screenshot({ path: `${OUT}/b678_carried_light.png` });
await page.click(tid("carried-confirm-1"));
check("U4. reviewing one: the banner goes, 1 assessed, and the server has who and when", await until(() => !!sql("SELECT carried_reviewed_at AS r FROM veritascan_items WHERE scan_id = ? AND item_id = 1", dst).r) && sql("SELECT carried_reviewed_by_user_id AS u FROM veritascan_items WHERE scan_id = ? AND item_id = 1", dst).u === editor.id && (await page.locator(tid("carried-1")).count()) === 0 && (await page.getByText("1/173 assessed").first().isVisible()));
check("U4. the score is 1 of the whole checklist", (await page.locator("aside .text-3xl").innerText()).trim() === "1%");
await page.click(tid("carried-clear-2"));
check("U4. setting one aside leaves it Not Assessed, with no banner", await until(() => { const r = sql("SELECT status, carried_reviewed_at AS r FROM veritascan_items WHERE scan_id = ? AND item_id = 2", dst); return r.status === "Not Assessed" && !!r.r; }) && (await page.locator(tid("carried-2")).count()) === 0);
await page.click(tid("scan-show-carried"));
check("U4. the filter shows the 23 left", await until(async () => (await page.locator('[data-testid^="carried-"][data-testid$="0"], [data-testid^="carried-confirm-"]').count()) >= 23) && /\(23\)/.test(await text(page, tid("scan-show-carried"))));
await page.click(tid("scan-show-all"));

// U5
await page.click(tid("scan-select-toggle"));
for (const i of [100, 101, 102]) await page.click(tid(`select-item-${i}`));
check("U5. the bar counts what is selected", (await text(page, tid("bulk-count"))) === "3 selected");
await page.click(tid("bulk-open"));
await choose(page, "bulk-status", "Needs Attention"); await choose(page, "bulk-owner", "A typed name"); await page.fill(tid("bulk-typed"), "Bench lead");
await choose(page, "bulk-due", "Set a date"); await page.fill(tid("bulk-due-date"), "2027-01-15");
check("U5. the confirm names the count", /This changes 3 items\./.test(await text(page, tid("bulk-confirm-text"))) && (await text(page, tid("bulk-set-confirm"))) === "Set 3 items");
await page.click(tid("bulk-set-confirm"));
check("U5. the three are set on the server, each with its own audit row", await until(() => sql("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ? AND item_id IN (100, 101, 102) AND status = 'Needs Attention' AND owner = 'Bench lead' AND due_date = '2027-01-15'", dst).n === 3) && sql("SELECT COUNT(DISTINCT entity_id) AS n FROM audit_log WHERE entity_type = 'veritascan_item' AND entity_label LIKE '%set with 3 items'").n === 3);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(tid("item-assign-100"));
check("U5. a reload shows them", (await page.locator('input[placeholder="Owner"]').evaluateAll((els) => els.filter((e) => e.value === "Bench lead").length)) === 3);

// U6
check("U6. an editor isn't offered another lab", (await page.locator(tid("copy-to-lab")).count()) === 0);
page = await openAs(leader, `/labs/${A}/veritascan-app/${src}`);
await page.waitForSelector(tid("copy-to-lab"), { timeout: 20000 });
await page.click(tid("copy-to-lab"));
await page.waitForSelector(tid("carry-count"));
await until(async () => (await text(page, tid("carry-count"))) === "24 of 27 ticked");
check("U6. the button says how many and where", (await text(page, tid("copy-confirm"))) === "Copy 24 answers to Birch Point Lab", await text(page, tid("copy-confirm")));
await page.click(tid("copy-confirm"));
await page.waitForURL(new RegExp(`/labs/${B}/veritascan-app/\\d+$`), { timeout: 20000 });
await page.waitForSelector(tid("carried-1"), { timeout: 20000 });
check("U6. it opens the new scan in the other lab, marked with the lab it came from", /^Carried from Annual 2025, Alder Creek Lab, /.test(await text(page, tid("carried-1"))), await text(page, tid("carried-1")));

// U7
page = await openAs(editor, `/labs/${A}/veritascan-app/${src}`);
await page.waitForSelector(tid("evidence-add-21"), { timeout: 20000 });
for (const [item, d] of [[21, pTemp], [22, pLate], [23, pRev]]) {
  await page.click(tid(`evidence-add-${item}`));
  await page.waitForSelector(tid(`evidence-pick-dc-${d}`)); await page.click(tid(`evidence-pick-dc-${d}`));
  await until(() => sql("SELECT COUNT(*) AS n FROM veritascan_item_policy_links WHERE checklist_item_id = ? AND document_id = ?", item, d).n === 1);
}
const link = sql("SELECT id FROM veritascan_item_policy_links WHERE document_id = ?", pTemp).id;
await page.waitForSelector(tid(`evidence-open-dc-${link}`));
check("U7. the item shows the document, and one past review says so", /LAB-101 Refrigerator Temperature Monitoring/.test(await text(page, tid(`evidence-open-dc-${link}`))) && (await page.getByText(/\(Past review, due /).first().isVisible()));
await page.click(tid(`evidence-open-dc-${link}`));
await page.waitForSelector(tid("linked-doc-html"), { timeout: 20000 });
check("U7. it opens here in the app, read through VeritaDC", /Made-up procedure text\./.test(await page.frameLocator(tid("linked-doc-html")).locator("body").innerText()) && sql("SELECT COUNT(*) AS n FROM policy_audit_log WHERE document_id = ? AND action = 'viewed'", pTemp).n >= 1);
await page.goto(`${BASE}/labs/${A}/veritascan/inspection-proof`, { waitUntil: "networkidle" });
await page.waitForSelector(tid(`proof-open-dc-${link}`), { timeout: 20000 });
const late = sql("SELECT id FROM veritascan_item_policy_links WHERE document_id = ?", pLate).id;
check("U7. Inspection Proof lists both, flags the late one, and the item reads Review Overdue", /^Past review, due /.test(await text(page, tid(`proof-flag-${late}`))) && /Review Overdue/.test(await text(page, tid("row-item-22"))) && /Covered/.test(await text(page, tid("row-item-21"))) && (await page.locator(tid(`proof-flag-${link}`)).count()) === 0);
await page.locator(tid("row-item-22")).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/b678_documents_light.png` });
// A view-only reviewer opens the approved version of a document whose revision is a draft.
page = await openAs(reviewer, `/labs/${A}/veritascan/inspection-proof`);
const revLink = sql("SELECT id FROM veritascan_item_policy_links WHERE document_id = ?", pRev).id;
await page.waitForSelector(tid(`proof-open-dc-${revLink}`), { timeout: 20000 });
await page.click(tid(`proof-open-dc-${revLink}`));
await page.waitForSelector(tid("linked-doc-html"), { timeout: 20000 });
check("U7. a view-only reviewer opens the approved version while a revision is a draft", /Centrifuge Maintenance/.test(await page.frameLocator(tid("linked-doc-html")).locator("body").innerText()) && !/Draft two/.test(await page.frameLocator(tid("linked-doc-html")).locator("body").innerText()) && (await page.getByText("A revision is in progress. This is the approved version.").isVisible()));

// U8
page = await openAs(editor, `/labs/${A}/veritaresponse/${f1}`);
await page.waitForSelector(tid("finding-doc-suggestions"), { timeout: 20000 });
check("U8. suggestions say why, and nothing is linked", /Names 493\.1253/.test(await text(page, tid("finding-doc-suggestions"))) && /Title shares: refrigerator, temperature/.test(await text(page, tid("finding-doc-suggestions"))) && (await page.getByText("No documents linked yet.").isVisible()) && sql("SELECT COUNT(*) AS n FROM finding_policy_links").n === 0);
await page.click(tid(`finding-doc-link-${pTemp}`));
check("U8. a click links it", await until(() => sql("SELECT COUNT(*) AS n FROM finding_policy_links WHERE finding_id = ? AND document_id = ?", f1, pTemp).n === 1));
await page.waitForSelector(tid(`finding-doc-unlink-${pTemp}`));
await page.locator(tid("finding-documents")).scrollIntoViewIfNeeded();
await page.click(tid(`finding-doc-open-${pTemp}`));
await page.waitForSelector(tid("linked-doc-html"), { timeout: 20000 });
check("U8. and opens from the finding", /Made-up procedure text\./.test(await page.frameLocator(tid("linked-doc-html")).locator("body").innerText()));
await page.keyboard.press("Escape");
await page.goto(`${BASE}/labs/${A}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
const docRow = page.locator("tr", { hasText: "Refrigerator Temperature Monitoring" }).first();
await docRow.waitFor({ timeout: 20000 });
await docRow.getByRole("button", { name: "View" }).first().click();
const linkedFrom = page.locator(tid("document-linked-from"));
check("U8. the document names the finding and the checklist item", await until(async () => (await linkedFrom.count()) === 1 && /VeritaResponse™ finding D5411/.test(await text(page, tid("document-linked-from"))) && /VeritaScan® item:/.test(await text(page, tid("document-linked-from"))), 12000), (await linkedFrom.count()) ? await text(page, tid("document-linked-from")) : "not shown");

// U9
for (const [name, p, sel] of [["scan", `/labs/${A}/veritascan-app/${dst}`, "scan-show"], ["finding", `/labs/${A}/veritaresponse/${f1}`, "finding-documents"], ["proof", `/labs/${A}/veritascan/inspection-proof`, `proof-open-dc-${link}`]]) {
  page = await openAs(editor, p, { colorScheme: "dark" });
  await page.waitForSelector(tid(sel), { timeout: 20000 });
  await page.locator(tid(sel)).first().scrollIntoViewIfNeeded();
  if (name === "proof") { await page.locator(tid("row-item-22")).scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/b678_documents_dark.png` }); }
  check(`U9. ${name}: dark mode shows`, await page.evaluate(() => document.documentElement.classList.contains("dark")));
  page = await openAs(editor, p, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector(tid(sel), { timeout: 20000 });
  check(`U9. ${name}: no sideways scroll at phone width`, (await sideways(page)) <= 1, `${await sideways(page)}px`);
}
page = await openAs(editor, `/labs/${A}/veritascan-app/${dst}`, { colorScheme: "dark" });
await page.waitForSelector(tid("carried-3"), { timeout: 20000 });
await page.screenshot({ path: `${OUT}/b678_carried_dark.png` });
page = await openAs(editor, `/labs/${A}/veritaresponse/${f1}`, { colorScheme: "dark" });
await page.waitForSelector(tid("finding-assignee"), { timeout: 20000 });
check("U9. the assignment shows in dark mode", (await text(page, tid("finding-assignee-name"))) === "Stef Staff");
await page.screenshot({ path: `${OUT}/b678_assign_dark.png` });

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
