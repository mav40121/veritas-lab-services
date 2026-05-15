// Shared server-side constants. Values that may need to change between
// environments are read from process.env with a sensible default.

// Email of the demo account. Read-only sandbox user used by the public
// demo flow. Single source of truth (was previously hardcoded in 7 places).
export const DEMO_USER_EMAIL =
  process.env.DEMO_USER_EMAIL ?? "demo@veritaslabservices.com";

// Email of the platform owner. Has permanent enterprise access in db.ts.
// Default preserves production behavior; can be overridden in env.
//
// NOTE: Email is an AUTHENTICATION property. For data routing (which lab
// owns a study, which lab gets seeded data) use OWNER_CLIA below. One
// email will own multiple labs once enterprise multi-lab rolls out, so
// queries like `SELECT FROM users WHERE email = ?` are ambiguous for
// data scoping and must be reserved for login / password-reset paths.
export const OWNER_EMAIL =
  process.env.OWNER_EMAIL ?? "verilabguy@gmail.com";

// CLIA number of the operator's personal lab. This is the stable lab
// identity (CMS issues each CLIA certificate once and never reassigns),
// so it is the right key for data-routing operations such as the seed
// block that copies reference studies into the operator's lab. Env-
// overridable for staging / preview deployments.
export const OWNER_CLIA =
  process.env.OWNER_CLIA ?? "55D5555555";
