// scripts/verify-tissue-record-pdf-ui.mjs
// Gate 3 receipt for the per-unit tissue record PDF (Michael Veri 2026-11-09: "The tissue tracking module needs a pdf print out. Use the
// heywood mock up for it."). Run against a LOCAL production build on a scratch database, with made-up people and tissue (it registers
// people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-tissue-record-pdf-ui.mjs
// In a real browser: receive a unit, issue it, return it unused, issue it again, implant it and record the usage card, all on the
// screens; then click Print record (PDF), save what downloads to OUT/site-tissue-record.pdf and check it is the unit's PDF. The words
// and the page itself are checked by scripts/verify-tissue-record-pdf-render.py on that file. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const { PDFDocument } = require("pdf-lib");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Tissue", "record", "made", "up", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shots = [];
const shot = async (page, name, fullPage = false) => {
  if (fullPage) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); }
  const file = path.join(OUT, `site-tissue-record-${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: "disabled" });
  shots.push(file);
};

// ── A made-up lab, a temperature-logged freezer and a catalog row ────────────
const stamp = Date.now();
const ownerEmail = `tissue-record-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Record Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999996' WHERE id = ?").run(labId);
});
const T = `/api/labs/${labId}/veritastock/tissue`;
const today = new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const storage = (await call("POST", `/api/labs/${labId}/temp-logs/units`, { name: "Made-up BB Freezer", unit_type: "freezer", location: "Blood bank", min_value: -30, max_value: -18, scale: "C", readings_per_day: 1 }, owner.token)).j;
const cat = (await call("POST", `${T}/catalog`, { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }, owner.token)).j;
check("made-up lab, freezer and catalog row", !!labId && !!storage.id && !!cat.id, JSON.stringify({ labId, storage: storage.id, cat: cat.id }));
const P = `${BASE}/labs/${labId}/veritastock/tissue`;

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  return page;
};
const tid = (p, id) => p.getByTestId(id);
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const stateText = async (p) => (await tid(p, "unit-state").first().innerText()).trim();
const issueInUi = async (p, { physician, courier, tech, delivered, time }) => {
  await tid(p, "step-issue").waitFor({ timeout: 15000 });
  await tid(p, "issue-time").fill(time);
  await tid(p, "issue-physician").fill(physician);
  await tid(p, "issue-to").fill(courier);
  await tid(p, "issue-tech").fill(tech);
  await tid(p, "issue-delivered").fill(delivered);
  await tid(p, "readback-id-yes").check();
  await tid(p, "readback-exp-yes").check();
  await tid(p, "readback-int-yes").check();
  await tid(p, "save-issue").click();
  await tid(p, "step-implant").waitFor({ timeout: 15000 });
};

// ── Build the unit on the screens ────────────────────────────────────────────
const page = await open();
await page.goto(`${P}?new=1`, { waitUntil: "networkidle" });
await tid(page, "catalog-select").selectOption({ label: "Made-up Bone Putty (Made-up Tissue Bank)" });
await tid(page, "source-id").fill("TIS-REC-1");
await tid(page, "quantity-size").fill("5 cc");
await tid(page, "expiration").fill(shift(400));
await tid(page, "mm-date").fill(shift(-1));
await tid(page, "mm-time").fill("09:00");
await tid(page, "mm-by").fill("M. Handler");
await tid(page, "bb-date").fill(shift(-1));
await tid(page, "bb-time").fill("10:00");
await tid(page, "bb-by").fill("B. Tech");
await tid(page, "transport-temp-yes").check();
await tid(page, "package-ok-yes").check();
await tid(page, "storage-unit").selectOption({ label: "Made-up BB Freezer, Blood bank" });
await tid(page, "storage-location").fill("Shelf 2");
await tid(page, "save-receipt").click();
await tid(page, "tissue-unit").waitFor({ timeout: 15000 });
check("received: in blood bank storage", (await stateText(page)) === "In blood bank storage");
await issueInUi(page, { physician: "Dr. Made Up", courier: "C. Courier", tech: "B. Tech", delivered: "OR 4", time: "07:00" });
await tid(page, "open-return-unused").click();
await tid(page, "return-time").fill("07:30");
await tid(page, "return-by").fill("C. Courier");
await tid(page, "return-received-by").fill("R. Tech");
await tid(page, "return-storage-ok-yes").check();
await tid(page, "return-package-ok-yes").check();
await tid(page, "return-storage-location").fill("Shelf 3");
await tid(page, "save-return-unused").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });
check("returned unused: back in storage", (await stateText(page)) === "In blood bank storage");
await issueInUi(page, { physician: "Dr. Second", courier: "D. Courier", tech: "S. Tech", delivered: "OR 7", time: "08:00" });
await tid(page, "implant-time").fill("08:45");
await tid(page, "implant-by").fill("Dr. Surgeon");
await tid(page, "recon-time").fill("08:40");
await tid(page, "recon-by").fill("N. Nurse");
await tid(page, "recon-solution").fill("Made-up Saline");
await tid(page, "recon-lot").fill("SOL-1");
await tid(page, "recon-exp").fill(shift(300));
await tid(page, "save-implant").click();
await tid(page, "step-usage-card").waitFor({ timeout: 15000 });
await tid(page, "usage-card-yes").check();
await tid(page, "usage-card-date").fill(today);
await tid(page, "save-usage-card").click();
await page.getByText(`Yes, ${today}`).first().waitFor({ timeout: 15000 });
check("implanted, with the usage card returned", (await stateText(page)) === "Implanted");
const unitId = scratch((d) => d.prepare("SELECT id FROM tissue_units WHERE lab_id = ? AND source_id = 'TIS-REC-1'").get(labId)).id;
const events = scratch((d) => d.prepare("SELECT event_type FROM tissue_unit_events WHERE unit_id = ? ORDER BY id").all(unitId).map((e) => e.event_type).join(","));
check("the unit's steps, all from the screens", events === "received_mm,received_bb,issued,returned_unused,issued,implanted,usage_card", events);

