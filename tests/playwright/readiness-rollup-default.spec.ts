// tests/playwright/readiness-rollup-default.spec.ts
//
// Gate 3 step 8 for the readiness landing reorder: on a MULTI-LAB account the
// Inspection Readiness page must open on the NETWORK command center (the
// "Network readiness" band) ABOVE the switcher-selected lab's own detail
// (the "Active site:" heading). Single-lab accounts never see the roll-up, so
// this only asserts the ordering when the roll-up is present.
//
// Env-gated: PW_TOKEN (member of a multi-lab account) + PW_LAB_ID. Skips
// otherwise, and skips gracefully if the account turns out to be single-lab.
//
//   PW_TOKEN=... PW_LAB_ID=25 npx playwright test readiness-rollup-default

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("Inspection Readiness — multi-lab lands on the network roll-up first", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the readiness landing check.");
  });

  test("network readiness band renders above the active-site detail", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/readiness`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const network = page.getByText("Network readiness", { exact: true }).first();
    if (!(await network.count())) {
      test.skip(true, "Single-lab account in this harness; no network roll-up to order.");
    }
    const activeSite = page.getByText(/^Active site:/).first();
    await expect(network).toBeVisible();
    await expect(activeSite).toBeVisible();

    // Ordering: the network band must sit ABOVE the active-site heading.
    const nBox = await network.boundingBox();
    const aBox = await activeSite.boundingBox();
    expect(nBox, "network band has a box").not.toBeNull();
    expect(aBox, "active-site heading has a box").not.toBeNull();
    expect(nBox!.y, `network (y=${nBox!.y}) should be above active-site (y=${aBox!.y})`).toBeLessThan(aBox!.y);

    // The heatmap ("All labs") is part of the network view and should also
    // precede the active-site detail.
    const allLabs = page.getByText("All labs", { exact: true }).first();
    if (await allLabs.count()) {
      const hBox = await allLabs.boundingBox();
      if (hBox) expect(hBox.y).toBeLessThan(aBox!.y);
    }
    await ctx.close();
  });
});
