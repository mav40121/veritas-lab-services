// scripts/verify-tissue-correct-expired-solution-ui.mjs
// Gate 3 receipt for parking lot #115's two record fixes on VeritaStock tissue (Michael Veri 2026-11-15, Q335 = 1). Run against a
// LOCAL production build on a scratch database, with made-up people and tissue (it registers a person and provisions a lab, so it
// refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-tissue-correct-expired-solution-ui.mjs
// In a real browser: record an implant whose solution expired before the implant date, see the warning and the note box, see the
// save refused without a note and taken with one, the badge and the note on the record; then correct a unit's tissue type and
// supplier by picking another catalog product and see the header and the history change. Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Tissue", "fix", "made", "up", "115!"].join("-");
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
  const file = path.join(OUT, `tissue-115-${name}.png`);
  await (locator || page).screenshot({ path: file, ...(locator ? {} : { fullPage }), animations: "disabled" });
  shots.push(file);
};

// ── A made-up lab, a freezer, two catalog products and three units ──────────────────────────────────────────────
const stamp = Date.now();
const ownerEmail = `tissue-115-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Tissue Fix Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9990115' WHERE id = ?").run(labId);
});
const T = `/api/labs/${labId}/veritastock/tissue`;
const today = new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const storage = (await call("POST", `/api/labs/${labId}/temp-logs/units`, { name: "Made-up BB Freezer", unit_type: "freezer", location: "Blood bank", min_value: -30, max_value: -18, scale: "C", readings_per_day: 1 }, owner.token)).j;
const catA = (await call("POST", `${T}/catalog`, { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }, owner.token)).j;
const catB = (await call("POST", `${T}/catalog`, { tissue_type: "Made-up Cortical Strut", supplier_name: "Made-up Graft Supply" }, owner.token)).j;
const receive = async (sourceId) => (await call("POST", `${T}/units`, {
  catalog_id: catA.id, source_id: sourceId, quantity_or_size: "5 cc", expiration_date: shift(400),
  received_mm_date: shift(-3), received_mm_time: "09:00", received_mm_by: "M. Handler",
  receive_bb: { received_bb_date: shift(-3), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_unit_id: storage.id, storage_location: "Shelf 2" },
}, owner.token)).j;
const issue = (id) => call("POST", `${T}/units/${id}/issue`, { issued_date: shift(-1), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4", readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes" }, owner.token);
const I = await receive("TIS-115-IMPLANT");
const C = await receive("TIS-115-CORRECT");
const Ph = await receive("TIS-115-PHONE");
await issue(I.id);
await issue(Ph.id);
check("made-up lab, freezer, two catalog products and three units; two issued", !!labId && !!catA.id && !!catB.id && !!I.id && !!C.id && !!Ph.id);
const P = `${BASE}/labs/${labId}/veritastock/tissue`;
const unitRow = (id) => scratch((d) => d.prepare("SELECT * FROM tissue_units WHERE id = ?").get(id));

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
const tid = (p, id) => p.getByTestId(id);
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const fillImplant = async (p, expiration) => {
  await tid(p, "step-implant").waitFor({ timeout: 15000 });
  await tid(p, "implant-time").fill("11:00");
  await tid(p, "implant-by").fill("Dr. Surgeon");
  await tid(p, "recon-time").fill("10:30");
  await tid(p, "recon-by").fill("R. Tech");
  await tid(p, "recon-solution").fill("Made-up Saline");
  await tid(p, "recon-lot").fill("LOT-9");
  await tid(p, "recon-exp").fill(expiration);
};

// ── 1. An implant with an expired solution ───────────────────────────────────────────────────────────────────
const page = await open();
await page.goto(`${P}?unit=${I.id}`, { waitUntil: "networkidle" });
await fillImplant(page, shift(-1));
await tid(page, "recon-expired").waitFor({ timeout: 5000 });
const warn = await tid(page, "recon-expired").innerText();
check("a solution that expired before the implant shows the warning and the note box", new RegExp(`expired on ${shift(-1)}, before the implant on ${today}`).test(warn) && /still recorded/.test(warn) && (await tid(page, "recon-expired-note").count()) === 1, warn);
check("the note box carries the no-patient-information notice", (await tid(page, "recon-expired").getByTestId("no-phi-notice").count()) === 1);
await tid(page, "save-implant").click();
await tid(page, "tissue-error").waitFor({ timeout: 10000 });
const refused = await tid(page, "tissue-error").innerText();
check("saving without the note is refused, with the reason on screen", /say what was done about it/.test(refused) && unitRow(I.id).state === "issued", refused);
await tid(page, "recon-expired").scrollIntoViewIfNeeded();
await shot(page, "implant-expired-warning");
const NOTE = "Surgeon informed before use; documented in the OR record";
await tid(page, "recon-expired-note").fill(NOTE);
await tid(page, "save-implant").click();
await tid(page, "flag-solution-expired").waitFor({ timeout: 15000 });
check("with the note it records: the unit reads Implanted with the Solution expired badge", /Implanted/.test(await tid(page, "unit-state").first().innerText()) && unitRow(I.id).reconstitution_expired_note === NOTE);
const implantSection = await page.locator("text=4. Implant").locator("xpath=ancestor::div[contains(@class,'p-5')][1]").innerText();
check("the Implant section shows the note", implantSection.includes("Solution expired at implant: what was done") && implantSection.includes(NOTE), implantSection);
const history = await tid(page, "unit-history").innerText();
check("the history's implant line says the solution was past its expiration", /Solution past its expiration/.test(history) && history.includes(NOTE), history);
await shot(page, "implant-recorded", true);

// ── 2. Correct the tissue type and supplier ───────────────────────────────────────────────────────────────────
await page.goto(`${P}?unit=${C.id}`, { waitUntil: "networkidle" });
await tid(page, "open-correct").click();
await tid(page, "step-correct").waitFor({ timeout: 15000 });
const fieldOptions = await tid(page, "correct-field").locator("option").allInnerTexts();
check("Tissue type and supplier is on the list of values to correct", fieldOptions.includes("Tissue type and supplier"), fieldOptions.join(" | "));
await tid(page, "correct-field").selectOption("catalog_id");
await tid(page, "correct-value").locator(`option[value="${catB.id}"]`).waitFor({ state: "attached", timeout: 10000 });
const productOptions = await tid(page, "correct-value").locator("option").allInnerTexts();
check("it offers the catalog's products, starting on the unit's own", productOptions.includes("Made-up Bone Putty, Made-up Tissue Bank") && productOptions.includes("Made-up Cortical Strut, Made-up Graft Supply") && (await tid(page, "correct-value").inputValue()) === String(catA.id), productOptions.join(" | "));
await tid(page, "correct-value").selectOption(String(catB.id));
await tid(page, "correct-reason").fill("Received under the wrong product");
await tid(page, "step-correct").scrollIntoViewIfNeeded();
await shot(page, "correct-catalog-form");
await tid(page, "save-correct").click();
await page.waitForFunction(() => /Made-up Cortical Strut, Made-up Graft Supply/.test(document.body.innerText), null, { timeout: 15000 });
const row = unitRow(C.id);
check("the header shows the new type and supplier, and the row moved", row.tissue_type === "Made-up Cortical Strut" && row.supplier_name === "Made-up Graft Supply" && row.catalog_id === catB.id);
const correctedLine = await tid(page, "history-corrected").last().innerText();
check("the history line names the type and supplier before and after", /Type of tissue from Made-up Bone Putty to Made-up Cortical Strut/.test(correctedLine) && /Supplier from Made-up Tissue Bank to Made-up Graft Supply/.test(correctedLine) && /Received under the wrong product/.test(correctedLine), correctedLine);
await shot(page, "correct-catalog-done", true);

// ── 3. Dark ───────────────────────────────────────────────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(`${P}?unit=${I.id}`, { waitUntil: "networkidle" });
await tid(dark, "flag-solution-expired").waitFor({ timeout: 15000 });
check("dark: the page is dark and the badge shows", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "implant-recorded-dark", true);

// ── 4. Phone ──────────────────────────────────────────────────────────────────────────────────────────────────
const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.goto(`${P}?unit=${Ph.id}`, { waitUntil: "networkidle" });
await fillImplant(phone, shift(-1));
await tid(phone, "recon-expired").waitFor({ timeout: 5000 });
check("phone: the implant form with the warning fits, with no sideways scroll", await noSideways(phone));
await tid(phone, "recon-expired").scrollIntoViewIfNeeded();
await shot(phone, "implant-warning-phone");
await phone.goto(`${P}?unit=${C.id}`, { waitUntil: "networkidle" });
await tid(phone, "open-correct").click();
await tid(phone, "correct-field").selectOption("catalog_id");
check("phone: the correction form fits", await noSideways(phone));

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`screenshots: ${shots.length}`);
for (const s of shots) console.log(`  ${s}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
