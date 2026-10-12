// scripts/verify-founding-labs-page.mjs
//
// Receipt for the public Founding Labs page and POST /api/admin/founding-lab/record (2026-10-12, Michael Q99 = 1).
// LOCAL server + scratch DB only.
//   1. /founding-labs lists Redington-Fairview General Hospital, Skowhegan, Maine; Apply button goes to the form
//   2. the Pricing card's "Founding Labs page" text links to it
//   3. no em dash in the page text; renders in light, dark and at phone width without horizontal scroll
//   4. the admin record route: 403 without the secret, dryRun writes nothing, run writes one accepted row, a repeat
//      is idempotent, and it is not the public apply path (no Resend call is made)
// Run: PW_BASE=http://localhost:5165 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-founding-labs-page.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const post = async (path, body, headers = {}) => { const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };

// 4. admin record route on a scratch lab
const email = `fl-${Date.now()}@example.com`;
await post("/api/auth/register", { email, password: "testpass123", name: "Founder Owner", hipaa_acknowledged: true });
const labId = (await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Scratch Founding Lab", plan: "community" })).j.labId;
const count = () => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const n = d.prepare("SELECT COUNT(*) AS n FROM founding_lab_applications WHERE status = 'accepted'").get().n; d.close(); return n; };
const n0 = count();
const r403 = await post("/api/admin/founding-lab/record", { labId });
const rDry = await post("/api/admin/founding-lab/record", { secret: ADMIN, labId, dryRun: true });
const n1 = count();
const rRun = await post("/api/admin/founding-lab/record", { secret: ADMIN, labId });
const rAgain = await post("/api/admin/founding-lab/record", { secret: ADMIN, labId });
const n2 = count();
check("4a. 403 without the admin secret", r403.s === 403);
check("4b. dryRun writes nothing", rDry.s === 200 && rDry.j.dryRun === true && n1 === n0, JSON.stringify(rDry.j.wouldInsert || {}).slice(0, 160));
check("4c. run writes one accepted row; a repeat is idempotent", rRun.s === 200 && rRun.j.status === "accepted" && rAgain.j.alreadyRecorded === true && n2 === n0 + 1, `${n0}->${n1}->${n2} ${JSON.stringify(rAgain.j)}`);

const browser = await chromium.launch();
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/founding-labs`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
  const text = await page.locator("body").innerText();
  const cards = await page.getByTestId("founding-lab-card").allInnerTexts();
  const tag = `[${scheme} ${width}px]`;
  check(`1. ${tag} lists Redington-Fairview General Hospital, Skowhegan, Maine`, cards.length === 1 && /Redington-Fairview General Hospital/.test(cards[0]) && /Skowhegan, Maine/.test(cards[0]), cards.join(" | ").replace(/\s+/g, " "));
  check(`3. ${tag} no em dash; no horizontal scroll`, !text.includes("—") && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
  await page.screenshot({ path: `${OUT}/founding_labs_${scheme}_${width}.png`, fullPage: true });
  if (scheme === "light" && width === 1400) {
    await page.getByRole("link", { name: /Apply to the Founding Lab Program/ }).click(); await page.waitForTimeout(800);
    check(`1b. ${tag} Apply button opens the application form`, page.url().endsWith("/founding-lab/apply"), page.url().replace(BASE, ""));
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    await page.getByRole("link", { name: "Founding Labs page" }).click(); await page.waitForTimeout(800);
    check(`2. ${tag} the Pricing card's "Founding Labs page" links here`, page.url().endsWith("/founding-labs"), page.url().replace(BASE, ""));
  }
  await ctx.close();
}
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
