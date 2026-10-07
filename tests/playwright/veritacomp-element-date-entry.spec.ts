// tests/playwright/veritacomp-element-date-entry.spec.ts
//
// Gate 3 step 8 for parking-lot #75 (2026-10-07): the Element 2 / 3 / 4 date
// fields in the New Technical Assessment dialog use the shared DateEntry in a
// wider column, so the calendar control is fully visible and a date can be
// typed. Authed + needs a technical program whose instrument has an assigned
// employee (the CI sandbox has one). Run live:
//   PW_TOKEN=... PW_LAB_ID=<id> PW_PROGRAM_ID=<id> npx playwright test tests/playwright/veritacomp-element-date-entry.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const PROGRAM_ID = process.env.PW_PROGRAM_ID || "";

test.describe("VeritaComp assessment dialog: element dates use the shared date entry", () => {
  test("Element 2 date is typeable and its calendar control is inside the dialog", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID || !PROGRAM_ID, "PW_TOKEN / PW_LAB_ID / PW_PROGRAM_ID not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacomp-app/${PROGRAM_ID}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /New Assessment/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "assessment dialog opens").toBeVisible();

    const el2 = dialog.getByTestId("el2-date").first();
    await expect(el2, "Element 2 date entry renders").toBeVisible();
    await el2.scrollIntoViewIfNeeded();
    await el2.fill("10072026");
    await expect(el2).toHaveValue("10/07/2026");
    await el2.press("Tab");
    await expect(el2, "typed date is kept after blur").toHaveValue("10/07/2026");

    // The calendar button is fully inside the dialog (the old native control's icon was clipped).
    const cal = dialog.getByTestId("el2-date-calendar").first();
    await expect(cal).toBeVisible();
    const cb = await cal.boundingBox();
    const db = await dialog.boundingBox();
    expect(cb && db && cb.x >= db.x && cb.x + cb.width <= db.x + db.width, "calendar control sits within the dialog width").toBeTruthy();
    await cal.click();
    await expect(page.getByTestId("el2-date-popover"), "calendar popover opens").toBeVisible();
    await page.keyboard.press("Escape");
  });
});
