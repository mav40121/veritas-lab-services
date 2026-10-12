// scripts/verify-veritapt-enrollments-page.mjs
//
// Receipt for the dedicated VeritaPT enrollments screen (Michael 2026-10-12: "I do not want the overlay, i want its
// own screen"). LOCAL server + scratch DB only. A lab with 40 enrollments:
//   1. Manage Enrollments opens /labs/:id/veritapt/enrollments, a page, with no dialog
//   2. all 40 rows render and the last one can be scrolled into view (page scroll, not a clipped overlay)
//   3. the filter narrows the list; the vendor filter works
//   4. Add Enrollment adds a row and stays on the screen; Remove deletes one
//   5. the back link returns to the VeritaPT app; light, dark and 390px render with no horizontal scroll
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
const owner = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "PT Owner", hipaa_acknowledged: true });
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
    await page.getByTestId("pt-enrollments-back").click(); await page.waitForTimeout(1000);
    check(`5b. ${tag} back link returns to the VeritaPT app`, page.url().endsWith(`/labs/${labId}/veritapt/app`), page.url().replace(BASE, ""));
  }
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
