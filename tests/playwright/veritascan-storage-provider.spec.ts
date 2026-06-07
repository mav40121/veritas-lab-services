// tests/playwright/veritascan-storage-provider.spec.ts
//
// Wave A1.2 happy-path: storage_provider is now required + must be
// from the controlled vocab. Save stays disabled until the user picks
// a real provider.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaScan Wave A1.2 — storage_provider required", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
    }, TOKEN);
  });

  test("Add Document dialog requires Storage Provider before Save", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritascan`);
    await page.getByRole("button", { name: /add document|link document|add/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Storage Provider/)).toBeVisible();

    // Fill the other required fields; leave storage provider unpicked.
    await dialog.getByLabel(/Title/i).fill("A1.2 Playwright test doc");
    await dialog.getByLabel(/External URL/i).fill("https://example.com/test");
    // Effective Date (A1.1 required)
    const effective = dialog.getByLabel(/Effective Date/i);
    await effective.fill("2026-06-06");

    const saveBtn = dialog.getByTestId("button-submit-add");
    await expect(saveBtn).toBeDisabled();
  });

  test("POST endpoint rejects missing storage_provider with the documented error", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritascan/documents`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {
        title: "A1.2 API verify",
        document_type: "policy",
        external_url: "https://example.com/test",
        effective_date: "2026-06-06",
        review_due_date: "2027-06-06",
      },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/storage_provider/i);
  });
});
