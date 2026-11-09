// scripts/verify-ga-production-only-ui.mts
// Receipt for GA4 on production hosts only, and never under automation (2026-11-09). Run against a LOCAL production
// build:  PW_BASE=http://localhost:5199 OUT=<dir> npx tsx scripts/verify-ga-production-only-ui.mts
// Every request bound for googletagmanager.com or google-analytics.com is aborted and counted, so this run sends
// nothing to Google. Case d maps www.veritaslabservices.com to the local server to prove real visitors still get GA.
import { createRequire } from "node:module";
import { analyticsHostAllowed, PRODUCTION_HOSTS } from "../client/src/lib/analytics";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5199";
const PORT = new URL(BASE).port || "80";
const PAGE = "/resources/clia-tea-lookup";
let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// 1. The rule itself
check("1a. www.veritaslabservices.com, real browser: allowed", analyticsHostAllowed("www.veritaslabservices.com", false));
check("1b. veritastock.com and www.veritastock.com, real browser: allowed", analyticsHostAllowed("veritastock.com", false) && analyticsHostAllowed("www.veritastock.com", undefined));
check("1c. any production host under automation: not allowed", PRODUCTION_HOSTS.every((h) => !analyticsHostAllowed(h, true)));
for (const h of ["localhost", "127.0.0.1", "veritaslabservices.com", "radiant-quietude-production.up.railway.app", "pr-1854.veritaslabservices.com", "staging.veritaslabservices.com", "www.veritaslabservices.com.evil.test"]) {
  check(`1d. ${h}: not allowed`, !analyticsHostAllowed(h, false));
}
check("1e. host match ignores case", analyticsHostAllowed("WWW.VeritasLabServices.com", false));

// 2. Real browser
async function run(label: string, { mapProd, webdriver, path = PAGE }: { mapProd: boolean; webdriver: boolean; path?: string }) {
  const browser = await chromium.launch(mapProd ? { args: [`--host-resolver-rules=MAP www.veritaslabservices.com 127.0.0.1`] } : {});
  const ctx = await browser.newContext();
  // Plain text, not a function: tsx would add an __name helper to a function that the page doesn't have.
  if (!webdriver) await ctx.addInitScript({ content: 'Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });' });
  let gaRequests = 0;
  await ctx.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route: any) => { gaRequests++; return route.abort(); });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: any) => errors.push(String(e)));
  const url = mapProd ? `http://www.veritaslabservices.com:${PORT}${path}` : `${BASE}${path}`;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({ host: location.hostname, webdriver: navigator.webdriver, tag: !!document.getElementById("ga4-gtag"), dataLayer: Array.isArray((window as any).dataLayer) }));
  await browser.close();
  console.log(`  [${label}] host=${state.host} webdriver=${state.webdriver} gtag=${state.tag} gaRequests=${gaRequests} errors=${errors.length}`);
  return { ...state, gaRequests, errors };
}

const a = await run("a", { mapProd: false, webdriver: true });
check("2a. localhost under automation: no GA tag, no GA request", !a.tag && a.gaRequests === 0);
const b = await run("b", { mapProd: false, webdriver: false });
check("2b. localhost in a real-looking browser: no GA tag, no GA request (host rule)", b.webdriver === false && !b.tag && b.gaRequests === 0);
const c = await run("c", { mapProd: true, webdriver: true });
check("2c. www.veritaslabservices.com under automation: no GA tag, no GA request (webdriver rule)", c.host === "www.veritaslabservices.com" && !c.tag && c.gaRequests === 0, c.host);
const d = await run("d", { mapProd: true, webdriver: false });
check("2d. www.veritaslabservices.com in a real browser: GA tag loads (request blocked by this test)", d.host === "www.veritaslabservices.com" && d.webdriver === false && d.tag && d.gaRequests > 0, `${d.gaRequests} blocked`);
const e = await run("e", { mapProd: true, webdriver: false, path: "/login" });
check("2e. production host, real browser, sign-in page: still no GA (app pages unchanged)", !e.tag && e.gaRequests === 0);
check("2f. no page errors in any case", [a, b, c, d, e].every((x) => x.errors.length === 0), [a, b, c, d, e].flatMap((x) => x.errors).slice(0, 2).join(" | "));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
