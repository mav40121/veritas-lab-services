// tests/playwright/veritapace-howto-label.spec.ts
//
// Gate 3 step 8 evidence for the Bench-family naming fix. The /veritabench
// page is the VeritaPace productivity module end to end (hero, product card,
// app header, SEO title all say VeritaPace), but its ModuleHowToCard was
// mislabeled "How VeritaBench works". This asserts the card now agrees with
// the page: "How VeritaPace" is present and "How VeritaBench" is gone. The
// card renders in the public (logged-out) marketing landing, so no auth.
//
// Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaPace how-to card is not labeled VeritaBench", () => {
  test("/veritabench how-to card says VeritaPace", async ({ page }) => {
    await page.goto(`${BASE}/veritabench`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    // The module page is VeritaPace; its how-to card must agree.
    expect(body).toContain("How VeritaPace");
    expect(body).not.toContain("How VeritaBench");
  });
});
