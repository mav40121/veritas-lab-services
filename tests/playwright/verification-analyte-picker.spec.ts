// tests/playwright/verification-analyte-picker.spec.ts
//
// Gate 3 smoke for the Analytes-tab FDA picker. The Add-Analyte dialog on an
// Instrument Verification package now offers a Select populated from the
// linked VeritaMap instrument's test menu (data-testid="analyte-menu-select"),
// instead of free-text only. Non-mutating: opens the dialog and asserts the
// picker renders, then cancels. Needs PW_TOKEN and a verification whose
// instrument has a mapped test menu; skips otherwise so it stays green in the
// compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_VERIF_LAB, PW_VERIF_ID.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_VERIF_LAB || "";
const VERIF = process.env.PW_VERIF_ID || "";

test.describe("Verification Analytes FDA picker", () => {
  test("Add-Analyte dialog offers the instrument test menu", async ({ page }) => {
    if (!TOKEN || !LAB || !VERIF) {
      test.skip(true, "Needs PW_TOKEN + PW_VERIF_LAB + PW_VERIF_ID (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/dashboard/verifications/${VERIF}`);
    // Switch to the Analytes tab, then open Add Analyte.
    await page.getByRole("tab", { name: /Analytes/i }).click().catch(async () => {
      await page.getByText(/^Analytes$/).first().click();
    });
    await page.getByTestId("add-analyte-button").click();
    // The FDA-cleared instrument menu picker should be present.
    await expect(page.getByTestId("analyte-menu-select")).toBeVisible();
    // Free-text fallback still present.
    await expect(page.getByTestId("analyte-name-input")).toBeVisible();
  });
});
