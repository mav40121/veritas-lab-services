// server/securityPolicy.ts
//
// System security settings (Michael Q27 = 1, 2026-10-25). Built so a health system can hold
// VeritaAssure to its own access rules (Lifepoint TRB Vendor Questionnaire Q53, Q55-Q57, Q59, Q65;
// Lifepoint IPS III.1(k) asks for password expiry at least every 180 days):
//   idle_minutes          sign a session out after this many minutes without activity
//   password_expiry_days  a password older than this must be changed at the next sign-in
//   password_history      a new password may not match the current one or the last N
//   lockout_attempts      this many wrong passwords in a row locks the account until a reset or an owner unlocks it
//   inactive_days         an account with no sign-in for this long is turned off until an owner turns it back on
//   require_symbol        new passwords must include a symbol (on top of the 8-character, 3-of-4 rule)
//
// Who sets them: a system owner, in Account settings. Their row covers every lab they own and every lab
// in an organization they are billing owner of (the same reach as the two-factor system switch, see
// server/twoFactor.ts). A person in labs of more than one system gets the strictest value of each.
// Every setting is off until an owner turns it on, so nothing changes for anyone else.
//
// Not covered: the public demo sign-in, scripts' service tokens, and single sign-on sign-ins for the
// password rules (the customer's identity provider governs those). Veritas support accounts are never
// turned off for inactivity.
import bcrypt from "bcryptjs";
import { passwordProblem } from "@shared/passwordRule";

export interface SecuritySettings {
  idleMinutes: number | null;
  passwordExpiryDays: number | null;
  passwordHistory: number | null;
  lockoutAttempts: number | null;
  inactiveDays: number | null;
  requireSymbol: boolean;
}

export interface EffectivePolicy extends SecuritySettings {
  /** Owners whose settings apply to this person. */
  ownerIds: number[];
}

export const OFF: SecuritySettings = {
  idleMinutes: null, passwordExpiryDays: null, passwordHistory: null, lockoutAttempts: null, inactiveDays: null, requireSymbol: false,
};

/** Allowed ranges; the settings card offers a few common values inside them. */
export const LIMITS: Record<keyof Omit<SecuritySettings, "requireSymbol">, [number, number]> = {
  idleMinutes: [5, 480],
  passwordExpiryDays: [30, 365],
  passwordHistory: [1, 24],
  lockoutAttempts: [3, 20],
  inactiveDays: [30, 730],
};

const HISTORY_KEEP = 24;
const CACHE_MS = 60_000;
const cache = new Map<number, { at: number; policy: EffectivePolicy }>();
export function clearPolicyCache(): void {
  cache.clear();
}

const num = (v: any): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function rowToSettings(r: any): SecuritySettings {
  if (!r) return { ...OFF };
  return {
    idleMinutes: num(r.idle_minutes),
    passwordExpiryDays: num(r.password_expiry_days),
    passwordHistory: num(r.password_history),
    lockoutAttempts: num(r.lockout_attempts),
    inactiveDays: num(r.inactive_days),
    requireSymbol: Number(r.require_symbol) === 1,
  };
}

/** The strictest combination: the shortest time limits and lockout, the longest history, a symbol if any asks. */
export function strictest(list: SecuritySettings[]): SecuritySettings {
  const minOf = (k: keyof SecuritySettings) => {
    const v = list.map((s) => s[k]).filter((x): x is number => typeof x === "number" && x > 0);
    return v.length ? Math.min(...v) : null;
  };
  const maxOf = (k: keyof SecuritySettings) => {
    const v = list.map((s) => s[k]).filter((x): x is number => typeof x === "number" && x > 0);
    return v.length ? Math.max(...v) : null;
  };
  return {
    idleMinutes: minOf("idleMinutes"),
    passwordExpiryDays: minOf("passwordExpiryDays"),
    passwordHistory: maxOf("passwordHistory"),
    lockoutAttempts: minOf("lockoutAttempts"),
    inactiveDays: minOf("inactiveDays"),
    requireSymbol: list.some((s) => s.requireSymbol),
  };
}

