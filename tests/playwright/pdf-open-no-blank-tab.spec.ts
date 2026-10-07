// Receipt for parking lot #63 (2026-10-07): a PDF button must trigger a browser
// DOWNLOAD through the token endpoint, never a popup/new tab that Adobe Acrobat
// can strand on about:blank. Public page, no token needed, so this runs in CI
// and against production.
//
// Exercises the public Why-VeritaCheck article (one of the eleven converted
// sites) and the /api/pdf/:token endpoint's disposition directly.
import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("PDF open: download, not a blank tab", () => {
  test("Why-VeritaCheck 'Download PDF' downloads in place and opens no new page", async ({ page, context }) => {
    test.setTimeout(120000);
    await page.goto(`${BASE}/resources/why-veritacheck-vs-legacy-verification`, { waitUntil: "networkidle" });
    const pagesBefore = context.pages().length;
    const button = page.getByRole("button", { name: /download.*pdf|pdf/i }).first();
    await expect(button, "download button renders").toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 90000 }),
      button.click(),
    ]);
    expect(download.suggestedFilename(), "download carries a PDF filename").toMatch(/\.pdf$/i);
    await page.waitForTimeout(500);
    expect(context.pages().length, "no popup / about:blank tab opened").toBe(pagesBefore);
    expect(page.url(), "the article stays in place").toContain("/resources/why-veritacheck-vs-legacy-verification");
  });

  test("/api/pdf/:token serves attachment disposition", async ({ request }) => {
    const r = await request.get(`${BASE}/api/why-veritacheck-pdf`);
    expect(r.ok(), "token endpoint answers").toBeTruthy();
    const { token } = await r.json();
    expect(token, "token issued").toBeTruthy();
    const pdf = await request.get(`${BASE}/api/pdf/${token}`);
    expect(pdf.status(), "token redeems").toBe(200);
    expect(pdf.headers()["content-type"], "PDF content type").toContain("application/pdf");
    expect(pdf.headers()["content-disposition"] || "", "attachment, not inline").toMatch(/^attachment;/);
  });
});
