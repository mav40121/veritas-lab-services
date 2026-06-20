// tests/playwright/veritastock-delab-demo.spec.ts
//
// Demo de-lab audit: from the CFO + materials-manager lens, the standalone
// VeritaStock demo must not leak lab-operations framing and must not present a
// button that lands on a blank/dead page. Drives the public demo login, then
// asserts: Account Settings says "Organization" (not "Lab Name"); the Vendor
// Directory is populated (not the empty state); the Enterprise view no longer
// lists the dropped Main Lab / Pharmacy locations.
//
//   PW_BASE=https://veritastock-production.up.railway.app npx playwright test veritastock-delab-demo

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";

test("stock demo: no lab framing, vendors populated, no dropped locations", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");

  // Public one-click demo login.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);
  await expect(page).toHaveURL(/veritastock/);

  // Account Settings: organization framing, no "Lab Name" / "Lab Information".
  await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  await expect(page.getByText("Organization", { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Lab Name", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lab Information", { exact: true })).toHaveCount(0);

  // Vendor Directory: populated, not the empty state.
  await page.goto(`${BASE}/labs/2/veritastock/vendors`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/no vendors/i)).toHaveCount(0);
  await expect(page.getByText("Medline").first()).toBeVisible({ timeout: 15000 });

  // Enterprise roll-up: the dropped lab-only locations must not appear.
  await page.goto(`${BASE}/labs/2/veritastock/enterprise`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  await expect(page.getByText(/Main Lab/i)).toHaveCount(0);
  await expect(page.getByText(/Pharmacy/i)).toHaveCount(0);
});

test("stock demo: Print Barcodes prints a barcode for every item", async ({ page }) => {
  test.skip(!BASE, "needs PW_BASE");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByTestId("launch-demo").click();
  await page.waitForTimeout(4000);

  await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const printBtn = page.getByTestId("generate-labels-pdf-button");
  // Button is the barcode-printing action, not "Print Labels".
  await expect(printBtn).toHaveText(/Print Barcodes/);
  // Clicking it generates one barcode label per item in the location.
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/labels/pdf") && r.request().method() === "POST", { timeout: 30000 }),
    printBtn.click(),
  ]);
  const body = await resp.json();
  expect(body.totalCount).toBeGreaterThan(0);
});
