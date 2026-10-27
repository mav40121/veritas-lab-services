// tests/playwright/lab-time-zone.spec.ts
//
// Gate 3 step 8 receipt for the per-lab time zone (Michael 2026-10-26, option 1). Drives Account Settings: a lab with
// no CLIA state shows "Automatic: Eastern" and is asked to confirm; picking Central and saving survives a reload, and
// "Today in the lab" is shown.
//
// Seeds its own made-up account and lab through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test admin
// secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test lab-time-zone

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("a lab picks its time zone in Account Settings", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-tz-${Date.now()}@example.com`;
  const password = ["Pw", "tz", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW TZ Owner", hipaa_acknowledged: true } })).json();
  await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } });
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/account/settings`);
  const picker = page.getByTestId("lab-time-zone");
  await expect(picker).toBeVisible({ timeout: 20000 });
  await expect(picker).toContainText("Automatic: Eastern");
  await expect(page.getByTestId("lab-time-zone-confirm")).toContainText("Pick your lab's time zone");
  await expect(page.getByTestId("lab-today")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

  await picker.click();
  await page.getByRole("option", { name: "Central", exact: true }).click();
  const [saved] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === "/api/account/settings" && r.request().method() === "PUT"),
    picker.locator("xpath=ancestor::div[contains(@class,'space-y-2')][1]/following-sibling::button[1]").click(),
  ]);
  expect(saved.ok(), `save ${saved.status()}`).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("lab-time-zone")).toContainText("Central", { timeout: 20000 });
  await expect(page.getByTestId("lab-time-zone-confirm")).toHaveCount(0);
  await page.getByTestId("lab-time-zone").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/lab-time-zone.png" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("lab-time-zone")).toContainText("Central", { timeout: 20000 });
  await page.getByTestId("lab-time-zone").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/lab-time-zone-dark.png" });
});
