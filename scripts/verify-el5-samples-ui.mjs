// scripts/verify-el5-samples-ui.mjs
// Browser receipt for Element 5 "+ Add another sample" (Michael Q71 = 1, 2026-10-30; RFGH): on a person's competency
// page, Element 5 for one test system takes more than one blind / PT sample, each with its own type, ID and Acceptable
// box; samples save, come back after a reload, and can be removed. Made-up lab, analyzer and people on a scratch DB
// only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-el5-samples-ui.mjs
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

const email = `el5-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Element Five UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sample UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Sample UI Lab", cliaNumber: "11D7654381", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token);
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [
  { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const tech = await call("POST", `${L}/staff/employees`, { lastName: "Lane", firstName: "Robin", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const inst = sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Hemo Counter' AND map_id = ?").get(map.id);
sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tech.id, inst.id, new Date().toISOString());
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
check("setup: a made-up lab, one moderate analyzer, one tech assigned to it", !!inst?.id && !!tech?.id, `inst ${inst?.id}, tech ${tech?.id}`);
const row5 = () => sdb.prepare(
  "SELECT el5_sample_type t, el5_sample_id id, el5_acceptable a, el5_samples_json j FROM competency_assessment_items WHERE instrument_id = ? AND element_number = 5 AND signoff_id IS NULL"
).get(inst.id);

const browser = await chromium.launch();
const open = async (scheme) => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${tech.id}`, { waitUntil: "networkidle" });
  await page.getByTestId("element-5").waitFor({ timeout: 15000 });
  return page;
};
const rows = (page) => page.locator('[data-testid^="element-5-sample-"]');

// 1. One sample row to start, with the add button and no remove button.
const page = await open("light");
check("Element 5 starts with one sample row and an 'Add another sample' button, no remove",
  (await rows(page).count()) === 1 && await page.getByTestId("element-5-add-sample").isVisible() && (await page.getByTestId("element-5-remove-0").count()) === 0);

// 2. Fill sample 1, add sample 2 and a third left blank, then remove the blank one.
await page.getByTestId("element-5-sampleType-0").fill("PT");
await page.getByTestId("element-5-sampleId-0").fill("CAP-HE-A-01");
await page.getByTestId("element-5-acceptable-0").check();
await page.getByTestId("element-5-add-sample").click();
await page.getByTestId("element-5-sampleType-1").fill("Blind");
await page.getByTestId("element-5-sampleId-1").fill("BL-22");
await page.getByTestId("element-5-add-sample").click();
const three = await rows(page).count();
const label2 = await page.getByTestId("element-5-sample-1").locator("label").first().innerText();
await page.getByTestId("element-5-remove-2").click();
check("adding gives numbered rows with a remove button each; removing the blank third row leaves two",
  three === 3 && /Sample 2 type/.test(label2) && (await rows(page).count()) === 2, `rows after adds ${three}, label "${label2}"`);
await page.getByTestId("element-5").screenshot({ path: path.join(OUT, "el5-two-samples-light.png") });

// 3. Save; both samples are stored (sample 1 in the columns, both in the list).
await page.getByTestId("save-test-system").click();
await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 10000 });
const s3 = row5();
const list3 = s3?.j ? JSON.parse(s3.j) : [];
check("save stores sample 1 in the columns and both samples in the list",
  s3?.t === "PT" && s3?.id === "CAP-HE-A-01" && s3?.a === 1 && list3.length === 2 && list3[1].sampleId === "BL-22" && list3[1].acceptable === null,
  JSON.stringify(s3));

// 4. Reload: both rows come back with their values.
await page.reload({ waitUntil: "networkidle" });
await page.getByTestId("element-5").waitFor({ timeout: 15000 });
const back = [await page.getByTestId("element-5-sampleId-0").inputValue(), await page.getByTestId("element-5-sampleId-1").inputValue()];
const acc = [await page.getByTestId("element-5-acceptable-0").isChecked(), await page.getByTestId("element-5-acceptable-1").isChecked()];
check("after a reload both samples show with their IDs and Acceptable boxes", back.join(",") === "CAP-HE-A-01,BL-22" && acc[0] && !acc[1], `${back} ${acc}`);

// 5. Remove sample 1 and save: the blind sample becomes sample 1 and the list is cleared.
await page.getByTestId("element-5-remove-0").click();
await page.getByTestId("save-test-system").click();
await page.waitForTimeout(800);
const s5 = row5();
check("removing sample 1 and saving moves the other sample up, with no list left", s5?.id === "BL-22" && s5?.t === "Blind" && s5?.a == null && s5?.j == null, JSON.stringify(s5));
await page.close();

// 6. Dark mode: the rows and the add button render on the dark theme.
await call("PUT", `${L}/competency/employee/${tech.id}/test-system/${inst.id}`, { elements: [{ num: 5, passed: true, samples: [
  { sampleType: "PT", sampleId: "CAP-HE-A-01", acceptable: true }, { sampleType: "Blind", sampleId: "BL-22", acceptable: false },
] }] }, owner.token);
const dark = await open("dark");
await dark.evaluate(() => document.documentElement.classList.add("dark"));
const darkRows = await rows(dark).count();
await dark.getByTestId("element-5").screenshot({ path: path.join(OUT, "el5-two-samples-dark.png") });
check("dark mode shows both rows", darkRows === 2, String(darkRows));
await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
