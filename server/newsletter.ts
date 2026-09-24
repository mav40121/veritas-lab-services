// server/newsletter.ts
//
// Reusable send path for "The Lab Director's Briefing" newsletter. The site only
// collected subscribers before; this adds the send side.
//
// - Wraps a campaign body in the branded layout used by the welcome email.
// - CAN-SPAM footer on every send: one-click unsubscribe link + physical postal
//   address (passed in at send time, never hardcoded).
// - Unsubscribe is a stateless HMAC token over the email, so no schema change and
//   the link cannot be forged. The public /api/newsletter/unsubscribe route flips
//   active = 0; the send only targets active = 1, so unsubscribes are honored.
// - Sends are per-recipient (each gets their own To and unsubscribe link); the
//   subscriber list is never exposed to recipients.
//
// No em dashes in any customer-facing copy (CLAUDE.md section 3).

import crypto from "node:crypto";

export const NEWSLETTER_FROM = "Michael Veri <info@veritaslabservices.com>";
export const NEWSLETTER_NAME = "The Lab Director's Briefing";
// Product-update sends go to registered VeritaAssure account holders (the users
// table), NOT the Lab Director's Briefing subscriber list. Separate masthead and
// "why you are getting this" reason so the two audiences are never conflated.
export const PRODUCT_UPDATE_FROM = "Michael Veri <info@veritaslabservices.com>";
export const PRODUCT_UPDATE_NAME = "VeritaAssure Product Update";
const BASE_URL = "https://www.veritaslabservices.com";

function unsubSecret(): string {
  return process.env.JWT_SECRET || process.env.ADMIN_SECRET || "veritas-newsletter-fallback-secret";
}

export function unsubscribeToken(email: string): string {
  return crypto
    .createHmac("sha256", unsubSecret())
    .update(`unsub:${String(email).toLowerCase().trim()}`)
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = Buffer.from(unsubscribeToken(email));
  const given = Buffer.from(String(token || ""));
  if (expected.length !== given.length) return false;
  return crypto.timingSafeEqual(expected, given);
}

export function unsubscribeUrl(email: string): string {
  const e = encodeURIComponent(String(email).toLowerCase().trim());
  return `${BASE_URL}/api/newsletter/unsubscribe?e=${e}&t=${unsubscribeToken(email)}`;
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Shared branded shell for both audiences. masthead/subhead/reason are the only
// things that differ between the Briefing newsletter and a product update, so the
// layout, colors, and CAN-SPAM unsubscribe footer stay in one place.
function renderEmailShell(opts: {
  masthead: string;
  subhead: string;
  reason: string;
  bodyHtml: string;
  email: string;
  postalAddress: string;
}): string {
  const unsub = unsubscribeUrl(opts.email);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Georgia, serif; color: #28251D; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6; }
  h1 { font-size: 22px; color: #01696F; margin-bottom: 4px; }
  h2 { font-size: 16px; font-weight: normal; color: #7A7974; margin-top: 0; }
  .divider { border: none; border-top: 1px solid #D4D1CA; margin: 24px 0; }
  a { color: #01696F; }
  p { font-size: 15px; }
  .foot { font-size: 11px; color: #BAB9B4; line-height: 1.5; }
</style></head>
<body>
  <h1>${esc(opts.masthead)}</h1>
  <h2>${esc(opts.subhead)}</h2>
  <hr class="divider">
  ${opts.bodyHtml}
  <hr class="divider">
  <p class="foot">
    ${esc(opts.reason)}
    <a href="${unsub}">Unsubscribe</a>.<br>
    ${esc(opts.postalAddress)}
  </p>
</body></html>`;
}

export function buildNewsletterHtml(opts: { bodyHtml: string; email: string; postalAddress: string }): string {
  return renderEmailShell({
    masthead: NEWSLETTER_NAME,
    subhead: "From Veritas Lab Services",
    reason: "You are receiving this because you subscribed at veritaslabservices.com.",
    bodyHtml: opts.bodyHtml,
    email: opts.email,
    postalAddress: opts.postalAddress,
  });
}

// Product update to registered account holders. Different masthead and reason so
// a real user knows this reached them because they have an account, not because
// they subscribed to the Briefing.
export function buildProductUpdateHtml(opts: { bodyHtml: string; email: string; postalAddress: string }): string {
  return renderEmailShell({
    masthead: PRODUCT_UPDATE_NAME,
    subhead: "From Veritas Lab Services",
    reason: "You are receiving this because you have a VeritaAssure account at veritaslabservices.com.",
    bodyHtml: opts.bodyHtml,
    email: opts.email,
    postalAddress: opts.postalAddress,
  });
}

// Michael's standing instruction: he is CC'd on every real send so he sees the
// live product. A testTo preview stays single-recipient (that is the point of a
// preview), so the owner is only auto-added on the list send.
export const OWNER_CC = "verilabguy@gmail.com";

export function resolveRecipients(activeEmails: string[], testTo?: string | null): string[] {
  if (testTo) return [String(testTo).toLowerCase().trim()];
  const set = new Set(activeEmails.map((e) => String(e).toLowerCase().trim()).filter(Boolean));
  set.add(OWNER_CC); // deduped: no double-send if the owner is also a subscriber
  return [...set];
}

export interface NewsletterSendResult { sent: number; failed: number; errors: string[]; }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function sendNewsletter(opts: {
  subject: string;
  bodyHtml: string;
  recipients: string[];
  postalAddress: string;
  // Optional overrides for the product-update audience. Defaults keep the
  // Briefing newsletter behavior byte-identical for existing callers.
  from?: string;
  buildHtml?: (a: { bodyHtml: string; email: string; postalAddress: string }) => string;
}): Promise<NewsletterSendResult> {
  const fromAddress = opts.from || NEWSLETTER_FROM;
  const buildHtml = opts.buildHtml || buildNewsletterHtml;
  const result: NewsletterSendResult = { sent: 0, failed: 0, errors: [] };
  // Resend's default rate limit is ~2 requests/second. Pace sends just under
  // that and retry transient failures (429 rate-limit, 5xx) with exponential
  // backoff so a large list is not silently truncated. A prior 233-recipient
  // send fired with no throttle or retry and lost ~30 recipients to HTTP 429.
  const THROTTLE_MS = 600; // ~1.6 sends/second
  const MAX_RETRIES = 4;   // backoff 1s, 2s, 4s, 8s
  for (const email of opts.recipients) {
    let ok = false;
    let lastError = "unknown error";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: email,
            subject: opts.subject,
            html: buildHtml({ bodyHtml: opts.bodyHtml, email, postalAddress: opts.postalAddress }),
          }),
        });
        if (resp.ok) { ok = true; break; }
        lastError = `HTTP ${resp.status}`;
        // Only rate-limit (429) and server errors (5xx) are worth retrying; a
        // 4xx such as 422 (invalid address) will never succeed.
        if (resp.status !== 429 && resp.status < 500) break;
      } catch (err: any) {
        lastError = String(err?.message || err);
      }
      if (attempt < MAX_RETRIES) await sleep(1000 * Math.pow(2, attempt));
    }
    if (ok) result.sent++;
    else { result.failed++; result.errors.push(`${email}: ${lastError}`); }
    await sleep(THROTTLE_MS);
  }
  return result;
}
