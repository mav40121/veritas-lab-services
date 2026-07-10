// tests/playwright/demo-form-a11y.spec.ts
//
// Gate 3 step 8 evidence for the demo-request form label association (2026-07-10).
// The <label>/<input> pairs were unassociated siblings, so getByLabel (and screen
// readers) could not bind a label to its field. After adding htmlFor/id, each field
// is reachable by its label. This spec proves the binding WITHOUT submitting, so it
// sends no email.
//
// Env: PW_BASE (default prod www). Skips (compile-only) in CI unless PW_RUN set.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Demo request form: labels are associated with inputs", () => {
  test("every field is reachable via its label (a11y binding)", async ({ page }) => {
    if (!process.env.PW_RUN) {
      test.skip(true, "PW_RUN not set (compile-only gate run).");
      return;
    }
    await page.goto(`${BASE}/demo`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Request a live demo" }).click();
    await expect(page.getByRole("heading", { name: "Request a live demo" })).toBeVisible();

    for (const label of ["Name *", "Work email *", "Lab or organization", "Phone"]) {
      await expect(page.getByLabel(label), `"${label}" must be label-associated`).toBeVisible();
    }
    await expect(page.getByLabel(/Anything specific/), "message field must be label-associated").toBeVisible();
  });
});
