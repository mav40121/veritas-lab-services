// tests/playwright/veritapolicy-tab-nav.spec.ts
//
// Gate 3 step 8 receipt for the VeritaPolicy 3-tab nav (2026-06-10).
// Confirms the shared tab bar mounts on all three VeritaPolicy pages
// (Master List / My Policies / Compliance) and that each tab links to
// the correct lab-scoped route, closing the dead-end where My Policies
// had no path back to the Master List.
//
// The live cross-navigation click path needs Michael's browser confirm
// after deploy because it needs an authenticated session on a lab.
//
// PW_TOKEN: a logged-in veritas_token. PW_LAB_ID: a lab the user is an
// active member of (e.g. San Carlos = 2).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

async function auth(page: any) {
  await page.goto(`${BASE}/`);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaPolicy tab nav", () => {
  test("tab bar mounts on Master List with correct hrefs", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await auth(page);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app`);
    await expect(page.getByTestId("veritapolicy-tabs")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("veritapolicy-tab-master")).toHaveAttribute("href", `/labs/${LAB_ID}/veritapolicy-app`);
    await expect(page.getByTestId("veritapolicy-tab-my-policies")).toHaveAttribute("href", `/labs/${LAB_ID}/veritapolicy-app/my-policies`);
    await expect(page.getByTestId("veritapolicy-tab-compliance")).toHaveAttribute("href", `/labs/${LAB_ID}/veritapolicy-app/compliance`);
  });

  test("tab bar mounts on My Policies (the previously dead-ended page)", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await auth(page);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/my-policies`);
    await expect(page.getByTestId("veritapolicy-tabs")).toBeVisible({ timeout: 10000 });
    // The whole point of the fix: a link back to the Master List exists here now.
    await expect(page.getByTestId("veritapolicy-tab-master")).toHaveAttribute("href", `/labs/${LAB_ID}/veritapolicy-app`);
  });

  test("tab bar mounts on Compliance", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await auth(page);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritapolicy-app/compliance`);
    await expect(page.getByTestId("veritapolicy-tabs")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("veritapolicy-tab-my-policies")).toBeVisible();
  });
});
