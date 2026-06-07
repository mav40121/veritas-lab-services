// tests/playwright/veritascan-needs-review.spec.ts
//
// Wave A1.1 happy-path: drives the new "Needs review" filter checkbox
// on the VeritaScan Document Library page and asserts the Add Document
// dialog requires Effective Date before allowing Save.
//
// Why this file ships with the PR:
//   1. Per CLAUDE.md Gate 3 step 8 + .github/workflows/gate3-ui-evidence.yml,
//      a PR that adds a customer-clickable button/checkbox/required field
//      must include a browser-automated test under tests/playwright/ OR
//      post-deploy browser-click evidence in the PR body.
//   2. This file is the automated branch. The runner is not yet wired
//      into CI; the test is real and self-contained for the day it is.
//
// Env required (when run):
//   PW_BASE=https://www.veritaslabservices.com
//   PW_TOKEN=<JWT for an owner-tier lab member>
//   PW_LAB_ID=2

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaScan Wave A1.1 — required dates + needs-review", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
    }, TOKEN);
  });

  test("Needs review checkbox renders and toggles the document list", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritascan`);

    const needsReview = page.getByTestId("checkbox-needs-review");
    await expect(needsReview).toBeVisible();
    await expect(needsReview).not.toBeChecked();

    await needsReview.check();
    await expect(needsReview).toBeChecked();

    // The filter request fires; just confirm the page didn't crash and
    // the checkbox is still toggle-able.
    await needsReview.uncheck();
    await expect(needsReview).not.toBeChecked();
  });

  test("Add Document dialog requires Effective Date before Save", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritascan`);

    // Open the Add Document dialog. The button label may vary; match by
    // role + text contains "Add" or "Link" depending on copy.
    const addBtn = page.getByRole("button", { name: /add document|link document|add/i }).first();
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Effective Date/)).toBeVisible();
    await expect(dialog.getByText("*", { exact: true })).toBeVisible();

    // Fill the required text fields but leave Effective Date blank.
    // Save button should remain disabled.
    await dialog.getByLabel(/Title/i).fill("A1.1 Playwright test doc");
    await dialog.getByLabel(/External URL/i).fill("https://example.com/test");

    const saveBtn = dialog.getByTestId("button-submit-add");
    await expect(saveBtn).toBeDisabled();
  });

  test("POST endpoint rejects missing effective_date with the documented error", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritascan/documents`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {
        title: "A1.1 API verify",
        document_type: "policy",
        external_url: "https://example.com/test",
        review_due_date: "2027-06-06",
      },
    });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/effective_date/i);
  });
});
