// tests/playwright/veritaqc-lj-chart.spec.ts
//
// Gate 3 evidence for the inline Levey-Jennings chart on the VeritaQC page:
// selecting a control lot with logged results renders an on-screen LJ SVG
// (previously the chart only existed inside the month-end PDF). Also checks the
// review entry point is labelled "Review & Sign-off", not "Daily review".
//
// Gated (PW_TOKEN + PW_QC_URL = a lab's veritaqc-app page with a lot that has
// results, e.g. /labs/3/veritaqc-app); compile-only in CI. Live click is the
// human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const QC_URL = process.env.PW_QC_URL || ""; // e.g. /labs/3/veritaqc-app

test.describe("VeritaQC inline Levey-Jennings chart", () => {
  test("selected lot renders an on-screen LJ chart and the review link is renamed", async ({ page }) => {
    if (!TOKEN || !QC_URL) { test.skip(true, "Set PW_TOKEN + PW_QC_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${QC_URL}`, { waitUntil: "networkidle" });

    // The review entry point no longer says "Daily review".
    await expect(page.getByRole("link", { name: /Review & Sign-off/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Daily review$/i })).toHaveCount(0);

    // The Levey-Jennings card + its SVG chart render for a lot with results.
    await expect(page.getByText(/Levey-Jennings chart/i).first()).toBeVisible();
    await expect(page.locator('svg[aria-label="Levey-Jennings chart"]')).toBeVisible();
  });
});
