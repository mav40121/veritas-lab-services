// tests/playwright/veritastock-standalone-chrome.spec.ts
//
// The VeritaStock deployment is a standalone inventory product: no VeritaAssure
// compliance branding anywhere. The browser tab/SEO title must be VeritaStock on
// every page, and Account Settings must not show CLIA / accreditation / PT
// (lab-compliance) settings. The lab deployment keeps all of that.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-standalone-chrome

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const isStock = /veritastock/i.test(BASE);

test.describe("VeritaStock standalone chrome", () => {
  test("login page tab title is VeritaStock, not the lab compliance default", async ({ page }) => {
    test.skip(!BASE || !isStock, "run against the VeritaStock deployment");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    expect(await page.title()).not.toMatch(/Lab Compliance Software/i);
    expect(await page.title()).toMatch(/VeritaStock/i);
  });

  test("Account Settings hides CLIA / accreditation / PT on the stock deployment", async ({ page }) => {
    test.skip(!BASE || !isStock || !TOKEN, "needs PW_BASE (stock) + PW_TOKEN");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body).not.toMatch(/CLIA/);
    expect(body).not.toMatch(/Accreditation/i);
    expect(body).not.toMatch(/Proficiency Testing/i);
  });
});
