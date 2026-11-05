// scripts/verify-site-copy-commercial-ui.mjs
// Gate 3 receipt for the commercial pages of the 2026-11-05 site review. Run against a LOCAL production build on a scratch database:
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-site-copy-commercial-ui.mjs
// In a real browser: the settled facts, the demo and scheduling links, and the invoice form read and behave as the product does. Light, dark and phone shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5197", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const text = async (p) => { await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }); return page.locator("body").innerText(); };

const team = await text("/team");
check("Team: 23 years of Army Reserve service", team.includes("23 years of Army Reserve service"));
check("Team: no 22 years, no 'distinguished'", !/22 years|distinguished/i.test(team));
await page.screenshot({ path: `${OUT}/site-copy-team.png` });

const home = await text("/");
check("Home: 'See a sample report'", home.includes("See a sample report"));
check("Home: 23 yrs stat", home.includes("23 yrs"));
check("Home: no 'real hospital lab', 'real signed report' or 'CLIA-compliant PDF'", !/real hospital lab|real signed report|CLIA-compliant PDF/i.test(home));
await page.getByRole("heading", { name: "See a sample report" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-copy-home.png` });

for (const [from, to] of [["/request-demo", "/demo"], ["/book-a-demo", "/demo"], ["/schedule", "/book/scoping-call"]]) {
  await page.goto(`${BASE}${from}`, { waitUntil: "networkidle" });
  check(`${from} lands on ${to}`, new URL(page.url()).pathname === to, page.url());
}

const book = await text("/book");
check("Book: forthcoming, 23 years, newsletter disclosed", /twenty-three years/i.test(book) && book.includes("The Lab Director's Briefing"));
check("Book page title is the book, not a consultation", /Lab Management 101/.test(await page.title()), await page.title());

const pricing = await text("/pricing");
check("Pricing: per-study line matches the free-study rule", pricing.includes("two studies are included"));
check("Pricing: no 'no account required' and no COLA banner", !/no account required|COLA Lab Enrichment/i.test(pricing));
await page.screenshot({ path: `${OUT}/site-copy-pricing.png` });

const services = await text("/services");
check("Services: no career ladder ('after that', 'then became')", !/after that|then became/i.test(services));
await page.screenshot({ path: `${OUT}/site-copy-services.png` });

const roadmap = await text("/roadmap");
check("Roadmap: no 269 instruments", !roadmap.includes("269 instruments"));
await page.screenshot({ path: `${OUT}/site-copy-roadmap.png` });

await page.goto(`${BASE}/request-invoice?tier=veritacheck`, { waitUntil: "networkidle" });
const invoice = await page.locator("body").innerText();
check("Invoice form: VeritaCheck shows the first-year and renewal price", /\$299/.test(invoice) && /\$499/.test(invoice));
const send = (tier) => page.evaluate(async ([base, t]) => {
  const r = await fetch(`${base}/api/invoice/request`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lab_name: "Made Up Lab", billing_contact_name: "Made Up Person", billing_contact_email: "made-up@example.com", billing_address: "1 Made Up St", tier: t, seats: 1, authorization: true }) });
  return r.status;
}, [BASE, tier]);
const good = await send("veritacheck"), bad = await send("bogus");
check("Invoice route takes the VeritaCheck plan the form offers", good >= 200 && good < 300, String(good));
check("Invoice route refuses an unknown plan", bad === 400, String(bad));
await page.screenshot({ path: `${OUT}/site-copy-invoice.png` });

check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/team`, { waitUntil: "networkidle" });
await dark.screenshot({ path: `${OUT}/site-copy-team-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/team", "/pricing", "/services", "/roadmap", "/book"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/roadmap`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-copy-roadmap-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
