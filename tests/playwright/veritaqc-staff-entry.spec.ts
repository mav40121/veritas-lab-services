// tests/playwright/veritaqc-staff-entry.spec.ts
//
// Gate 3 evidence for: (C) VeritaQC writer log-form clarity and (B) Staff
// Portal QC entry.
//
// Writer form (C): the "Log a QC result" card now shows a "Logging for
// {assay} · Lot · level" banner and the Instrument field is a datalist
// (dropdown suggestions + free text), so it is unambiguous what assay and
// analyzer a datapoint is for.
//
// Staff Portal (B): a "Record QC" tile appears for any staff seat, and the
// Record QC screen lets a front-line staff member log a run against a control
// lot. The server attributes the run to the individual staff member; the
// writer Daily Review then shows "by {name}" on staff-entered runs.
//
// Gated: writer path needs PW_TOKEN + PW_QC_URL (e.g. /labs/3/veritaqc-app);
// staff path needs PW_STAFF_TOKEN (a staff-portal seat's token). Compile-only
// in CI; the live click on prod is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const QC_URL = process.env.PW_QC_URL || "";        // e.g. /labs/3/veritaqc-app
const STAFF_TOKEN = process.env.PW_STAFF_TOKEN || ""; // a staff-portal seat token

test.describe("VeritaQC writer log-form clarity", () => {
  test("log card shows the assay banner and an instrument datalist", async ({ page }) => {
    if (!TOKEN || !QC_URL) { test.skip(true, "Set PW_TOKEN + PW_QC_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${QC_URL}`, { waitUntil: "networkidle" });

    // The log card names what you are logging against.
    await expect(page.getByText(/Logging for/i)).toBeVisible();
    // Instrument is a datalist-backed combobox, not a bare free-text box.
    await expect(page.locator('input#qc-instrument[list="qc-instruments"]')).toBeVisible();
    await expect(page.locator('datalist#qc-instruments')).toHaveCount(1);
  });
});

test.describe("Staff Portal QC entry", () => {
  test("a staff seat sees a Record QC tile and can open the log screen", async ({ page }) => {
    if (!STAFF_TOKEN) { test.skip(true, "Set PW_STAFF_TOKEN (a staff-portal seat token)."); return; }
    await injectAuth(page, BASE, STAFF_TOKEN);
    await page.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });

    const tile = page.getByTestId("sp-tile-qc");
    await expect(tile).toBeVisible();
    await tile.click();

    await expect(page.getByRole("heading", { name: /Record QC/i })).toBeVisible();
    // The staff log screen carries the same "Logging for" clarity.
    await expect(page.getByText(/Logging for|No active control lots/i)).toBeVisible();
  });
});
