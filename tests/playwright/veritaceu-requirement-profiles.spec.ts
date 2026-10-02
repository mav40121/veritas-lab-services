// tests/playwright/veritaceu-requirement-profiles.spec.ts
//
// Gate 3 step 8 browser evidence for VeritaCEU phase 4: CE requirement profiles
// (client/src/pages/VeritaCeuAppPage.tsx Requirements tab + per-row assignment).
// Opens the page, switches to the Requirements tab, and asserts the management UI
// (add-profile control + profile list) renders. Assignment itself is exercised on
// the Team status tab's per-row dropdown.
//
// Env: PW_BASE, PW_TOKEN (a writer on a lab with VeritaStaff access), PW_CEU_LAB
// (that lab's id). Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_CEU_LAB || "";

test.describe("VeritaCEU requirement profiles", () => {
  test("the Requirements tab shows the profile manager", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_CEU_LAB (a lab with VeritaStaff access).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritaceu-app`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /^Requirements$/i }).click();
    await expect(page.getByText(/CE requirement profiles/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /add profile/i })).toBeVisible();
  });
});
