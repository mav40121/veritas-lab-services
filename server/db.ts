import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";

// Use /data volume if available (Railway persistent volume), otherwise local
const DB_PATH = process.env.DB_PATH || (require('fs').existsSync('/data') ? '/data/veritas.db' : 'veritas.db');
console.log(`[db] Using database at: ${DB_PATH}`);
const sqlite = new Database(DB_PATH);
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

  CREATE TABLE IF NOT EXISTS reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE IF NOT EXISTS discount_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    partner_name TEXT NOT NULL,
    discount_pct INTEGER NOT NULL DEFAULT 10,
    applies_to TEXT NOT NULL DEFAULT 'annual',
    max_uses INTEGER,
    uses INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS veritascan_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS veritascan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Not Assessed',
    notes TEXT,
    owner TEXT,
    due_date TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(scan_id, item_id)
  );

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    source TEXT NOT NULL DEFAULT 'website',
    subscribed_at TEXT NOT NULL,
    unsubscribed_at TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
`);

// Seed discount codes (safe — INSERT OR IGNORE won't duplicate)
sqlite.exec(`
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('MEDLAB10', 'Medical Lab Management', 10, 'annual', NULL, 0, 1, '${new Date().toISOString()}');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('DARK10', 'Dark Report', 10, 'annual', NULL, 0, 1, '${new Date().toISOString()}');
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
