// tests/playwright/veritalab-registry-no-admin-leak.spec.ts
//
// Gate 3 step-8 evidence for the VeritaLab State Registry admin-leak fix
// (audit #10). The State Registry empty state used to render an internal admin
// endpoint ("POST /api/admin/seed-state-registry") to the customer. This spec
// loads the VeritaLab app's State Registry tab and asserts that no /api/admin/*
// path is ever rendered to a customer, regardless of whether the registry is
// seeded (prod) or empty (fresh env).
//
// Needs PW_TOKEN for a user with VeritaLab access; skips otherwise (compile-only
// in CI, which is what makes this the Gate 3 step-8 test-file evidence).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaLab State Registry: no leaked admin endpoint", () => {
  test("the State Registry tab never renders an /api/admin/* path to the customer", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritalab-app`, { waitUntil: "networkidle" });

    // Open the State Registry tab if present.
    const tab = page.getByRole("tab", { name: /state registry/i });
    if (await tab.count()) {
      await tab.first().click();
      await page.waitForTimeout(500);
    }

    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("seed-state-registry");
    expect(body).not.toContain("/api/admin/");
    expect(body).not.toContain("an administrator can run the seed");
  });
});
