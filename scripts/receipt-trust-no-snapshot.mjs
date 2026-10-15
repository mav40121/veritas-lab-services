// Gate 3 receipt for PR #1655: the Trust page section 8 without the database-snapshot promise.
// LOCAL server only. Run: PW_BASE=http://localhost:5195 OUT=docs/receipts node scripts/receipt-trust-no-snapshot.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE, OUT = process.env.OUT;
const browser = await chromium.launch();
let fails = 0;
for (const scheme of ["light", "dark"]) {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme })).newPage();
  await page.goto(`${BASE}/trust`, { waitUntil: "networkidle" });
  const sec = page.locator("section", { hasText: "8. Backups and Disaster Recovery" });
  await sec.scrollIntoViewIfNeeded();
  const text = await sec.innerText();
  const ok = !/snapshot/i.test(text) && text.includes("retained for two years");
  console.log(`${ok ? "PASS" : "FAIL"}  [${scheme}] section 8 has no snapshot promise`);
  if (!ok) fails++;
  await sec.screenshot({ path: `${OUT}/trust-section8-no-snapshot-${scheme}.png` });
}
await browser.close();
process.exit(fails ? 1 : 0);
