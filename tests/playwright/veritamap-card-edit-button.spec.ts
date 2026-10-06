// tests/playwright/veritamap-card-edit-button.spec.ts
//
// Gate 3 step 8 for the per-map Edit button on the VeritaMap list page. Each map
// card should expose an Edit action that opens the map's build/edit view
// (/veritamap-app/:id/build) directly, so editing no longer requires opening the
// map first (requested 2026-10-06 after Lisa could not find how to edit a map).
// Authed page, so env-gated (PW_TOKEN); CI stays compile-only. Run post-deploy:
//   PW_TOKEN=... PW_LAB_ID=5 npx playwright test tests/playwright/veritamap-card-edit-button.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "5";

test.describe("VeritaMap card Edit button", () => {
  test("each map card has an Edit button that opens the build/edit view", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app`, { waitUntil: "networkidle" });

    const edit = page.getByRole("button", { name: "Edit" }).first();
    await expect(edit, "Edit button on a map card").toBeVisible();
    await edit.click();
    await expect(page, "navigates to the map build/edit view").toHaveURL(/\/veritamap-app\/\d+\/build/);
  });
});
