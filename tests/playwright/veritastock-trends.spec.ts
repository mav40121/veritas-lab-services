// tests/playwright/veritastock-trends.spec.ts
//
// CFO lens: the Valuation Trends view renders the 6-month inventory value by
// location with monthly waste. Drives the page and asserts the KPIs, the chart,
// and the per-location table render.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     npx playwright test veritastock-trends

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";

test("VeritaStock Valuation Trends renders KPIs, chart, and table", async ({ page }) => {
  test.skip(!BASE || !TOKEN, "needs PW_BASE + PW_TOKEN");
  await injectAuth(page, BASE, TOKEN);
  await page.goto(`${BASE}/labs/2/veritastock/trends`, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(3000);
  await expect(page.getByTestId("trends-kpis")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("trends-table")).toBeVisible({ timeout: 15000 });
  // recharts renders an SVG surface; confirm the chart drew bars.
  const bars = await page.locator(".recharts-bar-rectangle").count();
  expect(bars).toBeGreaterThan(0);
});
