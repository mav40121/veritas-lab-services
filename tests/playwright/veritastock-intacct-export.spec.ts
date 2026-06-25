// tests/playwright/veritastock-intacct-export.spec.ts
//
// Gate 3 step 8 for "Export for Sage Intacct" — a customer-clickable download
// trigger on the VeritaStock toolbar. Asserts the button renders and, when the
// location has not configured the export yet, clicking it opens the setup dialog
// (the "set up" empty-state path). The full configured-export + preflight-block
// live drive is exercised in the PR's Gate 3 evidence via a standalone script
// (the demo needs a config seeded first).
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> PW_LAB=2 \
//     npx playwright test veritastock-intacct-export

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "";

test.describe("VeritaStock Export for Sage Intacct", () => {
  test("button renders and opens the setup dialog when unconfigured", async ({ page }) => {
    test.skip(!BASE || !TOKEN || !LAB, "needs PW_BASE + PW_TOKEN + PW_LAB");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    const btn = page.getByTestId("export-intacct-csv-button");
    await expect(btn).toBeVisible({ timeout: 15000 });

    // Unconfigured locations show the "Set up" affordance; clicking opens setup.
    const label = (await btn.textContent()) || "";
    if (/Set up Sage Intacct/i.test(label)) {
      await btn.click();
      await expect(page.getByTestId("intacct-txn-def")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("intacct-save-button")).toBeVisible();
    } else {
      // Already configured: the edit affordance is present.
      await expect(page.getByTestId("intacct-setup-button")).toBeVisible();
    }
  });
});
