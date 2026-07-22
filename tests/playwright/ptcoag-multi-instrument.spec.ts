// tests/playwright/ptcoag-multi-instrument.spec.ts
//
// Gate 3 receipt for symmetric multi-instrument PT/INR geomean support (2026-07-21).
// The VeritaCheck PT/INR (CLSI H47) authoring form lets a study verify N
// analyzers: Module 1 starts with one instrument, and an "Add instrument"
// button appends independent instrument blocks, each with its own ISI, reagent
// lot, PT/INR reference intervals, and normal-specimen grid. This spec drives
// that affordance in the real browser: add two extra instruments, confirm the
// per-instrument labels and remove controls, then remove one.
//
// Needs creds: PW_TOKEN + PW_LAB_ID (any VeritaCheck-enabled lab). Skips cleanly
// without them, so the compile-only smoke gate stays green. It does not save a
// study, so it creates no data.
//
// Run: PW_TOKEN=... PW_LAB_ID=1 npx playwright test ptcoag-multi-instrument

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaCheck PT/INR geomean: multi-instrument authoring", () => {
  test("Add instrument appends independent Module-1 blocks; Remove drops one", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "networkidle" });

    // Select the PT/INR Geometric Mean study type from the dropdown (the real
    // user path; more robust than a deep-link query param).
    await page.getByTestId("select-study-type").click();
    await page.getByRole("option", { name: /PT\/INR Geometric Mean/i }).click();

    // The Module-1 entry (with the Add-instrument flow) lives on the Data Entry tab.
    await page.getByText("Data Entry", { exact: true }).click();

    // The pt_coag form renders with a single instrument: the "Add instrument"
    // button is present and no additional-instrument Remove control exists yet.
    const addBtn = page.getByTestId("pt-add-instrument");
    await expect(addBtn).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("pt-remove-instrument-0")).toHaveCount(0);
    // "Instrument 1" sub-label only appears once there is more than one.
    await expect(page.getByText("Instrument 1", { exact: true })).toHaveCount(0);

    // Add a second instrument: Instrument 1 + Instrument 2 labels appear and the
    // first additional block exposes a Remove control.
    await addBtn.click();
    await expect(page.getByTestId("pt-remove-instrument-0")).toBeVisible();
    await expect(page.getByText("Instrument 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Instrument 2", { exact: true })).toBeVisible();

    // Add a third instrument.
    await addBtn.click();
    await expect(page.getByTestId("pt-remove-instrument-1")).toBeVisible();
    await expect(page.getByText("Instrument 3", { exact: true })).toBeVisible();

    // Remove the third instrument: its Remove control disappears, Instrument 2 stays.
    await page.getByTestId("pt-remove-instrument-1").click();
    await expect(page.getByTestId("pt-remove-instrument-1")).toHaveCount(0);
    await expect(page.getByTestId("pt-remove-instrument-0")).toBeVisible();
    await expect(page.getByText("Instrument 2", { exact: true })).toBeVisible();
    await expect(page.getByText("Instrument 3", { exact: true })).toHaveCount(0);
  });
});
