// Shared server-side constants. Values that may need to change between
// environments are read from process.env with a sensible default.

// Email of the demo account. Read-only sandbox user used by the public
// demo flow. Single source of truth (was previously hardcoded in 7 places).
export const DEMO_USER_EMAIL =
  process.env.DEMO_USER_EMAIL ?? "demo@veritaslabservices.com";

// Email of the platform owner. Has permanent enterprise access in db.ts.
// Default preserves production behavior; can be overridden in env.
export const OWNER_EMAIL =
  process.env.OWNER_EMAIL ?? "verilabguy@gmail.com";
