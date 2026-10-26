// tests/playwright/iso-15189-accreditation.spec.ts
//
// Gate 3 step 8 receipt for parking lot #108 (2026-10-26): ISO 15189 as an add-on accreditation. Drives the real
// browser flow: tick "Also accredited to ISO 15189" in Account Settings and save; the choice survives a reload; then
// VeritaResponse's New Finding dialog offers "ISO 15189" and, once picked, a due-date box the lab fills in.
//
// Seeds its own made-up account and lab through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test
// admin secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test iso-15189-accreditation

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("ISO 15189 is saved as an add-on and offered as a finding accreditor with a lab-entered due date", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-iso-${Date.now()}@example.com`;
  const password = ["Pw", "iso", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW ISO Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "PW ISO Lab", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  expect(labId > 0).toBeTruthy();

  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/account/settings`);
  const iso = page.getByTestId("accreditation-iso");
  await expect(iso).toBeVisible({ timeout: 20000 });
  await expect(iso).not.toBeChecked();
  await iso.check();
  await iso.locator("xpath=ancestor::label/following-sibling::button[1]").click();
  await expect(page.getByText("Settings saved").first()).toBeVisible({ timeout: 15000 });
  await page.reload();
  await expect(page.getByTestId("accreditation-iso")).toBeChecked({ timeout: 20000 });
  await page.getByTestId("accreditation-iso").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/iso-15189-settings.png" });

  await page.goto(`${BASE}/labs/${labId}/veritaresponse`);
  await page.getByRole("button", { name: /New Finding/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "ISO 15189" }).click();
  await expect(dialog.getByTestId("iso-due-date")).toBeVisible();
  await expect(dialog).toContainText("Your ISO 15189 accreditation body sets the response time");
  await dialog.getByTestId("iso-due-date").fill("2026-12-01");
  await page.screenshot({ path: "test-results/iso-15189-new-finding.png" });

  // Dark mode: the app follows the system theme on load.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${BASE}/account/settings`);
  await expect(page.getByTestId("accreditation-iso")).toBeChecked({ timeout: 20000 });
  await page.getByTestId("accreditation-iso").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/iso-15189-settings-dark.png" });
});
