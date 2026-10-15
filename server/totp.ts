// server/totp.ts
//
// Authenticator-app codes for two-factor sign-in Stage 2 (Michael Q170 = 1, mock Q171 = 1,
// 2026-10-14). RFC 6238 TOTP: HMAC-SHA1, 30-second steps, 6 digits, the format Microsoft
// Authenticator, Google Authenticator and similar apps use by default. Built on Node's crypto
// so no third-party code sits in the sign-in path. Checked against the RFC 6238 Appendix B
// vectors in scripts/verify-two-factor.mts.
import crypto from "crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = String(s || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 (32 characters), as RFC 4226 recommends. */
export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secretB32: string, counter: number, digits = TOTP_DIGITS): string {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export function totpStep(timeMs: number = Date.now()): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpAt(secretB32: string, timeMs: number = Date.now(), digits = TOTP_DIGITS): string {
  return hotp(secretB32, totpStep(timeMs), digits);
}

/**
 * Checks a 6-digit code against the current step and one step either side (phone clocks
 * drift). Returns the matched step, or null. A step at or before `lastUsedStep` is refused,
 * so a code cannot be replayed.
 */
export function verifyTotp(secretB32: string, code: string, opts: { timeMs?: number; window?: number; lastUsedStep?: number | null } = {}): number | null {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const now = totpStep(opts.timeMs ?? Date.now());
  const w = opts.window ?? 1;
  for (let s = now - w; s <= now + w; s++) {
    if (opts.lastUsedStep != null && s <= opts.lastUsedStep) continue;
    const expect = hotp(secretB32, s);
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(c))) return s;
  }
  return null;
}

/** otpauth:// link the authenticator app reads from the QR code. */
export function otpauthUrl(secretB32: string, account: string, issuer = "VeritaAssure"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

/** "JBSW Y3DP EHPK 3PXP ..." for typing the key by hand. */
export function groupKey(secretB32: string): string {
  return secretB32.replace(/(.{4})/g, "$1 ").trim();
}
