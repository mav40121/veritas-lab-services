// tests/playwright/veritatrack-add-task-multilab.spec.ts
//
// Regression test for the 2026-06-07 Add Task bug on secondary labs.
// Drives the New Task dialog on /labs/3/veritatrack-app, submits, and
// asserts the new row appears in the list — the user-visible symptom
// that the original bug broke.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaTrack Add Task on secondary lab", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((tok) => {
      window.localStorage.setItem("auth_token", tok);
    }, TOKEN);
  });

  test("Scoped POST endpoint attributes the new row to the active lab", async ({ request }) => {
    const uniqueName = `A2-PW-VERIFY-${Date.now()}`;
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/veritatrack/tasks`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: { name: uniqueName, category: "Other", frequency: "Monthly", frequency_months: 1 },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body.lab_id).toBe(Number(LAB_ID));

    const list = await request.get(`${BASE}/api/labs/${LAB_ID}/veritatrack/tasks`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(list.status()).toBe(200);
    const tasks = await list.json();
    expect(tasks.some((t: any) => t.id === body.id)).toBe(true);

    // Cleanup
    await request.delete(`${BASE}/api/veritatrack/tasks/${body.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  test("Add Task dialog drives the lab-scoped flow end to end", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritatrack-app`);
    const addBtn = page.getByRole("button", { name: /Add Task/i }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const uniqueName = `A2-PW-UI-${Date.now()}`;
    await dialog.getByPlaceholder(/Cal Ver/i).fill(uniqueName);
    await dialog.getByRole("button", { name: /Add Task/i }).click();

    // Dialog should close.
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
    // New task should appear in the list.
    await expect(page.getByText(uniqueName, { exact: false })).toBeVisible({ timeout: 5000 });
  });
});
