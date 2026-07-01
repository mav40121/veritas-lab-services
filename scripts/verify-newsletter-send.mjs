// Receipt for the newsletter send capability (server/newsletter.ts).
//
// Verifies the two pieces that must be correct before any real send:
//   1. Unsubscribe token round-trip: a valid token verifies; a tampered token,
//      a token for a different email, and an empty token all fail. This is the
//      gate that keeps the one-click unsubscribe link from being forgeable.
//   2. buildNewsletterHtml embeds the body, the recipient's unsubscribe link,
//      and the postal address (CAN-SPAM), and contains no em dashes.
//
// Pure logic, no network, no DB. Run: npx tsx scripts/verify-newsletter-send.mjs

process.env.JWT_SECRET = "test-secret-fixed-for-verify"; // deterministic tokens

const { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl, buildNewsletterHtml } =
  await import("../server/newsletter.ts");

let fails = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) fails++; };

const email = "dblecker-shelly@capitalhealth.org";
const tok = unsubscribeToken(email);

check("valid token verifies", verifyUnsubscribeToken(email, tok) === true);
check("tampered token fails", verifyUnsubscribeToken(email, tok.slice(0, -1) + (tok.endsWith("a") ? "b" : "a")) === false);
check("token for a different email fails", verifyUnsubscribeToken("someone.else@x.org", tok) === false);
check("empty token fails", verifyUnsubscribeToken(email, "") === false);
check("token is case-insensitive on email (matches subscribe lowercasing)", verifyUnsubscribeToken(email.toUpperCase(), tok) === true);

const url = unsubscribeUrl(email);
check("unsubscribe url points at the prod unsubscribe route", url.startsWith("https://www.veritaslabservices.com/api/newsletter/unsubscribe?e="));
check("unsubscribe url carries the token", url.includes(`t=${tok}`));

const html = buildNewsletterHtml({
  bodyHtml: "<p>Our newest QC article walks through testing into compliance.</p>",
  email,
  postalAddress: "Veritas Lab Services, LLC, 123 Example St, Anytown, MA 01000",
});
check("html includes the body content", html.includes("testing into compliance"));
check("html includes an Unsubscribe link to this recipient's url", html.includes(url) && html.includes(">Unsubscribe<"));
check("html includes the postal address (CAN-SPAM)", html.includes("123 Example St, Anytown, MA 01000"));
check("html carries the newsletter brand", html.includes("The Lab Director's Briefing"));
check("no em dash anywhere in the email", !html.includes("—"));

console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
process.exit(fails === 0 ? 0 : 1);
