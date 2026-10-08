// scripts/verify-87-veritacheck-page.mjs
// Receipt for parking lot #87 (2026-10-08): removing the never-called purchase
// path (handleBuy, goToStripeCheckout, the CLIA lookup modal) must not change
// the VeritaCheck page. Loads it signed out and as a free account on a LOCAL
// server and checks it renders, the pricing section and discount box are still
// there, and the console has no errors. Usage:
//   PW_BASE=http://localhost:5131 OUT=<dir> node scripts/verify-87-veritacheck-page.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5131", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const email = `p87-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Free User", hipaa_acknowledged: true });

const browser = await chromium.launch();
for (const who of ["signed-out", "free"]) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|google|gtag|analytics|Failed to load resource/i.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/`);
  if (who === "free") await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  await page.goto(`${BASE}/veritacheck`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();
  check(`${who}: VeritaCheck page renders`, /VeritaCheck/.test(body), body.slice(0, 80).replace(/\s+/g, " "));
  if (who === "free") {
    check(`${who}: pricing section and discount box still present`, /Ready to Run Unlimited Studies\?/.test(body) && /Have a discount code\?/.test(body));
    await page.locator("#pricing").scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/p87_free_pricing.png` });
  }
  check(`${who}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
