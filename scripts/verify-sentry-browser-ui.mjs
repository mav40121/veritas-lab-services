// scripts/verify-sentry-browser-ui.mjs
// What a real browser sends Sentry (BUG-133, 2026-11-04). Run against a LOCAL production build made with a made-up
// VITE_SENTRY_DSN; every Sentry request is caught by the test and answered here, so nothing reaches Sentry. Usage:
//   VITE_SENTRY_DSN=https://public@o0.ingest.us.sentry.io/0 npm run build
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-sentry-browser-ui.mjs
// Opens a join link, a reset link and a surveyor link, writes to the console, throws an uncaught error on each, and checks
// the report: the error is there, and no token, console line, typed address or cookie is.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5197";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const browser = await chromium.launch();
const stamp = Date.now();
const CONSOLE_MARK = `console-marker-${stamp}`;
const PAGES = [
  ["a join link", (t) => `/join?token=${t}`],
  ["a reset link", (t) => `/reset-password?token=${t}`],
  ["a surveyor link", (t) => `/surveyor/${t}`],
];
for (const [label, build] of PAGES) {
  const TOKEN = `tokenmarker${stamp}${label.length}`;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addCookies([{ name: "sid", value: "cookie-marker", url: BASE }]);
  const page = await ctx.newPage();
  const sent = [];
  await page.route(/sentry\.io/, async (route) => {
    sent.push(route.request().postData() || "");
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(BASE + build(TOKEN));
  await page.waitForTimeout(1500);
  const boom = `verify-browser-boom-${label.length}`;
  await page.evaluate(([mark, message]) => {
    console.log(`GET /api/labs/1/members 200 in 5ms :: ${mark}`);
    setTimeout(() => { throw new Error(message); }, 0);
  }, [CONSOLE_MARK, boom]);
  for (let i = 0; i < 40 && !sent.some((s) => s.includes(boom)); i++) await page.waitForTimeout(250);
  const report = sent.join("\n");
  check(`${label}: the error report was sent`, report.includes(boom), `${sent.length} requests`);
  check(`${label}: no token in the report`, !report.includes(TOKEN));
  check(`${label}: no console line in the report`, !report.includes(CONSOLE_MARK));
  check(`${label}: no cookie in the report`, !report.includes("cookie-marker"));
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
