// server/newsletterGuards.ts
//
// 2026-11-09 (handoff from the SEO session): a Playwright spec posted
// pw-book-<timestamp>@example.com to the LIVE /api/newsletter/subscribe on every
// smoke run, so 914 test rows sat in the live list and each one sent a welcome
// email through Resend from info@. Names reserved by RFC 2606 and RFC 6761 can
// never be a real mailbox, so the endpoint answers success for them and writes
// nothing and sends nothing. The spec keeps proving the endpoint is reachable.

const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];
const RESERVED_TLDS = ["test", "invalid", "example", "localhost"];

/** True when the address is on a reserved test domain (example.com/.net/.org, or a .test/.invalid/.example/.localhost name). */
export function isReservedTestAddress(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "");
  if (!domain) return false;
  if (RESERVED_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  const tld = domain.split(".").pop() || "";
  return RESERVED_TLDS.includes(tld);
}

// 2026-11-09 (Michael, Q247 = 1): the live list held 118 bot signups from the homepage form, Gmail addresses with
// three or more dots in the local part. Gmail ignores dots, so each one sent our welcome email to a real stranger's
// inbox. Three guards, all used by POST /api/newsletter/subscribe (server/routes.ts):
//   1. a hidden "website" field on every signup form (client/src/components/NewsletterHoneypot.tsx): filled means a bot
//   2. at most NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR accepted attempts per IP per hour, in memory
//   3. the duplicate check compares Gmail addresses the way Gmail delivers them (newsletterDedupeKey)
// tests/integration/newsletter-bot-guard.test.ts pins all three.

/** The hidden form field a person never sees and a form bot fills. Same name as the scheduling page's honeypot. */
export const NEWSLETTER_HONEYPOT_FIELD = "website";

/** True when the hidden field carries anything. The route then answers like a real signup and does nothing. */
export function isHoneypotFilled(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const v = (body as Record<string, unknown>)[NEWSLETTER_HONEYPOT_FIELD];
  if (v == null) return false;
  return String(v).trim() !== "";
}

/** A real person on a shared hospital network makes few signups an hour. */
export const NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR = 5;
const NEWSLETTER_RATE_WINDOW_MS = 60 * 60 * 1000;
const newsletterHits = new Map<string, number[]>();

/**
 * Counts one attempt for this IP and says whether it is allowed. A refused attempt isn't counted, so at most
 * NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR are let through in any hour. In memory: a restart clears it, which is fine for this.
 */
export function newsletterRateLimitOk(ip: string, now: number = Date.now()): boolean {
  const key = ip || "unknown";
  const recent = (newsletterHits.get(key) || []).filter((t) => now - t < NEWSLETTER_RATE_WINDOW_MS);
  if (recent.length >= NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR) {
    newsletterHits.set(key, recent);
    return false;
  }
  recent.push(now);
  newsletterHits.set(key, recent);
  if (newsletterHits.size > 5000) {
    for (const [k, hits] of newsletterHits) {
      if (!hits.some((t) => now - t < NEWSLETTER_RATE_WINDOW_MS)) newsletterHits.delete(k);
    }
  }
  return true;
}

const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

/**
 * The key the duplicate check compares. Gmail and Googlemail deliver j.o.h.n+x@gmail.com to john@gmail.com, so for
 * those two domains the dots in the local part and anything from a "+" on are dropped, and googlemail.com reads as
 * gmail.com. Every other address is its own key, as typed (lowercased and trimmed). Only for comparing: the stored
 * address stays as typed.
 */
export function newsletterDedupeKey(email: string): string {
  const typed = String(email || "").toLowerCase().trim();
  const at = typed.lastIndexOf("@");
  if (at < 0) return typed;
  const domain = typed.slice(at + 1).replace(/\.+$/, "");
  if (!GMAIL_DOMAINS.includes(domain)) return typed;
  const local = typed.slice(0, at).split("+")[0].replace(/\./g, "");
  return `${local}@gmail.com`;
}

/** True for an address on gmail.com or googlemail.com, the only domains whose key differs from the address. */
export function isGmailAddress(email: string): boolean {
  const typed = String(email || "").toLowerCase().trim();
  const at = typed.lastIndexOf("@");
  return at >= 0 && GMAIL_DOMAINS.includes(typed.slice(at + 1).replace(/\.+$/, ""));
}
