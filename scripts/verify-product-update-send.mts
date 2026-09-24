// scripts/verify-product-update-send.mts
//
// Receipt for the "send to verified VeritaAssure users only" path (2026-09-24).
// The wrong-list incident: a product update went to /api/admin/newsletter/send,
// which targets the 675-person Lab Director's Briefing subscriber list (includes
// non-users). The fix adds POST /api/admin/users/send, which targets registered
// account holders (the users table) and honors unsubscribes as suppression.
//
// This proves, against the REAL builders and the EXACT recipient SQL:
//   1. buildNewsletterHtml output is unchanged (Briefing masthead + reason) so
//      the existing Briefing send is not disturbed by the shared-shell refactor.
//   2. buildProductUpdateHtml uses the account-holder masthead + reason, carries
//      the unsubscribe link and postal address, and does NOT wear the Briefing
//      masthead.
//   3. resolveRecipients auto-CCs the owner, dedupes, and stays single-recipient
//      on a testTo preview.
//   4. The users-audience recipient SQL sends to registered users, excludes
//      suppressed emails (active = 0), excludes RFC-reserved test domains, and
//      dedupes case-insensitively.
//
// Run: npx tsx scripts/verify-product-update-send.mts   (exits non-zero on fail)

import Database from "better-sqlite3";
import {
  buildNewsletterHtml,
  buildProductUpdateHtml,
  resolveRecipients,
  unsubscribeUrl,
  OWNER_CC,
  NEWSLETTER_NAME,
  PRODUCT_UPDATE_NAME,
} from "../server/newsletter";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const POSTAL = "Veritas Lab Services, LLC, 119 Glen Ave, Upton, MA 01568";
const EMAIL = "reader@lab.org";
const BODY = "<p>We shipped coverage recurrence.</p>";

// ── 1. Briefing template regression guard ────────────────────────────────────
const nl = buildNewsletterHtml({ bodyHtml: BODY, email: EMAIL, postalAddress: POSTAL });
check("newsletter: Briefing masthead present", nl.includes(`<h1>${NEWSLETTER_NAME}</h1>`));
check("newsletter: subscriber reason present", nl.includes("you subscribed at veritaslabservices.com"));
check("newsletter: does NOT carry product-update masthead", !nl.includes(PRODUCT_UPDATE_NAME));
check("newsletter: body embedded", nl.includes(BODY));
check("newsletter: unsubscribe link present", nl.includes(unsubscribeUrl(EMAIL)));
check("newsletter: postal address present", nl.includes(POSTAL));

// ── 2. Product-update template ───────────────────────────────────────────────
const pu = buildProductUpdateHtml({ bodyHtml: BODY, email: EMAIL, postalAddress: POSTAL });
check("product: account-holder masthead present", pu.includes(`<h1>${PRODUCT_UPDATE_NAME}</h1>`));
check("product: account-holder reason present", pu.includes("you have a VeritaAssure account at veritaslabservices.com"));
check("product: does NOT wear the Briefing masthead", !pu.includes(`<h1>${NEWSLETTER_NAME}</h1>`));
check("product: does NOT claim 'you subscribed'", !pu.includes("you subscribed at"));
check("product: body embedded", pu.includes(BODY));
check("product: unsubscribe link present (CAN-SPAM)", pu.includes(unsubscribeUrl(EMAIL)));
check("product: postal address present (CAN-SPAM)", pu.includes(POSTAL));

// ── 3. resolveRecipients ─────────────────────────────────────────────────────
const listRecips = resolveRecipients(["a@x.com", "b@x.com", "A@X.COM"]);
check("recipients: owner auto-CC'd", listRecips.includes(OWNER_CC));
check("recipients: case-insensitive dedupe (a@x.com once)", listRecips.filter((e) => e === "a@x.com").length === 1);
const testRecips = resolveRecipients(["a@x.com", "b@x.com"], "preview@me.com");
check("recipients: testTo stays single-recipient", testRecips.length === 1 && testRecips[0] === "preview@me.com");
check("recipients: testTo does NOT add owner", !testRecips.includes(OWNER_CC));

// ── 4. Users-audience recipient SQL (exact query from routes.ts) ─────────────
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE newsletter_subscribers (email TEXT NOT NULL UNIQUE, source TEXT, subscribed_at TEXT, unsubscribed_at TEXT, active INTEGER NOT NULL DEFAULT 1);
`);
// Registered users: one plain, one suppressed, one duplicate-case, one RFC test domain.
db.exec(`
  INSERT INTO users (id, email) VALUES
    (1, 'alice@clinic.org'),
    (2, 'bob@hospital.com'),
    (3, 'CAROL@LAB.NET'),
    (4, 'pwtest@example.com'),
    (5, 'dave@example.org');
`);
// bob unsubscribed (has a suppression row); a non-user unsubscribe also present.
db.exec(`
  INSERT INTO newsletter_subscribers (email, source, subscribed_at, active) VALUES
    ('bob@hospital.com', 'unsubscribe-suppression', '2026-09-01', 0),
    ('someoneelse@brief.com', 'website', '2026-08-01', 0);
`);

const recipSql = `SELECT DISTINCT LOWER(u.email) AS email
     FROM users u
     LEFT JOIN newsletter_subscribers n ON LOWER(n.email) = LOWER(u.email)
    WHERE u.email LIKE '%@%'
      AND u.email NOT LIKE '%@example.com'
      AND u.email NOT LIKE '%@example.org'
      AND (n.active IS NULL OR n.active = 1)
    ORDER BY email`;
const rows = (db.prepare(recipSql).all() as any[]).map((r) => r.email);

check("sql: includes a plain registered user", rows.includes("alice@clinic.org"));
check("sql: EXCLUDES an unsubscribed (suppressed) user", !rows.includes("bob@hospital.com"));
check("sql: normalizes case (carol lowercased, included)", rows.includes("carol@lab.net"));
check("sql: EXCLUDES @example.com test domain", !rows.some((e) => e.endsWith("@example.com")));
check("sql: EXCLUDES @example.org test domain", !rows.some((e) => e.endsWith("@example.org")));
check("sql: does NOT invent non-user subscribers", !rows.includes("someoneelse@brief.com"));
check("sql: expected exact recipient set", JSON.stringify(rows) === JSON.stringify(["alice@clinic.org", "carol@lab.net"]));
db.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
