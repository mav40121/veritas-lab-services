// tests/playwright/veritamap-seat-view-only.spec.ts
//
// Gate 3 step 8 evidence for parking-lot #64 layer 2 (2026-10-07): a lab
// member WITHOUT edit rights on VeritaMap (not owner / admin / org admin /
// edit seat) must see the map read-only. Before this, useIsReadOnly only knew
// the subscription state, so a genuine view-only user saw enabled inputs and
// got one failed-save toast per field (the original Milford "cascade" shape).
//
// Auth-gated, so compile-only in CI; runs live when PW_VIEWONLY_TOKEN (a token
// for a plain member of the map's lab) + PW_MAP_URL are set (PW_BASE may point
// at a local dev server). Asserts: the view-only banner renders, the AMR and
// reference-range inputs are disabled, and no PUT is attempted.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_VIEWONLY_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || "";

test.describe("VeritaMap: a member without edit rights gets a read-only map", () => {
  test("banner shows, inputs disabled, no writes", async ({ page }) => {
    if (!TOKEN || !MAP_URL) {
      test.skip(true, "PW_VIEWONLY_TOKEN + PW_MAP_URL not set (compile-only gate run).");
      return;
    }
    test.setTimeout(90_000);
    await injectAuth(page, BASE, TOKEN);
    const puts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "PUT" && /\/veritamap\//.test(req.url())) puts.push(req.url());
    });

    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });
    await expect(page.getByText(/view-only access to VeritaMap/i)).toBeVisible({ timeout: 30_000 });

    const expand = page.getByTitle("Enter reference range, critical values, AMR").first();
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(page.getByPlaceholder("Low").first()).toBeDisabled({ timeout: 15_000 });
    await expect(page.getByPlaceholder("High").first()).toBeDisabled();
    await expect(page.getByPlaceholder("e.g. 136").first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save values" })).toBeDisabled();

    await page.waitForTimeout(4_000);
    expect(puts, `view-only user attempted writes:\n${puts.join("\n")}`).toHaveLength(0);
    await expect(page.getByText(/not saved|Save failed/i)).toHaveCount(0);
  });
});
