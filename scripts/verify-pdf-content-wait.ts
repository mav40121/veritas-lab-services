// scripts/verify-pdf-content-wait.ts
//
// server/pdfContent.ts setPdfContent (2026-10-25, Puppeteer 25 no longer accepts waitUntil "networkidle0" for
// setContent). Every PDF generator loads its HTML through it. Pins:
//   1. a Google Fonts @import (Inter, as the VeritaCheck report uses) is loaded before printing, and the PDF embeds it
//   2. an image is decoded before printing
//   3. a broken image does not hold the PDF (finishes well under the timeout)
//   4. a slow resource cannot hang it past the timeout given
// Run: npx tsx scripts/verify-pdf-content-wait.ts   (needs Puppeteer's Chrome: npx puppeteer browsers install chrome)
import puppeteer from "puppeteer";
import { setPdfContent } from "../server/pdfContent";

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!ok) failures++;
};
const DOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"] });
  try {
    const page = await browser.newPage();
    let t = Date.now();
    await setPdfContent(page, `<html><head><style>@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap');
      body { font-family: 'Inter', sans-serif; font-weight: 700; }</style></head><body>Calibration Verification / Linearity</body></html>`);
    const fontReady = await page.evaluate(() => document.fonts.check("700 16px Inter"));
    const pdf = Buffer.from(await page.pdf({ format: "Letter" }));
    check("1. Google Fonts Inter loaded before printing and embedded in the PDF", fontReady && /Inter/.test(pdf.toString("latin1")), `fonts.check=${fontReady}, ${Date.now() - t} ms`);

    t = Date.now();
    await setPdfContent(page, `<html><body><img id="i" src="${DOT}" width="40" height="40"></body></html>`);
    const img = await page.evaluate(() => { const i = document.getElementById("i") as HTMLImageElement; return { complete: i.complete, w: i.naturalWidth }; });
    check("2. image decoded before printing", img.complete && img.w === 1, JSON.stringify(img));

    t = Date.now();
    await setPdfContent(page, `<html><body><img src="http://127.0.0.1:9/missing.png">Report</body></html>`);
    const brokenMs = Date.now() - t;
    const pdf3 = await page.pdf({ format: "Letter" });
    check("3. a broken image does not hold the PDF", brokenMs < 10000 && pdf3.length > 500, `${brokenMs} ms`);

    t = Date.now();
    await page.setRequestInterception(true);
    page.on("request", (r) => { if (r.url().includes("slow.example")) return; /* never answered */ r.continue(); });
    let hung = false;
    try {
      await setPdfContent(page, `<html><body><img src="https://slow.example/never.png">Report</body></html>`, 3000);
    } catch (e: any) { hung = true; }
    const slowMs = Date.now() - t;
    check("4. a resource that never answers stops at the timeout instead of hanging", slowMs < 12000, `${slowMs} ms${hung ? " (setContent timed out, as designed)" : ""}`);
  } finally {
    await browser.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
