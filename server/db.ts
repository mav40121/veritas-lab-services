import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import { OWNER_EMAIL, OWNER_CLIA } from "./constants";
import { existsSync as _dbExistsSync } from "fs";

// Use /data volume if available (Railway persistent volume), otherwise local
const DB_PATH = process.env.DB_PATH || (_dbExistsSync('/data') ? '/data/veritas.db' : 'veritas.db');
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
    created_by_user_id INTEGER,
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

  CREATE TABLE IF NOT EXISTS invoice_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    lab_name TEXT NOT NULL,
    clia_number TEXT,
    billing_contact_name TEXT NOT NULL,
    billing_contact_email TEXT NOT NULL,
    billing_address TEXT NOT NULL,
    ap_email TEXT,
    tax_id TEXT,
    tier TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 1,
    promo_code TEXT,
    discount_pct INTEGER NOT NULL DEFAULT 0,
    trial_days INTEGER NOT NULL DEFAULT 0,
    po_number TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    invoice_sent_at TEXT,
    stripe_invoice_id TEXT
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
    created_at TEXT NOT NULL,
    trial_days INTEGER,
    expires_at TEXT
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

  CREATE TABLE IF NOT EXISTS veritamap_test_correlations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    test_a_id INTEGER NOT NULL,
    test_b_id INTEGER NOT NULL,
    correlation_group_id INTEGER,
    correlation_method TEXT,
    acceptable_criteria TEXT,
    actual_bias_or_sd TEXT,
    pass_fail TEXT,
    work_performed_date TEXT,
    signoff_date TEXT,
    signoff_by_user_id INTEGER,
    signoff_by_name TEXT,
    next_due TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (test_a_id <= test_b_id)
  );
  CREATE INDEX IF NOT EXISTS idx_corr_test_a ON veritamap_test_correlations(test_a_id);
  CREATE INDEX IF NOT EXISTS idx_corr_test_b ON veritamap_test_correlations(test_b_id);
  CREATE INDEX IF NOT EXISTS idx_corr_next_due ON veritamap_test_correlations(next_due);
  CREATE INDEX IF NOT EXISTS idx_corr_group ON veritamap_test_correlations(correlation_group_id);
  CREATE INDEX IF NOT EXISTS idx_corr_signoff_date ON veritamap_test_correlations(signoff_date);

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

  -- VeritaScan Evidence Redesign Phase A (2026-06-02)
  -- URL pointers only. No file content ever lands on VeritaAssure.
  -- See project_veritascan_url_pointers_only memory for the architectural
  -- decision and VeritaScan_Evidence_Redesign_Design_v3.md for the build doc.
  CREATE TABLE IF NOT EXISTS lab_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    document_type TEXT NOT NULL,
    display_label TEXT,
    external_url TEXT NOT NULL,
    storage_provider TEXT,
    version TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    superseded_by_document_id INTEGER,
    effective_date TEXT,
    review_due_date TEXT,
    linked_at TEXT NOT NULL,
    linked_by_user_id INTEGER NOT NULL
  );

  -- Phase B (2026-06-02): the accreditor column from Phase A's first cut was
  -- wrong. Each VeritaScan SCAN_ITEMS row is a single numeric id that carries
  -- citations across all 5 accreditors (tjc, cap, cfr, aabb, cola) as fields
  -- on the row. Accreditor is a property of the item's citation, not of the
  -- link. Schema migration below drops the prior table if it has the old
  -- accreditor column (safe because Phase A landed the table empty).
  CREATE TABLE IF NOT EXISTS document_checklist_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    checklist_item_id INTEGER NOT NULL,
    notes TEXT,
    linked_by_user_id INTEGER NOT NULL,
    linked_at TEXT NOT NULL,
    UNIQUE(document_id, checklist_item_id)
  );

  CREATE TABLE IF NOT EXISTS lab_document_type_defaults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    document_type TEXT NOT NULL,
    default_review_days INTEGER,
    UNIQUE(lab_id, document_type)
  );

  -- Wave A1.5 (2026-06-06): Cross-link slots so other VeritaAssure
  -- modules can attach a VeritaScan document as evidence. The existing
  -- document_checklist_links table targets the static SCAN_ITEMS
  -- checklist; this table targets module records (VeritaPolicy policy,
  -- VeritaComp program / assessment, VeritaCheck study,
  -- VeritaResponse citation, etc.). One row per
  -- (document, target_module, target_entity_id); the UNIQUE constraint
  -- below prevents duplicate links to the same target. lab_id is
  -- denormalized for fast lab-scoped queries (matches the lab_documents
  -- pattern).
  CREATE TABLE IF NOT EXISTS lab_document_cross_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    target_module TEXT NOT NULL,
    target_entity_id INTEGER NOT NULL,
    target_entity_label TEXT,
    notes TEXT,
    linked_at TEXT NOT NULL,
    linked_by_user_id INTEGER NOT NULL,
    UNIQUE(document_id, target_module, target_entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_lab_documents_lab_status ON lab_documents(lab_id, status);
  CREATE INDEX IF NOT EXISTS idx_lab_documents_lab_type   ON lab_documents(lab_id, document_type);
  CREATE INDEX IF NOT EXISTS idx_doc_links_item            ON document_checklist_links(checklist_item_id);
  CREATE INDEX IF NOT EXISTS idx_doc_links_doc             ON document_checklist_links(document_id);
  -- Wave A1.5 (2026-06-06): cross-link indexes for the by-document
  -- and by-target lookups (the two read paths the endpoints serve).
  CREATE INDEX IF NOT EXISTS idx_doc_xlinks_doc            ON lab_document_cross_links(document_id);
  CREATE INDEX IF NOT EXISTS idx_doc_xlinks_target         ON lab_document_cross_links(target_module, target_entity_id);
  CREATE INDEX IF NOT EXISTS idx_doc_xlinks_lab            ON lab_document_cross_links(lab_id);

  CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    source TEXT NOT NULL DEFAULT 'website',
    subscribed_at TEXT NOT NULL,
    unsubscribed_at TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS backup_integrity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at TEXT NOT NULL DEFAULT (datetime('now')),
    file_size_bytes INTEGER,
    sqlite_integrity_check TEXT,
    user_count INTEGER,
    study_count INTEGER,
    table_count INTEGER,
    all_ok INTEGER NOT NULL,
    details_json TEXT
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
    can_adjust_inventory INTEGER NOT NULL DEFAULT 0,
    can_view_audit INTEGER NOT NULL DEFAULT 0,
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

  CREATE TABLE IF NOT EXISTS staff_position_descriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    title TEXT,
    description TEXT,
    updated_at TEXT NOT NULL,
    updated_by_user_id INTEGER,
    UNIQUE(lab_id, role),
    FOREIGN KEY (lab_id) REFERENCES labs(id)
  );

  CREATE TABLE IF NOT EXISTS staff_duty_change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    detected_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_assessment_id INTEGER,
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (employee_id) REFERENCES staff_employees(id),
    FOREIGN KEY (instrument_id) REFERENCES veritamap_instruments(id)
  );

  CREATE TABLE IF NOT EXISTS lab_certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    cert_type TEXT NOT NULL DEFAULT 'other',
    cert_name TEXT NOT NULL,
    cert_number TEXT,
    issuing_body TEXT,
    issued_date TEXT,
    expiration_date TEXT,
    lab_director TEXT,
    notes TEXT,
    is_auto_populated INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS lab_certificate_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT,
    file_data BLOB,
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (certificate_id) REFERENCES lab_certificates(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS lab_certificate_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    reminder_type TEXT NOT NULL,
    scheduled_date TEXT NOT NULL,
    sent_at TEXT,
    is_sent INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (certificate_id) REFERENCES lab_certificates(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
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

  CREATE TABLE IF NOT EXISTS pt_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    specialty TEXT NOT NULL,
    pt_provider TEXT NOT NULL,
    program_code TEXT,
    enrollment_year INTEGER NOT NULL,
    enrollment_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pt_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    enrollment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    event_id TEXT,
    event_name TEXT,
    event_date TEXT NOT NULL,
    analyte TEXT NOT NULL,
    your_result REAL,
    your_method TEXT,
    peer_mean REAL,
    peer_sd REAL,
    peer_n INTEGER,
    acceptable_low REAL,
    acceptable_high REAL,
    sdi REAL,
    pass_fail TEXT NOT NULL DEFAULT 'pending',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pt_corrective_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    root_cause TEXT,
    corrective_action TEXT NOT NULL,
    preventive_action TEXT,
    responsible_person TEXT,
    date_initiated TEXT NOT NULL,
    date_completed TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    verified_by TEXT,
    verified_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pt_enrollments_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    vendor TEXT NOT NULL CHECK(vendor IN ('CAP', 'API', 'WSLH', 'Other')),
    program_name TEXT NOT NULL,
    pt_category TEXT NOT NULL,
    year_enrolled INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS aa_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN (
      'split_sample_external','split_sample_internal','blind_replicate',
      'calibration_verif_material','peer_group','manufacturer_material',
      'clinical_correlation','other'
    )),
    method_notes TEXT,
    frequency_per_year INTEGER NOT NULL DEFAULT 2 CHECK(frequency_per_year >= 2),
    last_performed_date TEXT,
    next_due_date TEXT,
    acceptance_criteria TEXT,
    last_result_summary TEXT,
    last_pass_fail TEXT CHECK(last_pass_fail IN ('pass','fail','pending') OR last_pass_fail IS NULL),
    corrective_action_notes TEXT,
    director_reviewed_at TEXT,
    director_id INTEGER,
    retention_through_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

// aa_records migration block (idempotent). Per New DB Table Rule (CLAUDE.md
// Section 8): every new CREATE TABLE ships with a PRAGMA-guarded ALTER block
// so columns added in later versions can be applied to live DBs that already
// have the table. v1 ships with the full column list above; this block exists
// so future column additions follow the established pattern. Parking-lot #18
// Phase 2.
{
  try {
    const aaCols = sqlite.prepare("PRAGMA table_info(aa_records)").all() as { name: string }[];
    const aaColNames = aaCols.map((c) => c.name);
    if (aaColNames.length > 0) {
      // Future ALTER TABLE aa_records ADD COLUMN ... blocks go here, mirroring the pattern in
      // veritamap_instruments and other migration blocks below.
    }
  } catch {
    // table doesn't exist yet (fresh DB); the CREATE above handled it
  }
}

// pt_enrollments_v2 vendor-CHECK migration (idempotent).
// SQLite cannot ALTER an existing CHECK constraint in place — the column
// must be rebuilt. This block reads the live table definition from
// sqlite_master and rebuilds the table if the constraint does not yet
// include 'WSLH'. Existing rows are preserved. Parking-lot #15.
{
  try {
    const row = sqlite.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='pt_enrollments_v2'"
    ).get() as { sql?: string } | undefined;
    const existingSql = row?.sql || "";
    if (existingSql && !existingSql.includes("'WSLH'")) {
      sqlite.exec(`
        BEGIN TRANSACTION;
        CREATE TABLE pt_enrollments_v2_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          vendor TEXT NOT NULL CHECK(vendor IN ('CAP', 'API', 'WSLH', 'Other')),
          program_name TEXT NOT NULL,
          pt_category TEXT NOT NULL,
          year_enrolled INTEGER NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO pt_enrollments_v2_new (id, user_id, vendor, program_name, pt_category, year_enrolled, created_at)
          SELECT id, user_id, vendor, program_name, pt_category, year_enrolled, created_at FROM pt_enrollments_v2;
        DROP TABLE pt_enrollments_v2;
        ALTER TABLE pt_enrollments_v2_new RENAME TO pt_enrollments_v2;
        COMMIT;
      `);
      console.log("[migration] pt_enrollments_v2 vendor CHECK rebuilt to include 'WSLH'");
    }
  } catch (e) {
    console.warn("[migration] pt_enrollments_v2 WSLH CHECK rebuild failed:", e);
  }
}

// Add serial_number column to veritamap_instruments if upgrading
{
  const instrCols = sqlite.prepare("PRAGMA table_info(veritamap_instruments)").all() as { name: string }[];
  const instrColNames = instrCols.map((c) => c.name);
  if (!instrColNames.includes("serial_number")) {
    try { sqlite.exec("ALTER TABLE veritamap_instruments ADD COLUMN serial_number TEXT"); } catch {}
  }
  if (!instrColNames.includes("nickname")) {
    try { sqlite.exec("ALTER TABLE veritamap_instruments ADD COLUMN nickname TEXT"); } catch {}
  }
}

// veritamap_test_correlations migration block (idempotent)
// Per New DB Table Rule: every new CREATE TABLE ships with a PRAGMA-guarded ALTER block.
// Adds sign-off audit columns to any DB that has an earlier version of the table.
//
// 2026-05-03 reshape: a correlation is one record about ONE analyte that has
// 2+ methods on it. The original v1 schema modeled it as test_a_id <-> test_b_id
// with CHECK(a<b) + UNIQUE(a,b). That was wrong: it can't represent the most
// common kind of correlation — Pri vs Backup running the same analyte on the
// same map (one test row, multiple instruments listed in instrument_source).
//
// Reshape: test_b_id becomes optional. NULL means "single-row multi-method
// correlation on this analyte." Non-NULL preserves cross-row pairing for any
// future cross-map use. CHECK and UNIQUE constraints removed because (a) self-
// referencing rows are valid, and (b) a single test row may carry multiple
// distinct studies (different group_ids).
{
  const corrCols = sqlite.prepare("PRAGMA table_info(veritamap_test_correlations)").all() as { name: string }[];
  const corrColNames = corrCols.map((c) => c.name);
  if (!corrColNames.includes("work_performed_date")) {
    try { sqlite.exec("ALTER TABLE veritamap_test_correlations ADD COLUMN work_performed_date TEXT"); } catch {}
  }
  if (!corrColNames.includes("signoff_date")) {
    try { sqlite.exec("ALTER TABLE veritamap_test_correlations ADD COLUMN signoff_date TEXT"); } catch {}
  }
  if (!corrColNames.includes("signoff_by_user_id")) {
    try { sqlite.exec("ALTER TABLE veritamap_test_correlations ADD COLUMN signoff_by_user_id INTEGER"); } catch {}
  }
  if (!corrColNames.includes("signoff_by_name")) {
    try { sqlite.exec("ALTER TABLE veritamap_test_correlations ADD COLUMN signoff_by_name TEXT"); } catch {}
  }

  // Detect legacy v1 shape (CHECK constraint or UNIQUE on test_b_id) by
  // querying sqlite_master and rebuilding the table if found. SQLite cannot
  // drop a CHECK constraint or change a UNIQUE in place; the safe path is
  // CREATE new + COPY + DROP old + RENAME, all inside a single transaction.
  const corrTblSql = (sqlite.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='veritamap_test_correlations'"
  ).get() as { sql?: string } | undefined)?.sql ?? "";
  const hasLegacyCheck = /CHECK\s*\(\s*test_a_id\s*<\s*test_b_id\s*\)/i.test(corrTblSql);
  const hasLegacyUnique = /UNIQUE\s*\(\s*test_a_id\s*,\s*test_b_id\s*\)/i.test(corrTblSql);
  // Legacy: CHECK(a<b) blocks self-pairs (intra-row Pri↔Backup correlations).
  // Legacy: UNIQUE(a,b) blocks multiple distinct studies on the same test row.
  // New shape relaxes both: CHECK(a<=b) so test_a_id == test_b_id is allowed,
  // no UNIQUE so a single test row can carry multiple studies (group_ids).
  const hasOldCheckLT = /CHECK\s*\(\s*test_a_id\s*<\s*test_b_id\s*\)/i.test(corrTblSql);
  const needsReshape = hasOldCheckLT || hasLegacyUnique;
  if (needsReshape) {
    try {
      sqlite.exec("BEGIN");
      sqlite.exec(`
        CREATE TABLE veritamap_test_correlations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          test_a_id INTEGER NOT NULL,
          test_b_id INTEGER NOT NULL,
          correlation_group_id INTEGER,
          correlation_method TEXT,
          acceptable_criteria TEXT,
          actual_bias_or_sd TEXT,
          pass_fail TEXT,
          work_performed_date TEXT,
          signoff_date TEXT,
          signoff_by_user_id INTEGER,
          signoff_by_name TEXT,
          next_due TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (test_a_id <= test_b_id)
        )
      `);
      sqlite.exec(`
        INSERT INTO veritamap_test_correlations_new
          (id, test_a_id, test_b_id, correlation_group_id, correlation_method,
           acceptable_criteria, actual_bias_or_sd, pass_fail,
           work_performed_date, signoff_date, signoff_by_user_id, signoff_by_name,
           next_due, notes, created_at, updated_at)
        SELECT id, test_a_id, test_b_id, correlation_group_id, correlation_method,
           acceptable_criteria, actual_bias_or_sd, pass_fail,
           work_performed_date, signoff_date, signoff_by_user_id, signoff_by_name,
           next_due, notes, created_at, updated_at
        FROM veritamap_test_correlations
      `);
      sqlite.exec("DROP TABLE veritamap_test_correlations");
      sqlite.exec("ALTER TABLE veritamap_test_correlations_new RENAME TO veritamap_test_correlations");
      sqlite.exec("COMMIT");
      console.log("[migration] veritamap_test_correlations reshaped: CHECK relaxed to a<=b, UNIQUE(a,b) removed");
    } catch (err) {
      try { sqlite.exec("ROLLBACK"); } catch {}
      console.error("[migration] veritamap_test_correlations reshape failed:", err);
    }
  }

  // Defensive: ensure indexes exist even on DBs upgraded from a partial schema
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_corr_test_a ON veritamap_test_correlations(test_a_id)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_corr_test_b ON veritamap_test_correlations(test_b_id)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_corr_next_due ON veritamap_test_correlations(next_due)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_corr_group ON veritamap_test_correlations(correlation_group_id)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_corr_signoff_date ON veritamap_test_correlations(signoff_date)"); } catch {}
}

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
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('DEMO2026', 'VeritaAssure Demo', 100, 'all', NULL, 0, 1, '${new Date().toISOString()}');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at)
  VALUES ('TdFkdMWg', 'Community Hospital 1yr Free (10 users)', 100, 'all', NULL, 0, 1, '${new Date().toISOString()}');
`);

// Migrate discount_codes schema BEFORE seeding conference codes (which reference these columns).
// On production volumes the table already exists from a prior boot without these columns,
// so the create-if-not-exists statement above becomes a no-op and we must ALTER first.
const dcCols = (sqlite.prepare("PRAGMA table_info(discount_codes)").all() as { name: string }[]).map(c => c.name);
if (!dcCols.includes("expires_at")) {
  sqlite.exec("ALTER TABLE discount_codes ADD COLUMN expires_at TEXT");
  // Backfill existing conference codes (year embedded in code) with end-of-year expiry
  sqlite.exec(`UPDATE discount_codes SET expires_at = '2026-12-31T23:59:59Z' WHERE expires_at IS NULL AND (code LIKE '%2026' OR code LIKE 'COLA%' OR code LIKE 'SUMMIT%' OR code LIKE 'MAYO%' OR code LIKE 'NELC%')`);
}
if (!dcCols.includes("trial_days")) {
  sqlite.exec("ALTER TABLE discount_codes ADD COLUMN trial_days INTEGER");
}

// Seed conference codes (10% off + 60-day trial; expire at end of conference year)
// All four follow the same shape per standing handoff: COLA2026 is the template.
sqlite.exec(`
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at, trial_days, expires_at)
  VALUES ('COLA2026',   'COLA Lab Enrichment Forum 2026',                  10, 'annual', NULL, 0, 1, '${new Date().toISOString()}', 60, '2026-12-31T23:59:59Z');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at, trial_days, expires_at)
  VALUES ('SUMMIT2026', 'ACLA Annual Summit 2026',                          10, 'annual', NULL, 0, 1, '${new Date().toISOString()}', 60, '2026-12-31T23:59:59Z');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at, trial_days, expires_at)
  VALUES ('MAYO2026',   'Mayo Clinic Laboratory Symposium 2026',            10, 'annual', NULL, 0, 1, '${new Date().toISOString()}', 60, '2026-12-31T23:59:59Z');
  INSERT OR IGNORE INTO discount_codes (code, partner_name, discount_pct, applies_to, max_uses, uses, active, created_at, trial_days, expires_at)
  VALUES ('NELC2026',   'Northeast Laboratory Conference 2026',             10, 'annual', NULL, 0, 1, '${new Date().toISOString()}', 60, '2026-12-31T23:59:59Z');
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

// ── Freemium-cap loophole fix (May 2026) ──────────────────────────────────────
// Pre-existing accounts (granted free for 1 year, seat invitees, internal
// testers) must not be retroactively capped. New signups going forward who pick
// a paid plan label without paying must hit the 4-instrument / 10-analyte cap.
// `grandfathered` is set ONCE at migration time on every account that exists
// at that moment. Any user created after this migration runs starts with
// grandfathered = 0 and is subject to the cap unless their owner has
// subscription_status='active' or grandfathered=1.
if (!colNames.includes("grandfathered")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN grandfathered INTEGER NOT NULL DEFAULT 0");
  // Backfill: every existing user gets grandfathered = 1 EXCEPT id = 28
  // (drsmohsin@yahoo.com — Sheher Mohsin, signed up Apr 30, never returned;
  // serves as the canonical "new freemium signup" test case).
  sqlite.exec("UPDATE users SET grandfathered = 1 WHERE id != 28");
}

