// tests/playwright/veritaceu-dashboard.spec.ts
//
// Gate 3 step 8 browser evidence for VeritaCEU phase 1: the lab-wide continuing-
// education dashboard (client/src/pages/VeritaCeuAppPage.tsx, route
// /labs/:labId/veritaceu-app). Loads the page and asserts the dashboard heading,
// the summary band, and the "show only short" filter control render.
//
// Env: PW_BASE, PW_TOKEN (a user on a lab with VeritaStaff access), PW_CEU_LAB
// (that lab's id). Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_CEU_LAB || "";

test.describe("VeritaCEU lab-wide CE dashboard", () => {
  test("renders the roster dashboard with summary + filter", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_CEU_LAB (a lab with VeritaStaff access).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritaceu-app`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /VeritaCEU/i })).toBeVisible({ timeout: 10000 });
    // Summary band + the who's-short filter are the core dashboard affordances.
    await expect(page.getByText(/Cycle met/i).first()).toBeVisible();
    await expect(page.getByText(/show only staff who are short/i)).toBeVisible();
  });
});
