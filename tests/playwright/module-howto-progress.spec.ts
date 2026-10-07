// tests/playwright/module-howto-progress.spec.ts
//
// Gate 3 step 8 for parking-lot #79 (phase B of the in-app Getting Started,
// Michael's option 1, 2026-10-07): the per-module how-to card shows a "Your
// progress" block with live done / to-do marks on the system-path steps that
// belong to that module, read from the same endpoint as the dashboard card.
// Authed, so env-gated; the CI sandbox seed leaves the lab with a map that has
// instruments and tests but no reference ranges, and a staff roster with an
// instrument assignment. Run live:
//   PW_TOKEN=... PW_LAB_ID=<id> npx playwright test tests/playwright/module-howto-progress.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("Module how-to card: live progress on the module's system steps", () => {
  test("VeritaMap card: map step done, ranges step to do", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN / PW_LAB_ID not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app`, { waitUntil: "networkidle" });
    const block = page.getByTestId("module-howto-progress").first();
    await expect(block, "progress block renders on the VeritaMap card").toBeVisible();
    await expect(block.getByTestId("module-howto-step-p2.map"), "instrument step is done on a seeded map").toHaveAttribute("data-status", "done");
    await expect(block.getByTestId("module-howto-step-p2.ranges"), "ranges step is still to do").toHaveAttribute("data-status", "todo");
  });

  test("VeritaStaff card: roster step done", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN / PW_LAB_ID not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastaff-app`, { waitUntil: "networkidle" });
    const block = page.getByTestId("module-howto-progress").first();
    await expect(block, "progress block renders on the VeritaStaff card").toBeVisible();
    await expect(block.getByTestId("module-howto-step-p2.staff"), "roster step is done with an assigned employee").toHaveAttribute("data-status", "done");
  });

  test("VeritaLab card: no derived step, so no progress block", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN / PW_LAB_ID not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritalab-app`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("module-howto-card").first(), "how-to card still renders").toBeVisible();
    await expect(page.getByTestId("module-howto-progress")).toHaveCount(0);
  });
});
