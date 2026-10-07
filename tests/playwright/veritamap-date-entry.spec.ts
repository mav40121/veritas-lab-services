// tests/playwright/veritamap-date-entry.spec.ts
//
// Gate 3 step 8 for parking-lot #78 (2026-10-07): the Cal Ver / Method
// Comparison cells on the map page use the shared DateEntry. Typing a date
// with no slashes saves it as ISO, Today saves today's local date, Clear saves
// an empty value, and a nonsense entry is refused without a save. Authed, so
// env-gated; writes dates into the FIRST undated row of the target map, so
// point PW_MAP_URL only at a QA map, never a customer lab. It restores the
// cell to empty at the end. Run live:
//   PW_TOKEN=... PW_MAP_URL=/labs/<id>/veritamap-app/<mapId> npx playwright test tests/playwright/veritamap-date-entry.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || "";

function todayLocalISO(): string {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

test.describe("VeritaMap: shared date entry on the map cells", () => {
  test("typed, Today, Clear and invalid entries behave", async ({ page }) => {
    test.skip(!TOKEN || !MAP_URL, "PW_TOKEN / PW_MAP_URL not set, skipping authed exercise");
    test.setTimeout(90_000);
    await injectAuth(page, BASE, TOKEN);

    const puts: Array<{ url: string; body: any }> = [];
    page.on("request", (req) => {
      if (req.method() === "PUT" && /\/veritamap\/maps\/\d+\/tests\//.test(req.url())) {
        let body: any = null; try { body = req.postDataJSON(); } catch {}
        puts.push({ url: req.url(), body });
      }
    });

    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });
    // First Cal Ver date entry that is empty (undated row).
    const inputs = page.getByTestId("date-entry-input");
    await expect(inputs.first()).toBeVisible();
    const n = await inputs.count();
    let target = inputs.first();
    for (let i = 0; i < n; i++) { const v = await inputs.nth(i).inputValue(); if (!v) { target = inputs.nth(i); break; } }

    // 1. Typed without slashes -> masked -> saved as ISO on blur. A fixed past
    //    date, so step 3 (Today) is always a change.
    await target.click();
    await target.fill("09152026");
    await expect(target).toHaveValue("09/15/2026");
    await target.press("Tab");
    await expect.poll(() => puts.length, { timeout: 8_000 }).toBe(1);
    expect(JSON.stringify(puts[0].body)).toContain("2026-09-15");

    // 2. Nonsense is refused: no save, field flagged.
    await target.click();
    await target.fill("13452026");
    await target.press("Tab");
    await page.waitForTimeout(1_500);
    expect(puts.length, "invalid entry must not save").toBe(1);
    await expect(target).toHaveAttribute("aria-invalid", "true");

    // 3. Today from the calendar popover saves today's local date.
    const wrap = target.locator("xpath=..");
    await wrap.getByTestId("date-entry-calendar").click();
    await expect(page.getByTestId("date-entry-popover")).toBeVisible();
    await page.getByTestId("date-entry-today").click();
    await expect.poll(() => puts.length, { timeout: 8_000 }).toBe(2);
    expect(JSON.stringify(puts[1].body)).toContain(todayLocalISO());

    // 4. Clear restores the empty cell (leaves the sandbox as found).
    await wrap.getByTestId("date-entry-calendar").click();
    await page.getByTestId("date-entry-clear").click();
    await expect.poll(() => puts.length, { timeout: 8_000 }).toBe(3);
    await expect(target).toHaveValue("");
  });
});
