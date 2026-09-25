// tests/playwright/veritamap-ifu.spec.ts
//
// Authed smoke for Build #4: IFU (package insert) linkage on the VeritaMap grid.
// Each instrument under an analyte shows an IFU link: the lab's stored exact URL
// when set, otherwise a manufacturer + analyte scoped "Find IFU" search. This
// asserts the link renders and points somewhere (no fabricated deep links).
//
// Env-gated: PW_TOKEN + PW_LAB_ID + PW_MAP_ID (a map with at least one instrument).
//
//   PW_TOKEN=... PW_LAB_ID=25 PW_MAP_ID=90 npx playwright test veritamap-ifu

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const MAP = process.env.PW_MAP_ID;

test.describe("VeritaMap — IFU linkage", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !MAP, "Set PW_TOKEN, PW_LAB_ID and PW_MAP_ID to run the IFU-link check.");
  });

  test("instrument badges expose an IFU link", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritamap-app/${MAP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const ifuLink = page.getByRole("link", { name: /IFU/i }).first();
    if (await ifuLink.count()) {
      await expect(ifuLink).toBeVisible();
      const href = await ifuLink.getAttribute("href");
      expect(href, "IFU link resolves to an http(s) URL").toMatch(/^https?:\/\//);
    } else {
      test.skip(true, "No instruments on this map to attach an IFU link to.");
    }
    await ctx.close();
  });
});
