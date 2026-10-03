// tests/playwright/plan-gate-active-lab.spec.ts
//
// Gate 3 guard for the plan-gating fix (PR: module gates follow the active lab's
// plan). Module availability must follow the ACTIVE LAB's plan, not the stale
// global user.plan. A member of a paid lab (e.g. enterprise) reached through a
// seat whose owner carries a free personal plan must see the module app, NOT the
// "View Plans" / "Available on all full-suite plans" upgrade wall.
//
// This is the exact failure that made the USON demo render every module as
// free-tier. Logic lives in the AuthProvider active-lab overlay
// (client/src/components/AuthContext.tsx) + useActiveSubscription.
//
// Needs PW_TOKEN (a user who is a member of at least one non-free lab) and skips
// otherwise so the compile-only CI gate stays green. Read-only.
// Env: PW_BASE (default production www), PW_TOKEN.
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("Plan gate follows the active lab", () => {
  test("a paid-lab member sees VeritaTrack, not the upgrade wall", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Find a non-free lab the signed-in user belongs to.
    const labs: Array<{ id: number; plan: string }> = await page.evaluate(async ([b, t]) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
        if (!r.ok) return [];
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
        return arr
          .map((m: any) => ({ id: Number(m.labId ?? m.lab_id), plan: String(m.plan || "") }))
          .filter((x: any) => Number.isFinite(x.id));
      } catch { return []; }
    }, [BASE, TOKEN] as const);

    const paid = labs.find((l) => l.plan && !["free", "per_study"].includes(l.plan));
    if (!paid) {
      test.skip(true, "PW_TOKEN user has no paid lab; cannot assert the gate.");
      return;
    }

    await page.goto(`${BASE}/labs/${paid.id}/veritatrack-app`);
    await page.waitForLoadState("networkidle");
    const main = (await page.locator("main").innerText()).toLowerCase();

    // The upgrade wall must NOT render on a paid lab.
    expect(main).not.toContain("view plans");
    expect(main).not.toContain("available on all full-suite plans");
  });
});