// Invoice requests table — ALTER migrations for upgrades from older schemas
const invoiceCols = sqlite.prepare("PRAGMA table_info(invoice_requests)").all() as { name: string }[];
const invoiceColNames = invoiceCols.map((c) => c.name);
const invoiceMigrations: [string, string][] = [
  ["user_id", "INTEGER"],
  ["clia_number", "TEXT"],
  ["ap_email", "TEXT"],
  ["tax_id", "TEXT"],
  ["promo_code", "TEXT"],
  ["discount_pct", "INTEGER NOT NULL DEFAULT 0"],
  ["trial_days", "INTEGER NOT NULL DEFAULT 0"],
  ["po_number", "TEXT"],
  ["notes", "TEXT"],
  ["paid_at", "TEXT"],
  ["invoice_sent_at", "TEXT"],
  ["stripe_invoice_id", "TEXT"],
];
for (const [col, colType] of invoiceMigrations) {
  if (!invoiceColNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE invoice_requests ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Add CLIA and seat/session columns to users table
const cliaUserCols: [string, string][] = [
  ["clia_number", "TEXT"],
  ["clia_lab_name", "TEXT"],
  ["clia_address", "TEXT"],
  ["clia_director", "TEXT"],
  ["clia_specialty_count", "INTEGER"],
  ["clia_certificate_type", "TEXT"],
  ["clia_tier", "TEXT"],
  ["clia_verified_at", "TEXT"],
  ["seat_count", "INTEGER DEFAULT 1"],
  ["plan_expires_at", "TEXT"],
];
for (const [col, colType] of cliaUserCols) {
  if (!colNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE users ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Create user_seats table for named seat management
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER NOT NULL,
    seat_email TEXT NOT NULL,
    seat_user_id INTEGER,
    invited_at TEXT,
    accepted_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  );
`);

// Create user_sessions table for session limiting
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_token TEXT UNIQUE NOT NULL,
    device_info TEXT,
    created_at TEXT NOT NULL,
    last_active TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Founding Lab Program applications. Prospects submit this form via the public
// /founding-lab/apply page. No auth gate, no PHI. Triages into the sales
// pipeline (Michael reviews + responds out of band). See
// project_cola_pricing_grandfather_policy.md for the program structure.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS founding_lab_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    lab_name TEXT NOT NULL,
    clia_number TEXT,
    contact_name TEXT NOT NULL,
    contact_title TEXT,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    lab_type TEXT,
    tier_of_interest TEXT,
    approximate_seat_count INTEGER,
    why_founder TEXT,
    marketing_logo_approval INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_founder_apps_submitted_at ON founding_lab_applications(submitted_at DESC)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_founder_apps_status ON founding_lab_applications(status)`); } catch {}

// Owner account - permanent free access (never downgrade from a higher plan).
// Email sourced from OWNER_EMAIL env (default preserves prior hardcoded value).
const ownerRow = sqlite.prepare("SELECT plan FROM users WHERE email = ?").get(OWNER_EMAIL) as any;
const PLAN_RANK: Record<string, number> = { free: 0, per_study: 1, veritacheck_only: 2, community: 3, lab: 4, hospital: 5, large_hospital: 6, enterprise: 7, waived: 7 };
const ownerCurrentRank = PLAN_RANK[ownerRow?.plan] ?? 0;
const ownerTargetRank = PLAN_RANK["enterprise"] ?? 7;
if (!ownerRow || ownerCurrentRank <= ownerTargetRank) {
  sqlite.prepare(
    "UPDATE users SET plan = 'enterprise', study_credits = 99999, subscription_status = 'active', subscription_expires_at = '2099-12-31T00:00:00.000Z', plan_expires_at = '2099-12-31T00:00:00.000Z' WHERE email = ?"
  ).run(OWNER_EMAIL);
}

// Set test accounts (userId 1-11) to active with subscription_expires_at = 2 years from now
const twoYearsFromNow = new Date();
twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
const twoYearsISO = twoYearsFromNow.toISOString();
sqlite.exec(`UPDATE users SET subscription_status = 'active', subscription_expires_at = '${twoYearsISO}' WHERE id <= 11 AND plan = 'lab'`);

// Add onboarding_seen column for Getting Started page tracking
if (!colNames.includes("onboarding_seen")) {
  sqlite.exec("ALTER TABLE users ADD COLUMN onboarding_seen INTEGER DEFAULT 0");
}

// Add HIPAA acknowledgment columns
if (!colNames.includes("hipaa_acknowledged")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN hipaa_acknowledged INTEGER DEFAULT 0"); } catch {}
}
if (!colNames.includes("hipaa_acknowledged_at")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN hipaa_acknowledged_at TEXT"); } catch {}
}

// Add preferred_standards column for lab-level accreditation selector
if (!colNames.includes("preferred_standards")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN preferred_standards TEXT DEFAULT NULL"); } catch {}
}

// Add preferred PT vendor column for VeritaPT(TM) vendor preference
if (!colNames.includes("preferred_pt_vendor")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN preferred_pt_vendor TEXT DEFAULT 'none'"); } catch {}
}

// UI preferences (JSON) — per-user front-end settings that need persistence
// across sessions and devices. First consumer: VeritaStock column visibility
// (Pfizer demo follow-up 2026-05-19). Stored as JSON text rather than
// individual columns so new preference keys can land without a schema bump.
// Shape: { veritastock_hidden_columns?: string[], ... }
if (!colNames.includes("ui_preferences")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN ui_preferences TEXT DEFAULT '{}'"); } catch {}
}

// Add permissions column to user_seats for per-module view/edit permissions
try {
  sqlite.prepare(`ALTER TABLE user_seats ADD COLUMN permissions TEXT DEFAULT '{}'`).run();
} catch {}

// Add invite_token column to user_seats for token-based invitation flow
try {
  sqlite.prepare(`ALTER TABLE user_seats ADD COLUMN invite_token TEXT`).run();
} catch {}

// Add lab_id column to user_seats for proper multi-lab scoping.
// Before this, user_seats was owner-pooled (owner_user_id only), which meant
// a multi-lab owner saw pending invites for all of their labs on every lab's
// Members view. With lab_id populated, we can scope pending invites per-lab.
// Retroactive populate runs once: for active seats, set lab_id from the
// (single) matching lab_members row; for ambiguous cases (multi-lab owner
// with shared invitee), leave NULL so the legacy owner-pooled fallback applies.
{
  const usCols = (sqlite.prepare("PRAGMA table_info(user_seats)").all() as { name: string }[]).map((c) => c.name);
  if (!usCols.includes("lab_id")) {
    try { sqlite.exec("ALTER TABLE user_seats ADD COLUMN lab_id INTEGER"); } catch {}
    // Retroactive populate: active seats with exactly one matching lab_members row.
    try {
      sqlite.exec(`
        UPDATE user_seats
        SET lab_id = (
          SELECT lm.lab_id FROM lab_members lm
          WHERE lm.user_id = user_seats.seat_user_id AND lm.status = 'active'
          LIMIT 1
        )
        WHERE lab_id IS NULL
          AND status = 'active'
          AND seat_user_id IS NOT NULL
          AND (
            SELECT COUNT(*) FROM lab_members lm2
            WHERE lm2.user_id = user_seats.seat_user_id AND lm2.status = 'active'
          ) = 1
      `);
    } catch (e: any) {
      console.warn("[user_seats lab_id retro-populate] failed:", e?.message);
    }
  }
  // Index for the per-lab pending-invite query.
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_user_seats_lab_owner_status ON user_seats(lab_id, owner_user_id, status)"); } catch {}

  // Seat-type split (parking-lot #33 PR 1 foundation). Defaults every
  // existing row to 'active' so behavior is unchanged for current
  // customers. The counting gate (only active seats counted against
  // the tier cap, view-only seats capped per tier with a $99/yr add-on
  // for extras) ships in a later PR; this commit only adds the column
  // so the invite flow and counting logic can reference it cleanly.
  if (!usCols.includes("seat_type")) {
    try { sqlite.exec("ALTER TABLE user_seats ADD COLUMN seat_type TEXT NOT NULL DEFAULT 'active'"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_user_seats_owner_type_status ON user_seats(owner_user_id, seat_type, status)"); } catch {}
}

// Add VeritaScan item columns if upgrading
const scanItemCols = sqlite.prepare("PRAGMA table_info(veritascan_items)").all() as { name: string }[];
const scanColNames = scanItemCols.map((c) => c.name);
if (!scanColNames.includes("completion_source")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_source TEXT DEFAULT 'manual'");
if (!scanColNames.includes("completion_link")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_link TEXT");
if (!scanColNames.includes("completion_note")) sqlite.exec("ALTER TABLE veritascan_items ADD COLUMN completion_note TEXT");

// VeritaScan Evidence Phase A migration safety net (2026-06-02)
// The three new tables (lab_documents, document_checklist_links,
// lab_document_type_defaults) are created via CREATE TABLE IF NOT EXISTS
// above. The PRAGMA blocks below catch the case where an older Railway
// volume already has the table from a prior deploy but is missing a
// column added later. Per NEW DB TABLE RULE (CLAUDE.md §8).
const labDocCols = (sqlite.prepare("PRAGMA table_info(lab_documents)").all() as { name: string }[]).map(c => c.name);
const labDocColumnDefs: [string, string][] = [
  ["display_label", "TEXT"],
  ["storage_provider", "TEXT"],
  ["version", "TEXT"],
  ["superseded_by_document_id", "INTEGER"],
  ["effective_date", "TEXT"],
  ["review_due_date", "TEXT"],
  ["description", "TEXT"],
  // Wave A1.3 (2026-06-06): per-link owner attestation. Surveyor-
  // defensibility move 2 — the artifact needs to say WHO inside the lab
  // attests that this URL points to the authoritative document, and
  // WHEN they last attested. owner_name is captured at attestation time
  // so future user-record name changes don't rewrite history.
  ["owner_user_id", "INTEGER"],
  ["owner_name", "TEXT"],
  ["owner_attested_at", "TEXT"],
];

// Wave A1.5 (2026-06-06): migration safety net for the new
// lab_document_cross_links table. Per CLAUDE.md §8 NEW DB TABLE RULE.
// The earlier table-create statement lands the full shape on a fresh
// volume; this PRAGMA block fills in any column that was missing on an
// older volume if a prior deploy created the table with a subset.
const labDocXlinkCols = (sqlite.prepare("PRAGMA table_info(lab_document_cross_links)").all() as { name: string }[]).map(c => c.name);
const labDocXlinkColumnDefs: [string, string][] = [
  ["lab_id", "INTEGER NOT NULL DEFAULT 0"],
  ["document_id", "INTEGER NOT NULL DEFAULT 0"],
  ["target_module", "TEXT NOT NULL DEFAULT ''"],
  ["target_entity_id", "INTEGER NOT NULL DEFAULT 0"],
  ["target_entity_label", "TEXT"],
  ["notes", "TEXT"],
  ["linked_at", "TEXT NOT NULL DEFAULT ''"],
  ["linked_by_user_id", "INTEGER NOT NULL DEFAULT 0"],
];
for (const [col, colType] of labDocXlinkColumnDefs) {
  if (!labDocXlinkCols.includes(col)) {
    try { sqlite.exec(`ALTER TABLE lab_document_cross_links ADD COLUMN ${col} ${colType}`); } catch {}
  }
}
for (const [col, type] of labDocColumnDefs) {
  if (!labDocCols.includes(col)) sqlite.exec(`ALTER TABLE lab_documents ADD COLUMN ${col} ${type}`);
}

// Phase B (2026-06-02) schema fix: drop the prior table if it carries the
// pre-Phase-B accreditor column, because the new shape removed accreditor.
// Safe because Phase A landed an empty table in prod that nothing yet
// references. The CREATE TABLE above re-creates the correct shape on this
// same boot pass.
const docLinkColsRaw = sqlite.prepare("PRAGMA table_info(document_checklist_links)").all() as { name: string }[];
const docLinkCols = docLinkColsRaw.map(c => c.name);
if (docLinkCols.includes("accreditor")) {
  sqlite.exec("DROP TABLE document_checklist_links");
  // Re-create with the new shape so we do not need a second boot pass.
  sqlite.exec(`CREATE TABLE document_checklist_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    checklist_item_id INTEGER NOT NULL,
    notes TEXT,
    linked_by_user_id INTEGER NOT NULL,
    linked_at TEXT NOT NULL,
    UNIQUE(document_id, checklist_item_id)
  )`);
}
const docLinkColsFinal = (sqlite.prepare("PRAGMA table_info(document_checklist_links)").all() as { name: string }[]).map(c => c.name);
if (!docLinkColsFinal.includes("notes")) sqlite.exec("ALTER TABLE document_checklist_links ADD COLUMN notes TEXT");

const docDefaultsCols = (sqlite.prepare("PRAGMA table_info(lab_document_type_defaults)").all() as { name: string }[]).map(c => c.name);
if (!docDefaultsCols.includes("default_review_days")) sqlite.exec("ALTER TABLE lab_document_type_defaults ADD COLUMN default_review_days INTEGER");

// Add specimen_info column to competency_assessment_items if upgrading
const compItemCols = sqlite.prepare("PRAGMA table_info(competency_assessment_items)").all() as { name: string }[];
const compItemColNames = compItemCols.map((c) => c.name);
if (!compItemColNames.includes("specimen_info")) sqlite.exec("ALTER TABLE competency_assessment_items ADD COLUMN specimen_info TEXT");

// Add new element-specific columns to competency_assessment_items (VeritaComp redesign)
const newCompItemCols: [string, string][] = [
  ["element_number", "INTEGER"],
  ["method_group_name", "TEXT"],
  ["el1_specimen_id", "TEXT"],
  ["el1_observer_initials", "TEXT"],
  ["el2_evidence", "TEXT"],
  ["el2_date", "TEXT"],
  ["el3_qc_date", "TEXT"],
  ["el4_date_observed", "TEXT"],
  ["el4_observer_initials", "TEXT"],
  ["el5_sample_type", "TEXT"],
  ["el5_sample_id", "TEXT"],
  ["el5_acceptable", "INTEGER"],
  ["el6_quiz_id", "TEXT"],
  ["el6_score", "INTEGER"],
  ["el6_date_taken", "TEXT"],
  ["waived_instrument", "TEXT"],
  ["waived_test", "TEXT"],
  ["waived_method_number", "INTEGER"],
  ["waived_evidence", "TEXT"],
  ["waived_date", "TEXT"],
  ["waived_initials", "TEXT"],
  ["nt_item_label", "TEXT"],
  ["nt_item_description", "TEXT"],
  ["nt_date_met", "TEXT"],
  ["nt_employee_initials", "TEXT"],
  ["nt_supervisor_initials", "TEXT"],
  // Per-element N/A toggle + required justification (VeritaComp N/A support)
  ["el1_na", "INTEGER"],
  ["el1_na_justification", "TEXT"],
  ["el2_na", "INTEGER"],
  ["el2_na_justification", "TEXT"],
  ["el3_na", "INTEGER"],
  ["el3_na_justification", "TEXT"],
  ["el4_na", "INTEGER"],
  ["el4_na_justification", "TEXT"],
  ["el5_na", "INTEGER"],
  ["el5_na_justification", "TEXT"],
  ["el6_na", "INTEGER"],
  ["el6_na_justification", "TEXT"],
];
for (const [col, colType] of newCompItemCols) {
  if (!compItemColNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_assessment_items ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// VeritaComp Customer-Blockers Wave (2026-06-05): completion sign-off and
// review-period columns on competency_assessments. Customer report from
// San Carlos: no way to mark an assessment as "fully signed off and done"
// (so they can't close out the 2026 cycle), and no place to record the
// review period that the competency covers. Adds:
//   - completion_date: stamped when a supervisor clicks "Sign & Complete"
//   - final_signed_by_user_id: user_id that clicked Sign & Complete (audit)
//   - locked: 1 once signed-off; PUT handler refuses edits while locked.
//     Owner/admin can flip back to 0 via a separate Unlock endpoint.
//   - review_period_start / review_period_end: the time window the
//     competency covers (e.g., "calendar year 2026"). Default end is the
//     assessment_date; default start is end minus 365 days.
const compAsmtCols = (sqlite.prepare("PRAGMA table_info(competency_assessments)").all() as { name: string }[]).map(c => c.name);
const newCompAsmtCols: [string, string][] = [
  ["completion_date", "TEXT"],
  ["final_signed_by_user_id", "INTEGER"],
  ["locked", "INTEGER NOT NULL DEFAULT 0"],
  ["review_period_start", "TEXT"],
  ["review_period_end", "TEXT"],
  // PR A of the VeritaComp customer-blockers wave (2026-06-05, item #1):
  // free-text folder for organizing assessments. Null/empty = "No folder".
  // No DB constraint on values; the UI does autocomplete via a distinct-
  // values query so a lab settles into ~5-10 stable folder names organically.
  ["folder", "TEXT"],
];
for (const [col, colType] of newCompAsmtCols) {
  if (!compAsmtCols.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_assessments ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// PR C of the VeritaComp customer-blockers wave (2026-06-05, items #2 + #7):
// per-element document links on assessments + per-employee credential links
// on staff_employees. URL-pointer architecture only (locked memory: VeritaScan
// 2026-06-02): the lab keeps the file in their own SharePoint/Drive/OneDrive
// and we store metadata + URL. This hard-keeps VeritaAssure's no-PHI promise.
//
// The two tables share a near-identical shape because they share a single
// DocumentLinkDialog component on the client; the only divergence is the
// parent-row foreign key (assessment+element vs employee).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS competency_element_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    element_number INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT,
    url TEXT NOT NULL,
    storage_provider TEXT,
    expiration_date TEXT,
    created_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    FOREIGN KEY (assessment_id) REFERENCES competency_assessments(id)
  );
`);
const compDocCols = (sqlite.prepare("PRAGMA table_info(competency_element_documents)").all() as { name: string }[]).map(c => c.name);
const newCompDocCols: [string, string][] = [
  ["doc_type", "TEXT"],
  ["title", "TEXT"],
  ["storage_provider", "TEXT"],
  ["expiration_date", "TEXT"],
  ["created_by_user_id", "INTEGER"],
];
for (const [col, colType] of newCompDocCols) {
  if (!compDocCols.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_element_documents ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staff_employee_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    doc_type TEXT NOT NULL,
    title TEXT,
    url TEXT NOT NULL,
    storage_provider TEXT,
    expiration_date TEXT,
    created_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    FOREIGN KEY (employee_id) REFERENCES staff_employees(id)
  );
`);
const staffDocCols = (sqlite.prepare("PRAGMA table_info(staff_employee_documents)").all() as { name: string }[]).map(c => c.name);
const newStaffDocCols: [string, string][] = [
  ["doc_type", "TEXT"],
  ["title", "TEXT"],
  ["storage_provider", "TEXT"],
  ["expiration_date", "TEXT"],
  ["created_by_user_id", "INTEGER"],
];
for (const [col, colType] of newStaffDocCols) {
  if (!staffDocCols.includes(col)) {
    try { sqlite.exec(`ALTER TABLE staff_employee_documents ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// PR D of the VeritaComp customer-blockers wave (2026-06-05, item #8):
// many-to-many join between staff_employees and veritamap_instruments. Lets
// a lab director assign which instruments an employee actually runs so the
// supervisor sees that context when authoring a competency. The autoload of
// the assessment dialog's method-group tabs from this assignment is a
// follow-up PR (separate mock-first design).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staff_employee_instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    created_by_user_id INTEGER,
    UNIQUE (employee_id, instrument_id),
    FOREIGN KEY (employee_id) REFERENCES staff_employees(id),
    FOREIGN KEY (instrument_id) REFERENCES veritamap_instruments(id)
  );
`);
const empInstrCols = (sqlite.prepare("PRAGMA table_info(staff_employee_instruments)").all() as { name: string }[]).map(c => c.name);
const newEmpInstrCols: [string, string][] = [
  ["created_by_user_id", "INTEGER"],
];
for (const [col, colType] of newEmpInstrCols) {
  if (!empInstrCols.includes(col)) {
    try { sqlite.exec(`ALTER TABLE staff_employee_instruments ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Create competency_quizzes table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS competency_quizzes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 0,
    program_id INTEGER,
    method_group_id INTEGER,
    method_group_name TEXT,
    questions TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
`);

// Phase 4 (quiz builder) columns: title for human-readable quiz name,
// method_group_ids for a quiz that covers multiple method groups in the
// same program (Element 6 picker matches mgId against this array).
// lab_id was added in Phase 3.5 multi-lab migration via dual-write from
// the owning user's record (see routes.ts POST handler).
const compQuizCols = sqlite.prepare("PRAGMA table_info(competency_quizzes)").all() as { name: string }[];
const compQuizColNames = compQuizCols.map((c) => c.name);
const compQuizNewCols: [string, string][] = [
  ["title", "TEXT"],
  ["method_group_ids", "TEXT"],
  ["lab_id", "INTEGER"],
  ["created_by_user_id", "INTEGER"],
  // 2026-06-09: question order randomization for tech-take view. When set,
  // GET /api/veritacomp/quizzes/:id (without ?withAnswers) returns the
  // questions shuffled per request. Builder/preview always sees stored order.
  ["randomize_questions", "INTEGER DEFAULT 0"],
  // 2026-06-09: signal that the `questions[].question` field may contain
  // HTML (sanitized client-side via DOMPurify). Lets the player render
  // inline tables (e.g., ABO/Rh forward/reverse reaction grids) instead of
  // a flat string description. Per-quiz flag so legacy plain-text quizzes
  // keep rendering as plain text.
  ["question_format", "TEXT DEFAULT 'plain'"],
];
for (const [col, colType] of compQuizNewCols) {
  if (!compQuizColNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_quizzes ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Create competency_quiz_results table
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS competency_quiz_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER,
    quiz_id INTEGER NOT NULL,
    employee_id INTEGER NOT NULL,
    answers TEXT NOT NULL DEFAULT '[]',
    score INTEGER NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    date_taken TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (quiz_id) REFERENCES competency_quizzes(id)
  );
`);

// 2026-06-09 PR2: source-tracking columns on competency_quiz_results.
// 'source' distinguishes Staff Portal attempts (CLIA+PIN self-administered)
// from supervisor-driven inline-assessment attempts. 'staff_employee_id'
// captures the universal-roster id (staff_employees.id) so the result
// can be linked back to a Staff Portal assignment even when the bridge
// to competency_employees was auto-created at submit time. Both nullable
// so existing rows keep validating.
const compQuizResultsCols = sqlite.prepare("PRAGMA table_info(competency_quiz_results)").all() as { name: string }[];
const compQuizResultsColNames = compQuizResultsCols.map((c) => c.name);
const compQuizResultsNewCols: [string, string][] = [
  ["source", "TEXT DEFAULT 'inline_assessment'"],
  ["staff_employee_id", "INTEGER"],
  ["typed_signature", "TEXT"],
];
for (const [col, colType] of compQuizResultsNewCols) {
  if (!compQuizResultsColNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_quiz_results ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// 2026-06-09 PR2: per-tech quiz assignments. Created by the director
// from the Assign dialog on a quiz card; consumed by Staff Portal to
// show the tech "Your assigned quizzes" on their tile. One assignment
// per (quiz, staff_employee); status flips from 'assigned' to
// 'completed' when the attempt POSTs. Retakes after completion create
// a new attempt row but don't reset the assignment (the assignment is
// "done"). Director can DELETE only while status='assigned'.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS competency_quiz_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id INTEGER NOT NULL,
    staff_employee_id INTEGER NOT NULL,
    lab_id INTEGER NOT NULL,
    assigned_by_user_id INTEGER NOT NULL,
    assigned_at TEXT NOT NULL,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'assigned',
    completed_result_id INTEGER,
    completed_at TEXT,
    FOREIGN KEY (quiz_id) REFERENCES competency_quizzes(id),
    FOREIGN KEY (staff_employee_id) REFERENCES staff_employees(id)
  );
`);
try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_quiz_assign_quiz ON competency_quiz_assignments(quiz_id)"); } catch {}
try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_quiz_assign_staff_emp ON competency_quiz_assignments(staff_employee_id)"); } catch {}
try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_quiz_assign_lab ON competency_quiz_assignments(lab_id)"); } catch {}
try { sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_assign_unique ON competency_quiz_assignments(quiz_id, staff_employee_id)"); } catch {}

// 2026-06-09 PR2: defensive ALTER block for competency_quiz_assignments.
// Per CLAUDE.md §8 NEW DB TABLE RULE every CREATE TABLE must ship with a
// PRAGMA table_info migration block in the same commit so future column
// additions don't strand on tables that already exist live. Empty for
// now; the pattern is set up for when v2 adds columns (e.g. reminder
// cadence, retake_policy_override).
const compQuizAssignCols = sqlite.prepare("PRAGMA table_info(competency_quiz_assignments)").all() as { name: string }[];
const compQuizAssignColNames = compQuizAssignCols.map((c) => c.name);
const compQuizAssignNewCols: [string, string][] = [];
for (const [col, colType] of compQuizAssignNewCols) {
  if (!compQuizAssignColNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE competency_quiz_assignments ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Seed default VITROS 5600 quiz if not present
{
  const existingQuiz = sqlite.prepare(
    "SELECT id FROM competency_quizzes WHERE user_id = 0 AND method_group_name LIKE '%VITROS 5600%'"
  ).get();
  if (!existingQuiz) {
    const quizQuestions = JSON.stringify([
      {
        id: "q1",
        question: "Which of the following would cause a falsely elevated sodium result on the VITROS 5600?",
        type: "multiple_choice",
        options: ["A. Hemolyzed specimen", "B. Lipemic specimen", "C. Prolonged tourniquet time", "D. Icteric specimen"],
        correct_answer: "B",
        explanation: "Lipemia causes optical/ISE interference on the VITROS 5600, which can falsely elevate sodium values."
      },
      {
        id: "q2",
        question: "A potassium result of 6.8 mEq/L is reported. The patient has no clinical symptoms consistent with hyperkalemia. What is the MOST likely pre-analytical cause?",
        type: "multiple_choice",
        options: ["A. Dilutional error", "B. Reagent degradation", "C. Hemolysis from traumatic venipuncture", "D. Calibration drift"],
        correct_answer: "C",
        explanation: "Hemolysis releases intracellular potassium, causing falsely elevated results. This is the most common pre-analytical cause of spurious hyperkalemia."
      }
    ]);
    sqlite.prepare(
      "INSERT INTO competency_quizzes (user_id, program_id, method_group_id, method_group_name, questions, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(0, null, null, "Chemistry (VITROS 5600)", quizQuestions, new Date().toISOString());
    console.log("[seed] VeritaComp default VITROS 5600 quiz seeded");
  }
}

// Add bed_count, hospital_name, hospital_state columns for hospital lookup signup
const bedCols: [string, string][] = [
  ["bed_count", "INTEGER"],
  ["hospital_name", "TEXT"],
  ["hospital_state", "TEXT"],
];
for (const [col, colType] of bedCols) {
  if (!colNames.includes(col)) {
    try { sqlite.exec(`ALTER TABLE users ADD COLUMN ${col} ${colType}`); } catch {}
  }
}

// Add result column to studies table (stores pass/fail so frontend does not recompute)
try { sqlite.exec("ALTER TABLE studies ADD COLUMN result TEXT"); } catch {}

// Add tea_is_percentage and tea_unit columns to studies table (absolute vs percentage TEa)
try { sqlite.exec("ALTER TABLE studies ADD COLUMN tea_is_percentage INTEGER DEFAULT 1"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN tea_unit TEXT DEFAULT '%'"); } catch {}

// Add clia_absolute_floor and clia_absolute_unit columns for §493 dual-criterion TEa rule
try { sqlite.exec("ALTER TABLE studies ADD COLUMN clia_absolute_floor REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN clia_absolute_unit TEXT"); } catch {}

// Add clia_preset_label to make TEa adjacency-slip mistakes visible on the report.
// Customer report 2026-06-04: picked the pCO2 row (8% / 5 mm Hg) thinking it was
// Carbon Dioxide / Serum CO2 / Bicarbonate (20%). The two rows are adjacent in the
// dropdown and the report only printed the TEa VALUE, not the preset NAME, so the
// crosswire was invisible after the fact. Persist the picked preset label
// (frozen at study-create time) so the report can show
// "CLIA TEa: 8% or 5 mm Hg (pCO2, Blood Gas Analyzer)" and any future slip is
// caught at report-review time. NULL on legacy rows -> render the old way.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN clia_preset_label TEXT"); } catch {}

// Add instrument_meta column for VeritaMap-linked instrument data (JSON)
try { sqlite.exec("ALTER TABLE studies ADD COLUMN instrument_meta TEXT"); } catch {}

// Add created_by_user_id column for seat-aware study attribution.
// user_id remains the lab/owner id (so lab continuity is preserved when
// seats churn). created_by_user_id records who actually clicked Create so
// the Admin Report Studies column attributes credit to the actual analyst,
// not just the primary seat holder. Legacy rows have NULL here and fall
// back to user_id in the report SQL.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN created_by_user_id INTEGER"); } catch {}

// Phase 1 simple-precision parity (2026-05-20): optional inputs that mirror
// other evaluation tools's User's Specifications panel. Vendor SD drives an alternate
// three-state verdict (Pass/Fail/Uncertain) on the precision study; target
// mean drives the optional bias/%bias surface. All four are nullable and do
// not affect the primary CLIA TEa verdict when unset.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN vendor_sd REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN vendor_sd_concentration REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN target_mean REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN target_cv REAL"); } catch {}

// EE Day 2 QC traceability fields (2026-05-20): universal CLIA lot-tracking
// columns surfaced in the Supporting Data panel when populated. All four are
// nullable; legacy studies carry NULL.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN control_lot TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN reagent_lot TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN comment TEXT"); } catch {}

// 2026-06-09 Michael L feedback: draft / finalize lifecycle so the
// signed PDF, not the row, is the surveyor artifact. lifecycle_state
// defaults to 'draft' for every existing row (the historical 'status'
// column means something different -- it carries pass/fail-shaped
// values like 'completed'/'fail'/'draft'/etc. that the eval pipeline
// owns). lifecycle_state is the user-visible workflow gate.
//
// Transitions: 'draft' -> 'finalized' via the explicit Sign+Lock
// action that captures finalized_at + finalized_by_user_id +
// finalized_signature. No reverse transition; amendments create a
// new row linked via amends_study_id.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'draft'"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN finalized_at TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN finalized_by_user_id INTEGER"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN finalized_signature TEXT"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN amends_study_id INTEGER"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN result_units TEXT"); } catch {}

// 2026-06-09 (Michael L feedback): optional Analytical Measurement Range
// (AMR) per study, so Linearity / Reportable Range renderers can report
// edge-coverage (how close the lowest and highest tested points get to
// the claimed AMR). Blank values disable the check entirely so this is
// strictly additive. amr_units defaults to the study's existing result
// units when not supplied at write time.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN amr_low REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN amr_high REAL"); } catch {}
try { sqlite.exec("ALTER TABLE studies ADD COLUMN amr_units TEXT"); } catch {}

// 2026-06-09 (overnight session 8/11): Q1 Censoring Level 2.
// Per-study policy for handling censored (< or >) results in stat
// math. One of: 'exclude' (skip from regression/SD; default),
// 'substitute_lld' (use the censor threshold), 'substitute_lld_half'
// (use threshold/2 per Helsel; common in clinical chem and
// environmental work). Blank censored points behave as before;
// legacy data with no censored=true flag is unaffected.
try { sqlite.exec("ALTER TABLE studies ADD COLUMN censoring_policy TEXT NOT NULL DEFAULT 'exclude'"); } catch {}

// ─────────────────────────────────────────────────────────────────────────────────
// Labs table — normalized lab identity (CLIA, name, accreditation flags)
// Migrated from per-user columns to shared lab entity so seats inherit and
// fields can be locked once reports are generated.
//
// MOVED 2026-05-16: this block (and the Phase 0 + Phase 1 blocks below)
// previously lived AFTER the per-module Phase 3 backfills. That meant
// Phase 3 backfills referencing `u.lab_id` (added at line 1212 of the old
// layout) crashed at build time on a fresh container DB because the
// column did not exist yet in source order. Moved up so users.lab_id +
// labs table exist before any Phase 3+ backfill runs. See PR #163 fix.
// ─────────────────────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS labs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clia_number TEXT UNIQUE,
    lab_name TEXT,
    accreditation_cap INTEGER NOT NULL DEFAULT 0,
    accreditation_tjc INTEGER NOT NULL DEFAULT 0,
    accreditation_cola INTEGER NOT NULL DEFAULT 0,
    accreditation_aabb INTEGER NOT NULL DEFAULT 0,
    clia_locked INTEGER NOT NULL DEFAULT 0,
    lab_name_locked INTEGER NOT NULL DEFAULT 0,
    owner_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_user_id) REFERENCES users(id)
  )
`);
try { sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_labs_clia ON labs(clia_number) WHERE clia_number IS NOT NULL`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_labs_owner ON labs(owner_user_id)`); } catch {}

// Lab audit log — tracks every change to CLIA number, lab name, or accreditation
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS lab_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    changed_by_user_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    change_reason TEXT,
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lab_audit_lab ON lab_audit_log(lab_id, changed_at DESC)`); } catch {}

// Add lab_id FK column to users table (nullable — backfilled below)
if (!colNames.includes("lab_id")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN lab_id INTEGER REFERENCES labs(id)"); } catch {}
}

// ── Backfill: migrate existing user-level lab data into labs rows ──────────────
// For every user who has a populated clia_number or clia_lab_name on their user
// row AND does not already have a lab_id, create a labs row and link it.
// Then, for seat users whose owner now has a lab_id, inherit the same lab_id.
{
  const usersWithLabData = sqlite.prepare(
    "SELECT id, clia_number, clia_lab_name, preferred_standards FROM users WHERE (clia_number IS NOT NULL OR clia_lab_name IS NOT NULL) AND lab_id IS NULL"
  ).all() as any[];

  // Pre-compute which user ids are active seats. A user that is somebody else's
  // seat must NEVER have its own lab created from stale clia_* fields on its
  // user row — it must inherit the owner's lab. (Seat-accept may have copied
  // CLIA values onto the seat user historically.)
  const activeSeatUserIds = new Set<number>(
    (sqlite.prepare("SELECT seat_user_id FROM user_seats WHERE status = 'active' AND seat_user_id IS NOT NULL").all() as any[])
      .map(r => Number(r.seat_user_id))
  );

  let labsMigrated = 0;
  for (const u of usersWithLabData) {
    if (activeSeatUserIds.has(Number(u.id))) {
      // Skip: this user is a seat under another owner. Lab inheritance is
      // handled by the seat-fixup loop below.
      continue;
    }
    // Parse preferred_standards JSON to set accreditation flags
    let accCap = 0, accTjc = 0, accCola = 0, accAabb = 0;
    if (u.preferred_standards) {
      try {
        const standards: string[] = JSON.parse(u.preferred_standards);
        accCap = standards.includes("CAP") ? 1 : 0;
        accTjc = standards.includes("TJC") ? 1 : 0;
        accCola = standards.includes("COLA") ? 1 : 0;
        accAabb = standards.includes("AABB") ? 1 : 0;
      } catch {}
    }

    // Check if a lab with this CLIA already exists (avoid unique constraint violation)
    const existingLab = u.clia_number
      ? sqlite.prepare("SELECT id FROM labs WHERE clia_number = ?").get(u.clia_number) as any
      : null;

    let labId: number;
    if (existingLab) {
      labId = existingLab.id;
    } else {
      const now = new Date().toISOString();
      const result = sqlite.prepare(
        "INSERT INTO labs (clia_number, lab_name, accreditation_cap, accreditation_tjc, accreditation_cola, accreditation_aabb, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(u.clia_number || null, u.clia_lab_name || null, accCap, accTjc, accCola, accAabb, u.id, now, now);
      labId = Number(result.lastInsertRowid);
    }

    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, u.id);
    labsMigrated++;
  }

  // DISABLED 2026-05-24: this seat backfill overwrote each active seat
  // user's users.lab_id with the owner's CURRENT users.lab_id on every boot.
  // Combined with the Phase 1 lab_members backfill below, this produced
  // spurious lab_members rows whenever an owner's users.lab_id changed
  // between deploys (the cascade dropped the same seat list onto every
  // lab the owner ever touched). The 4 phantom Milford rows on 2026-05-24
  // 20:57:34 were created by this exact mechanism — see PR adding this
  // comment for full forensic trace.
  //
  // Going forward, lab_members is the authoritative source of "who can see
  // which lab"; users.lab_id is the legacy single-lab field and must not
  // be mass-overwritten by any boot migration. New seat invites populate
  // lab_members explicitly via /api/account/seats POST and
  // /api/labs/:labId/members POST.
  // const seatsMigrated_DISABLED = 0;
  if (labsMigrated > 0) {
    console.log(`[migration] Labs backfill: ${labsMigrated} lab(s) created from user records (seat-cascade disabled 2026-05-24)`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────
// Multi-Lab Tier 2 — Phase 0: schema only
// Doc: docs/scoping-multi-lab-tier2.md (merged PR #133, 2026-05-15).
// This block creates the lab_members join table and adds the columns that
// will later carry plan / subscription / Stripe state from users to labs.
// No backfill, no reader/writer changes — those are Phase 1 and beyond.
// Idempotent: re-runs safely.
// ─────────────────────────────────────────────────────────────────────────────────

// lab_members — many-to-many between users and labs. The single source of
// truth for "who can access which lab" once Tier 2 phases land. Today's
// users.lab_id + user_seats remain authoritative through Phase 1; this
// table is created empty in Phase 0 and backfilled in Phase 1.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS lab_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    permissions_json TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    is_primary_lab INTEGER NOT NULL DEFAULT 0,
    invited_at TEXT,
    accepted_at TEXT,
    last_active_at TEXT,
    invite_token TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(lab_id, user_id)
  )
`);

// Defensive ALTER blocks for lab_members. If the table was created in a
// past deploy with fewer columns (e.g., a partial Phase 0 ship), each
// missing column is added without error. Mirrors the users-table pattern
// elsewhere in this file. CLAUDE.md NEW DB TABLE RULE: every CREATE
// TABLE must ship with PRAGMA-checked ALTERs in the same commit.
{
  const memberCols = (sqlite.prepare("PRAGMA table_info(lab_members)").all() as any[]).map(c => c.name);
  const ensure = (col: string, sql: string) => {
    if (!memberCols.includes(col)) { try { sqlite.exec(sql); memberCols.push(col); } catch {} }
  };
  ensure("role",             "ALTER TABLE lab_members ADD COLUMN role TEXT NOT NULL DEFAULT 'staff'");
  ensure("permissions_json", "ALTER TABLE lab_members ADD COLUMN permissions_json TEXT DEFAULT '{}'");
  ensure("status",           "ALTER TABLE lab_members ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  ensure("is_primary_lab",   "ALTER TABLE lab_members ADD COLUMN is_primary_lab INTEGER NOT NULL DEFAULT 0");
  ensure("invited_at",       "ALTER TABLE lab_members ADD COLUMN invited_at TEXT");
  ensure("accepted_at",      "ALTER TABLE lab_members ADD COLUMN accepted_at TEXT");
  ensure("last_active_at",   "ALTER TABLE lab_members ADD COLUMN last_active_at TEXT");
  ensure("invite_token",     "ALTER TABLE lab_members ADD COLUMN invite_token TEXT");
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lab_members_user ON lab_members(user_id, status)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_lab_members_lab  ON lab_members(lab_id, status)`); } catch {}
try { sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_members_token ON lab_members(invite_token) WHERE invite_token IS NOT NULL`); } catch {}

// labs — add the columns that will carry plan / subscription / Stripe
// state once Phase 4 moves billing identity from users to labs. Nullable
// throughout so the column add is non-destructive on existing rows.
{
  const labCols = (sqlite.prepare("PRAGMA table_info(labs)").all() as any[]).map(c => c.name);
  const ensure = (col: string, sql: string) => {
    if (!labCols.includes(col)) { try { sqlite.exec(sql); labCols.push(col); } catch {} }
  };
  ensure("plan",                       "ALTER TABLE labs ADD COLUMN plan TEXT");
  ensure("subscription_status",        "ALTER TABLE labs ADD COLUMN subscription_status TEXT");
  ensure("subscription_expires_at",    "ALTER TABLE labs ADD COLUMN subscription_expires_at TEXT");
  ensure("plan_expires_at",            "ALTER TABLE labs ADD COLUMN plan_expires_at TEXT");
  ensure("stripe_customer_id",         "ALTER TABLE labs ADD COLUMN stripe_customer_id TEXT");
  ensure("stripe_subscription_id",     "ALTER TABLE labs ADD COLUMN stripe_subscription_id TEXT");
  ensure("study_credits",              "ALTER TABLE labs ADD COLUMN study_credits INTEGER DEFAULT 0");
  ensure("has_completed_onboarding",   "ALTER TABLE labs ADD COLUMN has_completed_onboarding INTEGER DEFAULT 0");
  ensure("preferred_pt_vendor",        "ALTER TABLE labs ADD COLUMN preferred_pt_vendor TEXT");
  // Wave K1 (2026-06-07): Inventory PIN. Shared 6-digit code that grants
  // a scoped JWT (subject = inv:lab_<id>) good only for reading the
  // inventory_items list and adjusting quantity_on_hand. Hashed at rest
  // with pbkdf2-sha256 + a per-lab 16-byte salt. failed_attempts +
  // locked_until provide rate-limiting on the login endpoint
  // (K2). Director / admin rotate via /inventory-pin/regenerate;
  // tech kiosk authenticates via POST /api/inventory-login (K2).
  ensure("inventory_pin_hash",         "ALTER TABLE labs ADD COLUMN inventory_pin_hash TEXT");
  ensure("inventory_pin_salt",         "ALTER TABLE labs ADD COLUMN inventory_pin_salt TEXT");
  ensure("inventory_pin_updated_at",   "ALTER TABLE labs ADD COLUMN inventory_pin_updated_at TEXT");
  ensure("inventory_pin_locked_until", "ALTER TABLE labs ADD COLUMN inventory_pin_locked_until TEXT");
  ensure("inventory_pin_failed_attempts", "ALTER TABLE labs ADD COLUMN inventory_pin_failed_attempts INTEGER DEFAULT 0");

  // 2026-06-08 — Staff Portal PIN. Same shape as the inventory PIN above
  // but a separate hash/salt because the two surfaces have different
  // permission scopes (Staff Portal can sign policies and competencies
  // for every staff member; the inventory kiosk only adjusts qty).
  // Rotated by the lab director; staff member logs in via
  // POST /api/staff-portal-login with the CLIA + this PIN.
  ensure("staff_portal_pin_hash",         "ALTER TABLE labs ADD COLUMN staff_portal_pin_hash TEXT");
  ensure("staff_portal_pin_salt",         "ALTER TABLE labs ADD COLUMN staff_portal_pin_salt TEXT");
  ensure("staff_portal_pin_updated_at",   "ALTER TABLE labs ADD COLUMN staff_portal_pin_updated_at TEXT");
  ensure("staff_portal_pin_locked_until", "ALTER TABLE labs ADD COLUMN staff_portal_pin_locked_until TEXT");
  ensure("staff_portal_pin_failed_attempts", "ALTER TABLE labs ADD COLUMN staff_portal_pin_failed_attempts INTEGER DEFAULT 0");
}

// users.default_lab_id — bare-route redirect target (per doc Section 4).
// Updated on every authenticated page hit in Phase 2; not the source of
// truth for scope. URL is. Nullable; FK to labs is informational only
// (sqlite ALTER doesn't add real FK constraints post-hoc, matches the
// pattern used for users.lab_id above).
if (!colNames.includes("default_lab_id")) {
  try { sqlite.exec("ALTER TABLE users ADD COLUMN default_lab_id INTEGER REFERENCES labs(id)"); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────────
// Multi-Lab Tier 2 — Phase 1: backfill
// Doc: docs/scoping-multi-lab-tier2.md, Section 5 Phase 1.
// Populate lab_members from existing users + user_seats. Copy plan and
// subscription state from each owner's users row to their primary labs
// row. Set users.default_lab_id to each user's primary lab.
// Idempotent: every step is skip-if-present. No reader/writer changes.
// ─────────────────────────────────────────────────────────────────────────────────
{
  // Step 1: DISABLED 2026-05-24. This step previously created a
  // lab_members row for every user with users.lab_id IS NOT NULL. It was
  // intended as a one-time backfill for Phase 1 rollout, but ran on every
  // server boot. Combined with the now-disabled seat backfill above
  // (db.ts:1266) which overwrote seat users' users.lab_id on every boot,
  // this cascade produced spurious lab_members rows whenever an owner's
  // users.lab_id changed between deploys. The 4 phantom Milford rows on
  // 2026-05-24 20:57:34 (Daniela Rivera, Jeff Moore, David McCormick,
  // lisa.j.veri) were created by exactly this mechanism.
  //
  // Going forward, lab_members rows are created ONLY by the explicit
  // invite endpoints (/api/account/seats POST, /api/labs/:labId/members
  // POST, /api/labs/me/add, /api/admin/add-lab-membership,
  // /api/admin/provision-comp-lab). Each insert is audit_log'd so any
  // future spurious row has a traceable source.
  const memberInserted = 0;

  // Step 2: copy plan / subscription / Stripe state from each owner's
  // users row to their primary labs row, only if the labs column is
  // currently NULL. This is a one-shot snapshot; Phase 4 will make
  // labs the authoritative writer. Avoid overwriting in case a later
  // Phase has already populated the labs row.
  let subsCopied = 0;
  const ownerUsers = sqlite.prepare(`
    SELECT id AS user_id, plan, subscription_status, subscription_expires_at, plan_expires_at,
           stripe_customer_id, stripe_subscription_id, study_credits, has_completed_onboarding,
           preferred_pt_vendor
    FROM users WHERE id IN (SELECT DISTINCT owner_user_id FROM labs)
  `).all() as any[];

  for (const u of ownerUsers) {
    const primaryLab = sqlite.prepare(
      "SELECT * FROM labs WHERE owner_user_id = ? ORDER BY id ASC LIMIT 1"
    ).get(u.user_id) as any;
    if (!primaryLab) continue;

    const updates: string[] = [];
    const values: any[] = [];
    const maybe = (col: string, val: any) => {
      if (primaryLab[col] == null && val != null) {
        updates.push(`${col} = ?`);
        values.push(val);
      }
    };
    maybe("plan", u.plan);
    maybe("subscription_status", u.subscription_status);
    maybe("subscription_expires_at", u.subscription_expires_at);
    maybe("plan_expires_at", u.plan_expires_at);
    maybe("stripe_customer_id", u.stripe_customer_id);
    maybe("stripe_subscription_id", u.stripe_subscription_id);
    maybe("study_credits", u.study_credits);
    maybe("has_completed_onboarding", u.has_completed_onboarding);
    maybe("preferred_pt_vendor", u.preferred_pt_vendor);

    if (updates.length) {
      values.push(primaryLab.id);
      sqlite.prepare(`UPDATE labs SET ${updates.join(", ")}, updated_at = (datetime('now')) WHERE id = ?`).run(...values);
      subsCopied++;
    }
  }

  // Step 3: set users.default_lab_id from each user's primary
  // membership (or first active membership) if currently NULL. This
  // is the bare-/dashboard redirect target per doc Section 4.
  let defaultsSet = 0;
  const usersNeedingDefault = sqlite.prepare(
    "SELECT id FROM users WHERE default_lab_id IS NULL"
  ).all() as any[];
  for (const u of usersNeedingDefault) {
    const m = sqlite.prepare(
      "SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY is_primary_lab DESC, id ASC LIMIT 1"
    ).get(u.id) as any;
    if (m) {
      sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(m.lab_id, u.id);
      defaultsSet++;
    }
  }

  if (memberInserted > 0 || subsCopied > 0 || defaultsSet > 0) {
    console.log(`[migration] Multi-lab Phase 1: ${memberInserted} member(s) inserted, ${subsCopied} primary lab(s) had subscription state copied, ${defaultsSet} user(s) got default_lab_id`);
  }
}

// Multi-Lab Tier 2 — Phase 3 (VeritaCheck / studies module):
// lab_id is the data-routing key going forward (doc: scoping-multi-lab-tier2.md
// Section 5 Phase 3). user_id stays as the audit-trail "creator" column.
// Idempotent backfill below maps each studies row to its user's lab.
{
  const studyCols = (sqlite.prepare("PRAGMA table_info(studies)").all() as any[]).map(c => c.name);
  if (!studyCols.includes("lab_id")) {
    try { sqlite.exec("ALTER TABLE studies ADD COLUMN lab_id INTEGER REFERENCES labs(id)"); } catch {}
  }
}
try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_studies_lab_id ON studies(lab_id, id DESC)"); } catch {}

// Backfill: studies.lab_id = the user's lab_id. Skip rows that already
// have lab_id set (subsequent runs are no-ops). Studies created by seat
// users inherit the owner's lab through users.lab_id, which the Tier 1
// backfill (db.ts:1188-1260) already aligned.
{
  const backfilled = sqlite.prepare(`
    UPDATE studies
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = studies.user_id)
    WHERE lab_id IS NULL
      AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = studies.user_id) IS NOT NULL
  `).run();
  if (backfilled.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3 (studies): backfilled lab_id on ${backfilled.changes} row(s)`);
  }
}

// Plan/tier definitions: seat limits, pricing, bed ranges
export const PLAN_SEATS: Record<string, number> = {
  clinic: 2,
  community: 5,
  hospital: 15,
  enterprise: 25,
  free: 1,
  per_study: 1,
  waived: 1,
  veritacheck_only: 1,
  large_hospital: 25,
  lab: 25,
};

// parking-lot #33 view-only seat caps per CLAUDE.md sec 10. Clinic 1,
// Community 2, Hospital 3, with a $99/yr add-on rate for extras. Older
// plans (waived, per_study, free, veritacheck_only) get 1 to cover the
// medical director or designee role. Enterprise / large_hospital / lab
// get 5 since they cover system-scale labs with multiple reviewer roles.
export const PLAN_VIEW_ONLY_SEATS: Record<string, number> = {
  clinic: 1,
  community: 2,
  hospital: 3,
  enterprise: 5,
  large_hospital: 5,
  lab: 5,
  waived: 1,
  veritacheck_only: 1,
  per_study: 1,
  free: 0,
};

export const PLAN_PRICES: Record<string, number> = {
  clinic: 499,
  community: 999,
  hospital: 1999,
  enterprise: 2999,
};

export const PLAN_BED_RANGES: Record<string, [number, number]> = {
  clinic: [0, 25],
  community: [26, 100],
  hospital: [101, 300],
  enterprise: [301, Infinity],
};

export function suggestTierFromBeds(beds: number): { tier: string; label: string; price: number; seats: number } {
  if (beds <= 25) return { tier: 'clinic', label: 'Clinic', price: 499, seats: 2 };
  if (beds <= 100) return { tier: 'community', label: 'Community', price: 999, seats: 5 };
  if (beds <= 300) return { tier: 'hospital', label: 'Hospital', price: 1999, seats: 15 };
  return { tier: 'enterprise', label: 'Enterprise', price: 2999, seats: 25 };
}

// ─────────────────────────────────────────────────────────────────────────────────
// Audit log table - records before/after state for all destructive operations
// ─────────────────────────────────────────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    owner_user_id INTEGER,
    module TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    entity_label TEXT,
    before_json TEXT,
    after_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Nightly snapshots table - full data dump per user, kept 30 days
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS nightly_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    snapshot_date TEXT NOT NULL,
    modules_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, snapshot_date)
  )
`);

// Index for fast audit log queries
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(owner_user_id, created_at DESC)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_module ON audit_log(module, entity_type, entity_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_user ON nightly_snapshots(user_id, snapshot_date DESC)`); } catch {}

// (Labs schema + Phase 0/1 backfill blocks moved up in source order to
// before the Phase 3.1 studies.lab_id backfill so a fresh build-container
// DB does not crash on `no such column: u.lab_id`. See top of file.)

// Multi-Lab Tier 2 — Phase 4.4: operator's lab gets permanent enterprise.
// Mirrors the user-row update at db.ts:866 but on the LAB row. After Phase
// 4.x ships, lab.plan is the authoritative source for subscription gates
// (Phase 4.3a/b/c), so this UPDATE is what actually keeps the operator on
// enterprise. The line 866 user update stays for the dual-write window.
//
// Identity is by CLIA (OWNER_CLIA constant from server/constants.ts), not
// email. Reason: feedback_target_lab_not_email.md — emails are auth
// identity, CLIA is data identity. Per parking-lot #11 once multi-lab
// activates the operator email may own more than one lab; only the one
// matching OWNER_CLIA gets the permanent-enterprise force-upgrade.
try {
  const opLabRow = sqlite.prepare("SELECT id, plan FROM labs WHERE clia_number = ? LIMIT 1").get(OWNER_CLIA) as any;
  if (opLabRow) {
    const PLAN_RANK_FOR_OP: Record<string, number> = { free: 0, per_study: 1, veritacheck_only: 2, community: 3, lab: 4, hospital: 5, large_hospital: 6, enterprise: 7, waived: 7 };
    const currentRank = PLAN_RANK_FOR_OP[opLabRow?.plan] ?? 0;
    const targetRank = PLAN_RANK_FOR_OP["enterprise"] ?? 7;
    if (currentRank <= targetRank) {
      sqlite.prepare(
        "UPDATE labs SET plan = 'enterprise', subscription_status = 'active', subscription_expires_at = '2099-12-31T00:00:00.000Z', plan_expires_at = '2099-12-31T00:00:00.000Z', study_credits = 99999, updated_at = ? WHERE id = ?"
      ).run(new Date().toISOString(), opLabRow.id);
    }
  }
} catch (err: any) {
  console.warn("[multi-lab] Phase 4.4 operator-lab permanent-enterprise force-upgrade failed:", err?.message);
}

// VeritaPolicy tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritapolicy_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    has_blood_bank INTEGER NOT NULL DEFAULT 1, -- deprecated: no longer used in UI or auto-N/A logic; safe to drop in a future migration
    has_transplant INTEGER NOT NULL DEFAULT 0, -- deprecated: no longer used in UI or auto-N/A logic; safe to drop in a future migration
    has_microbiology INTEGER NOT NULL DEFAULT 1, -- deprecated: no longer used in UI or auto-N/A logic; safe to drop in a future migration
    has_maternal_serum INTEGER NOT NULL DEFAULT 0, -- deprecated: no longer used in UI or auto-N/A logic; safe to drop in a future migration
    is_independent INTEGER NOT NULL DEFAULT 0,
    waived_only INTEGER NOT NULL DEFAULT 0, -- deprecated: no longer used in UI or auto-N/A logic; safe to drop in a future migration
    setup_complete INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritapolicy_lab_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    policy_number TEXT,
    policy_name TEXT NOT NULL,
    owner TEXT,
    status TEXT NOT NULL DEFAULT 'not_started',
    last_reviewed TEXT,
    next_review TEXT,
    document_name TEXT,
    document_path TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritapolicy_requirement_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    requirement_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    is_na INTEGER NOT NULL DEFAULT 0,
    na_reason TEXT,
    lab_policy_id INTEGER,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, requirement_id)
  )
`);

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritapolicy_req_user ON veritapolicy_requirement_status(user_id, requirement_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritapolicy_policies_user ON veritapolicy_lab_policies(user_id)`); } catch {}
// Add policy_name column to requirement_status (stores free-text policy name entered by user)
try { sqlite.exec(`ALTER TABLE veritapolicy_requirement_status ADD COLUMN policy_name TEXT`); } catch {}
// Add accreditation_body to settings (tjc | cap | both)
try { sqlite.exec(`ALTER TABLE veritapolicy_settings ADD COLUMN accreditation_body TEXT NOT NULL DEFAULT 'tjc'`); } catch {}

// VeritaPolicy Master List status -- per-user state for the 96 polished policies
// (keyed by string policy_id from VERITAPOLICY_MASTER_LIST). Mirrors the
// in-app tracker against the same dataset the Excel export uses.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritapolicy_master_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    policy_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'not_started',
    is_na INTEGER NOT NULL DEFAULT 0,
    na_reason TEXT,
    our_policy_name TEXT,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, policy_id)
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritapolicy_master_user ON veritapolicy_master_status(user_id, policy_id)`); } catch {}

// Per-lab artifact storage: when a lab uploads custom-formatted DOCX policy
// files (e.g. SCAHC's facility template), they're stored here as BLOBs keyed
// by (lab_id, policy_id). The DOCX download routes check this table first
// before falling back to the generic VeritaAssure-branded generator.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritapolicy_lab_artifacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    policy_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    docx_blob BLOB NOT NULL,
    source TEXT NOT NULL DEFAULT 'admin_upload',
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by INTEGER,
    UNIQUE(lab_id, policy_id)
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritapolicy_lab_artifacts_lab ON veritapolicy_lab_artifacts(lab_id)`); } catch {}

// Migration sentinel for veritapolicy_lab_artifacts (no schema changes yet
// but keeps the pattern in place for future ALTER TABLE additions).
{
  const cols = (sqlite.prepare("PRAGMA table_info(veritapolicy_lab_artifacts)").all() as { name: string }[]).map((c) => c.name);
  // Future columns added via ALTER TABLE go here, gated on !cols.includes("colname").
  void cols;
}

// ALTER TABLE migration for veritapolicy_master_status
{
  const vmsCols = sqlite.prepare("PRAGMA table_info(veritapolicy_master_status)").all() as { name: string }[];
  const vmsColNames = vmsCols.map((c) => c.name);
  if (vmsCols.length > 0) {
    if (!vmsColNames.includes("is_na")) {
      try { sqlite.exec("ALTER TABLE veritapolicy_master_status ADD COLUMN is_na INTEGER NOT NULL DEFAULT 0"); } catch {}
    }
    if (!vmsColNames.includes("na_reason")) {
      try { sqlite.exec("ALTER TABLE veritapolicy_master_status ADD COLUMN na_reason TEXT"); } catch {}
    }
    if (!vmsColNames.includes("our_policy_name")) {
      try { sqlite.exec("ALTER TABLE veritapolicy_master_status ADD COLUMN our_policy_name TEXT"); } catch {}
    }
    if (!vmsColNames.includes("notes")) {
      try { sqlite.exec("ALTER TABLE veritapolicy_master_status ADD COLUMN notes TEXT"); } catch {}
    }
  }
}

// Phase 3 Cluster 1 (Transfusion) — one-shot migration: forward existing
// per-source-policy status entries (IDs 41-65) onto the combined-policy
// IDs (97-102). Idempotent: gated by the existence of any source row in
// the status table. Migration rule per the plan: lowest-completion wins.
// N/A only if ALL absorbed source rows for a given (user, combined) were
// N/A. our_policy_name and notes are concatenated (deduped, "; "-joined)
// so the lab does not lose context they entered against source rows.
{
  const SOURCE_TO_COMBINED: Record<string, string> = {
    "41": "97",
    "49": "98", "50": "98", "51": "98",
    "42": "99", "44": "99", "45": "99", "46": "99", "47": "99",
    "48": "99", "55": "99", "56": "99", "57": "99",
    "52": "100", "53": "100", "54": "100", "58": "100", "59": "100", "60": "100",
    "61": "101", "62": "101",
    "43": "102", "63": "102", "64": "102", "65": "102",
  };
  const STATUS_RANK: Record<string, number> = {
    "not_started": 0,
    "in_progress": 1,
    "complete": 2,
  };
  const STATUS_FROM_RANK = ["not_started", "in_progress", "complete"];

  try {
    const sourceIds = Object.keys(SOURCE_TO_COMBINED);
    const placeholders = sourceIds.map(() => "?").join(",");
    const stale = sqlite.prepare(
      `SELECT user_id, policy_id, status, is_na, na_reason, our_policy_name, notes
       FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
    ).all(...sourceIds) as Array<{
      user_id: number; policy_id: string; status: string; is_na: number;
      na_reason: string | null; our_policy_name: string | null; notes: string | null;
    }>;

    if (stale.length > 0) {
      // Group by (user_id, combined_id)
      const byUserCombined = new Map<string, typeof stale>();
      for (const row of stale) {
        const combinedId = SOURCE_TO_COMBINED[row.policy_id];
        const k = `${row.user_id}|${combinedId}`;
        if (!byUserCombined.has(k)) byUserCombined.set(k, []);
        byUserCombined.get(k)!.push(row);
      }

      const upsert = sqlite.prepare(
        `INSERT INTO veritapolicy_master_status
           (user_id, policy_id, status, is_na, na_reason, our_policy_name, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, policy_id) DO UPDATE SET
           status = excluded.status,
           is_na = excluded.is_na,
           na_reason = excluded.na_reason,
           our_policy_name = excluded.our_policy_name,
           notes = excluded.notes,
           updated_at = datetime('now')`
      );
      const dedupeJoin = (vals: Array<string | null>) => {
        const seen: string[] = [];
        for (const v of vals) {
          for (const part of (v || "").split(/;\s*/)) {
            const t = part.trim();
            if (t && !seen.includes(t)) seen.push(t);
          }
        }
        return seen.join("; ") || null;
      };

      let migratedCount = 0;
      for (const [k, rows] of Array.from(byUserCombined)) {
        const [userIdStr, combinedId] = k.split("|");
        const userId = Number(userIdStr);
        const allNa = rows.every(r => r.is_na === 1);
        let combinedStatus: string;
        let combinedIsNa: number;
        if (allNa) {
          combinedStatus = "not_started";
          combinedIsNa = 1;
        } else {
          // Lowest-completion wins among non-N/A rows
          const ranks = rows.filter(r => r.is_na !== 1).map(r => STATUS_RANK[r.status] ?? 0);
          const minRank = Math.min(...ranks);
          combinedStatus = STATUS_FROM_RANK[minRank];
          combinedIsNa = 0;
        }
        upsert.run(
          userId,
          combinedId,
          combinedStatus,
          combinedIsNa,
          dedupeJoin(rows.map(r => r.na_reason)),
          dedupeJoin(rows.map(r => r.our_policy_name)),
          dedupeJoin(rows.map(r => r.notes)),
        );
        migratedCount += 1;
      }

      // Delete the original source-id rows now that they've been folded into
      // the combined-policy rows. Safe because UNIQUE(user_id, policy_id)
      // guarantees the upsert created the new rows.
      const delStmt = sqlite.prepare(
        `DELETE FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
      );
      const delResult = delStmt.run(...sourceIds);
      console.log(
        `[migration] VeritaPolicy Phase 3 Cluster 1: folded ${stale.length} ` +
        `source-id status rows into ${migratedCount} combined-policy rows ` +
        `(deleted ${delResult.changes} source rows).`
      );
    }
  } catch (err: any) {
    console.error("[migration] VeritaPolicy Phase 3 Cluster 1 failed:", err.message);
  }
}

