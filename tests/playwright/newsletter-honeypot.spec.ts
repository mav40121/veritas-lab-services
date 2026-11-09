// tests/playwright/newsletter-honeypot.spec.ts
//
// Gate 3 browser receipt for the newsletter bot guard (Michael 2026-11-09, Q247 = 1). Every form that posts to
// /api/newsletter/subscribe carries a hidden "website" field (client/src/components/NewsletterHoneypot.tsx); the server
// answers a filled one like a real signup and stores and sends nothing (server/newsletterGuards.ts). For each form this
// checks that the field is there, that a person can't see it, tab to it, or hear it, that a normal fill-and-submit sends
// it empty and still shows the form's own success state.
// Local build only: it skips unless PW_BASE is localhost or 127.0.0.1, so it never posts to production. It submits a
// reserved test address (example.com), which the endpoint never stores or mails and the rate limit doesn't count.
// Server-side behavior (honeypot, rate limit, Gmail key) is pinned by tests/integration/newsletter-bot-guard.test.ts.
// Run: PW_BASE=http://localhost:5199 npx playwright test newsletter-honeypot

import { test, expect, type Page, type Locator } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

type FormCase = {
  name: string;
  path: string;
  form: (page: Page) => Locator;
  success: (page: Page) => Locator;
};

const byButton = (page: Page, name: RegExp) =>
  page.locator("form").filter({ has: page.locator('input[name="website"]') }).filter({ has: page.getByRole("button", { name }) }).first();

const FORMS: FormCase[] = [
  { name: "homepage newsletter (banner)", path: "/", form: (p) => byButton(p, /^subscribe free$/i), success: (p) => p.getByText("You're subscribed.") },
  { name: "Resources newsletter (card)", path: "/resources", form: (p) => byButton(p, /^subscribe free$/i), success: (p) => p.getByText("You're subscribed.") },
  { name: "article newsletter (inline)", path: "/resources/clia-tea-what-lab-directors-dont-know", form: (p) => byButton(p, /^subscribe$/i), success: (p) => p.getByText("You're subscribed.") },
  { name: "TEa content upgrade", path: "/resources/clia-tea-lookup", form: (p) => p.getByTestId("content-upgrade-upgrade-tea-table").locator("form"), success: (p) => p.getByTestId("content-upgrade-done") },
  { name: "book waitlist", path: "/book", form: (p) => byButton(p, /^notify me$/i), success: (p) => p.getByText("You're on the list!").first() },
];

test.describe("Newsletter honeypot on every signup form", () => {
  for (const f of FORMS) {
    test(`${f.name}: hidden field present and hidden; a normal submit still succeeds`, async ({ page }) => {
      test.skip(!LOCAL, "posts to the signup endpoint: local build only");
      await page.goto(`${BASE}${f.path}`);
      const form = f.form(page);
      await expect(form).toBeVisible({ timeout: 20000 });
      await form.scrollIntoViewIfNeeded();

      const hp = form.locator('input[name="website"]');
      await expect(hp).toHaveCount(1);
      await expect(hp, "a person can't see the honeypot").toBeHidden();
      await expect(hp).toHaveAttribute("tabindex", "-1");
      await expect(hp).toHaveAttribute("autocomplete", "off");
      expect(await hp.evaluate((el) => !!el.closest('[aria-hidden="true"]')), "screen readers skip it").toBe(true);
      expect(await hp.inputValue()).toBe("");

      const submit = form.locator('button[type="submit"]');
      await submit.focus();
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name || ""), "Tab never lands on it").not.toBe("website");

      const email = `pw-honeypot-${Date.now()}@example.com`;
      await form.locator('input[type="email"]').fill(email);
      const reqP = page.waitForRequest((r) => r.url().endsWith("/api/newsletter/subscribe") && r.method() === "POST");
      const resP = page.waitForResponse((r) => r.url().endsWith("/api/newsletter/subscribe"));
      await submit.click();
      const body = JSON.parse((await reqP).postData() || "{}");
      expect(body.email).toBe(email);
      expect(body.website, "a person's submit sends the hidden field empty").toBe("");
      const res = await resP;
      expect(res.status()).toBe(200);
      await expect(f.success(page)).toBeVisible({ timeout: 15000 });
    });
  }
});
