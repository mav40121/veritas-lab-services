// tests/playwright/instrument-cap.spec.ts
//
// Guard: the Instruments / Methods section accepts up to 10 instruments (raised
// from 5 for non-comparison studies, 2026-07-23). Adds instruments until the
// cap and asserts Instrument 10 exists and the Add button then disables.
//
// Needs creds: PW_TOKEN + PW_LAB_ID. Skips cleanly without them.
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test instrument-cap

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaCheck setup: instrument cap is 10", () => {
  test("can add up to 10 instruments, then the Add button disables", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    // Default study type (calibration verification) shows the "Add" button and
    // was the type capped at 5.
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "networkidle" });

    const add = page.getByRole("button", { name: "Add", exact: true }).first();
    await expect(add).toBeVisible({ timeout: 15000 });

    // Two instruments exist by default; click Add until the cap is reached.
    for (let i = 0; i < 12; i++) {
      if (await add.isDisabled().catch(() => false)) break;
      await add.click();
      await page.waitForTimeout(100);
    }

    await expect(page.getByDisplayValue("Instrument 10")).toBeVisible();
    await expect(page.getByDisplayValue("Instrument 11")).toHaveCount(0);
    await expect(add).toBeDisabled();
  });
});
