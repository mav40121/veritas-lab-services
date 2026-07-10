// scripts/verify-staffportal-signout-security.mjs
//
// Receipt for the Staff Portal sign-out security fix (2026-07-10, VeritaStaff
// audit HIGH #1). signOut() removed localStorage 'auth_token' -- a key that does
// not exist -- while the portal reads/writes 'veritas_token' (lib/auth TOKEN_KEY).
// So Sign out was a no-op: on a shared device the session survived and the next
// person was silently authenticated as the prior user. Fixed to call clearAuth().
//
//   node scripts/verify-staffportal-signout-security.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const portal = read("client/src/pages/StaffPortalPage.tsx");
const auth = read("client/src/lib/auth.ts");

ok("signOut() now calls clearAuth()", /function signOut\(\)\s*\{[\s\S]{0,400}clearAuth\(\)/.test(portal));
ok("signOut() no longer removes the non-existent 'auth_token' key",
  !/removeItem\("auth_token"\)/.test(portal));
ok("clearAuth is imported from @/lib/auth", /import \{ clearAuth \} from "@\/lib\/auth"/.test(portal));
ok("clearAuth actually removes the token the portal reads (TOKEN_KEY = 'veritas_token')",
  /const TOKEN_KEY = "veritas_token"/.test(auth) &&
  /export function clearAuth\(\)[\s\S]{0,200}removeItem\(TOKEN_KEY\)/.test(auth));
ok("the redirect to /login still fires after clearing", /clearAuth\(\)[\s\S]{0,120}window\.location\.href = "\/login"/.test(portal));

console.log(fails === 0 ? "\n=== STAFF PORTAL SIGN-OUT SECURITY: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
