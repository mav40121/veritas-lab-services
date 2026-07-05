// tests/playwright/resource-reference-interval-verification.spec.ts
//
// Render guard for the reference interval verification resource article
// (/resources/verifying-reference-intervals). Public page, no auth. Confirms the
// article renders with its heading and its load-bearing EP28-A3c content, and
// that it is listed on the resources index. Runs against prod by default.
//
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Resource article: verifying reference intervals", () => {
  test("article renders with heading + key CLSI EP28-A3c content", async ({ page }) => {
    await page.goto(`${BASE}/resources/verifying-reference-intervals`);
    await expect(page.locator("h1")).toContainText("Verifying Reference Intervals");
    await expect(page.getByText("120 qualified reference individuals")).toBeVisible();
    await expect(
      page.getByText(/conventionally two of the twenty/i)
    ).toBeVisible();
    // The re-verify-on-method-change trigger must be present.
    await expect(page.getByText(/when the method changes, re-verify the interval/i)).toBeVisible();
  });

  test("article is listed on the resources index", async ({ page }) => {
    await page.goto(`${BASE}/resources`);
    await expect(
      page.getByText(/Verifying Reference Intervals When You Cannot Establish Them/i).first()
    ).toBeVisible();
  });
});
