// Bot guard for public sign-up (Michael 2026-11-23: "I keep getting bogus sign ups"). All five bogus sign-ups from 2026-11-11
// to 2026-11-23 (users 166, 187, 191, 195, 197) sent the same browser string inside literal quote marks, from rotating
// anonymizing addresses, with random-letter names and other people's email addresses, so each one also mailed a stranger our
// confirmation link. A browser never sends its User-Agent in quotes; a script that pastes one from a quoted list does.
//   A public sign-up that does is answered exactly as a person's is, and nothing is stored, mailed or alerted (routes.ts, POST
//   /api/auth/register), so the script learns nothing. An invitation's link is never blocked: it proves its own address.
//   No hidden form field here: an autofill that filled it would drop a real customer without a word.
// tests/integration/signup-bot-guard.test.ts pins it.

/** True when the User-Agent header itself starts with a quote mark, which no browser sends. */
export function isQuotedUserAgent(userAgent: unknown): boolean {
  return typeof userAgent === "string" && /^\s*["'“‘`]/.test(userAgent);
}
