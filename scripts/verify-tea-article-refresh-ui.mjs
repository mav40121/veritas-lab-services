// scripts/verify-tea-article-refresh-ui.mjs
// Gate 3 receipt for the TEa article refresh (SEO handoff 2026-11-09). Run against a LOCAL production build:
//   PW_BASE=http://localhost:5199 OUT=<dir> node scripts/verify-tea-article-refresh-ui.mjs
// Logged out, in a real browser: the "2026 limits at a glance" callout sits above the PDF box, the header gives the
// published and updated months, the description is the new one both in the served HTML (what crawlers read) and after
// the page runs, and the title is unchanged.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5199", OUT = process.env.OUT || ".";
const PATH = "/resources/clia-tea-what-lab-directors-dont-know";
const TITLE = "CLIA Total Allowable Error (TEa): 2026 Limits by Specialty";
const DESC = "The 2026 CLIA total allowable error (TEa) limits for every regulated analyte, by specialty, with 42 CFR §493 citations. Free printable PDF table.";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// 1. Served HTML, before any script runs (what a crawler reads)
const raw = await (await fetch(`${BASE}${PATH}`)).text();
const metaDesc = (raw.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1] || "";
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&sect;/g, "§");
check("1a. served meta description is the new one", unesc(metaDesc) === DESC, unesc(metaDesc).slice(0, 160));
check("1b. served title unchanged", raw.includes(`<title>${TITLE}`) || raw.includes(`<title>${TITLE.replace("&", "&amp;")}`), (raw.match(/<title>([^<]*)/) || [])[1]);
const ld = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).flat().filter(Boolean);
const article = ld.find((x) => x["@type"] === "Article");
check("1c. Article JSON-LD dateModified is 2026-11-09, datePublished 2026-03-01", article?.dateModified === "2026-11-09" && article?.datePublished === "2026-03-01", JSON.stringify({ p: article?.datePublished, m: article?.dateModified }));
check("1d. Article JSON-LD description is the new one", article?.description === DESC);

// 2. In the browser
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
const body = await page.locator("body").innerText();
check("2a. header line reads Published March 2026 · Updated November 2026", body.includes("Published March 2026 · Updated November 2026"));
const callout = page.getByText("Looking for the 2026 limits?").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
check("2b. the callout renders once", (await callout.count()) === 1);
const ctext = (await callout.innerText()).replace(/\s+/g, " ");
check("2c. callout names CMS-3355-F and July 11, 2024", ctext.includes("CMS-3355-F") && ctext.includes("July 11, 2024"), ctext.slice(0, 200));
check("2d. callout has no em or en dash", !/[–—]/.test(ctext));
const href = await callout.locator("a").first().getAttribute("href");
check("2e. callout links the TEa Lookup", href === "/resources/clia-tea-lookup", String(href));
const upgrade = page.getByTestId("content-upgrade-upgrade-tea-table");
const [cBox, uBox] = [await callout.boundingBox(), await upgrade.boundingBox()];
check("2f. callout sits above the PDF box", !!cBox && !!uBox && cBox.y + cBox.height <= uBox.y + 1, JSON.stringify({ callout: cBox?.y, pdf: uBox?.y }));
check("2g. page meta description after the page runs is the new one", (await page.locator('meta[name="description"]').getAttribute("content")) === DESC);
check("2h. document title unchanged", (await page.title()).startsWith(TITLE), await page.title());
const PT = /typical and recommended|more conservative|easier[- ]to[- ]defend/;
check("2i. no PT limit recommendation wording on the page", !PT.test(body));
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${OUT}/tea-refresh-top.png`, clip: { x: 0, y: 0, width: 1280, height: Math.min(1400, (uBox?.y || 900) + 220) }, fullPage: true });
check("2j. no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

// 3. Dark and phone
// ThemeProvider follows prefers-color-scheme, so dark is the browser's color scheme, not a stored setting.
const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
check("3b. dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
const darkCallout = dark.getByText("Looking for the 2026 limits?").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
const contrast = await darkCallout.evaluate((el) => { const c = getComputedStyle(el).color, b = getComputedStyle(document.body).backgroundColor; return { c, b }; });
check("3c. dark: callout text is light on the dark page", /rgb\((2[0-5]\d|1[6-9]\d)/.test(contrast.c), JSON.stringify(contrast));
await dark.screenshot({ path: `${OUT}/tea-refresh-dark.png`, clip: { x: 0, y: 0, width: 1280, height: 1300 }, fullPage: true });
const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}${PATH}`, { waitUntil: "networkidle" });
check("3a. phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await phone.getByText("Looking for the 2026 limits?").scrollIntoViewIfNeeded();
await phone.screenshot({ path: `${OUT}/tea-refresh-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
