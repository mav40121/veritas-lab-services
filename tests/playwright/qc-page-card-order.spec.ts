// tests/playwright/qc-page-card-order.spec.ts
//
// Gate 3 step 8 for the VeritaQC page card reorder (VeritaQCAppPage). The
// Levey-Jennings chart no longer sits between the control-lot selector and the
// data-entry form. Correct top-to-bottom order:
//   Control lot -> Log a QC result -> Levey-Jennings chart -> Recent results
// so pick-then-log stays adjacent and the chart follows entry.
//
// Asserts vertical DOM order by comparing each card title's bounding box Y.
// Gated on PW_TOKEN + PW_QC_URL (e.g. /labs/19/veritaqc-app). Compile-only in CI.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const QC_URL = process.env.PW_QC_URL || ""; // e.g. /labs/19/veritaqc-app

async function topOf(page: import("@playwright/test").Page, text: string): Promise<number> {
  const box = await page.getByText(text, { exact: false }).first().boundingBox();
  if (!box) throw new Error(`no bounding box for "${text}"`);
  return box.y;
}

test.describe("VeritaQC page card order", () => {
  test("Log a QC result sits above the Levey-Jennings chart, chart above Recent results", async ({ page }) => {
    if (!TOKEN || !QC_URL) { test.skip(true, "Set PW_TOKEN + PW_QC_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${QC_URL}`, { waitUntil: "networkidle" });

    const controlLot = await topOf(page, "Control lot");
    const logResult = await topOf(page, "Log a QC result");
    const chart = await topOf(page, "Levey-Jennings chart");
    const recent = await topOf(page, "Recent results");

    // Control lot first, then data entry, then the chart, then the table.
    expect(controlLot).toBeLessThan(logResult);
    expect(logResult).toBeLessThan(chart);
    expect(chart).toBeLessThan(recent);
  });
});
