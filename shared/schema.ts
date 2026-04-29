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
