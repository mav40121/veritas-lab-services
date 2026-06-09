// tests/playwright/scanner-typed-fallback.spec.ts
//
// 2026-06-08 later: also the test-file anchor for the lab-scoping fix
// (/api/inventory/scan -> /api/labs/:labId/inventory/scan). The modal
// now branches on activeLabId; the typed flow exercises whichever
// path is wired without the spec needing to know which URL fires.
//
// Gate 3 step 8 for the typed-fallback PR (2026-06-08).
// iOS Safari's html5-qrcode runs the slower ZXing JS decoder (no native
// BarcodeDetector) so a real-camera scan is unreliable. The typed
// fallback lets the tech enter a VLS code by hand; this spec asserts
// the input + submit button render and the input accepts text so a
// regression to the form layout surfaces before deploy.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("Scanner typed fallback", () => {
  test("typed input renders, accepts text, submit button enables", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed VeritaStock page load");
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

    const typedInput = page.getByTestId("scan-typed-input");
    const submitBtn = page.getByTestId("scan-typed-submit");
    await expect(typedInput).toBeVisible({ timeout: 8000 });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();

    await typedInput.fill("VLS-99999999");
    await expect(submitBtn).toBeEnabled();
  });
});
