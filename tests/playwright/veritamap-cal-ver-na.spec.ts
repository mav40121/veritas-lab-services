// tests/playwright/veritamap-cal-ver-na.spec.ts
//
// Gate 3 step 8 for parking-lot #77 part B (2026-10-07): on the map page a lab
// can mark a test's calibration verification not applicable with a reason; the
// cell then reads "N/A: reason", the header count drops by one, and "Cal ver
// required again" restores the date cell and the count. Authed, so env-gated;
// writes to the FIRST undated, non-exempt row of the target map and restores it,
// so point PW_MAP_URL only at a QA map. Run live:
//   PW_TOKEN=... PW_MAP_URL=/labs/<id>/veritamap-app/<mapId> npx playwright test tests/playwright/veritamap-cal-ver-na.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || "";

async function requiredCount(page: import("@playwright/test").Page): Promise<number> {
  const txt = await page.getByText(/\d+ Cal Verifications? Required/).first().textContent();
  return Number((txt || "").match(/(\d+) Cal Verification/)?.[1] || -1);
}

test.describe("VeritaMap: per-test cal ver not applicable", () => {
  test("mark N/A with a reason, see it in the cell and the count, then restore", async ({ page }) => {
    test.skip(!TOKEN || !MAP_URL, "PW_TOKEN / PW_MAP_URL not set, skipping authed exercise");
    test.setTimeout(90_000);
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });

    const before = await requiredCount(page);
    expect(before, "header count parsed").toBeGreaterThan(0);

    // First row that still has the N/A control (undated, not exempt, not already N/A).
    // Anchor the row by its analyte name: once N/A is applied the opener leaves
    // the DOM and a locator derived from it would re-resolve to the next row.
    const opener = page.getByTestId("cal-ver-na-open").first();
    await expect(opener, "an N/A control is offered on a required row").toBeVisible();
    const analyte = ((await opener.locator("xpath=ancestor::tr[1]").locator("td").first().innerText()) || "").split("\n")[0].trim();
    expect(analyte, "analyte name read from the row").not.toBe("");
    const row = page.locator("tr", { hasText: analyte }).first();
    await opener.click();
    const pop = page.getByTestId("cal-ver-na-popover");
    await expect(pop, "reason popover opens").toBeVisible();
    await pop.getByTestId("cal-ver-na-reason-1").check();
    await pop.getByTestId("cal-ver-na-save").click();

    const naCell = row.getByTestId("cal-ver-na");
    await expect(naCell, "cell reads N/A with the reason").toContainText("N/A: No user calibration on this device");
    await expect.poll(() => requiredCount(page), { timeout: 8_000 }).toBe(before - 1);

    // Restore.
    await row.getByTestId("cal-ver-na-undo").click();
    await expect(row.getByTestId("cal-ver-na")).toHaveCount(0);
    await expect(row.getByTestId("cal-ver-na-open"), "N/A control is offered again").toBeVisible();
    await expect.poll(() => requiredCount(page), { timeout: 8_000 }).toBe(before);
  });
});
