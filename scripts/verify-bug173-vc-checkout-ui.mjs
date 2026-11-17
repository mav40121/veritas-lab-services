// scripts/verify-bug173-vc-checkout-ui.mjs
// Browser receipt for BUG-173 (2026-11-17, design approved by Michael "1"): a comped VeritaCheck® Unlimited lab (plan set by
// hand, no card subscription; lab 40's shape, owner whose own users.plan is free) had no screen that reached VeritaCheck
// Unlimited checkout, and a discount code applied on the VeritaCheck page was lost (parking lot #89). Every POST
// /api/stripe/checkout is intercepted in the browser (page.route) and answered here, so nothing reaches the server's checkout
// or Stripe. Local production build and scratch DB only (it signs up made-up people and writes to SCRATCH_DB):
//   UI_REPO=<worktree> UI_PORT=5207 UI_SCRIPT=verify-bug173-vc-checkout-ui.mjs UI_OUT=bug173 UI_DB=bug173.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
// Checks:
//   C1-C6. The comped lab's owner sees the pricing section on /veritacheck with "Subscribe to VeritaCheck® Unlimited" and the
//          price line; an applied code is kept for the tab; Subscribe sends priceType veritacheck_only, the lab id and the
//          code, goes to the URL checkout returns, and forgets the code.
//   C3b, B1-B3, A2b. The code banner gives the first year the buyer will really pay (follow-up, 2026-11-17): a 10% code
//          keeps the $200 first-year discount ($299), a 50% code reads $249.50 and the line under the button follows it,
//          and no free trial is named.
//   C7.    A 409 ALREADY_SUBSCRIBED from checkout shows as a toast and nothing redirects.
//   D1.    Dark mode: the section renders on the dark theme (screenshot).
//   K1-K2. The lab paying by card: no pricing section on /veritacheck, no Subscribe on Account Settings.
//   S1-S2. A seat user (lab role staff) in the comped lab sees the section with View Pricing and no Subscribe button.
//   A1-A5. Account Settings for the comped owner: the code from the VeritaCheck page fills the box, Subscribe shows with no
//          code applied, and it sends priceType veritacheck_only (not community) with the lab id; with no code kept, it
//          sends no code.
//   O1-O3. Signed out: the section shows "Sign in or create an account to subscribe" to /login, and an applied code is kept.
//   Light-mode screenshots (and one dark) go to RECEIPT_DIR (default docs/receipts) as bug173-*.png.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || "docs/receipts";
if (!BASE || !["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, body: j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const pw = ["Vc", "Checkout", "77!"].join("-");
const CODE = "BUGMADEUP10";   // 10% off once: smaller than the $200 first-year discount
const CODE50 = "BUGMADEUP50"; // 50% off once: $249.50, under $299
const LINE10 = "This code is smaller than the $200 first-year discount, so your first year stays $299, then $499 a year.";
const LINE50 = "First year with this code: $249.50, then $499 a year.";
const SUBSCRIBE = "Subscribe to VeritaCheck® Unlimited";
const PRICE_LINE = "$299 the first year, $499 a year after.";
const PENDING_KEY = "veritas_pending_discount_code";
const INTERCEPTED = "/__bug173_checkout_intercepted";

// ── Made-up people and labs ──────────────────────────────────────────────────
const tag = Date.now();
const emails = { comp: `bug173-comp-${tag}@example.test`, card: `bug173-card-${tag}@example.test`, seat: `bug173-seat-${tag}@example.test` };
const people = {};
for (const [k, email] of Object.entries(emails)) {
  const reg = (await call("POST", "/api/auth/register", { email, password: pw, name: `Made-up ${k} person`, hipaa_acknowledged: true })).body;
  people[k] = { email, token: reg.token, id: reg.user?.id };
}
const labComp = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: emails.comp, labName: "Made-up Comped Unlimited Lab", plan: "clinic" })).body.labId;
const labCard = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: emails.card, labName: "Made-up Card Unlimited Lab", plan: "clinic" })).body.labId;
const soon = new Date(Date.now() + 5 * 86400000).toISOString(), later = new Date(Date.now() + 200 * 86400000).toISOString(), now = new Date().toISOString();
scratch((d) => {
  for (const e of Object.values(emails)) d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'free' WHERE email = ?").run(e);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999173', plan = 'veritacheck_only', subscription_status = 'active', subscription_expires_at = ?, plan_expires_at = ?, stripe_subscription_id = NULL WHERE id = ?").run(soon, soon, labComp);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999174', plan = 'veritacheck_only', subscription_status = 'active', subscription_expires_at = ?, plan_expires_at = ?, stripe_subscription_id = 'sub_madeup_bug173' WHERE id = ?").run(later, later, labCard);
  d.prepare("UPDATE lab_members SET is_primary_lab = 1 WHERE lab_id IN (?, ?)").run(labComp, labCard);
  d.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(labComp, labComp, people.comp.id);
  d.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(labCard, labCard, people.card.id);
  // The seat user: a writer seat from the comped lab's owner, lab role staff, working in that lab.
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labComp, people.seat.id, now, now, now);
  d.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')").run(people.comp.id, emails.seat, people.seat.id, now, now, JSON.stringify({ mode: "edit_all" }), `bug173-${tag}`, labComp);
  d.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(labComp, labComp, people.seat.id);
  // A made-up partner code, in the table so validation never asks Stripe.
  d.prepare("INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at) VALUES (?, 'Made-up Partner', 10, 'all', NULL, 0, 1, ?)").run(CODE, now);
  d.prepare("INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at) VALUES (?, 'Made-up Partner', 50, 'all', NULL, 0, 1, ?)").run(CODE50, now);
});
const meComp = (await call("GET", "/api/labs/me", undefined, people.comp.token)).body;
const meCard = (await call("GET", "/api/labs/me", undefined, people.card.token)).body;
check("setup: the comped lab reads plan veritacheck_only with hasCardSubscription false, role owner, home lab",
  meComp.find?.((m) => m.labId === labComp)?.hasCardSubscription === false && meComp.find((m) => m.labId === labComp)?.role === "owner" && meComp.find((m) => m.labId === labComp)?.isAccountHomeLab === true,
  JSON.stringify(meComp).slice(0, 300));
