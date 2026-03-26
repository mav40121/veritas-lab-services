import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

const sqlite = new Database("veritas.db");
export const db = drizzle(sqlite, { schema });

// Step 1: Create tables if they don't exist (safe on fresh or existing DB)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    study_credits INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    created_at TEXT NOT NULL
  );



  CREATE TABLE IF NOT EXISTS studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    test_name TEXT NOT NULL,
    instrument TEXT NOT NULL,
    analyst TEXT NOT NULL,
    date TEXT NOT NULL,
    study_type TEXT NOT NULL,
    clia_allowable_error REAL NOT NULL,
    data_points TEXT NOT NULL,
    instruments TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

// Step 2: Add Stripe columns if upgrading from older schema (safe migration)
const existingCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
const colNames = existingCols.map((c) => c.name);
if (!colNames.includes("stripe_customer_id")) sqlite.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
if (!colNames.includes("stripe_subscription_id")) sqlite.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");

// Step 3: Seed plan from env var (for testing — SEED_USER_PLAN=email:plan:credits)
if (process.env.SEED_USER_PLAN) {
  const [seedEmail, seedPlan, seedCredits] = process.env.SEED_USER_PLAN.split(":");
  if (seedEmail && seedPlan) {
    const credits = parseInt(seedCredits || "0");
    sqlite.prepare("UPDATE users SET plan = ?, study_credits = ? WHERE email = ?").run(seedPlan, credits, seedEmail.toLowerCase());
    console.log(`[seed] Set ${seedEmail} to plan=${seedPlan} credits=${credits}`);
  }
}
