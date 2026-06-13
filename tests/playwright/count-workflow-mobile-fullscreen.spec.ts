// tests/playwright/count-workflow-mobile-fullscreen.spec.ts
//
// Gate 3 step 8 receipt for the InventoryCountWorkflow mobile-fullscreen
// fix (PR #680, 2026-06-09). Verifies that at mobile viewport (375x812,
// iPhone 13/14) the modal panel fills the screen, while at desktop
// viewport (1024+) the panel stays a centered max-w-md card.

import { test, expect, devices } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

// Strip defaultBrowserType: test.use() inside a describe cannot force a new
// worker (webkit), so emulate the iPhone 13 viewport/touch/UA under the
// configured browser (chromium in CI).
const { defaultBrowserType: _mobileBt, ...iPhone13 } = devices["iPhone 13"];

test.describe("InventoryCountWorkflow responsive sizing", () => {
  test.use({ ...iPhone13 });

  test("mobile: panel fills the viewport when modal opens", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    const trigger = page.getByTestId("open-count-workflow-button");
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();

    const modal = page.getByTestId("count-workflow-modal");
    await expect(modal).toBeVisible();

    // The inner white panel is the first child div of the modal container.
    // On mobile it should be at least 90% of the viewport width.
    const inner = modal.locator("> div").first();
    const innerBox = await inner.boundingBox();
    const viewport = page.viewportSize();
    expect(innerBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (innerBox && viewport) {
      expect(innerBox.width).toBeGreaterThan(viewport.width * 0.9);
      expect(innerBox.height).toBeGreaterThan(viewport.height * 0.8);
    }
  });
});

test.describe("InventoryCountWorkflow desktop sizing", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop: panel stays a centered max-w-md card", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    await page.getByTestId("open-count-workflow-button").click();
    const modal = page.getByTestId("count-workflow-modal");
    await expect(modal).toBeVisible();
    const inner = modal.locator("> div").first();
    const innerBox = await inner.boundingBox();
    expect(innerBox).not.toBeNull();
    if (innerBox) {
      // max-w-md is ~448px; allow some padding tolerance
      expect(innerBox.width).toBeLessThan(500);
    }
  });
});
