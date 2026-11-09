// scripts/verify-tissue-return-unused-ui.mjs
// Gate 3 receipt for "Returned unused" on VeritaStock tissue (Michael Veri 2026-11-09: "They also need to be able to return the tissue
// if it is not implanted after issue."). Run against a LOCAL production build on a scratch database, with made-up people and tissue
// (it registers people and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-tissue-return-unused-ui.mjs
// In a real browser: issue a unit, see Returned unused beside Other disposition, see a no hold the save with the reason, return it,
// see it back in storage with the history row, issue it again, undo the second issue and the return (the first issue comes back),
// return an expired unit and be refused at the next issue, and record a terminal disposition that reads Returned to supplier.
// Light, dark and phone.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Tissue", "return", "made", "up", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const shots = [];
const shot = async (page, name, fullPage = false) => {
  // A full-page picture from the top, or the sticky header lands mid-page.
  if (fullPage) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(150); }
  const file = path.join(OUT, `site-tissue-return-${name}.png`);
  await page.screenshot({ path: file, fullPage, animations: "disabled" });
  shots.push(file);
};

// ── A made-up lab, a temperature-logged freezer, a catalog row and three units received through the API ─────────────
const stamp = Date.now();
const ownerEmail = `tissue-return-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Return Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId);
});
const T = `/api/labs/${labId}/veritastock/tissue`;
const today = new Date().toLocaleDateString("en-CA");
const shift = (n) => { const d = new Date(today + "T12:00:00"); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
const storage = (await call("POST", `/api/labs/${labId}/temp-logs/units`, { name: "Made-up BB Freezer", unit_type: "freezer", location: "Blood bank", min_value: -30, max_value: -18, scale: "C", readings_per_day: 1 }, owner.token)).j;
const cat = (await call("POST", `${T}/catalog`, { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }, owner.token)).j;
const receive = async (sourceId, expiration, days = -1) => (await call("POST", `${T}/units`, {
  catalog_id: cat.id, source_id: sourceId, quantity_or_size: "5 cc", expiration_date: expiration,
  received_mm_date: shift(days), received_mm_time: "09:00", received_mm_by: "M. Handler",
  receive_bb: { received_bb_date: shift(days), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_unit_id: storage.id, storage_location: "Shelf 2" },
}, owner.token)).j;
const U = await receive("TIS-RET-1", shift(400));
const V = await receive("TIS-RET-SUPPLIER", shift(400));
const E = await receive("TIS-RET-EXPIRED", shift(-1), -5);
const eIssued = await call("POST", `${T}/units/${E.id}/issue`, { issued_date: shift(-2), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 2", readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes" }, owner.token);
check("made-up lab, freezer, catalog and three units in storage; the expired one issued before it expired", !!labId && !!storage.id && U.state === "stored" && V.state === "stored" && E.state === "stored" && eIssued.j.state === "issued", JSON.stringify({ U: U.state, V: V.state, E: E.state, e: eIssued.s }));
const P = `${BASE}/labs/${labId}/veritastock/tissue`;

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
const stateText = async (p) => tid(p, "unit-state").first().innerText();
const unitRow = (id) => scratch((d) => d.prepare("SELECT * FROM tissue_units WHERE id = ?").get(id));
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
};
const fillReturn = async (p, { time, by = "C. Courier", receivedBy = "R. Tech" }) => {
  await tid(p, "return-time").fill(time);
  await tid(p, "return-by").fill(by);
  await tid(p, "return-received-by").fill(receivedBy);
};

// ── Issue, then the two actions side by side ─────────────────────────────────
const page = await open();
await page.goto(`${P}?unit=${U.id}`, { waitUntil: "networkidle" });
await issueInUi(page, { physician: "Dr. Made Up", courier: "C. Courier", tech: "B. Tech", delivered: "OR 4", time: "07:00" });
await tid(page, "open-return-unused").waitFor({ timeout: 15000 });
check("issued: the unit reads Issued", /^Issued$/.test((await stateText(page)).trim()));
const actions = await tid(page, "unit-actions").innerText();
check("Returned unused sits beside Other disposition, which now says returned to supplier", /Returned unused/.test(actions) && /Other disposition \(wasted, returned to supplier or expired\)/.test(actions), actions);
await tid(page, "unit-actions").scrollIntoViewIfNeeded();
await shot(page, "issued-actions");

// ── The form, a no, then the return ──────────────────────────────────────────
await tid(page, "open-return-unused").click();
await tid(page, "step-return-unused").waitFor({ timeout: 15000 });
const help = await tid(page, "return-unused-help").innerText();
check("the form says what it's for, in Michael's words", help === "Use this when the tissue came back to blood bank without being implanted. It goes back into storage and can be issued again. If it can't go back on the shelf, record an Other disposition instead.", help);
check("the form says an expired unit can be returned but not issued again", /past its expiration date can still be returned here, but it can't be issued again/.test(await tid(page, "return-unused-expiry").innerText()));
const formText = await tid(page, "step-return-unused").innerText();
check("the form asks both checks", /Storage conditions maintained while out of blood bank\?/.test(formText) && /Package integrity acceptable on return\?/.test(formText));
check("the form names the issue it came back from", /Issued .* 07:00 to OR 4/.test(formText), formText.slice(0, 300));
check("the note carries the no-patient-information notice", (await tid(page, "step-return-unused").getByTestId("no-phi-notice").count()) === 1);
await tid(page, "return-storage-unit").locator(`option[value="${storage.id}"]`).waitFor({ state: "attached", timeout: 15000 });
const prefilledUnit = await tid(page, "return-storage-unit").inputValue();
check("where it goes back starts as where it was stored", prefilledUnit === String(storage.id) && (await tid(page, "return-storage-location").inputValue()) === "Shelf 2", prefilledUnit);
await fillReturn(page, { time: "07:30" });
await tid(page, "return-storage-location").fill("Shelf 3");
await tid(page, "return-note").fill("Case cancelled, graft unopened");
await tid(page, "return-storage-ok-no").check();
await tid(page, "return-package-ok-yes").check();
await tid(page, "return-unused-refusal").waitFor({ timeout: 5000 });
const refusal = await tid(page, "return-unused-refusal").innerText();
check("a no shows why and points to Other disposition", /answered no, so this unit can't go back into storage\. Record what happened as an Other disposition/.test(refusal), refusal);
check("a no holds the save", await tid(page, "save-return-unused").isDisabled());
await tid(page, "return-unused-refusal").scrollIntoViewIfNeeded();
await shot(page, "return-no");
await tid(page, "return-storage-ok-yes").check();
await tid(page, "return-unused-refusal").waitFor({ state: "detached", timeout: 5000 });
check("both yes: the save is open", await tid(page, "save-return-unused").isEnabled());
await shot(page, "return-form", true);
await tid(page, "save-return-unused").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });
check("returned: back in blood bank storage", (await stateText(page)).trim() === "In blood bank storage");
const afterReturn = await tid(page, "tissue-unit").innerText();
check("the Issue section is gone from the record, and the issue form is back", !/3\. Issue/.test(afterReturn) && /Next: issue from storage/.test(afterReturn));
check("the Storage section shows where it went back", /Shelf 3/.test(afterReturn) && /Made-up BB Freezer/.test(afterReturn));
const histLine = await tid(page, "history-returned_unused").first().innerText();
check("history: Returned unused to blood bank, with date and time, who brought it, who received it and the two checks",
  histLine.startsWith("Returned unused to blood bank") && histLine.includes(`${today} 07:30`) && /Brought back by C\. Courier, received by R\. Tech/.test(histLine) && /Storage conditions maintained: Yes\. Package integrity acceptable: Yes\./.test(histLine) && /It had been issued .* 07:00 to OR 4/.test(histLine) && /Note: Case cancelled, graft unopened/.test(histLine), histLine);
const r1 = unitRow(U.id);
check("in the database: stored, the issue off the row, the receipt kept, the new shelf", r1.state === "stored" && r1.issued_date === null && r1.delivered_to === null && r1.readback_id_ok === null && r1.received_bb_date === shift(-1) && r1.received_bb_by === "B. Tech" && r1.storage_location === "Shelf 3");
await shot(page, "returned-stored", true);

// ── Issued again ─────────────────────────────────────────────────────────────
await issueInUi(page, { physician: "Dr. Second", courier: "D. Courier", tech: "S. Tech", delivered: "OR 7", time: "08:00" });
await tid(page, "open-return-unused").waitFor({ timeout: 15000 });
const reissued = await tid(page, "tissue-unit").innerText();
check("issued again: Issued, with the second issue's own fields", /^Issued$/.test((await stateText(page)).trim()) && /Dr\. Second/.test(reissued) && /OR 7/.test(reissued) && /S\. Tech/.test(reissued));
check("history: two Issued rows around the return", (await tid(page, "history-issued").count()) === 2 && (await tid(page, "history-returned_unused").count()) === 1);
await shot(page, "reissued", true);

// ── Undo the second issue, then the return: the first issue comes back ────────
await tid(page, "open-correct").click();
await tid(page, "undo-reason").fill("Second issue entered on the wrong unit");
await tid(page, "save-undo").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });
check("undo 1: back in storage", (await stateText(page)).trim() === "In blood bank storage");
await tid(page, "undo-reason").fill("Return recorded on the wrong unit");
await tid(page, "save-undo").click();
await tid(page, "open-return-unused").waitFor({ timeout: 15000 });
const restored = await tid(page, "tissue-unit").innerText();
check("undo 2: issued again with the first issue's fields, the blood bank receipt still there", /^Issued$/.test((await stateText(page)).trim()) && /Dr\. Made Up/.test(restored) && /OR 4/.test(restored) && /Received in blood bank/.test(restored));
check("history: the undo names the return", (await tid(page, "unit-history").innerText()).includes("Step undone (Returned unused to blood bank)"));
const r2 = unitRow(U.id);
check("in the database: the first issue and its shelf are back", r2.state === "issued" && r2.requesting_physician === "Dr. Made Up" && r2.delivered_to === "OR 4" && r2.issued_time === "07:00" && r2.storage_location === "Shelf 2" && r2.received_bb_date === shift(-1));
await shot(page, "undone-return", true);

// ── An expired unit: returned, then refused at the next issue ─────────────────
await page.goto(`${P}?unit=${E.id}`, { waitUntil: "networkidle" });
await tid(page, "open-return-unused").waitFor({ timeout: 15000 });
await tid(page, "open-return-unused").click();
const expNote = await tid(page, "return-unused-expiry").innerText();
check("an expired unit's form says it can be returned but not issued again", new RegExp(`This unit expired on ${shift(-1)}\\. It can still be returned here, but it can't be issued again\\.`).test(expNote), expNote);
await fillReturn(page, { time: "00:05" });
await tid(page, "return-storage-ok-yes").check();
await tid(page, "return-package-ok-yes").check();
await tid(page, "save-return-unused").click();
await tid(page, "step-issue").waitFor({ timeout: 15000 });
check("the expired unit is back in storage, flagged past expiration", (await stateText(page)).trim() === "In blood bank storage" && (await tid(page, "issue-expired-note").isVisible()));
await issueInUi(page, { physician: "Dr. Made Up", courier: "C. Courier", tech: "B. Tech", delivered: "OR 2", time: "00:10" });
const expErr = await (await tid(page, "tissue-error").first().waitFor({ timeout: 15000 }), tid(page, "tissue-error").first().innerText());
check("and it can't be issued again, with the reason", /expired on .* so it can't be issued/.test(expErr), expErr);
await tid(page, "step-issue").scrollIntoViewIfNeeded();
await shot(page, "expired-refused");

// ── Returned to supplier ─────────────────────────────────────────────────────
await page.goto(`${P}?unit=${V.id}`, { waitUntil: "networkidle" });
await tid(page, "open-dispose").waitFor({ timeout: 15000 });
check("a stored unit offers no Returned unused", (await tid(page, "open-return-unused").count()) === 0);
await tid(page, "open-dispose").click();
const kinds = await tid(page, "dispose-kind").locator("option").allInnerTexts();
check("the disposition list reads Returned to supplier", kinds.includes("Returned to supplier") && !kinds.includes("Returned"), kinds.join("|"));
await tid(page, "dispose-kind").selectOption({ label: "Returned to supplier" });
await tid(page, "dispose-by").fill("B. Tech");
await tid(page, "dispose-description").fill("Supplier asked for it back");
await tid(page, "save-dispose").click();
await tid(page, "step-dispose").waitFor({ state: "detached", timeout: 15000 });
const vText = await tid(page, "tissue-unit").innerText();
check("the terminal disposition reads Returned to supplier on the record", (await stateText(page)).trim() === "Returned to supplier" && /Disposition\s*\n?\s*Returned to supplier/.test(vText), vText.slice(0, 400));
check("stored as returned", unitRow(V.id).state === "returned");
await shot(page, "returned-to-supplier", true);
await page.goto(P, { waitUntil: "networkidle" });
await tid(page, "tissue-filter-all").click();
await tid(page, "tissue-log-row").nth(2).waitFor({ timeout: 15000 });
check("the log reads Returned to supplier", /Returned to supplier/.test(await tid(page, "tissue-log-table").innerText()));
await shot(page, "log-all");

// ── Dark ─────────────────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await dark.goto(`${P}?unit=${U.id}`, { waitUntil: "networkidle" });
await tid(dark, "open-return-unused").waitFor({ timeout: 15000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await tid(dark, "unit-actions").scrollIntoViewIfNeeded();
await shot(dark, "issued-actions-dark");
await tid(dark, "open-return-unused").click();
await tid(dark, "return-storage-ok-no").check();
await tid(dark, "return-unused-refusal").waitFor({ timeout: 5000 });
await shot(dark, "return-form-dark", true);
await dark.goto(`${P}?unit=${V.id}`, { waitUntil: "networkidle" });
await tid(dark, "unit-history").waitFor({ timeout: 15000 });
await shot(dark, "returned-to-supplier-dark", true);

// ── Phone ────────────────────────────────────────────────────────────────────
const phone = await open({ viewport: { width: 390, height: 844 } });
await phone.goto(`${P}?unit=${U.id}`, { waitUntil: "networkidle" });
await tid(phone, "open-return-unused").waitFor({ timeout: 15000 });
check("phone: the issued record fits", await noSideways(phone));
await tid(phone, "open-return-unused").click();
await tid(phone, "step-return-unused").waitFor({ timeout: 15000 });
check("phone: the return form fits, with no sideways scroll", await noSideways(phone));
await shot(phone, "return-form-phone", true);
await phone.goto(`${P}?unit=${E.id}`, { waitUntil: "networkidle" });
await tid(phone, "unit-history").waitFor({ timeout: 15000 });
check("phone: a record with a return in its history fits", await noSideways(phone));
await shot(phone, "history-phone", true);

check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`screenshots: ${shots.length}`);
for (const s of shots) console.log(`  ${s}`);
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
