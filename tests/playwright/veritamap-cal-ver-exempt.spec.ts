// tests/playwright/veritamap-cal-ver-exempt.spec.ts
//
// Gate 3 step 8 for parking-lot #77 (Lisa, 2026-10-07): a test whose instrument
// row carries a linearity / cal ver exemption flag renders "Exempt" in the Cal
// Ver column and drops out of the header's "Cal Verifications Required" count,
// instead of showing an empty date cell with the 6-month clock. Authed, so
// env-gated; the CI sandbox seed flags Calcium on its single instrument and
// leaves the other five analytes undated. Run live:
//   PW_TOKEN=... PW_MAP_URL=/labs/<id>/veritamap-app/<mapId> npx playwright test tests/playwright/veritamap-cal-ver-exempt.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || "";
const EXEMPT_ANALYTE = process.env.PW_EXEMPT_ANALYTE || "Calcium";

test.describe("VeritaMap: instrument-level cal ver exemption honored on the map page", () => {
  test("flagged analyte shows Exempt and is not counted as required", async ({ page }) => {
    test.skip(!TOKEN || !MAP_URL, "PW_TOKEN / PW_MAP_URL not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });

    // The flagged analyte's row carries the Exempt cell with the instrument note.
    const row = page.getByRole("row", { name: new RegExp(`^\\s*${EXEMPT_ANALYTE}\\b`) }).first()
      .or(page.locator("tr", { hasText: EXEMPT_ANALYTE }).first());
    await expect(row, `row for ${EXEMPT_ANALYTE} renders`).toBeVisible();
    const exemptCell = row.getByTestId("cal-ver-exempt");
    await expect(exemptCell, "Exempt cell on the flagged analyte").toBeVisible();
    await expect(exemptCell).toContainText("Exempt");
    await expect(exemptCell).toContainText("Per instrument exemption");

    // Header count: total tests minus the exempt ones (all other tests are undated).
    const showing = await page.getByText(/Showing \d+ of \d+ tests/).first().textContent();
    const total = Number((showing || "").match(/of (\d+) tests/)?.[1] || 0);
    const exemptCount = await page.getByTestId("cal-ver-exempt").count();
    expect(total, "test count parsed from the header").toBeGreaterThan(0);
    await expect(page.getByText(new RegExp(`${total - exemptCount} Cal Verifications? Required`)), "header count excludes exempt tests").toBeVisible();
  });
});
