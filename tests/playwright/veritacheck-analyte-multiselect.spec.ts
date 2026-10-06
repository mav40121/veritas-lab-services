// tests/playwright/veritacheck-analyte-multiselect.spec.ts
//
// Gate 3 step 8 for the VeritaCheck instrument-verification multi-select analyte
// add (2026-10-06, after Michael reported adding analytes one at a time was
// cumbersome). The "Add analytes" button opens a multi-select of the instrument
// menu (sourced from fdaInstrumentData.json by instrument name, merged with any
// linked VeritaMap analytes); several can be picked and added at once.
// Authed + needs a verification package, so env-gated. Run live:
//   PW_TOKEN=... PW_VERIFICATION_PATH=/labs/3/dashboard/verifications \
//     npx playwright test tests/playwright/veritacheck-analyte-multiselect.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const VPATH = process.env.PW_VERIFICATION_PATH || "";

test.describe("VeritaCheck analyte multi-select", () => {
  test("Add analytes opens a multi-select of the instrument menu", async ({ page }) => {
    test.skip(!TOKEN || !VPATH, "PW_TOKEN / PW_VERIFICATION_PATH not set — skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${VPATH}`, { waitUntil: "networkidle" });

    await page.getByTestId("add-analyte-button").click();
    const dialog = page.getByTestId("analyte-multi-dialog");
    await expect(dialog, "multi-select dialog opens").toBeVisible();
    // At least one menu option is offered, and Select all enables the add button.
    await expect(dialog.getByTestId("analyte-menu-option").first()).toBeVisible();
    await dialog.getByRole("button", { name: "Select all" }).click();
    await expect(dialog.getByTestId("analyte-multi-add")).toBeEnabled();
  });
});
