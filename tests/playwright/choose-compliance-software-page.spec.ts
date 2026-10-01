// tests/playwright/choose-compliance-software-page.spec.ts
//
// Gate 3 step 8 browser evidence for the buyer-guide resource page
// (client/src/pages/ArticleChooseComplianceSoftwarePage.tsx, route
// /resources/how-to-choose-lab-compliance-software). It is a PUBLIC, no-auth
// page: loads the route, asserts the H1, the six-question body, the FAQ
// section, and the in-body links to /veritaassure and /pricing.
//
// PW_BASE defaults to prod; point it at a local build to run pre-deploy:
//   PW_BASE=http://127.0.0.1:5288 npx playwright test choose-compliance-software-page

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const PATH = "/resources/how-to-choose-lab-compliance-software";

test.describe("Buyer guide: How to Choose Lab Compliance Software", () => {
  test("renders the page, FAQ, and in-body product links", async ({ page }) => {
    await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 1, name: /How to Choose Lab Compliance Software/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Frequently Asked Questions/i })).toBeVisible();
    await expect(page.getByText(/What is lab compliance software\?/i)).toBeVisible();

    // In-body links from the "Where VeritaAssure fits" section.
    await expect(page.locator('a[href="/veritaassure"]').first()).toBeVisible();
    await expect(page.locator('a[href="/pricing"]').first()).toBeVisible();
  });
});
