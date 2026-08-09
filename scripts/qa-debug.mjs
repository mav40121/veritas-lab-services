import { chromium } from "@playwright/test";
const BASE = process.env.VS_BASE;
const TOKEN = process.env.PW_TOKEN;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], failed = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("requestfailed", r => failed.push(`${r.method()} ${r.url()} :: ${r.failure()?.errorText}`));
page.on("response", r => { if (r.url().includes("/api/labs/") && r.status() >= 400) failed.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? await r.json() : null; }, [BASE, TOKEN]);
const user = me && (me.user || me);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [TOKEN, user]);
// also try seeding common active-lab keys
await page.evaluate(() => { try { localStorage.setItem("veritas_active_lab", "2"); localStorage.setItem("activeLabId", "2"); } catch {} });

await page.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(3500);
console.log("URL after load:", page.url());
console.log("active-lab localStorage:", await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(k=>/lab/i.test(k)).map(k=>[k,localStorage.getItem(k)])))));
const body = await page.evaluate(() => document.body.innerText);
console.log("=== BODY (first 1800 chars) ===");
console.log(body.slice(0, 1800));
console.log("=== console errors ===");
errors.slice(0, 12).forEach(e => console.log("  ERR:", e));
console.log("=== failed/4xx requests ===");
failed.slice(0, 12).forEach(f => console.log("  ", f));
await browser.close();
