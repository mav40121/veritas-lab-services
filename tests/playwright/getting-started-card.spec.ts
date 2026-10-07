// tests/playwright/getting-started-card.spec.ts
//
// Gate 3 step 8 for parking lot #72 (2026-10-07): the in-app Getting Started
// card on the lab dashboard. Authed, so env-gated (PW_TOKEN, PW_LAB_ID). Run live:
//   PW_TOKEN=... PW_LAB_ID=5 npx playwright test tests/playwright/getting-started-card.spec.ts
// The token's user must be an owner or admin of the lab (manual ticks).
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("Dashboard: Getting Started card", () => {
  test("card scores the lab, Go links open the module, manual tick counts, dismiss hides and shows again", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN / PW_LAB_ID not set, skipping authed exercise");
    test.setTimeout(120000);
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/dashboard`, { waitUntil: "networkidle" });

    // If a previous run dismissed it, bring it back.
    const hiddenLink = page.getByTestId("getting-started-show");
    if (await hiddenLink.isVisible().catch(() => false)) await hiddenLink.click();

    const card = page.getByTestId("getting-started-card");
    await expect(card, "card renders").toBeVisible();
    const summary = card.getByTestId("getting-started-summary");
    await expect(summary).toContainText(/Getting started: \d+ of 19 done/);
    const before = Number((await summary.textContent())!.match(/(\d+) of 19/)![1]);

    // A phase is open by default and shows steps with status.
    const openSteps = card.locator("[data-testid^='getting-started-step-']");
    await expect(openSteps.first(), "a phase is open with steps").toBeVisible();

    // Manual tick (Phase 5) changes the count.
    await card.getByTestId("getting-started-phase-5").locator("button").first().click();
    const tickBox = card.getByTestId("getting-started-tick-p5.pdfs");
    await expect(tickBox).toBeVisible();
    const wasChecked = await tickBox.isChecked();
    await tickBox.click();
    await expect(summary).toContainText(`${wasChecked ? before - 1 : before + 1} of 19`);
    await tickBox.click(); // restore
    await expect(summary).toContainText(`${before} of 19`);

    // A Go link opens the module page inside the lab.
    const go = card.locator("[data-testid^='getting-started-go-']").first();
    if (await go.isVisible().catch(() => false)) {
      const href = await go.getAttribute("href");
      await go.click();
      await expect(page, "Go link lands inside the lab").toHaveURL(new RegExp(`/labs/${LAB_ID}/|/account|/members`));
      expect(href, "href is lab-scoped or an account route").toMatch(/^\/(labs\/\d+\/|account|members)/);
      await page.goto(`${BASE}/labs/${LAB_ID}/dashboard`, { waitUntil: "networkidle" });
    }

    // Dismiss hides the card and leaves the show-again link; show restores it.
    await page.getByTestId("getting-started-dismiss").click();
    await expect(page.getByTestId("getting-started-hidden"), "dismissed state renders the one-line link").toBeVisible();
    await page.getByTestId("getting-started-show").click();
    await expect(page.getByTestId("getting-started-card"), "card shows again").toBeVisible();
  });
});
