// tests/playwright/resource-getting-started.spec.ts
//
// Gate 3 step 8 for the public "Getting Started with VeritaAssure" Resources
// page (/resources/getting-started), added 2026-10-06. Public page, so it needs
// no auth; env-gated (PW_GETTING_STARTED) so CI stays compile-only. Run live:
//   PW_GETTING_STARTED=1 npx playwright test tests/playwright/resource-getting-started.spec.ts
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const RUN = process.env.PW_GETTING_STARTED === "1";

test.describe("Resources: Getting Started guide", () => {
  test("renders the setup path and per-module checklists", async ({ page }) => {
    test.skip(!RUN, "PW_GETTING_STARTED not set — skipping live page check");
    await page.goto(`${BASE}/resources/getting-started`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: /Getting Started with VeritaAssure/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The setup path" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "By module" })).toBeVisible();
    // A module card and the print control are present.
    await expect(page.getByText("VeritaCheck™", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Print or save as PDF/i })).toBeVisible();

    // Copy rule: no em dash on a customer-facing page.
    const body = await page.locator("body").innerText();
    expect(body, "no em dash on the page").not.toContain("—");
  });
});
