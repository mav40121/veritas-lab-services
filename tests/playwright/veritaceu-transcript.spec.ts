// tests/playwright/veritaceu-transcript.spec.ts
//
// Gate 3 step 8 browser evidence for VeritaCEU phase 3: the per-employee CE
// transcript PDF button on the VeritaStaff Continuing Education card
// (client/src/pages/VeritaStaffAppPage.tsx, VeritaCeuCard). Opens an employee's
// record and asserts the Transcript control renders and its POST endpoint
// returns a download token.
//
// Env: PW_BASE, PW_TOKEN (a user on a lab with VeritaStaff access), PW_CEU_LAB
// (that lab's id), PW_CEU_EMP (an employee id in that lab). Skips without them.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_CEU_LAB || "";
const EMP = process.env.PW_CEU_EMP || "";

test.describe("VeritaCEU CE transcript PDF", () => {
  test("the transcript button renders and the endpoint returns a token", async ({ page }) => {
    if (!TOKEN || !LAB || !EMP) {
      test.skip(true, "Needs PW_TOKEN + PW_CEU_LAB + PW_CEU_EMP.");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app/${EMP}`, { waitUntil: "domcontentloaded" });

    const btn = page.getByRole("button", { name: /transcript/i });
    await expect(btn).toBeVisible({ timeout: 10000 });

    // The button POSTs the transcript endpoint and returns a single-use token.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/veritaceu/employees/") && r.url().endsWith("/transcript")),
      btn.click(),
    ]);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.token).toBeTruthy();
  });
});
