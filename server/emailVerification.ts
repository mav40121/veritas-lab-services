// Email verification at sign-up (Michael 2026-11-05). A public sign-up makes an account that can't sign in until its owner
// confirms the address through an emailed link. Opening the link isn't enough: the person enters the password they chose, so
// someone who signs up with another person's address can't have that person's click turn on an account whose password the
// sign-up holds. An unconfirmed account holds no address: signing up again, or using an invitation's link, replaces it, and
// an invite to that address stays pending instead of attaching to it. Accounts from before this, invitation sign-ups, single
// sign-on and a password reset all count as confirmed, because each proved the address another way.
//   Off with no email provider (local builds and CI), since no link could arrive. EMAIL_VERIFICATION=on or off overrides.
import crypto from "crypto";
import type { Express } from "express";
import bcrypt from "bcryptjs";

const LINK_LIFE_MS = 24 * 60 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;

export function emailVerificationOn(): boolean {
  if (process.env.EMAIL_VERIFICATION === "on") return true;
  if (process.env.EMAIL_VERIFICATION === "off") return false;
  return !!process.env.RESEND_API_KEY;
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export function isUnconfirmed(sqlite: any, userId: number): boolean {
  return Number((sqlite.prepare("SELECT COALESCE(email_verification_pending, 0) AS p FROM users WHERE id = ?").get(userId) as any)?.p) === 1;
}

// The account at this address, unless it's an unconfirmed sign-up, which holds no claim to the address.
export function confirmedUserByEmail<T extends { id: number }>(sqlite: any, storage: { getUserByEmail(email: string): T | undefined }, email: string): T | undefined {
  const user = storage.getUserByEmail(email);
  return user && !isUnconfirmed(sqlite, user.id) ? user : undefined;
}

export function startEmailVerification(sqlite: any, userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  sqlite.prepare("UPDATE users SET email_verification_pending = 1, email_verification_token_hash = ?, email_verification_expires_at = ?, email_verification_sent_at = ? WHERE id = ?")
    .run(hashToken(token), new Date(Date.now() + LINK_LIFE_MS).toISOString(), new Date().toISOString(), userId);
  return token;
}

export function clearEmailVerification(sqlite: any, userId: number): void {
  sqlite.prepare("UPDATE users SET email_verification_pending = 0, email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE id = ?").run(userId);
}

export async function sendVerificationEmail(resend: any, frontendUrl: string, to: string, token: string): Promise<boolean> {
  if (!resend) return false;
  const link = `${frontendUrl}/verify-email?token=${token}`;
  try {
    const r = await resend.emails.send({
      from: "VeritaAssure® <info@veritaslabservices.com>",
      to,
      subject: "Confirm your email for VeritaAssure®",
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#01696F">VeritaAssure®</h2>
          <p style="font-size:15px;color:#1B2B2B;line-height:1.6">Thanks for creating an account. Confirm your email address to start using it. You'll be asked for the password you just chose.</p>
          <a href="${link}" style="display:inline-block;background:#01696F;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin:8px 0">Confirm my email</a>
          <p style="font-size:13px;color:#6B7280;margin-top:16px">This link expires in 24 hours. If you didn't create an account, you can ignore this email and nothing will happen.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
          <p style="color:#999;font-size:12px">VeritaAssure® | Veritas Lab Services, LLC<br/>veritaslabservices.com</p>
        </div>`,
    });
    return !r?.error;
  } catch (err: any) {
    console.error("[email-verification] send failed:", err?.message);
    return false;
  }
}

interface Deps {
  sqlite: any;
  storage: { getUserByEmail(email: string): any };
  resend: any;
  frontendUrl: string;
  checkLoginRate(key: string): { blocked: boolean; retryAfterSec?: number };
  recordLoginFailure(key: string): void;
  clearLoginRate(key: string): void;
}

export function registerEmailVerificationRoutes(app: Express, deps: Deps): void {
  const { sqlite, storage, resend, frontendUrl, checkLoginRate, recordLoginFailure, clearLoginRate } = deps;

  // POST /api/auth/verify-email { token, password }. The link and the password chosen at sign-up, together.
  app.post("/api/auth/verify-email", async (req: any, res: any) => {
    const token = String(req.body?.token || "");
    const password = String(req.body?.password || "");
    if (!token || !password) return res.status(400).json({ error: "Enter your password to confirm your email." });
    const rateKey = `verify:${req.ip}:${hashToken(token).slice(0, 16)}`;
    const rate = checkLoginRate(rateKey);
    if (rate.blocked) {
      res.setHeader("Retry-After", String(rate.retryAfterSec ?? 60));
      return res.status(429).json({ error: "Too many tries. Please wait and try again." });
    }
    const row = sqlite.prepare("SELECT id, password_hash, email_verification_expires_at AS expires FROM users WHERE email_verification_token_hash = ? AND email_verification_pending = 1").get(hashToken(token)) as any;
    if (!row) return res.status(400).json({ error: "This link is no longer valid. Sign in to send a new one.", code: "VERIFY_LINK_INVALID" });
    if (new Date(row.expires).getTime() < Date.now()) return res.status(400).json({ error: "This link has expired. Sign in to send a new one.", code: "VERIFY_LINK_EXPIRED" });
    if (!(await bcrypt.compare(password, row.password_hash))) {
      recordLoginFailure(rateKey);
      return res.status(401).json({ error: "That isn't the password chosen when this account was created.", code: "VERIFY_WRONG_PASSWORD" });
    }
    clearEmailVerification(sqlite, row.id);
    clearLoginRate(rateKey);
    res.json({ ok: true });
  });

  // POST /api/auth/resend-verification { email }. Answers the same whether or not the address has an account.
  app.post("/api/auth/resend-verification", async (req: any, res: any) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const user = email ? storage.getUserByEmail(email) : undefined;
    if (user && isUnconfirmed(sqlite, user.id)) {
      const last = (sqlite.prepare("SELECT email_verification_sent_at AS t FROM users WHERE id = ?").get(user.id) as any)?.t;
      if (!last || Date.now() - new Date(last).getTime() >= RESEND_GAP_MS) {
        await sendVerificationEmail(resend, frontendUrl, user.email, startEmailVerification(sqlite, user.id));
      }
    }
    res.json({ ok: true });
  });
}
