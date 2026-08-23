// tests/playwright/veritabench-pi-plan-tab.spec.ts
//
// Gate 3 step 8 receipt for the VeritaQA PI Plan tab (VeritaQAPage). The
// new "Plan" tab surfaces the program plan, improvement priorities, and the
// annual leadership-review log (backend: /api/pi/plan* in server/veritabench.ts).
// Token-gated interaction drives the tab; the unauth check guards the route.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaBench PI Plan tab", () => {
  test("Plan tab renders the program-plan section", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/veritabench/pi`);
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    await expect(page.getByTestId("pi-plan-tab")).toBeVisible();
    await expect(page.getByText("Performance Improvement Program Plan")).toBeVisible();
  });

  test("PI page route does not 500 unauthenticated", async ({ page }) => {
    const res = await page.goto(`${BASE}/veritabench/pi`);
    expect(res?.status() ?? 0).toBeLessThan(500);
  });
});