check("setup: the card lab reads hasCardSubscription true", meCard.find?.((m) => m.labId === labCard)?.hasCardSubscription === true, JSON.stringify(meCard).slice(0, 300));

// ── Browser helpers ─────────────────────────────────────────────────────────
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const pageErrors = [], stripeHits = [];
const open = async (who, person, { colorScheme = "light", checkoutReply = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme });
  const page = await ctx.newPage();
  const sent = [];
  page.on("pageerror", (e) => pageErrors.push(`${who}: ${e}`));
  // Nothing leaves for Stripe, and checkout never reaches the server: each request is recorded and answered here.
  await ctx.route(/stripe\.com/, (r) => { stripeHits.push(r.request().url()); return r.abort(); });
  await ctx.route("**/api/stripe/checkout", async (r) => {
    let body = null; try { body = JSON.parse(r.request().postData() || "null"); } catch { body = r.request().postData(); }
    sent.push(body);
    if (checkoutReply) return r.fulfill({ status: checkoutReply.status, contentType: "application/json", body: JSON.stringify(checkoutReply.body) });
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${BASE}${INTERCEPTED}` }) });
  });
  await ctx.route(`**${INTERCEPTED}`, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>intercepted</title><h1>Checkout intercepted by the receipt</h1>" }));
  await page.goto(`${BASE}/`);
  if (person) {
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, person.token]);
    const u = me.user || me;
    await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [person.token, u]);
  }
  return { page, ctx, sent };
};
const pending = (page) => page.evaluate((k) => { try { return sessionStorage.getItem(k); } catch { return "storage-error"; } }, PENDING_KEY);
// The section's own id (it had it before this change), so the receipt judges the page before the fix the same way.
const section = (page) => page.locator("section#pricing");
const openVc = async (page, labId) => {
  await page.goto(labId ? `${BASE}/labs/${labId}/veritacheck` : `${BASE}/veritacheck`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
};
// Returns whether the code was applied; a page with no box (no section) returns false instead of stopping the run.
const applyCode = async (page, code) => {
  try {
    const box = section(page).getByPlaceholder("Enter code");
    await box.fill(code, { timeout: 5000 });
    await section(page).getByRole("button", { name: /Apply/ }).click({ timeout: 5000 });
    await section(page).getByText(code, { exact: true }).waitFor({ timeout: 10000 });
    return true;
  } catch { return false; }
};
const shotSection = async (page, name) => {
  if (!(await section(page).count())) return;
  await section(page).scrollIntoViewIfNeeded();
  await section(page).screenshot({ path: path.join(SHOTS, `bug173-${name}.png`), animations: "disabled" });
};
const noEmDash = (s) => !/—/.test(s);
// One case: a step that can't find what it needs records a FAIL for the case and the run goes on to the next.
const run = async (name, opened, fn) => {
  const o = await opened;
  try { await fn(o); } catch (e) { check(`${name}: finished its steps`, false, String(e?.message || e).split("\n")[0]); } finally { await o.ctx.close(); }
};

// Clicks a control only when it is on the page, so a missing one shows up as the FAILs after it rather than a stop.
const clickIf = async (loc) => { if (await loc.count()) await loc.first().click({ timeout: 8000 }); };

// ── C: the comped lab's owner on the VeritaCheck page ───────────────────────
await run("C", open("comp", people.comp), async ({ page, sent }) => {
  await openVc(page, labComp);
  check("C1. the comped Unlimited lab's owner sees the pricing section", (await section(page).count()) === 1);
  const btn = page.getByTestId("button-vc-subscribe");
  await btn.waitFor({ timeout: 10000 }).catch(() => {});
  check("C2. the primary button reads Subscribe to VeritaCheck® Unlimited, with the price line and See all plans", (await btn.innerText().catch(() => "")).trim() === SUBSCRIBE && (await section(page).getByText(PRICE_LINE).count()) === 1 && (await section(page).getByTestId("link-see-all-plans").getAttribute("href").catch(() => null)) === "/pricing");
  await applyCode(page, CODE);
  check("C3. an applied code is kept for this tab", (await pending(page)) === CODE, String(await pending(page)));
  const line10 = (await page.getByTestId("vc-first-year-line").innerText().catch(() => "")).trim();
  check("C3b. the banner gives the real first year for a 10% code: the $200 first-year discount stays, $299", line10 === LINE10 && (await section(page).getByText(PRICE_LINE).count()) === 1, line10 || "(no first-year line)");
  check("C4. no em dash in the section", noEmDash(await section(page).innerText().catch(() => "")));
  await shotSection(page, "1-veritacheck-comped-owner-light");
  await clickIf(btn);
  await page.waitForURL(`**${INTERCEPTED}`, { timeout: 10000 }).catch(() => {});
  const b = sent[0] || {};
  check("C5. Subscribe sends priceType veritacheck_only, the lab id and the applied code", sent.length === 1 && b.priceType === "veritacheck_only" && Number(b.labId) === labComp && b.discountCode === CODE, JSON.stringify(sent));
  check("C6. it goes to the URL checkout returned and forgets the kept code", page.url().endsWith(INTERCEPTED) && (await pending(page)) === null, `${page.url()} ${await pending(page)}`);
});
await run("B", open("comp-50", people.comp), async ({ page, sent }) => {
  await openVc(page, labComp);
  await applyCode(page, CODE50);
  const line = (await page.getByTestId("vc-first-year-line").innerText().catch(() => "")).trim();
  const price = (await page.getByTestId("vc-price-line").innerText().catch(() => "")).trim();
  check("B1. a 50% code: the banner reads First year with this code: $249.50, then $499 a year., and the line under the button follows it", line === LINE50 && price === "$249.50 the first year with your code, $499 a year after.", `${line} | ${price}`);
  check("B2. the banner names no free trial and has no em dash", !/free trial/i.test(await section(page).innerText().catch(() => "")) && noEmDash(await section(page).innerText().catch(() => "")));
  await shotSection(page, "5-veritacheck-50pct-code-light");
  await clickIf(page.getByTestId("button-vc-subscribe"));
  await page.waitForURL(`**${INTERCEPTED}`, { timeout: 10000 }).catch(() => {});
  check("B3. Subscribe sends the 50% code", sent.length === 1 && sent[0]?.priceType === "veritacheck_only" && sent[0]?.discountCode === CODE50, JSON.stringify(sent));
});
await run("C7", open("comp-409", people.comp, { checkoutReply: { status: 409, body: { error: "This lab already has an active VeritaCheck® Unlimited subscription.", code: "ALREADY_SUBSCRIBED" } } }), async ({ page, sent }) => {
  await openVc(page, labComp);
  await clickIf(page.getByTestId("button-vc-subscribe"));
  const toast = page.getByText("This lab already has an active VeritaCheck® Unlimited subscription.").first();
  await toast.waitFor({ timeout: 8000 }).catch(() => {});
  check("C7. a 409 ALREADY_SUBSCRIBED shows as a toast and nothing redirects", sent.length === 1 && (await toast.count()) > 0 && page.url().includes(`/labs/${labComp}/veritacheck`), `${sent.length} ${page.url()}`);
});
await run("D", open("comp-dark", people.comp, { colorScheme: "dark" }), async ({ page }) => {
  await openVc(page, labComp);
  await applyCode(page, CODE);
  check("D1. dark mode: the page is dark and the section shows the Subscribe button", (await page.evaluate(() => document.documentElement.classList.contains("dark"))) && (await page.getByTestId("button-vc-subscribe").count()) === 1);
  await shotSection(page, "2-veritacheck-comped-owner-dark");
});

// ── K: the lab paying by card ────────────────────────────────────────────────
await run("K", open("card", people.card), async ({ page }) => {
  await openVc(page, labCard);
  await page.getByText("The studies your lab has always run").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("K1. a card-subscribed Unlimited lab's owner sees no pricing section and no Subscribe", (await section(page).count()) === 0 && (await page.getByTestId("button-vc-subscribe").count()) === 0);
  await page.goto(`${BASE}/labs/${labCard}/account/settings`, { waitUntil: "networkidle" });
  await page.getByText("Discount Code").first().waitFor({ timeout: 10000 }).catch(() => {});
  check("K2. Account Settings shows it no Subscribe button", (await page.getByText("Discount Code").count()) > 0 && (await page.getByTestId("button-account-vc-subscribe").count()) === 0);
});

// ── S: a seat user in the comped lab ─────────────────────────────────────────
await run("S", open("seat", people.seat), async ({ page, sent }) => {
  await openVc(page, labComp);
  check("S1. a seat user (lab role staff) sees the section with View Pricing and no Subscribe button", (await section(page).count()) === 1 && (await page.getByTestId("button-vc-subscribe").count()) === 0 && (await section(page).getByRole("link", { name: /View Pricing/ }).count()) === 1);
  check("S2. nothing was sent to checkout", sent.length === 0);
  await shotSection(page, "4-veritacheck-seat-user-light");
});

// ── A: Account Settings for the comped owner ─────────────────────────────────
await run("A", open("comp-account", people.comp), async ({ page, sent }) => {
  await openVc(page, labComp);
  await applyCode(page, CODE);
  await page.goto(`${BASE}/labs/${labComp}/account/settings`, { waitUntil: "networkidle" });
  const btn = page.getByTestId("button-account-vc-subscribe");
  await btn.waitFor({ timeout: 10000 }).catch(() => {});
  const card = page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Discount Code", { exact: true }) }).last();
  const box = card.getByPlaceholder("Enter code");
  check("A1. the code applied on the VeritaCheck page fills the Discount Code box", (await box.inputValue({ timeout: 5000 }).catch(() => "")) === CODE, await box.inputValue({ timeout: 5000 }).catch(() => "(no box)"));
  check("A2. Subscribe to VeritaCheck® Unlimited shows with no code applied, with the price line, and no Activate Subscription", (await btn.innerText().catch(() => "")).trim() === SUBSCRIBE && (await card.getByText(PRICE_LINE).count()) === 1 && (await page.getByRole("button", { name: "Activate Subscription" }).count()) === 0);
  if (await card.count()) {
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: path.join(SHOTS, "bug173-3-account-settings-comped-owner-light.png"), animations: "disabled" });
  }
  if (await btn.count()) {
    await clickIf(card.getByRole("button", { name: /Apply/ }));
    await page.getByTestId("account-vc-first-year-line").waitFor({ timeout: 8000 }).catch(() => {});
    const line = (await page.getByTestId("account-vc-first-year-line").innerText().catch(() => "")).trim();
    check("A2b. Apply here gives the same first-year banner as the VeritaCheck page (10% code: first year stays $299)", line === LINE10, line || "(no first-year line)");
  }
  // Before the fix the only way to checkout here was Activate Subscription after Apply; use it so the priceType it sends is on record.
  if (!(await btn.count())) {
    if (!(await box.inputValue({ timeout: 5000 }).catch(() => ""))) await box.fill(CODE, { timeout: 5000 }).catch(() => {});
    await clickIf(card.getByRole("button", { name: /Apply/ }));
    await page.getByRole("button", { name: "Activate Subscription" }).waitFor({ timeout: 8000 }).catch(() => {});
    await clickIf(page.getByRole("button", { name: "Activate Subscription" }));
  } else await btn.click();
  await page.waitForURL(`**${INTERCEPTED}`, { timeout: 10000 }).catch(() => {});
  const b = sent[0] || {};
  check("A3. it sends priceType veritacheck_only (not community), the lab id and the kept code", sent.length === 1 && b.priceType === "veritacheck_only" && Number(b.labId) === labComp && b.discountCode === CODE, JSON.stringify(sent));
  check("A4. it goes to checkout's URL and forgets the kept code", page.url().endsWith(INTERCEPTED) && (await pending(page)) === null);
});
await run("A5", open("comp-account-nocode", people.comp), async ({ page, sent }) => {
  await page.goto(`${BASE}/labs/${labComp}/account/settings`, { waitUntil: "networkidle" });
  const btn = page.getByTestId("button-account-vc-subscribe");
  await btn.waitFor({ timeout: 10000 }).catch(() => {});
  await clickIf(btn);
  await page.waitForURL(`**${INTERCEPTED}`, { timeout: 10000 }).catch(() => {});
  const b = sent[0] || {};
  check("A5. with no code kept or typed, Subscribe sends veritacheck_only and the lab id with no code", sent.length === 1 && b.priceType === "veritacheck_only" && Number(b.labId) === labComp && !("discountCode" in b), JSON.stringify(sent));
});

// ── O: signed out ────────────────────────────────────────────────────────────
await run("O", open("signed-out", null), async ({ page, sent }) => {
  await openVc(page, null);
  const btn = page.getByTestId("button-vc-signin-subscribe");
  check("O1. signed out, the section shows Sign in or create an account to subscribe, to /login, with See all plans", (await section(page).count()) === 1 && /Sign in or create an account to subscribe/.test(await btn.innerText().catch(() => "")) && (await btn.getAttribute("href").catch(() => null)) === "/login" && (await section(page).getByTestId("link-see-all-plans").count()) === 1);
  await applyCode(page, CODE);
  check("O2. an applied code is kept for the tab", (await pending(page)) === CODE);
  await clickIf(btn);
  await page.waitForURL("**/login", { timeout: 10000 }).catch(() => {});
  check("O3. the button opens the sign-in page and the code is still kept there; nothing went to checkout", page.url().endsWith("/login") && (await pending(page)) === CODE && sent.length === 0, page.url());
});

check("no request left for Stripe", stripeHits.length === 0, stripeHits.join(" "));
check("no page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 400));
await browser.close();
console.log(failures ? `${failures} FAILED, ${passes} passed` : `ALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
