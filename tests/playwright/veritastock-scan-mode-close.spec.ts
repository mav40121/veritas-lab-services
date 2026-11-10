// tests/playwright/veritastock-scan-mode-close.spec.ts
//
// BUG-166 (Michael 2026-11-10, in a demo): opening VeritaStock "Scan Mode" and closing it showed the
// "Something went wrong" error screen. html5-qrcode's stop() throws (synchronously, a string) when the camera is
// not running: it never started (refused, unsupported, no camera) or is still starting. The modal's effect cleanup
// called it bare on close, React sent the throw to the error boundary, and the whole page was replaced.
//
// The live check of the bug path: the camera is refused (no permission granted), Scan Mode opens with its camera
// message, the X closes it, and the page is VeritaStock again with no error screen. The camera-running paths are
// in scripts/verify-scan-mode-close-ui.mjs (a local build; they need a full browser with a fake camera).
//
// Env:
//   PW_BASE    base URL (default prod)
//   PW_TOKEN   JWT for a user who can open the lab's VeritaStock page
//   PW_LAB_ID  lab id (no default: run it only on a test lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test("VeritaStock Scan Mode, camera refused: close returns to the page (BUG-166)", async ({ page, context }) => {
  test.skip(!TOKEN || !LAB_ID, "PW_TOKEN and PW_LAB_ID required");
  await context.clearPermissions(); // camera not granted
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e?.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, TOKEN]);
  await page.evaluate(([t, u, l]) => {
    const user = (u as any).user || u;
    localStorage.setItem("veritas_token", t as string);
    localStorage.setItem("veritas_user", JSON.stringify(user));
    localStorage.setItem("veritas_active_lab_id", String(l));
    localStorage.setItem(`onboarding_dismissed_${user.id}`, "1");
  }, [TOKEN, me, LAB_ID] as const);
  await page.goto(`${BASE}/labs/${LAB_ID}/veritastock`, { waitUntil: "domcontentloaded" });

  const scanBtn = page.getByTestId("open-scanner-button");
  await expect(scanBtn).toBeVisible({ timeout: 30_000 });
  await scanBtn.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(2500); // let the camera be refused
  await page.screenshot({ path: "test-results/bug166-scan-mode-open.png" });

  await dialog.getByRole("button", { name: /^close$/i }).last().click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/bug166-scan-mode-after-close.png" });

  await expect(page.getByText("Something went wrong")).toHaveCount(0);
  await expect(scanBtn).toBeVisible();
  expect(errors.filter((m) => /scanner is not running|cannot stop/i.test(m))).toEqual([]);
});
