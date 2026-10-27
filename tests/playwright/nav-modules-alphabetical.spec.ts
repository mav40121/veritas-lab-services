// tests/playwright/nav-modules-alphabetical.spec.ts
//
// Gate 3 step 8 for the client request of 2026-10-27 (Michael Q9 = 1, Q10 = 1): the VeritaAssure menu lists the modules
// A to Z, reading down the left column and then the right; Inspection Readiness (the dashboard, not a module) sits at the
// top beside All Modules Overview; the scheduler reads "VeritaShift Scheduler" and sorts right under VeritaShift.
// Public navbar, no sign-in, so it runs against a local build or production.
// Run: PW_BASE=http://localhost:5099 npx playwright test nav-modules-alphabetical

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const EXPECTED = [
  "VeritaBench", "VeritaCheck", "VeritaComp", "VeritaDC", "VeritaLab", "VeritaMaintain", "VeritaMap", "VeritaOps",
  "VeritaPace", "VeritaPT", "VeritaQA", "VeritaQC", "VeritaResponse", "VeritaScan", "VeritaShift", "VeritaShift Scheduler",
  "VeritaStaff", "VeritaStock", "VeritaTrack",
];

test("the VeritaAssure menu reads A to Z down the columns, with Inspection Readiness on top", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1000 }); // the desktop links show on wide screens; narrower windows use the menu button
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: /VeritaAssure/ }).first().click();
  const grid = page.getByTestId("nav-modules-grid");
  await expect(grid).toBeVisible({ timeout: 15000 });
  const items = grid.locator("a");
  const labels = (await items.allInnerTexts()).map((t) => t.replace(/™/g, "").trim());
  expect(labels).toEqual(EXPECTED);
  // Down the left column first: the first ten share one x position, top to bottom; the rest sit in the right column.
  const boxes = await Promise.all((await items.all()).map((a) => a.boundingBox()));
  const half = Math.ceil(EXPECTED.length / 2);
  const leftX = boxes[0]!.x;
  expect(boxes.slice(0, half).every((b) => Math.abs(b!.x - leftX) < 2)).toBeTruthy();
  expect(boxes.slice(half).every((b) => b!.x > leftX + 50)).toBeTruthy();
  expect(boxes.slice(0, half).every((b, i) => i === 0 || b!.y > boxes[i - 1]!.y)).toBeTruthy();
  // Inspection Readiness is on top, outside the module list.
  await expect(page.getByTestId("nav-readiness")).toHaveText(/Inspection Readiness/);
  await expect(grid.getByText("Inspection Readiness")).toHaveCount(0);
  await page.screenshot({ path: "test-results/nav-modules-alphabetical.png" });
});