// ── Print record (PDF) ───────────────────────────────────────────────────────
await page.evaluate(() => window.scrollTo(0, 0));
const button = tid(page, "tissue-record-pdf");
check("the unit has a Print record (PDF) button", (await button.isVisible()) && (await button.innerText()).trim() === "Print record (PDF)");
await shot(page, "unit-button");
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), button.click()]);
const pdfFile = path.join(OUT, "site-tissue-record.pdf");
await download.saveAs(pdfFile);
const suggested = download.suggestedFilename();
const bytes = fs.readFileSync(pdfFile);
check("clicking it downloads the unit's PDF, named for the tissue ID and the day", bytes.slice(0, 5).toString() === "%PDF-" && suggested === `VeritaStock_Tissue_Record_TIS-REC-1_${today}.pdf`, suggested);
const doc = await PDFDocument.load(bytes);
check("author metadata", doc.getAuthor() === "Perplexity Computer", String(doc.getAuthor()));
check("one unit on one page", doc.getPageCount() === 1, String(doc.getPageCount()));
check("no error on the page after the download", (await tid(page, "tissue-error").count()) === 0);
await tid(page, "tissue-record-pdf").waitFor({ timeout: 5000 });
check("the button reads Print record (PDF) again", (await tid(page, "tissue-record-pdf").innerText()).trim() === "Print record (PDF)");
const viewsBefore = scratch((d) => d.prepare("SELECT COUNT(*) n FROM record_views WHERE lab_id = ? AND path LIKE ?").get(labId, `%/units/${unitId}/pdf`).n);
check("the download is in the lab's access log like any record read", viewsBefore >= 1, String(viewsBefore));

// ── Dark ─────────────────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(`${P}?unit=${unitId}`, { waitUntil: "networkidle" });
await tid(dark, "tissue-record-pdf").waitFor({ timeout: 15000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "unit-button-dark");
const [darkDl] = await Promise.all([dark.waitForEvent("download", { timeout: 60000 }), tid(dark, "tissue-record-pdf").click()]);
check("dark: the button downloads the PDF too", /^VeritaStock_Tissue_Record_TIS-REC-1_/.test(darkDl.suggestedFilename()));

// ── Phone ────────────────────────────────────────────────────────────────────
const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.goto(`${P}?unit=${unitId}`, { waitUntil: "networkidle" });
await tid(phone, "tissue-record-pdf").waitFor({ timeout: 15000 });
check("phone: the record fits, with no sideways scroll", await noSideways(phone));
await shot(phone, "unit-button-phone");
const [phoneDl] = await Promise.all([phone.waitForEvent("download", { timeout: 60000 }), tid(phone, "tissue-record-pdf").click()]);
check("phone: the button downloads the PDF", /^VeritaStock_Tissue_Record_TIS-REC-1_/.test(phoneDl.suggestedFilename()));

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`pdf: ${pdfFile}`);
console.log(`screenshots: ${shots.length}`);
for (const s of shots) console.log(`  ${s}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