// Phase 3 Cluster 2 (Personnel) — same shape as Cluster 1 migration,
// different source-to-combined mapping. Folds 9 Personnel source-ID status
// rows (17-21, 91-94) into 3 combined IDs (103-105). Idempotent.
{
  const SOURCE_TO_COMBINED: Record<string, string> = {
    "17": "103", "91": "103", "92": "103", "93": "103", "94": "103",
    "18": "104", "19": "104", "20": "104",
    "21": "105",
  };
  const STATUS_RANK: Record<string, number> = {
    "not_started": 0, "in_progress": 1, "complete": 2,
  };
  const STATUS_FROM_RANK = ["not_started", "in_progress", "complete"];
  try {
    const sourceIds = Object.keys(SOURCE_TO_COMBINED);
    const placeholders = sourceIds.map(() => "?").join(",");
    const stale = sqlite.prepare(
      `SELECT user_id, policy_id, status, is_na, na_reason, our_policy_name, notes
       FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
    ).all(...sourceIds) as Array<{
      user_id: number; policy_id: string; status: string; is_na: number;
      na_reason: string | null; our_policy_name: string | null; notes: string | null;
    }>;
    if (stale.length > 0) {
      const byUserCombined = new Map<string, typeof stale>();
      for (const row of stale) {
        const combinedId = SOURCE_TO_COMBINED[row.policy_id];
        const k = `${row.user_id}|${combinedId}`;
        if (!byUserCombined.has(k)) byUserCombined.set(k, []);
        byUserCombined.get(k)!.push(row);
      }
      const upsert = sqlite.prepare(
        `INSERT INTO veritapolicy_master_status
           (user_id, policy_id, status, is_na, na_reason, our_policy_name, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, policy_id) DO UPDATE SET
           status = excluded.status, is_na = excluded.is_na,
           na_reason = excluded.na_reason, our_policy_name = excluded.our_policy_name,
           notes = excluded.notes, updated_at = datetime('now')`
      );
      const dedupeJoin = (vals: Array<string | null>) => {
        const seen: string[] = [];
        for (const v of vals) {
          for (const part of (v || "").split(/;\s*/)) {
            const t = part.trim();
            if (t && !seen.includes(t)) seen.push(t);
          }
        }
        return seen.join("; ") || null;
      };
      let migratedCount = 0;
      for (const [k, rows] of Array.from(byUserCombined)) {
        const [userIdStr, combinedId] = k.split("|");
        const userId = Number(userIdStr);
        const allNa = rows.every(r => r.is_na === 1);
        let combinedStatus: string;
        let combinedIsNa: number;
        if (allNa) {
          combinedStatus = "not_started";
          combinedIsNa = 1;
        } else {
          const ranks = rows.filter(r => r.is_na !== 1).map(r => STATUS_RANK[r.status] ?? 0);
          const minRank = Math.min(...ranks);
          combinedStatus = STATUS_FROM_RANK[minRank];
          combinedIsNa = 0;
        }
        upsert.run(
          userId, combinedId, combinedStatus, combinedIsNa,
          dedupeJoin(rows.map(r => r.na_reason)),
          dedupeJoin(rows.map(r => r.our_policy_name)),
          dedupeJoin(rows.map(r => r.notes)),
        );
        migratedCount += 1;
      }
      const delResult = sqlite.prepare(
        `DELETE FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
      ).run(...sourceIds);
      console.log(
        `[migration] VeritaPolicy Phase 3 Cluster 2: folded ${stale.length} ` +
        `source-id status rows into ${migratedCount} combined-policy rows ` +
        `(deleted ${delResult.changes} source rows).`
      );
    }
  } catch (err: any) {
    console.error("[migration] VeritaPolicy Phase 3 Cluster 2 failed:", err.message);
  }
}

