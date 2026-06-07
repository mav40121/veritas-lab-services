// tests/playwright/inventory-kiosk.spec.ts
//
// Wave K4 happy-path test. The kiosk surface is unauthenticated
// (no user JWT in localStorage), bookmark-friendly at /inventory,
// and a multi-PR flow (PIN rotated by director → tech enters PIN
// → tech adjusts a quantity). Per feedback_multi_pr_needs_playwright_gate3
// the customer-clickable surface needs a browser-driven happy path
// before Gate 3 closes.
//
// Env:
//   PW_BASE  — base URL (default: prod)
//   PW_TOKEN — director JWT, used ONLY to rotate the PIN out-of-band
//   PW_LAB_ID — lab to exercise (default 2 = San Carlos Apache)
//   PW_CLIA  — that lab's CLIA number (default 03D0531813)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";
const CLIA = process.env.PW_CLIA || "03D0531813";

test.describe("Inventory Kiosk happy path", () => {
  test("Director rotates PIN, tech signs in, adjusts a qty, restores it", async ({ page, request }) => {
    // Step 1: rotate the PIN via the K1 director endpoint (uses TOKEN out
    // of band — the kiosk surface itself never sees a user JWT).
    const rot = await request.post(`${BASE}/api/labs/${LAB_ID}/inventory-pin/regenerate`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {},
    });
    expect(rot.status()).toBe(200);
    const rotBody = await rot.json();
    const pin: string = rotBody.pin;
    expect(pin).toMatch(/^\d{6}$/);

    // Step 2: read the first item's current qty so we can restore it
    const auth0 = await request.post(`${BASE}/api/inventory-login`, {
      headers: { "Content-Type": "application/json" },
      data: { clia: CLIA, pin },
    });
    expect(auth0.status()).toBe(200);
    const kioskJwt = (await auth0.json()).token;
    const listResp = await request.get(`${BASE}/api/inventory-session/items`, {
      headers: { Authorization: `Bearer ${kioskJwt}` },
    });
    expect(listResp.status()).toBe(200);
    const items = (await listResp.json()).items;
    if (!items?.length) {
      test.skip(true, "No inventory items in this lab to exercise the kiosk on.");
      return;
    }
    const target = items[0];
    const originalQty = target.quantity_on_hand;

    // Step 3: drive the kiosk login UI as if from a tablet (no auth_token
    // in localStorage; the kiosk route is unauthenticated)
    await page.goto(`${BASE}/inventory`);
    await expect(page.getByTestId("kiosk-login")).toBeVisible();

    await page.getByTestId("kiosk-clia-input").fill(CLIA);
    await page.getByTestId("kiosk-pin-input").fill(pin);
    await page.getByTestId("kiosk-login-submit").click();

    // Step 4: kiosk shell is now visible, lab name surfaced
    await expect(page.getByTestId("kiosk-shell")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("kiosk-lab-name")).toContainText(/Healthcare|Lab/i, { timeout: 5000 });

    // Step 5: enter initials, set a new quantity, save
    const desiredQty = originalQty + 11;
    await page.getByTestId("kiosk-initials-input").fill("PW");

    const rowInput = page.getByTestId(`kiosk-item-input-${target.id}`);
    await rowInput.fill(String(desiredQty));
    await page.getByTestId(`kiosk-item-save-${target.id}`).click();

    // Step 6: saved chip appears and the displayed qty matches the new value
    await expect(page.getByTestId(`kiosk-item-saved-${target.id}`)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId(`kiosk-item-qty-${target.id}`)).toContainText(String(desiredQty));

    // Step 7: API confirms persistence
    const listAfter = await request.get(`${BASE}/api/inventory-session/items`, {
      headers: { Authorization: `Bearer ${kioskJwt}` },
    });
    const itemsAfter = (await listAfter.json()).items;
    const fresh = itemsAfter.find((i: any) => i.id === target.id);
    expect(fresh.quantity_on_hand).toBe(desiredQty);

    // Step 8: restore so the test is idempotent across re-runs
    await page.getByTestId(`kiosk-item-input-${target.id}`).fill(String(originalQty));
    await page.getByTestId(`kiosk-item-save-${target.id}`).click();
    await expect(page.getByTestId(`kiosk-item-saved-${target.id}`)).toBeVisible({ timeout: 5000 });

    // Step 9: sign out returns to the login screen
    await page.getByTestId("kiosk-signout-button").click();
    await expect(page.getByTestId("kiosk-login")).toBeVisible();
  });
});