/** An owner's own settings (what their Account settings card shows). */
export function getOwnerSettings(sqlite: any, ownerId: number): SecuritySettings & { updatedAt: string | null } {
  const r = sqlite.prepare("SELECT * FROM system_security_settings WHERE owner_user_id = ?").get(ownerId) as any;
  return { ...rowToSettings(r), updatedAt: r?.updated_at || null };
}

/** Checks and normalizes a settings payload. Returns the clean settings or the first problem. */
export function validateSettings(body: any): { ok: true; settings: SecuritySettings } | { ok: false; error: string } {
  const out: SecuritySettings = { ...OFF };
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const raw = body?.[k];
    if (raw === null || raw === undefined || raw === "" || raw === 0 || raw === "0" || raw === false) { (out as any)[k] = null; continue; }
    const n = Number(raw);
    const [lo, hi] = LIMITS[k];
    if (!Number.isInteger(n) || n < lo || n > hi) return { ok: false, error: `${k} must be off or a whole number from ${lo} to ${hi}.` };
    (out as any)[k] = n;
  }
  out.requireSymbol = body?.requireSymbol === true;
  return { ok: true, settings: out };
}

export function saveOwnerSettings(sqlite: any, ownerId: number, s: SecuritySettings, byUserId: number): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO system_security_settings (owner_user_id, idle_minutes, password_expiry_days, password_history, lockout_attempts, inactive_days, require_symbol, updated_at, updated_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_user_id) DO UPDATE SET idle_minutes = excluded.idle_minutes, password_expiry_days = excluded.password_expiry_days,
       password_history = excluded.password_history, lockout_attempts = excluded.lockout_attempts, inactive_days = excluded.inactive_days,
       require_symbol = excluded.require_symbol, updated_at = excluded.updated_at, updated_by_user_id = excluded.updated_by_user_id`
  ).run(ownerId, s.idleMinutes, s.passwordExpiryDays, s.passwordHistory, s.lockoutAttempts, s.inactiveDays, s.requireSymbol ? 1 : 0, now, byUserId);
  clearPolicyCache();
}

/** The labs a person works in (owner, active member, active seat, organization member), as a SQL condition on alias l. */
const USER_LABS = `l.retired_at IS NULL AND (
      l.owner_user_id = @u
   OR l.id IN (SELECT lab_id FROM lab_members WHERE user_id = @u AND status = 'active')
   OR l.id IN (SELECT lab_id FROM user_seats WHERE seat_user_id = @u AND status = 'active' AND lab_id IS NOT NULL)
   OR (l.organization_id IS NOT NULL AND l.organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = @u AND status = 'active')))`;

/** Settings that apply to a person: the strictest across the system owners of every lab they work in. Cached 60 s. */
export function effectivePolicy(sqlite: any, userId: number): EffectivePolicy {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.policy;
  let rows: any[] = [];
  try {
    rows = sqlite.prepare(
      `SELECT s.* FROM system_security_settings s
        WHERE s.owner_user_id IN (
              SELECT l.owner_user_id FROM labs l WHERE ${USER_LABS}
              UNION
              SELECT o.billing_owner_user_id FROM labs l JOIN organizations o ON o.id = l.organization_id WHERE ${USER_LABS})`
    ).all({ u: userId }) as any[];
  } catch {
    rows = [];
  }
  const policy: EffectivePolicy = { ...strictest(rows.map(rowToSettings)), ownerIds: rows.map((r) => Number(r.owner_user_id)) };
  cache.set(userId, { at: Date.now(), policy });
  if (cache.size > 20000) cache.clear();
  return policy;
}

/** Settings that apply to anyone joining a lab (a new account accepting an invite to it). */
export function policyForLab(sqlite: any, labId: number): SecuritySettings {
  try {
    const rows = sqlite.prepare(
      `SELECT s.* FROM system_security_settings s, labs l
        WHERE l.id = ? AND (s.owner_user_id = l.owner_user_id
           OR s.owner_user_id IN (SELECT o.billing_owner_user_id FROM organizations o WHERE o.id = l.organization_id))`
    ).all(labId) as any[];
    return strictest(rows.map(rowToSettings));
  } catch {
    return { ...OFF };
  }
}

// ── Passwords ───────────────────────────────────────────────────────────
export const SYMBOL_RULE_TEXT = "Your organization also requires a symbol (for example ! # $ or %).";

/** The password rule plus the organization's symbol requirement. Null when the password is acceptable. */
export function passwordProblemFor(policy: Pick<SecuritySettings, "requireSymbol">, pw: unknown): string | null {
  const base = passwordProblem(pw);
  if (base) return base;
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(String(pw))) return "Password must include a symbol (for example ! # $ or %).";
  return null;
}

/** True when the password matches the current one or one of the last `generations` passwords. */
export async function isReusedPassword(sqlite: any, userId: number, pw: string, generations: number): Promise<boolean> {
  if (!generations || generations < 1) return false;
  const current = (sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as any)?.password_hash;
  const past = (sqlite.prepare("SELECT password_hash FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, generations) as any[]).map((r) => r.password_hash);
  const hashes = Array.from(new Set([current, ...past].filter(Boolean)));
  for (const h of hashes) {
    try { if (await bcrypt.compare(pw, h)) return true; } catch { /* unreadable hash */ }
  }
  return false;
}

/**
 * Sets a person's password after checking the rule, the organization's symbol rule and password history.
 * Records the change (password_changed_at, history) and clears any lockout. Every place that sets a
 * known password goes through here; scripts/verify-security-settings.mts fails if another UPDATE of
 * users.password_hash appears in server/.
 */
export async function setUserPassword(
  sqlite: any,
  userId: number,
  pw: string,
  opts: { policy?: SecuritySettings } = {},
): Promise<{ ok: true } | { ok: false; error: string; code: "PASSWORD_RULE" | "PASSWORD_REUSED" }> {
  const policy = opts.policy || effectivePolicy(sqlite, userId);
  const problem = passwordProblemFor(policy, pw);
  if (problem) return { ok: false, error: problem, code: "PASSWORD_RULE" };
  if (policy.passwordHistory && (await isReusedPassword(sqlite, userId, pw, policy.passwordHistory))) {
    return { ok: false, error: `Choose a password you haven't used recently. Your organization blocks your last ${policy.passwordHistory} passwords.`, code: "PASSWORD_REUSED" };
  }
  const hash = await bcrypt.hash(pw, 10);
  const now = new Date().toISOString();
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE users SET password_hash = ?, password_changed_at = ?, failed_login_count = 0, locked_at = NULL WHERE id = ?").run(hash, now, userId);
    sqlite.prepare("INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)").run(userId, hash, now);
    sqlite.prepare(
      `DELETE FROM password_history WHERE user_id = ? AND id NOT IN (SELECT id FROM password_history WHERE user_id = ? ORDER BY id DESC LIMIT ${HISTORY_KEEP})`
    ).run(userId, userId);
  })();
  return { ok: true };
}

