// tests/playwright/signoff-groups-open-study.spec.ts
//
// Gate 3 evidence: on the VeritaCheck Sign-off Groups page, each study row is
// now clickable to open that study's results page, mirroring the Coverage map.
// The row navigates to labRoute(`/study/${study.id}/results`); Member.id is the
// study id (the members query is `FROM studies`).
//
// Gated: PW_TOKEN + PW_SIGNOFF_URL (e.g. /labs/2/veritacheck/signoff-groups for
// a lab with a group that has members). Compile-only in CI; the live click is
// the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const SIGNOFF_URL = process.env.PW_SIGNOFF_URL || ""; // e.g. /labs/2/veritacheck/signoff-groups

test.describe("VeritaCheck Sign-off Groups: rows open the study", () => {
  test("clicking a study row navigates to that study's results", async ({ page }) => {
    if (!TOKEN || !SIGNOFF_URL) { test.skip(true, "Set PW_TOKEN + PW_SIGNOFF_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${SIGNOFF_URL}`, { waitUntil: "networkidle" });

    // A member row is present, clickable (title "Open study"), and carries the study id.
    const row = page.locator('tr[data-testid^="member-"]').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", /Open study/i);
    await row.click();

    // Landed on the study results page for that study id.
    await expect(page).toHaveURL(/\/study\/\d+\/results/);
  });
});
