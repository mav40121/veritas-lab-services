// tests/playwright/veritatrack-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaTrack error-as-empty fix (audit #2). The
// regulatory-calendar page used to render "No tasks yet" on a FAILED tasks load
// (and auto-open the re-seed panel), so a broken endpoint looked identical to an
// empty calendar. This forces the tasks endpoint to 500 and asserts the page
// shows the distinct "Couldn't load your calendar" error card, not the empty
// state. Needs PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaTrack calendar error state", () => {
  test("a 500 on the tasks endpoint shows the error card, not 'No tasks yet'", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/veritatrack/tasks", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritatrack-app`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load your calendar/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/No tasks yet/i)).toHaveCount(0);
  });
});
