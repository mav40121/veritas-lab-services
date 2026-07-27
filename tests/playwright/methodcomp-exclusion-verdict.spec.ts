// tests/playwright/methodcomp-exclusion-verdict.spec.ts
//
// Gate 3 step 8 for the 2026-07-27 hotfix: a multi-instrument method comparison
// must honor director-excluded points in the ON-SCREEN verdict, not just the
// server verdict. Loads a study that has excluded points and asserts the page
// shows PASS with the pass tile equal (excluded points removed from the count),
// not the pre-fix FAIL / "8 / 10". The remap that fed the client math used to
// drop the `excluded` flag, so the screen showed FAIL on a passing study.
//
// Defaults target San Carlos study 677 (the reported case: RBC, 2 instruments,
// points 6 and 10 excluded). Override with PW_LAB_ID / PW_STUDY_ID. Non-mutating.
// Needs PW_TOKEN. Skips cleanly without it.
// Run: PW_TOKEN=... PW_LAB_ID=2 PW_STUDY_ID=677 npx playwright test methodcomp-exclusion-verdict

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";
const STUDY_ID = process.env.PW_STUDY_ID || "677";

test.describe("Method comparison verdict honors excluded points on screen", () => {
  test("study with excluded points shows PASS, not the pre-fix FAIL / full count", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/${STUDY_ID}/results`, { waitUntil: "networkidle" });

    // Wait for the results header to render its verdict.
    await expect(page.getByText(/Results Passing/i).first()).toBeVisible({ timeout: 20000 });

    const body = await page.locator("body").innerText();

    // Fix signature: the excluded points are removed from the count, so the
    // pass tile reads equal (8 / 8), the verdict is PASS, and the pre-fix
    // "8 / 10" full-count tile is gone.
    expect(body, "verdict should read PASS").toMatch(/\bPASS\b/);
    expect(body, "excluded points removed from the pass count (equal tile)").toContain("8 / 8");
    expect(body, "pre-fix full-count Results Passing tile (8 of 10) must be gone").not.toContain("8 / 10");
    // Excluded points leave the analysis set entirely, so both the total and
    // the plotted count are 8 (pre-fix showed 10/10).
    expect(body, "pre-fix full-count plotted tile (10/10) must be gone").not.toContain("10/10");
    expect(body, "plotted reflects the 8 included points").toContain("8/8");
  });
});
