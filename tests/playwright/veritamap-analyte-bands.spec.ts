// tests/playwright/veritamap-analyte-bands.spec.ts
//
// Gate 3 step 8 (browser) evidence for PR 3: the VeritaMap age/sex band UI.
//
// Drives the REAL authenticated page (Michaels Lab, map 47): expands an analyte,
// adds an age band, confirms the band picker appears and the values grid follows
// the selected band, then removes the band and confirms the row returns to its
// single-band appearance. Server-side verify scripts cannot catch this: the band
// picker only renders once an analyte has >1 band, and switching bands has to
// re-hydrate the inputs without firing a spurious autosave.
//
// The two properties that matter and are only observable in a browser:
//   1. a single-band analyte shows NO band chrome (every existing lab today),
//   2. adding a band does not clobber the All-ages values.
//
// Gated behind PW_MAP_BANDS so CI stays compile-only; needs PW_TOKEN for a user
// with write access to the lab. Run against prod after deploy.
//
// Env: PW_BASE (default production www), PW_TOKEN (JWT), PW_MAP_BANDS=1 to run.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";
const MAP_ID = process.env.PW_MAP_ID || "47";
const ANALYTE = process.env.PW_ANALYTE || "Acetone";

test.describe("VeritaMap analyte age/sex bands", () => {
  test.beforeEach(async ({ page }) => {
    if (!process.env.PW_MAP_BANDS) test.skip(true, "Set PW_MAP_BANDS=1 to run against a deployed map.");
    if (!TOKEN) test.skip(true, "PW_TOKEN not set, skipping authenticated path.");
    await injectAuth(page, BASE, TOKEN);
  });

  test("single band shows no chrome; add a band, switch, then remove it", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app/${MAP_ID}`, { waitUntil: "domcontentloaded" });

    // Expand the analyte's row to reveal the values editor.
    const row = page.locator("tr", { hasText: ANALYTE }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();

    // 1. A single-band analyte must show NO band picker. This is every existing
    //    lab today, so it is the regression that would be most visible.
    await expect(page.getByText("Values for")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Add age/sex band" })).toBeVisible();

    // Seed a known All-ages value so we can prove adding a band does not eat it.
    const refLow = page.getByPlaceholder("e.g. 136").first();
    await refLow.fill("0.6");
    await page.waitForTimeout(2000); // debounced autosave is 1.5s

    // 2. Add a peds band (0 to 18 years).
    await page.getByRole("button", { name: "+ Add age/sex band" }).click();
    await page.getByPlaceholder("0").first().fill("0");
    await page.getByPlaceholder("blank = no limit").fill("18");
    await page.getByRole("button", { name: "Add band" }).click();

    // The picker appears only now that there are two bands.
    await expect(page.getByText("Values for")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /All ages/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /0 to 18 y/ })).toBeVisible();

    // 3. The new band starts empty; the All-ages value must be untouched.
    await expect(refLow).toHaveValue("");
    await page.getByRole("button", { name: /All ages/ }).click();
    await expect(refLow).toHaveValue("0.6");

    // 4. Remove the peds band and confirm the row returns to single-band chrome.
    await page.getByRole("button", { name: /0 to 18 y/ }).click();
    await page.getByRole("button", { name: "Remove this band" }).click();
    await expect(page.getByText("Values for")).toHaveCount(0, { timeout: 10000 });
    await expect(refLow).toHaveValue("0.6");
  });

  test("a duplicate band is refused rather than silently eating a server 400", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app/${MAP_ID}`, { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { hasText: ANALYTE }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();

    // All-ages already exists; adding 0 -> no-limit / Any is the same band.
    await page.getByRole("button", { name: "+ Add age/sex band" }).click();
    await page.getByPlaceholder("0").first().fill("0");
    await page.getByPlaceholder("blank = no limit").fill("");
    await page.getByRole("button", { name: "Add band" }).click();
    await expect(page.getByText("That band already exists")).toBeVisible({ timeout: 10000 });
  });

  test("an inverted age range is refused client-side", async ({ page }) => {
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app/${MAP_ID}`, { waitUntil: "domcontentloaded" });
    const row = page.locator("tr", { hasText: ANALYTE }).first();
    await expect(row).toBeVisible({ timeout: 20000 });
    await row.click();

    await page.getByRole("button", { name: "+ Add age/sex band" }).click();
    await page.getByPlaceholder("0").first().fill("40");
    await page.getByPlaceholder("blank = no limit").fill("10");
    await page.getByRole("button", { name: "Add band" }).click();
    await expect(page.getByText("Check the age range")).toBeVisible({ timeout: 10000 });
  });
});
