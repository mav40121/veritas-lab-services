// server/twoFactor.ts
//
// Two-factor sign-in Stage 2 (Michael Q170 = 1, mock Q171 = 1, 2026-10-14; Lifepoint IPS
// III.1(k)/(n)). After the password, a 6-digit code from an authenticator app (server/totp.ts),
// or a 6-digit code emailed to the person (good for 10 minutes), or one of 10 one-time recovery
// codes. "Remember this computer for 30 days" skips the step on a trusted browser unless one of
// the person's labs switched that off (shared computers).
//
// Who must use it: anyone with users.vls_support = 1 (they reach more than one lab), and anyone
// in a lab whose owner turned on labs.mfa_required. Anyone else may turn it on for themselves.
// The public demo sign-in is never asked.
//
// Secrets: the authenticator key is sealed with AES-256-GCM (key derived from MFA_KEY, else
// JWT_SECRET). Recovery codes, emailed codes and remembered-computer tokens are stored only as
// SHA-256 hashes; each is high-entropy or short-lived, and every code check is rate limited
// (10 wrong codes per person per 15 minutes, the same rule as wrong passwords).
import crypto from "crypto";
import { newTotpSecret, verifyTotp } from "./totp";

export const RECOVERY_CODE_COUNT = 10;
export const EMAIL_CODE_TTL_MS = 10 * 60 * 1000;
export const TRUSTED_DEVICE_DAYS = 30;
const CODE_LOCK_MAX = 10;
const CODE_LOCK_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_SEND_MIN_GAP_MS = 30 * 1000;
const EMAIL_SEND_MAX_PER_WINDOW = 5;

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function sealKey(): Buffer {
  return crypto.createHash("sha256").update("veritas-mfa-v1:" + (process.env.MFA_KEY || process.env.JWT_SECRET || "")).digest();
}
export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", sealKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}
export function openSecret(sealed: string | null | undefined): string | null {
  try {
    const [v, iv, tag, ct] = String(sealed || "").split(":");
    if (v !== "v1") return null;
    const d = crypto.createDecipheriv("aes-256-gcm", sealKey(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface MfaRow {
  user_id: number;
  method: "totp" | "email" | null;
  totp_secret_enc: string | null;
  pending_secret_enc: string | null;
  pending_created_at: string | null;
  enabled_at: string | null;
  last_totp_step: number | null;
}

export function getMfa(sqlite: any, userId: number): MfaRow | null {
  return (sqlite.prepare("SELECT * FROM user_mfa WHERE user_id = ?").get(userId) as MfaRow) || null;
}
export const isEnrolled = (row: MfaRow | null) => !!row?.enabled_at;

export interface MfaRequirement {
  required: boolean;
  vlsSupport: boolean;
  requiredBy: { id: number; name: string }[];
  allowRemember: boolean;
}

/** Labs the person works in: owner, active member, active seat, or an active member of the lab's organization. */
function userLabRows(sqlite: any, userId: number): any[] {
  return sqlite.prepare(
    `SELECT DISTINCT l.id, l.lab_name, COALESCE(l.mfa_required, 0) AS req, COALESCE(l.mfa_allow_remember, 1) AS rem
       FROM labs l
      WHERE l.retired_at IS NULL AND (
            l.owner_user_id = ?
         OR l.id IN (SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active')
         OR l.id IN (SELECT lab_id FROM user_seats WHERE seat_user_id = ? AND status = 'active' AND lab_id IS NOT NULL)
         OR (l.organization_id IS NOT NULL AND l.organization_id IN (SELECT organization_id FROM organization_members WHERE user_id = ? AND status = 'active')))`
  ).all(userId, userId, userId, userId) as any[];
}

export function mfaRequirement(sqlite: any, userId: number): MfaRequirement {
  const u = sqlite.prepare("SELECT COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(userId) as any;
  const vlsSupport = Number(u?.vls) === 1;
  const labs = userLabRows(sqlite, userId);
  const requiredBy = labs.filter((l) => Number(l.req) === 1).map((l) => ({ id: Number(l.id), name: String(l.lab_name || "") }));
  return {
    required: vlsSupport || requiredBy.length > 0,
    vlsSupport,
    requiredBy,
    allowRemember: labs.every((l) => Number(l.rem) === 1),
  };
}

// ── Authenticator app ─────────────────────────────────────────────────────
/** Starts (or restarts) setup: a new key held as pending until a code from it is confirmed. */
export function startTotpSetup(sqlite: any, userId: number): string {
  const secret = newTotpSecret();
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO user_mfa (user_id, pending_secret_enc, pending_created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET pending_secret_enc = excluded.pending_secret_enc, pending_created_at = excluded.pending_created_at, updated_at = excluded.updated_at`
  ).run(userId, sealSecret(secret), now, now);
  return secret;
}

/** Confirms the pending key with a code from the app; on success it becomes the person's key. */
export function confirmTotpSetup(sqlite: any, userId: number, code: string): boolean {
  const row = getMfa(sqlite, userId);
  const pending = openSecret(row?.pending_secret_enc);
  if (!pending) return false;
  const step = verifyTotp(pending, code);
  if (step == null) return false;
  const now = new Date().toISOString();
  sqlite.prepare(
    "UPDATE user_mfa SET method = 'totp', totp_secret_enc = ?, pending_secret_enc = NULL, pending_created_at = NULL, enabled_at = ?, last_totp_step = ?, updated_at = ? WHERE user_id = ?"
  ).run(row!.pending_secret_enc, now, step, now, userId);
  return true;
}

export function enableEmailMethod(sqlite: any, userId: number): void {
  const now = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO user_mfa (user_id, method, enabled_at, updated_at) VALUES (?, 'email', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET method = 'email', totp_secret_enc = NULL, pending_secret_enc = NULL, pending_created_at = NULL, enabled_at = excluded.enabled_at, last_totp_step = NULL, updated_at = excluded.updated_at`
  ).run(userId, now, now);
}

/** Checks an authenticator code for an enrolled person; refuses a code already used. */
export function checkTotp(sqlite: any, userId: number, code: string): boolean {
  const row = getMfa(sqlite, userId);
  if (!row?.enabled_at || row.method !== "totp") return false;
  const secret = openSecret(row.totp_secret_enc);
  if (!secret) return false;
  const step = verifyTotp(secret, code, { lastUsedStep: row.last_totp_step });
  if (step == null) return false;
  sqlite.prepare("UPDATE user_mfa SET last_totp_step = ?, updated_at = ? WHERE user_id = ?").run(step, new Date().toISOString(), userId);
  return true;
}

// ── Recovery codes ────────────────────────────────────────────────────────
const RC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
const normRecovery = (c: string) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function newRecoveryCode(): string {
  const b = crypto.randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += RC_ALPHABET[b[i] % RC_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
/** Replaces the person's recovery codes; the plain codes are returned once and never stored. */
export function replaceRecoveryCodes(sqlite: any, userId: number): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const now = new Date().toISOString();
  sqlite.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?").run(userId);
  const ins = sqlite.prepare("INSERT INTO user_mfa_recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)");
  for (const c of codes) ins.run(userId, sha(normRecovery(c)), now);
  return codes;
}
export function useRecoveryCode(sqlite: any, userId: number, code: string): boolean {
  const n = normRecovery(code);
  if (n.length !== 8) return false;
  const row = sqlite.prepare("SELECT id FROM user_mfa_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL").get(userId, sha(n)) as any;
  if (!row) return false;
  sqlite.prepare("UPDATE user_mfa_recovery_codes SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return true;
}
export function recoveryCodesLeft(sqlite: any, userId: number): number {
  return Number((sqlite.prepare("SELECT COUNT(*) AS n FROM user_mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL").get(userId) as any)?.n || 0);
}

// ── Emailed codes ─────────────────────────────────────────────────────────
const emailSends = new Map<number, number[]>();
/** Null when a new code may be sent now, else seconds to wait (30 s apart, 5 per 15 minutes). */
export function emailSendWait(userId: number): number | null {
  const now = Date.now();
  const arr = (emailSends.get(userId) || []).filter((t) => now - t < CODE_LOCK_WINDOW_MS);
  emailSends.set(userId, arr);
  const last = arr[arr.length - 1];
  if (last && now - last < EMAIL_SEND_MIN_GAP_MS) return Math.ceil((EMAIL_SEND_MIN_GAP_MS - (now - last)) / 1000);
  if (arr.length >= EMAIL_SEND_MAX_PER_WINDOW) return Math.ceil((CODE_LOCK_WINDOW_MS - (now - arr[0])) / 1000);
  return null;
}
export function issueEmailCode(sqlite: any, userId: number, purpose: "login" | "setup"): string {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const now = Date.now();
  sqlite.prepare("UPDATE mfa_email_codes SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL").run(new Date(now).toISOString(), userId, purpose);
  sqlite.prepare("INSERT INTO mfa_email_codes (user_id, purpose, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, purpose, sha(`${userId}:${code}`), new Date(now + EMAIL_CODE_TTL_MS).toISOString(), new Date(now).toISOString());
  const arr = emailSends.get(userId) || [];
  arr.push(now);
  emailSends.set(userId, arr);
  return code;
}
export function checkEmailCode(sqlite: any, userId: number, purpose: "login" | "setup", code: string): boolean {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const row = sqlite.prepare(
    "SELECT id, expires_at FROM mfa_email_codes WHERE user_id = ? AND purpose = ? AND code_hash = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1"
  ).get(userId, purpose, sha(`${userId}:${c}`)) as any;
  if (!row || Date.parse(row.expires_at) < Date.now()) return false;
  sqlite.prepare("UPDATE mfa_email_codes SET used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return true;
}

type EmailSender = (to: string, code: string, purpose: "login" | "setup") => Promise<void>;
let emailSender: EmailSender | null = null;
/** routes.ts wires Resend here; the integration test swaps in a capture. */
export function setTwoFactorEmailSender(fn: EmailSender | null): void { emailSender = fn; }
export async function sendEmailCode(to: string, code: string, purpose: "login" | "setup"): Promise<boolean> {
  if (!emailSender) { console.warn(`[two-factor] no email sender configured; code for ${maskEmail(to)} not sent`); return false; }
  try { await emailSender(to, code, purpose); return true; } catch (e: any) { console.error("[two-factor] email send failed:", e?.message || e); return false; }
}

export function maskEmail(email: string): string {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "your email";
  const first = local.slice(0, 1), last = local.length > 1 ? local.slice(-1) : "";
  return `${first}••••${last}@${domain}`;
}

// ── Remember this computer ────────────────────────────────────────────────
export function rememberDevice(sqlite: any, userId: number, req: any): string {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  sqlite.prepare("INSERT INTO mfa_trusted_devices (user_id, token_hash, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(userId, sha(token), String(req?.headers?.["user-agent"] || "").slice(0, 300), new Date(now).toISOString(), new Date(now + TRUSTED_DEVICE_DAYS * 86_400_000).toISOString());
  return token;
}
export function deviceTrusted(sqlite: any, userId: number, token: unknown): boolean {
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return false;
  const row = sqlite.prepare("SELECT expires_at FROM mfa_trusted_devices WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL").get(userId, sha(token)) as any;
  return !!row && Date.parse(row.expires_at) > Date.now();
}
export function forgetDevices(sqlite: any, userId: number): number {
  return Number(sqlite.prepare("UPDATE mfa_trusted_devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), userId)?.changes || 0);
}

// ── Wrong-code limiter (10 per person per 15 minutes) ─────────────────────
const codeFailures = new Map<number, { count: number; resetAt: number }>();
export function codeLockWait(userId: number): number | null {
  const e = codeFailures.get(userId);
  if (!e) return null;
  if (e.resetAt <= Date.now()) { codeFailures.delete(userId); return null; }
  return e.count >= CODE_LOCK_MAX ? Math.ceil((e.resetAt - Date.now()) / 1000) : null;
}
export function recordCodeFailure(userId: number): void {
  const now = Date.now();
  const e = codeFailures.get(userId);
  if (!e || e.resetAt <= now) codeFailures.set(userId, { count: 1, resetAt: now + CODE_LOCK_WINDOW_MS });
  else e.count += 1;
}
export function clearCodeFailures(userId: number): void { codeFailures.delete(userId); }

/** Clears the person's two-factor entirely (lab owner or Veritas reset); they set it up again at next sign-in. */
export function resetTwoFactor(sqlite: any, userId: number): void {
  sqlite.prepare("DELETE FROM user_mfa WHERE user_id = ?").run(userId);
  sqlite.prepare("DELETE FROM user_mfa_recovery_codes WHERE user_id = ?").run(userId);
  sqlite.prepare("UPDATE mfa_email_codes SET used_at = ? WHERE user_id = ? AND used_at IS NULL").run(new Date().toISOString(), userId);
  forgetDevices(sqlite, userId);
}
