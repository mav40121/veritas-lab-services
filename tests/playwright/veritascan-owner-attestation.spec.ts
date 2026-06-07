// tests/playwright/veritascan-owner-attestation.spec.ts
//
// Wave A1.3 happy-path: Owner Select is now required + populated from
// /api/labs/:labId/members. Save stays disabled until an owner is picked.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaScan Wave A1.3 — owner attestation", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
    }, TOKEN);
  });

  test("Add Document dialog requires Owner before Save", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritascan`);
    await page.getByRole("button", { name: /add document|link document|add/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Owner/)).toBeVisible();
    await expect(dialog.getByTestId("select-add-owner")).toBeVisible();

    // Fill all other required fields, leave Owner unpicked.
    await dialog.getByLabel(/Title/i).fill("A1.3 Playwright test doc");
    await dialog.getByLabel(/External URL/i).fill("https://example.com/test");
    await dialog.getByLabel(/Effective Date/i).fill("2026-06-06");

    const saveBtn = dialog.getByTestId("button-submit-add");
    await expect(saveBtn).toBeDisabled();
  });

  test("POST endpoint rejects missing owner_user_id with the documented error", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritascan/documents`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {
        title: "A1.3 API verify",
        document_type: "policy",
        external_url: "https://example.com/test",
        storage_provider: "sharepoint",
        effective_date: "2026-06-06",
        review_due_date: "2027-06-06",
      },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/owner_user_id/i);
  });
});
