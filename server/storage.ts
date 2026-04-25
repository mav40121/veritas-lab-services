import { db } from "./db";
import { users, studies, contactMessages } from "@shared/schema";
import type { User, InsertStudy, Study, InsertContact } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Users
  createUser(email: string, passwordHash: string, name: string): User;
  getUserByEmail(email: string): User | undefined;
  getUserById(id: number): User | undefined;
  updateUserPlan(id: number, plan: string, credits: number): void;
  updateUserStripe(id: number, data: { stripeCustomerId?: string; stripeSubscriptionId?: string | null; plan?: string }): void;
  getUserByStripeCustomerId(customerId: string): User | undefined;
  addStudyCredits(id: number, credits: number): void;
  deleteUser(id: number): void;
  // Studies
  createStudy(study: InsertStudy): Study;
  getStudy(id: number): Study | undefined;
  getStudiesByUser(userId: number): Study[];
  getAllStudies(): Study[];
  updateStudyStatus(id: number, status: string): void;
  deleteStudy(id: number): void;
  // Contact
  createContactMessage(msg: InsertContact): void;
}

class DatabaseStorage implements IStorage {
  createUser(email: string, passwordHash: string, name: string): User {
    return db.insert(users).values({
      email, passwordHash, name, plan: "free", studyCredits: 0,
      createdAt: new Date().toISOString()
    }).returning().get();
  }
  getUserByEmail(email: string): User | undefined {
    return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
  }
  getUserById(id: number): User | undefined {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  updateUserPlan(id: number, plan: string, credits: number): void {
    db.update(users).set({ plan, studyCredits: credits }).where(eq(users.id, id)).run();
  }
  updateUserStripe(id: number, data: { stripeCustomerId?: string; stripeSubscriptionId?: string | null; plan?: string }): void {
    const updateData: Record<string, any> = {};
    if (data.stripeCustomerId !== undefined) updateData.stripeCustomerId = data.stripeCustomerId;
    if (data.stripeSubscriptionId !== undefined) updateData.stripeSubscriptionId = data.stripeSubscriptionId;
    if (data.plan !== undefined) updateData.plan = data.plan;
    if (Object.keys(updateData).length > 0) {
      db.update(users).set(updateData).where(eq(users.id, id)).run();
    }
  }
  getUserByStripeCustomerId(customerId: string): User | undefined {
    return db.select().from(users).where(eq(users.stripeCustomerId, customerId)).get();
  }
  addStudyCredits(id: number, credits: number): void {
    const user = this.getUserById(id);
    if (!user) return;
    db.update(users).set({
      plan: "per_study",
      studyCredits: (user.studyCredits || 0) + credits,
    }).where(eq(users.id, id)).run();
  }
  deleteUser(id: number): void {
    const sqlite = (db as any).$client;
    const del = (table: string, col = "user_id") =>
      sqlite.prepare(`DELETE FROM ${table} WHERE ${col} = ?`).run(id);
    sqlite.transaction(() => {
      // Indirect children (grandchild tables first)
      sqlite.prepare("DELETE FROM veritacheck_verification_studies WHERE verification_id IN (SELECT id FROM veritacheck_verifications WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritacheck_verification_instruments WHERE verification_id IN (SELECT id FROM veritacheck_verifications WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM competency_quiz_results WHERE quiz_id IN (SELECT id FROM competency_quizzes WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM competency_assessment_items WHERE assessment_id IN (SELECT a.id FROM competency_assessments a JOIN competency_programs p ON a.program_id = p.id WHERE p.user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM competency_assessments WHERE program_id IN (SELECT id FROM competency_programs WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM competency_method_groups WHERE program_id IN (SELECT id FROM competency_programs WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM competency_checklist_items WHERE program_id IN (SELECT id FROM competency_programs WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritascan_items WHERE scan_id IN (SELECT id FROM veritascan_scans WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM cumsum_entries WHERE tracker_id IN (SELECT id FROM cumsum_trackers WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritamap_amr_values WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritamap_analyte_values WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritamap_instrument_tests WHERE instrument_id IN (SELECT i.id FROM veritamap_instruments i JOIN veritamap_maps m ON i.map_id = m.id WHERE m.user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritamap_instruments WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM veritamap_tests WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM staff_competency_schedules WHERE employee_id IN (SELECT id FROM staff_employees WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM staff_roles WHERE employee_id IN (SELECT id FROM staff_employees WHERE user_id = ?)").run(id);
      sqlite.prepare("DELETE FROM pt_corrective_actions WHERE user_id = ?").run(id);
      sqlite.prepare("DELETE FROM pt_events WHERE user_id = ?").run(id);
      sqlite.prepare("DELETE FROM staffing_hourly_data WHERE study_id IN (SELECT id FROM staffing_studies WHERE account_id = ?)").run(id);
      sqlite.prepare("DELETE FROM pi_entries WHERE metric_id IN (SELECT id FROM pi_metrics WHERE department_id IN (SELECT id FROM pi_departments WHERE account_id = ?))").run(id);
      sqlite.prepare("DELETE FROM pi_metrics WHERE department_id IN (SELECT id FROM pi_departments WHERE account_id = ?)").run(id);
      // Direct children
      del("user_sessions");
      del("user_seats", "owner_user_id");
      del("reset_tokens");
      del("studies");
      del("invoice_requests");
      del("veritamap_maps");
      del("veritascan_scans");
      del("cumsum_trackers");
      del("competency_programs");
      del("competency_employees");
      del("competency_quizzes");
      del("staff_employees");
      del("staff_labs");
      del("lab_certificate_reminders");
      del("lab_certificate_documents");
      del("lab_certificates");
      del("pt_enrollments");
      del("pt_enrollments_v2");
      del("veritacheck_verifications");
      del("veritapolicy_requirement_status");
      del("veritapolicy_lab_policies");
      del("veritapolicy_settings");
      del("veritatrack_signoffs");
      del("veritatrack_tasks");
      del("nightly_snapshots");
      del("audit_log");
      del("productivity_months", "account_id");
      del("staffing_studies", "account_id");
      del("inventory_items", "account_id");
      del("pi_departments", "account_id");
      // Finally delete the user
      del("users", "id");
    })();
  }
  createStudy(study: InsertStudy): Study {
    return db.insert(studies).values(study).returning().get();
  }
  getStudy(id: number): Study | undefined {
    return db.select().from(studies).where(eq(studies.id, id)).get();
  }
  getStudiesByUser(userId: number): Study[] {
    return db.select().from(studies).where(eq(studies.userId, userId)).orderBy(desc(studies.id)).all();
  }
  getAllStudies(): Study[] {
    return db.select().from(studies).orderBy(desc(studies.id)).all();
  }
  updateStudyStatus(id: number, status: string): void {
    db.update(studies).set({ status }).where(eq(studies.id, id)).run();
  }
  deleteStudy(id: number): void {
    db.delete(studies).where(eq(studies.id, id)).run();
  }
  createContactMessage(msg: InsertContact): void {
    db.insert(contactMessages).values({ ...msg, createdAt: new Date().toISOString() }).run();
  }
}

export const storage = new DatabaseStorage();
