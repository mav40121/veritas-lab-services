// tests/playwright/switcher-network-overview.spec.ts
//
// Gate 3 step 8 browser evidence for the lab switcher "Network overview" entry
// (client/src/components/LabSwitcher.tsx). The Inspection Readiness network
// command center (the readiness roll-up across every lab the user is on) was
// only reachable as the first item of the 20-entry VeritaAssure module menu;
// this adds a "Network overview" item at the TOP of the lab switcher so a
// multi-lab owner/admin finds the overview where they look for it.
//
// Drives the real dropdown: open the lab switcher, click "Network overview",
// and assert it lands on the readiness page (which renders the network command
// center first for multi-lab accounts).
//
// Env: PW_BASE, PW_TOKEN (a MULTI-LAB user so the switcher renders at all),
// PW_LAB (an active lab id to load first). Skips without them so the compile-
// only smoke gate stays green (repo pattern).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "";

test.describe("Lab switcher — Network overview entry", () => {
  test("opens the readiness network command center", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (a multi-lab user) + PW_LAB.");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    // Start on a normal module page (the top NavBar + switcher render here).
    await page.goto(`${BASE}/labs/${LAB}/veritacheck`, { waitUntil: "domcontentloaded" });

    // Open the lab switcher (renders only for 2+ memberships).
    const trigger = page.getByTestId("lab-switcher");
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();

    // A "Network overview" item sits inside each organization's section (one per
    // system, not a single global entry). Click the first one.
    const overview = page.getByRole("menuitem", { name: /network overview/i }).first();
    await expect(overview).toBeVisible();
    await overview.click();

    // Lands on the readiness page scoped to that system (?org=<id>); multi-lab
    // systems land on the network command center (heading "Inspection Readiness").
    await expect(page).toHaveURL(/\/labs\/\d+\/readiness(\?org=\d+)?/);
    await expect(page.getByRole("heading", { name: /inspection readiness/i })).toBeVisible({ timeout: 10000 });
  });
});
