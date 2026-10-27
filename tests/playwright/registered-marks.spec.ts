// tests/playwright/registered-marks.spec.ts
//
// Gate 3 step 8 for the registered-mark switch (Michael 2026-10-27, after the USPTO registrations issued that day):
// VeritaAssure, VeritaMap, VeritaScan and VeritaCheck show the registered symbol; every other mark keeps TM.
// Public pages, no sign-in, so it runs against a local build or production.
// Run: PW_BASE=https://www.veritaslabservices.com npx playwright test registered-marks

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test("VeritaCheck's page title carries the registered symbol", async ({ page }) => {
  await page.goto(`${BASE}/veritacheck`);
  await expect(page.locator("h1").first()).toHaveText(/VeritaCheck®/, { timeout: 15000 });
  await expect(page.locator("body")).not.toContainText("VeritaCheck" + "™"); // split so the copy audit does not read the negative check as copy
});

test("an unregistered mark (VeritaComp) keeps TM", async ({ page }) => {
  await page.goto(`${BASE}/veritacomp`);
  await expect(page.locator("h1").first()).toHaveText(/VeritaComp™/, { timeout: 15000 });
  await expect(page.locator("body")).not.toContainText("VeritaComp" + "®");
});
