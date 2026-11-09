// scripts/verify-newsletter-honeypot-ui.mjs
// Gate 3 browser receipt for the newsletter bot guard (Michael 2026-11-09, Q247 = 1). Local build only:
//   PW_BASE=http://localhost:5199 OUT=<dir> node scripts/verify-newsletter-honeypot-ui.mjs
// (vls-ops/ui_run_repo_5199.sh builds, serves a scratch DB on 5199 with ADMIN_SECRET=test-admin-secret, and runs this.)
// For each of the five signup forms that post to /api/newsletter/subscribe:
//   a. a person: the hidden "website" field is there, not visible, not tabbable, aria-hidden, and empty; a normal
//      fill-and-submit sends it empty and shows the form's own success state (reserved example.com address, which the
//      endpoint never stores or mails)
//   b. a bot: the field filled through the DOM with a real-looking address gets the same success state and the same
//      JSON as a real signup, and the scratch DB holds no row for it (read through the local admin list)
// Then: no sideways scroll on the phone-width homepage, a dark-mode shot, and the Playwright spec
// tests/playwright/newsletter-honeypot.spec.ts against the same server. Nothing here leaves the machine: a reserved
// address and a honeypot hit both return before the welcome email.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const BASE = process.env.PW_BASE || "";
const OUT = process.env.OUT || ".";
const ADMIN = process.env.PW_ADMIN_SECRET || "test-admin-secret";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Refusing to run: PW_BASE must be a local build (localhost or 127.0.0.1).");
  process.exit(2);
}
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const shots = [];
const shot = async (target, file) => { const p = path.join(OUT, file); await target.screenshot({ path: p }); shots.push(p); };

const byButton = (page, name) =>
  page.locator("form").filter({ has: page.locator('input[name="website"]') }).filter({ has: page.getByRole("button", { name }) }).first();
const FORMS = [
  { key: "1-homepage-banner", path: "/", form: (p) => byButton(p, /^subscribe free$/i), success: (p) => p.getByText("You're subscribed.") },
  { key: "2-resources-card", path: "/resources", form: (p) => byButton(p, /^subscribe free$/i), success: (p) => p.getByText("You're subscribed.") },
  { key: "3-article-inline", path: "/resources/clia-tea-what-lab-directors-dont-know", form: (p) => byButton(p, /^subscribe$/i), success: (p) => p.getByText("You're subscribed.") },
  { key: "4-tea-content-upgrade", path: "/resources/clia-tea-lookup", form: (p) => p.getByTestId("content-upgrade-upgrade-tea-table").locator("form"), success: (p) => p.getByTestId("content-upgrade-done") },
  { key: "5-book-waitlist", path: "/book", form: (p) => byButton(p, /^notify me$/i), success: (p) => p.getByText("You're on the list!").first() },
];
const SUBSCRIBED = JSON.stringify({ success: true, message: "subscribed" });
const stamp = Date.now();
const browser = await chromium.launch();
const botAddresses = [];

async function submitAndCapture(page, form) {
  const reqP = page.waitForRequest((r) => r.url().endsWith("/api/newsletter/subscribe") && r.method() === "POST");
  const resP = page.waitForResponse((r) => r.url().endsWith("/api/newsletter/subscribe"));
  await form.locator('button[type="submit"]').click();
  const body = JSON.parse((await reqP).postData() || "{}");
  const res = await resP;
  return { body, status: res.status(), json: JSON.stringify(await res.json().catch(() => ({}))) };
}

