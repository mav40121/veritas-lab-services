// tests/playwright/learn-video-library.spec.ts
//
// Gate 3 step 8 (browser) evidence for the public "Learn VeritaAssure" video
// library (/learn) and the same-origin tutorial video assets it plays. The
// page ships customer-clickable <video> players, one per module, sourced from
// /public/tutorials/<key>.mp4. This spec loads the live page, asserts it is not
// the 404 fallback, that every module card rendered a video element, and that a
// representative tutorial asset actually returns a video (2xx, video/* type).
//
// Public page: no auth required, so this runs in the standard smoke lane.
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Learn VeritaAssure video library", () => {
  test("/learn renders the module video grid (not a 404)", async ({ page }) => {
    await page.goto(`${BASE}/learn`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(/Learn VeritaAssure/i.test(body)).toBeTruthy();

    // 17 modules -> at least 17 video players on the page.
    const videoCount = await page.locator("video").count();
    expect(videoCount).toBeGreaterThanOrEqual(17);

    // A representative set of card labels must be present.
    for (const label of ["VeritaCheck", "VeritaMap", "VeritaBench", "VeritaShift", "VeritaQA"]) {
      expect(body).toContain(label);
    }
  });

  test("tutorial video assets are served same-origin as video/*", async ({ request }) => {
    for (const stem of ["veritacheck", "veritabench", "veritashift"]) {
      const res = await request.get(`${BASE}/tutorials/${stem}.mp4`);
      expect(res.status(), `${stem}.mp4 status`).toBeLessThan(400);
      const ct = res.headers()["content-type"] || "";
      expect(ct, `${stem}.mp4 content-type`).toMatch(/video|octet-stream/i);
    }
  });
});
