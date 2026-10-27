// tests/playwright/lab-time-zone-pages.spec.ts
//
// Gate 3 step 8 receipt for the per-lab time zone on the pages (Michael 2026-10-26, option 1). A lab is set to Guam
// (UTC+10, a day ahead of the US for most hours); the VeritaCheck new-study form's default Study Date must be GUAM's
// calendar day, not the computer's or the UTC day. Then the lab is set to American Samoa (UTC-11) and the same form
// must follow it.
//
// Seeds its own made-up account and lab through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test admin
// secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test lab-time-zone-pages

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);
const dayIn = (tz: string) => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
};

test("a page's default date is the lab's calendar day", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-tzp-${Date.now()}@example.com`;
  const password = ["Pw", "tzp", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW TZ Pages", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const setZone = async (tz: string) => {
    const r = await request.post(`${BASE}/api/admin/update-lab`, { data: { secret: ADMIN, labId, timeZone: tz } });
    expect(r.ok()).toBeTruthy();
  };

  await injectAuth(page, BASE, token);
  for (const tz of ["Pacific/Guam", "Pacific/Pago_Pago"]) {
    await setZone(tz);
    // The lab list loads (NavBar keeps the active lab's zone), then the form opens on a full page load.
    await page.goto(`${BASE}/labs/${labId}/veritacheck`);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("veritas_active_lab_tz")), { timeout: 20000 }).toBe(tz);
    await page.goto(`${BASE}/labs/${labId}/study/new`);
    const date = page.getByTestId("study-date");
    await expect(date).toBeVisible({ timeout: 20000 });
    await expect(date).toHaveValue(dayIn(tz));
    console.log(`  ${tz}: form default ${await date.inputValue()} (lab day ${dayIn(tz)}; UTC day ${new Date().toISOString().slice(0, 10)})`);
  }
  await page.screenshot({ path: "test-results/lab-time-zone-pages.png" });
});
