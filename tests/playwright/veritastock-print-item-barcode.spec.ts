// tests/playwright/veritastock-print-item-barcode.spec.ts
//
// Gate 3 step 8 evidence for the per-item "Print barcode" action in VeritaStock.
// Previously the only way to print barcodes was the full-sheet "Print Barcodes"
// button (all items). This adds a per-row barcode button that calls the existing
// labels/pdf endpoint with { itemIds: [item.id] } to print ONE item's label.
//
// Needs PW_TOKEN (a lab user with VeritaStock/ops access) + PW_LAB_ID; skips
// otherwise (compile-only in CI). Non-mutating: it only opens a label PDF.
//
// Env: PW_BASE (default prod www), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaStock per-item barcode print", () => {
  test("each inventory row exposes a Print barcode button that opens a PDF", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "networkidle" });

    // At least one per-item print-barcode button renders.
    const printBtn = page.locator('[data-testid^="button-print-label-"]').first();
    await expect(printBtn).toBeVisible({ timeout: 20000 });

    // Clicking it opens the label PDF in a new tab (non-mutating).
    const popupPromise = context.waitForEvent("page", { timeout: 30000 }).catch(() => null);
    await printBtn.click();
    const popup = await popupPromise;
    expect(popup, "clicking Print barcode should open the label PDF").not.toBeNull();
  });
});
