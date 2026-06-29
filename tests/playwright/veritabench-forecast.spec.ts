// tests/playwright/veritabench-forecast.spec.ts
//
// Phase 2 of the operations leverage chain: the VeritaPace "Forecast from Goal"
// card. A productivity goal + forecasted volume derive the budgeted hour allowance
// and FTE budget (forecastFromGoal). The card is lab-scoped: it sends ?labId on the
// forecast load/save so a System owner's labs hold isolated goals.
//
// This spec asserts the forecast request carries ?labId and the card renders. It
// requires PW_TOKEN (owner JWT) and skips otherwise so it stays green in the
// compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaPace: forecast from goal is lab-scoped", () => {
  test("forecast request carries ?labId and the card renders", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench`);

    const req = await page.waitForRequest(
      (r) => r.url().includes("/api/productivity/forecast") && /[?&]labId=\d+/.test(r.url()),
      { timeout: 20000 }
    );
    expect(req.url()).toMatch(/[?&]labId=\d+/);
    await expect(page.locator("body")).toContainText("Forecast from Goal");
  });
});
