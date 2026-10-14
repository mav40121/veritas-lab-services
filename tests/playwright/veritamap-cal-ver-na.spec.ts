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

// 2026-10-14: a run that failed between "mark N/A" and "restore" left its row N/A on the QA map. Five such leaks
// (10/8 to 10/14) used up every required row, so "0 Cal Verifications Required" failed every later run, PR and main.
// The test now clears its own reason through the app's PUT route before it counts, and again in a finally.
const LEAK_REASON = "No user calibration on this device";
const [, LAB_ID, MAP_ID] = MAP_URL.match(/\/labs\/(\d+)\/veritamap-app\/(\d+)/) || [];
const API = () => `${BASE}/api/labs/${LAB_ID}/veritamap/maps/${MAP_ID}`;
const H = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, "X-Active-Lab-Id": String(LAB_ID) });
async function clearNa(analyte: string) {
  await fetch(`${API()}/tests/${encodeURIComponent(analyte)}`, { method: "PUT", headers: H(), body: JSON.stringify({ cal_ver_na: false }) });
}
async function clearLeakedNa() {
  const j = await (await fetch(API(), { headers: H() })).json().catch(() => ({}));
  for (const t of (j.tests || j.map?.tests || []) as Array<{ analyte: string; cal_ver_na: number; cal_ver_na_reason?: string }>) {
    if (t.cal_ver_na && String(t.cal_ver_na_reason || "").startsWith(LEAK_REASON)) await clearNa(t.analyte);
  }
}

test.describe("VeritaMap: per-test cal ver not applicable", () => {
  test("mark N/A with a reason, see it in the cell and the count, then restore", async ({ page }) => {
    test.skip(!TOKEN || !MAP_URL, "PW_TOKEN / PW_MAP_URL not set, skipping authed exercise");
    test.setTimeout(90_000);
    expect(LAB_ID && MAP_ID, "PW_MAP_URL is /labs/<id>/veritamap-app/<mapId>").toBeTruthy();
    await clearLeakedNa();
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
    try {
      await opener.click();
      const pop = page.getByTestId("cal-ver-na-popover");
      await expect(pop, "reason popover opens").toBeVisible();
      await pop.getByTestId("cal-ver-na-reason-1").check();
      await pop.getByTestId("cal-ver-na-save").click();

      const naCell = row.getByTestId("cal-ver-na");
      await expect(naCell, "cell reads N/A with the reason").toContainText(`N/A: ${LEAK_REASON}`);
      await expect.poll(() => requiredCount(page), { timeout: 8_000 }).toBe(before - 1);

      // Restore.
      await row.getByTestId("cal-ver-na-undo").click();
      await expect(row.getByTestId("cal-ver-na")).toHaveCount(0);
      await expect(row.getByTestId("cal-ver-na-open"), "N/A control is offered again").toBeVisible();
      await expect.poll(() => requiredCount(page), { timeout: 8_000 }).toBe(before);
    } finally {
      // The row was required (it offered the N/A control), so clearing N/A only ever returns it to its starting state.
      await clearNa(analyte);
    }
  });
});
