// tests/playwright/demo-lab-banner.spec.ts
//
// Gate 3 step 8 guard for the USON demo-tenant labeling (PR: labs.is_demo +
// DemoLabBanner). A lab flagged is_demo=1 must show a persistent, unmissable
// band on every authenticated page: "REPRESENTATIVE SAMPLE DATA. NOT A REAL
// FACILITY OR ACTUAL LAB DATA." A non-demo lab must NOT show it. The banner
// resolves the ACTIVE lab (URL lab id, else primary), so switching labs must
// flip it.
//
// Runs against prod with a real owner JWT (PW_TOKEN). Skips in the compile-only
// CI gate (no token) so it stays green there. Drive it locally with a u69
// (USON demo owner, labs 25-28 all is_demo=1) token for the positive case and a
// verilabguy token for the negative case; the spec discovers each lab's isDemo
// from /api/labs/me and asserts both branches whenever the token exposes them.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const BANNER = "REPRESENTATIVE SAMPLE DATA. NOT A REAL FACILITY OR ACTUAL LAB DATA.";

test.describe("USON demo tenant — is_demo sample-data banner", () => {
  test("banner shows on a demo lab and is absent on a real lab", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Discover the owner's memberships and split by the isDemo flag the API
    // now returns. This is also the schema check (Gate 3 step 3): a flagged
    // lab must come back isDemo:true.
    const labs: { labId: number; isDemo: boolean }[] = await page.evaluate(async ([b, t]) => {
      try {
        const r = await fetch(`${b}/api/labs/me`, { headers: { Authorization: `Bearer ${t}` } });
        if (!r.ok) return [];
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (d.labs || d.memberships || []);
        return arr.map((m: any) => ({ labId: Number(m.labId ?? m.lab_id ?? m.id), isDemo: !!m.isDemo }));
      } catch { return []; }
    }, [BASE, TOKEN] as const);

    expect(labs.length, "token exposes at least one lab").toBeGreaterThan(0);

    const demoLab = labs.find(l => l.isDemo);
    const realLab = labs.find(l => !l.isDemo);

    // Positive case: on a flagged lab the band is visible.
    if (demoLab) {
      await page.goto(`${BASE}/labs/${demoLab.labId}/dashboard`);
      await expect(
        page.getByText(BANNER, { exact: false }),
        `demo lab ${demoLab.labId} shows the sample-data band`
      ).toBeVisible({ timeout: 15000 });
    } else {
      test.info().annotations.push({ type: "note", text: "token owns no is_demo lab; positive case skipped" });
    }

    // Negative case: on a non-demo lab the band must not appear.
    if (realLab) {
      await page.goto(`${BASE}/labs/${realLab.labId}/dashboard`);
      // Give the page a beat to settle, then assert the band is not present.
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(
        page.getByText(BANNER, { exact: false }),
        `real lab ${realLab.labId} does not show the sample-data band`
      ).toHaveCount(0);
    } else {
      test.info().annotations.push({ type: "note", text: "token owns no non-demo lab; negative case skipped" });
    }

    // At least one branch must have been exercised for the test to be meaningful.
    expect(Boolean(demoLab || realLab), "exercised at least one branch").toBe(true);
  });
});
