// server/eSignature.ts
//
// The one signature check (S0, 2026-11-27; Michael's answer to mock 3 Q2, which applies to all four signature builds: people whose
// domain requires single sign-on sign with their hospital sign-in, asked for again at the moment of signing). Every route that
// records an electronic signature, attestation or review asks verifySigner before it writes:
//  - a typed name (two characters or more) and one credential: the signer's own VeritaAssure password (bcrypt against the
//    server-held hash), or a single-use proof that their hospital's sign-in (server/sso.ts) was just asked for again, fresh, for
//    this purpose and this person (the signature round trip in server/ssoRoutes.ts);
//  - where the signer's email domain requires single sign-on (sso_configs.required) a password can't sign: password reset is off
//    there, so the hospital sign-in is how they sign. Veritas support accounts keep their password, as at sign-in; they never sign
//    for a lab anyway (server/vlsSupport.ts), and can't get a proof;
//  - a wrong password counts toward the account's sign-in lockout exactly as a wrong sign-in password does
//    (server/securityPolicy.ts recordPasswordFailure: one more on failed_login_count, and locked_at set when the owner's
//    lockout_attempts is on and reached); a locked account can't sign with a password, as it can't sign in, and the right
//    password clears the count, as a sign-in does.
// A refusal keeps each route's own status and wording (WORDING), so screens keep working. A signature row records how it was made
// (signed_with 'password' or 'sso', signed_with_provider the hospital's name), so a printout can say "Signed with <hospital>
// sign-in" (shared/eSignature.ts signedWithText).
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { logAudit } from "./audit";
import { clearPasswordFailures, effectivePolicy, isLocked, recordPasswordFailure } from "./securityPolicy";
import { ssoConfigById, ssoConfigForEmail, b64url } from "./sso";
import { SIGN_PROOF_SECONDS, type SignatureMethod, type SignatureMethodInfo, type SignaturePurpose } from "../shared/eSignature";

export interface SignerInput {
  typedName: unknown;
  password?: unknown;
  /** The proof POST /api/auth/signature/sso/complete handed the screen. Used instead of a password when present. */
  ssoProof?: unknown;
  purpose: SignaturePurpose;
}
export interface SignedWith { method: SignatureMethod; provider: string | null }
export interface SignerRefusal { ok: false; status: number; body: { error: string; code?: string } }
export type SignerVerdict = { ok: true; signedWith: SignedWith } | SignerRefusal;

interface Wording { name: string; credential: string; noPassword: string; wrong: string }
// Each route's words from before S0, unchanged.
const POLICY_DECISION: Wording = {
  name: "typedSignature required (full name)",
  credential: "password required for electronic signature",
  noPassword: "User has no password set; cannot sign electronically",
  wrong: "Password incorrect; signature not recorded",
};
// B4 (server/verificationSignatures.ts): the words its routes answered with before the switch to this check.
export const VERIFICATION_WORDING: Wording = {
  name: "Type your full name to sign.",
  credential: "Enter your password to sign. Initials or a name alone are not a signature.",
  noPassword: "User has no password set; cannot sign electronically",
  wrong: "Password incorrect; signature not recorded",
};
const WORDING: Record<SignaturePurpose, Wording> = {
  policy_decision: POLICY_DECISION,
  policy_bulk_approve: POLICY_DECISION,
  policy_recertify: { name: "typedSignature required", credential: "password required", noPassword: "User has no password set", wrong: "Password incorrect; re-certification not recorded" },
  policy_attest: { name: "typedSignature required", credential: "password required for electronic signature", noPassword: "User has no password set", wrong: "Password incorrect; attestation not recorded" },
  maintain_review: { name: "Type your full name to sign", credential: "Enter your password to sign", noPassword: "User has no password set", wrong: "Password incorrect; the review was not signed" },
  verification_plan: VERIFICATION_WORDING,
  verification_package: VERIFICATION_WORDING,
  verification_study: VERIFICATION_WORDING,
  verification_analyte: VERIFICATION_WORDING,
  verification_signoff_group: VERIFICATION_WORDING,
};

