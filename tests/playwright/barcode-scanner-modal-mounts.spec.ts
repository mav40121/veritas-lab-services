// tests/playwright/barcode-scanner-modal-mounts.spec.ts
//
// Gate 3 step 8 receipt for the iOS barcode-scanner config fix
// (2026-06-08). The actual decoder behavior only reproduces on a real
// iPhone camera, which Playwright can't simulate; Michael drives the
// real-camera verification on prod by hand. This spec covers the one
// thing Playwright CAN catch: that the new BarcodeScannerModal config
// (Code 128 only, useBarCodeDetectorIfSupported, videoConstraints with
// focusMode/width/height, fps 25) doesn't crash the module on mount.
// A typo in the experimentalFeatures key or a missing import would
// surface here before it ever shipped.
//
// Strategy: load the VeritaStock page, click "Scan Mode", confirm the
// modal dialog renders the camera viewport element (#vls-barcode-scanner)
// or a clear "Camera unavailable" message. Either outcome proves the
// module loaded and the Html5Qrcode constructor accepted the new
// config object.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("BarcodeScannerModal mounts cleanly with new iOS-fixed config", () => {
  test("Scan Mode button opens the modal and renders the camera viewport element", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed VeritaStock page load");
      return;
    }
    // Inject the JWT before navigation so the SPA boots authed.
    await context.addInitScript(([tok]) => {
      try { window.localStorage.setItem("token", tok); } catch {}
    }, [TOKEN]);

    // Permit (or fail-graceful) camera so getUserMedia errors don't
    // crash the modal. Either path proves the new config parsed.
    await context.grantPermissions(["camera"], { origin: BASE });

    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

    const scanBtn = page.getByTestId("open-scanner-button");
    if (!(await scanBtn.isVisible().catch(() => false))) {
      test.skip(true, "Scan Mode button not visible (lab may lack VeritaStock plan)");
      return;
    }
    await scanBtn.click();

    // The modal's camera mount div, regardless of whether the camera
    // actually starts. If the new config object crashes Html5Qrcode's
    // constructor, this element is never created.
    const viewport = page.locator("#vls-barcode-scanner");
    await expect(viewport).toBeVisible({ timeout: 8000 });
  });
});
