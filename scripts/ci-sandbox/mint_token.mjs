// scripts/ci-sandbox/mint_token.mjs
//
// Mints the long-lived JWT the CI "Sandbox receipts" step uses as PW_TOKEN
// (parking lot #74, 2026-10-07). Same claim shape and algorithm the server
// issues at login (server/routes.ts: jwt.sign({ userId }, JWT_SECRET)), with a
// 365-day expiry instead of 30 so the secret does not lapse monthly.
//
// Usage (the secret never touches the console or a file):
//   JWT_SECRET=<from Railway env, in-process> SANDBOX_USER_ID=<id> \
//     node scripts/ci-sandbox/mint_token.mjs | gh secret set PW_TOKEN --repo mav40121/veritas-lab-services
//
// Only ever for the CI sandbox owner (ci-sandbox@veritaslabservices.com), never
// for a client account or Michael's own account.
import jwt from "jsonwebtoken";

const secret = process.env.JWT_SECRET;
const userId = Number(process.env.SANDBOX_USER_ID);
if (!secret || !Number.isInteger(userId) || userId <= 0) {
  console.error("JWT_SECRET and SANDBOX_USER_ID are required");
  process.exit(1);
}
process.stdout.write(jwt.sign({ userId, ci_sandbox: true }, secret, { expiresIn: "365d" }));
