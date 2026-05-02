import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Users table
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"), // "free" | "per_study" | "annual"
  studyCredits: integer("study_credits").notNull().default(0),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  hasCompletedOnboarding: integer("has_completed_onboarding").notNull().default(0),
  subscriptionExpiresAt: text("subscription_expires_at"),
  subscriptionStatus: text("subscription_status").notNull().default("free"),
  createdAt: text("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, passwordHash: true, createdAt: true, plan: true, studyCredits: true, hasCompletedOnboarding: true });
export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(6) });
export const registerSchema = z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(1), hipaa_acknowledged: z.boolean().optional() });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Studies table
export const studies = sqliteTable("studies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  testName: text("test_name").notNull(),
  instrument: text("instrument").notNull(),
  analyst: text("analyst").notNull(),
  date: text("date").notNull(),
  studyType: text("study_type").notNull(),
  cliaAllowableError: real("clia_allowable_error").notNull(),
  dataPoints: text("data_points").notNull(),
  instruments: text("instruments").notNull(),
  status: text("status").notNull().default("completed"),
  teaIsPercentage: integer("tea_is_percentage").default(1),
  teaUnit: text("tea_unit").default("%"),
  cliaAbsoluteFloor: real("clia_absolute_floor"),
  cliaAbsoluteUnit: text("clia_absolute_unit"),
  instrumentMeta: text("instrument_meta"),
  createdAt: text("created_at").notNull(),
});

export const insertStudySchema = createInsertSchema(studies).omit({ id: true });
export type InsertStudy = z.infer<typeof insertStudySchema>;
export type Study = typeof studies.$inferSelect;

// Contact messages
export const contactMessages = sqliteTable("contact_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  createdAt: text("created_at").notNull(),
});

export const insertContactSchema = createInsertSchema(contactMessages).omit({ id: true, createdAt: true });
export type InsertContact = z.infer<typeof insertContactSchema>;

// Labs table — normalized lab identity shared across owner + seats
export const labs = sqliteTable("labs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cliaNumber: text("clia_number").unique(),
  labName: text("lab_name"),
  accreditationCap: integer("accreditation_cap").notNull().default(0),
  accreditationTjc: integer("accreditation_tjc").notNull().default(0),
  accreditationCola: integer("accreditation_cola").notNull().default(0),
  accreditationAabb: integer("accreditation_aabb").notNull().default(0),
  cliaLocked: integer("clia_locked").notNull().default(0),
  labNameLocked: integer("lab_name_locked").notNull().default(0),
  ownerUserId: integer("owner_user_id").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Lab = typeof labs.$inferSelect;

// Lab audit log — tracks changes to lab identity fields
export const labAuditLog = sqliteTable("lab_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  labId: integer("lab_id").notNull(),
  changedByUserId: integer("changed_by_user_id").notNull(),
  fieldName: text("field_name").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: text("changed_at").notNull(),
  changeReason: text("change_reason"),
});

export type LabAuditEntry = typeof labAuditLog.$inferSelect;

// Password reset tokens
export const resetTokens = sqliteTable("reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
});

// DataPoint shape (JSON)
export interface DataPoint {
  level: number;
  expectedValue: number | null;
  instrumentValues: { [key: string]: number | null };
  // Qualitative / semi-quantitative categorical fields (used INSTEAD of numeric fields)
  expectedCategory?: string | null;
  instrumentCategories?: { [key: string]: string | null };
}

// ── Seat permissions (shared between client + server) ──────────────────────
// Single source of truth for which module keys participate in seat-level
// view/edit gating. Used by:
//   * client useIsReadOnly resolver (SubscriptionBanner.tsx)
//   * server requireModuleEdit middleware (routes.ts)
//   * AccountSettingsPage MODULE_LIST (display labels live there)
// New per-module gated modules MUST be added here AND given a label in
// AccountSettingsPage.tsx, or seat permissions silently miss them and
// existing seats with universally-edit access break on the new page.
export const SEAT_MODULE_KEYS = [
  'veritacheck',
  'veritamap',
  'veritascan',
  'veritacomp',
  'veritastaff',
  'veritapt',
  'veritapolicy',
  'veritalab',
  'veritatrack',
  'veritabench',  // covers VeritaPace, VeritaShift, VeritaQA (all under /veritabench/*)
  'veritastock',  // VeritaStock inventory manager
] as const;

export type SeatModuleKey = typeof SEAT_MODULE_KEYS[number];

// Stored shape on disk (user_seats.permissions JSON column). Two shapes are
// accepted on read for backward compatibility:
//   1. Legacy flat map: { veritacheck: 'edit', veritamap: 'view', ... }
//   2. New mode shape:  { mode: 'edit_all'|'view_all'|'custom', overrides?: { ... } }
// All new writes use the mode shape. Auto-upgrade: if the legacy flat map has
// every SEAT_MODULE_KEYS entry set to 'edit', the resolver treats it as mode:
// 'edit_all' so future modules are inherited (this is what David's seat hits).
export type SeatPermLevel = 'view' | 'edit';
export type SeatPermMode = 'edit_all' | 'view_all' | 'custom';

export type SeatPermissionsLegacy = Record<string, SeatPermLevel>;
export interface SeatPermissionsModeShape {
  mode: SeatPermMode;
  overrides?: Record<string, SeatPermLevel>;
}
export type SeatPermissions = SeatPermissionsLegacy | SeatPermissionsModeShape | null;

// Resolver: returns the effective view/edit for a given module under any shape.
//
// Auto-upgrade rule (this is the David fix): a legacy flat map where every
// PRESENT key is 'edit' is treated as mode:'edit_all' so the seat inherits
// modules that didn't exist when the seat was granted. Concretely: David's
// seat was granted when MODULE_LIST had 9 keys, all set to 'edit'. Now
// MODULE_LIST has 11 keys (veritabench + veritastock added). Without this
// rule, the resolver would return 'view' for veritabench (the page he hit)
// because the key isn't in his stored map. With this rule, since every key
// HE has is 'edit', we infer the owner intended universal edit and return
// 'edit' for any module key, including ones added later.
//
// Guard: an empty flat map ({}) does NOT auto-upgrade -- it falls through
// to the literal lookup which returns 'view'. A flat map with mixed
// view/edit values is read literally; missing keys default to 'view'.
export function resolveSeatPermission(
  perms: SeatPermissions,
  moduleKey: string
): SeatPermLevel {
  if (!perms) return 'view';
  // New shape
  if (typeof (perms as any).mode === 'string') {
    const m = perms as SeatPermissionsModeShape;
    if (m.mode === 'edit_all') return m.overrides?.[moduleKey] ?? 'edit';
    if (m.mode === 'view_all') return m.overrides?.[moduleKey] ?? 'view';
    // custom
    return (m.overrides?.[moduleKey] ?? 'view') as SeatPermLevel;
  }
  // Legacy flat map -- check for auto-upgrade signal first.
  // Auto-upgrade fires iff: at least one key present AND every present key
  // has value 'edit'. (An empty object would otherwise vacuously satisfy
  // "every" and incorrectly upgrade.)
  const flat = perms as SeatPermissionsLegacy;
  const presentKeys = Object.keys(flat);
  if (presentKeys.length > 0 && presentKeys.every(k => flat[k] === 'edit')) {
    return 'edit';
  }
  return (flat[moduleKey] === 'edit' ? 'edit' : 'view');
}

