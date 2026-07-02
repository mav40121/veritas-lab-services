// tests/playwright/resource-tube-labeling-download.spec.ts
//
// Gate 3 step 8 for the Specimen Tube Labeling Guide download: the /resources
// page gains a third "Free Downloads" card whose link serves a PDF from
// GET /api/downloads/specimen-tube-labeling-guide. Asserts the card renders with
// the correct download link, and that the route returns a real PDF (200,
// application/pdf, %PDF- magic bytes). Passes once the change is deployed to prod.
//
// Run: npx playwright test resource-tube-labeling-download
//      PW_BASE=http://127.0.0.1:4173 npx playwright test resource-tube-labeling-download

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const DOWNLOAD_PATH = "/api/downloads/specimen-tube-labeling-guide";
const FILENAME = "Specimen_Tube_Labeling_Guide.pdf";

test.describe("Resources: Specimen Tube Labeling Guide download", () => {
  test("card renders on /resources with the correct download link", async ({ page }) => {
    await page.goto(`${BASE}/resources`, { waitUntil: "networkidle" });
    await expect(
      page.getByText("Specimen Tube Labeling Guide", { exact: false }).first(),
    ).toBeVisible();
    const link = page.locator(`a[href="${DOWNLOAD_PATH}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("download", new RegExp(FILENAME.replace(".", "\\.")));
  });

  test("download route serves a real PDF", async ({ request }) => {
    const res = await request.get(`${BASE}${DOWNLOAD_PATH}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    expect(res.headers()["content-disposition"]).toContain(FILENAME);
    const body = await res.body();
    expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
