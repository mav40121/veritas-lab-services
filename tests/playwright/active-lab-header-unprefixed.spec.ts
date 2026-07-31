// tests/playwright/active-lab-header-unprefixed.spec.ts
//
// Gate 3 / regression guard for the un-prefixed-page fallback fix (2026-07-31).
//
// authHeaders() now attaches X-Active-Lab-Id even when the URL has no
// /labs/:id prefix, using the lab the user last switched to (persisted to
// localStorage as `veritas_active_lab_id` by LabSwitcher.switchTo). This stops
// un-prefixed authenticated pages from resolving a possibly-stale server
// default lab.
//
// This spec drives a real switch and asserts (a) the persisted key is written
// with the switched lab, and (b) navigating to an un-prefixed app path
// resolves to that same lab (LegacyWorkspaceRedirect lands on its prefixed
// form), with no data from the lab left behind.
//
// Needs a MULTI-LAB token (PW_TOKEN = owner of >= 2 distinctly-named labs) and
// skips otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (multi-lab owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Un-prefixed page carries the active lab", () => {
  test("switch persists the active lab and un-prefixed nav resolves to it", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/dashboard`);

    const trigger = page.locator('button[title^="Active lab:"]').first();
    if ((await trigger.count()) === 0) {
      test.skip(true, "Single-lab user; switcher is not rendered.");
      return;
    }

    // Switch to a different lab.
    await trigger.click();
    await page.locator('[role="menuitem"]').last().click();

    // The switch must have landed us on a /labs/:id URL and persisted that id.
    await expect(page).toHaveURL(/\/labs\/\d+\//, { timeout: 15000 });
    const switchedLabId = await page.evaluate(() => localStorage.getItem("veritas_active_lab_id"));
    expect(switchedLabId, "veritas_active_lab_id persisted on switch").toBeTruthy();
    const urlLabId = (page.url().match(/\/labs\/(\d+)\//) || [])[1];
    expect(switchedLabId).toBe(urlLabId);

    // Navigate to an UN-prefixed app path. It should resolve back to the
    // switched lab (not a stale default): the URL ends up prefixed with the
    // same lab id.
    await page.goto(`${BASE}/account/settings`);
    await expect(page).toHaveURL(new RegExp(`/labs/${switchedLabId}/account/settings`), { timeout: 15000 });
  });
});
