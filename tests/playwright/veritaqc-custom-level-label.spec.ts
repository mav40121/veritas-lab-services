// tests/playwright/veritaqc-custom-level-label.spec.ts
//
// Gate 3 step 8 browser exercise for VeritaQC custom control-level labels.
// The "Level" field in the Add control lot dialog used to be a fixed Low/Mid/
// High dropdown, so a lab whose clients report Level 1 / Level 2 (Gameday /
// MedStar, 2026-09-21) could not use their own nomenclature. It is now a
// free-text label with Low / Mid / High kept as quick-picks; the server
// accepts any trimmed label up to 24 chars.
//
// Opens the Add control lot dialog, confirms the level is a text input (not a
// dropdown), confirms a quick-pick sets the canonical value, types a custom
// label, and asserts the POST carries that label verbatim. The control-lots
// POST is stubbed so nothing real is written.
//
// Env: PW_BASE, PW_TOKEN (a VeritaQC owner/admin), PW_QC_LAB (a subscribed lab).
// Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_QC_LAB || "";

test.describe("VeritaQC — custom control-level labels", () => {
  test("accepts a free-text level and sends it verbatim", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_QC_LAB (a subscribed lab).");
      return;
    }

    // Stub the add-lot POST so a click never writes real data, and capture it.
    let sentLevel: string | null = null;
    await page.route(/\/api\/labs\/\d+\/qc\/control-lots$/, async route => {
      const body = JSON.parse(route.request().postData() || "{}");
      sentLevel = body.level ?? null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, lot: { id: 999999, analyte: body.analyte, level: body.level, lot_number: body.lot_number, mfr_mean: body.mfr_mean, mfr_sd: body.mfr_sd, mfr_sd_interval: 2, status: "active" } }),
      });
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritaqc-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Open the Add control lot dialog (the first trigger with that name).
    await page.getByRole("button", { name: /Add control lot/i }).first().click();
    await expect(page.getByText(/Add control lot/i).first()).toBeVisible({ timeout: 8000 });

    const dialog = page.getByRole("dialog");
    const levelInput = dialog.locator("#new-level");

    // The level is a text input now, not a dropdown/combobox.
    await expect(levelInput).toBeVisible();
    await expect(levelInput).toHaveJSProperty("tagName", "INPUT");

    // A quick-pick sets the canonical lowercase value (existing-line continuity).
    await dialog.getByRole("button", { name: /^low$/i }).click();
    await expect(levelInput).toHaveValue("low");

    // A custom label is accepted verbatim.
    await levelInput.fill("Level 1");
    await expect(levelInput).toHaveValue("Level 1");

    await dialog.locator("#new-analyte").fill("Glucose");
    await dialog.locator("#new-lot-number").fill("PWQC-LVL-1");
    await dialog.locator("#new-mean").fill("100");
    await dialog.locator("#new-sd").fill("3");

    await dialog.getByRole("button", { name: /^Add control lot$/ }).click();

    await expect.poll(() => sentLevel, { timeout: 8000 }).toBe("Level 1");
  });
});
