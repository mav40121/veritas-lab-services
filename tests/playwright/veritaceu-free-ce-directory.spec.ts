// tests/playwright/veritaceu-free-ce-directory.spec.ts
//
// Gate 3 step 8 browser evidence for VeritaCEU phase 2 (parking-lot #53): the
// "Find free CE" directory tab on the VeritaCEU dashboard
// (client/src/pages/VeritaCeuAppPage.tsx + client/src/lib/freeCeProviders.ts).
// Opens the page, switches to the directory tab, and asserts a known provider
// and its external link render.
//
// Env: PW_BASE, PW_TOKEN (a user on a lab with VeritaStaff access), PW_CEU_LAB
// (that lab's id). Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_CEU_LAB || "";

test.describe("VeritaCEU free-CE directory", () => {
  test("the Find free CE tab lists providers with external links", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_CEU_LAB (a lab with VeritaStaff access).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritaceu-app`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /find free ce/i }).click();

    // A category heading and a known provider with a real external link render.
    await expect(page.getByText(/Diagnostics vendor/i)).toBeVisible({ timeout: 10000 });
    const arup = page.getByRole("link", { name: /ARUP Laboratories Education/i });
    await expect(arup).toBeVisible();
    await expect(arup).toHaveAttribute("href", /aruplab\.com\/education/);
  });
});
