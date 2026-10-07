// tests/playwright/tea-article-hematology-2024.spec.ts
//
// Gate 3 step 8 evidence for PR #1466: the public "CLIA Allowable Error"
// article (which feeds the monthly Lab Director Brief) must show the 2024
// 42 CFR 493.941 hematology criteria, not the pre-2024 values the page carried
// (Hemoglobin +/-7% or 1.0 g/dL). Public, no auth: runs in the public gate
// against the PR's own build.
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("TEa article: hematology rows use the 2024 §493.941 criteria", () => {
  test("Hemoglobin row shows ±4% and the old ±7% figure is gone", async ({ page }) => {
    await page.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    expect(text, "Hemoglobin row should read ±4% per 2024 §493.941").toMatch(/Hemoglobin[^\n]{0,60}±4%/);
    expect(text, "the pre-2024 Hemoglobin ±7% figure must not render").not.toMatch(/Hemoglobin[^\n]{0,60}±7%/);
    expect(text).not.toMatch(/1\.0 g\/dL/);
  });
});