// Phase 3 Clusters 3-8 (batched) — same shape as Clusters 1 and 2.
// Folds 19 source-ID status rows into 6 combined IDs (106-111). One block
// covers six clusters (Waived/POCT, Molecular, Health Info Mgmt true-merge,
// Leadership Governance, Infection Prevention, HCT/P). Idempotent.
{
  const SOURCE_TO_COMBINED: Record<string, string> = {
    "85": "106", "86": "106", "87": "106", "88": "106",
    "75": "107", "76": "107", "77": "107",
    "25": "108", "26": "108", "27": "108",
    "29": "109", "30": "109", "31": "109", "32": "109",
    "22": "110", "23": "110",
    "82": "111", "83": "111", "84": "111",
  };
  const STATUS_RANK: Record<string, number> = {
    "not_started": 0, "in_progress": 1, "complete": 2,
  };
  const STATUS_FROM_RANK = ["not_started", "in_progress", "complete"];
  try {
    const sourceIds = Object.keys(SOURCE_TO_COMBINED);
    const placeholders = sourceIds.map(() => "?").join(",");
    const stale = sqlite.prepare(
      `SELECT user_id, policy_id, status, is_na, na_reason, our_policy_name, notes
       FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
    ).all(...sourceIds) as Array<{
      user_id: number; policy_id: string; status: string; is_na: number;
      na_reason: string | null; our_policy_name: string | null; notes: string | null;
    }>;
    if (stale.length > 0) {
      const byUserCombined = new Map<string, typeof stale>();
      for (const row of stale) {
        const combinedId = SOURCE_TO_COMBINED[row.policy_id];
        const k = `${row.user_id}|${combinedId}`;
        if (!byUserCombined.has(k)) byUserCombined.set(k, []);
        byUserCombined.get(k)!.push(row);
      }
      const upsert = sqlite.prepare(
        `INSERT INTO veritapolicy_master_status
           (user_id, policy_id, status, is_na, na_reason, our_policy_name, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(user_id, policy_id) DO UPDATE SET
           status = excluded.status, is_na = excluded.is_na,
           na_reason = excluded.na_reason, our_policy_name = excluded.our_policy_name,
           notes = excluded.notes, updated_at = datetime('now')`
      );
      const dedupeJoin = (vals: Array<string | null>) => {
        const seen: string[] = [];
        for (const v of vals) {
          for (const part of (v || "").split(/;\s*/)) {
            const t = part.trim();
            if (t && !seen.includes(t)) seen.push(t);
          }
        }
        return seen.join("; ") || null;
      };
      let migratedCount = 0;
      for (const [k, rows] of Array.from(byUserCombined)) {
        const [userIdStr, combinedId] = k.split("|");
        const userId = Number(userIdStr);
        const allNa = rows.every(r => r.is_na === 1);
        let combinedStatus: string;
        let combinedIsNa: number;
        if (allNa) {
          combinedStatus = "not_started";
          combinedIsNa = 1;
        } else {
          const ranks = rows.filter(r => r.is_na !== 1).map(r => STATUS_RANK[r.status] ?? 0);
          const minRank = Math.min(...ranks);
          combinedStatus = STATUS_FROM_RANK[minRank];
          combinedIsNa = 0;
        }
        upsert.run(
          userId, combinedId, combinedStatus, combinedIsNa,
          dedupeJoin(rows.map(r => r.na_reason)),
          dedupeJoin(rows.map(r => r.our_policy_name)),
          dedupeJoin(rows.map(r => r.notes)),
        );
        migratedCount += 1;
      }
      const delResult = sqlite.prepare(
        `DELETE FROM veritapolicy_master_status WHERE policy_id IN (${placeholders})`
      ).run(...sourceIds);
      console.log(
        `[migration] VeritaPolicy Phase 3 Clusters 3-8: folded ${stale.length} ` +
        `source-id status rows into ${migratedCount} combined-policy rows ` +
        `(deleted ${delResult.changes} source rows).`
      );
    }
  } catch (err: any) {
    console.error("[migration] VeritaPolicy Phase 3 Clusters 3-8 failed:", err.message);
  }
}

// Multi-Lab Tier 2 — Phase 3.2 (VeritaPolicy module):
// Add lab_id to all four veritapolicy_* tables and backfill from each row's
// user_id → users.lab_id. user_id columns stay (with their UNIQUE constraints)
// as audit-trail + transitional uniqueness; lab_id becomes the routing key
// for reads/writes. When multi-lab actually activates (parking-lot #11/#12),
// a follow-up will recreate these tables with UNIQUE(lab_id, ...) constraints.
{
  const tables = [
    "veritapolicy_settings",
    "veritapolicy_lab_policies",
    "veritapolicy_requirement_status",
    "veritapolicy_master_status",
  ];
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes("lab_id")) {
      try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
    }
    try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`); } catch {}
    const backfilled = sqlite.prepare(`
      UPDATE ${t}
      SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id)
      WHERE lab_id IS NULL
        AND user_id IS NOT NULL
        AND (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id) IS NOT NULL
    `).run();
    if (backfilled.changes > 0) {
      console.log(`[migration] Multi-lab Phase 3.2 (${t}): backfilled lab_id on ${backfilled.changes} row(s)`);
    }
  }
}

// VeritaTrack -- regulatory compliance calendar
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritatrack_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    instrument TEXT,
    owner TEXT,
    frequency TEXT NOT NULL DEFAULT 'Monthly',
    frequency_months INTEGER NOT NULL DEFAULT 1,
    map_analyte TEXT,
    map_field TEXT,
    notes TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS veritatrack_signoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    completed_date TEXT NOT NULL,
    initials TEXT,
    performed_by TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (task_id) REFERENCES veritatrack_tasks(id)
  );
`);

// Wave B3 (2026-06-12): VeritaTrack audit trail. The signoff rows are the
// completion record, but task edits, deactivations, and signoff DELETIONS
// left no trace -- a surveyor-defensibility gap (a vanished completion record
// or a silently shortened interval is exactly what an inspector probes). One
// append-only row per lifecycle event, lab-scoped, never mutated.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritatrack_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER,
    task_id INTEGER,
    signoff_id INTEGER,
    event TEXT NOT NULL,
    detail TEXT,
    by_user_id INTEGER,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_vtrack_audit_task ON veritatrack_audit(task_id);
  CREATE INDEX IF NOT EXISTS idx_vtrack_audit_lab  ON veritatrack_audit(lab_id);
`);
// PRAGMA migration block per the New DB Table Rule (CLAUDE.md §8).
{
  try {
    const cols = (sqlite.prepare("PRAGMA table_info(veritatrack_audit)").all() as { name: string }[]).map(c => c.name);
    if (cols.length > 0) {
      // Future ALTER TABLE veritatrack_audit ADD COLUMN ... blocks go here.
    }
  } catch {
    // fresh DB: CREATE TABLE above handled it
  }
}

// VeritaMap analyte values -- per lab, per analyte (shared across instruments)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritamap_analyte_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    ref_range_low TEXT,
    ref_range_high TEXT,
    critical_low TEXT,
    critical_high TEXT,
    units TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(map_id, analyte)
  );
`);

// VeritaMap AMR values -- per lab, per instrument, per analyte
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritamap_amr_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map_id INTEGER NOT NULL,
    instrument_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    amr_low TEXT,
    amr_high TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(map_id, instrument_id, analyte)
  );
`);

