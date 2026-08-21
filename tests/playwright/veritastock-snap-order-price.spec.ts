// tests/playwright/veritastock-snap-order-price.spec.ts
//
// Gate 3 step 8 for the Snap Order per-item price field (SCAHC / Christian
// Bartlett request, 2026-08-20): the operator types a price per item (the BD
// price the rep asks for on every order); it prints in a Price column on the
// generated Snap Order PDF.
//
// PW_TOKEN-gated UI exercise (skips cleanly in the reporting-only smoke run so it
// does not fail before deploy). Filling the field is the browser receipt on prod.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock Snap Order per-item price", () => {
  test("Price column and per-item price input exist and accept input", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set - skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock/snap-order`);

    // Price column header renders once the item table is present.
    await expect(page.getByText("Price", { exact: true }).first()).toBeVisible({ timeout: 15000 });

    // First item row: set an Order Qty so the row is active, then type a price.
    const qty = page.locator('[data-testid^="snap-qty-"]').first();
    const price = page.locator('[data-testid^="snap-price-"]').first();
    await expect(qty).toBeVisible();
    await expect(price).toBeVisible();
    await qty.fill("5");
    await price.fill("48.75");
    await expect(price).toHaveValue("48.75");
  });
});
