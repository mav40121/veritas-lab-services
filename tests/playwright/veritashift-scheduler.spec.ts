// tests/playwright/veritashift-scheduler.spec.ts
//
// Gate 3 step 8 for the VeritaShift Scheduler UI (Phase 1, 2026-08-20):
//   - Manager scheduler page: shift blocks, schedule week, weekly coverage grid
//     with amber gap flags, and Publish. Competency scheduling is OFF this phase.
//
// PW_TOKEN-gated UI exercise (skips cleanly in the reporting-only smoke run).
// Read-only: asserts the page mounts and its core controls render (no writes).
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaShift Scheduler page", () => {
  test("scheduler page mounts with its core controls", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritabench/scheduler`);

    // Heading and the shift-blocks + schedule-week controls render.
    await expect(page.getByRole("heading", { name: /scheduler/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("shift-name")).toBeVisible();
    await expect(page.getByTestId("shift-start")).toBeVisible();
    await expect(page.getByTestId("period-select")).toBeVisible();
    await expect(page.getByTestId("period-start")).toBeVisible();
  });
});