// Wave A4 (2026-06-12): VeritaMap provenance columns.
// Critical values: record WHEN the Medical Executive Committee reviewed and
// adopted them (Mayo Clinic Laboratories values stay a STARTING POINT; the
// MEC owns the final values) and who recorded the adoption.
// Reference range + AMR: director-or-designee attestation per 42 CFR
// 493.1253 locks the lab-entered values; unlock is owner/admin with an
// audit_log entry. Idempotent PRAGMA-guarded ALTERs per the New DB Table Rule.
{
  const avCols = (sqlite.prepare("PRAGMA table_info(veritamap_analyte_values)").all() as { name: string }[]).map(c => c.name);
  for (const [col, ddl] of [
    ["mec_reviewed_at", "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_at TEXT"],
    ["mec_reviewed_by", "ALTER TABLE veritamap_analyte_values ADD COLUMN mec_reviewed_by TEXT"],
    ["ref_attested_at", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_at TEXT"],
    ["ref_attested_by", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_by TEXT"],
    ["ref_attested_title", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_attested_title TEXT"],
    ["ref_locked", "ALTER TABLE veritamap_analyte_values ADD COLUMN ref_locked INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (!avCols.includes(col)) { try { sqlite.exec(ddl); } catch {} }
  }
  const amrCols = (sqlite.prepare("PRAGMA table_info(veritamap_amr_values)").all() as { name: string }[]).map(c => c.name);
  for (const [col, ddl] of [
    ["amr_attested_at", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_at TEXT"],
    ["amr_attested_by", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_by TEXT"],
    ["amr_attested_title", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_attested_title TEXT"],
    ["amr_locked", "ALTER TABLE veritamap_amr_values ADD COLUMN amr_locked INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (!amrCols.includes(col)) { try { sqlite.exec(ddl); } catch {} }
  }
}

// Multi-Lab Tier 2 — Phase 3.10 (VeritaResponse module):
// findings (user_id) is the parent; finding_attachments scopes through
// finding_id and inherits lab scope. Add lab_id to findings only.
//
// Wrapped in try-catch: `findings` is created later in db.ts (~line 2424).
// On a fresh build-container DB the table does not exist yet, so prepare()
// crashes. Production volume DB has the table, so on next boot the
// backfill runs idempotently. See PR #163 reorder for the same fix shape.
try {
  const cols = (sqlite.prepare(`PRAGMA table_info(findings)`).all() as any[]).map(c => c.name);
  if (!cols.includes("lab_id") && cols.length > 0) {
    try { sqlite.exec(`ALTER TABLE findings ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
  }
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_findings_lab ON findings(lab_id, due_date)`); } catch {}
  const sb = sqlite.prepare(`
    UPDATE findings
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = findings.user_id)
    WHERE lab_id IS NULL AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = findings.user_id) IS NOT NULL
  `).run();
  if (sb.changes > 0) console.log(`[migration] Multi-lab Phase 3.10 (findings): backfilled lab_id on ${sb.changes} row(s)`);
} catch (err: any) {
  console.warn(`[migration] Phase 3.10 (findings) skipped (table not yet created on fresh DB):`, err?.message);
}

// Multi-Lab Tier 2 — Phase 3.11 (VeritaStock module):
// inventory_items uses account_id (which is the owner_user_id, named
// differently because operations modules predate the user/owner pattern).
// Backfill maps account_id → users.lab_id.
//
// Wrapped in try-catch: `inventory_items` is created later in db.ts
// (~line 2149). Same fresh-DB-build crash mode as Phase 3.10.
try {
  const cols = (sqlite.prepare(`PRAGMA table_info(inventory_items)`).all() as any[]).map(c => c.name);
  if (!cols.includes("lab_id") && cols.length > 0) {
    try { sqlite.exec(`ALTER TABLE inventory_items ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
  }
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_items_lab ON inventory_items(lab_id)`); } catch {}
  const sb = sqlite.prepare(`
    UPDATE inventory_items
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = inventory_items.account_id)
    WHERE lab_id IS NULL AND account_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = inventory_items.account_id) IS NOT NULL
  `).run();
  if (sb.changes > 0) console.log(`[migration] Multi-lab Phase 3.11 (inventory_items): backfilled lab_id on ${sb.changes} row(s)`);
} catch (err: any) {
  console.warn(`[migration] Phase 3.11 (inventory_items) skipped (table not yet created on fresh DB):`, err?.message);
}

// One-shot barcode_value backfill (2026-06-04). Previously the print-labels
// endpoint synthesized VLS-<padded id> at render time without persisting,
// which left the canonical barcode at the mercy of any future change to the
// synthesis algorithm. This backfill locks in the current synthesized value
// as a stored column so labels printed once stay valid forever. Gated by
// WHERE barcode_value IS NULL OR = '' so subsequent boots are no-ops (per
// the boot-migration-no-cascading-writes rule).
try {
  const sb = sqlite.prepare(`
    UPDATE inventory_items
    SET barcode_value = 'VLS-' || printf('%08d', id)
    WHERE barcode_value IS NULL OR barcode_value = ''
  `).run();
  if (sb.changes > 0) console.log(`[migration] Inventory barcode persistence: backfilled barcode_value on ${sb.changes} row(s)`);
} catch (err: any) {
  console.warn(`[migration] Inventory barcode backfill skipped (table or column not yet ready):`, err?.message);
}

// Multi-Lab Tier 2 — Phase 3.9 (VeritaStaff module):
// staff_labs / staff_employees / staff_roles already carry a lab_id column
// but it references staff_labs(id), NOT the new multi-lab labs(id). Add a
// separate tier2_lab_id column on all three tables to point at the right
// labs row without renaming or repurposing the existing column. Backfill
// from users.lab_id via staff_labs.user_id (the staff_labs row is the
// parent identity for the staff employees/roles).
{
  const cols = (sqlite.prepare(`PRAGMA table_info(staff_labs)`).all() as any[]).map(c => c.name);
  if (!cols.includes("tier2_lab_id")) {
    try { sqlite.exec(`ALTER TABLE staff_labs ADD COLUMN tier2_lab_id INTEGER REFERENCES labs(id)`); } catch {}
  }
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_staff_labs_tier2_lab ON staff_labs(tier2_lab_id)`); } catch {}
  const sb = sqlite.prepare(`
    UPDATE staff_labs
    SET tier2_lab_id = (SELECT u.lab_id FROM users u WHERE u.id = staff_labs.user_id)
    WHERE tier2_lab_id IS NULL
      AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = staff_labs.user_id) IS NOT NULL
  `).run();
  if (sb.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3.9 (staff_labs): backfilled tier2_lab_id on ${sb.changes} row(s)`);
  }
}
for (const t of ["staff_employees", "staff_roles"]) {
  const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
  if (!cols.includes("tier2_lab_id")) {
    try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN tier2_lab_id INTEGER REFERENCES labs(id)`); } catch {}
  }
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_tier2_lab ON ${t}(tier2_lab_id)`); } catch {}
  const sb = sqlite.prepare(`
    UPDATE ${t}
    SET tier2_lab_id = (SELECT sl.tier2_lab_id FROM staff_labs sl WHERE sl.id = ${t}.lab_id)
    WHERE tier2_lab_id IS NULL
      AND lab_id IS NOT NULL
      AND (SELECT sl.tier2_lab_id FROM staff_labs sl WHERE sl.id = ${t}.lab_id) IS NOT NULL
  `).run();
  if (sb.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3.9 (${t}): backfilled tier2_lab_id on ${sb.changes} row(s)`);
  }
}

// Multi-Lab Tier 2 — Phase 3.8 (VeritaLab module):
// Three user_id tables: lab_certificates (parent), lab_certificate_documents
// and lab_certificate_reminders (children, both carry user_id for audit).
// All get lab_id directly to keep query paths flat.
{
  const tables = ["lab_certificates", "lab_certificate_documents", "lab_certificate_reminders"];
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes("lab_id")) {
      try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
    }
    try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`); } catch {}
    const backfilled = sqlite.prepare(`
      UPDATE ${t}
      SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id)
      WHERE lab_id IS NULL
        AND user_id IS NOT NULL
        AND (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id) IS NOT NULL
    `).run();
    if (backfilled.changes > 0) {
      console.log(`[migration] Multi-lab Phase 3.8 (${t}): backfilled lab_id on ${backfilled.changes} row(s)`);
    }
  }
}

// PR 6 of vendor management (2026-06-07): cross-link lab_certificates
// to stock_vendors. A cert with cert_type='vendor_agreement' may point
// at the vendor record it documents, so the VeritaStock vendor detail
// page can render a "Contract" panel pulled from this lab_certificates
// row. Nullable: agreements without a linked vendor (e.g. a free-text
// agreement before the directory was populated) still work fine.
{
  const cols = (sqlite.prepare("PRAGMA table_info(lab_certificates)").all() as any[]).map((c) => c.name);
  if (cols.length > 0 && !cols.includes("vendor_id")) {
    try { sqlite.exec("ALTER TABLE lab_certificates ADD COLUMN vendor_id INTEGER REFERENCES stock_vendors(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_lab_certificates_vendor ON lab_certificates(vendor_id)"); } catch {}
}

// Multi-Lab Tier 2 — Phase 3.7 (VeritaTrack module):
// Two user_id tables: veritatrack_tasks (parent), veritatrack_signoffs
// (child but also carries user_id for audit). Both get lab_id directly.
{
  const tables = ["veritatrack_tasks", "veritatrack_signoffs"];
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes("lab_id")) {
      try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
    }
    try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`); } catch {}
    const backfilled = sqlite.prepare(`
      UPDATE ${t}
      SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id)
      WHERE lab_id IS NULL
        AND user_id IS NOT NULL
        AND (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id) IS NOT NULL
    `).run();
    if (backfilled.changes > 0) {
      console.log(`[migration] Multi-lab Phase 3.7 (${t}): backfilled lab_id on ${backfilled.changes} row(s)`);
    }
  }
}

// Multi-Lab Tier 2 — Phase 3.6 (VeritaPT module):
// Five user_id tables: pt_enrollments, pt_events, pt_corrective_actions,
// pt_enrollments_v2, aa_records. Some are denormalized children that
// carry user_id alongside their parent FK; all get lab_id directly for
// query speed and to keep the dual-write simple.
{
  const tables = ["pt_enrollments", "pt_events", "pt_corrective_actions", "pt_enrollments_v2", "aa_records"];
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes("lab_id")) {
      try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
    }
    try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`); } catch {}
    const backfilled = sqlite.prepare(`
      UPDATE ${t}
      SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id)
      WHERE lab_id IS NULL
        AND user_id IS NOT NULL
        AND (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id) IS NOT NULL
    `).run();
    if (backfilled.changes > 0) {
      console.log(`[migration] Multi-lab Phase 3.6 (${t}): backfilled lab_id on ${backfilled.changes} row(s)`);
    }
  }
}

// A5-ext (2026-06-07, per Q1.a): tested_by_employee_id on pt_events
// so the new PT event entry UI can attribute each event to the tech
// who ran it. Nullable FK to staff_employees so importer-loaded rows
// (which today have no analyst attribution) don't break.
{
  const cols = (sqlite.prepare("PRAGMA table_info(pt_events)").all() as any[]).map(c => c.name);
  if (!cols.includes("tested_by_employee_id")) {
    try { sqlite.exec("ALTER TABLE pt_events ADD COLUMN tested_by_employee_id INTEGER REFERENCES staff_employees(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_pt_events_tested_by ON pt_events(tested_by_employee_id)"); } catch {}
}

// Multi-Lab Tier 2 — Phase 3.5 (VeritaComp module):
// Three top-level user_id tables: competency_programs, competency_employees,
// competency_quizzes. All other competency_* tables scope through one of
// these via program_id / employee_id / assessment_id / quiz_id and are
// transitively lab-scoped via their parents. staff_competency_schedules
// already carries lab_id (added earlier). Add lab_id to the three roots,
// idempotent backfill from users.lab_id.
{
  const tables = ["competency_programs", "competency_employees", "competency_quizzes"];
  for (const t of tables) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).map(c => c.name);
    if (!cols.includes("lab_id")) {
      try { sqlite.exec(`ALTER TABLE ${t} ADD COLUMN lab_id INTEGER REFERENCES labs(id)`); } catch {}
    }
    try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_lab ON ${t}(lab_id)`); } catch {}
    const backfilled = sqlite.prepare(`
      UPDATE ${t}
      SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id)
      WHERE lab_id IS NULL
        AND user_id IS NOT NULL
        AND (SELECT u.lab_id FROM users u WHERE u.id = ${t}.user_id) IS NOT NULL
    `).run();
    if (backfilled.changes > 0) {
      console.log(`[migration] Multi-lab Phase 3.5 (${t}): backfilled lab_id on ${backfilled.changes} row(s)`);
    }
  }
}

// PR D+ of the VeritaComp customer-blockers wave (2026-06-05):
// staff_employee_id foreign-key column on competency_employees so the
// assessment dialog can resolve a competency employee to their VeritaStaff
// record and pull assigned instruments for the suggested-method-groups
// hint. Idempotent additive ALTER; the backfill normalizes "First Last",
// "Last, First", and "Last First" forms case-insensitively to bridge the
// existing legacy data. Rows that do not match fall back to live name
// matching in the suggested-method-groups endpoint.
{
  const cols = (sqlite.prepare("PRAGMA table_info(competency_employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("staff_employee_id")) {
    try { sqlite.exec("ALTER TABLE competency_employees ADD COLUMN staff_employee_id INTEGER REFERENCES staff_employees(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_competency_employees_staff_id ON competency_employees(staff_employee_id)"); } catch {}
  const backfill = sqlite.prepare(`
    UPDATE competency_employees
    SET staff_employee_id = (
      SELECT se.id
      FROM staff_employees se
      WHERE se.tier2_lab_id = competency_employees.lab_id
        AND (
          LOWER(TRIM(se.first_name || ' ' || se.last_name)) = LOWER(TRIM(competency_employees.name))
          OR LOWER(TRIM(se.last_name || ', ' || se.first_name)) = LOWER(TRIM(competency_employees.name))
          OR LOWER(TRIM(se.last_name || ' ' || se.first_name)) = LOWER(TRIM(competency_employees.name))
        )
      LIMIT 1
    )
    WHERE staff_employee_id IS NULL
      AND lab_id IS NOT NULL
      AND name IS NOT NULL
  `).run();
  if (backfill.changes > 0) {
    console.log(`[migration] PR D+ competency_employees.staff_employee_id backfilled on ${backfill.changes} row(s)`);
  }

  // Phase B2 of the unification (2026-06-06): partial UNIQUE index on
  // (staff_employee_id, lab_id). Prevents the Phase B1 shim INSERT path
  // from creating two competency_employees rows pointing at the same
  // staff record under a race. Partial index (WHERE staff_employee_id
  // IS NOT NULL) so legacy unbridged rows still pass.
  //
  // Boot order safety: the index can fail to create if pre-existing
  // duplicates exist. Probe first; if duplicates are found, log a loud
  // warning and skip the index. The audit script in scripts/ surfaces
  // them for manual cleanup. On a clean DB the CREATE succeeds.
  try {
    const dupCount = (sqlite.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT staff_employee_id, lab_id
        FROM competency_employees
        WHERE staff_employee_id IS NOT NULL
        GROUP BY staff_employee_id, lab_id
        HAVING COUNT(*) > 1
      )
    `).get() as { n: number }).n;
    if (dupCount > 0) {
      console.warn(`[migration] Phase B2: ${dupCount} duplicate (staff_employee_id, lab_id) pair(s) on competency_employees. UNIQUE index skipped; run scripts/audit-comp-employee-unmatched.js then resolve manually.`);
    } else {
      sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_competency_employees_staff_lab_unique ON competency_employees(staff_employee_id, lab_id) WHERE staff_employee_id IS NOT NULL");
    }
  } catch (err: any) {
    console.warn(`[migration] Phase B2 UNIQUE index probe error: ${err?.message || err}`);
  }
}

// Multi-Lab Tier 2 — Phase 3.4 (VeritaScan module):
// veritascan_scans carries user_id; veritascan_items scopes through scan_id
// and is transitively lab-scoped via the parent. Add lab_id to scans only.
{
  const cols = (sqlite.prepare("PRAGMA table_info(veritascan_scans)").all() as any[]).map(c => c.name);
  if (!cols.includes("lab_id")) {
    try { sqlite.exec("ALTER TABLE veritascan_scans ADD COLUMN lab_id INTEGER REFERENCES labs(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_veritascan_scans_lab ON veritascan_scans(lab_id, id DESC)"); } catch {}
  const backfilled = sqlite.prepare(`
    UPDATE veritascan_scans
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = veritascan_scans.user_id)
    WHERE lab_id IS NULL
      AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = veritascan_scans.user_id) IS NOT NULL
  `).run();
  if (backfilled.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3.4 (veritascan_scans): backfilled lab_id on ${backfilled.changes} row(s)`);
  }
}

// Multi-Lab Tier 2 — Phase 3.3 (VeritaMap module):
// Only veritamap_maps carries user_id directly; all child tables
// (veritamap_instruments, _tests, _instrument_tests, _test_correlations,
// _analyte_values, _amr_values) scope through map_id, so they are
// transitively lab-scoped once veritamap_maps is. Add lab_id to maps,
// idempotent backfill, index for the dashboard list query.
{
  const cols = (sqlite.prepare("PRAGMA table_info(veritamap_maps)").all() as any[]).map(c => c.name);
  if (!cols.includes("lab_id")) {
    try { sqlite.exec("ALTER TABLE veritamap_maps ADD COLUMN lab_id INTEGER REFERENCES labs(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_veritamap_maps_lab ON veritamap_maps(lab_id, id DESC)"); } catch {}
  const backfilled = sqlite.prepare(`
    UPDATE veritamap_maps
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = veritamap_maps.user_id)
    WHERE lab_id IS NULL
      AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = veritamap_maps.user_id) IS NOT NULL
  `).run();
  if (backfilled.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3.3 (veritamap_maps): backfilled lab_id on ${backfilled.changes} row(s)`);
  }
}

// Multi-Lab Tier 2 — Phase 3.12 (CUMSUM, sub-feature of VeritaCheck):
// cumsum_trackers carries user_id; cumsum_entries scopes through tracker_id
// (FOREIGN KEY) and is transitively lab-scoped via the parent. Add lab_id
// to trackers only. Final remaining table from the original multi-lab sweep.
{
  const cols = (sqlite.prepare("PRAGMA table_info(cumsum_trackers)").all() as any[]).map(c => c.name);
  if (!cols.includes("lab_id")) {
    try { sqlite.exec("ALTER TABLE cumsum_trackers ADD COLUMN lab_id INTEGER REFERENCES labs(id)"); } catch {}
  }
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_cumsum_trackers_lab ON cumsum_trackers(lab_id)"); } catch {}
  const backfilled = sqlite.prepare(`
    UPDATE cumsum_trackers
    SET lab_id = (SELECT u.lab_id FROM users u WHERE u.id = cumsum_trackers.user_id)
    WHERE lab_id IS NULL
      AND user_id IS NOT NULL
      AND (SELECT u.lab_id FROM users u WHERE u.id = cumsum_trackers.user_id) IS NOT NULL
  `).run();
  if (backfilled.changes > 0) {
    console.log(`[migration] Multi-lab Phase 3.12 (cumsum_trackers): backfilled lab_id on ${backfilled.changes} row(s)`);
  }
}

// VeritaCheck Instrument Verification packages
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritacheck_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    instrument_name TEXT NOT NULL,
    manufacturer TEXT,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    map_instrument_id INTEGER,
    elements TEXT NOT NULL DEFAULT '["accuracy","precision","reportable_range","reference_interval"]',
    element_reasons TEXT NOT NULL DEFAULT '{}',
    clsi_notes TEXT NOT NULL DEFAULT '{}',
    director_name TEXT,
    director_title TEXT,
    approved_date TEXT,
    remediation_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Serial numbers / units per verification (multi-instrument support)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritacheck_verification_instruments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id INTEGER NOT NULL,
    serial_number TEXT NOT NULL,
    model TEXT,
    location TEXT,
    director_name TEXT,
    director_title TEXT,
    approved_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (verification_id) REFERENCES veritacheck_verifications(id)
  );
`);

// Study assignments per element per verification
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritacheck_verification_studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id INTEGER NOT NULL,
    element TEXT NOT NULL,
    study_id INTEGER,
    analyte TEXT,
    sample_count INTEGER,
    clsi_protocol TEXT,
    design_rationale TEXT,
    result_summary TEXT,
    passed INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (verification_id) REFERENCES veritacheck_verifications(id),
    FOREIGN KEY (study_id) REFERENCES studies(id)
  );
`);

// ── Migrations: veritacheck_verifications columns ───────────────────────────
try {
  const vcvCols = (sqlite.prepare("PRAGMA table_info(veritacheck_verifications)").all() as any[]).map((c: any) => c.name);
  if (!vcvCols.includes("elements"))         sqlite.exec(`ALTER TABLE veritacheck_verifications ADD COLUMN elements TEXT NOT NULL DEFAULT '["accuracy","precision","reportable_range","reference_interval"]'`);
  if (!vcvCols.includes("element_reasons"))  sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN element_reasons TEXT NOT NULL DEFAULT '{}'");
  if (!vcvCols.includes("clsi_notes"))        sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN clsi_notes TEXT NOT NULL DEFAULT '{}'");
  if (!vcvCols.includes("director_name"))    sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN director_name TEXT");
  if (!vcvCols.includes("director_title"))   sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN director_title TEXT");
  if (!vcvCols.includes("approved_date"))    sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN approved_date TEXT");
  if (!vcvCols.includes("remediation_notes")) sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN remediation_notes TEXT");
  if (!vcvCols.includes("map_instrument_id")) sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN map_instrument_id INTEGER");
  if (!vcvCols.includes("manufacturer"))     sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN manufacturer TEXT");
  // Cross-lab leak fix 2026-05-20: lab_id needed so the verification list
  // can be scoped by the active lab instead of user_id (which leaks across
  // every lab the owner is a member of).
  if (!vcvCols.includes("lab_id")) {
    sqlite.exec("ALTER TABLE veritacheck_verifications ADD COLUMN lab_id INTEGER REFERENCES labs(id)");
    sqlite.exec("CREATE INDEX IF NOT EXISTS idx_veritacheck_verifications_lab ON veritacheck_verifications(lab_id)");
    try {
      const backfilled = sqlite.prepare(
        "UPDATE veritacheck_verifications SET lab_id = (SELECT lab_id FROM users WHERE id = veritacheck_verifications.user_id) WHERE lab_id IS NULL"
      ).run();
      console.log(`[migration] veritacheck_verifications: backfilled lab_id on ${backfilled.changes} row(s)`);
    } catch (err: any) {
      console.warn("[migration] veritacheck_verifications lab_id backfill:", err.message);
    }
  }
} catch (e) { console.warn("veritacheck_verifications migration:", e); }

try {
  const vciCols = (sqlite.prepare("PRAGMA table_info(veritacheck_verification_instruments)").all() as any[]).map((c: any) => c.name);
  if (!vciCols.includes("model"))          sqlite.exec("ALTER TABLE veritacheck_verification_instruments ADD COLUMN model TEXT");
  if (!vciCols.includes("location"))       sqlite.exec("ALTER TABLE veritacheck_verification_instruments ADD COLUMN location TEXT");
  if (!vciCols.includes("director_name"))  sqlite.exec("ALTER TABLE veritacheck_verification_instruments ADD COLUMN director_name TEXT");
  if (!vciCols.includes("director_title")) sqlite.exec("ALTER TABLE veritacheck_verification_instruments ADD COLUMN director_title TEXT");
  if (!vciCols.includes("approved_date"))  sqlite.exec("ALTER TABLE veritacheck_verification_instruments ADD COLUMN approved_date TEXT");
} catch (e) { console.warn("veritacheck_verification_instruments migration:", e); }

try {
  const vcsCols = (sqlite.prepare("PRAGMA table_info(veritacheck_verification_studies)").all() as any[]).map((c: any) => c.name);
  if (!vcsCols.includes("analyte"))           sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN analyte TEXT");
  if (!vcsCols.includes("sample_count"))      sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN sample_count INTEGER");
  if (!vcsCols.includes("clsi_protocol"))     sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN clsi_protocol TEXT");
  if (!vcsCols.includes("design_rationale"))  sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN design_rationale TEXT");
  if (!vcsCols.includes("result_summary"))    sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN result_summary TEXT");
  if (!vcsCols.includes("passed"))            sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN passed INTEGER");
  if (!vcsCols.includes("updated_at"))        sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN updated_at TEXT");
  if (!vcsCols.includes("study_id"))          sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN study_id INTEGER");
  // 2026-06-09 multi-analyte verification packages (Michael feedback).
  // analyte_id FK to veritacheck_verification_analytes; NULL on legacy
  // rows until the backfill block below runs. scope='analyte' is the
  // default; 'instrument' marks a carryover study that applies to
  // every analyte on the package (EP10 is sample-path-based, not
  // analyte-specific).
  if (!vcsCols.includes("analyte_id"))        sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN analyte_id INTEGER");
  if (!vcsCols.includes("scope"))             sqlite.exec("ALTER TABLE veritacheck_verification_studies ADD COLUMN scope TEXT NOT NULL DEFAULT 'analyte'");
} catch (e) { console.warn("veritacheck_verification_studies migration:", e); }

// ── 2026-06-09 Multi-analyte verification packages (Michael feedback) ──
//
// A Verification Package historically modeled one instrument + one
// analyte. Real labs onboard chemistry analyzers with 25+ analytes, so
// the per-analyte click-through was painful. This table is the
// container for N analytes per package; veritacheck_verification_studies
// gains analyte_id pointing here.
//
// Per-analyte lifecycle (draft / finalized) so the director can sign
// off on analyte A while analyte B is still in progress. Carryover
// scope='instrument' on the studies row means one EP10 study covers
// every analyte (the default for new packages; existing packages keep
// scope='analyte' so behavior does not change for surveyors who have
// already received a PDF).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritacheck_verification_analytes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    verification_id INTEGER NOT NULL,
    analyte_name TEXT NOT NULL,
    tea_value REAL,
    tea_units TEXT,
    tea_is_percentage INTEGER DEFAULT 1,
    mdls_json TEXT,
    amr_low REAL,
    amr_high REAL,
    amr_units TEXT,
    lifecycle_state TEXT NOT NULL DEFAULT 'draft',
    finalized_at TEXT,
    finalized_by_user_id INTEGER,
    finalized_signature TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (verification_id) REFERENCES veritacheck_verifications(id)
  )
`);
sqlite.exec("CREATE INDEX IF NOT EXISTS idx_vc_verification_analytes_verification ON veritacheck_verification_analytes(verification_id)");

// Migration block for veritacheck_verification_analytes (paired with
// the CREATE above per the NEW DB TABLE RULE). The columns below are
// all in the CREATE, so this block is a no-op today; it exists so
// future ALTERs land in the right place.
try {
  const vcaCols = (sqlite.prepare("PRAGMA table_info(veritacheck_verification_analytes)").all() as any[]).map((c: any) => c.name);
  if (!vcaCols.includes("analyte_name"))         sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN analyte_name TEXT");
  if (!vcaCols.includes("tea_value"))            sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN tea_value REAL");
  if (!vcaCols.includes("tea_units"))            sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN tea_units TEXT");
  if (!vcaCols.includes("tea_is_percentage"))    sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN tea_is_percentage INTEGER DEFAULT 1");
  if (!vcaCols.includes("mdls_json"))            sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN mdls_json TEXT");
  if (!vcaCols.includes("amr_low"))              sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN amr_low REAL");
  if (!vcaCols.includes("amr_high"))             sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN amr_high REAL");
  if (!vcaCols.includes("amr_units"))            sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN amr_units TEXT");
  if (!vcaCols.includes("lifecycle_state"))      sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'draft'");
  if (!vcaCols.includes("finalized_at"))         sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN finalized_at TEXT");
  if (!vcaCols.includes("finalized_by_user_id")) sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN finalized_by_user_id INTEGER");
  if (!vcaCols.includes("finalized_signature"))  sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN finalized_signature TEXT");
  if (!vcaCols.includes("sort_order"))           sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  // 2026-06-09 (overnight session 6/11): analyte amendment workflow.
  // Mirrors amends_study_id on studies (PR #693).
  if (!vcaCols.includes("amends_analyte_id"))    sqlite.exec("ALTER TABLE veritacheck_verification_analytes ADD COLUMN amends_analyte_id INTEGER");
} catch (e) { console.warn("veritacheck_verification_analytes migration:", e); }

// Idempotent backfill: every legacy verification gets a one-analyte
// degenerate-case row so the new renderer + endpoints can rely on
// veritacheck_verification_analytes always being non-empty. The
// analyte name comes from the first study's analyte field, or
// "Analyte not specified" if there are no studies.
//
// Per the "no cascading writes" boot-migration rule (lab_members
// 2026-05-24 incident): the loop only INSERTs new rows and SETs
// analyte_id on studies that currently have NULL. No reads from
// mutable state, no re-derive of already-set values.
try {
  const verifsNeedingAnalyte = sqlite.prepare(`
    SELECT v.id, v.user_id
    FROM veritacheck_verifications v
    WHERE NOT EXISTS (
      SELECT 1 FROM veritacheck_verification_analytes a WHERE a.verification_id = v.id
    )
  `).all() as any[];
  let inserted = 0;
  let linkedStudies = 0;
  const insertAnalyte = sqlite.prepare(
    "INSERT INTO veritacheck_verification_analytes (verification_id, analyte_name, sort_order) VALUES (?, ?, 0)"
  );
  const linkStudies = sqlite.prepare(
    "UPDATE veritacheck_verification_studies SET analyte_id = ? WHERE verification_id = ? AND analyte_id IS NULL"
  );
  for (const v of verifsNeedingAnalyte) {
    const firstStudyAnalyte = (sqlite.prepare(
      "SELECT analyte FROM veritacheck_verification_studies WHERE verification_id = ? AND analyte IS NOT NULL AND analyte <> '' ORDER BY id LIMIT 1"
    ).get(v.id) as any)?.analyte;
    const analyteName = firstStudyAnalyte || "Analyte not specified";
    const result = insertAnalyte.run(v.id, analyteName);
    inserted++;
    const linked = linkStudies.run(result.lastInsertRowid, v.id);
    linkedStudies += linked.changes;
  }
  if (inserted > 0 || linkedStudies > 0) {
    console.log(`[migration] veritacheck_verification_analytes: created ${inserted} degenerate analyte row(s); linked ${linkedStudies} study row(s)`);
  }
} catch (err: any) {
  console.warn("[migration] veritacheck_verification_analytes backfill:", err.message);
}

// ── VeritaBench: Productivity Months ────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS productivity_months (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    billable_tests INTEGER,
    productive_hours REAL,
    non_productive_hours REAL,
    overtime_hours REAL,
    total_ftes REAL,
    facility_type TEXT DEFAULT 'community',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(account_id, year, month)
  )
`);

// ALTER TABLE migration for productivity_months
{
  const pmCols = sqlite.prepare("PRAGMA table_info(productivity_months)").all() as { name: string }[];
  const pmColNames = pmCols.map((c) => c.name);
  if (pmCols.length > 0) {
    if (!pmColNames.includes("non_productive_hours")) {
      try { sqlite.exec("ALTER TABLE productivity_months ADD COLUMN non_productive_hours REAL"); } catch {}
    }
    if (!pmColNames.includes("overtime_hours")) {
      try { sqlite.exec("ALTER TABLE productivity_months ADD COLUMN overtime_hours REAL"); } catch {}
    }
    if (!pmColNames.includes("total_ftes")) {
      try { sqlite.exec("ALTER TABLE productivity_months ADD COLUMN total_ftes REAL"); } catch {}
    }
    if (!pmColNames.includes("facility_type")) {
      try { sqlite.exec("ALTER TABLE productivity_months ADD COLUMN facility_type TEXT DEFAULT 'community'"); } catch {}
    }
    if (!pmColNames.includes("notes")) {
      try { sqlite.exec("ALTER TABLE productivity_months ADD COLUMN notes TEXT"); } catch {}
    }
  }
}

