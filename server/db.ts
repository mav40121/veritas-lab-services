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

  CREATE TABLE IF NOT EXISTS staff_labs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    lab_name TEXT NOT NULL,
    clia_number TEXT NOT NULL,
    lab_address_street TEXT,
    lab_address_city TEXT,
    lab_address_state TEXT,
    lab_address_zip TEXT,
    lab_phone TEXT,
    certificate_type TEXT NOT NULL DEFAULT 'compliance',
    accreditation_body TEXT NOT NULL DEFAULT 'CLIA_ONLY',
    accreditation_body_other TEXT,
    includes_nys INTEGER NOT NULL DEFAULT 0,
    complexity TEXT NOT NULL DEFAULT 'high',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS staff_employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_name TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_initial TEXT,
    title TEXT,
    hire_date TEXT,
    qualifications_text TEXT,
    highest_complexity TEXT NOT NULL DEFAULT 'H',
    performs_testing INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (lab_id) REFERENCES staff_labs(id)
  );

  CREATE TABLE IF NOT EXISTS staff_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    lab_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    specialty_number INTEGER,
    FOREIGN KEY (employee_id) REFERENCES staff_employees(id),
    FOREIGN KEY (lab_id) REFERENCES staff_labs(id)
  );

  CREATE TABLE IF NOT EXISTS staff_competency_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    lab_id INTEGER NOT NULL,
    initial_completed_at TEXT,
    initial_signed_by TEXT,
    six_month_due_at TEXT,
    six_month_completed_at TEXT,
    six_month_signed_by TEXT,
    first_annual_due_at TEXT,
    first_annual_completed_at TEXT,
    first_annual_signed_by TEXT,
    annual_due_at TEXT,
    last_annual_completed_at TEXT,
    last_annual_signed_by TEXT,
    nys_six_month_due_at TEXT,
    notes TEXT,
    FOREIGN KEY (employee_id) REFERENCES staff_employees(id),
    FOREIGN KEY (lab_id) REFERENCES staff_labs(id)
  );
`);

// Seed VeritaStaff demo data for Riverside Regional (user_id = 1)
{
  const existingStaffLab = sqlite.prepare("SELECT id FROM staff_labs WHERE clia_number = '05D2187634'").get() as any;
  if (!existingStaffLab) {
    const now = new Date().toISOString();
    const labResult = sqlite.prepare(
      "INSERT INTO staff_labs (user_id, lab_name, clia_number, lab_address_street, lab_address_city, lab_address_state, lab_address_zip, lab_phone, certificate_type, accreditation_body, includes_nys, complexity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(1, 'Riverside Regional Medical Center', '05D2187634', '1 Riverside Drive', 'Riverside', 'CA', '92501', '', 'accreditation', 'TJC', 0, 'high', now, now);
    const labId = labResult.lastInsertRowid;

    // Employee 1: Laboratory Director
    const emp1 = sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(labId, 1, 'Director', 'Laboratory', null, 'MD', '2010-01-01', 'Board certified CP and AP', 'H', 1, 'active', now, now);
    const emp1Id = emp1.lastInsertRowid;
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp1Id, labId, 'LD', null);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp1Id, labId, 'TP', null);
    sqlite.prepare(
      "INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, initial_signed_by, six_month_due_at, six_month_completed_at, six_month_signed_by, first_annual_due_at, annual_due_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(emp1Id, labId, '2010-01-15', 'Lab Director', '2010-07-15', '2010-07-10', 'Lab Director', '2011-01-10', '2026-07-10', null);

    // Employee 2: Michael Veri — TS (specialties 1,7,8,9) + GS + TP
    const emp2 = sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(labId, 1, 'Veri', 'Michael', null, 'MLS(ASCP)', '2015-06-01', 'MS Chem, 20 years exp', 'H', 1, 'active', now, now);
    const emp2Id = emp2.lastInsertRowid;
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'TS', 1);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'TS', 7);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'TS', 8);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'TS', 9);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'GS', null);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp2Id, labId, 'TP', null);
    sqlite.prepare(
      "INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, initial_signed_by, six_month_due_at, six_month_completed_at, six_month_signed_by, first_annual_due_at, annual_due_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(emp2Id, labId, '2015-06-05', 'Lab Director', '2015-12-05', '2015-12-01', 'Lab Director', '2016-06-01', '2026-06-01', null);

    // Employee 3: Staff Member — TP only
    const emp3 = sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(labId, 1, 'Member', 'Staff', null, 'MLT(ASCP)', '2022-03-15', 'A.S. Clin Lab Science (NAACLS)', 'H', 1, 'active', now, now);
    const emp3Id = emp3.lastInsertRowid;
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number) VALUES (?, ?, ?, ?)").run(emp3Id, labId, 'TP', null);
    sqlite.prepare(
      "INSERT INTO staff_competency_schedules (employee_id, lab_id, initial_completed_at, initial_signed_by, six_month_due_at, six_month_completed_at, six_month_signed_by, first_annual_due_at, annual_due_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(emp3Id, labId, '2022-03-20', 'Lab Director', '2022-09-20', '2022-09-15', 'Lab Director', '2023-03-15', '2026-03-15', null);

    console.log('[seed] VeritaStaff demo data seeded for Riverside Regional');
  }
}

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
if (!colNames.includes("subscription_expires_at")) sqlite.exec("ALTER TABLE users ADD COLUMN subscription_expires_at TEXT");
if (!colNames.includes("subscription_status")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'free'");
  // Migrate existing paid users: set subscription_status = 'active' for users with an active plan
  sqlite.exec("UPDATE users SET subscription_status = 'active' WHERE plan IN ('starter', 'professional', 'lab', 'complete', 'annual')");
}

// Set test accounts (userId 1-11) to active with subscription_expires_at = 2 years from now
const twoYearsFromNow = new Date();
twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
const twoYearsISO = twoYearsFromNow.toISOString();
sqlite.exec(`UPDATE users SET subscription_status = 'active', subscription_expires_at = '${twoYearsISO}' WHERE id <= 11 AND plan = 'lab'`);

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
