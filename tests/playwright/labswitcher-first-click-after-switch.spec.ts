// tests/playwright/labswitcher-first-click-after-switch.spec.ts
//
// Regression guard for the lab-switch first-click error.
//
// LabSwitcher.switchTo() previously fired the /api/labs/me and /api/auth/me
// refreshes as fire-and-forget invalidations and then navigated immediately.
// The active lab on any page whose URL has no /labs/:id prefix is resolved from
// memberships.find(m => m.isPrimaryLab), so the FIRST nav click right after a
// switch read the stale memberships cache, landed on the previous lab, and
// errored; the second click corrected once the refetch had landed. The fix
// awaits refetchQueries(["/api/labs/me"]) + (["/api/auth/me"]) before
// setLocation, so the new active lab is settled before navigation.
//
// Authoritative verification is a manual switch-and-click on prod by a multi-lab
// user. This spec is the automated guard: it requires a MULTI-LAB token
// (PW_TOKEN = an owner of >= 2 labs, e.g. verilabguy) and skips otherwise so it
// stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (multi-lab owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("LabSwitcher — first click after switch does not error", () => {
  test("active lab settles to the new lab on switch", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/dashboard`);

    // Desktop switcher: the outline button whose title starts with "Active lab:".
    const trigger = page.locator('button[title^="Active lab:"]').first();
    if ((await trigger.count()) === 0) {
      test.skip(true, "Single-lab user; switcher is not rendered.");
      return;
    }
    const beforeTitle = (await trigger.getAttribute("title")) || "";

    await trigger.click();
    // Pick a different lab from the dropdown (last menuitem is not the active one
    // for a >=2-lab user since the active lab renders as the trigger).
    await page.locator('[role="menuitem"]').last().click();

    // The fix awaits the refetch before setLocation, so by the time switchTo
    // resolves the active-lab chip already reflects the NEW lab.
    await expect(
      page.locator('button[title^="Active lab:"]').first()
    ).not.toHaveAttribute("title", beforeTitle);

    // No wrong-lab / forbidden error surfaced on the first post-switch render.
    await expect(page.locator("body")).not.toContainText(
      /wrong lab|not authorized|forbidden/i
    );
  });
});
