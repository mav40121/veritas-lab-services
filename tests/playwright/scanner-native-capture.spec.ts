// tests/playwright/scanner-native-capture.spec.ts
//
// Gate 3 step 8 for the native-camera-capture PR (2026-06-08).
// The actual capture-then-decode flow only reproduces on a real iPhone
// (Chromium's <input capture> doesn't open a real camera app). This
// spec asserts the button + hidden input render so a layout regression
// surfaces before deploy.
//
// 2026-06-08 hotfix 15:10 AZ: bind panel was scrolling off the top of
// iPhone viewport because the camera viewport + Tap to capture button
// kept rendering during bind mode. Both are now hidden when
// unknownBarcode is set so the bind panel header + item list fit on
// screen.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("Scanner native-camera capture button", () => {
  test("Tap to capture button + hidden file input render", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed page load");
      return;
    }
    await context.addInitScript(([tok]) => {
      try { window.localStorage.setItem("token", tok); } catch {}
    }, [TOKEN]);
    await context.grantPermissions(["camera"], { origin: BASE });

    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

    const scanBtn = page.getByTestId("open-scanner-button");
    if (!(await scanBtn.isVisible().catch(() => false))) {
      test.skip(true, "Scan Mode button not visible (lab may lack VeritaStock plan)");
      return;
    }
    await scanBtn.click();

    const captureBtn = page.getByTestId("scan-capture-button");
    await expect(captureBtn).toBeVisible({ timeout: 8000 });
    await expect(captureBtn).toContainText(/tap to capture/i);

    // The hidden file input must have capture=environment so iOS opens
    // the native camera app rather than the photo library.
    const captureInput = page.getByTestId("scan-capture-input");
    await expect(captureInput).toHaveAttribute("capture", "environment");
    await expect(captureInput).toHaveAttribute("accept", "image/*");
  });
});
