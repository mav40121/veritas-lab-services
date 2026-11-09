// scripts/verify-veritatrack-signoff-log-ui.mjs
//
// Browser receipt for the VeritaTrack sign-off log and the void rule (Michael 2026-11-09: "Does veritatrack hold a log of
// all historical sign offs and is it available to customers?"). On a local production build with a scratch DB, a made-up
// owner and lab and two made-up tasks:
//   L1. VeritaTrack opens; the owner records four sign-offs through the Sign Off dialog
//   L2. removing a task: the confirm box says the task leaves the active list and its history stays on the Sign-off log
//   L3. the Sign-off log lists every sign-off, the removed task labeled Removed, a pre-audit row (seeded in the scratch DB)
//       and a pre-rule deletion (an audit row seeded in the scratch DB) labeled Deleted before the void rule
//   L4. Void needs a reason; once voided the row stays, marked Voided with the reason, and the task's Due next moves back
//   L5. the date filter narrows the list and Clear filters brings it back
//   L6. Export Excel downloads a workbook: About first, a Sign-off Log sheet with one row per entry, voided and removed marked
//   L7. print: only the log's print area shows, black on white, every row on it
//   L8. the task's History names the void
//   L9. dark mode (colorScheme 'dark') and phone width: readable, no sideways scroll
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritatrack-signoff-log-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token, labId) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Track", "Log", "77!"].join("-");
const stamp = Date.now();

