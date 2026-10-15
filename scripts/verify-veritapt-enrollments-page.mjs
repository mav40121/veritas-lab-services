// scripts/verify-veritapt-enrollments-page.mjs
//
// Receipt for the dedicated VeritaPT enrollments screen (Michael 2026-10-12: "I do not want the overlay, i want its
// own screen"). LOCAL server + scratch DB only. A lab with 40 enrollments:
//   1. Manage Enrollments opens /labs/:id/veritapt/enrollments, a page, with no dialog
//   2. all 40 rows render and the last one can be scrolled into view (page scroll, not a clipped overlay)
//   3. the filter narrows the list; the vendor filter works
//   4. Add Enrollment adds a row and stays on the screen; Remove deletes one
//   5. the back link returns to the VeritaPT app; light, dark and 390px render with no horizontal scroll
//   6. (Redington 10/12) the Program Name picker is searchable by code or name: "JAT" ranks JAT first, then JATE1;
//      "transfusion" finds the transfusion programs; "151" ranks API 151 first; picking a program fills its category.
//      The scratch catalog rows below are TEST FIXTURES in the local scratch DB only (never production).
// Run: PW_BASE=http://localhost:5166 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritapt-enrollments-page.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };

const email = `pt-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "PT Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "PT Enrollment Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
// VeritaPT shows its empty state (no buttons) until the lab has a VeritaMap test menu.
const mapId = (await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Core" }, owner.token)).id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [{ analyte: "Glucose", specialty: "General Chemistry", complexity: "MODERATE", active: 1 }, { analyte: "Potassium", specialty: "General Chemistry", complexity: "MODERATE", active: 1 }] },
] });
// Scratch-DB catalog fixtures for check 6 (local test data only).
await call("POST", "/api/admin/veritapt/vendor-programs", { secret: ADMIN, programs: [
  { vendor: "CAP", programCode: "J", programName: "Transfusion Medicine-Comprehensive", ptCategory: "Blood Bank / Immunohematology", analytes: [], source: "test fixture" },
  { vendor: "CAP", programCode: "JAT", programName: "Transfusion Medicine-Automated", ptCategory: "Blood Bank / Immunohematology", analytes: [], source: "test fixture" },
  { vendor: "CAP", programCode: "JATE1", programName: "Transfusion Med-Automated EDU Challenge", ptCategory: "Blood Bank / Immunohematology", analytes: [], source: "test fixture" },
  { vendor: "CAP", programCode: "C", programName: "Chemistry/Therapeutic Drug Monitoring", ptCategory: "General Chemistry", analytes: [], source: "test fixture" },
  { vendor: "CAP", programCode: "WBCR", programName: "Whole Blood Creatinine", ptCategory: "General Chemistry", analytes: [], source: "test fixture" },
  { vendor: "API", programCode: "151", programName: "Sperm Count", ptCategory: "Hematology", analytes: ["Sperm Count"], source: "test fixture" },
  { vendor: "API", programCode: "161", programName: "Sperm Motility (Virtual only)", ptCategory: "Hematology", analytes: ["Sperm Motility"], source: "test fixture" },
  { vendor: "API", programCode: "217", programName: "Coagulation", ptCategory: "Coagulation", analytes: ["APTT"], source: "test fixture" },
] });
const cats = ["General Chemistry", "Hematology", "Microbiology", "Immunology / Serology", "Coagulation"];
for (let i = 1; i <= 40; i++) {
  await call("POST", `/api/labs/${labId}/pt/enrollments`, { vendor: i % 4 === 0 ? "CAP" : "API", program_name: `Program ${String(i).padStart(2, "0")}`, pt_category: cats[i % cats.length], year_enrolled: 2026 }, owner.token);
}

const browser = await chromium.launch();
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, owner.token]);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); }, [owner.token, me]);
  const tag = `[${scheme} ${width}px]`;
  if (width === 1400 && scheme === "light") {
    await page.goto(`${BASE}/labs/${labId}/veritapt/app`, { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
    if (!(await page.getByTestId("pt-manage-enrollments").count())) {
      await page.screenshot({ path: `${OUT}/pt_app_no_button.png`, fullPage: true });
      console.log("DEBUG page text:", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 600));
    }
    await page.getByTestId("pt-manage-enrollments").click({ timeout: 8000 }); await page.waitForTimeout(1200);
    check(`1. ${tag} Manage Enrollments opens its own page, no dialog`, page.url().endsWith(`/labs/${labId}/veritapt/enrollments`) && (await page.locator("[role=dialog]").count()) === 0, page.url().replace(BASE, ""));
  } else {
    await page.goto(`${BASE}/labs/${labId}/veritapt/enrollments`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  }
  const rows = page.getByTestId("pt-enroll-row");
  const n = await rows.count();
  await rows.last().scrollIntoViewIfNeeded();
  const lastVisible = await rows.last().isVisible();
  const box = await rows.last().boundingBox();
  check(`2. ${tag} all 40 rows render and the last scrolls into view`, n === 40 && lastVisible && !!box && box.y >= 0 && box.y + box.height <= 900, `rows ${n}, last row y ${box ? Math.round(box.y) : "?"}`);
  check(`5. ${tag} no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/pt_enrollments_${scheme}_${width}.png`, fullPage: false });
  if (scheme === "dark") {
    // Dark mode: the open program search, to check contrast of the highlighted row and its code.
    await page.getByTestId("pt-enroll-vendor").click(); await page.getByRole("option", { name: "CAP", exact: true }).click(); await page.waitForTimeout(600);
    await page.getByTestId("pt-enroll-program-select").click(); await page.waitForTimeout(300);
    await page.getByTestId("pt-enroll-program-search").fill("JAT"); await page.waitForTimeout(300);
    check(`6d. ${tag} the program search opens in dark mode`, (await page.getByTestId("pt-enroll-program-option").count()) === 2);
    await page.screenshot({ path: `${OUT}/pt_program_search_jat_dark.png`, fullPage: false });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  }

  if (width === 1400 && scheme === "light") {
    await page.getByTestId("pt-enroll-filter").fill("Microbiology"); await page.waitForTimeout(300);
    const micro = await rows.count();
    await page.getByTestId("pt-enroll-filter").fill(""); await page.waitForTimeout(200);
    await page.getByTestId("pt-enroll-vendor-filter").click(); await page.getByRole("option", { name: "CAP" }).click(); await page.waitForTimeout(300);
    const capRows = await rows.count();
    await page.getByTestId("pt-enroll-vendor-filter").click(); await page.getByRole("option", { name: "All vendors" }).click(); await page.waitForTimeout(300);
    check(`3. ${tag} filter and vendor filter narrow the list`, micro === 8 && capRows === 10, `Microbiology ${micro}, CAP ${capRows}`);

    await page.getByTestId("pt-enroll-vendor").click(); await page.getByRole("option", { name: "Other" }).click(); await page.waitForTimeout(300);
    await page.getByTestId("pt-enroll-program-input").fill("Regional Blood Gas Survey");
    await page.getByTestId("pt-enroll-category").click(); await page.getByRole("option", { name: "General Chemistry" }).click();
    await page.getByTestId("pt-enroll-add").click(); await page.waitForTimeout(1500);
    const afterAdd = await rows.count();
    check(`4a. ${tag} Add Enrollment adds a row and stays on the screen`, afterAdd === 41 && page.url().endsWith("/veritapt/enrollments") && (await rows.filter({ hasText: "Regional Blood Gas Survey" }).count()) === 1, `rows ${afterAdd}`);
    await page.getByRole("button", { name: "Remove Regional Blood Gas Survey" }).click(); await page.waitForTimeout(300);
    await page.getByRole("button", { name: /^Remove$/ }).click(); await page.waitForTimeout(1500);
    const afterRemove = await rows.count();
    check(`4b. ${tag} Remove deletes it`, afterRemove === 40 && (await rows.filter({ hasText: "Regional Blood Gas Survey" }).count()) === 0, `rows ${afterRemove}`);

    // 6. Searchable Program Name picker.
    const opts = page.getByTestId("pt-enroll-program-option");
    const optTexts = async () => (await opts.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    await page.getByTestId("pt-enroll-vendor").click(); await page.getByRole("option", { name: "CAP", exact: true }).click(); await page.waitForTimeout(600);
    await page.getByTestId("pt-enroll-program-select").click(); await page.waitForTimeout(300);
    await page.getByTestId("pt-enroll-program-search").fill("JAT"); await page.waitForTimeout(300);
    const jat = await optTexts();
    await page.screenshot({ path: `${OUT}/pt_program_search_jat.png`, fullPage: false });
    await page.getByTestId("pt-enroll-program-search").fill("transfusion"); await page.waitForTimeout(300);
    const trans = await optTexts();
    await page.getByTestId("pt-enroll-program-search").fill("JAT"); await page.waitForTimeout(300);
    await opts.first().click(); await page.waitForTimeout(300);
    const picked = (await page.getByTestId("pt-enroll-program-select").innerText()).trim();
    const cat = (await page.getByTestId("pt-enroll-category-from-program").innerText()).trim();
    check(`6a. ${tag} CAP search "JAT": JAT first, then JATE1, nothing else; picking it fills the name and category`,
      jat.length === 2 && /Transfusion Medicine-Automated JAT$/.test(jat[0]) && /JATE1$/.test(jat[1]) && picked === "Transfusion Medicine-Automated (JAT)" && cat === "Blood Bank / Immunohematology",
      `${JSON.stringify(jat)} | picked "${picked}" | category "${cat}"`);
    check(`6b. ${tag} CAP search "transfusion" finds the three transfusion programs`, trans.length === 3 && trans.every((t) => /transfusion/i.test(t)), JSON.stringify(trans));
    await page.getByTestId("pt-enroll-vendor").click(); await page.getByRole("option", { name: "API", exact: true }).click(); await page.waitForTimeout(600);
    await page.getByTestId("pt-enroll-program-select").click(); await page.waitForTimeout(300);
    await page.getByTestId("pt-enroll-program-search").fill("151"); await page.waitForTimeout(300);
    const api151 = await optTexts();
    await page.getByTestId("pt-enroll-program-search").fill("zzz"); await page.waitForTimeout(300);
    const none = await opts.count();
    const emptyText = await page.getByText(/No API program matches/).count();
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    check(`6c. ${tag} API search "151" shows Sperm Count only; no match shows the empty message`, api151.length === 1 && /^Sperm Count 151$/.test(api151[0]) && none === 0 && emptyText === 1, `${JSON.stringify(api151)} | none ${none} empty ${emptyText}`);
    await page.getByTestId("pt-enrollments-back").click(); await page.waitForTimeout(1000);
    check(`5b. ${tag} back link returns to the VeritaPT app`, page.url().endsWith(`/labs/${labId}/veritapt/app`), page.url().replace(BASE, ""));
  }
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