// ── VeritaBench: Staffing Studies ───────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staffing_studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    department TEXT DEFAULT 'Core Lab',
    start_date TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ALTER TABLE migration for staffing_studies
{
  const ssCols = sqlite.prepare("PRAGMA table_info(staffing_studies)").all() as { name: string }[];
  const ssColNames = ssCols.map((c) => c.name);
  if (ssCols.length > 0) {
    if (!ssColNames.includes("department")) {
      try { sqlite.exec("ALTER TABLE staffing_studies ADD COLUMN department TEXT DEFAULT 'Core Lab'"); } catch {}
    }
    if (!ssColNames.includes("start_date")) {
      try { sqlite.exec("ALTER TABLE staffing_studies ADD COLUMN start_date TEXT"); } catch {}
    }
    if (!ssColNames.includes("status")) {
      try { sqlite.exec("ALTER TABLE staffing_studies ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
    }
  }
}

// ── VeritaBench: Staffing Hourly Data ──────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staffing_hourly_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    study_id INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    hour_slot INTEGER NOT NULL,
    metric_type TEXT NOT NULL,
    value REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(study_id, week_number, day_of_week, hour_slot, metric_type),
    FOREIGN KEY (study_id) REFERENCES staffing_studies(id) ON DELETE CASCADE
  )
`);

// ALTER TABLE migration for staffing_hourly_data
{
  const shdCols = sqlite.prepare("PRAGMA table_info(staffing_hourly_data)").all() as { name: string }[];
  const shdColNames = shdCols.map((c) => c.name);
  if (shdCols.length > 0) {
    if (!shdColNames.includes("metric_type")) {
      try { sqlite.exec("ALTER TABLE staffing_hourly_data ADD COLUMN metric_type TEXT NOT NULL DEFAULT 'received'"); } catch {}
    }
    if (!shdColNames.includes("value")) {
      try { sqlite.exec("ALTER TABLE staffing_hourly_data ADD COLUMN value REAL DEFAULT 0"); } catch {}
    }
  }
}

// ── VeritaBench: Inventory Items ───────────────────────────────────────────────
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    catalog_number TEXT,
    lot_number TEXT,
    department TEXT DEFAULT 'Core Lab',
    category TEXT DEFAULT 'Reagent',
    quantity_on_hand INTEGER DEFAULT 0,
    reorder_point INTEGER DEFAULT 5,
    unit TEXT DEFAULT 'each',
    expiration_date TEXT,
    vendor TEXT,
    storage_location TEXT,
    notes TEXT,
    status TEXT DEFAULT 'active',
    burn_rate REAL DEFAULT 0,
    order_unit TEXT DEFAULT 'each',
    usage_unit TEXT DEFAULT 'each',
    units_per_order_unit INTEGER DEFAULT 1,
    count_unit TEXT DEFAULT 'each',
    units_per_count_unit INTEGER DEFAULT 1,
    lead_time_days INTEGER DEFAULT 5,
    safety_stock_days INTEGER DEFAULT 3,
    desired_days_of_stock INTEGER DEFAULT 30,
    standing_order INTEGER DEFAULT 0,
    standing_order_review_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ALTER TABLE migration for inventory_items
{
  const iiCols = sqlite.prepare("PRAGMA table_info(inventory_items)").all() as { name: string }[];
  const iiColNames = iiCols.map((c) => c.name);
  if (iiCols.length > 0) {
    if (!iiColNames.includes("catalog_number")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN catalog_number TEXT"); } catch {}
    }
    if (!iiColNames.includes("lot_number")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN lot_number TEXT"); } catch {}
    }
    if (!iiColNames.includes("department")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN department TEXT DEFAULT 'Core Lab'"); } catch {}
    }
    if (!iiColNames.includes("category")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN category TEXT DEFAULT 'Reagent'"); } catch {}
    }
    if (!iiColNames.includes("quantity_on_hand")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN quantity_on_hand INTEGER DEFAULT 0"); } catch {}
    }
    if (!iiColNames.includes("reorder_point")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN reorder_point INTEGER DEFAULT 5"); } catch {}
    }
    if (!iiColNames.includes("unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN unit TEXT DEFAULT 'each'"); } catch {}
    }
    if (!iiColNames.includes("expiration_date")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN expiration_date TEXT"); } catch {}
    }
    if (!iiColNames.includes("vendor")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN vendor TEXT"); } catch {}
    }
    if (!iiColNames.includes("storage_location")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN storage_location TEXT"); } catch {}
    }
    if (!iiColNames.includes("notes")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN notes TEXT"); } catch {}
    }
    if (!iiColNames.includes("status")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN status TEXT DEFAULT 'active'"); } catch {}
    }
    if (!iiColNames.includes("burn_rate")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN burn_rate REAL DEFAULT 0"); } catch {}
    }
    if (!iiColNames.includes("order_unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN order_unit TEXT DEFAULT 'each'"); } catch {}
    }
    if (!iiColNames.includes("usage_unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN usage_unit TEXT DEFAULT 'each'"); } catch {}
    }
    if (!iiColNames.includes("units_per_order_unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN units_per_order_unit INTEGER DEFAULT 1"); } catch {}
    }
    if (!iiColNames.includes("lead_time_days")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN lead_time_days INTEGER DEFAULT 5"); } catch {}
    }
    if (!iiColNames.includes("safety_stock_days")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN safety_stock_days INTEGER DEFAULT 3"); } catch {}
    }
    if (!iiColNames.includes("desired_days_of_stock")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN desired_days_of_stock INTEGER DEFAULT 30"); } catch {}
    }
    if (!iiColNames.includes("standing_order")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN standing_order INTEGER DEFAULT 0"); } catch {}
    }
    if (!iiColNames.includes("standing_order_review_date")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN standing_order_review_date TEXT"); } catch {}
    }
    // parking-lot #29 Phase 0: barcode_value for scan flow. Nullable so
    // existing rows do not break; uniqueness enforced per-account via
    // idx_inventory_barcode below.
    if (!iiColNames.includes("barcode_value")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN barcode_value TEXT"); } catch {}
    }
    // 2026-06-09 count_unit + units_per_count_unit. Decouples "what you
    // physically count" from "what you buy" (order_unit) and "what you
    // consume per test" (usage_unit). For most labs all three are the
    // same ("each"). For reagent-kit shops, the lab can count by box
    // while internal storage stays in usage_unit so burn_rate /
    // days_left math doesn't change semantics. Stored qty stays in
    // usage_unit; the kiosk multiplies entered count * units_per_count_unit
    // before write. Defaults preserve current "count by each" behavior.
    if (!iiColNames.includes("count_unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN count_unit TEXT DEFAULT 'each'"); } catch {}
    }
    if (!iiColNames.includes("units_per_count_unit")) {
      try { sqlite.exec("ALTER TABLE inventory_items ADD COLUMN units_per_count_unit INTEGER DEFAULT 1"); } catch {}
    }
  }
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_items_account ON inventory_items(account_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_items_expiration ON inventory_items(account_id, expiration_date)`); } catch {}
// parking-lot #29 Phase 0: barcode_value lookup index. NOT UNIQUE here
// because legacy rows without a barcode share NULL; the application layer
// rejects duplicate barcode inserts via a per-account uniqueness check.
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_barcode ON inventory_items(account_id, barcode_value)`); } catch {}

// VeritaStock vendor management (2026-06-07): the lab's vendor directory.
// One row per (lab, vendor) — each lab has its own account numbers,
// PO numbers, sales reps, and contracted ordering pattern, so the table
// is lab-scoped from the start (not user-scoped). The lab manager sees
// this in the new VeritaStock Vendors page; the Order PDF generator
// auto-fills its cover page from these rows when a vendor record exists.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS stock_vendors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    account_number TEXT,
    po_number TEXT,
    ordering_pattern TEXT,
    ordering_email TEXT,
    ordering_phone TEXT,
    ordering_fax TEXT,
    ordering_portal_url TEXT,
    order_tracking_url TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    UNIQUE (lab_id, name)
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_stock_vendors_lab ON stock_vendors(lab_id)`); } catch {}

// Migration block per NEW DB TABLE RULE (Section 8). Adds any column
// that may be missing from an older boot. Idempotent.
{
  const cols = (sqlite.prepare("PRAGMA table_info(stock_vendors)").all() as { name: string }[]).map((c) => c.name);
  if (cols.length > 0) {
    const required: Array<[string, string]> = [
      ["account_number", "TEXT"],
      ["po_number", "TEXT"],
      ["ordering_pattern", "TEXT"],
      ["ordering_email", "TEXT"],
      ["ordering_phone", "TEXT"],
      ["ordering_fax", "TEXT"],
      ["ordering_portal_url", "TEXT"],
      ["order_tracking_url", "TEXT"],
      ["notes", "TEXT"],
      ["status", "TEXT NOT NULL DEFAULT 'active'"],
    ];
    for (const [c, t] of required) {
      if (!cols.includes(c)) {
        try { sqlite.exec(`ALTER TABLE stock_vendors ADD COLUMN ${c} ${t}`); } catch {}
      }
    }
  }
}

// VeritaStock vendor contacts (2026-06-07): one vendor typically has
// multiple contact paths (sales rep + customer service + tech support +
// dedicated orders inbox), as documented in the San Carlos directory
// (e.g. Werfen has 3 distinct contact tracks). Modeled as a child of
// stock_vendors so the lab manager can capture all of them without
// flattening the relationship.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS stock_vendor_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    lab_id INTEGER NOT NULL,
    contact_name TEXT NOT NULL,
    contact_role TEXT,
    title TEXT,
    phone TEXT,
    mobile TEXT,
    email TEXT,
    region TEXT,
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (vendor_id) REFERENCES stock_vendors(id),
    FOREIGN KEY (lab_id) REFERENCES labs(id)
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_stock_vendor_contacts_vendor ON stock_vendor_contacts(vendor_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_stock_vendor_contacts_lab ON stock_vendor_contacts(lab_id)`); } catch {}

{
  const cols = (sqlite.prepare("PRAGMA table_info(stock_vendor_contacts)").all() as { name: string }[]).map((c) => c.name);
  if (cols.length > 0) {
    const required: Array<[string, string]> = [
      ["contact_role", "TEXT"],
      ["title", "TEXT"],
      ["phone", "TEXT"],
      ["mobile", "TEXT"],
      ["email", "TEXT"],
      ["region", "TEXT"],
      ["notes", "TEXT"],
      ["sort_order", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [c, t] of required) {
      if (!cols.includes(c)) {
        try { sqlite.exec(`ALTER TABLE stock_vendor_contacts ADD COLUMN ${c} ${t}`); } catch {}
      }
    }
  }
}

// parking-lot #29 Phase 0: scan_events audit table. Every barcode scan
// (whether it changes quantity or not) writes one row so the lab has a
// complete who/what/when timeline. account_id matches inventory_items.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    -- Nullable: a scan against an unknown barcode still writes a row
    -- with the raw barcode_value captured so the user can later assign
    -- it to an item without losing the audit trail.
    inventory_item_id INTEGER,
    user_id INTEGER NOT NULL,
    -- 'decrement' (consume stock), 'increment' (receive stock),
    -- 'lookup_only' (scan to identify, no quantity change),
    -- 'correction' (admin fix mis-scan), 'unknown_barcode' (scan failed
    -- to resolve to an item).
    action TEXT NOT NULL,
    -- Signed delta. NULL for lookup_only / unknown_barcode.
    quantity_delta INTEGER,
    -- Snapshots so a future audit can prove the delta without
    -- re-fetching the item (which may have moved on by then).
    quantity_before INTEGER,
    quantity_after INTEGER,
    -- The raw barcode_value scanned. Stored even if it matches the
    -- item's current barcode_value so a label re-print does not
    -- invalidate the trail.
    barcode_value TEXT,
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scan_events_account ON scan_events(account_id, scanned_at)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scan_events_item ON scan_events(inventory_item_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_scan_events_user ON scan_events(user_id)`); } catch {}

// Migration sentinel block for the new Phase 0 table, per the
// CLAUDE.md NEW DB TABLE RULE.
{
  const scanCols = (sqlite.prepare("PRAGMA table_info(scan_events)").all() as { name: string }[]).map((c) => c.name);
  void scanCols;
}

// VeritaOps: cost-per-reportable-test (CPRT) studies. PARKING_LOT #10.
// Layered cost model per CLSI GP11-A "Basic Cost Accounting for Clinical
// Services" conceptual basis:
//   L1 = reagents + amortized calibrators + amortized QC + other supplies
//   L2 = L1 + (tech minutes per test / 60) × loaded hourly rate
//   L3 = L2 + (instrument depreciation / annual volume) + (annual maintenance / annual volume)
//   L4 = L3 (or L2 if !include_capital) + overhead (flat per-test OR % markup)
// L1 and L2 default on (most lab directors know reagent + labor; labor is
// the biggest blind spot). L3 and L4 opt-in via the include_* toggles.
// Lab-scoped via lab_id; account_id retained for legacy single-lab routes.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritaops_test_cost_studies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    lab_id INTEGER,
    test_name TEXT NOT NULL,
    loinc TEXT,
    department TEXT DEFAULT 'Core Lab',
    annual_volume INTEGER DEFAULT 0,
    reagent_cost_per_test REAL DEFAULT 0,
    calibrator_kit_cost REAL DEFAULT 0,
    cals_per_year INTEGER DEFAULT 0,
    qc_cost_per_run REAL DEFAULT 0,
    qc_runs_per_year INTEGER DEFAULT 0,
    other_supplies_per_test REAL DEFAULT 0,
    tech_minutes_per_test REAL DEFAULT 0,
    tech_loaded_hourly_rate REAL DEFAULT 0,
    include_capital INTEGER DEFAULT 0,
    instrument_purchase_cost REAL DEFAULT 0,
    instrument_useful_life_years INTEGER DEFAULT 7,
    annual_maintenance_cost REAL DEFAULT 0,
    include_overhead INTEGER DEFAULT 0,
    overhead_method TEXT DEFAULT 'flat',
    overhead_value REAL DEFAULT 0,
    cprt_l1 REAL DEFAULT 0,
    cprt_l2 REAL DEFAULT 0,
    cprt_l3 REAL DEFAULT 0,
    cprt_l4 REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ALTER TABLE migration for veritaops_test_cost_studies. Adding new fields
// in future PRs (e.g. semi-variable handling, charge-master comparison)
// goes here as additional ensure() lines so production DBs pick them up
// without manual migration. Per CLAUDE.md NEW DB TABLE RULE.
{
  const vopsCols = sqlite.prepare("PRAGMA table_info(veritaops_test_cost_studies)").all() as { name: string }[];
  const vopsColNames = vopsCols.map((c) => c.name);
  const vopsEnsure = (name: string, alter: string) => {
    if (vopsCols.length > 0 && !vopsColNames.includes(name)) {
      try { sqlite.exec(alter); } catch {}
    }
  };
  vopsEnsure("lab_id",                       "ALTER TABLE veritaops_test_cost_studies ADD COLUMN lab_id INTEGER");
  vopsEnsure("loinc",                        "ALTER TABLE veritaops_test_cost_studies ADD COLUMN loinc TEXT");
  vopsEnsure("department",                   "ALTER TABLE veritaops_test_cost_studies ADD COLUMN department TEXT DEFAULT 'Core Lab'");
  vopsEnsure("annual_volume",                "ALTER TABLE veritaops_test_cost_studies ADD COLUMN annual_volume INTEGER DEFAULT 0");
  vopsEnsure("reagent_cost_per_test",        "ALTER TABLE veritaops_test_cost_studies ADD COLUMN reagent_cost_per_test REAL DEFAULT 0");
  vopsEnsure("calibrator_kit_cost",          "ALTER TABLE veritaops_test_cost_studies ADD COLUMN calibrator_kit_cost REAL DEFAULT 0");
  vopsEnsure("cals_per_year",                "ALTER TABLE veritaops_test_cost_studies ADD COLUMN cals_per_year INTEGER DEFAULT 0");
  vopsEnsure("qc_cost_per_run",              "ALTER TABLE veritaops_test_cost_studies ADD COLUMN qc_cost_per_run REAL DEFAULT 0");
  vopsEnsure("qc_runs_per_year",             "ALTER TABLE veritaops_test_cost_studies ADD COLUMN qc_runs_per_year INTEGER DEFAULT 0");
  vopsEnsure("other_supplies_per_test",      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN other_supplies_per_test REAL DEFAULT 0");
  vopsEnsure("tech_minutes_per_test",        "ALTER TABLE veritaops_test_cost_studies ADD COLUMN tech_minutes_per_test REAL DEFAULT 0");
  vopsEnsure("tech_loaded_hourly_rate",      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN tech_loaded_hourly_rate REAL DEFAULT 0");
  vopsEnsure("include_capital",              "ALTER TABLE veritaops_test_cost_studies ADD COLUMN include_capital INTEGER DEFAULT 0");
  vopsEnsure("instrument_purchase_cost",     "ALTER TABLE veritaops_test_cost_studies ADD COLUMN instrument_purchase_cost REAL DEFAULT 0");
  vopsEnsure("instrument_useful_life_years", "ALTER TABLE veritaops_test_cost_studies ADD COLUMN instrument_useful_life_years INTEGER DEFAULT 7");
  vopsEnsure("annual_maintenance_cost",      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN annual_maintenance_cost REAL DEFAULT 0");
  vopsEnsure("include_overhead",             "ALTER TABLE veritaops_test_cost_studies ADD COLUMN include_overhead INTEGER DEFAULT 0");
  vopsEnsure("overhead_method",              "ALTER TABLE veritaops_test_cost_studies ADD COLUMN overhead_method TEXT DEFAULT 'flat'");
  vopsEnsure("overhead_value",               "ALTER TABLE veritaops_test_cost_studies ADD COLUMN overhead_value REAL DEFAULT 0");
  vopsEnsure("cprt_l1",                      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN cprt_l1 REAL DEFAULT 0");
  vopsEnsure("cprt_l2",                      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN cprt_l2 REAL DEFAULT 0");
  vopsEnsure("cprt_l3",                      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN cprt_l3 REAL DEFAULT 0");
  vopsEnsure("cprt_l4",                      "ALTER TABLE veritaops_test_cost_studies ADD COLUMN cprt_l4 REAL DEFAULT 0");
  vopsEnsure("notes",                        "ALTER TABLE veritaops_test_cost_studies ADD COLUMN notes TEXT");
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritaops_studies_account ON veritaops_test_cost_studies(account_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritaops_studies_lab ON veritaops_test_cost_studies(lab_id)`); } catch {}

// VeritaMap instrument-add requests. Customers submit when their instrument
// isn't in the picker; an email fires to info@veritaslabservices.com so
// review is timely. Status: pending / approved / rejected with reviewer
// notes. lab_id is nullable for legacy single-lab users.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS veritamap_instrument_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    lab_id INTEGER,
    instrument_name TEXT NOT NULL,
    vendor TEXT,
    category_suggestion TEXT,
    example_analytes TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewer_notes TEXT,
    resolved_by_user_id INTEGER,
    resolved_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritamap_instrument_requests_status ON veritamap_instrument_requests(status, created_at)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_veritamap_instrument_requests_user ON veritamap_instrument_requests(user_id, created_at)`); } catch {}
// Migration sentinel per CLAUDE.md §8 NEW DB TABLE RULE. All columns for
// veritamap_instrument_requests are in the CREATE TABLE above; no columns
// have been added post-merge. If new columns are added later, guard them
// with the ensure() pattern used by the qc_* tables below.
try { (sqlite.prepare(`PRAGMA table_info(veritamap_instrument_requests)`).all() as any[]); } catch {}

// One-time backfill: blood bank compatibility tests should be HIGH complexity
// per 42 CFR 493.17 (transfusion services). Pre-2026-05-22 the fdaInstrumentData
// classified ABO, Rh, antibody screen, crossmatch, DAT etc. as MODERATE, which
// is only correct in the rare non-transfusion context. Update existing user
// records to match the corrected source data. Idempotent: only touches rows
// that are currently MODERATE AND whose analyte matches the compatibility-test
// patterns AND whose specialty is Blood Bank or Immunohematology. Records the
// number of rows updated to the migration log so we can confirm the change.
try {
  const compatibilityPattern = (
    // ABO (Group, grouping, tube, forward, reverse, compatibility, /Rh typing)
    "(LOWER(analyte) LIKE 'abo%' OR LOWER(analyte) LIKE '%/rh typing%' OR " +
    // Rh (Type, typing, tube, phenotype)
    "LOWER(analyte) LIKE 'rh %' OR LOWER(analyte) LIKE 'rh(%' OR LOWER(analyte) = 'rh type' OR LOWER(analyte) LIKE 'rh typ%' OR LOWER(analyte) LIKE 'rh phenotyp%' OR " +
    // Antibody (screen, screening, identification)
    "LOWER(analyte) LIKE 'antibody screen%' OR LOWER(analyte) LIKE 'antibody identif%' OR " +
    // Crossmatch (any variant)
    "LOWER(analyte) LIKE '%crossmatch%' OR LOWER(analyte) LIKE '%xm%' OR " +
    // DAT and Direct Antiglobulin variants
    "LOWER(analyte) LIKE 'dat%' OR LOWER(analyte) LIKE 'direct antiglobulin%' OR LOWER(analyte) LIKE 'indirect antiglobulin%' OR " +
    // Phenotyping (Rh, Kell, Duffy, Kidd, MNS)
    "LOWER(analyte) LIKE 'phenotyping%' OR " +
    // Immediate spin crossmatch
    "LOWER(analyte) LIKE 'immediate spin%')"
  );
  const result = sqlite.prepare(
    `UPDATE veritamap_instrument_tests
     SET complexity = 'HIGH'
     WHERE complexity = 'MODERATE'
       AND (specialty = 'Blood Bank' OR specialty = 'Immunohematology')
       AND ${compatibilityPattern}`
  ).run();
  if (result.changes > 0) {
    console.log(`[migration] Blood bank compatibility tests: bumped ${result.changes} row(s) MODERATE -> HIGH per 42 CFR 493.17`);
  }
} catch (err: any) {
  console.warn('[migration] Blood bank backfill failed (table may not yet exist):', err?.message);
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_productivity_months_account ON productivity_months(account_id, year, month)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_staffing_studies_account ON staffing_studies(account_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_staffing_hourly_study ON staffing_hourly_data(study_id, week_number, day_of_week)`); } catch {}

// -- VeritaBench: PI Dashboard tables ----------------------------------------
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS pi_departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ALTER TABLE migration for pi_departments
{
  const pdCols = sqlite.prepare("PRAGMA table_info(pi_departments)").all() as { name: string }[];
  const pdColNames = pdCols.map((c) => c.name);
  if (pdCols.length > 0) {
    if (!pdColNames.includes("sort_order")) {
      try { sqlite.exec("ALTER TABLE pi_departments ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {}
    }
    if (!pdColNames.includes("active")) {
      try { sqlite.exec("ALTER TABLE pi_departments ADD COLUMN active INTEGER DEFAULT 1"); } catch {}
    }
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS pi_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    unit TEXT DEFAULT '%',
    direction TEXT DEFAULT 'lower_is_better',
    benchmark_green REAL,
    benchmark_yellow REAL,
    benchmark_red REAL,
    sort_order INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (department_id) REFERENCES pi_departments(id) ON DELETE CASCADE
  )
`);

// ALTER TABLE migration for pi_metrics
{
  const pmtCols = sqlite.prepare("PRAGMA table_info(pi_metrics)").all() as { name: string }[];
  const pmtColNames = pmtCols.map((c) => c.name);
  if (pmtCols.length > 0) {
    if (!pmtColNames.includes("unit")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN unit TEXT DEFAULT '%'"); } catch {}
    }
    if (!pmtColNames.includes("direction")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN direction TEXT DEFAULT 'lower_is_better'"); } catch {}
    }
    if (!pmtColNames.includes("benchmark_green")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN benchmark_green REAL"); } catch {}
    }
    if (!pmtColNames.includes("benchmark_yellow")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN benchmark_yellow REAL"); } catch {}
    }
    if (!pmtColNames.includes("benchmark_red")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN benchmark_red REAL"); } catch {}
    }
    if (!pmtColNames.includes("sort_order")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN sort_order INTEGER DEFAULT 0"); } catch {}
    }
    if (!pmtColNames.includes("active")) {
      try { sqlite.exec("ALTER TABLE pi_metrics ADD COLUMN active INTEGER DEFAULT 1"); } catch {}
    }
  }
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS pi_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    value REAL,
    volume INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(metric_id, year, month),
    FOREIGN KEY (metric_id) REFERENCES pi_metrics(id) ON DELETE CASCADE
  )
`);

// ALTER TABLE migration for pi_entries
{
  const peCols = sqlite.prepare("PRAGMA table_info(pi_entries)").all() as { name: string }[];
  const peColNames = peCols.map((c) => c.name);
  if (peCols.length > 0) {
    if (!peColNames.includes("volume")) {
      try { sqlite.exec("ALTER TABLE pi_entries ADD COLUMN volume INTEGER"); } catch {}
    }
    if (!peColNames.includes("notes")) {
      try { sqlite.exec("ALTER TABLE pi_entries ADD COLUMN notes TEXT"); } catch {}
    }
    if (!peColNames.includes("updated_at")) {
      try { sqlite.exec("ALTER TABLE pi_entries ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))"); } catch {}
    }
  }
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_pi_departments_account ON pi_departments(account_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_pi_metrics_dept ON pi_metrics(department_id, account_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_pi_entries_metric ON pi_entries(metric_id, year, month)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_pi_entries_account ON pi_entries(account_id, year)`); } catch {}

// ── One-shot reconciliation: purge orphan veritamap_tests rows ───────────────
// Background: prior to the fix in routes.ts, rebuildMapTests used
// INSERT OR IGNORE only — it never deleted rows when an analyte was toggled
// off, an instrument was deleted, or a wrong test menu was imported and then
// the offending instrument was removed. Result: the Excel export pulled stale
// analytes (e.g. cortisol on a chemistry-only lab) with empty Instruments and
// Serial Number columns. This block reconciles every existing map on boot
// once, so labs in the field don't have to wait for a re-toggle to clean up.
try {
  const tablesExist = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('veritamap_tests','veritamap_instrument_tests','veritamap_analyte_values','veritamap_amr_values')"
  ).all() as { name: string }[];
  const have = new Set(tablesExist.map((t) => t.name));
  if (have.has('veritamap_tests') && have.has('veritamap_instrument_tests')) {
    const orphans = sqlite.prepare(`
      SELECT vt.map_id, vt.analyte
      FROM veritamap_tests vt
      WHERE NOT EXISTS (
        SELECT 1
        FROM veritamap_instrument_tests it
        WHERE it.map_id = vt.map_id
          AND it.analyte = vt.analyte
          AND it.active = 1
      )
    `).all() as { map_id: number; analyte: string }[];

    if (orphans.length > 0) {
      const delTest = sqlite.prepare("DELETE FROM veritamap_tests WHERE map_id = ? AND analyte = ?");
      const delAnalyteVal = have.has('veritamap_analyte_values')
        ? sqlite.prepare("DELETE FROM veritamap_analyte_values WHERE map_id = ? AND analyte = ?")
        : null;
      const delAmrVal = have.has('veritamap_amr_values')
        ? sqlite.prepare("DELETE FROM veritamap_amr_values WHERE map_id = ? AND analyte = ?")
        : null;
      const tx = sqlite.transaction((rows: { map_id: number; analyte: string }[]) => {
        for (const r of rows) {
          delTest.run(r.map_id, r.analyte);
          if (delAnalyteVal) delAnalyteVal.run(r.map_id, r.analyte);
          if (delAmrVal) delAmrVal.run(r.map_id, r.analyte);
        }
      });
      tx(orphans);
      const affectedMaps = new Set(orphans.map((o) => o.map_id)).size;
      console.log(`[veritamap-reconcile] Removed ${orphans.length} orphan analyte row(s) across ${affectedMaps} map(s).`);
    }
  }
} catch (err) {
  console.error('[veritamap-reconcile] Failed:', err);
}

// ─── VeritaResponse (parking-lot #17) ─────────────────────────────────────────
// Post-survey deficiency response. One normalized findings table with
// per-accreditor renderers added in later phases. Schema follows the common
// spine documented in docs/scoping-veritaresponse.md §6.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    accreditor TEXT NOT NULL CHECK(accreditor IN ('CAP','TJC','COLA','CMS','AABB','Other')),
    inspection_id TEXT,
    finding_number TEXT,
    standard_ref TEXT,
    phase_or_severity TEXT,
    description TEXT,
    surveyor_notes TEXT,
    anchor_date TEXT,
    due_date TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','drafting','submitted','accepted','rejected_resubmit','closed')),
    immediate_action TEXT,
    containment TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    monitoring_plan TEXT,
    completion_date TEXT,
    signed_by TEXT,
    signed_at TEXT,
    external_submission_ref TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS finding_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_type TEXT,
    file_bytes BLOB,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS finding_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id INTEGER NOT NULL,
    event TEXT NOT NULL,
    by_user_id INTEGER,
    at TEXT DEFAULT (datetime('now')),
    payload TEXT
  );

  CREATE TABLE IF NOT EXISTS finding_extension_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id INTEGER NOT NULL,
    requested_until TEXT NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted','denied','withdrawn')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- Due-date email reminder dispatch log. Last Tier-1 gap from
  -- docs/scoping-veritaresponse.md. One row per (finding, reminder window
  -- T-14 / T-7 / T-3 / T-1) actually sent. UNIQUE constraint protects
  -- against double-fires across server restarts and across the manual
  -- admin trigger + scheduled nightly job. COLA findings are skipped
  -- upstream (no hard deadline per scoping doc) so no rows appear for
  -- them here.
  CREATE TABLE IF NOT EXISTS finding_reminder_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    finding_id INTEGER NOT NULL,
    reminder_type TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    recipient_email TEXT,
    UNIQUE(finding_id, reminder_type),
    FOREIGN KEY (finding_id) REFERENCES findings(id)
  );
`);

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_finding_reminder_log_finding ON finding_reminder_log(finding_id)`); } catch {}

