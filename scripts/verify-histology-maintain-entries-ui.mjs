// scripts/verify-histology-maintain-entries-ui.mjs
//
// Browser receipt for Histology in VeritaMap and the two VeritaMaintain records (Michael 2026-11-04, Q161 = 1). On a local production
// build with a scratch DB and a made-up owner:
//   M1. VeritaMap's department list offers Histology; picking it fills the department and shows where equipment belongs
//   M2. a custom instrument added there can take a custom test that starts on Histopathology, and complexity is still required
//   M3. the test saves with its specialty and the complexity chosen
//   E1. the stainer's log dialog offers Solution change, asks what was done and which solutions, and hides Next due
//   E2. leaving out who did it is refused; a saved change reads back on the history and the due date stays put
//   T1. a Humidity unit shows percent relative humidity, not degrees, in the form, the list, the reading dialog and the log
//   T2. a refrigerator added after it is back in degrees
//   D1. dark mode and phone width read and do not overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-histology-maintain-entries-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Histo", "Ui", "77!"].join("-");
const stamp = Date.now();
const email = `histo-ui-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Histology Test Lab", plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
const map = (await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Histology" }, token)).body;
const stainer = (await call("POST", `/api/labs/${labId}/equipment`, { instrument_name: "Made-up autostainer", pm_interval_days: 180, next_due_date: "2027-01-01" }, token)).body;

const browser = await chromium.launch();
const openAs = async (path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [token, me, labId, !!opts.dark]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// M. VeritaMap
{
  const page = await openAs(`/labs/${labId}/veritamap-app/${map.id}/build`);
  await page.getByText("Select department…").first().click();
  const option = page.getByRole("option", { name: "Histology", exact: true });
  check("M1. the department list offers Histology", await option.count() === 1);
  await option.click();
  await page.waitForSelector('[data-testid="histology-hint"]');
  check("M1. picking it fills the department in", await page.getByPlaceholder("Type department name…").inputValue() === "Histology");
  const hint = await page.locator('[data-testid="histology-hint"]').innerText();
  check("M1. the hint says equipment belongs in VeritaMaintain", /tissue processors, cryostats and microscopes, belongs in VeritaMaintain/.test(hint), hint.slice(0, 60));
  await page.screenshot({ path: `${OUT}/histology-department.png` });
  await page.getByPlaceholder("Type instrument name…").fill("Made-up histology bench");
  await page.getByRole("button", { name: "Add Instrument" }).click();
  await page.getByText("Made-up histology bench").first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Next: Select Tests" }).click();
  await page.getByRole("button", { name: "Add Custom Test" }).first().waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: "Add Custom Test" }).first().click();
  const dlg = page.getByRole("dialog");
  check("M2. the custom test starts on Histopathology", /Histopathology/.test(await dlg.innerText()));
  await page.getByPlaceholder('e.g. "SARS-CoV-2 EUA", "Lab-developed Toxicology Panel"').fill("H&E stain");
  check("M2. complexity is still required: Add stays off without it", await page.getByTestId("custom-test-add").isDisabled());
  await page.getByTestId("custom-test-complexity").click();
  await page.getByRole("option", { name: "HIGH", exact: true }).click();
  await page.screenshot({ path: `${OUT}/histology-custom-test.png` });
  await page.getByTestId("custom-test-add").click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Build My Map" }).click();
  await page.waitForTimeout(1500);
  const row = sql("SELECT specialty, complexity FROM veritamap_instrument_tests WHERE map_id = ? AND analyte = 'H&E stain'", map.id);
  check("M3. the test saved with its specialty and the complexity chosen", row?.specialty === "Histopathology" && row?.complexity === "HIGH", JSON.stringify(row));
  const cat = sql("SELECT category FROM veritamap_instruments WHERE map_id = ?", map.id);
  check("M3. the instrument is filed under Histology", cat?.category === "Histology", JSON.stringify(cat));
  await page.context().close();
}

// E. Solution change
{
  const page = await openAs(`/labs/${labId}/equipment-app`);
  await page.getByRole("button", { name: /^Log/ }).first().click();
  await page.locator("#ev-type").click();
  await page.getByRole("option", { name: "Solution change", exact: true }).click();
  check("E1. it asks what was done and which solutions", await page.getByTestId("sol-action").isVisible() && await page.getByTestId("sol-names").isVisible());
  check("E1. Next due is hidden for a solution change", await page.locator("#ev-next").count() === 0);
  await page.getByTestId("sol-names").fill("Hematoxylin, eosin");
  await page.getByRole("dialog").getByRole("button", { name: "Log maintenance" }).click();
  await page.waitForTimeout(400);
  check("E2. leaving out who did it is refused", await page.getByRole("dialog").isVisible() && !sql("SELECT id FROM equipment_maintenance_events WHERE equipment_id = ?", stainer.id));
  await page.locator("#ev-by").fill("MU");
  await page.screenshot({ path: `${OUT}/histology-solution-change.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Log maintenance" }).click();
  await page.waitForTimeout(800);
  const ev = sql("SELECT event_type, performed_by, notes FROM equipment_maintenance_events WHERE equipment_id = ?", stainer.id);
  check("E2. the change saves in plain words", ev?.event_type === "solution_change" && ev?.performed_by === "MU" && ev?.notes === "Changed: Hematoxylin, eosin", JSON.stringify(ev));
  check("E2. the due date stays put", sql("SELECT next_due_date AS d FROM lab_equipment WHERE id = ?", stainer.id).d === "2027-01-01");

  // T. Humidity
  await page.getByTestId("temp-add-unit").click();
  await page.locator("#tu-name").fill("Made-up histology room");
  await page.locator("#tu-type").selectOption("humidity");
  check("T1. the form shows percent relative humidity and locks it", /relative humidity/.test(await page.locator("#tu-scale").innerText()) && await page.locator("#tu-scale").isDisabled());
  await page.locator("#tu-min").fill("30");
  await page.locator("#tu-max").fill("60");
  await page.getByTestId("temp-save-unit").click();
  await page.waitForTimeout(600);
  const hum = sql("SELECT id, scale FROM temp_log_units WHERE name = 'Made-up histology room'");
  check("T1. it saves as RH", hum?.scale === "RH", JSON.stringify(hum));
  const list = await page.getByTestId("temp-units-table").innerText();
  check("T1. the list shows percent, no degrees", /30 to 60 %RH/.test(list) && !/°/.test(list), list.slice(0, 80));
  await page.getByTestId(`temp-record-${hum.id}`).click();
  check("T1. the reading dialog asks for humidity", /Humidity \(%RH\)/.test(await page.getByRole("dialog").innerText()));
  await page.getByTestId("temp-value").fill("45");
  await page.getByTestId("temp-initials").fill("mu");
  await page.screenshot({ path: `${OUT}/histology-humidity-reading.png` });
  await page.getByTestId("temp-save-reading").click();
  await page.waitForTimeout(600);
  await page.getByTestId(`temp-log-${hum.id}`).click();
  await page.getByTestId("temp-log-table").waitFor();
  const logText = await page.getByRole("dialog").innerText();
  check("T1. the log is titled humidity and reads in percent", /Humidity log/.test(logText) && /45 %RH/.test(logText) && !/°/.test(logText), logText.slice(0, 80));
  await page.keyboard.press("Escape");
  await page.getByTestId("temp-add-unit").click();
  await page.locator("#tu-type").selectOption("humidity");
  await page.locator("#tu-type").selectOption("refrigerator");
  check("T2. going back to a refrigerator is back in degrees and unlocked", /Celsius/.test(await page.locator("#tu-scale").innerText()) && !(await page.locator("#tu-scale").isDisabled()));
  await page.keyboard.press("Escape");
  await page.context().close();
}

// D. Dark mode and phone width
{
  const dark = await openAs(`/labs/${labId}/equipment-app`, { dark: true });
  await dark.getByTestId("temp-units-table").scrollIntoViewIfNeeded();
  await dark.screenshot({ path: `${OUT}/histology-dark.png` });
  check("D1. dark mode: the page does not overflow", await noOverflow(dark));
  await dark.context().close();
  const phone = await openAs(`/labs/${labId}/equipment-app`, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId("temp-add-unit").scrollIntoViewIfNeeded();
  await phone.screenshot({ path: `${OUT}/histology-phone.png` });
  check("D1. phone width: the page does not overflow", await noOverflow(phone));
  await phone.context().close();
}

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
