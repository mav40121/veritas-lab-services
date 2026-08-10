// tests/playwright/qc-lot-changeover.spec.ts
//
// Gate 3 step 8 for the VeritaQC lot-changeover / continuous Levey-Jennings
// feature (VeritaQCAppPage). A control line (analyte + level) can span multiple
// lots; the dropdown defaults to the current lot and groups lots by line, the
// current lot exposes a "Start new lot" changeover action, and a "Span all lots"
// toggle renders a continuous cross-lot chart with a shift marker at each
// changeover.
//
// Read-only by design: it asserts the controls render and the continuous chart
// appears when toggled. It does NOT submit a changeover (that would mutate prod
// data); the live changeover click is the human-in-the-loop receipt.
//
// Gated on PW_TOKEN + PW_QC_URL (e.g. /labs/19/veritaqc-app for a lab that has a
// current control lot). Compile-only in CI.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const QC_URL = process.env.PW_QC_URL || ""; // e.g. /labs/19/veritaqc-app

test.describe("VeritaQC lot changeover + continuous Levey-Jennings", () => {
  test("current lot exposes Start new lot, and Span all lots renders the cross-lot chart", async ({ page }) => {
    if (!TOKEN || !QC_URL) { test.skip(true, "Set PW_TOKEN + PW_QC_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${QC_URL}`, { waitUntil: "networkidle" });

    // The control-lot selector renders (grouped by control line, defaulted to
    // the current lot).
    await expect(page.getByText("Control lot", { exact: true })).toBeVisible();

    // The current lot exposes the changeover action.
    await expect(page.getByRole("button", { name: "Start new lot" }).first()).toBeVisible();

    // The single-lot Levey-Jennings chart is present by default.
    await expect(page.locator("svg[aria-label='Levey-Jennings chart']")).toBeVisible();

    // If this control line has more than one lot, the "Span all lots" toggle
    // appears; turning it on renders the continuous cross-lot chart.
    const span = page.getByLabel("Span all lots (continuous Levey-Jennings across lot changes)");
    if (await span.count()) {
      await span.check();
      await expect(
        page.locator("svg[aria-label='Continuous Levey-Jennings chart across lots']"),
      ).toBeVisible();
      await expect(page.getByText(/Continuous across \d+ lots/)).toBeVisible();
    }
  });
});
