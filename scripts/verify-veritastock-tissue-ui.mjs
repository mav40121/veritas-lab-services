// scripts/verify-veritastock-tissue-ui.mjs
// Gate 3 receipt for the VeritaStock tissue sub-module. Run against a LOCAL production build on a scratch database, with made-up people and tissue (it registers
// people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritastock-tissue-ui.mjs
// In a real browser: build the catalog, receive a unit, see a labeled MRN refused, get refused at issue on a no and on an expired unit, issue, implant, record the usage
// card, find it by tissue ID, close another unit as wasted, print the log, download the workbook, and see the unit on a recall. Light, dark and phone. On veritastock.com
// the button is gone and the page redirects.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Tissue", "made", "up", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shot = async (page, name, fullPage = false) => {
  // A full-page picture from the top, or the sticky header lands mid-page.
  if (fullPage) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); }
  await page.screenshot({ path: path.join(OUT, `site-tissue-${name}.png`), fullPage, animations: "disabled" });
};

// ── A made-up lab ────────────────────────────────────────────────────────────
const stamp = Date.now();
const ownerEmail = `tissue-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Hospital Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
});
const storage = (await call("POST", `/api/labs/${labId}/temp-logs/units`, { name: "Made-up BB Freezer", unit_type: "freezer", location: "Blood bank", min_value: -30, max_value: -18, scale: "C", readings_per_day: 1 }, owner.token)).j;
check("made-up lab and a temperature-logged freezer", !!labId && !!storage.id, JSON.stringify(storage).slice(0, 200));
const P = `${BASE}/labs/${labId}/veritastock/tissue`;
const today = new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const FUTURE = shift(400);

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (opts.stock) await page.addInitScript(() => { window.__STOCK_DEPLOYMENT__ = true; });
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  return page;
};
const page = await open();
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const tid = (p, id) => p.getByTestId(id);
// Polled from here: the enforced CSP refuses page.waitForFunction's eval, which is part of what this run checks.
const until = async (cond, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 200)); } return false; };
const errText = async (p) => (await tid(p, "tissue-error").first().waitFor({ timeout: 15000 }), tid(p, "tissue-error").first().innerText());

// ── The way in ───────────────────────────────────────────────────────────────
await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
const button = tid(page, "tissue-button");
await button.waitFor({ timeout: 20000 });
check("VeritaStock has a Tissue button", await button.isVisible());
await button.click();
await tid(page, "no-phi-banner").waitFor({ timeout: 15000 });
check("the page opens with the no-patient-information line", /No patient information/.test(await tid(page, "no-phi-banner").innerText()));

// ── The catalog ──────────────────────────────────────────────────────────────
await page.goto(`${P}?tab=catalog`, { waitUntil: "networkidle" });
const addCatalog = async (type, supplier) => {
  await tid(page, "catalog-type").fill(type);
  await tid(page, "catalog-supplier").fill(supplier);
  await tid(page, "catalog-add").click();
  await tid(page, "catalog-row").filter({ hasText: type }).waitFor({ timeout: 15000 });
};
await addCatalog("Made-up Bone Putty", "Made-up Tissue Bank");
await addCatalog("Made-up Dermis", "Made-up Tissue Bank");
await addCatalog("Made-up Tendon", "Made-up Graft Supplier");
await addCatalog("Made-up Typo Item", "Made-up Graft Supplier");
check("the lab builds its own catalog", (await tid(page, "catalog-row").count()) === 4);
await tid(page, "catalog-row").filter({ hasText: "Made-up Typo Item" }).getByTestId("catalog-delete").click();
await tid(page, "catalog-row").filter({ hasText: "Made-up Typo Item" }).waitFor({ state: "detached", timeout: 15000 });
check("a row no unit used can be deleted", (await tid(page, "catalog-row").count()) === 3);
await shot(page, "catalog");

// ── Receipt ──────────────────────────────────────────────────────────────────
const fillReceipt = async (p, { type, id, exp, by = "M. Handler" }) => {
  await p.goto(`${P}?new=1`, { waitUntil: "networkidle" });
  await tid(p, "catalog-select").selectOption({ label: type });
  await tid(p, "source-id").fill(id);
  await tid(p, "quantity-size").fill("5 cc");
  await tid(p, "expiration").fill(exp);
  await tid(p, "mm-date").fill(shift(-1));
  await tid(p, "mm-time").fill("09:00");
  await tid(p, "mm-by").fill(by);
  await tid(p, "bb-date").fill(shift(-1));
  await tid(p, "bb-time").fill("10:00");
  await tid(p, "bb-by").fill("B. Tech");
  await tid(p, "transport-temp-yes").check();
  await tid(p, "package-ok-yes").check();
  await tid(p, "storage-unit").selectOption({ label: "Made-up BB Freezer, Blood bank" });
};
await fillReceipt(page, { type: "Made-up Bone Putty (Made-up Tissue Bank)", id: "TIS-1001", exp: FUTURE });
const receiveText = await tid(page, "receive-form").innerText();
check("the form has no recipient or medical record field", !/recipient|medical record number$|MRN/im.test(receiveText.replace(/No patient information[^\n]*/g, "")), receiveText.slice(0, 400));
const inputLabels = await tid(page, "receive-form").locator("label, legend").allInnerTexts();
check("no label names a patient", !inputLabels.some((l) => /patient|recipient|medical record/i.test(l)), inputLabels.join(" | "));
check("every free-text box on the form carries the notice", (await tid(page, "receive-form").locator("textarea").count()) === 2 && (await tid(page, "receive-form").getByTestId("no-phi-notice").count()) === 2);
await shot(page, "receive", true);
await tid(page, "notes").fill("MRN: 1234567");
await tid(page, "save-receipt").click();
const phiErr = await errText(page);
check("a labeled MRN is refused with the reason", /looks like patient information \(medical record number\)/.test(phiErr), phiErr);
await tid(page, "notes").scrollIntoViewIfNeeded();
await shot(page, "phi-refused");
check("nothing saved on the refusal", scratch((d) => d.prepare("SELECT COUNT(*) n FROM tissue_units WHERE lab_id = ?").get(labId).n) === 0);
const platformWarning = page.getByText("This looks like patient information", { exact: true }); // the toast's title; the refusal above reads on past these words
check("the platform's warning shows too", (await platformWarning.count()) > 0);
await tid(page, "notes").fill("Arrived on dry ice");
await platformWarning.first().waitFor({ state: "hidden", timeout: 30000 }); // the warning stays 15 seconds
await tid(page, "save-receipt").click();
await tid(page, "tissue-unit").waitFor({ timeout: 15000 });
check("saved: the record opens, in storage", /In blood bank storage/.test(await tid(page, "unit-state").first().innerText()));
check("storage shows the temperature-logged freezer", /Made-up BB Freezer/.test(await tid(page, "tissue-unit").innerText()));
await shot(page, "unit-stored", true);

// ── Issue: refused, then done ────────────────────────────────────────────────
await tid(page, "issue-physician").fill("Dr. Made Up");
await tid(page, "issue-to").fill("C. Courier");
await tid(page, "issue-tech").fill("B. Tech");
await tid(page, "issue-delivered").fill("OR 4");
await tid(page, "readback-id-no").check();
await tid(page, "readback-exp-yes").check();
await tid(page, "readback-int-yes").check();
await tid(page, "save-issue").click();
const noErr = await errText(page);
check("a no on a read-back is refused with the reason", /Source ID read back and acceptable was answered no/.test(noErr), noErr);
await tid(page, "step-issue").scrollIntoViewIfNeeded();
await shot(page, "issue-refused");
await tid(page, "readback-id-yes").check();
await tid(page, "save-issue").click();
await tid(page, "step-implant").waitFor({ timeout: 15000 });
check("three yeses: the unit is issued", /Issued/.test(await tid(page, "unit-state").first().innerText()));

// ── Implant and the usage card ───────────────────────────────────────────────
await tid(page, "implant-time").fill("23:58");
await tid(page, "implant-by").fill("Dr. Surgeon");
await tid(page, "save-implant").click();
await tid(page, "step-usage-card").waitFor({ timeout: 15000 });
const implantedText = await tid(page, "tissue-unit").innerText();
check("implanted: final, with the surgeon and no patient", /Implanted/.test(await tid(page, "unit-state").first().innerText()) && /Dr. Surgeon/.test(implantedText));
check("the record points to the chart", /find this tissue ID in the hospital's chart/.test(implantedText));
check("no other step is offered on a final unit", (await tid(page, "step-issue").count()) === 0 && (await tid(page, "open-dispose").count()) === 0);
await tid(page, "usage-card-yes").check();
await tid(page, "usage-card-date").fill(today);
await tid(page, "save-usage-card").click();
await page.getByText(`Yes, ${today}`).first().waitFor({ timeout: 15000 });
check("the usage card reads yes and the date", true);
await shot(page, "unit-implanted", true);

// ── An expired unit, and a wasted one ────────────────────────────────────────
await fillReceipt(page, { type: "Made-up Dermis (Made-up Tissue Bank)", id: "TIS-EXPIRED", exp: shift(-1) });
await tid(page, "mm-date").fill(shift(-5));
await tid(page, "bb-date").fill(shift(-5));
await tid(page, "save-receipt").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });
check("an expired unit says so before anyone tries", await tid(page, "issue-expired-note").isVisible());
await tid(page, "issue-physician").fill("Dr. Made Up");
await tid(page, "issue-to").fill("C. Courier");
await tid(page, "issue-tech").fill("B. Tech");
await tid(page, "issue-delivered").fill("OR 4");
await tid(page, "readback-id-yes").check();
await tid(page, "readback-exp-yes").check();
await tid(page, "readback-int-yes").check();
await tid(page, "save-issue").click();
const expErr = await errText(page);
check("an expired unit can't be issued, with the reason", /expired on .* so it can't be issued/.test(expErr), expErr);
await tid(page, "step-issue").scrollIntoViewIfNeeded();
await shot(page, "issue-expired");
await tid(page, "open-dispose").click();
await tid(page, "dispose-by").fill("B. Tech");
await tid(page, "dispose-description").fill("Past expiration, discarded per procedure");
check("the disposition box carries the notice", (await tid(page, "step-dispose").getByTestId("no-phi-notice").count()) === 1);
check("an expired unit defaults to the expired disposition", (await tid(page, "dispose-kind").inputValue()) === "expired");
await tid(page, "save-dispose").click();
await tid(page, "step-dispose").waitFor({ state: "detached", timeout: 15000 });
check("recorded as expired: final, with the description on the record", /Expired/.test(await tid(page, "unit-state").first().innerText()) && /Past expiration, discarded per procedure/.test(await tid(page, "tissue-unit").innerText()));

await fillReceipt(page, { type: "Made-up Tendon (Made-up Graft Supplier)", id: "TIS-OPEN", exp: FUTURE });
await tid(page, "save-receipt").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });

// ── The log and lookup ───────────────────────────────────────────────────────
await page.goto(P, { waitUntil: "networkidle" });
await tid(page, "tissue-log-row").first().waitFor({ timeout: 15000 });
check("open shows only the unit with no final disposition", (await tid(page, "tissue-log-row").count()) === 1 && /TIS-OPEN/.test(await tid(page, "tissue-log-table").innerText()));
await shot(page, "log-open");
await tid(page, "tissue-filter-all").click();
await until(async () => (await tid(page, "tissue-log-row").count()) === 3);
const logText = await tid(page, "tissue-log-table").innerText();
check("all shows every unit once, with its status", /TIS-1001/.test(logText) && /TIS-EXPIRED/.test(logText) && /TIS-OPEN/.test(logText));
check("the log's headings name no patient", !/patient|recipient|medical record/i.test(await tid(page, "tissue-log-table").locator("thead").innerText()));
await shot(page, "log-all");
await tid(page, "tissue-lookup-input").fill("tis 1001");
await tid(page, "tissue-lookup-button").click();
await tid(page, "tissue-lookup-result").waitFor({ timeout: 15000 });
const lookText = await tid(page, "tissue-lookup-results").innerText();
check("lookup finds it however it's typed, with the implant and the way to the chart", /TIS-1001/.test(lookText) && /Dr. Surgeon/.test(lookText) && /OR 4/.test(lookText) && /hospital's chart/.test(lookText), lookText);
await tid(page, "tissue-lookup-input").scrollIntoViewIfNeeded();
await shot(page, "lookup");
await tid(page, "tissue-lookup-input").fill("NOT-THERE");
await tid(page, "tissue-lookup-button").click();
await tid(page, "tissue-lookup-none").waitFor({ timeout: 15000 });
check("lookup with no match says so", true);

// ── The printable log and the workbook ───────────────────────────────────────
const dl = async (testId, name) => {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), tid(page, testId).click()]);
  const file = path.join(OUT, name);
  await download.saveAs(file);
  return { file, suggested: download.suggestedFilename() };
};
const pdf = await dl("tissue-print", "site-tissue-log.pdf");
const pdfBytes = fs.readFileSync(pdf.file);
check("Print log downloads a PDF", pdfBytes.slice(0, 5).toString() === "%PDF-" && /VeritaStock_Tissue_Log_.*\.pdf/.test(pdf.suggested), pdf.suggested);
const xl = await dl("tissue-excel", "site-tissue-log.xlsx");
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(xl.file);
const heads = (wb.getWorksheet("Perpetual Log").getRow(1).values || []).filter(Boolean).map(String);
check("Excel downloads, About first, no patient column", wb.worksheets[0].name === "About" && heads.includes("Tissue ID") && !heads.some((h) => /patient|recipient|medical record/i.test(h)), heads.join("|"));
check("Excel has the three units on the all view", wb.getWorksheet("Perpetual Log").rowCount === 4, String(wb.getWorksheet("Perpetual Log").rowCount));

// ── A recall finds it ────────────────────────────────────────────────────────
const rc = (await call("POST", `/api/labs/${labId}/veritastock/recalls`, { notice_type: "recall", vendor: "Made-up Tissue Bank", product: "Made-up Bone Putty", lot_numbers: "TIS-1001", local_date: today }, owner.token)).j;
await page.goto(`${BASE}/labs/${labId}/veritastock/recalls?case=${rc.id}`, { waitUntil: "networkidle" });
await tid(page, "recall-tissue-match").waitFor({ timeout: 15000 });
const matchText = await tid(page, "recall-tissue-match").innerText();
check("the recall shows the implanted unit with its date and surgeon", /TIS-1001/.test(matchText) && /Implanted/.test(matchText) && /Dr. Surgeon/.test(matchText), matchText);
check("a tissue row has no Remove button", (await tid(page, "recall-tissue-match").getByRole("button", { name: "Remove" }).count()) === 0);
await tid(page, "recall-tissue-match").scrollIntoViewIfNeeded();
await shot(page, "recall");
await tid(page, "recall-tissue-open").click();
await tid(page, "tissue-unit").waitFor({ timeout: 15000 });
check("Open record goes to the unit", /TIS-1001/.test(await tid(page, "unit-source-id").innerText()));

// ── Correct and undo ─────────────────────────────────────────────────────────
await tid(page, "open-correct").click();
await tid(page, "correct-field").selectOption("quantity_or_size");
await tid(page, "correct-value").fill("7 cc");
await tid(page, "correct-reason").fill("Size misread at receipt");
await tid(page, "save-correct").click();
await tid(page, "unit-history").getByText("Size misread at receipt").waitFor({ timeout: 15000 });
check("a correction shows in the history with its reason", true);
await shot(page, "correct", true);
const openUnitUrl = P;
await page.goto(openUnitUrl, { waitUntil: "networkidle" });

// ── Dark ─────────────────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(P, { waitUntil: "networkidle" });
await tid(dark, "tissue-filter-all").click();
await until(async () => (await tid(dark, "tissue-log-row").count()) === 3);
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "log-dark");
await dark.goto(`${P}?new=1`, { waitUntil: "networkidle" });
await tid(dark, "receive-form").waitFor({ timeout: 15000 });
await shot(dark, "receive-dark", true);
const firstUnit = scratch((d) => d.prepare("SELECT id FROM tissue_units WHERE lab_id = ? AND source_id = 'TIS-OPEN'").get(labId)).id;
await dark.goto(`${P}?unit=${firstUnit}`, { waitUntil: "networkidle" });
await tid(dark, "step-issue").waitFor({ timeout: 15000 });
await shot(dark, "unit-dark", true);

// ── Phone ────────────────────────────────────────────────────────────────────
const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.goto(P, { waitUntil: "networkidle" });
await tid(phone, "tissue-log-card").first().waitFor({ timeout: 15000 });
check("phone: the log is cards, with no sideways scroll", await noSideways(phone));
await shot(phone, "log-phone");
await phone.goto(`${P}?new=1`, { waitUntil: "networkidle" });
await tid(phone, "receive-form").waitFor({ timeout: 15000 });
check("phone: the receipt form fits", await noSideways(phone));
await shot(phone, "receive-phone", true);
await phone.goto(`${P}?unit=${firstUnit}`, { waitUntil: "networkidle" });
await tid(phone, "step-issue").waitFor({ timeout: 15000 });
check("phone: the record fits", await noSideways(phone));
await shot(phone, "unit-phone", true);
await phone.goto(`${P}?tab=catalog`, { waitUntil: "networkidle" });
await tid(phone, "catalog-row").first().waitFor({ timeout: 15000 });
check("phone: the catalog fits", await noSideways(phone));
await shot(phone, "catalog-phone");

// ── veritastock.com ──────────────────────────────────────────────────────────
const stock = await open({ stock: true });
await stock.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
await tid(stock, "recalls-button").waitFor({ timeout: 20000 });
check("veritastock.com: no Tissue button", (await tid(stock, "tissue-button").count()) === 0);
await stock.goto(P, { waitUntil: "networkidle" });
await until(async () => new URL(stock.url()).pathname === "/");
check("veritastock.com: the page redirects away", new URL(stock.url()).pathname === "/");
check("veritastock.com: nothing of the tissue page shows", (await tid(stock, "no-phi-banner").count()) === 0);

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
