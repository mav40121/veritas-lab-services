// scripts/verify-tissue-retention-ui.mjs
// Gate 3 receipt for the lab-set tissue record retention period (Michael Veri 2026-11-22, Decision 11 = 1, parking lot #115). Run
// against a LOCAL production build on a scratch database, with made-up people and tissue (it registers people and provisions a lab,
// so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-tissue-retention-ui.mjs
// In a real browser, in one page session with in-app links (so a cached read would show): the Tissue log's Record retention card
// reads Not set and a unit says so; a bad value is refused on screen; 10 years saves; the implanted unit then shows its keep-until
// date and the unit in storage says it counts from final disposition; Print record (PDF) downloads a PDF; an editor reads the
// setting with no way to change it; Clear it brings Not set back. Light, dark and phone.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Tissue", "keep", "made", "up", "115!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shots = [];
const shot = async (page, name, fullPage = false, locator = null) => {
  if (fullPage) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); }
  const file = path.join(OUT, `tissue-retention-${name}.png`);
  await (locator || page).screenshot({ path: file, ...(locator ? {} : { fullPage }), animations: "disabled" });
  shots.push(file);
};
const addYears = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate(); return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`; };

// ── A made-up lab, an editor, a catalog product and two units: one implanted, one in storage ─────────────────────
const stamp = Date.now();
const ownerEmail = `tissue-ret-owner-${stamp}@example.test`;
const editorEmail = `tissue-ret-editor-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const editor = (await call("POST", "/api/auth/register", { email: editorEmail, password: PW, name: "Made Up Editor", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Tissue Retention Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const now = new Date().toISOString();
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(ownerEmail, editorEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9990116' WHERE id = ?").run(labId);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, editor.user.id, now, now, now);
  d.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')")
    .run(owner.user.id, editorEmail, editor.user.id, now, now, '{"mode":"edit_all"}', `ret-ui-${stamp}`, labId);
});
const T = `/api/labs/${labId}/veritastock/tissue`;
const today = new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const cat = (await call("POST", `${T}/catalog`, { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }, owner.token)).j;
const receive = async (sourceId) => (await call("POST", `${T}/units`, {
  catalog_id: cat.id, source_id: sourceId, quantity_or_size: "5 cc", expiration_date: shift(400),
  received_mm_date: shift(-4), received_mm_time: "09:00", received_mm_by: "M. Handler",
  receive_bb: { received_bb_date: shift(-4), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_location: "Shelf 2" },
}, owner.token)).j;
const I = await receive("TIS-RET-IMPLANT");
const S = await receive("TIS-RET-STORED");
await call("POST", `${T}/units/${I.id}/issue`, { issued_date: shift(-2), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4", readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes" }, owner.token);
const implanted = await call("POST", `${T}/units/${I.id}/implant`, { implanted_date: shift(-1), implanted_time: "10:00", implanted_by: "Dr. Surgeon" }, owner.token);
check("made-up lab, an editor, one unit implanted and one in storage", !!labId && !!editor.user?.id && implanted.s === 200 && !!S.id);
const P = `${BASE}/labs/${labId}/veritastock/tissue`;
const stored = () => scratch((d) => d.prepare("SELECT tissue_retention_years AS y FROM labs WHERE id = ?").get(labId).y);

const browser = await chromium.launch();
const errors = [];
const open = async (who = owner, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, who.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [who.token, me, opts.colorScheme || "light"]);
  return page;
};
const tid = (p, id) => p.getByTestId(id);
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const toLog = async (p) => { await p.getByRole("link", { name: "Tissue log" }).click(); await tid(p, "tissue-retention-setting").waitFor({ timeout: 15000 }); };
const toUnit = async (p, sourceId) => {
  await tid(p, "tissue-filter-all").click();
  await p.locator('[data-testid="tissue-log-row"]', { hasText: sourceId }).click();
  await tid(p, "unit-retention").waitFor({ timeout: 15000 });
};

// ── 1. Not set ──────────────────────────────────────────────────────────────────────────────────────────────────
const page = await open();
await page.goto(P, { waitUntil: "networkidle" });
await tid(page, "tissue-retention-setting").waitFor({ timeout: 15000 });
const card0 = await tid(page, "tissue-retention-setting").innerText();
check("the Tissue log's Record retention card reads Not set, with the note and a way to set it",
  /Record retention/.test(card0) && /Not set/.test(card0) && /hasn't set its tissue record retention period/.test(card0) && (await tid(page, "tissue-retention-edit").innerText()) === "Set the retention period", card0);
await shot(page, "log-not-set", false, tid(page, "tissue-retention-setting"));
await toUnit(page, "TIS-RET-IMPLANT");
check("the implanted unit says Not set, with the mock's note", (await tid(page, "unit-retention-keep").innerText()) === "Not set" && /hasn't set its tissue record retention period/.test(await tid(page, "unit-retention-note").innerText()));
await shot(page, "unit-not-set", false, tid(page, "unit-retention"));

// ── 2. A bad value, then 10 years ───────────────────────────────────────────────────────────────────────────────
await toLog(page);
await tid(page, "tissue-retention-edit").click();
await tid(page, "tissue-retention-years").fill("0");
await tid(page, "tissue-retention-save").click();
await tid(page, "tissue-retention-form").getByTestId("tissue-error").waitFor({ timeout: 10000 });
const refused = await tid(page, "tissue-retention-form").getByTestId("tissue-error").innerText();
check("0 years is refused on screen with the reason, and nothing is stored", /whole number of years from 1 to 99/.test(refused) && stored() === null, refused);
await tid(page, "tissue-retention-years").fill("10");
await shot(page, "log-form", false, tid(page, "tissue-retention-setting"));
await tid(page, "tissue-retention-save").click();
// Locator waits, not waitForFunction: the site's Content Security Policy refuses the eval that waitForFunction needs.
const textIn = (p, id, text) => p.locator(`[data-testid="${id}"]`, { hasText: text }).waitFor({ timeout: 15000 });
await textIn(page, "tissue-retention-current", "10 years after final disposition");
check("10 years saves: the card reads the policy line and the lab holds 10", (await tid(page, "tissue-retention-current").innerText()) === "10 years after final disposition (implant, return to supplier, or discard)" && stored() === 10);
await shot(page, "log-set", false, tid(page, "tissue-retention-setting"));

// ── 3. The units, reached through in-app links in the same session ──────────────────────────────────────────────
await toUnit(page, "TIS-RET-IMPLANT");
await textIn(page, "unit-retention-keep", addYears(shift(-1), 10)).catch(() => {});
const keep = await tid(page, "unit-retention-keep").innerText();
const unitBox = await tid(page, "unit-retention").innerText();
check("the implanted unit, opened again in the same session, shows its new keep-until date (not a cached Not set)", keep === addYears(shift(-1), 10), keep);
check("with the policy line and the note naming the implant date", /10 years after final disposition \(implant, return to supplier, or discard\)/.test(unitBox) && unitBox.includes(`final disposition, implanted ${shift(-1)}.`), unitBox);
await shot(page, "unit-set", false, tid(page, "unit-retention"));
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), tid(page, "tissue-record-pdf").click()]);
const pdfFile = path.join(OUT, "tissue-retention-record.pdf");
await download.saveAs(pdfFile);
const head = fs.readFileSync(pdfFile).subarray(0, 5).toString();
check("Print record (PDF) downloads the unit's record as a PDF", head === "%PDF-" && /VeritaStock_Tissue_Record_TIS-RET-IMPLANT_/.test(download.suggestedFilename()), `${head} ${download.suggestedFilename()}`);
await toLog(page);
await toUnit(page, "TIS-RET-STORED");
check("the unit in storage says the date counts from final disposition", (await tid(page, "unit-retention-keep").innerText()) === "Counts from final disposition" && /which isn't recorded yet/.test(await tid(page, "unit-retention-note").innerText()));
await shot(page, "unit-open", false, tid(page, "unit-retention"));
await shot(page, "unit-set-page", true);

// ── 4. An editor reads it and can't change it ───────────────────────────────────────────────────────────────────
const ed = await open(editor);
await ed.goto(P, { waitUntil: "networkidle" });
await tid(ed, "tissue-retention-setting").waitFor({ timeout: 15000 });
check("an editor sees the setting, no button, and who sets it", /10 years after final disposition/.test(await tid(ed, "tissue-retention-current").innerText()) && (await tid(ed, "tissue-retention-edit").count()) === 0 && /owner or an admin sets this/.test(await tid(ed, "tissue-retention-readonly").innerText()));
await shot(ed, "log-editor", false, tid(ed, "tissue-retention-setting"));

// ── 5. Dark and phone ───────────────────────────────────────────────────────────────────────────────────────────
const dark = await open(owner, { colorScheme: "dark" });
await dark.goto(`${P}?unit=${I.id}`, { waitUntil: "networkidle" });
await tid(dark, "unit-retention").waitFor({ timeout: 15000 });
check("dark: the page is dark and the box shows the date", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await tid(dark, "unit-retention-keep").innerText()) === addYears(shift(-1), 10));
await shot(dark, "unit-dark", false, tid(dark, "unit-retention"));
await dark.goto(P, { waitUntil: "networkidle" });
await tid(dark, "tissue-retention-setting").waitFor({ timeout: 15000 });
await shot(dark, "log-dark", false, tid(dark, "tissue-retention-setting"));
const phone = await open(owner, { viewport: { width: 390, height: 844 } });
await phone.goto(P, { waitUntil: "networkidle" });
await tid(phone, "tissue-retention-edit").click();
await tid(phone, "tissue-retention-form").waitFor({ timeout: 10000 });
check("phone: the log with the open form fits, with no sideways scroll", await noSideways(phone));
await shot(phone, "log-phone", false, tid(phone, "tissue-retention-setting"));
await phone.goto(`${P}?unit=${I.id}`, { waitUntil: "networkidle" });
await tid(phone, "unit-retention").waitFor({ timeout: 15000 });
check("phone: the unit's box fits", await noSideways(phone));
await shot(phone, "unit-phone", false, tid(phone, "unit-retention"));

// ── 6. Clear it ─────────────────────────────────────────────────────────────────────────────────────────────────
await page.goto(P, { waitUntil: "networkidle" });
await tid(page, "tissue-retention-edit").click();
await tid(page, "tissue-retention-clear").click();
await textIn(page, "tissue-retention-current", /^Not set$/);
check("Clear it: the card reads Not set and nothing is stored", stored() === null);
await toUnit(page, "TIS-RET-IMPLANT");
await textIn(page, "unit-retention-keep", /^Not set$/).catch(() => {});
check("and the unit, opened again in the same session, says Not set", (await tid(page, "unit-retention-keep").innerText()) === "Not set");

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`screenshots: ${shots.length}`);
for (const s of shots) console.log(`  ${s}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
