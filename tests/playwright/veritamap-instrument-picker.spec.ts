// tests/playwright/veritamap-instrument-picker.spec.ts
//
// Gate 3 step 8 for the VeritaMap instrument-picker cleanup. A design partner
// reported "Atellica wasn't a dropdown option" and fell to Other/Not Listed with
// zero tests, while the catalog actually carries "Siemens Atellica CH 930" (106
// tests). This drives the new type-to-search picker on a real build page and
// asserts the exact model is selectable with its full test menu.
//
// Env:
//   PW_BASE            base URL (default: prod)
//   PW_TOKEN           a logged-in veritas_token for an account with a map
//   PW_MAP_BUILD_PATH  path to a VeritaMap build page for a lab with a map,
//                      e.g. /labs/4/veritamap-app/61/build
//
// Skips cleanly when creds/path are absent so the smoke runner stays green.

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const BUILD_PATH = process.env.PW_MAP_BUILD_PATH || "";

async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaMap instrument picker: type-to-search", () => {
  test("typing 'Atellica' surfaces the exact catalog model and picking it shows its 106-test menu", async ({ page }) => {
    test.skip(!TOKEN || !BUILD_PATH, "PW_TOKEN + PW_MAP_BUILD_PATH required");

    await auth(page);
    await page.goto(`${BASE}${BUILD_PATH}`);

    // The new search box is the primary way to add an instrument.
    const search = page.getByPlaceholder(/Type an instrument/i);
    await expect(search).toBeVisible();
    await search.fill("Atellica");

    // The exact model the customer needed is selectable (not missing from the
    // dropdown as they believed) and carries its full test menu.
    const result = page.getByRole("button", { name: /Siemens Atellica CH 930/ }).first();
    await expect(result).toBeVisible();
    await expect(result).toContainText(/106 tests/);
    await result.click();

    // After picking, the selected chip confirms the model and its non-zero menu.
    await expect(page.getByText("Siemens Atellica CH 930")).toBeVisible();
    await expect(page.getByText(/106 tests/)).toBeVisible();
  });
});
