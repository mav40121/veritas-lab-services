// server/sessionAuth.ts
//
// Sign-in sessions: two-factor sign-in Stage 1 (Michael Q170 = 1 and mock Q171 = 1,
// 2026-10-14; Lifepoint IPS III.1(k)/(n)). Before this, a sign-in token was a bare
// { userId } JWT good for 30 days, and nothing on later requests looked at
// user_sessions, so "Sign out", the login force-logout, a password change and the
// admin kill switch flipped a row while the token kept working everywhere.
//
// Now every token the server hands a browser names its session (`sid` =
// user_sessions.session_token) and every request checks that the row is still
// active. Ending the row ends the token at once.
//
// Token kinds checkAuthToken accepts:
//   session  { userId, sid }       issued by issueSession; dies with its row
//   demo     { userId, isDemo }    the public VeritaStock demo (8h, no row, unchanged)
//   service  { userId, svc } or { userId, ci_sandbox }   minted with JWT_SECRET by our
//            own scripts and the CI sandbox receipts; the server never issues these
//            to a browser, so only a JWT_SECRET holder can make one
//   legacy   { userId } issued before LEGACY_TOKEN_CUTOFF_MS: kept only while the
//            person still has an active session row, so signing out or a password
//            change ends them too. All expire by 2026-11-16; remove the branch then.
// A token with a `purpose` (the post-password "conflict" step) opens nothing but the
// route built for it.
//
// Every place that reads a bearer token goes through checkAuthToken or
// verifySessionJwt; scripts/verify-session-signout.mts fails if any other file in
// server/ calls jwt.verify.
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { effectivePolicy, stampSignIn } from "./securityPolicy";

export const SESSION_TOKEN_TTL = "30d";
export const LEGACY_TOKEN_CUTOFF_MS = Date.UTC(2026, 9, 17, 0, 0, 0);
const PURPOSE_TOKEN_TTL = "10m";
const TOUCH_INTERVAL_MS = 60_000;

export type TokenKind = "session" | "legacy" | "service" | "demo";
export type TokenCheck =
  | { ok: true; userId: number; sid: string | null; kind: TokenKind; isDemo: boolean }
  | { ok: false; code: "invalid" | "session_ended" | "not_a_session"; reason?: "idle"; idleMinutes?: number };

function secret(): string {
  return process.env.JWT_SECRET!;
}

export function checkAuthToken(sqlite: any, raw: string): TokenCheck {
  let p: any;
  try {
    p = jwt.verify(raw, secret());
  } catch {
    return { ok: false, code: "invalid" };
  }
  const userId = Number(p?.userId);
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false, code: "invalid" };
  if (p.purpose) return { ok: false, code: "not_a_session" };
  if (p.isDemo === true) return { ok: true, userId, sid: null, kind: "demo", isDemo: true };
  if (typeof p.sid === "string" && p.sid) {
    const row = sqlite
      .prepare("SELECT is_active, last_active FROM user_sessions WHERE session_token = ? AND user_id = ?")
      .get(p.sid, userId) as { is_active: number; last_active: string | null } | undefined;
    if (row && Number(row.is_active) === 1) {
      // System security settings (server/securityPolicy.ts): a session idle longer than the owner's
      // limit ends here. last_active is stamped at most once a minute (touchSession), so the limit
      // can fire up to a minute early, never late. The browser's own idle timer usually acts first.
      const idle = effectivePolicy(sqlite, userId).idleMinutes;
      const last = Date.parse(row.last_active || "");
      if (idle && Number.isFinite(last) && Date.now() - last > idle * 60_000) {
        endSessions(sqlite, userId, { reason: "idle", onlySid: p.sid });
        return { ok: false, code: "session_ended", reason: "idle", idleMinutes: idle };
      }
      return { ok: true, userId, sid: p.sid, kind: "session", isDemo: false };
    }
    return { ok: false, code: "session_ended" };
  }
  if (p.svc === true || p.ci_sandbox === true) return { ok: true, userId, sid: null, kind: "service", isDemo: false };
  const iatMs = Number(p.iat) * 1000;
  if (Number.isFinite(iatMs) && iatMs < LEGACY_TOKEN_CUTOFF_MS) {
    const active = sqlite.prepare("SELECT 1 FROM user_sessions WHERE user_id = ? AND is_active = 1 LIMIT 1").get(userId);
    if (active) return { ok: true, userId, sid: null, kind: "legacy", isDemo: false };
  }
  return { ok: false, code: "session_ended" };
}

