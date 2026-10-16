// scripts/verify-weekly-copy-ui.mjs
//
// Browser receipt: weekly copy of all records (2026-10-16). LOCAL production build with the Content-Security-Policy
// enforced + scratch DB only. On Lab Members, as the lab owner:
//   1. the "Build a copy every week" switch starts off
//   2. turning it on shows "Weekly copy turned on" and the switch text says it is on
//   3. it stays on after a reload (saved on the server)
//   4. turning it off works; no CSP violations; light, dark and 390px screenshots
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-weekly-copy-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const email = `weekly-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "week", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (Weekly QA)", plan: "hospital" })).body?.labId;
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
check("0. QA owner and lab", !!lab);

const browser = await chromium.launch();
const open = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [reg.body.token, reg.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/members`, { waitUntil: "networkidle" });
  const card = page.getByTestId("export-all-card");
  await card.waitFor({ timeout: 15000 });
  await card.scrollIntoViewIfNeeded();
  return { ctx, page, card, csp, toggle: page.getByTestId("export-all-weekly-toggle"), text: page.getByTestId("export-all-weekly-text") };
};

{
  const { ctx, page, card, csp, toggle, text } = await open("light", 1280);
  check("1. the weekly switch starts off", (await toggle.getAttribute("aria-checked")) === "false" && /^Off\./.test(await text.innerText()), await text.innerText());
  await toggle.click();
  await page.getByText("Weekly copy turned on").first().waitFor({ timeout: 10000 }).catch(() => {});
  // Selector waits, not waitForFunction: the enforced CSP blocks the eval that waitForFunction relies on.
  await page.locator('[data-testid="export-all-weekly-toggle"][aria-checked="true"]').waitFor({ timeout: 10000 }).catch(() => {});
  check("2. turning it on confirms and the text says it is on", await page.getByText("Weekly copy turned on").first().isVisible() && /^On\. Every Monday/.test(await text.innerText()), await text.innerText());
  await page.waitForTimeout(800);
  await card.screenshot({ path: `${OUT}/weekly-copy-on-light.png` });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("export-all-weekly-toggle").waitFor({ timeout: 15000 });
  check("3. it stays on after a reload", (await page.getByTestId("export-all-weekly-toggle").getAttribute("aria-checked")) === "true");
  const puts = [];
  page.on("response", async (r) => { if (r.url().includes("/export-all/weekly")) puts.push(`${r.request().method()} ${r.status()} ${await r.text().catch(() => "")}`); });
  await page.getByTestId("export-all-weekly-toggle").click();
  await page.locator('[data-testid="export-all-weekly-toggle"][aria-checked="false"]').waitFor({ timeout: 10000 }).catch(() => {});
  check("4a. turning it off works", (await page.getByTestId("export-all-weekly-toggle").getAttribute("aria-checked")) === "false", `${puts.join(" | ")} disabled=${await page.getByTestId("export-all-weekly-toggle").isDisabled()}`);
  check("4b. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
  await ctx.close();
}
for (const [scheme, width, tag] of [["dark", 1280, "dark"], ["light", 390, "390"]]) {
  const { ctx, page, card, toggle } = await open(scheme, width);
  if ((await toggle.getAttribute("aria-checked")) !== "true") { await toggle.click(); await page.waitForTimeout(1200); }
  const box = await toggle.boundingBox();
  check(`4${tag === "dark" ? "c" : "d"}. ${tag}: the switch shows${tag === "390" ? " inside the screen" : ""}`, (await toggle.getAttribute("aria-checked")) === "true" && (!box || tag !== "390" || (box.x >= 0 && box.x + box.width <= 391)), box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "");
  await page.waitForTimeout(800);
  await card.screenshot({ path: `${OUT}/weekly-copy-on-${tag}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
