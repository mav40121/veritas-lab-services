// tests/playwright/veritacomp-copy-hygiene.spec.ts
//
// Gate 3 step 8 evidence for the VeritaComp copy-hygiene cleanup (review
// 2026-07-09, sev2): removed two em dashes from user-facing strings (the
// Link-Documents helper text and the "Link Document - Element N" dialog title)
// and deleted the unused CLIA_METHODS constant. Public-facing copy must not use
// em dashes (repo rule).
//
// Non-mutating: opens the Link Document dialog on a program's assessment and
// asserts the title/help text carry no em dash. Needs PW_TOKEN + PW_PROGRAM_URL;
// skips (compile-only) in CI otherwise.
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT), PW_PROGRAM_URL.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PROGRAM_URL = process.env.PW_PROGRAM_URL || "";

test.describe("VeritaComp: no em dashes in the Link-Document copy", () => {
  test("the Link Document dialog copy uses a colon, not an em dash", async ({ page }) => {
    if (!TOKEN || !PROGRAM_URL) {
      test.skip(true, "PW_TOKEN + PW_PROGRAM_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PROGRAM_URL}`, { waitUntil: "networkidle" });

    // Open a Link Document dialog (control label may vary).
    await page.getByRole("button", { name: /link (document|evidence)/i }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10000 });
    const text = (await dialog.innerText()) || "";
    expect(text, "no em dash in the Link Document dialog copy").not.toContain("—");
  });
});