for (const f of FORMS) {
  // a. a person
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}${f.path}`, { waitUntil: "networkidle" });
    const form = f.form(page);
    await form.waitFor({ state: "visible", timeout: 20000 });
    await form.scrollIntoViewIfNeeded();
    const hp = form.locator('input[name="website"]');
    const count = await hp.count();
    const facts = count === 1 ? await hp.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, left: r.left, tab: el.getAttribute("tabindex"), ac: el.getAttribute("autocomplete"), ariaHidden: !!el.closest('[aria-hidden="true"]'), value: el.value };
    }) : null;
    check(`${f.key} a. one hidden "website" field in the form`, count === 1, `${count}`);
    check(`${f.key} a. not visible to a person (Playwright isVisible false, zero size, off-screen)`, count === 1 && !(await hp.isVisible()) && facts.w * facts.h === 0 && facts.left < -1000, JSON.stringify(facts));
    check(`${f.key} a. tabindex -1, autocomplete off, inside aria-hidden, empty`, !!facts && facts.tab === "-1" && facts.ac === "off" && facts.ariaHidden && facts.value === "");
    await form.locator('button[type="submit"]').focus();
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("name") || document.activeElement?.tagName || "");
    check(`${f.key} a. Tab from the submit button doesn't land on it`, focused !== "website", focused);
    await shot(form.locator("xpath=.."), `${f.key}-a1-form.png`);
    const email = `pw-honeypot-ui-${stamp}-${f.key}@example.com`;
    await form.locator('input[type="email"]').fill(email);
    const sub = await submitAndCapture(page, form);
    check(`${f.key} a. a person's submit sends website empty`, sub.body.email === email && sub.body.website === "", JSON.stringify(sub.body));
    await f.success(page).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    check(`${f.key} a. the form's own success state shows`, sub.status === 200 && (await f.success(page).isVisible()), `${sub.status} ${sub.json}`);
    await shot(page, `${f.key}-a2-person-success.png`);
    check(`${f.key} a. no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await ctx.close();
  }
  // b. a bot
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${f.path}`, { waitUntil: "networkidle" });
    const form = f.form(page);
    await form.waitFor({ state: "visible", timeout: 20000 });
    await form.scrollIntoViewIfNeeded();
    const email = `bot-ui-${stamp}-${f.key}@veritas-it-mail.com`;
    botAddresses.push(email);
    await form.locator('input[type="email"]').fill(email);
    await form.locator('input[name="website"]').evaluate((el) => { el.value = "http://spam.example"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    const sub = await submitAndCapture(page, form);
    check(`${f.key} b. a bot's submit carries the filled field`, sub.body.website === "http://spam.example", JSON.stringify(sub.body));
    check(`${f.key} b. the server answers exactly as for a real signup`, sub.status === 200 && sub.json === SUBSCRIBED, `${sub.status} ${sub.json}`);
    await f.success(page).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    check(`${f.key} b. the bot sees the same success state`, await f.success(page).isVisible());
    await shot(page, `${f.key}-b-bot-success.png`);
    await ctx.close();
  }
}

// Nothing stored for any bot submit (the person submits used example.com, which is never stored either)
{
  const r = await fetch(`${BASE}/api/admin/newsletter?secret=${encodeURIComponent(ADMIN)}`);
  const data = await r.json().catch(() => ({}));
  const emails = (data.subscribers || []).map((s) => s.email);
  check("6. the scratch DB holds no row for any of the 5 bot submits", r.ok && botAddresses.every((e) => !emails.includes(e)), `${r.status}, ${emails.length} rows total`);
  check("6. and none for the 5 example.com person submits", r.ok && !emails.some((e) => e.includes(`pw-honeypot-ui-${stamp}`)));
}

// Phone width: the off-screen field adds no sideways scroll
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const form = byButton(page, /^subscribe free$/i);
  await form.scrollIntoViewIfNeeded();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  check("7. homepage at 375px: no sideways scroll", sw <= 376, `scrollWidth ${sw}`);
  await shot(page, "7-homepage-375px.png");
  await ctx.close();
}
// Dark mode: the form looks as it did
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/resources`, { waitUntil: "networkidle" });
  const form = byButton(page, /^subscribe free$/i);
  await form.scrollIntoViewIfNeeded();
  await shot(form.locator("xpath=.."), "8-resources-card-dark.png");
  await ctx.close();
}
await browser.close();

// The Playwright spec against the same local server
const spec = spawnSync("npx", ["playwright", "test", "tests/playwright/newsletter-honeypot.spec.ts", "--reporter=list", "--workers=1"], { env: { ...process.env, PW_BASE: BASE }, encoding: "utf8", shell: true });
const specOut = `${spec.stdout || ""}${spec.stderr || ""}`;
console.log(specOut.split("\n").filter((l) => /passed|failed|skipped|✓|✘|Error/.test(l)).join("\n"));
check("9. tests/playwright/newsletter-honeypot.spec.ts passes locally (5 tests)", spec.status === 0 && /5 passed/.test(specOut), `exit ${spec.status}`);

console.log("screenshots:\n" + shots.join("\n"));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
