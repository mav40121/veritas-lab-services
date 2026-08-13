// tests/playwright/veritapolicy-move-manual.spec.ts
//
// Gate 3 step 8 for the VeritaPolicy "Move to a different manual" action
// (2026-08-13). Approved policies had no way to be re-filed: the pencil "edit
// metadata" dialog (the only surface with a manual dropdown) renders only for
// draft documents, so an approved doc stuck in "Unassigned" could not be moved.
// This feature adds a dedicated Move button (folder icon) to every row plus a
// Move dialog whose manual dropdown includes an "Unassigned" option, so a
// policy can also be removed from a manual. It reuses the existing
// PATCH /api/labs/:labId/veritapolicy/documents/:id endpoint (manualId only).
//
// Two layers, matching the house pattern:
//   1. Always-on API guard — the PATCH endpoint rejects unauthenticated callers.
//      Safe on prod before and after this feature deploys.
//   2. PW_TOKEN-gated UI exercise — injects a session, opens the Move dialog on
//      the first policy row, and asserts the dialog and its "Unassigned" option
//      render. Skips cleanly when no token is configured.
//
// Env:
//   PW_BASE   — base URL (default: prod)
//   PW_TOKEN  — owner/director JWT (optional; skips the UI exercise when absent)
//   PW_LAB_ID — lab to open (default 2 — San Carlos)

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaPolicy move-to-manual action", () => {
  test("document PATCH endpoint requires auth", async ({ request }) => {
    const r = await request.patch(
      `${BASE}/api/labs/${LAB_ID}/veritapolicy/documents/1`,
      { data: { manualId: null } }
    );
    expect([401, 403]).toContain(r.status());
  });

  test("Move dialog opens with an Unassigned option", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/my-policies`);

    // The Move control is a ghost icon button present on every row, titled
    // "Move to a different manual".
    const moveButton = page
      .getByRole("button", { name: /move to a different manual/i })
      .first();
    await expect(moveButton).toBeVisible({ timeout: 15000 });
    await moveButton.click();

    // Dialog title + the manual dropdown with an Unassigned option.
    await expect(
      page.getByRole("heading", { name: /move to a different manual/i })
    ).toBeVisible({ timeout: 10000 });
    const trigger = page.getByRole("combobox").first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(
      page.getByRole("option", { name: /unassigned/i }).first()
    ).toBeVisible({ timeout: 10000 });
  });
});
