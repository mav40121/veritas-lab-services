// tests/playwright/veritastaff-ceu-tab.spec.ts
//
// Gate 3 step 8 browser evidence: VeritaCEU lives as a "Continuing Education" tab
// inside VeritaStaff (not a separate module). Loads the VeritaStaff roster,
// switches to the Continuing Education tab, and asserts the embedded CE dashboard
// (its own Team status / Find free CE sub-tabs) renders.
//
// Env: PW_BASE, PW_TOKEN (a user on a lab with VeritaStaff access), PW_CEU_LAB.
// Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_CEU_LAB || "";

test.describe("VeritaStaff - Continuing Education tab", () => {
  test("the CE tab renders the embedded VeritaCEU dashboard", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_CEU_LAB (a lab with VeritaStaff access).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /^Continuing Education$/i }).click();
    // The embedded dashboard's own sub-tabs confirm it rendered in place.
    await expect(page.getByRole("button", { name: /^Find free CE$/i })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /^Requirements$/i })).toBeVisible();
    // And the Staff tab switches back to the roster.
    await page.getByRole("button", { name: /^Staff$/i }).click();
    await expect(page.getByRole("button", { name: /add employee/i })).toBeVisible();
  });
});
