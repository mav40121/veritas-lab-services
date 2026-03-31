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
