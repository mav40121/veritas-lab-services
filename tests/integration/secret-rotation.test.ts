// tests/integration/secret-rotation.test.ts
//
// Railway environment-variable disclosure (2026-10-21; Michael Q4 = 2: rotate every secret when Railway's API
// returns). Proves a JWT_SECRET / MFA_KEY rotation cannot silently lock people out:
//   - a plain swap DOES break sealed authenticator keys, SSO client secrets and old unsubscribe links (the danger)
//   - MFA_KEY_PREVIOUS / UNSUBSCRIBE_SECRET_PREVIOUS keep them working during the changeover
//   - POST /api/admin/rotation/reseal: 403 without the admin secret; dry run changes nothing; dryRun:false re-seals
//     every previous-key value, leaves unreadable ones alone, and afterwards they open with no previous key set
//   - the previous key is NEVER accepted for sign-in: a session token re-signed with the old JWT_SECRET is refused
// Run: npm run test:secret-rotation
import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const OLD_JWT = "old-jwt-secret-before-rotation";
const NEW_JWT = "new-jwt-secret-after-rotation";
const NEW_MFA = "new-mfa-key-after-rotation";
const TOTP = "JBSWY3DPEHPK3PXP";
const SSO_SECRET = "entra-client-secret-xyz";

async function main() {
  // Routes read JWT_SECRET when they load, so load them under the NEW secret (the post-rotation server).
  process.env.JWT_SECRET = NEW_JWT;
  process.env.MFA_KEY = NEW_MFA;
  delete process.env.MFA_KEY_PREVIOUS;
  delete process.env.UNSUBSCRIBE_SECRET_PREVIOUS;
  const { sealSecret, openSecret, sealedKeyStatus } = await import("../../server/twoFactor");
  const { unsubscribeToken, verifyUnsubscribeToken } = await import("../../server/newsletter");
  const { registerRoutes } = await import("../../server/routes");
  const { db } = await import("../../server/db");
  const sqlite = (db as any).$client;

  // ── Values written BEFORE the rotation (production today: MFA_KEY unset, so the seal source is JWT_SECRET) ──
  const asOld = <T>(fn: () => T): T => {
    const keep = { j: process.env.JWT_SECRET, m: process.env.MFA_KEY };
    process.env.JWT_SECRET = OLD_JWT;
    delete process.env.MFA_KEY;
    try { return fn(); } finally { process.env.JWT_SECRET = keep.j; process.env.MFA_KEY = keep.m; }
  };
  const oldTotp = asOld(() => sealSecret(TOTP));
  const oldPending = asOld(() => sealSecret("PENDINGSECRET234"));
  const oldSso = asOld(() => sealSecret(SSO_SECRET));
  const oldUnsub = asOld(() => unsubscribeToken("Reader@Example.com"));
  const foreign = (() => { const k = { j: process.env.JWT_SECRET, m: process.env.MFA_KEY }; process.env.MFA_KEY = "some-other-key"; try { return sealSecret("X"); } finally { process.env.JWT_SECRET = k.j; process.env.MFA_KEY = k.m; } })();
  sqlite.prepare("INSERT OR REPLACE INTO user_mfa (user_id, method, totp_secret_enc, pending_secret_enc) VALUES (?, 'totp', ?, ?)").run(990001, oldTotp, oldPending);
  sqlite.prepare("INSERT OR REPLACE INTO user_mfa (user_id, method, totp_secret_enc) VALUES (?, 'totp', ?)").run(990002, foreign);
  const ssoId = Number(sqlite.prepare("INSERT INTO sso_configs (name, issuer, client_id, client_secret_enc) VALUES ('Rotation test', 'https://issuer.example', 'cid', ?)").run(oldSso).lastInsertRowid);

  // ── The danger: a plain swap ──
  check("1. plain swap: an authenticator key sealed before the rotation no longer opens", openSecret(oldTotp) === null);
  check("2. plain swap: an SSO client secret sealed before the rotation no longer opens", openSecret(oldSso) === null);
  check("3. plain swap: an unsubscribe link from an email already sent stops working", verifyUnsubscribeToken("reader@example.com", oldUnsub) === false);

  // ── The changeover settings ──
  process.env.MFA_KEY_PREVIOUS = OLD_JWT;
  process.env.UNSUBSCRIBE_SECRET_PREVIOUS = OLD_JWT;
  check("4. with MFA_KEY_PREVIOUS: old authenticator key and SSO secret open", openSecret(oldTotp) === TOTP && openSecret(oldSso) === SSO_SECRET);
  check("5. with UNSUBSCRIBE_SECRET_PREVIOUS: old unsubscribe link works, a new one works too", verifyUnsubscribeToken("reader@example.com", oldUnsub) && verifyUnsubscribeToken("reader@example.com", unsubscribeToken("reader@example.com")));
  check("6. a forged unsubscribe token is still refused", verifyUnsubscribeToken("reader@example.com", "0".repeat(32)) === false);
  check("7. new values are sealed with the CURRENT key, never the previous", sealedKeyStatus(sealSecret("Y")) === "current");

  // ── HTTP: the re-seal route, and sign-in ──
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const post = (url: string, body: any) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const ADMIN = process.env.ADMIN_SECRET!;
  const col = (r: any, t: string, c: string) => r.columns.find((x: any) => x.table === t && x.column === c);

  check("8. re-seal without the admin secret: 403", (await post("/api/admin/rotation/reseal", { secret: "wrong" })).status === 403);
  const dry = await (await post("/api/admin/rotation/reseal", { secret: ADMIN })).json();
  const stillOld = sqlite.prepare("SELECT totp_secret_enc FROM user_mfa WHERE user_id = 990001").get().totp_secret_enc === oldTotp;
  check("9. dry run (default): counts previous 1 / unreadable 1 for authenticator keys, previous 1 SSO, changes nothing",
    dry.dryRun === true && col(dry, "user_mfa", "totp_secret_enc").previous === 1 && col(dry, "user_mfa", "totp_secret_enc").unreadable === 1
    && col(dry, "user_mfa", "pending_secret_enc").previous === 1 && col(dry, "sso_configs", "client_secret_enc").previous === 1 && stillOld, JSON.stringify(dry.columns));
  check("10. the response carries counts only, no secret", !JSON.stringify(dry).includes(TOTP) && !JSON.stringify(dry).includes(SSO_SECRET));
  const real = await (await post("/api/admin/rotation/reseal", { secret: ADMIN, dryRun: false })).json();
  check("11. dryRun:false re-seals all 3 previous-key values", real.dryRun === false && real.columns.reduce((n: number, c: any) => n + c.resealed, 0) === 3, JSON.stringify(real.columns));
  check("12. the unreadable value is left exactly as it was", sqlite.prepare("SELECT totp_secret_enc FROM user_mfa WHERE user_id = 990002").get().totp_secret_enc === foreign);
  delete process.env.MFA_KEY_PREVIOUS;
  const t1 = sqlite.prepare("SELECT totp_secret_enc, pending_secret_enc FROM user_mfa WHERE user_id = 990001").get();
  const s1 = sqlite.prepare("SELECT client_secret_enc FROM sso_configs WHERE id = ?").get(ssoId).client_secret_enc;
  check("13. after the re-seal, with MFA_KEY_PREVIOUS removed, everything opens under the new key", openSecret(t1.totp_secret_enc) === TOTP && openSecret(t1.pending_secret_enc) === "PENDINGSECRET234" && openSecret(s1) === SSO_SECRET);
  const after = await (await post("/api/admin/rotation/reseal", { secret: ADMIN })).json();
  check("14. a second dry run reports 0 previous everywhere", after.columns.every((c: any) => c.previous === 0), JSON.stringify(after.columns));
  const audit = sqlite.prepare("SELECT entity_label FROM audit_log WHERE entity_type = 'admin.secret_reseal' ORDER BY id DESC LIMIT 1").get();
  check("15. the real re-seal is in the audit log", /re-sealed 3 value/.test(audit?.entity_label || ""), JSON.stringify(audit));

  const reg = await (await post("/api/auth/register", { email: `rotation-${Date.now()}@example.com`, password: "Testpass123", name: "Rotation Test", hipaa_acknowledged: true })).json();
  const me = (tok: string) => fetch(base + "/api/auth/me", { headers: { Authorization: `Bearer ${tok}` } }).then((r) => r.status);
  const payload = jwt.decode(reg.token) as any;
  const { iat, exp, ...claims } = payload || {};
  const forgedOld = jwt.sign(claims, OLD_JWT, { expiresIn: "1h" });
  process.env.MFA_KEY_PREVIOUS = OLD_JWT; // even while the changeover setting is present
  check("16. a session token from the current secret works", (await me(reg.token)) === 200);
  check("17. the same session re-signed with the OLD JWT_SECRET is refused (previous keys never sign anyone in)", (await me(forgedOld)) === 401);

  server.close();
  console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
