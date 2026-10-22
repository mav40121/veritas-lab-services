// Secret rotation support (Railway environment-variable disclosure, 2026-10-21; Michael Q4 = 2: rotate every
// secret the moment Railway's API returns).
//
// Values sealed with the MFA seal key (twoFactor.ts sealSecret: authenticator keys, pending enrollments, SSO
// client secrets) cannot be opened after MFA_KEY / JWT_SECRET changes. With MFA_KEY_PREVIOUS set to the old seal
// source they still open (openSecret falls back), and resealAll() re-seals each one under the current key, so
// MFA_KEY_PREVIOUS can then be removed. Recovery codes, emailed codes and remembered-computer tokens are stored as
// plain SHA-256 hashes, not sealed, so a rotation does not touch them.
//
// Rotation order (see the PR): deploy this code, then set MFA_KEY_PREVIOUS (old seal source) and
// UNSUBSCRIBE_SECRET_PREVIOUS (old JWT_SECRET) with the new MFA_KEY / JWT_SECRET / ADMIN_SECRET, redeploy,
// run POST /api/admin/rotation/reseal with dryRun:false, confirm "previous" is 0 everywhere, then remove
// MFA_KEY_PREVIOUS.
import { sealSecret, openSecret, sealedKeyStatus } from "./twoFactor";

export const SEALED_COLUMNS = [
  { table: "user_mfa", column: "totp_secret_enc", key: "user_id" },
  { table: "user_mfa", column: "pending_secret_enc", key: "user_id" },
  { table: "sso_configs", column: "client_secret_enc", key: "id" },
] as const;

export interface ResealCount {
  table: string;
  column: string;
  current: number;
  previous: number;
  unreadable: number;
  empty: number;
  resealed: number;
}

/** Count (and unless dryRun, re-seal) every sealed value that only the previous key opens. Never returns a secret. */
export function resealAll(sqlite: any, dryRun = true): { dryRun: boolean; previousKeySet: boolean; columns: ResealCount[] } {
  const columns: ResealCount[] = [];
  const run = () => {
    for (const { table, column, key } of SEALED_COLUMNS) {
      const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      const c: ResealCount = { table, column, current: 0, previous: 0, unreadable: 0, empty: 0, resealed: 0 };
      if (exists) {
        const rows = sqlite.prepare(`SELECT ${key} AS k, ${column} AS v FROM ${table}`).all() as { k: number; v: string | null }[];
        const update = sqlite.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${key} = ?`);
        for (const r of rows) {
          const status = sealedKeyStatus(r.v);
          c[status]++;
          if (status === "previous" && !dryRun) {
            const plain = openSecret(r.v);
            if (plain !== null) {
              update.run(sealSecret(plain), r.k);
              c.resealed++;
            }
          }
        }
      }
      columns.push(c);
    }
  };
  if (dryRun) run();
  else sqlite.transaction(run)();
  return { dryRun, previousKeySet: !!process.env.MFA_KEY_PREVIOUS, columns };
}
