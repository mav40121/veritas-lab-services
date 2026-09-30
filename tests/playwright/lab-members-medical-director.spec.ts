// tests/playwright/lab-members-medical-director.spec.ts
//
// Gate 3 step 8 for the Medical Director SEAT (2026-09-30). Medical Director is
// now a first-class seat type instead of a bolted-on side card:
//   - it is the third option in the "Invite a new member" role dropdown, and
//   - it can be set/cleared on any existing member row (the owner included) via
//     the per-row "Make medical director" / "Clear medical director" control.
// The standalone "Designate Medical Director" card (data-testid=designate-md-toggle)
// was retired, so this spec asserts it is GONE and the new controls render, then
// exercises the backend PUT round-trip (unchanged) to confirm designation still
// works, restoring the lab to its prior state.
//
// Env-gated: PW_TOKEN (owner/admin on the lab) + PW_LAB_ID. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test lab-members-medical-director

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("Lab Members: Medical Director seat", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN (owner/admin) and PW_LAB_ID to run the medical-director check.");
  });

  test("MD is a first-class seat type; the standalone designate card is gone", async ({ browser }) => {
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

    // The retired standalone card must be gone.
    await expect(page.locator('[data-testid="designate-md-toggle"]')).toHaveCount(0);

    // Medical Director is the third option in the invite role dropdown.
    const roleSelect = page.locator("#invite-role");
    await expect(roleSelect).toBeVisible({ timeout: 8000 });
    await expect(roleSelect.locator('option[value="medical_director"]')).toHaveCount(1);

    // At least one per-member row exposes a make/clear medical-director control.
    const rowControls = page.locator('[data-testid="make-md-btn"], [data-testid="clear-md-btn"]');
    expect(await rowControls.count()).toBeGreaterThan(0);

    // Backend round-trip (unchanged PUT endpoint) still designates + clears.
    const testEmail = `pw-md-${Date.now().toString().slice(-6)}@example.com`;
    const setResult = await page.evaluate(async ([base, lab, email]) => {
      const t = localStorage.getItem("veritas_token");
      const put = await fetch(`${base}/api/labs/${lab}/medical-director`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ email, name: "" }),
      });
      const get = await fetch(`${base}/api/labs/${lab}/members`, { headers: { Authorization: `Bearer ${t}` } });
      const d = await get.json();
      return { putOk: put.ok, md: (d.medicalDirector && d.medicalDirector.email) || null };
    }, [BASE, LAB, testEmail] as const);
    expect(setResult.putOk).toBeTruthy();
    expect((setResult.md || "").toLowerCase()).toBe(testEmail.toLowerCase());

    // Restore prior state so the lab is left as we found it.
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
