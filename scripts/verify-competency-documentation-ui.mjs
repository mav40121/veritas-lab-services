// scripts/verify-competency-documentation-ui.mjs
// Gate 3 browser receipt for the competency documentation fields (Michael Q74 = 1, plan part B, 2026-10-11).
// On a VeritaStaff employee page the owner opens "Update", records the person as a new hire with
// orientation/training (date, documented by, link), is stopped when the initial is dated before the
// training, fixes it, saves, and sees: Orientation/training card, Initial, 6-month due initial + 6,
// 1st annual due initial + 12, "Cleared ..." line. A second person recorded as existing staff with only
// the last annual shows "Existing staff" and no initial gap. Also proves typing in an Evaluator box keeps
// focus (the old dialog remounted its inputs on every keystroke).
// Run against a LOCAL server on a scratch database (it registers an owner and provisions a lab; never
// point it at production). Usage:
//   PW_BASE=http://localhost:5153 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-documentation-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5153", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `cdui-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Comp Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Competency Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
{ const d0 = new Database(process.env.SCRATCH_DB); d0.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId); d0.close(); } // TJC-accredited lab
await call("POST", `${L}/staff/lab`, { labName: "Competency Lab", cliaNumber: "11D7654322", accreditationBody: "TJC", complexity: "high" }, token);
const nora = (await call("POST", `${L}/staff/employees`, { lastName: "Hale", firstName: "Nora", title: "MLS", highestComplexity: "H", performsTesting: true, hireDate: "2026-01-05" }, token)).id;
const eli = (await call("POST", `${L}/staff/employees`, { lastName: "Moss", firstName: "Eli", title: "MLT", highestComplexity: "H", performsTesting: true, hireDate: "2012-06-01" }, token)).id;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
check("fixture: lab + 2 testing employees", !!labId && !!nora && !!eli, JSON.stringify({ labId, nora, eli }));

