// tests/playwright/veritacomp-prior-approval.spec.ts
//
// Gate 3 smoke for the VeritaComp Sign & Complete prior-approval dialog
// (2026-07-06). NON-MUTATING: it opens the dialog on an unlocked assessment
// and asserts the conditional "Written documentation" field appears only when
// the signed date is back-dated, and that the confirm button is gated on that
// documentation. It cancels without signing, so no real assessment is locked.
// The actual back-dated sign is covered server-side by
// scripts/verify-prior-approval-signoff.mjs and by hand on prod.
//
// Needs PW_TOKEN (a lab user with an unlocked competency assessment); skips
// otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaComp prior-approval Sign & Complete", () => {
  test("back-dating the signed date requires written documentation", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Resolve a lab + a program that has an unlocked assessment via the API, so
    // the UI navigation lands directly on a card that shows Sign & Complete.
    const target = await page.evaluate(async ([b, t]) => {
      const authGet = async (url: string) => {
        const r = await fetch(`${b}${url}`, { headers: { Authorization: `Bearer ${t}`, "x-active-lab-id": "" } });
        return r.ok ? r.json() : null;
      };
      const me = await authGet("/api/labs/me");
      const labs = Array.isArray(me) ? me : (me?.labs || me?.memberships || []);
      for (const m of labs) {
        const labId = Number(m.labId ?? m.lab_id ?? m.id);
        if (!Number.isFinite(labId)) continue;
        // Re-fetch with the active-lab header so lab-scoped reads bind.
        const listR = await fetch(`${b}/api/labs/${labId}/competency/programs`, { headers: { Authorization: `Bearer ${t}`, "x-active-lab-id": String(labId) } });
        if (!listR.ok) continue;
        const programs = await listR.json();
        for (const p of (Array.isArray(programs) ? programs : [])) {
          const detR = await fetch(`${b}/api/labs/${labId}/competency/programs/${p.id}`, { headers: { Authorization: `Bearer ${t}`, "x-active-lab-id": String(labId) } });
          if (!detR.ok) continue;
          const det = await detR.json();
          const unlocked = (det?.assessments || []).find((a: any) => a.locked !== 1);
          if (unlocked) return { labId, programId: p.id };
        }
      }
      return null;
    }, [BASE, TOKEN] as const);

    if (!target) {
      test.skip(true, "No unlocked competency assessment available for this PW_TOKEN user.");
      return;
    }

    await page.goto(`${BASE}/labs/${target.labId}/veritacomp-app/${target.programId}`);

    const signBtn = page.getByRole("button", { name: /^Sign & Complete$/ }).first();
    await expect(signBtn).toBeVisible();
    await signBtn.click();

    // Dialog opens. Default date is today, so no documentation field yet.
    await expect(page.getByRole("heading", { name: /Sign & Complete/i })).toBeVisible();
    const dateInput = page.getByTestId("input-sign-date");
    await expect(dateInput).toBeVisible();
    await expect(page.getByTestId("input-sign-documentation")).toHaveCount(0);

    // Back-date the signed date. The documentation field appears and the
    // confirm button is disabled until a reason is entered.
    await dateInput.fill("2020-01-01");
    const doc = page.getByTestId("input-sign-documentation");
    await expect(doc).toBeVisible();
    const confirm = page.getByTestId("button-confirm-sign");
    await expect(confirm).toBeDisabled();

    await doc.fill("Signed on paper 2020-01-01, transcribed into VeritaComp today for the surveyor file.");
    await expect(confirm).toBeEnabled();

    // Cancel: do not lock a real assessment.
    await page.getByRole("button", { name: /^Cancel$/ }).click();
    await expect(page.getByRole("heading", { name: /Sign & Complete/i })).toHaveCount(0);
  });
});
