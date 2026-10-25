// Load a report's HTML into a Puppeteer page and wait until it is ready to print (2026-10-25, Puppeteer 25).
// Since 24.43 Puppeteer loads setContent HTML with Chrome's Page.setDocumentContent and no longer accepts
// waitUntil "networkidle0" for it. This waits for the load event (stylesheets, including @import'ed ones), then for
// every web font (some reports use Inter from Google Fonts) and every image to finish, which is what "network idle"
// covered. A font or image that fails, or anything slower than the timeout, does not block the PDF.
import type { Page } from "puppeteer";

export async function setPdfContent(page: Page, html: string, timeoutMs = 30000): Promise<void> {
  await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
  await page.evaluate(async (ms: number) => {
    const images = Array.from(document.images)
      .filter((img) => !img.complete)
      .map((img) => new Promise<void>((done) => {
        img.addEventListener("load", () => done(), { once: true });
        img.addEventListener("error", () => done(), { once: true });
      }));
    await Promise.race([
      Promise.all([document.fonts.ready, ...images]),
      new Promise((done) => setTimeout(done, ms)),
    ]);
  }, timeoutMs);
}
