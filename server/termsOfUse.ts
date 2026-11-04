// server/termsOfUse.ts
//
// Terms of Use and Confidentiality Agreement (Michael 2026-11-03, Q141 = 1). Every person accepts the current version
// (shared/termsOfUse.ts) with their typed name before using VeritaAssure; a lab owner's acceptance also binds the
// organization that holds the account. Existing sign-ins are not logged out: once a version is active, the /api gate
// below answers every request from a person who has not accepted it with 403 TERMS_REQUIRED, so their next click shows
// the agreement (client/src/components/TermsAcceptance.tsx) instead of losing their work.
//
// Tables (server/db.ts): terms_acceptances (one row per person per version: typed name, time, IP, browser, text hash,
// and for owners the labs and organizations accepted for) and terms_activations (which version is being asked;
// activated only by POST /api/admin/terms/activate after Michael approves the text, so a deploy alone asks nobody).
// Not gated: requests without a bearer token, scripts' service tokens, the public demo, the shared demo account, and
// the routes a person needs to read, accept or sign out.
import crypto from "crypto";
import { TERMS_VERSION, termsPlainText } from "../shared/termsOfUse";
import { checkAuthToken, clientIp } from "./sessionAuth";

export const TERMS_TEXT_SHA256 = crypto.createHash("sha256").update(termsPlainText()).digest("hex");