// A made-up owner and lab on the scratch DB
const email = `vtlog-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sign-off Log Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = 'Sign-off Log Test Lab', clia_number = '22D7792001' WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const T = `/api/labs/${labId}/veritatrack/tasks`;
const taskA = (await call("POST", T, { name: "Monthly QC review (made-up)", category: "QC Review", frequency: "Monthly" }, token, labId)).body;
const taskB = (await call("POST", T, { name: "Pipette calibration (made-up)", category: "Equipment Calibration", frequency: "Annual" }, token, labId)).body;
// A row from before the audit trail (no audit row, no lab_id) and a deletion the old DELETE wrote, both on the scratch DB only
const oldId = Number(sql("INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, initials, performed_by, notes, created_at) VALUES (?, ?, '2026-03-02', 'OT', 'Old Timer', 'Before the audit trail', '2026-03-02 14:00:00')", taskA.id, ownerId));
sql("INSERT INTO veritatrack_audit (lab_id, task_id, signoff_id, event, detail, by_user_id, at) VALUES (?, ?, 990001, 'signoff_deleted', 'Removed sign-off dated 2026-05-15 (Dana Deleted)', ?, '2026-06-20 12:00:00')", labId, taskA.id, ownerId);

const browser = await chromium.launch();
const openAs = async (path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const TRACK = `/labs/${labId}/veritatrack-app`;
const rowOf = (page, name) => page.locator("div.group").filter({ hasText: name }).first();
const openGroup = async (page, category) => {
  const header = page.getByRole("button", { name: new RegExp(`^${category}`) }).first();
  const already = await page.locator("div.group").filter({ hasText: category === "QC Review" ? "Monthly QC review" : "Pipette calibration" }).first().isVisible().catch(() => false);
  if (!already) await header.click();
};
const signOff = async (page, taskName, category, date, initials, performer, notes) => {
  await openGroup(page, category);
  const row = rowOf(page, taskName);
  await row.hover();
  await row.getByTestId("signoff-button").first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByTestId("signoff-date").fill(date);
  await dlg.getByTestId("signoff-initials").fill(initials);
  await dlg.getByTestId("signoff-performer").fill(performer);
  await dlg.getByTestId("signoff-notes").fill(notes);
  await dlg.getByTestId("signoff-save").click();
  await dlg.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
};

// L1
const page = await openAs(TRACK);
await page.getByTestId("signoff-log-tab").waitFor({ timeout: 20000 });
check("L1a. VeritaTrack opens with a Sign-off log tab", await page.getByTestId("signoff-log-tab").isVisible());
await signOff(page, "Monthly QC review (made-up)", "QC Review", "2026-08-03", "PE", "Pat Example", "Lot 1 reviewed");
await signOff(page, "Monthly QC review (made-up)", "QC Review", "2026-09-03", "PE", "Pat Example", "Lot 2 reviewed");
await signOff(page, "Monthly QC review (made-up)", "QC Review", "2026-10-03", "SS", "Sam Sample", "Lot 3 reviewed");
await signOff(page, "Pipette calibration (made-up)", "Equipment Calibration", "2026-07-15", "RR", "Robin Remover", "Annual check");
const signed = (await call("GET", `/api/veritatrack/tasks/${taskA.id}`, undefined, token, labId)).body;
const idOn = (d) => signed.signoffs?.find((s) => s.completed_date === d)?.id;
check("L1b. the four sign-offs entered in the browser are saved", signed.signoffs?.length === 4 && !!idOn("2026-10-03") && !!idOn("2026-09-03") && !!idOn("2026-08-03"), `${signed.signoffs?.length}`);
const aRow = rowOf(page, "Monthly QC review (made-up)");
check("L1c. the task shows 10/03 as last performed", ((await aRow.textContent()) || "").includes("10/03/2026"));
await page.screenshot({ path: `${OUT}/vtlog-tasks-light.png` });

// L2
await openGroup(page, "Equipment Calibration");
const bRow = rowOf(page, "Pipette calibration (made-up)");
await bRow.hover();
await bRow.getByTestId("task-remove-button").click();
const confirm = page.getByRole("dialog");
const confirmText = (await confirm.textContent()) || "";
check("L2a. the remove box says the task leaves the active list and its history stays on the Sign-off log",
  /Remove Task\?/.test(confirmText) && /from the active list/.test(confirmText) && /stays on the Sign-off log/.test(confirmText) && !/remove all sign-off history/i.test(confirmText), confirmText.slice(0, 200));
await page.screenshot({ path: `${OUT}/vtlog-remove-confirm.png` });
await confirm.getByRole("button", { name: "Remove", exact: true }).click();
await page.waitForTimeout(800);
check("L2b. the task leaves the active list", !(await page.getByText("Pipette calibration (made-up)").isVisible().catch(() => false)));

// L3
await page.getByTestId("signoff-log-tab").click();
await page.getByTestId("log-table").waitFor({ timeout: 15000 });
const logApi = (await call("GET", `/api/labs/${labId}/veritatrack/signoff-log`, undefined, token, labId)).body;
const tableRows = page.locator('[data-testid^="log-row-"]');
check("L3a. every entry has a row on screen", (await tableRows.count()) === logApi.rows.length && logApi.rows.length === 6, `${await tableRows.count()} rows, ${logApi.rows.length} in the log`);
const tableText = (await page.getByTestId("log-table").textContent()) || "";
for (const [label, needle] of [["the 08/03 sign-off", "08/03/2026"], ["the 09/03 sign-off", "09/03/2026"], ["the 10/03 sign-off", "10/03/2026"], ["the pre-audit row", "Old Timer"], ["notes", "Lot 2 reviewed"], ["the recorder", "Riley Owner"]]) {
  check(`L3b. the log shows ${label}`, tableText.includes(needle));
}
const removedRow = page.locator(`[data-testid="log-row-s${logApi.rows.find((r) => r.task_name === "Pipette calibration (made-up)")?.signoff_id}"]`);
check("L3c. the removed task's sign-off is labeled Removed", ((await removedRow.getByTestId("log-removed-badge").textContent().catch(() => "")) || "") === "Removed");
const deletedRow = page.locator('[data-testid="log-row-d' + logApi.rows.find((r) => r.entry === "deleted_before_void_rule")?.key.slice(1) + '"]');
const deletedText = (await deletedRow.textContent().catch(() => "")) || "";
check("L3d. the pre-rule deletion shows, labeled, with its date and performer", /Deleted before the void rule/.test(deletedText) && deletedText.includes("05/15/2026") && deletedText.includes("Dana Deleted"), deletedText.slice(0, 200));
check("L3e. the counts line adds up", ((await page.getByTestId("log-counts").textContent()) || "").startsWith("6 entries: 5 recorded, 0 voided, 1 deleted before the void rule"));

// L4
const octId = idOn("2026-10-03");
await page.getByTestId(`log-void-${octId}`).click();
const vd = page.getByTestId("void-dialog");
await vd.waitFor({ timeout: 10000 });
check("L4a. Void can't be saved without a reason", await vd.getByTestId("void-save").isDisabled());
await vd.getByTestId("void-reason").fill("Entered on the wrong task");
await page.screenshot({ path: `${OUT}/vtlog-void-dialog.png` });
await vd.getByTestId("void-save").click();
await vd.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
const octRow = page.locator(`[data-testid="log-row-s${octId}"]`);
await octRow.getByTestId("log-voided-badge").waitFor({ timeout: 10000 }).catch(() => {});
const octText = (await octRow.textContent()) || "";
check("L4b. the voided row stays, marked Voided with the reason and who", /Voided/.test(octText) && octText.includes("Entered on the wrong task") && octText.includes("Riley Owner"), octText.slice(0, 220));
check("L4c. a voided row has no Void button", !(await page.getByTestId(`log-void-${octId}`).isVisible().catch(() => false)));
check("L4d. the row is still in the database, voided", !!sql("SELECT voided_at FROM veritatrack_signoffs WHERE id = ?", octId)?.voided_at);
await page.screenshot({ path: `${OUT}/vtlog-log-light.png`, fullPage: true });
await page.getByRole("button", { name: /List/ }).first().click();
await openGroup(page, "QC Review");
const aAfter = (await rowOf(page, "Monthly QC review (made-up)").textContent()) || "";
check("L4e. the task's last performed moves back to 09/03 and Due next to 10/03", aAfter.includes("09/03/2026") && aAfter.includes("10/03/2026"), aAfter.slice(0, 200));

// L8 (the History dialog, on the same task)
const hRow = rowOf(page, "Monthly QC review (made-up)");
await hRow.hover();
await hRow.getByTitle("History").click();
const hist = page.getByRole("dialog");
await hist.getByText("Sign-off voided").first().waitFor({ timeout: 10000 }).catch(() => {});
const histText = (await hist.textContent()) || "";
check("L8. the task's History names the void and its reason, and points to the Sign-off log", histText.includes("Sign-off voided") && histText.includes("Entered on the wrong task") && /on the Sign-off log/.test(histText), histText.slice(0, 240));
await page.keyboard.press("Escape");

// L5
await page.getByTestId("signoff-log-tab").click();
await page.getByTestId("log-table").waitFor({ timeout: 15000 });
await page.getByTestId("log-from").fill("2026-09-01");
await page.getByTestId("log-to").fill("2026-09-30");
await page.waitForTimeout(800);
const septCount = await page.locator('[data-testid^="log-row-"]').count();
check("L5a. a September range shows only the 09/03 sign-off", septCount === 1 && ((await page.getByTestId("log-table").textContent()) || "").includes("09/03/2026"), `${septCount}`);
await page.getByTestId("log-clear").click();
await page.waitForTimeout(800);
check("L5b. Clear filters brings every entry back", (await page.locator('[data-testid^="log-row-"]').count()) === 6);

// L6
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("log-export").click()]);
const xlsxPath = `${OUT}/${download.suggestedFilename()}`;
await download.saveAs(xlsxPath);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xlsxPath);
const ws = wb.getWorksheet("Sign-off Log");
const dataRows = [];
ws?.eachRow((row, n) => { if (n > 1) dataRows.push(row.values.slice(1)); });
check("L6a. the download is the sign-off log workbook", /^VeritaTrack_Signoff_Log_\d{4}-\d{2}-\d{2}\.xlsx$/.test(download.suggestedFilename()) && wb.worksheets[0]?.name === "About" && !!ws, download.suggestedFilename());
check("L6b. one Sign-off Log row per entry", dataRows.length === 6, `${dataRows.length}`);
check("L6c. the voided row carries Voided and the reason", dataRows.some((r) => r[0] === "2026-10-03" && r[10] === "Voided" && r[13] === "Entered on the wrong task"));
check("L6d. the removed task's row says Removed", dataRows.some((r) => r[1] === "Pipette calibration (made-up)" && r[4] === "Removed"));
check("L6e. the deletion row says Deleted before the void rule", dataRows.some((r) => r[10] === "Deleted before the void rule" && r[5] === "Dana Deleted"));
check("L6f. lab identity on the About and in the sheet's header", JSON.stringify(wb.getWorksheet("About")?.getSheetValues() || []).includes("Prepared for: Sign-off Log Test Lab    CLIA: 22D7792001") && String(ws?.headerFooter?.oddHeader || "").includes("Sign-off Log Test Lab    CLIA: 22D7792001"));

// L7
await page.emulateMedia({ media: "print" });
const printState = await page.evaluate(() => {
  const area = document.getElementById("compliance-print-area");
  const style = area ? getComputedStyle(area) : null;
  return { shown: !!style && style.display !== "none" && style.visibility === "visible", rows: area ? area.querySelectorAll("tbody tr").length : 0, color: style?.color, nav: (() => { const n = document.querySelector("nav"); return n ? getComputedStyle(n).visibility : "none"; })() };
});
check("L7a. printing shows the log's print area with every row", printState.shown && printState.rows === 6, JSON.stringify(printState));
check("L7b. the app's navigation does not print", printState.nav !== "visible", printState.nav);
await page.screenshot({ path: `${OUT}/vtlog-print.png`, fullPage: true });
await page.emulateMedia({ media: "screen" });

// L9
const dark = await openAs(TRACK, { colorScheme: "dark" });
await dark.getByTestId("signoff-log-tab").click();
await dark.getByTestId("log-table").waitFor({ timeout: 15000 });
const darkState = await dark.evaluate(() => {
  const ch = (c) => (c.match(/[\d.]+/g) || []).map(Number);
  const body = ch(getComputedStyle(document.body).backgroundColor);
  const name = document.querySelector('[data-testid^="log-row-"] td:nth-child(2) span');
  return { htmlDark: document.documentElement.classList.contains("dark"), body, text: name ? ch(getComputedStyle(name).color) : [] };
});
check("L9a. dark mode follows the system setting", darkState.htmlDark, JSON.stringify(darkState));
check("L9b. dark mode: light text on a dark page", darkState.body.length >= 3 && darkState.body[0] < 60 && darkState.text[0] > 150, JSON.stringify(darkState));
await dark.screenshot({ path: `${OUT}/vtlog-log-dark.png`, fullPage: true });
const phone = await openAs(TRACK, { viewport: { width: 390, height: 844 } });
await phone.getByTestId("signoff-log-tab").click();
await phone.getByTestId("log-cards").waitFor({ timeout: 15000 });
const fit = await phone.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth, cards: document.querySelectorAll('[data-testid="log-cards"] > div').length }));
check("L9c. on a phone the log shows as cards with no sideways scroll", fit.page <= 0 && fit.cards === 6, JSON.stringify(fit));
const phoneText = (await phone.getByTestId("log-cards").textContent()) || "";
check("L9d. the phone cards carry the Removed, Voided and Deleted labels", /Removed/.test(phoneText) && /Voided/.test(phoneText) && /Deleted before the void rule/.test(phoneText));
await phone.screenshot({ path: `${OUT}/vtlog-log-phone.png`, fullPage: true });

await browser.close();
fs.rmSync(xlsxPath, { force: true });
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
