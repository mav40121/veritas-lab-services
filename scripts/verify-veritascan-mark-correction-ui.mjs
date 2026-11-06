// scripts/verify-veritascan-mark-correction-ui.mjs
// Gate 3 receipt for Michael Q189 = 1: what a lab sees on its scan after the mark correction. Run against a LOCAL production build on a scratch database, with made-up people (it registers people
// and writes to the scratch database, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5261 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritascan-mark-correction-ui.mjs
// In a real browser: the lab's own scan shows the marks as Compliant, a dry run changes nothing on the page, the write moves them to Not Assessed with the note readable in the Notes box, an item
// the lab had answered stays, and the lab can answer a corrected item and have it save. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5261", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `site-scanmarks-${name}.png`), fullPage: false, animations: "disabled" });
const call = async (method, p, body, token, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

// ── A made-up lab, with marks shaped like the old ones ───────────────────────
const stamp = Date.now();
const email = `scanmarks-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email, password: ["Scan", "marks", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Mark Lab", plan: "hospital" })).j.labId;
const scanId = (await call("POST", `/api/labs/${labId}/veritascan/scans`, { name: "Made-up Readiness Scan" }, owner.token, { "X-Active-Lab-Id": String(labId) })).j.id;
const MARK_AT = "2026-01-05T12:00:00.000Z";
const COMP_NOTE = "Auto-completed by VeritaComp™: technical assessment on 2026-01-05";
const CHECK_NOTE = "Auto-completed by VeritaCheck®: Made-up Sodium on 2026-01-05";
const OWN_NOTE = "Our director reviewed the job descriptions.";
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999994' WHERE id = ?").run(labId);
  const userId = d.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
  const study = Number(d.prepare("INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id) VALUES ('Made-up Sodium', 'A', 'Made Up', '2026-01-05', 'cal_ver', 4, '[]', '[]', 'fail', ?, ?, ?)").run(MARK_AT, userId, labId).lastInsertRowid);
  const seed = d.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at) VALUES (?, ?, 'Compliant', ?, ?, ?, ?, ?)");
  seed.run(scanId, 64, COMP_NOTE, "veritacomp_auto", "/veritacomp-app", COMP_NOTE, MARK_AT);
  seed.run(scanId, 21, CHECK_NOTE, "veritacheck_auto", `/study/${study}/results`, CHECK_NOTE, MARK_AT);
  seed.run(scanId, 65, OWN_NOTE, "veritacomp_auto", "/veritacomp-app", COMP_NOTE, MARK_AT); // the lab's own words on a mark: this one stays
});
const itemsApi = async () => (await call("GET", `/api/labs/${labId}/veritascan/scans/${scanId}/items`, undefined, owner.token, { "X-Active-Lab-Id": String(labId) })).j;
const itemOf = (rows, id) => rows.find((r) => r.item_id === id) || {};

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  return page;
};
const scanUrl = `${BASE}/labs/${labId}/veritascan-app/${scanId}`;
// The row for an item, found by its question text: the screen numbers items within a domain, not by item id.
const QUESTIONS = { 64: /attestation/i, 65: /Job descriptions/i, 21: /Calibration verification performed at least every 6 months/i };
const rowOf = (page, id) => page.locator("div.rounded-lg.mb-1").filter({ hasText: QUESTIONS[id] }).first();
const openScan = async (page) => {
  await page.goto(scanUrl, { waitUntil: "networkidle" });
  await page.getByText("Made-up Readiness Scan").first().waitFor({ state: "attached", timeout: 20000 }); // the sidebar holding it is hidden on a phone
  for (const domain of ["Personnel", "Calibration"]) {
    const header = page.getByRole("button", { name: new RegExp(domain, "i") }).first();
    if (await header.count()) { const ready = await rowOf(page, domain === "Personnel" ? 64 : 21).count(); if (!ready) await header.click(); }
  }
};
const notesText = async (page, id) => {
  const row = rowOf(page, id);
  await row.getByRole("button", { name: /Notes/ }).first().click();
  const box = row.locator("textarea").first();
  await box.waitFor({ timeout: 10000 });
  return box.inputValue();
};

// ── Before ───────────────────────────────────────────────────────────────────
const page = await open();
await openScan(page);
check("before: the mark shows Compliant on the lab's scan", itemOf(await itemsApi(), 64).status === "Compliant");
check("before: the row is on the screen", (await rowOf(page, 64).count()) === 1);
await rowOf(page, 64).scrollIntoViewIfNeeded();
await shot(page, "before");

// ── The dry run ──────────────────────────────────────────────────────────────
const dry = await call("POST", "/api/admin/veritascan/correct-auto-marks", { dryRun: true }, null, { "x-admin-secret": ADMIN });
check("dry run: counts two marks to move in this lab", dry.s === 200 && dry.j.total_to_move === 2 && dry.j.by_lab?.find((l) => l.lab_id === labId)?.veritacomp === 1 && dry.j.by_lab?.find((l) => l.lab_id === labId)?.veritacheck === 1, JSON.stringify(dry.j).slice(0, 240));
check("dry run: no names in the answer", !/Made|example\.test|Auto-completed/.test(JSON.stringify(dry.j)));
check("dry run: the lab's scan hasn't changed", itemOf(await itemsApi(), 64).status === "Compliant" && itemOf(await itemsApi(), 21).status === "Compliant");

// ── The write ────────────────────────────────────────────────────────────────
const refused = await call("POST", "/api/admin/veritascan/correct-auto-marks", { dryRun: false }, null, { "x-admin-secret": ADMIN });
check("a write with no count is refused", refused.s === 409 && refused.j.code === "COUNT_CHANGED");
const wrote = await call("POST", "/api/admin/veritascan/correct-auto-marks", { dryRun: false, expectedTotal: 2 }, null, { "x-admin-secret": ADMIN });
check("the write moves what the dry run counted", wrote.s === 200 && wrote.j.changed === 2 && wrote.j.remaining === 0, JSON.stringify(wrote.j).slice(0, 200));
await openScan(page);
const comp = await notesText(page, 64);
check("after: the VeritaComp item's note is in the Notes box", /^Veritas Lab Services moved this item back to Not Assessed on \d{4}-\d{2}-\d{2}\. VeritaComp™ had marked it Compliant automatically/.test(comp) && /Please review it and enter your answer\.$/.test(comp), comp);
check("after: the note has no em dash", !/—/.test(comp));
await rowOf(page, 64).scrollIntoViewIfNeeded();
await shot(page, "after");
const checkNote = await notesText(page, 21);
check("after: the VeritaCheck item's note says the study didn't support it", /VeritaCheck® had marked it Compliant automatically from a study that was a draft or did not pass/.test(checkNote), checkNote);
const rows = await itemsApi();
check("after: both read Not Assessed", itemOf(rows, 64).status === "Not Assessed" && itemOf(rows, 21).status === "Not Assessed");
check("after: the study's link is gone from the item", itemOf(rows, 21).completion_link === null && itemOf(rows, 21).completion_source === "admin_correction");
check("after: the VeritaCheck auto-complete box no longer shows on the item", !(await rowOf(page, 21).innerText()).includes("Auto-completed"));
check("after: the item the lab had written on stays Compliant, with its words", itemOf(rows, 65).status === "Compliant" && itemOf(rows, 65).notes === OWN_NOTE, JSON.stringify(itemOf(rows, 65)));

// ── The lab answers a corrected item ─────────────────────────────────────────
const saves = [];
page.on("response", async (r) => { if (r.request().method() === "PUT" && /\/items/.test(r.url())) saves.push(`${r.status()} ${(await r.text().catch(() => "")).slice(0, 160)}`); });
const row64 = rowOf(page, 64);
await row64.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Needs Attention" }).click();
await page.waitForTimeout(3000); // the auto-save waits 1.5 seconds after the last change
await shot(page, "answering");
check("the screen's auto-save goes through, sending every item in the scan", saves.length === 1 && /^200 .*"count":173/.test(saves[0]), JSON.stringify(saves));
const answered = itemOf(await itemsApi(), 64);
check("the lab can answer a corrected item, and it saves", answered.status === "Needs Attention", JSON.stringify(answered).slice(0, 200));
const unmoved = itemOf(await itemsApi(), 21);
check("that auto-save leaves the other corrected item as it was", unmoved.status === "Not Assessed" && unmoved.completion_source === "admin_correction", JSON.stringify(unmoved).slice(0, 200));

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await openScan(dark);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
const darkNote = await notesText(dark, 21);
check("dark: the note reads", /moved this item back/.test(darkNote));
await rowOf(dark, 21).scrollIntoViewIfNeeded();
await shot(dark, "after-dark");
const phone = await open({ viewport: { width: 390, height: 844 } });
await openScan(phone);
const phoneNote = await notesText(phone, 21);
check("phone: the note reads", /moved this item back/.test(phoneNote));
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await rowOf(phone, 21).scrollIntoViewIfNeeded();
await shot(phone, "after-phone");
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
