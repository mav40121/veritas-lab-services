// scripts/verify-competency-checklist-ui.mjs
//
// Browser receipt for BUG-064 (Michael 2026-10-16: "In the non-technical competency it appears we can no
// longer edit the checklists?" / "I'm telling you I could not edit"). LOCAL server + scratch DB only
// (accounts, lab and records are local test data). Drives the real screens:
//   1. Header "Non-technical competency", department Manual Procedures: the starting checklist is the
//      general one (not Chemistry's analyzer list) and can be changed before Continue
//   2. Continue opens the assessment form with the changed checklist
//   3. Overview tab: Edit checklist, reword, reorder, remove, add past Z (AA), Save; survives a reload
//   4. An unsigned assessment reopened with Edit shows its saved dates and initials (they loaded blank)
//   5. light, dark and 390px; no horizontal page scroll; no item box cuts its text off
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-checklist-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const PW = ["Zq", "list", "7x!"].join("-");
const stamp = Date.now();
const email = `checklist-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id, token = reg.body?.token, user = reg.body?.user;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
});
check("0. QA owner and lab on the scratch DB", !!uid && !!lab && !!token);

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const clipped = (page) => page.getByTestId("checklist-editor").locator("textarea").evaluateAll((els) => els.filter((e) => e.scrollHeight > e.clientHeight + 2).length);
const rowsText = async (page) => (await page.getByTestId("checklist-editor").locator("textarea").evaluateAll((els) => els.map((e) => e.value)));

let programId = null;
// 1-2) Header shortcut: the starting checklist, changed before Continue.
{
  const { ctx, page } = await signedIn("light", 1280);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId("quick-nontechnical").click();
  await page.getByTestId("quick-department").click();
  await page.getByRole("option", { name: "Manual Procedures", exact: true }).click();
  const box = page.getByTestId("quick-checklist");
  await box.waitFor({ timeout: 10000 });
  const summary = await box.innerText();
  check("1a. Manual Procedures starts from the general checklist, not Chemistry's analyzer list", summary.includes("Checklist: 6 items") && summary.includes("Tour Department, Policies and Procedures, Quality Control, Maintenance") && !summary.includes("Analyzer"), summary.replace(/\s+/g, " ").slice(0, 200));
  await page.getByTestId("quick-checklist-toggle").click();
  const ta = page.getByTestId("checklist-editor").locator("textarea");
  await ta.nth(0).fill("Tour Department, including the manual procedures bench");
  await page.getByTestId("checklist-add-item").click();
  await ta.nth(6).fill("Read and sign the manual procedures manual");
  check("1b. Continue is held while an item is blank", await (async () => { await page.getByTestId("checklist-add-item").click(); const off = await page.getByTestId("quick-continue").isDisabled(); await page.getByRole("button", { name: "Remove item H" }).click(); return off && !(await page.getByTestId("quick-continue").isDisabled()); })());
  check("1c. a wrapped item shows its whole text in the editor", (await clipped(page)) === 0);
  await page.getByTestId("quick-dialog-nontechnical").screenshot({ path: `${OUT}/checklist-quick-dialog-light.png` });
  await page.getByTestId("quick-continue").click();
  await page.waitForURL(/\/veritacomp-app\/\d+/, { timeout: 15000 });
  programId = Number(page.url().match(/veritacomp-app\/(\d+)/)[1]);
  await page.getByText("Non-Technical Checklist Items").waitFor({ timeout: 15000 });
  const form = await page.locator("table").filter({ hasText: "Date Met" }).first().innerText();
  check("2a. the assessment form opens with the changed checklist (7 items)", form.includes("Tour Department, including the manual procedures bench") && form.includes("G.") && form.includes("Read and sign the manual procedures manual"), form.replace(/\s+/g, " ").slice(0, 200));
  await page.keyboard.press("Escape");
  await ctx.close();
}

// 3) Overview tab: edit an existing program's checklist.
{
  const { ctx, page } = await signedIn("light", 1280);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  const card = page.getByTestId("checklist-card");
  await card.waitFor({ timeout: 10000 });
  check("3a. the Overview tab shows the checklist with an Edit checklist button", (await card.innerText()).includes("Read and sign the manual procedures manual") && (await page.getByTestId("checklist-edit").count()) === 1);
  await card.screenshot({ path: `${OUT}/checklist-card-view-light.png` });
  await page.getByTestId("checklist-edit").click();
  const ta = page.getByTestId("checklist-editor").locator("textarea");
  await ta.nth(2).fill("Quality Control\nRun both levels and document before patient testing");
  await page.getByRole("button", { name: "Move item G up" }).click();
  await page.getByRole("button", { name: "Remove item D" }).click();
  for (let i = 0; i < 21; i++) {
    await page.getByTestId("checklist-add-item").click();
    await ta.last().fill(`Detailed step ${i + 1}`);
  }
  const labels = await page.getByTestId("checklist-editor-row").locator("span").allInnerTexts();
  check("3b. 27 items lettered A..Z then AA", labels.length === 27 && labels[25] === "Z." && labels[26] === "AA.", labels.slice(23).join(" "));
  await card.screenshot({ path: `${OUT}/checklist-card-edit-light.png` });
  await page.getByTestId("checklist-save").click();
  await page.getByTestId("checklist-list").waitFor({ timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
  const list = await page.getByTestId("checklist-list").innerText();
  const items = await page.getByTestId("checklist-list").locator("li").count();
  check("3c. after Save and a reload: 27 items, the reword, the line break, the move and the removal kept", items === 27 && list.includes("Run both levels and document before patient testing") && list.indexOf("Read and sign") < list.indexOf("Downtime operations") && !list.includes("Maintenance") && list.includes("AA."), `${items} items`);
  const db = scratch((d) => d.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ?").get(String(programId)).c);
  check("3d. the edit is in the audit log", db === 1, String(db));
  await ctx.close();
}

// 4) An unsigned assessment reopened with Edit keeps its saved dates and initials.
{
  const prog = (await call("GET", `/api/labs/${lab}/competency/programs/${programId}`, undefined, token, lab)).body;
  const emp = (await call("POST", `/api/labs/${lab}/competency/employees`, { name: "Casey Tech", title: "MLT", hireDate: "2026-01-05" }, token, lab)).body;
  const its = prog.checklistItems.map((c, i) => ({ itemLabel: c.label, itemDescription: c.description, ntItemLabel: c.label, ntItemDescription: c.description, ntDateMet: i < 3 ? "2026-10-14" : "", ntEmployeeInitials: i < 3 ? "CT" : "", ntSupervisorInitials: i < 3 ? "JE" : "", dateMet: i < 3 ? "2026-10-14" : "", employeeInitials: i < 3 ? "CT" : "", supervisorInitials: i < 3 ? "JE" : "", passed: i < 3 }));
  const a = await call("POST", `/api/labs/${lab}/competency/assessments`, { programId, employeeId: emp.id, assessmentType: "orientation", assessmentDate: "2026-10-14", evaluatorName: "Jordan Ellis", evaluatorTitle: "Technical Consultant", evaluatorInitials: "JE", competencyType: "nontechnical", status: "pass", items: its }, token, lab);
  check("4a. setup: an unsigned assessment with 3 items filled in", a.status === 200);
  const { ctx, page } = await signedIn("light", 1280);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Assessments" }).click();
  await page.getByTestId("edit-assessment").first().click();
  await page.getByText("Non-Technical Checklist Items").waitFor({ timeout: 10000 });
  const t = page.locator("table").filter({ hasText: "Date Met" }).first();
  const firstRow = await t.locator("tbody tr").first().locator("input").evaluateAll((els) => els.map((e) => e.value));
  check("4b. the reopened assessment shows item A's saved date and initials", firstRow.join("|") === "2026-10-14|CT|JE", firstRow.join("|"));
  const fourth = await t.locator("tbody tr").nth(3).locator("input").evaluateAll((els) => els.map((e) => e.value));
  check("4c. an item that was not done stays blank", fourth.join("|") === "||", fourth.join("|"));
  await page.screenshot({ path: `${OUT}/checklist-edit-assessment-light.png` });
  await ctx.close();
}

// 5) dark and 390px.
for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await signedIn(scheme, width);
  await page.goto(`${BASE}/labs/${lab}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  const card = page.getByTestId("checklist-card");
  await card.waitFor({ timeout: 10000 });
  await page.getByTestId("checklist-edit").click();
  await card.scrollIntoViewIfNeeded();
  check(`5. [${scheme} ${width}px] the checklist editor renders with no horizontal page scroll`, await noScroll(page));
  check(`5b. [${scheme} ${width}px] every item box shows its whole text (none cut off)`, (await clipped(page)) === 0, String(await clipped(page)));
  await card.screenshot({ path: `${OUT}/checklist-card-edit-${scheme}-${width}.png` });
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