// VeritaResponse migration blocks (idempotent). Per New DB Table Rule
// (CLAUDE.md §8): every new CREATE TABLE ships with a PRAGMA-guarded ALTER
// block so future column additions can be applied to live DBs that already
// have the tables. One block per table; the audit script enforces this.
{
  try {
    const cols = sqlite.prepare("PRAGMA table_info(findings)").all() as { name: string }[];
    if (cols.length > 0) {
      // Future ALTER TABLE findings ADD COLUMN ... blocks go here.
    }
  } catch {
    // fresh DB: CREATE TABLE above handled it
  }
}
{
  try {
    const cols = sqlite.prepare("PRAGMA table_info(finding_attachments)").all() as { name: string }[];
    if (cols.length > 0) {
      // Future ALTER TABLE finding_attachments ADD COLUMN ... blocks go here.
    }
  } catch {}
}
{
  try {
    const cols = sqlite.prepare("PRAGMA table_info(finding_history)").all() as { name: string }[];
    if (cols.length > 0) {
      // Future ALTER TABLE finding_history ADD COLUMN ... blocks go here.
    }
  } catch {}
}
{
  try {
    const cols = sqlite.prepare("PRAGMA table_info(finding_extension_requests)").all() as { name: string }[];
    if (cols.length > 0) {
      // Future ALTER TABLE finding_extension_requests ADD COLUMN ... blocks go here.
    }
  } catch {}
}
{
  try {
    const cols = sqlite.prepare("PRAGMA table_info(finding_reminder_log)").all() as { name: string }[];
    if (cols.length > 0) {
      // Future ALTER TABLE finding_reminder_log ADD COLUMN ... blocks go here.
    }
  } catch {}
}

try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_findings_user ON findings(user_id, status)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_findings_due ON findings(user_id, due_date)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_finding_attachments_finding ON finding_attachments(finding_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_finding_history_finding ON finding_history(finding_id, at)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_finding_extension_finding ON finding_extension_requests(finding_id, status)`); } catch {}

// Step 3: Seed plan from env var (for testing — SEED_USER_PLAN=email:plan:credits)
if (process.env.SEED_USER_PLAN) {
  const [seedEmail, seedPlan, seedCredits] = process.env.SEED_USER_PLAN.split(":");
  if (seedEmail && seedPlan) {
    const credits = parseInt(seedCredits || "0");
    // Never downgrade an existing paid plan on deploy
    const PAID_PLANS = ["annual","professional","lab","complete","waived","community","hospital","large_hospital","enterprise","veritacheck_only"];
    const existing = sqlite.prepare("SELECT plan FROM users WHERE email = ?").get(seedEmail.toLowerCase()) as any;
    if (existing && PAID_PLANS.includes(existing.plan) && !PAID_PLANS.includes(seedPlan)) {
      console.log(`[seed] Skipped: ${seedEmail} already on paid plan '${existing.plan}', not overwriting with '${seedPlan}'`);
    } else {
      sqlite.prepare("UPDATE users SET plan = ?, study_credits = ? WHERE email = ?").run(seedPlan, credits, seedEmail.toLowerCase());
      console.log(`[seed] Set ${seedEmail} to plan=${seedPlan} credits=${credits}`);
    }
  }
}

// ─── VeritaQC Phase 0: schema only (parking-lot #20) ─────────────────────────
// Live QC engine: Levey-Jennings + Westgard. Six tables. No customer-facing
// surface in Phase 0; the entry endpoints, evaluator, and monthly review PDF
// land in Phase 1.
//
// Tables:
//   qc_control_lots        — per-lab control material; manufacturer mean/SD,
//                            stored SD interval (1/2/3) so derived SD is
//                            never assumed (operator's prior Excel bug).
//   qc_results             — daily QC readings, one row per run; accepted_for_
//                            reporting toggles via Phase 1 corrective-action gate.
//   qc_rule_violations     — Westgard rule events tied to qc_results.
//   qc_corrective_actions  — in-the-moment action documentation; nce_reference
//                            free-text hook for future VeritaResponse FK.
//   qc_period_reviews      — monthly review attestation (NOT accept/reject).
//   qc_rule_settings       — per-lab (with optional per-analyte override)
//                            configurable bias_consecutive_count, trend_count,
//                            and enabled-rules list per CLSI C24 guidance.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS qc_control_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'mid',
    lot_number TEXT NOT NULL,
    manufacturer TEXT,
    mfr_mean REAL NOT NULL,
    mfr_sd REAL NOT NULL,
    mfr_sd_interval INTEGER NOT NULL DEFAULT 2,
    mfr_range_low REAL,
    mfr_range_high REAL,
    expiration_date TEXT,
    opened_date TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    UNIQUE(lab_id, analyte, lot_number)
  );

  CREATE TABLE IF NOT EXISTS qc_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    control_lot_id INTEGER NOT NULL,
    instrument TEXT,
    result_value REAL NOT NULL,
    result_date TEXT NOT NULL,
    run_time TEXT,
    operator_user_id INTEGER,
    comment TEXT,
    accepted_for_reporting INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (control_lot_id) REFERENCES qc_control_lots(id)
  );

  CREATE TABLE IF NOT EXISTS qc_rule_violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qc_result_id INTEGER NOT NULL,
    rule_code TEXT NOT NULL,
    severity TEXT NOT NULL,
    detail TEXT,
    related_result_ids TEXT,
    evaluated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (qc_result_id) REFERENCES qc_results(id)
  );

  CREATE TABLE IF NOT EXISTS qc_corrective_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    qc_result_id INTEGER NOT NULL,
    qc_rule_violation_id INTEGER,
    action_taken TEXT NOT NULL,
    taken_by_user_id INTEGER NOT NULL,
    taken_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'open',
    follow_up_notes TEXT,
    nce_reference TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (qc_result_id) REFERENCES qc_results(id),
    FOREIGN KEY (qc_rule_violation_id) REFERENCES qc_rule_violations(id)
  );

  CREATE TABLE IF NOT EXISTS qc_period_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    control_lot_id INTEGER NOT NULL,
    period_month INTEGER NOT NULL,
    period_year INTEGER NOT NULL,
    reviewed_by_user_id INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL DEFAULT (datetime('now')),
    attestation_acknowledged INTEGER NOT NULL DEFAULT 0,
    review_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    FOREIGN KEY (control_lot_id) REFERENCES qc_control_lots(id),
    UNIQUE(lab_id, control_lot_id, period_year, period_month)
  );

  CREATE TABLE IF NOT EXISTS qc_rule_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    analyte TEXT,
    bias_consecutive_count INTEGER NOT NULL DEFAULT 10,
    trend_consecutive_count INTEGER NOT NULL DEFAULT 7,
    enabled_rules_json TEXT NOT NULL DEFAULT '["1-2s","1-3s","2-2s","R-4s","4-1s","N-x","N-T"]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    UNIQUE(lab_id, analyte)
  );

  -- VeritaQC -> VeritaCheck import: sticky per-(lab, analyte) level-name
  -- mapping. When a tech runs VeritaQC -> Precision Verification import for
  -- (lab 3, analyte "Glucose"), VeritaQC's control_lot.level "Bio-Rad
  -- Multiqual L1" is mapped to the verification study's level_name "QC Low".
  -- Mapping is sticky so the next import on the same (lab, analyte) reuses
  -- it. Tech can edit + re-save to override. Per design doc v2 decision #3.
  CREATE TABLE IF NOT EXISTS veritaqc_import_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    analyte TEXT NOT NULL,
    qc_level TEXT NOT NULL,
    study_level_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (lab_id) REFERENCES labs(id),
    UNIQUE(lab_id, analyte, qc_level)
  );

  -- PDF download tokens. Browser claims a token via GET /api/pdf/:token after
  -- a server-side POST mints it; the GET delivers the PDF buffer and deletes
  -- the row (one-time use). Persisted to SQLite (not an in-memory Map) so the
  -- token survives deploys, OOM-restarts, and multi-replica load balancing.
  -- See server/pdfTokens.ts for the storePdfToken / claimPdfToken API.
  CREATE TABLE IF NOT EXISTS pdf_tokens (
    token TEXT PRIMARY KEY,
    buffer BLOB NOT NULL,
    filename TEXT NOT NULL,
    expires INTEGER NOT NULL
  );
`);

// Opportunistic index for the prune sweep done on every mint. Cheap insert
// on a few-row table but worth having so prune stays O(matched) not O(table).
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_pdf_tokens_expires ON pdf_tokens(expires)`); } catch {}
// Migration sentinel per CLAUDE.md §8 NEW DB TABLE RULE. pdf_tokens is brand
// new in PR #385; all four columns are in the CREATE TABLE above. If columns
// are added later (e.g., user_id for audit, content_type for non-PDF blobs),
// guard them with the ensure() pattern used by the qc_* tables below.
try { (sqlite.prepare(`PRAGMA table_info(pdf_tokens)`).all() as any[]); } catch {}

// Migration sentinels for two more post-grandfathered tables that shipped
// without their own ensure() blocks. All current columns are defined in the
// CREATE TABLE above; this anchor lets the audit script see migration was
// considered. Add ensure() rows here if new columns are introduced.
try { (sqlite.prepare(`PRAGMA table_info(backup_integrity_log)`).all() as any[]); } catch {}
try { (sqlite.prepare(`PRAGMA table_info(founding_lab_applications)`).all() as any[]); } catch {}

// VeritaQC PRAGMA-guarded ALTER migration blocks per CLAUDE.md §8 NEW DB TABLE
// RULE. Each block re-reads the live table's columns and adds anything that
// was introduced after a prior partial deploy. Pattern mirrors lab_members.
{
  const ensure = (tableName: string, col: string, sql: string) => {
    try {
      const cols = (sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as any[]).map(c => c.name);
      if (!cols.includes(col)) { try { sqlite.exec(sql); } catch {} }
    } catch {}
  };
  ensure("qc_control_lots", "level",              "ALTER TABLE qc_control_lots ADD COLUMN level TEXT NOT NULL DEFAULT 'mid'");
  ensure("qc_control_lots", "manufacturer",       "ALTER TABLE qc_control_lots ADD COLUMN manufacturer TEXT");
  ensure("qc_control_lots", "mfr_sd_interval",    "ALTER TABLE qc_control_lots ADD COLUMN mfr_sd_interval INTEGER NOT NULL DEFAULT 2");
  ensure("qc_control_lots", "mfr_range_low",      "ALTER TABLE qc_control_lots ADD COLUMN mfr_range_low REAL");
  ensure("qc_control_lots", "mfr_range_high",     "ALTER TABLE qc_control_lots ADD COLUMN mfr_range_high REAL");
  ensure("qc_control_lots", "expiration_date",    "ALTER TABLE qc_control_lots ADD COLUMN expiration_date TEXT");
  ensure("qc_control_lots", "opened_date",        "ALTER TABLE qc_control_lots ADD COLUMN opened_date TEXT");
  ensure("qc_control_lots", "status",             "ALTER TABLE qc_control_lots ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");

  ensure("qc_results", "instrument",              "ALTER TABLE qc_results ADD COLUMN instrument TEXT");
  ensure("qc_results", "run_time",                "ALTER TABLE qc_results ADD COLUMN run_time TEXT");
  ensure("qc_results", "operator_user_id",        "ALTER TABLE qc_results ADD COLUMN operator_user_id INTEGER");
  ensure("qc_results", "comment",                 "ALTER TABLE qc_results ADD COLUMN comment TEXT");
  ensure("qc_results", "accepted_for_reporting",  "ALTER TABLE qc_results ADD COLUMN accepted_for_reporting INTEGER NOT NULL DEFAULT 1");

  ensure("qc_rule_violations", "detail",              "ALTER TABLE qc_rule_violations ADD COLUMN detail TEXT");
  ensure("qc_rule_violations", "related_result_ids",  "ALTER TABLE qc_rule_violations ADD COLUMN related_result_ids TEXT");

  ensure("qc_corrective_actions", "qc_rule_violation_id", "ALTER TABLE qc_corrective_actions ADD COLUMN qc_rule_violation_id INTEGER");
  ensure("qc_corrective_actions", "status",                "ALTER TABLE qc_corrective_actions ADD COLUMN status TEXT NOT NULL DEFAULT 'open'");
  ensure("qc_corrective_actions", "follow_up_notes",       "ALTER TABLE qc_corrective_actions ADD COLUMN follow_up_notes TEXT");
  ensure("qc_corrective_actions", "nce_reference",         "ALTER TABLE qc_corrective_actions ADD COLUMN nce_reference TEXT");

  ensure("qc_period_reviews", "attestation_acknowledged", "ALTER TABLE qc_period_reviews ADD COLUMN attestation_acknowledged INTEGER NOT NULL DEFAULT 0");
  ensure("qc_period_reviews", "review_notes",             "ALTER TABLE qc_period_reviews ADD COLUMN review_notes TEXT");

  ensure("qc_rule_settings", "analyte",                    "ALTER TABLE qc_rule_settings ADD COLUMN analyte TEXT");

  // veritaqc_import_mappings: new in VeritaQC Import Phase A. All five
  // columns are in the CREATE TABLE above; ensure() block is the migration
  // anchor per CLAUDE.md §8.
  ensure("veritaqc_import_mappings", "study_level_name",
         "ALTER TABLE veritaqc_import_mappings ADD COLUMN study_level_name TEXT NOT NULL DEFAULT ''");
  ensure("veritaqc_import_mappings", "updated_at",
         "ALTER TABLE veritaqc_import_mappings ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  ensure("qc_rule_settings", "bias_consecutive_count",     "ALTER TABLE qc_rule_settings ADD COLUMN bias_consecutive_count INTEGER NOT NULL DEFAULT 10");
  ensure("qc_rule_settings", "trend_consecutive_count",    "ALTER TABLE qc_rule_settings ADD COLUMN trend_consecutive_count INTEGER NOT NULL DEFAULT 7");
  ensure("qc_rule_settings", "enabled_rules_json",         "ALTER TABLE qc_rule_settings ADD COLUMN enabled_rules_json TEXT NOT NULL DEFAULT '[\"1-2s\",\"1-3s\",\"2-2s\",\"R-4s\",\"4-1s\",\"N-x\",\"N-T\"]'");
}

// VeritaQC indexes for the read paths Phase 1 will hit hardest.
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_control_lots_lab ON qc_control_lots(lab_id, status)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_results_lot_date ON qc_results(control_lot_id, result_date)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_results_lab_date ON qc_results(lab_id, result_date DESC)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_rule_violations_result ON qc_rule_violations(qc_result_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_corrective_actions_result ON qc_corrective_actions(qc_result_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_period_reviews_lot_period ON qc_period_reviews(lab_id, control_lot_id, period_year, period_month)`); } catch {}

// ── VeritaLab extension: CMS-116 application drafts + state licensure registry ──
//
// Parking-lot #22 Phase 1 scaffolding. Two surfaces land alongside the
// existing certificate tracker:
//
//   1. cms116_drafts: per-lab draft of the federal CLIA application
//      (CMS Form 116). One draft per lab; updates overwrite the prior
//      draft. PDF generation is a follow-on phase; this table just
//      stores the field values so the lab can resume editing.
//
//   2. state_lab_licensure_registry: static reference table of per-state
//      (and DC) laboratory licensure authorities. Seeded read-only from
//      a follow-on data-author pass. Empty in this scaffold commit.
//      Rows describe the agency, the form URL, the fee, the renewal
//      cadence, and any notes. Lab-agnostic; one row per jurisdiction.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS cms116_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- Form sections stored as JSON for forward-compat as CMS revises
    -- the form. Field naming follows the CMS-116 OMB section labels.
    section_i_json TEXT,        -- General Information
    section_ii_json TEXT,       -- Type of Certificate Requested
    section_iii_json TEXT,      -- Type of Laboratory
    section_iv_json TEXT,       -- Hours of Lab Testing
    section_v_json TEXT,        -- Multiple Sites
    section_vi_json TEXT,       -- Waived Testing
    section_vii_json TEXT,      -- PPM Procedures
    section_viii_json TEXT,     -- Non-Waived Testing
    section_ix_json TEXT,       -- Test Volume Estimate
    section_x_json TEXT,        -- Director Information
    director_signature_name TEXT,
    director_signature_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft',  -- draft | submitted | issued
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(lab_id)
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_cms116_drafts_lab ON cms116_drafts(lab_id)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS state_lab_licensure_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- USPS two-letter postal code (CA, NY, DC). Unique so each
    -- jurisdiction has at most one canonical row.
    state_code TEXT NOT NULL,
    state_name TEXT NOT NULL,
    -- "yes" if the state requires its own laboratory license beyond
    -- CLIA; "no" if CLIA alone is sufficient; "exempt" if the state is
    -- a CLIA-exempt state (NY, WA) where the state license substitutes
    -- for CLIA entirely.
    licensure_required TEXT NOT NULL DEFAULT 'no',
    authority_name TEXT,
    authority_url TEXT,
    application_form_name TEXT,
    application_form_url TEXT,
    fee_description TEXT,
    renewal_cadence TEXT,        -- annual | biennial | triennial | other
    notes TEXT,
    source_citation TEXT,        -- URL the row was sourced from
    last_verified TEXT,          -- YYYY-MM-DD; reauthor pass updates
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(state_code)
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_state_registry_code ON state_lab_licensure_registry(state_code)`); } catch {}

// Migration sentinels (no schema changes yet, but keeps the pattern in
// place per CLAUDE.md NEW DB TABLE RULE so the next ALTER lands cleanly).
{
  const cms116Cols = (sqlite.prepare("PRAGMA table_info(cms116_drafts)").all() as { name: string }[]).map((c) => c.name);
  void cms116Cols;
  const stateCols = (sqlite.prepare("PRAGMA table_info(state_lab_licensure_registry)").all() as { name: string }[]).map((c) => c.name);
  void stateCols;
}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_qc_rule_settings_lab ON qc_rule_settings(lab_id)`); } catch {}

