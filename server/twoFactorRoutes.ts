// server/twoFactorRoutes.ts
//
// Routes for two-factor sign-in Stage 2 (Michael Q170 = 1, mock Q171 = 1, 2026-10-14). The
// pieces live in server/twoFactor.ts; this file is the HTTP surface:
//   sign-in      POST /api/auth/mfa/verify, /api/auth/mfa/email-code
//   setup        POST /api/auth/mfa/setup/start, /api/auth/mfa/setup/confirm
//   own account  GET /api/auth/mfa, POST /api/auth/mfa/recovery-codes, /api/auth/mfa/turn-off
//   lab owner    GET/PUT /api/labs/:labId/two-factor, POST /api/labs/:labId/two-factor/reset/:userId
//   Veritas      POST /api/admin/two-factor/reset (ADMIN_SECRET)
// A sign-in step is opened by a 10-minute purpose token from login: "mfa" (enrolled person) or
// "mfa_setup" (required but not set up). Neither opens any other route.
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import {
  getMfa, isEnrolled, mfaRequirement, startTotpSetup, confirmTotpSetup, enableEmailMethod, checkTotp,
  replaceRecoveryCodes, useRecoveryCode, recoveryCodesLeft, emailSendWait, issueEmailCode, checkEmailCode,
  sendEmailCode, maskEmail, rememberDevice, deviceTrusted, codeLockWait, recordCodeFailure, clearCodeFailures,
  resetTwoFactor,
} from "./twoFactor";
import { otpauthUrl, groupKey } from "./totp";
import { checkAuthToken, issuePurposeToken, verifyPurposeToken, endSessions, clientIp } from "./sessionAuth";

type SignInBuilder = (req: any, user: any, mfaMethod: string | null) => any;

/**
 * Decides, right after the password checks out, whether sign-in needs the second step.
 * Returns a response to send (code step or first-time setup) or the method to stamp on the
 * session when it can go straight through (null, or "remembered_computer").
 */
export function twoFactorLoginGate(sqlite: any, user: any, req: any): { respond?: any; mfaMethod: string | null } {
  const row = getMfa(sqlite, user.id);
  const rq = mfaRequirement(sqlite, user.id);
  if (isEnrolled(row)) {
    if (rq.allowRemember && deviceTrusted(sqlite, user.id, req?.body?.device_token)) return { mfaMethod: "remembered_computer" };
    return {
      mfaMethod: null,
      respond: {
        mfa_required: true,
        mfa_token: issuePurposeToken(user.id, "mfa"),
        method: row!.method,
        email_hint: maskEmail(user.email),
        allow_remember: rq.allowRemember,
      },
    };
  }
  if (rq.required) return { mfaMethod: null, respond: setupResponse(user, rq) };
  return { mfaMethod: null };
}

function requiredByText(rq: ReturnType<typeof mfaRequirement>): string {
  if (rq.requiredBy.length) return rq.requiredBy.map((l) => l.name).join(", ");
  return rq.vlsSupport ? "Veritas Lab Services" : "";
}

/** The first-time-setup response (sign-in, and a new account joining a lab that requires it). */
export function setupResponse(user: any, rq = { required: true, vlsSupport: false, requiredBy: [] as { id: number; name: string }[], allowRemember: true }): any {
  return {
    mfa_setup_required: true,
    mfa_token: issuePurposeToken(user.id, "mfa_setup"),
    required_by: requiredByText(rq as any),
    email: user.email,
    email_hint: maskEmail(user.email),
    allow_remember: rq.allowRemember,
  };
}

