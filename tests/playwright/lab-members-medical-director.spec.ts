// tests/playwright/lab-members-medical-director.spec.ts
//
// Gate 3 step 8 for the Lab Members "Designate Medical Director" control. The
// backend (PUT /api/labs/:labId/medical-director) always existed, but the UI
// never shipped a way to set the MD, so an owner/admin could not grant the
// medical-director seat. This drives the new control on prod: designate an MD by
// email, confirm it renders, then restore the prior state (set back or clear).
//
// Env-gated: PW_TOKEN (owner/admin on the lab) + PW_LAB_ID. Runs a safe
// round-trip so it does not leave a test MD on the lab. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test lab-members-medical-director

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("Lab Members: designate Medical Director", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN (owner/admin) and PW_LAB_ID to run the medical-director check.");
  });

  test("owner/admin can designate and clear the medical director", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);

    // Capture the current MD via the API so we can restore it afterward.
    const priorMd = await page.evaluate(async ([base, lab]) => {
      const t = localStorage.getItem("veritas_token");
      const r = await fetch(`${base}/api/labs/${lab}/members`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return null;
      const d = await r.json();
      return d.medicalDirector || null;
    }, [BASE, LAB] as const);

    await page.goto(`${BASE}/labs/${LAB}/members`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // The MD card + control must render (this is the whole point of the fix).
    await expect(page.getByText(/Laboratory Medical Director/i).first()).toBeVisible({ timeout: 8000 });
    const toggle = page.locator('[data-testid="designate-md-toggle"]');
    await expect(toggle.first()).toBeVisible();
    await toggle.first().click();

    const testEmail = `pw-md-${Date.now().toString().slice(-6)}@example.com`;
    await page.locator('[data-testid="md-email-input"]').fill(testEmail);
    await page.locator('[data-testid="md-save"]').click();
    await page.waitForTimeout(1500);

    // The designated email should now render on the card.
    await expect(page.getByText(new RegExp(testEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).first()).toBeVisible({ timeout: 8000 });

    // Restore prior state via the API so the lab is left as we found it.
    await page.evaluate(async ([base, lab, email, name]) => {
      const t = localStorage.getItem("veritas_token");
      await fetch(`${base}/api/labs/${lab}/medical-director`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email: email || "", name: name || "" }),
      });
    }, [BASE, LAB, priorMd?.email || "", priorMd?.name || ""] as const);

    await ctx.close();
  });
});
