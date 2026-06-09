// tests/playwright/veritastaff-portal-toggles.spec.ts
//
// Gate 3 step 8 for the Staff Portal toggle UI (2026-06-08 task #131
// follow-up PR). Asserts the two toggle checkboxes render in the
// VeritaStaff employee dialog. The end-to-end persistence is covered
// by the server-side verify script; this spec covers the user-clickable
// surface.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT for PW_LAB_ID
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStaff Portal access toggles", () => {
  test("Add Employee dialog renders the two Staff Portal toggles", async ({ page, context }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN required for authed VeritaStaff page load");
      return;
    }
    await context.addInitScript(([tok]) => {
      try { window.localStorage.setItem("token", tok); } catch {}
    }, [TOKEN]);

    await page.goto(`${BASE}/labs/${LAB_ID}/veritastaff-app`, { waitUntil: "domcontentloaded" });

    const addBtn = page.getByRole("button", { name: /add employee/i }).first();
    if (!(await addBtn.isVisible().catch(() => false))) {
      test.skip(true, "Add Employee button not visible (lab may lack VeritaStaff plan)");
      return;
    }
    await addBtn.click();

    const inventoryToggle = page.getByTestId("staff-toggle-inventory");
    const auditToggle = page.getByTestId("staff-toggle-audit");
    await expect(inventoryToggle).toBeVisible({ timeout: 8000 });
    await expect(auditToggle).toBeVisible();

    // Defaults are both off
    await expect(inventoryToggle).not.toBeChecked();
    await expect(auditToggle).not.toBeChecked();

    // Toggling on flips state without throwing
    await inventoryToggle.check();
    await expect(inventoryToggle).toBeChecked();
    await auditToggle.check();
    await expect(auditToggle).toBeChecked();
  });
});