const browser = await chromium.launch();
const open = async (empId, dark = false) => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritastaff-app/${empId}`, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};

let page = await open(nora);
await page.getByTestId("comp-update").click();
const dlg = page.getByTestId("competency-dialog");
await dlg.waitFor({ timeout: 15000 });
const rows = await dlg.locator("[data-testid^='comp-row-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
check("dialog shows Initial, 6-Month, 1st Annual, Annual for a non-waived tester (Initial/1st Annual were TJC/CAP-only)", rows.join(",") === "comp-row-initial,comp-row-six-month,comp-row-first-annual,comp-row-annual", rows.join(","));
check("before any entry: 'Not cleared for patient testing until the initial competency is recorded'", /Not cleared for patient testing/.test(await page.getByTestId("comp-clearance").innerText()));
await page.getByTestId("comp-recorded-as-new_hire").check();
await page.getByTestId("comp-training-date").fill("2026-04-10");
await page.getByTestId("comp-training-by").fill("J. Trainer");
await page.getByTestId("comp-training-url").fill("https://example.sharepoint.com/training/nora-hale.pdf");
await page.getByTestId("comp-initial-date").fill("2026-04-06");
const by = page.getByTestId("comp-initial-by");
await by.click();
await page.keyboard.type("T. Supervisor", { delay: 15 });
check("typing in the Evaluator box keeps focus (whole name entered)", (await by.inputValue()) === "T. Supervisor", await by.inputValue());
await page.getByTestId("comp-save").click();
const toast = page.getByText(/is dated before orientation\/training was completed/).first();
await toast.waitFor({ timeout: 8000 }).catch(() => {});
check("initial dated before training is stopped with the reason, and the clearance line turns amber", await toast.isVisible().catch(() => false) && /dated before orientation\/training/.test(await page.getByTestId("comp-clearance").innerText()));
await page.screenshot({ path: `${OUT}/cdui_dialog_error_light.png` });
await page.getByTestId("comp-training-date").fill("2026-03-20");
await page.getByTestId("comp-six-month-date").fill("2026-10-20");
await page.getByTestId("comp-six-month-by").fill("T. Supervisor");
check("with training first, the clearance line reads 'Cleared for patient testing on 2026-04-06'", /Cleared for patient testing on 2026-04-06/.test(await page.getByTestId("comp-clearance").innerText()));
await page.getByText(/is dated before orientation\/training was completed/).first().waitFor({ state: "hidden", timeout: 12000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/cdui_dialog_light.png` });
await page.getByTestId("comp-save").click();
await dlg.waitFor({ state: "hidden", timeout: 10000 });
await page.waitForTimeout(800);
const training = (await page.getByTestId("comp-training-card").innerText()).replace(/\s+/g, " ");
check("card: Orientation / training completed 2026-03-20 by J. Trainer, with the record link", /2026-03-20/.test(training) && /J\. Trainer/.test(training) && /Training record/.test(training), training);
const cardText = (await page.locator("text=Competency Schedule").locator("xpath=ancestor::div[contains(@class,'p-5')][1]").innerText()).replace(/\s+/g, " ");
check("card: 6-month due 2026-10-06 (initial + 6) and 1st annual due 2027-04-06 (initial + 12)", /Due: 2026-10-06/.test(cardText) && /Due: 2027-04-06/.test(cardText), cardText.slice(0, 400));
check("card: 'Recorded as: New hire' and 'Cleared 2026-04-06'", /Recorded as: New hire/.test(cardText) && /Cleared 2026-04-06/.test(cardText));
const badge = (await page.getByTestId("comp-badge").innerText()).trim();
check("badge: Current (next due 2027-04-06)", badge === "Current", badge);
const card = page.locator("text=Competency Schedule").locator("xpath=ancestor::div[contains(@class,'p-5')][1]");
await card.scrollIntoViewIfNeeded();
const b = await card.boundingBox();
await page.screenshot({ path: `${OUT}/cdui_card_light.png`, clip: { x: 0, y: Math.max(0, (b?.y ?? 0) - 10), width: 1400, height: Math.min(420, (b?.height ?? 300) + 20) } });
await page.close();

page = await open(eli, true);
await page.getByTestId("comp-update").click();
await page.getByTestId("competency-dialog").waitFor({ timeout: 15000 });
await page.getByTestId("comp-recorded-as-existing").check();
check("existing staff: initial row reads 'Initial (if on file)' and clearance explains the existing-staff record", /Initial \(if on file\)/.test(await page.getByTestId("comp-row-initial").innerText()) && /Existing staff/.test(await page.getByTestId("comp-clearance").innerText()));
await page.getByTestId("comp-annual-date").fill("2026-03-01");
await page.getByTestId("comp-annual-by").fill("T. Supervisor");
await page.screenshot({ path: `${OUT}/cdui_dialog_existing_dark.png` });
await page.getByTestId("comp-save").click();
await page.getByTestId("competency-dialog").waitFor({ state: "hidden", timeout: 10000 });
await page.waitForTimeout(800);
const exText = (await page.locator("text=Competency Schedule").locator("xpath=ancestor::div[contains(@class,'p-5')][1]").innerText()).replace(/\s+/g, " ");
const exBadge = (await page.getByTestId("comp-badge").innerText()).trim();
check("existing staff card: 'Existing staff: testing before these records', annual due 2027-03-01, badge Current (no initial gap)", /Existing staff: testing before these records/.test(exText) && /Due: 2027-03-01/.test(exText) && exBadge === "Current", `${exBadge} | ${exText.slice(0, 300)}`);
const card2 = page.locator("text=Competency Schedule").locator("xpath=ancestor::div[contains(@class,'p-5')][1]");
const b2 = await card2.boundingBox();
await page.screenshot({ path: `${OUT}/cdui_card_existing_dark.png`, clip: { x: 0, y: Math.max(0, (b2?.y ?? 0) - 10), width: 1400, height: Math.min(420, (b2?.height ?? 300) + 20) } });
await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
