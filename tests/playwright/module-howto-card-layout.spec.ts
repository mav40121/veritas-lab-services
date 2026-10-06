// tests/playwright/module-howto-card-layout.spec.ts
//
// Regression + Gate 3 step 8 for ModuleHowToCard placement. The "How X works"
// getting-started card (with the educational video) must render as a full-width
// banner BELOW the page header, not wedged inside the header's justify-between
// flex row as a narrow, left-shunted column. Reported 2026-10-06 (Lisa) on
// VeritaStaff; the same misplacement was on VeritaPT, VeritaResponse, VeritaLab,
// and VeritaPolicy. These are authenticated app pages, so this is env-gated
// (needs PW_TOKEN) and CI stays compile-only. Run against a deployed build:
//   PW_TOKEN=... PW_LAB_ID=5 npx playwright test tests/playwright/module-howto-card-layout.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "5";

const PAGES = [
  "veritastaff-app",
  "veritapt-app",
  "veritaresponse-app",
  "veritalab-app",
  "veritapolicy-app",
];

test.describe("ModuleHowToCard full-width placement", () => {
  for (const slug of PAGES) {
    test(`${slug}: how-to card is a full-width banner, not a shunted column`, async ({ page }) => {
      test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/${slug}`, { waitUntil: "networkidle" });

      const card = page.getByText(/How Verita\w+/).first();
      await expect(card, "how-to card renders").toBeVisible();

      const box = await card.boundingBox();
      const vw = page.viewportSize()?.width ?? 1280;
      // Full-width banner spans most of the content column. The bug rendered the
      // card as a narrow (~1/3 width) flex column wedged beside the header.
      expect(box, "card has a layout box").not.toBeNull();
      expect(box!.width, "card width is full-width, not a narrow column").toBeGreaterThan(vw * 0.5);
    });
  }
});
