// tests/playwright/coverage-align-section.spec.ts
//
// Gate 3 step 8 evidence for the Coverage "Studies to align" rework. The old
// panel read "Unaligned studies (0 of 39)" while every row showed a green
// "Aligned →" badge. The rework renames it "Studies to align" with an
// "All aligned" / "N needs alignment" pill, keeps only still-unaligned studies
// in the main table, and collapses aligned ones into a <details> section.
//
// Drives the real page and asserts the new heading + pill are present and the
// old "Unaligned studies" heading is gone. Needs PW_TOKEN + a lab with coverage;
// skips (compile-only) in CI.
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT), PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck Coverage: Studies to align section", () => {
  test("renames the section and shows an alignment status pill, no 'Unaligned studies'", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck/coverage`, { waitUntil: "networkidle" });

    // The section is only present when the lab has name-mismatch studies. If it
    // renders at all, it must use the new heading, never the old one.
    const heading = page.getByRole("heading", { name: /Studies to align/i });
    await expect(heading).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Unaligned studies/i)).toHaveCount(0);

    // A status pill states the alignment state.
    await expect(page.getByText(/All aligned|needs? alignment/i).first()).toBeVisible();

    // When everything is aligned, the aligned studies live behind a collapsed
    // <details> "N aligned studies (review or clear)" summary.
    const alignedSummary = page.getByText(/aligned stud(y|ies)/i).first();
    if (await alignedSummary.count()) {
      await expect(alignedSummary).toBeVisible();
    }
  });
});