export function registerTwoFactorRoutes(app: any, deps: {
  sqlite: any;
  storage: any;
  authMiddleware: any;
  labScopeMiddleware: any;
  logAudit: (e: any) => any;
  buildSignIn: SignInBuilder;
  adminSecret: string;
}) {
  const { sqlite, storage, authMiddleware, labScopeMiddleware, logAudit, buildSignIn, adminSecret } = deps;
  const audit = (req: any, userId: number, entityType: string, entityLabel: string, entityId?: number) =>
    logAudit({ userId, module: "account", action: "update", entityType, entityLabel, entityId, ipAddress: clientIp(req) ?? undefined });

  /** The person behind a sign-in step token, or (when allowSession) a live session. */
  function stepUser(req: any, purposes: string[], allowSession: boolean): { user: any; via: string } | null {
    const raw = String(req.body?.mfa_token || "");
    for (const p of purposes) {
      const t = raw ? verifyPurposeToken(raw, p) : null;
      if (t) {
        const user = storage.getUserById(t.userId);
        return user ? { user, via: p } : null;
      }
    }
    if (!allowSession) return null;
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ")) return null;
    const c = checkAuthToken(sqlite, auth.slice(7));
    if (!c.ok || c.isDemo) return null;
    const user = storage.getUserById(c.userId);
    return user ? { user, via: "session" } : null;
  }

  const locked = (res: any, userId: number) => {
    const wait = codeLockWait(userId);
    if (wait == null) return false;
    res.setHeader("Retry-After", String(wait));
    res.status(429).json({ error: "Too many wrong codes. Wait 15 minutes and try again.", code: "TOO_MANY_CODES" });
    return true;
  };

  // ── Sign-in: the code step ──────────────────────────────────────────────
  app.post("/api/auth/mfa/verify", async (req: any, res: any) => {
    const who = stepUser(req, ["mfa"], false);
    if (!who) return res.status(401).json({ error: "Your sign-in step expired. Sign in again.", code: "MFA_STEP_EXPIRED" });
    const { user } = who;
    if (locked(res, user.id)) return;
    const kind = String(req.body?.kind || "app");
    const code = String(req.body?.code || "");
    const ok = kind === "recovery" ? useRecoveryCode(sqlite, user.id, code)
      : kind === "email" ? checkEmailCode(sqlite, user.id, "login", code)
      : checkTotp(sqlite, user.id, code);
    if (!ok) {
      recordCodeFailure(user.id);
      return res.status(400).json({ error: kind === "recovery" ? "That recovery code didn't work." : "That code didn't work. Check it and try again.", code: "BAD_CODE" });
    }
    clearCodeFailures(user.id);
    const method = kind === "recovery" ? "recovery_code" : kind === "email" ? "email" : "app";
    if (kind === "recovery") audit(req, user.id, "two_factor.recovery_code_used", `Signed in with a recovery code (${recoveryCodesLeft(sqlite, user.id)} left)`);
    const out = buildSignIn(req, user, method);
    const rq = mfaRequirement(sqlite, user.id);
    if (req.body?.remember === true && rq.allowRemember) out.device_token = rememberDevice(sqlite, user.id, req);
    if (kind === "recovery") out.recovery_codes_left = recoveryCodesLeft(sqlite, user.id);
    res.json(out);
  });

  app.post("/api/auth/mfa/email-code", async (req: any, res: any) => {
    const who = stepUser(req, ["mfa", "mfa_setup"], true);
    if (!who) return res.status(401).json({ error: "Your sign-in step expired. Sign in again.", code: "MFA_STEP_EXPIRED" });
    const { user, via } = who;
    const wait = emailSendWait(user.id);
    if (wait != null) {
      res.setHeader("Retry-After", String(wait));
      return res.status(429).json({ error: `Wait ${wait} seconds before asking for another code.`, code: "EMAIL_CODE_WAIT", retryAfterSec: wait });
    }
    const purpose = via === "mfa" ? "login" : "setup";
    const code = issueEmailCode(sqlite, user.id, purpose);
    const sent = await sendEmailCode(user.email, code, purpose);
    if (!sent) return res.status(503).json({ error: "We couldn't send the email. Try again, or use your authenticator app or a recovery code." });
    res.json({ sent: true, email_hint: maskEmail(user.email) });
  });

  // ── Setup (first time, at sign-in or from Account settings; also "Move to a new phone") ──
  app.post("/api/auth/mfa/setup/start", async (req: any, res: any) => {
    const who = stepUser(req, ["mfa_setup"], true);
    if (!who) return res.status(401).json({ error: "Your sign-in step expired. Sign in again.", code: "MFA_STEP_EXPIRED" });
    const { user, via } = who;
    if (via === "session" && isEnrolled(getMfa(sqlite, user.id))) {
      const full = sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as any;
      if (!req.body?.password || !(await bcrypt.compare(String(req.body.password), full?.password_hash || ""))) {
        return res.status(401).json({ error: "Enter your current password to move two-factor to a new phone.", code: "PASSWORD_REQUIRED" });
      }
    }
    const secret = startTotpSetup(sqlite, user.id);
    const url = otpauthUrl(secret, user.email);
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    res.json({ key: groupKey(secret), otpauth: url, qr_svg: qrSvg });
  });

  app.post("/api/auth/mfa/setup/confirm", async (req: any, res: any) => {
    const who = stepUser(req, ["mfa_setup"], true);
    if (!who) return res.status(401).json({ error: "Your sign-in step expired. Sign in again.", code: "MFA_STEP_EXPIRED" });
    const { user, via } = who;
    if (locked(res, user.id)) return;
    const method = req.body?.method === "email" ? "email" : "app";
    const code = String(req.body?.code || "");
    const ok = method === "email" ? checkEmailCode(sqlite, user.id, "setup", code) : confirmTotpSetup(sqlite, user.id, code);
    if (!ok) {
      recordCodeFailure(user.id);
      return res.status(400).json({ error: "That code didn't work. Check it and try again.", code: "BAD_CODE" });
    }
    clearCodeFailures(user.id);
    if (method === "email") enableEmailMethod(sqlite, user.id);
    const recoveryCodes = replaceRecoveryCodes(sqlite, user.id);
    audit(req, user.id, "two_factor.enable", method === "email" ? "Two-factor sign-in turned on (email codes)" : "Two-factor sign-in turned on (authenticator app)");
    if (via !== "session") {
      const out = buildSignIn(req, user, method);
      const rq = mfaRequirement(sqlite, user.id);
      if (req.body?.remember === true && rq.allowRemember) out.device_token = rememberDevice(sqlite, user.id, req);
      return res.json({ ...out, recovery_codes: recoveryCodes });
    }
    res.json({ ok: true, recovery_codes: recoveryCodes });
  });

  // ── Own account ─────────────────────────────────────────────────────────
  app.get("/api/auth/mfa", authMiddleware, (req: any, res: any) => {
    const user = storage.getUserById(req.userId);
    const row = getMfa(sqlite, req.userId);
    const rq = mfaRequirement(sqlite, req.userId);
    res.json({
      enabled: isEnrolled(row),
      method: row?.enabled_at ? row.method : null,
      enabledAt: row?.enabled_at || null,
      recoveryCodesLeft: isEnrolled(row) ? recoveryCodesLeft(sqlite, req.userId) : 0,
      email: user?.email || null,
      required: rq.required,
      requiredBy: requiredByText(rq),
      canTurnOff: isEnrolled(row) && !rq.required,
      isDemo: !!req.isDemo,
    });
  });

  const passwordOk = async (userId: number, pw: unknown) => {
    const full = sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as any;
    return !!pw && (await bcrypt.compare(String(pw), full?.password_hash || ""));
  };

  app.post("/api/auth/mfa/recovery-codes", authMiddleware, async (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    if (!isEnrolled(getMfa(sqlite, req.userId))) return res.status(409).json({ error: "Two-factor sign-in is not on." });
    if (!(await passwordOk(req.userId, req.body?.password))) return res.status(401).json({ error: "Your current password is incorrect.", code: "PASSWORD_REQUIRED" });
    const codes = replaceRecoveryCodes(sqlite, req.userId);
    audit(req, req.userId, "two_factor.recovery_codes", "New recovery codes made; the old ones stopped working");
    res.json({ recovery_codes: codes });
  });

  app.post("/api/auth/mfa/turn-off", authMiddleware, async (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    const rq = mfaRequirement(sqlite, req.userId);
    if (rq.required) return res.status(409).json({ error: "Your lab requires two-factor sign-in, so it cannot be turned off here.", code: "MFA_REQUIRED" });
    if (!(await passwordOk(req.userId, req.body?.password))) return res.status(401).json({ error: "Your current password is incorrect.", code: "PASSWORD_REQUIRED" });
    resetTwoFactor(sqlite, req.userId);
    audit(req, req.userId, "two_factor.disable", "Two-factor sign-in turned off");
    res.json({ ok: true });
  });

  // ── Lab owner: require it, allow "remember this computer", see who has it, reset ──
  const canManage = (req: any) => !req.scope?.viaVlsSupport && ["owner", "admin"].includes(String(req.scope?.role || ""));

  app.get("/api/labs/:labId/two-factor", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!canManage(req)) return res.status(403).json({ error: "Only the lab owner or an admin can see two-factor settings." });
    const labId = Number(req.scope.labId);
    const lab = sqlite.prepare(
      "SELECT l.id, l.lab_name, l.owner_user_id, COALESCE(l.mfa_required,0) AS req, l.mfa_required_at, l.mfa_required_by, COALESCE(l.mfa_allow_remember,1) AS rem, u.name AS by_name FROM labs l LEFT JOIN users u ON u.id = l.mfa_required_by WHERE l.id = ?"
    ).get(labId) as any;
    const people = sqlite.prepare(
      `SELECT u.id AS user_id, u.name, u.email, COALESCE(u.vls_support,0) AS vls,
              CASE WHEN u.id = l.owner_user_id THEN 'Lab owner' ELSE COALESCE(
                (SELECT CASE WHEN s.seat_type = 'staff_portal' THEN 'Read-and-sign staff' WHEN s.seat_type = 'view_only' THEN 'Reviewer' ELSE NULL END
                   FROM user_seats s WHERE s.seat_user_id = u.id AND s.lab_id = l.id AND s.status = 'active' LIMIT 1),
                (SELECT m.role FROM lab_members m WHERE m.user_id = u.id AND m.lab_id = l.id AND m.status = 'active' LIMIT 1), 'Member') END AS role,
              mf.enabled_at, mf.method,
              (SELECT MAX(created_at) FROM user_sessions us WHERE us.user_id = u.id) AS last_sign_in
         FROM users u
         JOIN labs l ON l.id = ?
         LEFT JOIN user_mfa mf ON mf.user_id = u.id
        WHERE u.id = l.owner_user_id
           OR u.id IN (SELECT user_id FROM lab_members WHERE lab_id = l.id AND status = 'active')
           OR u.id IN (SELECT seat_user_id FROM user_seats WHERE lab_id = l.id AND status = 'active' AND seat_user_id IS NOT NULL)
        ORDER BY (u.id = l.owner_user_id) DESC, u.name COLLATE NOCASE`
    ).all(labId) as any[];
    const required = Number(lab?.req) === 1;
    res.json({
      labId,
      labName: lab?.lab_name,
      required,
      requiredAt: lab?.mfa_required_at || null,
      requiredByName: lab?.by_name || null,
      allowRemember: Number(lab?.rem) === 1,
      people: people.filter((p) => Number(p.vls) !== 1).map((p) => ({
        userId: p.user_id,
        name: p.name || p.email,
        role: String(p.role || "").replace(/^admin$/, "Admin").replace(/^staff$/, "Staff").replace(/^owner$/, "Lab owner"),
        status: p.enabled_at ? (p.method === "email" ? "on_email" : "on") : (required ? "setup_next" : "off"),
        lastSignIn: p.last_sign_in || null,
        canReset: !!p.enabled_at && p.user_id !== req.userId && p.user_id !== lab?.owner_user_id,
      })),
    });
  });

  app.put("/api/labs/:labId/two-factor", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    if (!canManage(req)) return res.status(403).json({ error: "Only the lab owner or an admin can change two-factor settings." });
    const labId = Number(req.scope.labId);
    const now = new Date().toISOString();
    const lab = sqlite.prepare("SELECT lab_name, COALESCE(mfa_required,0) AS req, COALESCE(mfa_allow_remember,1) AS rem FROM labs WHERE id = ?").get(labId) as any;
    if (typeof req.body?.required === "boolean" && (req.body.required ? 1 : 0) !== Number(lab.req)) {
      if (req.body.required) sqlite.prepare("UPDATE labs SET mfa_required = 1, mfa_required_at = ?, mfa_required_by = ?, updated_at = ? WHERE id = ?").run(now, req.userId, now, labId);
      else sqlite.prepare("UPDATE labs SET mfa_required = 0, mfa_required_at = NULL, mfa_required_by = NULL, updated_at = ? WHERE id = ?").run(now, labId);
      logAudit({ userId: req.userId, module: "account", action: "update", entityType: "lab.two_factor_required", entityId: labId, entityLabel: `${req.body.required ? "Required" : "Stopped requiring"} two-factor sign-in for ${lab.lab_name}`, ipAddress: clientIp(req) ?? undefined });
    }
    if (typeof req.body?.allowRemember === "boolean" && (req.body.allowRemember ? 1 : 0) !== Number(lab.rem)) {
      sqlite.prepare("UPDATE labs SET mfa_allow_remember = ?, updated_at = ? WHERE id = ?").run(req.body.allowRemember ? 1 : 0, now, labId);
      logAudit({ userId: req.userId, module: "account", action: "update", entityType: "lab.two_factor_remember", entityId: labId, entityLabel: `${req.body.allowRemember ? "Allowed" : "Switched off"} "Remember this computer" for ${lab.lab_name}`, ipAddress: clientIp(req) ?? undefined });
    }
    res.json({ ok: true });
  });

  app.post("/api/labs/:labId/two-factor/reset/:userId", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    if (!canManage(req)) return res.status(403).json({ error: "Only the lab owner or an admin can reset two-factor sign-in." });
    const labId = Number(req.scope.labId);
    const target = Number(req.params.userId);
    const lab = sqlite.prepare("SELECT lab_name, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
    if (target === req.userId) return res.status(400).json({ error: "You can't reset your own two-factor here. Ask Veritas Lab Services." });
    if (target === Number(lab.owner_user_id)) return res.status(400).json({ error: "Veritas Lab Services resets a lab owner's two-factor after confirming who they are." });
    const inLab = sqlite.prepare(
      `SELECT 1 FROM users u WHERE u.id = ? AND COALESCE(u.vls_support,0) = 0 AND (
         u.id IN (SELECT user_id FROM lab_members WHERE lab_id = ? AND status = 'active')
         OR u.id IN (SELECT seat_user_id FROM user_seats WHERE lab_id = ? AND status = 'active'))`
    ).get(target, labId, labId);
    if (!inLab) return res.status(404).json({ error: "That person is not in this lab." });
    const person = storage.getUserById(target);
    resetTwoFactor(sqlite, target);
    const ended = endSessions(sqlite, target, { reason: "two_factor_reset" });
    logAudit({ userId: req.userId, module: "account", action: "update", entityType: "two_factor.reset", entityId: target, entityLabel: `Reset two-factor sign-in for ${person?.name || person?.email} in ${lab.lab_name}; ${ended} sign-in(s) ended`, ipAddress: clientIp(req) ?? undefined });
    res.json({ ok: true, signedOut: ended });
  });

  // ── Veritas: reset anyone (after confirming who they are) ──────────────
  app.post("/api/admin/two-factor/reset", (req: any, res: any) => {
    const secret = (req.headers["x-admin-secret"] || req.body?.secret) as string | undefined;
    if (secret !== adminSecret) return res.status(403).json({ error: "Forbidden" });
    const { userId, email } = req.body || {};
    let uid = Number(userId) || null;
    if (!uid && email) uid = (sqlite.prepare("SELECT id FROM users WHERE lower(email) = lower(?)").get(String(email)) as any)?.id ?? null;
    if (!uid || !storage.getUserById(uid)) return res.status(404).json({ error: "User not found" });
    resetTwoFactor(sqlite, uid);
    const ended = endSessions(sqlite, uid, { reason: "two_factor_reset" });
    logAudit({ userId: 0, module: "admin", action: "update", entityType: "two_factor.reset", entityId: uid, entityLabel: `Veritas reset two-factor sign-in; ${ended} sign-in(s) ended`, ipAddress: clientIp(req) ?? undefined });
    res.json({ ok: true, userId: uid, signedOut: ended });
  });
}
