// tests/playwright/system-repository.spec.ts
//
// Gate 3 step 8 browser evidence for the system repository page
// (client/src/pages/SystemRepositoryPage.tsx, route /labs/:labId/repository).
// The shared-document space for a system/organization: loads the page, asserts
// the "System Repository" heading and the "Add document" control render.
//
// Env: PW_BASE, PW_TOKEN (a user on a lab that belongs to an org), PW_REPO_LAB
// (that lab's id). Skips without them so the compile-only smoke gate stays green
// (repo pattern).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_REPO_LAB || "";

test.describe("System repository — shared documents", () => {
  test("page renders with the add-document control", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_REPO_LAB (a lab that belongs to an organization).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/repository`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /System Repository/i })).toBeVisible({ timeout: 10000 });
    // For a lab in an org, the "Add document" control is present (writers add shared links).
    await expect(page.getByRole("button", { name: /add document/i })).toBeVisible();
  });
});
