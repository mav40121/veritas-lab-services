// tests/playwright/count-workflow-native-scanner.spec.ts
//
// Gate 3 step 8 receipt for the BarcodeDetector + @zxing/browser rewrite
// (PR #682, 2026-06-09). html5-qrcode was failing on iPhone Safari and
// Chrome desktop — a dedicated barcode app on the same phone read the
// same label fine, so the broken piece was the library, not the camera
// or the label.
//
// What this asserts (structural — does NOT exercise the live decoder,
// which needs a real camera and label):
//   1. The scanner area renders a <video> element with the
//      count-workflow-scanner testid, not the old <div> target.
//   2. The video has playsinline + muted + autoplay (Safari iOS
//      requires playsinline + muted for in-page video; missing either
//      kicks the stream into the OS player and breaks the decoder).
//   3. Cancel scan still tears the scanner down cleanly.
//
// What this CANNOT assert here:
//   - Live BarcodeDetector or ZXing decode against a real Code 128
//     label. That requires Michael on his iPhone pointed at a real
//     label after deploy (Gate 3 step 8 human-in-the-loop half).

import { test, expect, devices } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("InventoryCountWorkflow native scanner pipeline", () => {
  test.use({
    ...devices["iPhone 13"],
    permissions: ["camera"],
  });

  test("scanner area renders a <video>, not a <div>", async ({ page, context }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await context.grantPermissions(["camera"], { origin: BASE });
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    await page.getByTestId("open-count-workflow-button").click();
    await page.getByTestId("count-workflow-open-scanner").click();

    const scanner = page.getByTestId("count-workflow-scanner");
    await expect(scanner).toBeVisible({ timeout: 5000 });

    // The new pipeline renders a <video>, the old html5-qrcode pipeline
    // rendered a <div> with an injected video child.
    const tag = await scanner.evaluate((el) => el.tagName);
    expect(tag).toBe("VIDEO");
  });

  test("video element has iOS-Safari-compatible attributes", async ({ page, context }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await context.grantPermissions(["camera"], { origin: BASE });
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    await page.getByTestId("open-count-workflow-button").click();
    await page.getByTestId("count-workflow-open-scanner").click();

    const scanner = page.getByTestId("count-workflow-scanner");
    await expect(scanner).toBeVisible({ timeout: 5000 });

    // Safari iOS requires both playsinline AND muted for in-page video.
    // Missing either kicks the stream into the OS fullscreen player and
    // the decoder loses access to the frames.
    const attrs = await scanner.evaluate((el) => ({
      playsInline: (el as HTMLVideoElement).playsInline,
      muted: (el as HTMLVideoElement).muted,
      autoplay: (el as HTMLVideoElement).autoplay,
    }));
    expect(attrs.playsInline).toBe(true);
    expect(attrs.muted).toBe(true);
    expect(attrs.autoplay).toBe(true);
  });

  test("cancel scan tears down cleanly and returns to scan-state UI", async ({ page, context }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await context.grantPermissions(["camera"], { origin: BASE });
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`);

    await page.getByTestId("open-count-workflow-button").click();
    await page.getByTestId("count-workflow-open-scanner").click();
    await expect(page.getByTestId("count-workflow-scanner")).toBeVisible({ timeout: 5000 });

    await page.getByTestId("count-workflow-cancel-scan").click();

    // After cancel, the Open scanner button is visible again.
    await expect(page.getByTestId("count-workflow-open-scanner")).toBeVisible();
    await expect(page.getByTestId("count-workflow-scanner")).toHaveCount(0);
  });
});
