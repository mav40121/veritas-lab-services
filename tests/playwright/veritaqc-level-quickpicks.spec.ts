// tests/playwright/veritaqc-level-quickpicks.spec.ts
//
// Gate 3 step 8 browser exercise for the VeritaQC level quick-picks. Follow-up
// to the custom-label work: the Add control lot dialog shows the lab's own
// previously-used level labels as quick-pick chips beside Low / Mid / High, so
// a lab clicks its existing nomenclature (Normal / Abnormal, Level 1 / Level 2)
// instead of re-typing and drifting into near-duplicate control lines.
//
// Opens the Add control lot dialog and asserts every chip in the row beneath
// the level input (Low / Mid / High plus any previously-used custom labels)
// fills the level field with its own value when clicked. The add-lot POST is
// stubbed so nothing real is written.
//
// Env: PW_BASE, PW_TOKEN (a VeritaQC owner/admin), PW_QC_LAB (a subscribed lab).
// Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_QC_LAB || "";

test.describe("VeritaQC — level quick-picks", () => {
  test("chips (incl. previously-used labels) fill the level field", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_QC_LAB (a subscribed lab).");
      return;
    }

    // Stub the add-lot POST so a click never writes real data.
    await page.route(/\/api\/labs\/\d+\/qc\/control-lots$/, async route => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, lot: { id: 999999 } }) });
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritaqc-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    await page.getByRole("button", { name: /Add control lot/i }).first().click();
    const dialog = page.getByRole("dialog");
    const levelInput = dialog.locator("#new-level");
    await expect(levelInput).toBeVisible({ timeout: 8000 });

    // The chip row is the div immediately after the level input. Every chip,
    // including any previously-used custom label, fills the input with its own
    // text (textContent, not innerText, so CSS capitalize on Low/Mid/High does
    // not skew the comparison against the stored lowercase value).
    const chips = levelInput.locator("xpath=following-sibling::div[1]").locator("button");
    const count = await chips.count();
    expect(count, "at least Low / Mid / High chips present").toBeGreaterThanOrEqual(3);

    for (let i = 0; i < count; i++) {
      const label = ((await chips.nth(i).textContent()) || "").trim();
      await chips.nth(i).click();
      await expect(levelInput).toHaveValue(label);
    }
  });
});
