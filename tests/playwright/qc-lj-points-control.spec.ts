// tests/playwright/qc-lj-points-control.spec.ts
//
// Gate 3 step 8 for the VeritaQC Levey-Jennings "Points" control (VeritaQCAppPage).
// The chart is no longer hard-capped at 20 points: it defaults to 30, and a header
// dropdown (20 / 30 / 50 / 100 / All) controls how many points render. The caption
// "Run sequence (oldest to newest, n=N)" reflects the selection.
//
// Gated on PW_TOKEN + PW_QC_URL (e.g. /labs/19/veritaqc-app for a lab whose selected
// control lot has >= 30 results). Compile-only in CI; the live click is the
// human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const QC_URL = process.env.PW_QC_URL || ""; // e.g. /labs/19/veritaqc-app

test.describe("VeritaQC Levey-Jennings: points control", () => {
  test("defaults to 30 and changing it updates the visible count", async ({ page }) => {
    if (!TOKEN || !QC_URL) { test.skip(true, "Set PW_TOKEN + PW_QC_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${QC_URL}`, { waitUntil: "networkidle" });

    // The control exists and defaults to 30 (was a hard 20-point cap).
    const points = page.getByLabel("Number of Levey-Jennings points to show");
    await expect(points).toBeVisible();
    await expect(points).toHaveValue("30");

    // Chart renders and the caption shows the point count.
    await expect(page.locator("svg[aria-label='Levey-Jennings chart']")).toBeVisible();
    await expect(page.getByText(/Run sequence \(oldest to newest, n=\d+\)/)).toBeVisible();

    // Narrowing to 20 caps the visible points at 20 (for a lot with >= 20 results).
    await points.selectOption("20");
    await expect(page.getByText("Run sequence (oldest to newest, n=20)")).toBeVisible();
  });
});
