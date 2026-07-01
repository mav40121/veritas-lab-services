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

export function buildNewsletterHtml(opts: { bodyHtml: string; email: string; postalAddress: string }): string {
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
  <h1>${esc(NEWSLETTER_NAME)}</h1>
  <h2>From Veritas Lab Services</h2>
  <hr class="divider">
  ${opts.bodyHtml}
  <hr class="divider">
  <p class="foot">
    You are receiving this because you subscribed at veritaslabservices.com.
    <a href="${unsub}">Unsubscribe</a>.<br>
    ${esc(opts.postalAddress)}
  </p>
</body></html>`;
}

export interface NewsletterSendResult { sent: number; failed: number; errors: string[]; }

export async function sendNewsletter(opts: {
  subject: string;
  bodyHtml: string;
  recipients: string[];
  postalAddress: string;
}): Promise<NewsletterSendResult> {
  const result: NewsletterSendResult = { sent: 0, failed: 0, errors: [] };
  for (const email of opts.recipients) {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: NEWSLETTER_FROM,
          to: email,
          subject: opts.subject,
          html: buildNewsletterHtml({ bodyHtml: opts.bodyHtml, email, postalAddress: opts.postalAddress }),
        }),
      });
      if (resp.ok) result.sent++;
      else { result.failed++; result.errors.push(`${email}: HTTP ${resp.status}`); }
    } catch (err: any) {
      result.failed++;
      result.errors.push(`${email}: ${err?.message || err}`);
    }
  }
  return result;
}
