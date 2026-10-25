// scripts/verify-outside-records-ui.mjs
// Gate 3 browser receipt for Q16 (2026-10-24, Lifepoint Georgetown REQ-103): record studies done outside VeritaCheck
// from the Coverage page. Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and
// builds a small map, so never point it at production):
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-outside-records-ui.mjs
// Light: open the dialog from "Record outside studies", record an August cal ver for Sodium on Analyzer One with where
// the records are kept and who reviewed them; the row then reads Covered with an "Outside record" chip, the list shows
// it, and Remove (with a reason) takes it off again. Dark: the dialog and the chip render.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token, labId) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const email = `outside-ui-${stamp}@example.com`;
const pw = ["Oq", String(stamp).slice(-6), "y"].join("-") + "!"; // throwaway, scratch database only
const token = (await call("POST", "/api/auth/register", { email, password: pw, name: "Coverage Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Coverage Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token, labId);
const instA = await call("POST", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Analyzer One", category: "Chemistry" }, token, labId);
const instB = await call("POST", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Benchtop Two", category: "Chemistry" }, token, labId);
const t = (a) => ({ analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active: true });
await call("PUT", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${instA.id}/tests`, { tests: [t("Sodium"), t("Potassium")] }, token, labId);
await call("PUT", `/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${instB.id}/tests`, { tests: [t("Sodium")] }, token, labId);
const cov = await call("GET", `/api/labs/${labId}/veritacheck/coverage`, undefined, token, labId);
const naA = (cov.rows || []).find((r) => r.analyte === "Sodium" && r.instrument.startsWith("Analyzer One"));
check("scratch map built: Sodium on Analyzer One is a Coverage row", !!naA, JSON.stringify(cov).slice(0, 160));
const aug = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritacheck/coverage`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const btn = page.getByTestId("button-record-outside");
  await btn.waitFor({ timeout: 20000 });
  await btn.click();
  const dlg = page.getByTestId("outside-records-dialog");
  await dlg.waitFor({ timeout: 10000 });
  const dlgText = (await dlg.innerText()).replace(/\s+/g, " ");
  check(`${mode}: the dialog opens with the date, records location and reviewer fields and lists Sodium on Analyzer One`, /Record studies done outside VeritaCheck/.test(dlgText) && /Where the records are kept/.test(dlgText) && /Reviewed and accepted by/.test(dlgText) && /Sodium/.test(dlgText) && /Analyzer One/.test(dlgText), dlgText.slice(0, 200));
  check(`${mode}: Record stays disabled until every field and a test are filled`, await page.getByTestId("outside-save").isDisabled());
  if (mode === "light") {
    await page.getByTestId("outside-date").fill(aug);
    await page.getByTestId("outside-reviewed").fill("Dr. Pat Director");
    await page.getByTestId("outside-location").fill("Chemistry cal ver binder, August 2026");
    await page.getByTestId(`outside-pick-${naA.instrumentTestId}`).click();
    await page.screenshot({ path: `${OUT}/outside_dialog_filled_${mode}.png` });
    await page.getByTestId("outside-save").click();
    await page.waitForTimeout(1500);
    await page.getByTestId("lin-status-filter").click();
    await page.getByRole("option", { name: "All" }).click();
    await page.waitForTimeout(500);
    const chip = page.getByTestId(`cov-outside-${naA.instrumentTestId}`);
    const rowText = (await page.getByTestId(`cov-row-${naA.instrumentTestId}`).innerText().catch(() => "(no row)")).replace(/\s+/g, " ");
    check("after recording: Sodium on Analyzer One reads Covered with an Outside record chip", (await chip.isVisible().catch(() => false)) && /Covered/.test(rowText) && /Outside record/.test(rowText), rowText);
    check("the chip's tooltip names the records location and the reviewer", /Chemistry cal ver binder/.test(await chip.getAttribute("title") || "") && /Dr\. Pat Director/.test(await chip.getAttribute("title") || ""), await chip.getAttribute("title") || "");
    const otherRow = (await page.getByTestId(`cov-row-${(cov.rows || []).find((r) => r.analyte === "Sodium" && r.instrument.startsWith("Benchtop Two")).instrumentTestId}`).innerText()).replace(/\s+/g, " ");
    check("Sodium on Benchtop Two still reads Missing", /Missing/.test(otherRow) && !/Outside record/.test(otherRow), otherRow);
    await page.getByTestId("cov-outside-list").locator("summary").click();
    await page.waitForTimeout(300);
    const listText = (await page.getByTestId("cov-outside-list").innerText()).replace(/\s+/g, " ");
    check("the Recorded outside VeritaCheck list shows the record", /Recorded outside VeritaCheck \(1\)/.test(listText) && /Chemistry cal ver binder/.test(listText) && /Dr\. Pat Director/.test(listText) && new RegExp(aug).test(listText), listText.slice(0, 220));
    await page.getByTestId(`cov-row-${naA.instrumentTestId}`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/outside_covered_${mode}.png` });
    // Remove it again, with a reason.
    const voidBtn = page.locator("[data-testid^='cov-outside-void-']").first();
    await voidBtn.click();
    await page.getByTestId("outside-void-reason").fill("entered for the wrong instrument");
    await page.getByTestId("outside-void-confirm").click();
    await page.waitForTimeout(1500);
    const rowAfter = (await page.getByTestId(`cov-row-${naA.instrumentTestId}`).innerText()).replace(/\s+/g, " ");
    check("Remove with a reason puts the row back to Missing", /Missing/.test(rowAfter) && !/Outside record/.test(rowAfter), rowAfter);
  } else {
    await page.screenshot({ path: `${OUT}/outside_dialog_${mode}.png` });
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