// Routes that always pass, so a held person can read the agreement, accept it, or sign out.
const OPEN_PATHS = [/^\/api\/auth\/terms(\/|$)/, /^\/api\/auth\/me$/, /^\/api\/auth\/logout$/, /^\/api\/admin\//, /^\/api\/health$/];

type Owned = { labs: { id: number; name: string }[]; organizations: { id: number; name: string }[] };

let activeCache: { version: string | null; at: number } | null = null;
const acceptedCache = new Map<number, string>(); // userId -> version accepted (only the active one is cached)

export function activeTermsVersion(sqlite: any): string | null {
  if (activeCache && Date.now() - activeCache.at < 30_000) return activeCache.version;
  const row = sqlite.prepare("SELECT terms_version FROM terms_activations WHERE active = 1 ORDER BY id DESC LIMIT 1").get() as { terms_version: string } | undefined;
  activeCache = { version: row?.terms_version || null, at: Date.now() };
  return activeCache.version;
}

function clearCaches() {
  activeCache = null;
  acceptedCache.clear();
}

function isExempt(sqlite: any, userId: number, demoEmail: string): boolean {
  const u = sqlite.prepare("SELECT email FROM users WHERE id = ?").get(userId) as { email?: string } | undefined;
  return !u || String(u.email || "").toLowerCase() === String(demoEmail || "").toLowerCase();
}

function hasAccepted(sqlite: any, userId: number, version: string): boolean {
  if (acceptedCache.get(userId) === version) return true;
  const row = sqlite.prepare("SELECT 1 FROM terms_acceptances WHERE user_id = ? AND terms_version = ? LIMIT 1").get(userId, version);
  if (row) acceptedCache.set(userId, version);
  return !!row;
}

export function ownedBy(sqlite: any, userId: number): Owned {
  const labs = (sqlite.prepare("SELECT id, lab_name AS name FROM labs WHERE owner_user_id = ? ORDER BY id").all(userId) as any[])
    .map((l) => ({ id: Number(l.id), name: String(l.name || `Lab ${l.id}`) }));
  let organizations: { id: number; name: string }[] = [];
  try {
    organizations = (sqlite.prepare("SELECT id, name FROM organizations WHERE billing_owner_user_id = ? ORDER BY id").all(userId) as any[])
      .map((o) => ({ id: Number(o.id), name: String(o.name || `Organization ${o.id}`) }));
  } catch { /* organizations table absent on a very old database */ }
  return { labs, organizations };
}

/**
 * opts.notAPerson: the request came with a script's service token (svc / ci_sandbox) or the public demo, the same kinds
 * the gate lets through. Without it, the CI sandbox receipts (which drive production with a ci_sandbox token) were let
 * through by the gate but shown the agreement by this status, so every UI receipt failed after activation (2026-11-03).
 */
export function termsStatus(sqlite: any, userId: number, demoEmail: string, opts: { notAPerson?: boolean } = {}) {
  const active = activeTermsVersion(sqlite);
  const owned = ownedBy(sqlite, userId);
  const last = sqlite.prepare("SELECT terms_version, accepted_at FROM terms_acceptances WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(userId) as
    | { terms_version: string; accepted_at: string }
    | undefined;
  const exempt = !!opts.notAPerson || isExempt(sqlite, userId, demoEmail);
  const required = !!active && !exempt && !hasAccepted(sqlite, userId, active);
  return {
    required,
    activeVersion: active,
    currentVersion: TERMS_VERSION,
    acceptedVersion: last?.terms_version || null,
    acceptedAt: last?.accepted_at || null,
    isOwner: owned.labs.length + owned.organizations.length > 0,
    acceptsFor: [...owned.organizations.map((o) => o.name), ...owned.labs.map((l) => l.name)],
  };
}

export type AcceptResult =
  | { ok: true; recorded: boolean; acceptedAt: string; version: string }
  | { ok: false; status: number; code: string; error: string };

/** Records the person's own acceptance of the current version. A second call for the same version keeps the first record. */
export function acceptTerms(sqlite: any, userId: number, req: any, body: any): AcceptResult {
  const version = String(body?.version || "");
  if (version !== TERMS_VERSION) return { ok: false, status: 409, code: "TERMS_VERSION_CHANGED", error: "These Terms have been updated. Reload the page to read the current version." };
  if (body?.agree !== true) return { ok: false, status: 400, code: "AGREE_REQUIRED", error: "Check the box to agree." };
  const signedName = String(body?.signedName || "").replace(/\s+/g, " ").trim();
  if (signedName.length < 2 || signedName.length > 120 || !/\p{L}/u.test(signedName)) {
    return { ok: false, status: 400, code: "NAME_REQUIRED", error: "Type your full name to sign." };
  }
  const owned = ownedBy(sqlite, userId);
  const isOwner = owned.labs.length + owned.organizations.length > 0;
  if (isOwner && body?.onBehalfOfOrganization !== true) {
    return { ok: false, status: 400, code: "ORG_ACCEPTANCE_REQUIRED", error: "As the account owner, confirm that you accept these Terms for your organization." };
  }
  const existing = sqlite.prepare("SELECT accepted_at FROM terms_acceptances WHERE user_id = ? AND terms_version = ? LIMIT 1").get(userId, version) as { accepted_at: string } | undefined;
  if (existing) {
    acceptedCache.set(userId, version);
    return { ok: true, recorded: false, acceptedAt: existing.accepted_at, version };
  }
  const account = sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(userId) as { name?: string; email?: string } | undefined;
  const at = new Date().toISOString();
  sqlite.prepare(`INSERT INTO terms_acceptances (user_id, terms_version, text_sha256, signed_name, account_name, account_email, accepted_at,
      ip_address, user_agent, accepted_for_organization, organization_lab_ids, organization_ids, organization_names)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    userId, version, TERMS_TEXT_SHA256, signedName, account?.name || null, account?.email || null, at,
    clientIp(req), String(req?.headers?.["user-agent"] || "").slice(0, 400) || null, isOwner ? 1 : 0,
    isOwner ? JSON.stringify(owned.labs.map((l) => l.id)) : null, isOwner ? JSON.stringify(owned.organizations.map((o) => o.id)) : null,
    isOwner ? JSON.stringify([...owned.organizations.map((o) => o.name), ...owned.labs.map((l) => l.name)]) : null,
  );
  acceptedCache.set(userId, version);
  return { ok: true, recorded: true, acceptedAt: at, version };
}

/** /api gate: a signed-in person who has not accepted the active version can read, accept or sign out, and nothing else. */
export function termsGateMiddleware(getSqlite: () => any, demoEmail: string) {
  return (req: any, res: any, next: any) => {
    const sqlite = getSqlite();
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    if (OPEN_PATHS.some((re) => re.test(path))) return next();
    const auth = req.headers?.authorization;
    if (!auth || !String(auth).startsWith("Bearer ")) return next();
    const active = activeTermsVersion(sqlite);
    if (!active) return next();
    const check = checkAuthToken(sqlite, String(auth).slice(7));
    if (!check.ok) return next(); // the route's own auth answers 401
    if (check.kind === "service" || check.kind === "demo") return next();
    if (hasAccepted(sqlite, check.userId, active) || isExempt(sqlite, check.userId, demoEmail)) return next();
    res.setHeader("X-Terms-Required", active);
    return res.status(403).json({
      error: "Please reload this page, then read and accept the Terms of Use and Confidentiality Agreement to continue.",
      code: "TERMS_REQUIRED",
      version: active,
    });
  };
}

/** Admin: start asking every user to accept the current version. dryRun reports who would be asked without writing. */
export function activateTerms(sqlite: any, version: string, opts: { dryRun?: boolean; by?: string } = {}) {
  if (version !== TERMS_VERSION) return { ok: false as const, error: `Only the current version (${TERMS_VERSION}) can be activated.` };
  const counts = acceptanceCounts(sqlite, version);
  if (!opts.dryRun) {
    sqlite.prepare("UPDATE terms_activations SET active = 0 WHERE active = 1").run();
    sqlite.prepare("INSERT INTO terms_activations (terms_version, text_sha256, active, activated_at, activated_by) VALUES (?, ?, 1, ?, ?)")
      .run(version, TERMS_TEXT_SHA256, new Date().toISOString(), opts.by || "admin");
    clearCaches();
  }
  return { ok: true as const, dryRun: !!opts.dryRun, version, textSha256: TERMS_TEXT_SHA256, ...counts };
}

/** Admin: stop asking (emergency only). Acceptances already given are kept. */
export function deactivateTerms(sqlite: any) {
  const changes = Number(sqlite.prepare("UPDATE terms_activations SET active = 0, deactivated_at = ? WHERE active = 1").run(new Date().toISOString()).changes || 0);
  clearCaches();
  return { ok: true, deactivated: changes };
}

/** Aggregate counts only (no names): people, how many accepted this version, owners who accepted for an organization. */
export function acceptanceCounts(sqlite: any, version: string) {
  const users = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as any).n || 0);
  const accepted = Number((sqlite.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM terms_acceptances WHERE terms_version = ?").get(version) as any).n || 0);
  const forOrganization = Number((sqlite.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM terms_acceptances WHERE terms_version = ? AND accepted_for_organization = 1").get(version) as any).n || 0);
  const signedInLast30Days = Number((sqlite.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM user_sessions WHERE last_active >= ?").get(new Date(Date.now() - 30 * 86400000).toISOString()) as any).n || 0);
  return { users, accepted, notYetAccepted: Math.max(0, users - accepted), ownersAcceptedForOrganization: forOrganization, signedInLast30Days };
}
