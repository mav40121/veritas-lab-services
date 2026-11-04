// scripts/verify-assign-by-instrument-ui.mjs
// Browser receipt for assigning staff from the instrument side. Made-up lab, analyzers and 40 made-up staff on a scratch DB only.
//   BUG-119 (RFGH Brandy Morgan, 2026-10-29; Michael Q71 = 1): ticking a person far down the staff list must not throw the list back to
//   the top, and the filter box must keep focus while you type.
//   Michael 2026-11-04: easier to find (an Instruments tab, a button on VeritaMap cards and VeritaMaintain rows, a pointer from the person's
//   picker), Select all and Clear on the staff list, and several instruments at once: the staff picked go on every instrument ticked and nobody
//   comes off. A read-only lab sees no button on the map and can't tick. Dark mode and phone width read and don't overflow.
// Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-assign-by-instrument-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };

const email = `assign-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Assign UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Assign UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Assign UI Lab", cliaNumber: "11D7654380", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const FIRST = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jo"];
const LAST = ["Abbott", "Baker", "Chen", "Diaz"];
for (const ln of LAST) for (const fn of FIRST) {
  await call("POST", `${L}/staff/employees`, { lastName: ln, firstName: fn, highestComplexity: "M", performsTesting: true, hireDate: "2021-01-04" }, owner.token);
}
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token);
const addInstrument = async (name, serial) => {
  await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: name, role: "Primary", category: "Hematology", serial_number: serial }, owner.token);
  return sql("SELECT id FROM veritamap_instruments WHERE map_id = ? AND serial_number = ?", map.id, serial).id;
};
const xn1000 = await addInstrument("Sysmex XN-1000", "SN1000");
const xn450 = await addInstrument("Sysmex XN-450", "SN450");
const cobas = await addInstrument("Cobas c311", "SN311");
const uid = sql("SELECT id FROM users WHERE email = ?", email).id;
sql("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?", uid);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const staffCount = sql("SELECT COUNT(*) n FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active'", labId).n;
check("setup: 40 made-up staff and three analyzers on a scratch lab", staffCount >= 40 && !!map.id, `staff ${staffCount}, map ${map.id}`);
const pairs = (instId) => sql("SELECT COUNT(*) n FROM staff_employee_instruments WHERE instrument_id = ?", instId).n;

const browser = await chromium.launch();
const open = async (p, opts = {}) => {
  const page = await browser.newPage({ viewport: opts.viewport || { width: 1300, height: 820 }, colorScheme: opts.scheme || "light" });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
    if (dark) localStorage.setItem("theme", "dark");
  }, [owner.token, owner.user, opts.scheme === "dark"]);
  await page.goto(`${BASE}/labs/${labId}${p}`, { waitUntil: "networkidle" });
  return page;
};

// 1. Finding it: the tab, and the button that used to open a dialog now goes to the same place.
const page = await open("/veritastaff-app");
await page.getByTestId("staff-tab-instruments").waitFor({ timeout: 10000 });
check("VeritaStaff has an Instruments tab", (await page.getByTestId("staff-tab-instruments").innerText()).trim() === "Instruments");
await page.getByTestId("button-assign-by-instrument").click();
await page.getByTestId("instrument-panel").waitFor({ timeout: 10000 });
check("Assign by Instrument opens the same list", await page.getByTestId(`instrument-panel-tick-${xn1000}`).isVisible());
check("the list says what has no one assigned", /3 of 3 have no one assigned/.test(await page.getByTestId("instrument-panel-gap").innerText()));
check("each row says who is on it", (await page.getByTestId(`instrument-panel-count-${xn1000}`).innerText()).trim() === "No one assigned");
check("nothing ticked, nothing to assign", await page.getByTestId("instrument-panel-assign-ticked").isDisabled());

// 2. The filter box keeps focus while typing (BUG-119).
const filter = page.getByTestId("instrument-panel-filter");
await filter.click();
await page.keyboard.type("XN-1000", { delay: 60 });
const typed = await filter.inputValue();
const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
check("typing 'XN-1000' into the filter keeps every letter", typed === "XN-1000", JSON.stringify(typed));
check("the filter box still has focus after typing", focused === "instrument-panel-filter", String(focused));
check("the filter narrows the list", await page.getByTestId(`instrument-panel-tick-${xn450}`).count() === 0);

// 3. One instrument: scroll the staff list, tick near the bottom, the list stays put (BUG-119).
await page.getByTestId(`instrument-panel-assign-${xn1000}`).click();
await page.getByText(/Who runs/i).waitFor({ timeout: 10000 });
const dlg = page.getByRole("dialog");
await page.locator('[data-testid^="instrument-assign-staff-"]').first().waitFor({ timeout: 10000 });
const box = dlg.locator("div.overflow-y-auto").filter({ has: page.locator('[data-testid^="instrument-assign-staff-"]') }).last();
check("the staff list is long enough to scroll", await box.evaluate((el) => el.scrollHeight > el.clientHeight + 20));
await box.evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(250);
const before = await box.evaluate((el) => el.scrollTop);
const boxes = box.locator('[data-testid^="instrument-assign-staff-"]');
const n = await boxes.count();
await boxes.nth(n - 2).click();
await page.waitForTimeout(400);
const after1 = await box.evaluate((el) => el.scrollTop);
await boxes.nth(n - 1).click();
await page.waitForTimeout(400);
const after2 = await box.evaluate((el) => el.scrollTop);
check("ticking a person near the bottom leaves the list where it was", before > 50 && Math.abs(after1 - before) < 5 && Math.abs(after2 - before) < 5, `scrollTop before ${before}, after 1st ${after1}, after 2nd ${after2}`);
check("both ticks registered", /^2 selected/.test((await page.getByTestId("instrument-assign-count").innerText()).trim()));

// 4. Select all and Clear on the staff list, filtered and not.
await page.getByTestId("instrument-assign-select-all").click();
check("Select all ticks everyone", /^40 selected/.test((await page.getByTestId("instrument-assign-count").innerText()).trim()));
await page.getByTestId("instrument-assign-staff-filter").fill("Abbott");
check("the staff filter narrows Select all", /Select all filtered \(10\)/.test(await page.getByTestId("instrument-assign-select-all").innerText()));
await page.getByTestId("instrument-assign-clear").click();
check("Clear filtered takes off only the filtered people", /^30 selected/.test((await page.getByTestId("instrument-assign-count").innerText()).trim()));
await page.getByTestId("instrument-assign-staff-filter").fill("");
await page.getByTestId("instrument-assign-clear").click();
check("Clear takes off everyone", /^0 selected/.test((await page.getByTestId("instrument-assign-count").innerText()).trim()));
await page.screenshot({ path: path.join(OUT, "assign-one-instrument-select-all.png") });
await boxes.nth(0).click();
await boxes.nth(1).click();
await page.getByTestId("instrument-assign-save").click();
await dlg.waitFor({ state: "hidden", timeout: 10000 });
check("Save assigns the two people and closes", pairs(xn1000) === 2, `rows ${pairs(xn1000)}`);
await page.getByTestId("instrument-panel-filter").fill("");
await page.waitForFunction((id) => document.querySelector(`[data-testid="instrument-panel-count-${id}"]`)?.textContent?.trim() === "2 staff", xn1000, { timeout: 10000 });
check("the row now says 2 staff", true);

// 5. Several instruments: the staff picked go on all of them, and nobody comes off.
const assignedBefore = (await new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT employee_id FROM staff_employee_instruments WHERE instrument_id = ?").all(xn1000)).map((r) => r.employee_id);
await page.getByTestId(`instrument-panel-tick-${xn1000}`).click();
await page.getByTestId(`instrument-panel-tick-${xn450}`).click();
check("the button counts what's ticked", /Assign staff to 2 selected/.test(await page.getByTestId("instrument-panel-assign-ticked").innerText()));
await page.screenshot({ path: path.join(OUT, "assign-tab-two-ticked.png") });
await page.getByTestId("instrument-panel-assign-ticked").click();
await dlg.getByText("Assign staff to 2 instruments").waitFor({ timeout: 10000 });
await page.locator('[data-testid^="instrument-assign-staff-"]').first().waitFor({ timeout: 10000 });
const names = await page.getByTestId("instrument-assign-names").innerText();
check("the dialog names both instruments", /XN-1000/.test(names) && /XN-450/.test(names), names);
check("it says nobody comes off", await dlg.getByText(/Nobody comes off/).isVisible());
check("nobody starts ticked, and Save waits for a pick", /^0 selected/.test((await page.getByTestId("instrument-assign-count").innerText()).trim()) && await page.getByTestId("instrument-assign-save").isDisabled());
check("someone already on one says so", /Already on 1 of 2/.test(await page.getByTestId(`instrument-assign-on-${assignedBefore[0]}`).innerText()));
// Pick two people who aren't on anything yet, and leave the first two unticked.
const fresh = sql("SELECT e.id FROM staff_employees e WHERE e.tier2_lab_id = ? AND e.last_name = 'Diaz' AND e.first_name = 'Ana'", labId).id;
const fresh2 = sql("SELECT e.id FROM staff_employees e WHERE e.tier2_lab_id = ? AND e.last_name = 'Diaz' AND e.first_name = 'Ben'", labId).id;
await page.getByTestId(`instrument-assign-staff-${fresh}`).click();
await page.getByTestId(`instrument-assign-staff-${fresh2}`).click();
await page.waitForTimeout(400);
check("Save is on screen without scrolling the dialog", await page.getByTestId("instrument-assign-save").evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom <= window.innerHeight && r.top >= 0; }));
await page.screenshot({ path: path.join(OUT, "assign-several-instruments.png") });
await page.getByTestId("instrument-assign-save").click();
await dlg.waitFor({ state: "hidden", timeout: 10000 });
const toast = await page.getByText(/2 staff on 2 instruments/).first().innerText({ timeout: 10000 }).catch(() => "");
check("the message says what happened", /2 staff on 2 instruments: 4 new, 0 already in place/.test(toast), toast);
check("the two people are on both instruments", pairs(xn1000) === 4 && pairs(xn450) === 2, `XN-1000 ${pairs(xn1000)}, XN-450 ${pairs(xn450)}`);
check("nobody came off the first instrument", assignedBefore.every((id) => sql("SELECT COUNT(*) n FROM staff_employee_instruments WHERE instrument_id = ? AND employee_id = ?", xn1000, id).n === 1));
check("an instrument not ticked is left alone", pairs(cobas) === 0);
check("the ticks clear after saving", await page.getByTestId("instrument-panel-assign-ticked").isDisabled() && !(await page.getByTestId(`instrument-panel-tick-${xn1000}`).isChecked()));
await page.waitForFunction((id) => document.querySelector(`[data-testid="instrument-panel-count-${id}"]`)?.textContent?.trim() === "4 staff", xn1000, { timeout: 10000 });
check("the counts on the list update", (await page.getByTestId(`instrument-panel-count-${xn450}`).innerText()).trim() === "2 staff");
// A list opened after a change from the person's side reads fresh, so saving it can't undo that change.
await page.getByTestId(`instrument-panel-assign-${xn450}`).click();
await page.locator('[data-testid^="instrument-assign-staff-"]').first().waitFor({ timeout: 10000 });
await dlg.getByRole("button", { name: "Cancel" }).click();
const late = sql("SELECT e.id FROM staff_employees e WHERE e.tier2_lab_id = ? AND e.last_name = 'Chen' AND e.first_name = 'Ana'", labId).id;
await call("PUT", `${L}/staff/employees/${late}/instruments`, { instrumentIds: [xn450] }, owner.token);
await page.getByTestId(`instrument-panel-assign-${xn450}`).click();
await page.locator(`[data-testid="instrument-assign-staff-${late}"][data-state="checked"]`).waitFor({ timeout: 10000 }).catch(() => {});
check("reopening reads fresh after a change from the person's side", await page.getByTestId(`instrument-assign-staff-${late}`).isChecked());
await dlg.getByRole("button", { name: "Cancel" }).click();
await page.close();

// 6. The other doors: the deep link, the person's picker, a VeritaMap card, a VeritaMaintain row.
const deep = await open("/veritastaff-app?tab=instruments");
check("the Instruments tab has a link of its own", await deep.getByTestId("instrument-panel").isVisible());
await deep.close();
const person = await open(`/veritastaff-app/${fresh}`);
await person.getByRole("heading", { name: "Assigned Instruments" }).waitFor({ timeout: 15000 });
await person.locator("div", { has: person.getByRole("heading", { name: "Assigned Instruments" }) }).getByRole("button", { name: "Edit" }).last().click();
await person.getByTestId("instruments-picker-by-instrument").waitFor({ timeout: 10000 });
await person.getByTestId("instruments-picker-by-instrument").click();
await person.getByTestId("instrument-panel").waitFor({ timeout: 15000 });
check("the person's picker points to the instruments list", person.url().includes("tab=instruments"), person.url());
await person.close();
const mapPage = await open(`/veritamap-app/${map.id}/build`);
const mapBtn = mapPage.getByTestId(`map-assign-staff-${xn450}`);
await mapBtn.waitFor({ timeout: 15000 }).catch(() => {});
check("the VeritaMap instrument list has Assign staff", await mapBtn.isVisible());
await mapBtn.scrollIntoViewIfNeeded();
await mapPage.screenshot({ path: path.join(OUT, "assign-veritamap-list.png") });
await mapBtn.click();
await mapPage.getByText(/Who runs/i).waitFor({ timeout: 10000 });
check("the button opens that instrument's staff", /XN-450/.test(await mapPage.getByRole("dialog").innerText()));
await mapPage.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
await mapPage.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 });
await mapPage.getByRole("button", { name: "Next: Select Tests" }).click();
const cardBtn = mapPage.getByTestId(`map-assign-staff-${xn450}`);
await cardBtn.waitFor({ timeout: 15000 }).catch(() => {});
check("the test selection card has Assign staff", await cardBtn.isVisible());
const cardOpenBefore = await mapPage.getByPlaceholder("Search tests…").count();
await cardBtn.click();
await mapPage.getByText(/Who runs/i).waitFor({ timeout: 10000 });
await mapPage.locator('[data-testid^="instrument-assign-staff-"]').first().waitFor({ timeout: 10000 });
await mapPage.getByTestId("instrument-assign-staff-filter").click();
await mapPage.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
await mapPage.getByRole("dialog").waitFor({ state: "hidden", timeout: 10000 });
check("clicking in the dialog leaves the card as it was", (await mapPage.getByPlaceholder("Search tests…").count()) === cardOpenBefore);
await cardBtn.scrollIntoViewIfNeeded();
await mapPage.screenshot({ path: path.join(OUT, "assign-veritamap-card.png") });
await mapPage.close();
const eq = await call("POST", `${L}/equipment`, { instrument_name: "Sysmex XN-450", map_instrument_id: xn450, pm_interval_days: 180 }, owner.token);
const eqPlain = await call("POST", `${L}/equipment`, { instrument_name: "Tissue floater", pm_interval_days: 180 }, owner.token);
const eqPage = await open("/equipment-app");
const eqBtn = eqPage.getByTestId(`equip-assign-staff-${eq.id}`);
await eqBtn.waitFor({ timeout: 15000 }).catch(() => {});
check("a VeritaMaintain row linked to a map has Assign staff", await eqBtn.isVisible());
check("a row with no map link doesn't", (await eqPage.getByTestId(`equip-assign-staff-${eqPlain.id}`).count()) === 0);
await eqBtn.click();
await eqPage.getByText(/Who runs/i).waitFor({ timeout: 10000 });
await eqPage.waitForTimeout(500);
await eqPage.screenshot({ path: path.join(OUT, "assign-veritamaintain-row.png") });
await eqPage.close();

// 7. Dark mode and phone width.
const dark = await open("/veritastaff-app?tab=instruments", { scheme: "dark" });
await dark.getByTestId(`instrument-panel-tick-${xn1000}`).click();
await dark.getByTestId(`instrument-panel-tick-${cobas}`).click();
await dark.getByTestId("instrument-panel-assign-ticked").click();
await dark.locator('[data-testid^="instrument-assign-staff-"]').first().waitFor({ timeout: 10000 });
check("dark mode: the dialog renders on a dark page", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await dark.screenshot({ path: path.join(OUT, "assign-dark.png") });
await dark.close();
const phone = await open("/veritastaff-app?tab=instruments", { viewport: { width: 375, height: 800 } });
await phone.getByTestId("instrument-panel").waitFor({ timeout: 10000 });
check("phone width: the page doesn't scroll sideways", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phone.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await phone.screenshot({ path: path.join(OUT, "assign-phone.png") });
await phone.close();
const phoneMap = await open(`/veritamap-app/${map.id}/build`, { viewport: { width: 375, height: 800 } });
await phoneMap.getByTestId(`map-assign-staff-${xn450}`).waitFor({ timeout: 15000 }).catch(() => {});
check("phone width: the VeritaMap page doesn't scroll sideways", await phoneMap.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phoneMap.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
await phoneMap.screenshot({ path: path.join(OUT, "assign-phone-veritamap.png") });
await phoneMap.close();

// 8. A lab that can't edit: no button on the map, and the list reads but can't be ticked.
sql("UPDATE labs SET subscription_status = 'canceled', subscription_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", labId);
sql("UPDATE users SET subscription_status = 'canceled', subscription_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", uid);
const ro = await open(`/veritamap-app/${map.id}/build`);
await ro.waitForTimeout(1500);
check("read-only: no Assign staff on the map card", (await ro.getByTestId(`map-assign-staff-${xn450}`).count()) === 0);
await ro.close();
const roTab = await open("/veritastaff-app?tab=instruments");
await roTab.waitForTimeout(1500);
if (await roTab.getByTestId("instrument-panel").count()) {
  check("read-only: the list reads but can't be ticked or assigned", await roTab.getByTestId(`instrument-panel-tick-${xn1000}`).isDisabled() && await roTab.getByTestId(`instrument-panel-assign-${xn1000}`).isDisabled());
} else {
  check("read-only: the list reads but can't be ticked or assigned", false, "panel not shown");
}
await roTab.close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
