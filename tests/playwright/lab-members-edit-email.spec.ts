// tests/playwright/lab-members-edit-email.spec.ts
//
// Gate 3 step 8 browser exercise for the inline "Edit email" action on the Lab
// Members page. An owner/admin can correct a member's login email in place
// instead of remove + re-invite (which would spin up a separate account and
// detach the member's existing policy sign-offs).
//
// Drives the real row control: clicks "Edit email", types a new address, and
// saves. The PATCH is stubbed with a 200 so no real account is changed; the
// test asserts the request went to /members/:id/email with the typed email.
//
// Env: PW_BASE, PW_TOKEN (an owner/admin), PW_MEMBERS_LAB (a lab with at least
// one non-owner member). Skips without them so the compile-only smoke gate
// stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_MEMBERS_LAB || "";

test.describe("Lab Members — inline edit email", () => {
  test("Edit email opens an input and PATCHes /members/:id/email", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_MEMBERS_LAB (a lab with a non-owner member).");
      return;
    }

    // Stub the email PATCH so the click completes without changing a real
    // account, and capture what the client sent.
    const patchCalls: { url: string; body: any }[] = [];
    await page.route(/\/api\/labs\/\d+\/members\/\d+\/email$/, async route => {
      let body: any = null;
      try { body = route.request().postDataJSON(); } catch { /* ignore */ }
      patchCalls.push({ url: route.request().url(), body });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, email: body?.email }) });
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/members`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    const editBtn = page.getByRole("button", { name: "Edit email" }).first();
    await expect(editBtn, "an Edit email control is present for a non-owner member").toBeVisible();
    await editBtn.click();

    const input = page.getByLabel("New email address");
    await expect(input).toBeVisible();
    const NEW_EMAIL = "corrected.address@example.com";
    await input.fill(NEW_EMAIL);
    await page.getByRole("button", { name: "Save" }).first().click();

    await expect.poll(() => patchCalls.length, { timeout: 8000 }).toBeGreaterThan(0);
    const last = patchCalls[patchCalls.length - 1];
    expect(last.url, "PATCH hits the email sub-route").toMatch(/\/api\/labs\/\d+\/members\/\d+\/email$/);
    expect(last.body?.email, "the typed email is sent in the body").toBe(NEW_EMAIL);
  });
});
