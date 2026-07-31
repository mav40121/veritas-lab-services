// tests/playwright/lab-switch-cache-isolation.spec.ts
//
// Gate 3 / regression guard for the cross-lab DATA-bleed fix (2026-07-31).
//
// The query cache runs staleTime: Infinity (client/src/lib/queryClient.ts), so
// a query cached for the lab you are leaving is served forever until its key
// changes or it is evicted. Lab-scoped pages key on the /labs/:id URL and
// refetch naturally, but queries whose lab is resolved SERVER-side from a
// non-lab-scoped key keep showing the PREVIOUS lab's data after a switch. The
// canonical example is the Account Settings page: it reads the lab name from
// ["/api/account/settings"] (no labId in the key), so before the fix a switch
// left the OLD lab's name in the "Lab Name" field. That is "I see information
// from the lab I just left."
//
// The fix makes LabSwitcher.switchTo() evict every cached query except the two
// identity queries (/api/labs/me, /api/auth/me) on switch, so the destination
// re-fetches everything under the new active lab.
//
// This spec proves it end-to-end: capture the Lab Name field value on lab A,
// switch to a different lab via the switcher, and assert the field now shows a
// DIFFERENT value (the new lab), never the stale one.
//
// Authoritative verification is a manual switch on prod by a multi-lab user.
// This spec is the automated guard: it needs a MULTI-LAB token (PW_TOKEN = an
// owner of >= 2 distinctly-named labs, e.g. verilabguy) and skips otherwise so
// it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (multi-lab owner JWT).
// Run: PW_TOKEN=... npx playwright test lab-switch-cache-isolation

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Lab switch — no cross-lab data bleed", () => {
  test("Account Settings lab name refreshes to the new lab, never the one just left", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/account/settings`);

    const trigger = page.locator('button[title^="Active lab:"]').first();
    if ((await trigger.count()) === 0) {
      test.skip(true, "Single-lab user; switcher is not rendered.");
      return;
    }

    // The Lab Name field is populated from ["/api/account/settings"] — the
    // non-lab-scoped query that bleeds. Wait for it to settle on lab A.
    const labNameField = page.locator("#lab_name");
    await expect(labNameField).toBeVisible({ timeout: 15000 });
    await expect(labNameField).not.toHaveValue("", { timeout: 15000 });
    const labAName = await labNameField.inputValue();

    // Switch to a different lab.
    await trigger.click();
    await page.locator('[role="menuitem"]').last().click();

    // After the switch, the field must reflect the NEW lab. Before the fix the
    // evict did not happen, so the stale lab-A value survived (staleTime:
    // Infinity) and this assertion would fail.
    await expect(labNameField).not.toHaveValue(labAName, { timeout: 15000 });
    await expect(labNameField).not.toHaveValue("", { timeout: 15000 });

    const labBName = await labNameField.inputValue();
    expect(labBName).not.toBe(labAName);
  });
});
