// tests/playwright/study-credits-modal.spec.ts
//
// Gate 3 step 8 guard for the free-trial -> paid conversion fix. When a new
// account exhausts its 2 free study credits, the server blocks study and
// verification creation with { code: "STUDY_CREDITS_EXHAUSTED" }. The create
// handlers now dispatch a "study-credits-exhausted" event, and StudyCreditsModal
// (mounted at the app root) turns that block into a one-click upgrade instead of
// a dead-end error toast.
//
// This drives the modal directly: dispatch the event on a loaded page and assert
// the upgrade modal renders with a working CTA. Deterministic and public (no
// auth, no need to actually burn credits), so it runs in the smoke gate.
//
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Trial -> paid: study-credit exhaustion upgrade modal", () => {
  test("dispatching study-credits-exhausted opens the upgrade modal with a CTA", async ({ page }) => {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200); // let the app (and the root-mounted modal) hydrate

    // Fire the same event the create handlers dispatch at exhaustion.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("study-credits-exhausted", {
          detail: { message: "You have used your free studies. Upgrade to run more." },
        })
      );
    });

    // The modal must appear, name the free-studies exhaustion, and offer a real
    // upgrade action (not a dead-end message).
    await expect(page.getByText(/used your 2 free studies/i).first()).toBeVisible({ timeout: 8000 });
    const upgrade = page.getByRole("button", { name: /Upgrade to VeritaCheck.*Unlimited/i }).first();
    await expect(upgrade).toBeVisible();
    // Escape hatches are present.
    await expect(page.getByRole("link", { name: /See all plans/i }).first()).toHaveAttribute("href", "/pricing");
  });
});
