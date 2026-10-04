// tests/playwright/veritadc-attestation-tracker.spec.ts
//
// Gate 3 browser evidence for the VeritaDC per-document attestation tracker.
// The "My Documents" tab (renamed from "My Policies") shows a "Tracker" button
// on each approved document; opening it loads the roster dialog that shows who
// was assigned, who opened the document (Last opened), and who attested, with a
// per-row status (Attested / Opened, not signed / Overdue / Not opened).
//
// Env: PW_BASE, PW_TOKEN (an owner/admin of the lab), PW_DC_LAB (a lab with at
// least one APPROVED policy document). Skips without them so the compile-only
// smoke gate stays green.
//
// Manually exercised end-to-end on the QA system on 2026-10-04: assigned an
// approved document to a test staffer, opened it as that staffer (the roster
// then showed "Last opened" populated and status "Opened, not signed"), then
// attested (status flipped to "Attested").

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC - per-document attestation tracker", () => {
  test("the Tracker button opens the roster with assigned/opened/attested columns", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (owner/admin) + PW_DC_LAB (a lab with an approved document).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });

    // The tab now reads "My Documents".
    await expect(page.getByRole("heading", { name: /My Documents/i })).toBeVisible({ timeout: 10000 });

    // Approved documents carry a Tracker button; open the first one.
    const tracker = page.getByTestId("tracker-button").first();
    await expect(tracker).toBeVisible();
    await tracker.click();

    // The roster dialog renders with its columns.
    await expect(page.getByText(/Attestation tracker/i)).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Last opened/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Attested/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /Status/i })).toBeVisible();
  });
});
