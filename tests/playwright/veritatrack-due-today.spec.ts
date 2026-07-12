// tests/playwright/veritatrack-due-today.spec.ts
//
// Gate 3 step-8 evidence for the VeritaTrack due-today date fix (audit #6). A
// task due on the current date used to render "1d overdue" (and land in the
// Overdue bucket) because the status math diffed a UTC-midnight due date against
// a live timestamp; a shared date-only helper now makes due-today == 0.
//
// The AUTHORITATIVE proof of the date math is the unit test in
// scripts/verify-veritatrack-dashboard-date.mjs (due-today -> 0, yesterday ->
// -1, tomorrow -> +1, and the old live-timestamp math -> -1 on the due date).
// This browser spec loads the VeritaTrack app and confirms the calendar renders
// without error; it needs PW_TOKEN and skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaTrack calendar renders after the due-today date fix", () => {
  test("the VeritaTrack app loads and shows its calendar header", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritatrack-app`, { waitUntil: "networkidle" });
    await expect(page.getByText(/VeritaTrack/i).first()).toBeVisible({ timeout: 10000 });
  });
});