/** Drop-in for the old inline `jwt.verify(token, JWT_SECRET)`: same shape, throws when the token is bad or its session has ended. */
export function verifySessionJwt(sqlite: any, raw: string): { userId: number; isDemo?: boolean; sid?: string } {
  const c = checkAuthToken(sqlite, raw);
  if (!c.ok) throw new Error(c.code);
  return { userId: c.userId, isDemo: c.isDemo || undefined, sid: c.sid ?? undefined };
}

export function clientIp(req: any): string | null {
  const fwd = req?.headers?.["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : String(fwd || "").split(",")[0]).trim();
  return ip || req?.ip || req?.socket?.remoteAddress || null;
}

/** Creates an active user_sessions row and the token bound to it. Every browser sign-in goes through here. */
export function issueSession(sqlite: any, userId: number, req: any, opts: { mfaMethod?: string | null } = {}): { token: string; sessionToken: string } {
  const sessionToken = crypto.randomUUID();
  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO user_sessions (user_id, session_token, device_info, created_at, last_active, is_active, ip_address, mfa_method) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    )
    .run(userId, sessionToken, req?.headers?.["user-agent"] || "Unknown", now, now, clientIp(req), opts.mfaMethod ?? null);
  stampSignIn(sqlite, userId);
  const token = jwt.sign({ userId, sid: sessionToken }, secret(), { expiresIn: SESSION_TOKEN_TTL });
  return { token, sessionToken };
}

/**
 * Ends sessions for a person. `onlySid` / `onlyId` end one session; otherwise all of
 * them, except `exceptSid` when given. Returns how many rows were ended.
 */
export function endSessions(
  sqlite: any,
  userId: number,
  opts: { reason: string; exceptSid?: string | null; onlySid?: string | null; onlyId?: number | null }
): number {
  const now = new Date().toISOString();
  const where: string[] = ["user_id = ?", "is_active = 1"];
  const args: any[] = [userId];
  if (opts.onlySid) { where.push("session_token = ?"); args.push(opts.onlySid); }
  if (opts.onlyId != null) { where.push("id = ?"); args.push(opts.onlyId); }
  if (opts.exceptSid) { where.push("session_token <> ?"); args.push(opts.exceptSid); }
  const r = sqlite
    .prepare(`UPDATE user_sessions SET is_active = 0, ended_at = ?, ended_reason = ? WHERE ${where.join(" AND ")}`)
    .run(now, opts.reason, ...args);
  for (const k of Array.from(lastTouch.keys())) if (!opts.onlySid || k === opts.onlySid) lastTouch.delete(k);
  return Number(r?.changes || 0);
}

const lastTouch = new Map<string, number>();
/** Keeps last_active current for the Signed-in devices list without a write on every request. */
export function touchSession(sqlite: any, sid: string | null): void {
  if (!sid) return;
  const now = Date.now();
  const prev = lastTouch.get(sid) || 0;
  if (now - prev < TOUCH_INTERVAL_MS) return;
  lastTouch.set(sid, now);
  if (lastTouch.size > 20000) lastTouch.clear();
  try {
    sqlite.prepare("UPDATE user_sessions SET last_active = ? WHERE session_token = ? AND is_active = 1").run(new Date(now).toISOString(), sid);
  } catch { /* never fail a request over the activity stamp */ }
}

/** Short-lived token for one step of signing in (e.g. "conflict": sign the other device out). Opens no other route. */
export function issuePurposeToken(userId: number, purpose: string, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ ...extra, userId, purpose }, secret(), { expiresIn: PURPOSE_TOKEN_TTL });
}

export function verifyPurposeToken(raw: string, purpose: string): { userId: number; [k: string]: any } | null {
  try {
    const p: any = jwt.verify(raw, secret());
    if (p?.purpose !== purpose) return null;
    const userId = Number(p.userId);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return { ...p, userId };
  } catch {
    return null;
  }
}

/** "Chrome on Windows" from a user-agent string, for the Signed-in devices list. */
export function describeDevice(ua: string | null | undefined): string {
  const s = String(ua || "");
  if (!s || s === "Unknown") return "Unknown device";
  const browser = /Edg\//.test(s) ? "Edge"
    : /OPR\//.test(s) ? "Opera"
    : /Firefox\//.test(s) ? "Firefox"
    : /Chrome\//.test(s) || /CriOS\//.test(s) ? "Chrome"
    : /Safari\//.test(s) ? "Safari"
    : /node|undici|curl|python|axios/i.test(s) ? "Script"
    : "Browser";
  const os = /iPhone/.test(s) ? "iPhone"
    : /iPad/.test(s) ? "iPad"
    : /Android/.test(s) ? "Android"
    : /Windows/.test(s) ? "Windows"
    : /Mac OS X|Macintosh/.test(s) ? "Mac"
    : /Linux/.test(s) ? "Linux"
    : "";
  return os ? `${browser} on ${os}` : browser;
}
