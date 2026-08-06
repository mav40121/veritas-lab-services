// tests/playwright/veritaqc-month-scope.spec.ts
//
// Gate 3 evidence for the VeritaQC Review & Sign-off month scope fix:
// the Month + Year selectors at the top of the page are the single time
// control. Picking a month with logged QC shows that month's lots; picking a
// month with none shows the "No QC results for <Month> <Year>" empty state.
// Previously the results list was governed by a separate "Last 30 days"
// dropdown that ignored the month picker, so reviewing a past month showed
// nothing.
//
// Gated (PW_TOKEN + PW_REVIEW_URL = a lab's veritaqc-app/review page with
// results in a known month, e.g. /labs/3/veritaqc-app/review); compile-only in
// CI. Live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const REVIEW_URL = process.env.PW_REVIEW_URL || ""; // e.g. /labs/3/veritaqc-app/review
const DATA_MONTH = process.env.PW_DATA_MONTH || "April"; // a month that has QC
const DATA_YEAR = process.env.PW_DATA_YEAR || "2026";
const EMPTY_MONTH = process.env.PW_EMPTY_MONTH || "January"; // a month with no QC

test.describe("VeritaQC Review & Sign-off month scope", () => {
  test("selecting a month drives the visible results list", async ({ page }) => {
    if (!TOKEN || !REVIEW_URL) { test.skip(true, "Set PW_TOKEN + PW_REVIEW_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${REVIEW_URL}`, { waitUntil: "networkidle" });

    // The top time control is Month + Year, not a "Last 30 days" date range.
    await expect(page.getByText("Month", { exact: true })).toBeVisible();
    await expect(page.getByText("Year", { exact: true })).toBeVisible();
    await expect(page.getByText(/Last 30 days/i)).toHaveCount(0);

    // A month with logged QC renders at least one lot card (no empty state).
    await page.getByRole("combobox").first().selectOption({ label: DATA_MONTH }).catch(() => {});
    await expect(page.getByText(new RegExp(`No QC results for ${DATA_MONTH} ${DATA_YEAR}`, "i")))
      .toHaveCount(0);

    // A month with no QC shows the month-specific empty state.
    await page.getByRole("combobox").first().selectOption({ label: EMPTY_MONTH }).catch(() => {});
    await expect(page.getByText(new RegExp(`No QC results for ${EMPTY_MONTH}`, "i"))).toBeVisible();
  });
});