export const ACCOUNT_LOCKED_TEXT = "This account is locked after too many wrong passwords. Use Forgot password to set a new one, or ask your lab owner to unlock it.";
export const SIGN_PROOF_INVALID_TEXT = "Your hospital sign-in for this signature expired or was already used. Sign in with your hospital again, then sign.";

const refuse = (status: number, error: string, code?: string): SignerRefusal => ({ ok: false, status, body: code ? { error, code } : { error } });
const hasText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** The typed name and a credential are there. Routes call it where their own checks for those sat, so the order of refusals holds. */
export function signerInputRefusal(input: SignerInput): SignerRefusal | null {
  const w = WORDING[input.purpose];
  const n = input.typedName;
  if (!n || typeof n !== "string" || n.trim().length < 2) return refuse(400, w.name);
  if (!hasText(input.ssoProof) && !hasText(input.password)) return refuse(400, w.credential);
  return null;
}

/** What this person may sign with. */
export function signatureMethodFor(sqlite: any, userId: number): SignatureMethodInfo {
  const u = sqlite.prepare("SELECT email, COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(userId) as any;
  const cfg = u?.email ? ssoConfigForEmail(sqlite, u.email) : null;
  if (!cfg || Number(u?.vls) === 1) return { password: true, sso: null };
  const required = Number(cfg.required) === 1;
  return { password: !required, sso: { name: cfg.name, required } };
}

/**
 * The one check every signature uses: ok with how it was signed, or the refusal the route answers.
 * `ip` is only for the lockout's audit row.
 */
export async function verifySigner(sqlite: any, userId: number, input: SignerInput, ctx: { ip?: string } = {}): Promise<SignerVerdict> {
  const bad = signerInputRefusal(input);
  if (bad) return bad;
  const w = WORDING[input.purpose];
  const user = sqlite.prepare("SELECT id, email, password_hash, COALESCE(vls_support, 0) AS vls FROM users WHERE id = ?").get(userId) as any;
  if (hasText(input.ssoProof)) return spendSignProof(sqlite, user, input.ssoProof, input.purpose);

  if (!user || !user.password_hash) return refuse(401, w.noPassword);
  const cfg = user.email ? ssoConfigForEmail(sqlite, user.email) : null;
  if (cfg && Number(cfg.required) === 1 && Number(user.vls) !== 1) {
    return refuse(403, `Your organization signs with ${cfg.name}. Choose Sign with ${cfg.name} to sign.`, "SSO_SIGN_REQUIRED");
  }
  const policy = effectivePolicy(sqlite, user.id);
  if (isLocked(sqlite, user.id, policy)) return refuse(423, ACCOUNT_LOCKED_TEXT, "ACCOUNT_LOCKED");
  const passwordOk = await bcrypt.compare(String(input.password), user.password_hash);
  if (!passwordOk) {
    if (recordPasswordFailure(sqlite, user.id, policy)) {
      logAudit({ userId: user.id, module: "account", action: "update", entityType: "account.locked", entityLabel: `Locked after ${policy.lockoutAttempts} wrong passwords in a row (the last one at signing)`, ipAddress: ctx.ip });
    }
    return refuse(401, w.wrong);
  }
  clearPasswordFailures(sqlite, user.id);
  return { ok: true, signedWith: { method: "password", provider: null } };
}

/** The two columns a signature row carries for how it was signed. */
export const signedWithValues = (s: SignedWith): [string, string | null] => [s.method, s.method === "sso" ? s.provider : null];

// ── Signing with the hospital's sign-in: one round trip per signature ──────
// signature_sso_requests holds it: who, for what, and through which configuration (written at start); the 60-second handoff code
// the provider's return carries back to the signing window (callback); and the proof that code is traded for by the signer's own
// session (complete), used once by verifySigner within SIGN_PROOF_SECONDS. Codes are stored only as SHA-256 hashes.
export const SIGN_HANDOFF_TTL_MS = 60 * 1000;
export const SIGN_PROOF_TTL_MS = SIGN_PROOF_SECONDS * 1000;
/** The hospital sign-in must have happened within this long, and after the person asked to sign. */
export const SIGN_FRESH_LOGIN_S = 5 * 60;
const KEEP_MS = 24 * 60 * 60 * 1000;
export const WAITER_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function createSignRequest(sqlite: any, o: { userId: number; purpose: SignaturePurpose; configId: number; waiter: string }): number {
  const now = Date.now();
  // delete-reinsert-ok: expiry cleanup of other rows; the INSERT adds a new request
  sqlite.prepare("DELETE FROM signature_sso_requests WHERE created_at < ?").run(new Date(now - KEEP_MS).toISOString());
  const r = sqlite.prepare("INSERT INTO signature_sso_requests (user_id, purpose, config_id, waiter, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(o.userId, o.purpose, o.configId, o.waiter, new Date(now).toISOString());
  return Number(r.lastInsertRowid);
}

export function signRequestById(sqlite: any, id: number): any {
  return sqlite.prepare("SELECT * FROM signature_sso_requests WHERE id = ?").get(id) || null;
}

/** After a fresh hospital sign-in for the right person: the single-use code the signing window hands back. */
export function issueSignHandoff(sqlite: any, requestId: number, o: { providerName: string; authTime: string }): string {
  const code = b64url(crypto.randomBytes(32));
  sqlite.prepare("UPDATE signature_sso_requests SET handoff_hash = ?, handoff_expires_at = ?, provider_name = ?, signed_in_at = ? WHERE id = ?")
    .run(sha(code), new Date(Date.now() + SIGN_HANDOFF_TTL_MS).toISOString(), o.providerName, o.authTime, requestId);
  return code;
}

/** Trades the handoff code for the proof, once, and only for the person who asked. Null when unknown, used, expired or theirs not. */
export function takeSignHandoff(sqlite: any, code: string, userId: number): { proof: string; purpose: string; provider: string | null } | null {
  if (!code) return null;
  const row = sqlite.prepare("SELECT * FROM signature_sso_requests WHERE handoff_hash = ?").get(sha(code)) as any;
  if (!row || row.handed_at || Number(row.user_id) !== Number(userId)) return null;
  if (!row.handoff_expires_at || Date.parse(row.handoff_expires_at) < Date.now()) return null;
  const proof = b64url(crypto.randomBytes(32));
  const spent = sqlite.prepare(
    "UPDATE signature_sso_requests SET handed_at = ?, proof_hash = ?, proof_expires_at = ? WHERE id = ? AND handed_at IS NULL AND user_id = ?"
  ).run(new Date().toISOString(), sha(proof), new Date(Date.now() + SIGN_PROOF_TTL_MS).toISOString(), row.id, userId);
  if (Number(spent?.changes || 0) !== 1) return null;
  return { proof, purpose: row.purpose, provider: row.provider_name ?? null };
}

/** Uses a proof: its own person, its own purpose, not used, not expired, and the configuration still the person's. */
function spendSignProof(sqlite: any, user: any, proof: string, purpose: SignaturePurpose): SignerVerdict {
  const invalid = refuse(401, SIGN_PROOF_INVALID_TEXT, "SIGN_PROOF_INVALID");
  if (!user) return invalid;
  const row = sqlite.prepare("SELECT * FROM signature_sso_requests WHERE proof_hash = ?").get(sha(proof)) as any;
  if (!row || row.used_at || Number(row.user_id) !== Number(user.id) || row.purpose !== purpose) return invalid;
  if (!row.proof_expires_at || Date.parse(row.proof_expires_at) < Date.now()) return invalid;
  const cfg = ssoConfigById(sqlite, Number(row.config_id));
  const current = user.email ? ssoConfigForEmail(sqlite, user.email) : null;
  if (!cfg || Number(cfg.enabled) !== 1 || !current || current.id !== cfg.id) return invalid;
  const spent = sqlite.prepare("UPDATE signature_sso_requests SET used_at = ? WHERE id = ? AND used_at IS NULL").run(new Date().toISOString(), row.id);
  if (Number(spent?.changes || 0) !== 1) return invalid;
  return { ok: true, signedWith: { method: "sso", provider: row.provider_name || cfg.name } };
}
