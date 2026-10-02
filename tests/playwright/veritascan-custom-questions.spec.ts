// tests/playwright/veritascan-custom-questions.spec.ts
//
// Gate 3 step 8 browser evidence for parking-lot #55 phase 2: the VeritaScan
// Custom Questions authoring page (client/src/pages/VeritaScanCustomQuestionsPage.tsx,
// route /labs/:labId/veritascan/custom-questions). Labs author their own scan
// items here; they are scored in a separate section (phase 3) that does not count
// toward the standardized readiness %.
//
// Drives the real add flow: open the page, add a custom question, assert it
// renders in the list. Env: PW_BASE, PW_TOKEN (a writer on a lab with VeritaScan),
// PW_SCAN_LAB (that lab's id). Skips without them so the compile-only smoke gate
// stays green (repo pattern).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_SCAN_LAB || "";

test.describe("VeritaScan custom questions authoring", () => {
  test("add a custom question and see it in the list", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_SCAN_LAB (a lab with a VeritaScan plan).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritascan/custom-questions`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Custom Questions/i })).toBeVisible({ timeout: 10000 });

    // Open the add dialog, fill the question, submit.
    await page.getByRole("button", { name: /add question/i }).first().click();
    const q = `Playwright check ${Date.now()}: is the backup freezer logged twice per shift?`;
    await page.getByLabel(/^Question/i).fill(q);
    await page.getByRole("button", { name: /^add question$/i }).last().click();

    // The new question renders in the list.
    await expect(page.getByText(q)).toBeVisible({ timeout: 10000 });
  });
});
