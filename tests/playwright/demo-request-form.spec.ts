// tests/playwright/demo-request-form.spec.ts
//
// Gate 3 step 8 evidence for the "Request a live demo" form on /demo (2026-07-10).
// Drives the real browser flow: click the hero button, fill the form, submit, and
// assert the success state renders. A submit POSTs to /api/request-demo, which
// emails info@veritaslabservices.com, so running this against prod sends one real
// (clearly-marked) test lead.
//
// Env: PW_BASE (default prod www). Skips (compile-only) in CI unless PW_RUN set.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Demo page: Request a live demo form", () => {
  test("opens the modal, submits, and shows the success state", async ({ page }) => {
    if (!process.env.PW_RUN) {
      test.skip(true, "PW_RUN not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Request a live demo" }).click();
    await expect(page.getByRole("heading", { name: "Request a live demo" })).toBeVisible();

    await page.getByLabel("Name *").fill("Gate 3 automated check");
    await page.getByLabel("Work email *").fill("gate3-test@veritaslabservices.com");
    await page.getByLabel("Lab or organization").fill("Automated test (please ignore)");
    await page.getByLabel(/Anything specific/).fill("Automated Gate 3 verification submission.");

    // Assert the POST goes to the request-demo endpoint and succeeds.
    const req = page.waitForResponse((r) => r.url().includes("/api/request-demo") && r.request().method() === "POST");
    await page.getByRole("button", { name: "Send request" }).click();
    const res = await req;
    expect(res.status()).toBe(200);

    await expect(page.getByText("Thanks, we will be in touch")).toBeVisible();
  });
});