/** Records a new account's first password (register / invite accept) so expiry and history start from it. */
export function recordNewPassword(sqlite: any, userId: number): void {
  try {
    const row = sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as any;
    const now = new Date().toISOString();
    sqlite.prepare("UPDATE users SET password_changed_at = ? WHERE id = ?").run(now, userId);
    if (row?.password_hash) sqlite.prepare("INSERT INTO password_history (user_id, password_hash, created_at) VALUES (?, ?, ?)").run(userId, row.password_hash, now);
  } catch { /* never block account creation over the history stamp */ }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True when the person's password is older than the expiry the policy sets. */
export function passwordExpired(sqlite: any, userId: number, policy: SecuritySettings, now = Date.now()): boolean {
  if (!policy.passwordExpiryDays) return false;
  const r = sqlite.prepare("SELECT password_changed_at, created_at FROM users WHERE id = ?").get(userId) as any;
  const since = Date.parse(r?.password_changed_at || r?.created_at || "");
  if (!Number.isFinite(since)) return true;
  return now - since > policy.passwordExpiryDays * DAY_MS;
}

// ── Lockout ─────────────────────────────────────────────────────────────
export function isLocked(sqlite: any, userId: number, policy: SecuritySettings): boolean {
  if (!policy.lockoutAttempts) return false;
  const r = sqlite.prepare("SELECT locked_at FROM users WHERE id = ?").get(userId) as any;
  return !!r?.locked_at;
}

/** Counts a wrong password; locks the account when the policy's limit is reached. Returns true when it just locked. */
export function recordPasswordFailure(sqlite: any, userId: number, policy: SecuritySettings): boolean {
  try {
    sqlite.prepare("UPDATE users SET failed_login_count = COALESCE(failed_login_count, 0) + 1 WHERE id = ?").run(userId);
    if (!policy.lockoutAttempts) return false;
    const r = sqlite.prepare("SELECT failed_login_count, locked_at FROM users WHERE id = ?").get(userId) as any;
    if (!r?.locked_at && Number(r?.failed_login_count) >= policy.lockoutAttempts) {
      sqlite.prepare("UPDATE users SET locked_at = ? WHERE id = ?").run(new Date().toISOString(), userId);
      return true;
    }
  } catch { /* the IP limiter still applies */ }
  return false;
}

export function clearPasswordFailures(sqlite: any, userId: number): void {
  try { sqlite.prepare("UPDATE users SET failed_login_count = 0 WHERE id = ? AND COALESCE(failed_login_count, 0) <> 0").run(userId); } catch {}
}

// ── Inactive accounts ───────────────────────────────────────────────────
/** When the person last signed in (or was turned back on, or was created), as ms. */
export function lastActivityMs(sqlite: any, userId: number): number | null {
  const r = sqlite.prepare(
    `SELECT u.last_sign_in_at, u.reenabled_at, u.created_at,
            (SELECT MAX(created_at) FROM user_sessions s WHERE s.user_id = u.id) AS last_session
       FROM users u WHERE u.id = ?`
  ).get(userId) as any;
  const t = [r?.last_sign_in_at, r?.reenabled_at, r?.last_session, r?.created_at].map((x) => Date.parse(x || "")).filter(Number.isFinite);
  return t.length ? Math.max(...t) : null;
}

/** True when the account has been turned off for inactivity under the policy. Veritas support accounts never are. */
export function isInactive(sqlite: any, userId: number, policy: SecuritySettings, now = Date.now()): boolean {
  if (!policy.inactiveDays) return false;
  const vls = Number((sqlite.prepare("SELECT COALESCE(vls_support, 0) AS v FROM users WHERE id = ?").get(userId) as any)?.v) === 1;
  if (vls) return false;
  const last = lastActivityMs(sqlite, userId);
  if (last == null) return false;
  return now - last > policy.inactiveDays * DAY_MS;
}

/** Owner action: unlock and turn the account back on (clears the lockout, restarts the inactivity clock). */
export function reenableAccount(sqlite: any, userId: number): void {
  sqlite.prepare("UPDATE users SET locked_at = NULL, failed_login_count = 0, reenabled_at = ? WHERE id = ?").run(new Date().toISOString(), userId);
  cache.delete(userId);
}

/** Stamps a successful sign-in (every session goes through issueSession). */
export function stampSignIn(sqlite: any, userId: number): void {
  try { sqlite.prepare("UPDATE users SET last_sign_in_at = ?, failed_login_count = 0 WHERE id = ?").run(new Date().toISOString(), userId); } catch {}
}
