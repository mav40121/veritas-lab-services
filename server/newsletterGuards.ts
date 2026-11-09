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
