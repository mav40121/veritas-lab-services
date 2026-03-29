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

  CREATE TABLE IF NOT EXISTS veritamap_instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Primary',
    category TEXT NOT NULL DEFAULT 'Chemistry',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS veritamap_instrument_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instrument_id INTEGER NOT NULL,
    map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    specialty TEXT NOT NULL,
    complexity TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE(instrument_id, analyte)
  );

  CREATE TABLE IF NOT EXISTS veritamap_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    instruments TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS veritamap_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    specialty TEXT NOT NULL,
    complexity TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    instrument_source TEXT,
    last_cal_ver TEXT,
    last_method_comp TEXT,
    last_precision TEXT,
    last_sop_review TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL,
    UNIQUE(map_id, analyte)
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
    completion_source TEXT DEFAULT 'manual',
    completion_link TEXT,
    completion_note TEXT,
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

  CREATE TABLE IF NOT EXISTS cumsum_trackers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    analyte TEXT NOT NULL DEFAULT 'PTT',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cumsum_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracker_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    lot_label TEXT NOT NULL,
    old_lot_number TEXT,
    new_lot_number TEXT,
    old_lot_geomean REAL,
    new_lot_geomean REAL,
    difference REAL,
    cumsum REAL,
    verdict TEXT,
    specimen_data TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (tracker_id) REFERENCES cumsum_trackers(id)
  );

  CREATE TABLE IF NOT EXISTS competency_programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Chemistry',
    type TEXT NOT NULL DEFAULT 'technical',
    map_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS competency_method_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    instruments TEXT NOT NULL DEFAULT '[]',
    analytes TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    FOREIGN KEY (program_id) REFERENCES competency_programs(id)
  );

  CREATE TABLE IF NOT EXISTS competency_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    hire_date TEXT,
    lis_initials TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS competency_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    assessment_type TEXT NOT NULL DEFAULT 'initial',
    assessment_date TEXT NOT NULL,
    evaluator_name TEXT,
    evaluator_title TEXT,
    evaluator_initials TEXT,
    competency_type TEXT NOT NULL DEFAULT 'technical',
    status TEXT NOT NULL DEFAULT 'pass',
    remediation_plan TEXT,
    employee_acknowledged INTEGER NOT NULL DEFAULT 0,
    supervisor_acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (program_id) REFERENCES competency_programs(id),
    FOREIGN KEY (employee_id) REFERENCES competency_employees(id)
  );

  CREATE TABLE IF NOT EXISTS competency_assessment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    method_number INTEGER,
    method_group_id INTEGER,
    item_label TEXT,
    item_description TEXT,
    evidence TEXT,
    date_met TEXT,
    employee_initials TEXT,
    supervisor_initials TEXT,
    passed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (assessment_id) REFERENCES competency_assessments(id)
  );

  CREATE TABLE IF NOT EXISTS competency_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (program_id) REFERENCES competency_programs(id)
  );
`);

// Seed discount codes (safe — INSERT OR IGNORE won't duplicate)
sqlite.exec(`
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('MEDLAB10', 'Medical Lab Management', 10, 'annual', NULL, 0, 1, '${new Date().toISOString()}');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('DARK10', 'Dark Report', 10, 'annual', NULL, 0, 1, '${new Date().toISOString()}');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('BETA2026', 'VeritaAssure Beta', 100, 'all', 10, 0, 1, '${new Date().toISOString()}');
`);

// Step 2: Add columns if upgrading from older schema (safe migration)
const existingCols = sqlite.prepare("PRAGMA table_info(users)").all() as { name: string }[];
const colNames = existingCols.map((c) => c.name);
if (!colNames.includes("stripe_customer_id")) sqlite.exec("ALTER TABLE users ADD COLUMN stripe_customer_id TEXT");
if (!colNames.includes("stripe_subscription_id")) sqlite.exec("ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT");
if (!colNames.includes("has_completed_onboarding")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN has_completed_onboarding INTEGER NOT NULL DEFAULT 0");
  // Migrate existing users: set has_completed_onboarding = 1 (don't show wizard to pre-existing accounts)
  sqlite.exec("UPDATE users SET has_completed_onboarding = 1 WHERE has_completed_onboarding = 0");
}

// Add VeritaScan item columns if upgrading
const scanItemCols = sqlite.prepare("PRAGMA table_info(veritascan_items)").all() as { name: string }[];
const scanColNames = scanItemCols.map((c) => c.name);
if (!scanColNames.includes("completion_source")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_source TEXT DEFAULT 'manual'");
if (!scanColNames.includes("completion_link")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_link TEXT");
if (!scanColNames.includes("completion_note")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_note TEXT");

// Step 3: Seed plan from env var (for testing — SEED_USER_PLAN=email:plan:credits)
if (process.env.SEED_USER_PLAN) {
  const [seedEmail, seedPlan, seedCredits] = process.env.SEED_USER_PLAN.split(":");
  if (seedEmail && seedPlan) {
    const credits = parseInt(seedCredits || "0");
    sqlite.prepare("UPDATE users SET plan = ?, study_credits = ? WHERE email = ?").run(seedPlan, credits, seedEmail.toLowerCase());
    console.log(`[seed] Set ${seedEmail} to plan=${seedPlan} credits=${credits}`);
  }
}
