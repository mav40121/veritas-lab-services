// tests/playwright/instruments-picker-select-all.spec.ts
//
// Gate 3 step 8 for the EmployeeInstrumentsPickerDialog Select all /
// Clear buttons (2026-06-08). The picker mounts on the VeritaStaff
// employee detail page behind the "Assign Instruments" button. This
// spec verifies the buttons are present in the rendered DOM when a
// staff member detail is loaded, and asserts the test-ids exist so
// future regressions are detectable.
//
// The dialog renders client-side after a director loads
// /labs/:labId/veritastaff-app/:employeeId and clicks the assigned-
// instruments edit affordance. Authenticated only.
//
// Env:
//   PW_BASE     - base URL (default: prod)
//   PW_TOKEN    - director JWT (optional; skips DOM check when absent)
//   PW_LAB_ID   - lab id (default 2)
//   PW_EMPLOYEE - employee id with at least 1 lab instrument

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";
const EMPLOYEE = process.env.PW_EMPLOYEE || "";

test.describe("Assign Instruments picker bulk actions", () => {
  test("Select all + Clear buttons render when picker is open", async ({ page }) => {
    test.skip(!TOKEN || !EMPLOYEE, "PW_TOKEN / PW_EMPLOYEE not set");

    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("auth_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastaff-app/${EMPLOYEE}`);

    // The picker opens via the "Assign Instruments" / edit button on the
    // detail card. The dialog title text is the stable handle.
    const trigger = page.getByRole("button", { name: /Assign Instruments|Edit instruments/i }).first();
    await expect(trigger).toBeVisible({ timeout: 10000 });
    await trigger.click();

    await expect(page.getByRole("dialog").getByText("Assign Instruments")).toBeVisible();

    // Bulk action buttons must exist
    const selectAll = page.getByTestId("instruments-picker-select-all");
    const clearAll = page.getByTestId("instruments-picker-clear-all");
    await expect(selectAll).toBeVisible();
    await expect(clearAll).toBeVisible();
    await expect(selectAll).toHaveText(/Select all/i);
    await expect(clearAll).toHaveText(/Clear/i);
  });
});
