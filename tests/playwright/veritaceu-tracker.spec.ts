// tests/playwright/veritaceu-tracker.spec.ts
//
// Authed browser smoke for Build #6 (VeritaCEU). On an employee detail page the
// "Continuing Education" card renders with a progress meter, and the "Add CE
// Credit" button opens a dialog carrying the Credits + Activity date fields.
// This exercises the customer-clickable UI (Gate 3 step 8); it does NOT persist
// a credit, so it writes nothing to the lab.
//
// Env-gated: PW_TOKEN (member of a VeritaStaff-enabled lab) + PW_LAB_ID, and
// PW_EMPLOYEE_ID for the employee whose detail page to open. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_EMPLOYEE_ID=NN npx playwright test veritaceu-tracker

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const EMP = process.env.PW_EMPLOYEE_ID;

test.describe("VeritaCEU — continuing-education tracker", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !EMP, "Set PW_TOKEN, PW_LAB_ID and PW_EMPLOYEE_ID to run the VeritaCEU check.");
  });

  test("CE card renders and the add dialog exposes credits + date", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app/${EMP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // The Continuing Education card heading.
    const heading = page.getByText("Continuing Education", { exact: true });
    await expect(heading.first()).toBeVisible();

    // Progress meter copy references the rolling cycle.
    await expect(page.getByText(/rolling .*month cycle/i).first()).toBeVisible();

    // Open the add dialog and confirm the CE-specific fields exist.
    await page.getByRole("button", { name: /Add CE Credit/i }).first().click();
    await page.waitForTimeout(400);
    await expect(page.getByText("Add CE Credit", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Certificate URL/i).first()).toBeVisible();
    await expect(page.getByText(/^Credits/i).first()).toBeVisible();
    await expect(page.getByText(/Activity date/i).first()).toBeVisible();

    // Close without saving — no data written.
    await page.getByRole("button", { name: /^Cancel$/ }).first().click();
    await ctx.close();
  });
});
