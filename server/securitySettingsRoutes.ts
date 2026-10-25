// server/securitySettingsRoutes.ts
//
// HTTP surface for system security settings (server/securityPolicy.ts; Michael Q27 = 1, 2026-10-25):
//   own account  GET /api/auth/security-settings     the owner's settings, their reach, and the policy that applies to the caller
//   system owner PUT /api/auth/security-settings     save (current password required); covers every lab they own or bill for
//   lab owner    GET /api/labs/:labId/account-status  who in the lab is locked out or turned off for inactivity
//                POST /api/labs/:labId/members/:userId/reenable   unlock and turn back on
import bcrypt from "bcryptjs";
import { clientIp } from "./sessionAuth";
import { systemLabs, systemPeopleCount } from "./twoFactor";
import {
  effectivePolicy, getOwnerSettings, validateSettings, saveOwnerSettings, isLocked, isInactive, reenableAccount, clearPolicyCache,
  type SecuritySettings,
} from "./securityPolicy";

const LABELS: Record<keyof SecuritySettings, string> = {
  idleMinutes: "sign out after idle (minutes)",
  passwordExpiryDays: "password expiry (days)",
  passwordHistory: "password history (generations)",
  lockoutAttempts: "lock after wrong passwords",
  inactiveDays: "turn off unused accounts (days)",
  requireSymbol: "require a symbol",
};

/** "password expiry (days): off -> 180; ..." for the audit trail. */
export function describeChanges(before: SecuritySettings, after: SecuritySettings): string {
  const show = (v: any) => (v === true ? "on" : v === false || v == null ? "off" : String(v));
  return (Object.keys(LABELS) as (keyof SecuritySettings)[])
    .filter((k) => show(before[k]) !== show(after[k]))
    .map((k) => `${LABELS[k]}: ${show(before[k])} -> ${show(after[k])}`)
    .join("; ");
}

export function registerSecuritySettingsRoutes(app: any, deps: {
  sqlite: any;
  storage: any;
  authMiddleware: any;
  labScopeMiddleware: any;
  logAudit: (e: any) => any;
}) {
  const { sqlite, storage, authMiddleware, labScopeMiddleware, logAudit } = deps;

  app.get("/api/auth/security-settings", authMiddleware, (req: any, res: any) => {
    const labs = req.isDemo ? [] : systemLabs(sqlite, req.userId);
    const own = getOwnerSettings(sqlite, req.userId);
    const eff = req.isDemo ? null : effectivePolicy(sqlite, req.userId);
    res.json({
      canManage: labs.length > 0,
      settings: own,
      systemLabs: labs,
      systemPeople: labs.length ? systemPeopleCount(sqlite, req.userId) : 0,
      // What applies to the signed-in person (the browser's idle timer and password hints read this).
      effective: eff ? {
        idleMinutes: eff.idleMinutes, passwordExpiryDays: eff.passwordExpiryDays, passwordHistory: eff.passwordHistory,
        lockoutAttempts: eff.lockoutAttempts, inactiveDays: eff.inactiveDays, requireSymbol: eff.requireSymbol,
      } : null,
    });
  });

  app.put("/api/auth/security-settings", authMiddleware, async (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    const labs = systemLabs(sqlite, req.userId);
    if (!labs.length) return res.status(403).json({ error: "Only a lab owner can set security settings for their system.", code: "NO_SYSTEM" });
    const full = sqlite.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.userId) as any;
    const pw = req.body?.password;
    if (!pw || !(await bcrypt.compare(String(pw), full?.password_hash || ""))) {
      return res.status(401).json({ error: "Your current password is incorrect.", code: "PASSWORD_REQUIRED" });
    }
    const v = validateSettings(req.body?.settings);
    if (!v.ok) return res.status(400).json({ error: v.error, code: "INVALID_SETTINGS" });
    const before = getOwnerSettings(sqlite, req.userId);
    saveOwnerSettings(sqlite, req.userId, v.settings, req.userId);
    const changes = describeChanges(before, v.settings);
    if (changes) {
      logAudit({
        userId: req.userId, ownerUserId: req.userId, module: "account", action: "update", entityType: "system.security_settings",
        entityLabel: `Security settings for ${labs.length === 1 ? "1 lab" : `${labs.length} labs`}: ${changes}`,
        before, after: v.settings, ipAddress: clientIp(req) ?? undefined,
      });
    }
    res.json({ ok: true, settings: getOwnerSettings(sqlite, req.userId), changed: !!changes });
  });

  // ── Lab owner: who is locked out or turned off, and turning them back on ──
  const canManage = (req: any) => !req.scope?.viaVlsSupport && ["owner", "admin"].includes(String(req.scope?.role || ""));
  const labPeople = (labId: number) => sqlite.prepare(
    `SELECT u.id, COALESCE(u.name, u.email) AS name, u.email, COALESCE(u.vls_support, 0) AS vls
       FROM users u, labs l
      WHERE l.id = ? AND (u.id = l.owner_user_id
         OR u.id IN (SELECT user_id FROM lab_members WHERE lab_id = l.id AND status = 'active')
         OR u.id IN (SELECT seat_user_id FROM user_seats WHERE lab_id = l.id AND status = 'active' AND seat_user_id IS NOT NULL))`
  ).all(labId) as any[];

  app.get("/api/labs/:labId/account-status", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (!canManage(req)) return res.status(403).json({ error: "Only the lab owner or an admin can see account status." });
    const labId = Number(req.scope.labId);
    const people = labPeople(labId).filter((p) => Number(p.vls) !== 1).map((p) => {
      const pol = effectivePolicy(sqlite, Number(p.id));
      return { userId: Number(p.id), name: p.name, locked: isLocked(sqlite, Number(p.id), pol), inactive: isInactive(sqlite, Number(p.id), pol) };
    });
    res.json({ labId, people: people.filter((p) => p.locked || p.inactive) });
  });

  app.post("/api/labs/:labId/members/:userId/reenable", authMiddleware, labScopeMiddleware, (req: any, res: any) => {
    if (req.isDemo) return res.status(403).json({ error: "demo_restricted", message: "This action is disabled in the live demo." });
    if (!canManage(req)) return res.status(403).json({ error: "Only the lab owner or an admin can turn an account back on." });
    const labId = Number(req.scope.labId);
    const target = Number(req.params.userId);
    const person = labPeople(labId).find((p) => Number(p.id) === target && Number(p.vls) !== 1);
    if (!person) return res.status(404).json({ error: "That person is not in this lab." });
    const pol = effectivePolicy(sqlite, target);
    const wasLocked = isLocked(sqlite, target, pol);
    const wasInactive = isInactive(sqlite, target, pol);
    reenableAccount(sqlite, target);
    clearPolicyCache();
    const lab = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(labId) as any;
    const what = [wasLocked ? "unlocked" : "", wasInactive ? "turned back on" : ""].filter(Boolean).join(" and ") || "cleared";
    logAudit({
      userId: req.userId, module: "account", action: "update", entityType: "account.reenabled", entityId: target,
      entityLabel: `${person.name}'s account ${what} in ${lab?.lab_name || `lab ${labId}`}`, ipAddress: clientIp(req) ?? undefined,
    });
    const u = storage.getUserById(target);
    res.json({ ok: true, userId: target, name: u?.name || person.name, unlocked: wasLocked, reenabled: wasInactive });
  });
}
