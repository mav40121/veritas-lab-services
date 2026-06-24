// tests/playwright/veritastock-accept-active-location.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock active-location accept/reject gate
// (server/routes.ts + VeritaStockPage.tsx + VeritaStockEnterprisePage.tsx).
// Receiving a transfer happens AT the destination, so:
//   - The MAIN page Incoming badge/banner reflect ONLY shipments bound for the
//     currently-selected location (server active_count). With the picker on a
//     non-destination location, no badge renders; switch to the destination and
//     the badge appears.
//   - The ENTERPRISE page still LISTS all pending incoming (oversight), but
//     Accept/Reject are enabled only when the selected location is the
//     destination; otherwise they're disabled with a "Switch to <location> to
//     accept" hint.
//
// Requires a multi-location OWNER session and two location ids under that owner:
//   PW_LAB_DEST  = the destination of the seeded pending batch (e.g. ED Stockroom)
//   PW_LAB_OTHER = any non-destination location in the same enterprise group
// Assumes the only pending incoming in the group is bound to PW_LAB_DEST (the
// San Carlos demo seeds exactly one Warehouse -> ED pending batch). Skips when
// the env isn't provided, so CI runs it compile-only.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     PW_LAB_DEST=<edId> PW_LAB_OTHER=<warehouseId> \
//     npx playwright test veritastock-accept-active-location

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const DEST = process.env.PW_LAB_DEST || "";
const OTHER = process.env.PW_LAB_OTHER || "";
const DRIVE = process.env.PW_DRIVE_ACCEPT === "1"; // opt-in: actually consumes the batch

const ready = () => !!(BASE && TOKEN && DEST && OTHER);

test.describe("VeritaStock active-location accept/reject gate", () => {
  test("main page badge is active-location scoped (absent off-destination, present on-destination)", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN/PW_LAB_DEST/PW_LAB_OTHER");
    await injectAuth(page, BASE, TOKEN);

    // Non-destination context: nothing is bound here -> no badge.
    await page.goto(`${BASE}/labs/${OTHER}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("incoming-count-badge")).toHaveCount(0);

    // Destination context: the seeded shipment is bound here -> badge appears.
    await page.goto(`${BASE}/labs/${DEST}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("incoming-count-badge")).toBeVisible({ timeout: 15000 });
  });

  test("enterprise Accept is disabled-with-hint from a non-destination location", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN/PW_LAB_DEST/PW_LAB_OTHER");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${OTHER}/veritastock/enterprise`, { waitUntil: "networkidle", timeout: 45000 });

    // The oversight panel still LISTS the pending shipment...
    const panel = page.getByTestId("incoming-transfers");
    await expect(panel).toBeVisible({ timeout: 15000 });

    // ...but every Accept/Reject is gated (no enabled control) with a switch hint.
    await expect(page.locator('[data-testid="accept-transfer"]:enabled')).toHaveCount(0);
    await expect(page.locator('[data-testid="reject-transfer"]:enabled')).toHaveCount(0);
    await expect(page.getByTestId("switch-hint").first()).toBeVisible();
  });

  test("enterprise Accept is enabled from the destination location", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN/PW_LAB_DEST/PW_LAB_OTHER");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${DEST}/veritastock/enterprise`, { waitUntil: "networkidle", timeout: 45000 });

    const panel = page.getByTestId("incoming-transfers");
    await expect(panel).toBeVisible({ timeout: 15000 });

    // In-context: the destination-bound shipment is actionable.
    await expect(page.locator('[data-testid="accept-transfer"]:enabled').first()).toBeVisible();
  });

  test("in-context Accept lands the stock (opt-in: consumes the pending batch)", async ({ page }) => {
    test.skip(!ready() || !DRIVE, "set PW_DRIVE_ACCEPT=1 to actually accept (destructive to demo state)");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${DEST}/veritastock/enterprise`, { waitUntil: "networkidle", timeout: 45000 });

    const accept = page.locator('[data-testid="accept-transfer"]:enabled').first();
    await expect(accept).toBeVisible({ timeout: 15000 });
    await accept.click();

    // Success toast confirms the stock landed at the destination.
    await expect(page.getByText(/Transfer accepted/i)).toBeVisible({ timeout: 15000 });
  });
});