// ── VeritaPolicy approval workflow extension (parking-lot policy-approval Phase 0) ──
// Functional mirror of MediaLab Document Control: upload, multi-step approval,
// 21 CFR Part 11 audit trail, employee read-and-attest, periodic reviews,
// version control. Nine new tables; this PR is schema only. UI, upload, and
// workflow engine ship in Phases 1+ as separate PRs.
//
// Lab scoping: tables that carry org-level state (manuals, documents,
// workflows, audit log) include lab_id. Per-document tables (versions,
// signoffs, attestations, review_reminders) are lab-scoped transitively
// through document_id -> policy_documents.lab_id.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_manuals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- e.g., "Chemistry", "Hematology", "Safety", "QA". Per-lab configurable.
    name TEXT NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_manuals_lab ON policy_manuals(lab_id)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- Nullable so a freshly-uploaded policy can land in "unassigned"
    -- until the lab admin sorts it into a manual.
    manual_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    -- FK to policy_versions.id; null on row creation, set after first
    -- version uploads. Avoids a circular foreign key dependency.
    current_version_id INTEGER,
    -- Lifecycle state machine: draft -> in_review -> approved -> expired -> archived.
    -- Rejection from review returns to draft with comment recorded in
    -- policy_signoffs.action='rejected'.
    status TEXT NOT NULL DEFAULT 'draft',
    -- The lab user who uploaded / owns the policy. Distinct from
    -- approvers in policy_signoffs.
    owner_user_id INTEGER NOT NULL,
    effective_date TEXT,
    next_review_date TEXT,
    review_interval_months INTEGER NOT NULL DEFAULT 12,
    -- FK to policy_approval_workflows.id; null means no workflow
    -- assigned yet (document sits in draft until workflow chosen).
    workflow_id INTEGER,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_documents_lab ON policy_documents(lab_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_documents_manual ON policy_documents(manual_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_documents_status ON policy_documents(status)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_documents_next_review ON policy_documents(next_review_date)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    -- Monotonically increasing per document. Server computes max+1 on upload.
    version_number INTEGER NOT NULL,
    -- Relative path under /data/policies/. Server resolves at I/O time so
    -- the volume mount path can change without rewriting rows.
    -- Format: <lab_id>/<document_id>/v<version_number>/document.<ext>
    file_path TEXT NOT NULL,
    file_format TEXT NOT NULL, -- 'docx' | 'pdf' | 'html'
    file_size_bytes INTEGER NOT NULL,
    -- SHA-256 of the file content at upload time. Used for tamper detection
    -- on download and for the signed_document_hash captured at signature.
    file_hash_sha256 TEXT NOT NULL,
    change_summary TEXT,
    uploaded_by INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_versions_doc ON policy_versions(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_versions_hash ON policy_versions(file_hash_sha256)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_approval_workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- e.g., "Single LD approval", "TC then LD", "Author->TC->LD".
    name TEXT NOT NULL,
    description TEXT,
    -- One workflow per lab can be marked default; new documents auto-assign to it.
    is_default INTEGER NOT NULL DEFAULT 0,
    archived_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_workflows_lab ON policy_approval_workflows(lab_id)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_approval_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id INTEGER NOT NULL,
    -- 1-indexed ordering. Steps execute in order; each must be approved
    -- before the next becomes actionable.
    step_order INTEGER NOT NULL,
    step_name TEXT NOT NULL,
    -- Role-based routing: 'medical_director', 'technical_consultant',
    -- 'technical_supervisor', 'general_supervisor', 'any_view_only_seat',
    -- 'any_active_seat', 'specific_user'. When 'specific_user', the
    -- specific_user_id column is populated.
    required_role TEXT NOT NULL,
    specific_user_id INTEGER,
    -- If 0, the workflow blocks self-approval (owner cannot approve their
    -- own document). Most CLIA workflows want this.
    allow_self_approval INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_steps_workflow ON policy_approval_steps(workflow_id)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_signoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    version_id INTEGER NOT NULL,
    -- Nullable: out-of-band signoffs (e.g., a director signing without
    -- a workflow step assigned) still get recorded.
    workflow_step_id INTEGER,
    user_id INTEGER NOT NULL,
    -- 'approved' | 'rejected' | 'recused'. Recused means the assigned
    -- user has a conflict and the step needs reassignment.
    action TEXT NOT NULL,
    comment TEXT,
    -- The typed full name per 21 CFR Part 11 electronic signature
    -- (FDA Compliance Policy Guide 7153.17). Combined with password
    -- re-auth at signing time, this is the minimum CLIA-lab signature.
    typed_signature TEXT NOT NULL,
    -- SHA-256 of the document version at the moment of signing. Used
    -- to detect tampering after signature.
    signed_document_hash TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    signed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_signoffs_doc ON policy_signoffs(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_signoffs_user ON policy_signoffs(user_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_signoffs_step ON policy_signoffs(workflow_step_id)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_attestations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    -- The specific version the user attested to. Lets compliance reports
    -- show "Sarah attested to v3; current is v5 since 2026-04-10".
    version_id INTEGER NOT NULL,
    assigned_to_user_id INTEGER NOT NULL,
    assigned_by INTEGER NOT NULL,
    assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
    due_date TEXT,
    completed_at TEXT,
    -- SHA-256 at attest time. Mirror of policy_signoffs hash logic for
    -- non-repudiation: "I attested to this exact content."
    attested_document_hash TEXT,
    typed_signature TEXT,
    ip_address TEXT,
    user_agent TEXT,
    quiz_score INTEGER, -- 0-100 if attached quiz used; null otherwise
    quiz_total_questions INTEGER
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_attest_doc ON policy_attestations(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_attest_user ON policy_attestations(assigned_to_user_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_attest_pending ON policy_attestations(completed_at, due_date)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_review_reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    -- The date the reminder should fire. Cron job (existing infra) reads
    -- rows where sent_at IS NULL and reminder_date <= today.
    reminder_date TEXT NOT NULL,
    sent_at TEXT,
    -- '30_day_warning' (30d before next_review_date), 'overdue' (past
    -- next_review_date), 'final' (60d past next_review_date).
    reminder_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_reminders_doc ON policy_review_reminders(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_reminders_pending ON policy_review_reminders(sent_at, reminder_date)`); } catch {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- Nullable: lab-level actions (e.g., "manual created") have no
    -- document. Document-level actions populate this FK.
    document_id INTEGER,
    user_id INTEGER NOT NULL,
    -- 'uploaded', 'viewed', 'edited', 'workflow_assigned', 'approved',
    -- 'rejected', 'attestation_assigned', 'attestation_completed',
    -- 'archived', 'restored', 'manual_created', 'manual_edited',
    -- 'workflow_created', 'workflow_edited'.
    action TEXT NOT NULL,
    -- JSON object with action-specific metadata (e.g., for 'approved':
    -- {workflow_step_id, comment}). Shape validated at write time.
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_audit_lab ON policy_audit_log(lab_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_audit_doc ON policy_audit_log(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_audit_user ON policy_audit_log(user_id)`); } catch {}

// Phase 8 — surveyor public-link table. Lab owner generates a signed
// URL a surveyor can use to browse approved policies without an
// account. Auto-expires; lab admin can revoke at any time.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_surveyor_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    -- Random UUID stored as canonical text. The token is what appears
    -- in the public URL; non-guessable.
    token TEXT NOT NULL UNIQUE,
    -- Optional human label so the admin can keep multiple links
    -- straight (e.g., "CAP visit Q3 2026").
    label TEXT,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    -- Audit metrics for "did the surveyor actually use it?" reporting.
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_surveyor_links_lab ON policy_surveyor_links(lab_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_surveyor_links_token ON policy_surveyor_links(token)`); } catch {}

// Migration sentinel block. Pure read of PRAGMA table_info so the next
// ALTER TABLE for these tables lands without re-checking column presence.
// Per CLAUDE.md feedback: NO writes, NO derived-state cascades.
{
  const manualsCols = (sqlite.prepare("PRAGMA table_info(policy_manuals)").all() as { name: string }[]).map((c) => c.name);
  void manualsCols;
  const docsCols = (sqlite.prepare("PRAGMA table_info(policy_documents)").all() as { name: string }[]).map((c) => c.name);
  void docsCols;
  const versionsCols = (sqlite.prepare("PRAGMA table_info(policy_versions)").all() as { name: string }[]).map((c) => c.name);
  void versionsCols;
  const workflowsCols = (sqlite.prepare("PRAGMA table_info(policy_approval_workflows)").all() as { name: string }[]).map((c) => c.name);
  void workflowsCols;
  const stepsCols = (sqlite.prepare("PRAGMA table_info(policy_approval_steps)").all() as { name: string }[]).map((c) => c.name);
  void stepsCols;
  const signoffsCols = (sqlite.prepare("PRAGMA table_info(policy_signoffs)").all() as { name: string }[]).map((c) => c.name);
  void signoffsCols;
  const attestCols = (sqlite.prepare("PRAGMA table_info(policy_attestations)").all() as { name: string }[]).map((c) => c.name);
  void attestCols;
  const remindersCols = (sqlite.prepare("PRAGMA table_info(policy_review_reminders)").all() as { name: string }[]).map((c) => c.name);
  void remindersCols;
  const surveyorCols = (sqlite.prepare("PRAGMA table_info(policy_surveyor_links)").all() as { name: string }[]).map((c) => c.name);
  void surveyorCols;
  const auditCols = (sqlite.prepare("PRAGMA table_info(policy_audit_log)").all() as { name: string }[]).map((c) => c.name);
  void auditCols;
}

// MediaLab parity #39 item 2 (2026-06-07): quiz questions on policy
// attestations. quiz_score + quiz_total_questions columns already exist
// on policy_attestations (since Phase 4); this table is what those
// columns reference. Five to ten multiple-choice questions per policy
// per the MediaLab pattern; questions are versioned per-document, not
// per-version, so a policy revision doesn't invalidate the question
// bank unless the lab edits it.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS policy_quiz_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    lab_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    choices_json TEXT NOT NULL,
    correct_index INTEGER NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (document_id) REFERENCES policy_documents(id),
    FOREIGN KEY (lab_id) REFERENCES labs(id)
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_quiz_doc ON policy_quiz_questions(document_id, display_order)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_policy_quiz_lab ON policy_quiz_questions(lab_id)`); } catch {}

// Migration safety: if an older db ever omitted any of the columns
// declared above, ALTER TABLE to add them so prod boot doesn't crash.
// (No real migration needed today; this block exists to satisfy the
// audit's NEW-table-needs-ALTER-block rule and to future-proof the
// schema against an inadvertent column rename.)
{
  const quizCols = (sqlite.prepare("PRAGMA table_info(policy_quiz_questions)").all() as { name: string }[]).map((c) => c.name);
  if (!quizCols.includes("display_order")) {
    try { sqlite.exec("ALTER TABLE policy_quiz_questions ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0"); } catch {}
  }
}

// ─── Staff Portal policy signatures (Wave K5, 2026-06-08) ────────────────
//
// Mirror of policy_attestations for the Staff Portal kiosk surface at
// /staff-access. policy_attestations is keyed on assigned_to_user_id
// (a real users.id), but Staff Portal sign-ins are not real user
// accounts — they're staff_employees rows accessed via a synthetic
// staff-portal JWT (kind="staff_portal" with the lab_id, no user_id).
//
// Surveyor-defensibility model: typed name + document SHA-256 +
// IP + UA + timestamp at sign time. Same non-repudiation pattern the
// real user-account flow uses (typed_signature + attested_document_hash
// on policy_attestations). Lab director vouches for the typed name via
// the VeritaStaff roster + the per-employee picker on /staff-access.
//
// Scope: each row represents one staff member signing one version of
// one policy. A re-sign after a policy revision is a new row; the
// (document_id, staff_employee_id, version_id) uniqueness gives us
// "did this employee sign this exact version" without join chains.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staff_portal_policy_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    -- The specific policy_versions.id the staff member saw at sign time
    version_id INTEGER NOT NULL,
    staff_employee_id INTEGER NOT NULL,
    signed_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- SHA-256 of the version content the staff member acknowledged.
    -- Mirrors policy_attestations.attested_document_hash.
    signed_document_hash TEXT,
    -- What the staff member typed when signing. The picker provides
    -- the default value; they can edit before submit (e.g., to add a
    -- middle initial). Stored as typed.
    typed_signature TEXT,
    ip_address TEXT,
    user_agent TEXT
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spps_lab ON staff_portal_policy_signatures(lab_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spps_doc ON staff_portal_policy_signatures(document_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spps_employee ON staff_portal_policy_signatures(staff_employee_id)`); } catch {}
try { sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_spps_doc_version_employee ON staff_portal_policy_signatures(document_id, version_id, staff_employee_id)`); } catch {}

// Migration sentinel for staff_portal_policy_signatures. Pure read of
// PRAGMA table_info — no cascading writes per the boot-migration rule.
{
  const sppsCols = (sqlite.prepare("PRAGMA table_info(staff_portal_policy_signatures)").all() as { name: string }[]).map((c) => c.name);
  void sppsCols;
}

// ─── Staff Portal competency sign-offs (Wave K8, 2026-06-08) ─────────────
//
// Mirror of staff_portal_policy_signatures but for competency assessments.
// Bridge column competency_employees.staff_employee_id (added PR D+ on
// 2026-06-05) is the connector — Wave K8 uses it to find the
// competency_employee for an active staff portal employee, then lists
// pending assessments and captures the staff member's acknowledgement
// signature.
//
// Surveyor-defensibility: typed name + assessment SHA-256 + IP + UA +
// timestamp at sign time. Same non-repudiation pattern as the policy
// signing flow. Re-sign after an evaluator amends an assessment is a
// new row; the (assessment_id, staff_employee_id) uniqueness keeps
// idempotency clean.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS staff_portal_competency_signoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    assessment_id INTEGER NOT NULL,
    staff_employee_id INTEGER NOT NULL,
    signed_at TEXT NOT NULL DEFAULT (datetime('now')),
    -- SHA-256 of a deterministic JSON of the assessment fields the
    -- staff member acknowledged (verdict, evaluator, date, etc.).
    signed_document_hash TEXT,
    typed_signature TEXT,
    ip_address TEXT,
    user_agent TEXT
  )
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spcs_lab ON staff_portal_competency_signoffs(lab_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spcs_assessment ON staff_portal_competency_signoffs(assessment_id)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_spcs_employee ON staff_portal_competency_signoffs(staff_employee_id)`); } catch {}
try { sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_spcs_assessment_employee ON staff_portal_competency_signoffs(assessment_id, staff_employee_id)`); } catch {}

// Migration sentinel for staff_portal_competency_signoffs. Pure read.
{
  const spcsCols = (sqlite.prepare("PRAGMA table_info(staff_portal_competency_signoffs)").all() as { name: string }[]).map((c) => c.name);
  void spcsCols;
}

// ─── Scheduling (Phase 1) ────────────────────────────────────────────────
// Self-hosted booking system for the consulting scoping call CTA on
// /services. Phase 1 covers the booking flow with manual rule + blackout
// management. Phase 2 adds Google Calendar OAuth so busy times subtract
// from availability and bookings push to the operator's calendar.
//
// Single calendar owner: the operator (Michael). Single timezone of
// record: America/Phoenix per CLAUDE.md §0. UI renders in the booker's
// browser tz; storage is operator-tz to avoid DST drift across rules.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS schedule_event_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedule_availability_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type_id INTEGER NOT NULL,
    -- 0 = Sunday, 6 = Saturday in operator local tz
    day_of_week INTEGER NOT NULL,
    -- "HH:MM" in 24h operator local tz
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedule_blackouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- One-off blocks. Date format: YYYY-MM-DD in operator tz.
    blackout_date TEXT NOT NULL,
    -- Optional time range. NULL start/end means the whole day is blocked.
    start_time TEXT,
    end_time TEXT,
    reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS schedule_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type_id INTEGER NOT NULL,
    -- Slot in operator tz
    slot_date TEXT NOT NULL,
    slot_start TEXT NOT NULL,
    slot_end TEXT NOT NULL,
    -- Booker tz captured for the confirmation email so the booker sees
    -- their own time, not operator tz
    booker_tz TEXT,
    booker_name TEXT NOT NULL,
    booker_email TEXT NOT NULL,
    booker_phone TEXT,
    lab_name TEXT,
    role TEXT,
    topic TEXT,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    confirmation_token TEXT NOT NULL UNIQUE,
    -- Phase 2 wires this to the Google Calendar event id. NULL until then.
    google_event_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    cancelled_at TEXT
  );
`);
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_avail_event ON schedule_availability_rules(event_type_id, day_of_week)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_blackouts_date ON schedule_blackouts(blackout_date)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_bookings_slot ON schedule_bookings(slot_date, slot_start)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_bookings_token ON schedule_bookings(confirmation_token)`); } catch {}
try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_schedule_bookings_email ON schedule_bookings(booker_email)`); } catch {}

// Seed the scoping-call event type if missing.
try {
  const existing = sqlite.prepare("SELECT id FROM schedule_event_types WHERE slug = ?").get("scoping-call") as any;
  if (!existing) {
    sqlite.prepare(`INSERT INTO schedule_event_types (slug, title, duration_minutes, description, active) VALUES (?, ?, ?, ?, 1)`).run(
      "scoping-call",
      "30-Minute Consulting Scoping Call",
      30,
      "No-cost, no-obligation 30-minute call to confirm whether the engagement fits, identify the right scope, and give a clear price before any paper changes hands."
    );
  }
} catch {}

// Migration sentinel block per CLAUDE.md NEW DB TABLE RULE.
{
  const eventCols = (sqlite.prepare("PRAGMA table_info(schedule_event_types)").all() as { name: string }[]).map((c) => c.name);
  void eventCols;
  const ruleCols = (sqlite.prepare("PRAGMA table_info(schedule_availability_rules)").all() as { name: string }[]).map((c) => c.name);
  void ruleCols;
  const blackoutCols = (sqlite.prepare("PRAGMA table_info(schedule_blackouts)").all() as { name: string }[]).map((c) => c.name);
  void blackoutCols;
  const bookingCols = (sqlite.prepare("PRAGMA table_info(schedule_bookings)").all() as { name: string }[]).map((c) => c.name);
  void bookingCols;
}

// Wave F PR F2 (2026-06-06). Controlled-vocabulary `title_code` column on
// staff_employees. Free-text `title` stays for display; `title_code`
// codifies the credential family so roster queries and audit views see
// stable identity. Backfill is keyword-driven and shaped by the shared
// inferStaffTitleCode() helper so client and server cannot drift.
//
// CMS-209 is unaffected: that personnel report renders from
// qualifications_text, not title.
//
// "Boot migrations: no cascading writes" rule respected — this UPDATE
// only reads/writes the title_code column it just created. It does not
// derive from a mutable downstream column.
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("title_code")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN title_code TEXT"); } catch {}
  }

  // Inline keyword backfill. Mirror of inferStaffTitleCode() — kept in SQL
  // for the one-shot boot pass so we do not have to load every row into
  // Node. Order matches the priority in shared/staffTitles.ts: specialists
  // before generalists, ASCP before AMT.
  const backfill = sqlite.prepare(`
    UPDATE staff_employees
    SET title_code = CASE
      WHEN LOWER(title) LIKE '%sbb(ascp)%' OR LOWER(title) LIKE '%sbb (ascp)%' OR LOWER(title) LIKE '%sbb ascp%' THEN 'SBB_ASCP'
      WHEN LOWER(title) LIKE '%sc(ascp)%'  OR LOWER(title) LIKE '%sc (ascp)%'  OR LOWER(title) LIKE '%sc ascp%'  THEN 'SC_ASCP'
      WHEN LOWER(title) LIKE '%sh(ascp)%'  OR LOWER(title) LIKE '%sh (ascp)%'  OR LOWER(title) LIKE '%sh ascp%'  THEN 'SH_ASCP'
      WHEN LOWER(title) LIKE '%sm(ascp)%'  OR LOWER(title) LIKE '%sm (ascp)%'  OR LOWER(title) LIKE '%sm ascp%'  THEN 'SM_ASCP'
      WHEN LOWER(title) LIKE '%mb(ascp)%'  OR LOWER(title) LIKE '%mb (ascp)%'  OR LOWER(title) LIKE '%mb ascp%'  THEN 'MB_ASCP'
      WHEN LOWER(title) LIKE '%htl(ascp)%' OR LOWER(title) LIKE '%htl (ascp)%' OR LOWER(title) LIKE '%htl ascp%' OR LOWER(title) LIKE '%histotechnologist%' THEN 'HTL_ASCP'
      WHEN LOWER(title) LIKE '%ht(ascp)%'  OR LOWER(title) LIKE '%ht (ascp)%'  OR LOWER(title) LIKE '%ht ascp%'  OR LOWER(title) LIKE '%histotechnician%' THEN 'HT_ASCP'
      WHEN LOWER(title) LIKE '%ct(ascp)%'  OR LOWER(title) LIKE '%ct (ascp)%'  OR LOWER(title) LIKE '%ct ascp%'  OR LOWER(title) LIKE '%cytotechnologist%' THEN 'CT_ASCP'
      WHEN LOWER(title) LIKE '%mls(ascp)%' OR LOWER(title) LIKE '%mls (ascp)%' OR LOWER(title) LIKE '%mls ascp%' OR LOWER(title) LIKE '%medical laboratory scientist%' THEN 'MLS_ASCP'
      WHEN LOWER(title) LIKE '%mlt(ascp)%' OR LOWER(title) LIKE '%mlt (ascp)%' OR LOWER(title) LIKE '%mlt ascp%' OR LOWER(title) LIKE '%medical laboratory technician%' THEN 'MLT_ASCP'
      WHEN LOWER(title) LIKE '%mt(ascp)%'  OR LOWER(title) LIKE '%mt (ascp)%'  OR LOWER(title) LIKE '%mt ascp%'  OR LOWER(title) LIKE '%medical technologist%' THEN 'MT_ASCP'
      WHEN LOWER(title) LIKE '%mt(amt)%'   OR LOWER(title) LIKE '%mt (amt)%'   OR LOWER(title) LIKE '%mt amt%'   THEN 'MT_AMT'
      WHEN LOWER(title) LIKE '%mlt(amt)%'  OR LOWER(title) LIKE '%mlt (amt)%'  OR LOWER(title) LIKE '%mlt amt%'  THEN 'MLT_AMT'
      WHEN LOWER(title) LIKE '%ph.d.%'  OR LOWER(title) LIKE '%phd%'         THEN 'PhD'
      WHEN LOWER(title) LIKE '%m.d.%'   OR title = 'MD' OR title LIKE 'MD %' OR title LIKE '% MD%' THEN 'MD'
      WHEN LOWER(title) LIKE '%d.o.%'   OR title = 'DO' OR title LIKE 'DO %' OR title LIKE '% DO%' THEN 'DO'
      WHEN LOWER(title) LIKE '%m.s.%'   OR LOWER(title) LIKE '%master of science%' THEN 'MS'
      WHEN LOWER(title) LIKE '%b.s.%'   OR LOWER(title) LIKE '%b.a.%' OR LOWER(title) LIKE '%bachelor%' THEN 'BS_BA'
      WHEN LOWER(title) LIKE '%a.s.%'   OR LOWER(title) LIKE '%associate%' THEN 'AS'
      WHEN LOWER(title) LIKE '%high school%' OR LOWER(title) LIKE '%ged%' THEN 'HS_GED'
      ELSE title_code
    END
    WHERE title_code IS NULL AND title IS NOT NULL AND TRIM(title) <> ''
  `).run();
  if (backfill.changes > 0) {
    console.log(`[migration] Wave F PR F2 staff_employees.title_code backfilled on ${backfill.changes} row(s)`);
  }
}

// Wave H PR H1 (2026-06-06). Soft-delete columns on staff_employees:
// terminated_at + termination_reason. Replaces hard-DELETE so that the
// employee row, their roles, their competency schedule, their assessment
// PDFs, and their linked credential URLs all survive past the day the
// lab director hits Terminate. CMS records retention (42 CFR §493.1105)
// requires personnel records to be retained for at least 2 years after
// the employee leaves the lab; TJC HR.01.07.01 mirrors. Hard delete
// loses the surveyor trail.
//
// "Boot migrations: no cascading writes" rule respected — this only
// adds columns; no UPDATE walks rows.
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("terminated_at")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN terminated_at TEXT"); } catch {}
  }
  if (!cols.includes("termination_reason")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN termination_reason TEXT"); } catch {}
  }
}

// Wave H PR H4 (2026-06-06). NEW DB TABLE RULE sentinel for
// staff_duty_change_events (CREATE above with the other staff_* tables).
// Captures one row per added instrument when an employee's assignment
// list grows. Resolved when a competency_assessment with
// assessment_type='duty_change' for the same employee_id lands with
// assessment_date >= detected_at. Lazy-evaluated on GET to avoid
// wiring a trigger on every assessment insert.
//
// Reg anchor: 42 CFR §493.1235(a) — competency assessment whenever an
// employee's testing duties change. TJC HR.01.06.01 mirrors.
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_duty_change_events)").all() as any[]).map(c => c.name);
  void cols;
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_staff_duty_change_events_lab_open ON staff_duty_change_events(lab_id, resolved_at)"); } catch {}
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_staff_duty_change_events_emp ON staff_duty_change_events(employee_id, resolved_at)"); } catch {}
}

// Wave H PR H3 (2026-06-06). NEW DB TABLE RULE sentinel for
// staff_position_descriptions (CREATE statement above with the other
// staff_* tables). One row per (lab_id, role). The UNIQUE constraint
// is encoded in the CREATE; this sentinel exists so the PRAGMA
// table_info path doesn't blow up on labs upgrading from before the
// columns were added (future-proof for columns we layer on later).
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_position_descriptions)").all() as any[]).map(c => c.name);
  void cols;
  try { sqlite.exec("CREATE INDEX IF NOT EXISTS idx_staff_position_descriptions_lab ON staff_position_descriptions(lab_id)"); } catch {}
}

// Wave H PR H2 (2026-06-06). Structured qualifications-verification
// metadata on staff_employees. Two columns, both nullable, both free-text.
// Surveyor's first question on a personnel file is "who verified this
// employee's qualifications, and when". The existing qualifications_text
// column is the narrative; these two are the verification act.
//
// License document metadata (URL, expiration, state) intentionally NOT
// added here. That belongs in staff_employee_documents (PR #558) so the
// lab can attach a real PDF / SharePoint link with its own
// expiration_date. Adding parallel license columns would create drift.
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("qualifications_verified_at")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN qualifications_verified_at TEXT"); } catch {}
  }
  if (!cols.includes("qualifications_verified_by")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN qualifications_verified_by TEXT"); } catch {}
  }
}

// 2026-06-08 — Staff Portal access toggles. Defaults: every employee can sign
// policies and competencies (no flag needed for those, universal). Toggles:
// can_adjust_inventory (default off) gates VeritaStock kiosk decrement /
// increment / set-qty actions; can_view_audit (default off) gates the audit
// trail / status grids. Only paid active writer seats can flip these.
// Per Michael 2026-06-08 locked design.
{
  const cols = (sqlite.prepare("PRAGMA table_info(staff_employees)").all() as any[]).map(c => c.name);
  if (!cols.includes("can_adjust_inventory")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN can_adjust_inventory INTEGER NOT NULL DEFAULT 0"); } catch {}
  }
  if (!cols.includes("can_view_audit")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN can_view_audit INTEGER NOT NULL DEFAULT 0"); } catch {}
  }
  // 2026-06-09 Auth unification: link a staff_employees row to the user
  // account the tech logs in with. Populated on Staff Portal invite
  // accept; null while invite is pending or never sent. UNIQUE so a
  // user account can't be claimed by two staff_employees rows.
  if (!cols.includes("user_id")) {
    try { sqlite.exec("ALTER TABLE staff_employees ADD COLUMN user_id INTEGER REFERENCES users(id)"); } catch {}
  }
}
try { sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_employees_user_id_unique ON staff_employees(user_id) WHERE user_id IS NOT NULL"); } catch {}

// 2026-06-09 Auth unification: link a Staff Portal seat invite to the
// specific VeritaStaff row it was created for. On accept, the new
// users.id is written to staff_employees.user_id (via the seat
// invite's staff_employee_id pointer here).
{
  const cols = (sqlite.prepare("PRAGMA table_info(user_seats)").all() as any[]).map((c: any) => c.name);
  if (!cols.includes("staff_employee_id")) {
    try { sqlite.exec("ALTER TABLE user_seats ADD COLUMN staff_employee_id INTEGER REFERENCES staff_employees(id)"); } catch {}
  }
}
