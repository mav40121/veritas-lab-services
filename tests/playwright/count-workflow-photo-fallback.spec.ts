// tests/playwright/count-workflow-photo-fallback.spec.ts
//
// Gate 3 step 8 receipt for the InventoryCountWorkflow scanner tuning +
// photo-capture fallback (PR for "scanner is still not picking up the
// barcodes at all", 2026-06-09).
//
// What this asserts (the parts that DON'T require a real camera):
//   1. The new "Take a photo of the label" fallback button mounts when
//      the count workflow modal opens.
//   2. The button is wired to a hidden <input type="file" accept="image/*"
//      capture="environment">, which is the iOS Safari trigger for the
//      native camera with Live Text.
//
// What this CANNOT assert here:
//   - The live html5-qrcode pipeline successfully decoding a Code 128
//     barcode at higher fps + wider qrbox + 1920x1080 video constraints.
//     That needs a physical iPhone pointed at a real label and is the
//     human-in-the-loop half of Gate 3 (Michael confirms on prod).

import { test, expect, devices } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

// Strip defaultBrowserType so test.use() is legal inside the describe; emulate
// the iPhone 13 under the configured browser (chromium in CI).
const { defaultBrowserType: _photoBt, ...iPhone13 } = devices["iPhone 13"];

test.describe("InventoryCountWorkflow photo-capture fallback", () => {
  test.use({ ...iPhone13 });

  test("photo-capture button mounts on mobile when modal opens", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    const trigger = page.getByTestId("open-count-workflow-button");
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();

    const photoBtn = page.getByTestId("count-workflow-photo-capture");
    await expect(photoBtn).toBeVisible();
    await expect(photoBtn).toHaveText(/Take a photo of the label/i);
  });

  test("hidden photo input has capture=environment for native camera", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);
    await page.getByTestId("open-count-workflow-button").click();

    // The hidden input lives in the same modal subtree as the photo button.
    const fileInput = page.locator(
      'input[type="file"][accept="image/*"][capture="environment"]'
    );
    await expect(fileInput).toHaveCount(1);
  });

  test("scanner button still mounts alongside the new fallback", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);
    await page.getByTestId("open-count-workflow-button").click();

    await expect(page.getByTestId("count-workflow-open-scanner")).toBeVisible();
    await expect(page.getByTestId("count-workflow-photo-capture")).toBeVisible();
  });
});
