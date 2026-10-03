// tests/playwright/qa-gate-sweep.spec.ts
//
// Part of the /qa-sweep harness. The plan-gating class of bug is invisible to API
// checks (the API returns 200; the UI renders an upgrade wall). This logs in as a
// PAID-lab member and visits EVERY module app route, asserting the real app renders
// rather than a "View Plans" / free-tier wall. It is the automated form of the
// walkthrough that caught the USON demo failure.
//
// Needs PW_TOKEN (a user who is a member of at least one non-free lab); skips
// otherwise so the compile-only CI gate stays green. Read-only.
// Env: PW_BASE (default production www), PW_TOKEN.
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

// Lab-scopable module app routes (mirror client/src/App.tsx + lib/auth LAB_SCOPABLE_PATHS).
const MODULES = [
  "veritamap-app", "veritascan-app", "veritacomp-app", "veritatrack-app",
  "veritastaff-app", "veritapt/app", "veritalab-app", "veritaqc-app",
  "equipment-app", "veritapolicy-app", "veritaops-app", "veritabench", "veritastock",
];
// Lower-cased wall / free-tier markers that must NOT appear on a paid lab.
const WALL_MARKERS = [
  "view plans", "available on all full-suite plans", "requires a subscription",
  "up to 4 instruments", "upgrade for unlimited", "upgrade your plan",
];

test.describe("QA gate sweep: module access follows the active lab plan", () => {
  test("a paid-lab member sees every module app, not an upgrade wall", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN provided (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    const paidLab: number | null = await page.evaluate(async ([b, t]) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
        if (!r.ok) return null;
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
        const m = arr.find((x: any) => x.plan && !["free", "per_study"].includes(String(x.plan)));
        return m ? Number(m.labId ?? m.lab_id) : null;
      } catch { return null; }
    }, [BASE, TOKEN] as const);

    if (!paidLab) { test.skip(true, "PW_TOKEN user has no paid lab; cannot assert gating."); return; }

    const failures: string[] = [];
    for (const mod of MODULES) {
      await page.goto(`${BASE}/labs/${paidLab}/${mod}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      const main = (await page.locator("main").innerText().catch(() => "")).toLowerCase();
      const wall = WALL_MARKERS.find((w) => main.includes(w));
      if (wall) failures.push(`${mod}: upgrade wall "${wall}"`);
    }

    expect(failures, `Modules showing an upgrade wall on a paid lab (lab ${paidLab}):\n  ${failures.join("\n  ")}`).toEqual([]);
  });
});
