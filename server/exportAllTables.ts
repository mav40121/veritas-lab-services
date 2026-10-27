// server/exportAllTables.ts
//
// Which database rows belong to one lab, for "Download all of this lab's records" (server/exportAll.ts).
// EVERY table in the database is listed here, either with how its rows are scoped to a lab or with the
// reason it is left out. tests/integration/export-all.test.ts fails when a table exists that is not listed,
// so a new table cannot silently drop out of the export.
//
// Scopes:
//   lab         lab_id = the lab (labs.id)
//   labOrOwner  lab_id = the lab, plus rows saved before multi-lab support (lab_id NULL) under the owner's
//               account (ownerColumn = the owner's user id)
//   owner       ownerColumn = the owner's user id (account-level data with no lab_id)
//   staffLab    lab_id = the lab's VeritaStaff lab (staff_labs.id, NOT labs.id; resolved the same way
//               the app does, see staffLabByLabId in routes.ts)
//   child       column IN (ids of the parent table's rows for this lab)
//   sql         a hand-written WHERE clause (@labId, @ownerUserId, @staffLabId)
//   exclude     not exported, with the reason
// Checked against production (10/16): only staff_employees, staff_roles, staff_lab_specialties and
// staff_competency_schedules carry a staff_labs id in lab_id; every other lab_id is labs.id.

export type ExportScope =
  | { kind: "lab" }
  | { kind: "labOrOwner"; ownerColumn: string }
  | { kind: "owner"; ownerColumn: string }
  | { kind: "staffLab" }
  | { kind: "child"; column: string; parent: string }
  | { kind: "sql"; where: string; columns?: string[] }
  | { kind: "exclude"; reason: string };

export interface ExportTable {
  module: string;
  scope: ExportScope;
}

const lab = (module: string): ExportTable => ({ module, scope: { kind: "lab" } });
const labOrOwner = (module: string, ownerColumn = "user_id"): ExportTable => ({ module, scope: { kind: "labOrOwner", ownerColumn } });
const owner = (module: string, ownerColumn: string): ExportTable => ({ module, scope: { kind: "owner", ownerColumn } });
const staffLab = (module: string): ExportTable => ({ module, scope: { kind: "staffLab" } });
const child = (module: string, column: string, parent: string): ExportTable => ({ module, scope: { kind: "child", column, parent } });
const exclude = (reason: string): ExportTable => ({ module: "", scope: { kind: "exclude", reason } });

const SIGN_IN = "Sign-in secrets and sessions; never exported.";
const VLS_BUSINESS = "Veritas Lab Services business records, not the lab's records.";
const REFERENCE = "Reference data that is the same for every lab.";
const ORG = "Organization-level (system accounts); belongs to the organization, not one lab.";

export const EXPORT_TABLES: Record<string, ExportTable> = {
  // Lab and members
  labs: { module: "Lab and members", scope: { kind: "sql", where: "id = @labId" } },
  users: { module: "Lab and members", scope: { kind: "sql", where: "id IN (SELECT user_id FROM lab_members WHERE lab_id = @labId)", columns: ["id", "name", "email"] } },
  lab_members: lab("Lab and members"),
  user_seats: lab("Lab and members"),
  lab_onboarding_checks: lab("Lab and members"),
  lab_audit_log: lab("Audit trail"),
  audit_log: owner("Audit trail", "owner_user_id"),
  vls_support_activity: lab("Audit trail"),

  // VeritaCheck
  studies: labOrOwner("VeritaCheck"),
  study_signoff_groups: lab("VeritaCheck"),
  study_notes: lab("VeritaCheck"),
  veritacheck_outside_records: lab("VeritaCheck"), // studies performed outside VeritaCheck, recorded on Coverage (Q16)
  veritacheck_verifications: labOrOwner("VeritaCheck"),
  veritacheck_verification_analytes: child("VeritaCheck", "verification_id", "veritacheck_verifications"),
  veritacheck_verification_instruments: child("VeritaCheck", "verification_id", "veritacheck_verifications"),
  veritacheck_verification_studies: child("VeritaCheck", "verification_id", "veritacheck_verifications"),
  cumsum_trackers: labOrOwner("VeritaCheck"),
  cumsum_entries: child("VeritaCheck", "tracker_id", "cumsum_trackers"),

  // VeritaMap
  veritamap_maps: labOrOwner("VeritaMap"),
  veritamap_instruments: child("VeritaMap", "map_id", "veritamap_maps"),
  veritamap_tests: child("VeritaMap", "map_id", "veritamap_maps"),
  veritamap_instrument_tests: child("VeritaMap", "map_id", "veritamap_maps"),
  veritamap_analyte_values: child("VeritaMap", "map_id", "veritamap_maps"),
  veritamap_amr_values: child("VeritaMap", "map_id", "veritamap_maps"),
  veritamap_test_correlations: child("VeritaMap", "test_a_id", "veritamap_tests"),
  veritamap_instrument_requests: lab("VeritaMap"),

  // VeritaScan (and its document library)
  veritascan_scans: labOrOwner("VeritaScan"),
  veritascan_items: child("VeritaScan", "scan_id", "veritascan_scans"),
  veritascan_custom_items: lab("VeritaScan"),
  veritascan_custom_item_status: child("VeritaScan", "scan_id", "veritascan_scans"),
  lab_documents: lab("VeritaScan"),
  lab_document_cross_links: lab("VeritaScan"),
  lab_document_type_defaults: lab("VeritaScan"),
  document_checklist_links: child("VeritaScan", "document_id", "lab_documents"),

  // VeritaComp
  competency_programs: labOrOwner("VeritaComp"),
  competency_assessments: child("VeritaComp", "program_id", "competency_programs"),
  competency_assessment_items: child("VeritaComp", "assessment_id", "competency_assessments"),
  competency_checklist_items: child("VeritaComp", "program_id", "competency_programs"),
  competency_element_documents: child("VeritaComp", "assessment_id", "competency_assessments"),
  competency_method_groups: child("VeritaComp", "program_id", "competency_programs"),
  competency_quiz_results: child("VeritaComp", "assessment_id", "competency_assessments"),
  competency_employees: labOrOwner("VeritaComp"),
  competency_quizzes: labOrOwner("VeritaComp"),
  competency_quiz_assignments: lab("VeritaComp"),
  competency_reminder_config: lab("VeritaComp"),
  competency_reminder_log: lab("VeritaComp"),
  competency_method_signoffs: lab("VeritaComp"),
  competency_instrument_groups: lab("VeritaComp"),
  competency_instrument_group_members: lab("VeritaComp"),
  competency_group_dismissals: lab("VeritaComp"),
  director_delegations: lab("VeritaComp"),

  // VeritaStaff
  staff_labs: { module: "VeritaStaff", scope: { kind: "sql", where: "id = @staffLabId" } },
  staff_employees: staffLab("VeritaStaff"),
  staff_roles: staffLab("VeritaStaff"),
  staff_lab_specialties: staffLab("VeritaStaff"),
  staff_competency_schedules: staffLab("VeritaStaff"),
  staff_employee_documents: child("VeritaStaff", "employee_id", "staff_employees"),
  staff_employee_instruments: child("VeritaStaff", "employee_id", "staff_employees"),
  staff_duty_change_events: lab("VeritaStaff"),
  staff_position_descriptions: lab("VeritaStaff"),
  staff_portal_competency_signoffs: lab("VeritaStaff"),
  staff_portal_policy_signatures: lab("VeritaStaff"),
  staff_roster_prompt_hidden: lab("VeritaStaff"),
  veritaceu_requirement_profiles: lab("VeritaStaff"),

  // VeritaPolicy
  policy_manuals: lab("VeritaPolicy"),
  policy_documents: lab("VeritaPolicy"),
  policy_versions: child("VeritaPolicy", "document_id", "policy_documents"),
  policy_attestations: child("VeritaPolicy", "document_id", "policy_documents"),
  policy_signoffs: child("VeritaPolicy", "document_id", "policy_documents"),
  policy_review_reminders: child("VeritaPolicy", "document_id", "policy_documents"),
  policy_approval_workflows: lab("VeritaPolicy"),
  policy_approval_steps: child("VeritaPolicy", "workflow_id", "policy_approval_workflows"),
  policy_approval_delegations: lab("VeritaPolicy"),
  policy_audit_log: lab("VeritaPolicy"),
  policy_document_links: lab("VeritaPolicy"),
  policy_document_notes: lab("VeritaPolicy"),
  policy_email_templates: lab("VeritaPolicy"),
  policy_manual_approvers: lab("VeritaPolicy"),
  policy_quiz_questions: lab("VeritaPolicy"),
  policy_surveyor_links: lab("VeritaPolicy"),
  veritapolicy_lab_policies: labOrOwner("VeritaPolicy"),
  veritapolicy_master_status: labOrOwner("VeritaPolicy"),
  veritapolicy_requirement_status: labOrOwner("VeritaPolicy"),
  veritapolicy_settings: labOrOwner("VeritaPolicy"),
  veritapolicy_custom_entries: lab("VeritaPolicy"),
  veritapolicy_house_numbers: lab("VeritaPolicy"),
  veritapolicy_lab_artifacts: lab("VeritaPolicy"),

  // VeritaQC (and IQCP)
  qc_control_lots: lab("VeritaQC"),
  qc_results: lab("VeritaQC"),
  qc_result_notes: lab("VeritaQC"),
  qc_rule_violations: child("VeritaQC", "qc_result_id", "qc_results"),
  qc_corrective_actions: lab("VeritaQC"),
  qc_period_reviews: lab("VeritaQC"),
  qc_rule_settings: lab("VeritaQC"),
  veritaqc_import_mappings: lab("VeritaQC"),
  iqcp_plans: lab("VeritaQC"),
  iqcp_qa_items: child("VeritaQC", "plan_id", "iqcp_plans"),
  iqcp_qcp_items: child("VeritaQC", "plan_id", "iqcp_plans"),
  iqcp_risk_items: child("VeritaQC", "plan_id", "iqcp_plans"),

  // VeritaPT
  pt_enrollments: labOrOwner("VeritaPT"),
  pt_enrollments_v2: labOrOwner("VeritaPT"),
  pt_events: labOrOwner("VeritaPT"),
  pt_corrective_actions: labOrOwner("VeritaPT"),
  pt_reminder_config: lab("VeritaPT"),
  pt_reminder_log: lab("VeritaPT"),
  aa_records: labOrOwner("VeritaPT"),

  // VeritaLab
  lab_certificates: labOrOwner("VeritaLab"),
  lab_certificate_documents: child("VeritaLab", "certificate_id", "lab_certificates"),
  lab_certificate_reminders: child("VeritaLab", "certificate_id", "lab_certificates"),
  cms116_drafts: lab("VeritaLab"),
  lab_director_history: lab("VeritaLab"),
  lab_site_contacts: lab("VeritaLab"),
  lab_test_menu_changes: lab("VeritaLab"),
  clia_fee_payments: lab("VeritaLab"),

  // VeritaTrack
  veritatrack_tasks: labOrOwner("VeritaTrack"),
  veritatrack_signoffs: lab("VeritaTrack"),
  veritatrack_audit: lab("VeritaTrack"),
  veritatrack_reminder_config: lab("VeritaTrack"),
  veritatrack_reminder_log: lab("VeritaTrack"),
  veritatrack_categories: lab("VeritaTrack"), // #110: the lab's own task categories

  // VeritaResponse
  findings: labOrOwner("VeritaResponse"),
  finding_attachments: child("VeritaResponse", "finding_id", "findings"),
  finding_extension_requests: child("VeritaResponse", "finding_id", "findings"),
  finding_history: child("VeritaResponse", "finding_id", "findings"),
  finding_reminder_log: child("VeritaResponse", "finding_id", "findings"),
  finding_effectiveness_checks: lab("VeritaResponse"),

  // VeritaMaintain (equipment and temperature logs)
  lab_equipment: lab("VeritaMaintain"),
  equipment_maintenance_events: lab("VeritaMaintain"),
  equipment_reminder_config: lab("VeritaMaintain"),
  equipment_reminder_log: lab("VeritaMaintain"),
  temp_log_units: lab("VeritaMaintain"),
  temp_log_readings: lab("VeritaMaintain"),

  // VeritaStock
  inventory_items: labOrOwner("VeritaStock", "account_id"),
  inventory_lots: labOrOwner("VeritaStock", "account_id"),
  inventory_consumption_events: labOrOwner("VeritaStock", "account_id"),
  inventory_count_events: labOrOwner("VeritaStock", "account_id"),
  inventory_receipts: labOrOwner("VeritaStock", "account_id"),
  inventory_waste_events: lab("VeritaStock"),
  inventory_monthly_snapshots: lab("VeritaStock"),
  inventory_lot_use: lab("VeritaStock"),
  inventory_transfers: { module: "VeritaStock", scope: { kind: "sql", where: "from_lab_id = @labId OR to_lab_id = @labId" } },
  scan_events: child("VeritaStock", "inventory_item_id", "inventory_items"),
  stock_vendors: lab("VeritaStock"),
  stock_vendor_contacts: lab("VeritaStock"),
  stock_recalls: lab("VeritaStock"),
  stock_recall_documents: lab("VeritaStock"),
  stock_recall_events: lab("VeritaStock"),
  stock_recall_recipients: lab("VeritaStock"),
  intacct_export_config: lab("VeritaStock"),

  // VeritaBench, VeritaOps, VeritaQA, VeritaShift
  productivity_months: labOrOwner("VeritaBench", "account_id"),
  productivity_forecasts: labOrOwner("VeritaBench", "account_id"),
  staffing_studies: labOrOwner("VeritaBench", "account_id"),
  staffing_hourly_data: child("VeritaBench", "study_id", "staffing_studies"),
  staffing_grid_lines: labOrOwner("VeritaBench", "account_id"),
  veritaops_test_cost_studies: labOrOwner("VeritaOps", "account_id"),
  pi_departments: owner("VeritaQA", "account_id"),
  pi_metrics: owner("VeritaQA", "account_id"),
  pi_entries: owner("VeritaQA", "account_id"),
  pi_plan: owner("VeritaQA", "account_id"),
  pi_plan_priority: owner("VeritaQA", "account_id"),
  pi_plan_review: owner("VeritaQA", "account_id"),
  schedule_settings: lab("VeritaShift"),
  schedule_shift_defs: lab("VeritaShift"),
  schedule_shift_dept_requirements: lab("VeritaShift"),
  schedule_periods: lab("VeritaShift"),
  schedule_assignments: lab("VeritaShift"),

  // Left out
  user_sessions: exclude(SIGN_IN),
  pdf_tokens: exclude(SIGN_IN),
  reset_tokens: exclude(SIGN_IN),
  mfa_email_codes: exclude(SIGN_IN),
  mfa_trusted_devices: exclude(SIGN_IN),
  user_mfa: exclude(SIGN_IN),
  user_mfa_recovery_codes: exclude(SIGN_IN),
  sso_handoffs: exclude(SIGN_IN),
  sso_login_states: exclude(SIGN_IN),
  password_history: exclude(SIGN_IN),
  record_views: lab("Access log"),
  sso_configs: exclude(ORG),
  system_security_settings: exclude(ORG),
  organizations: exclude(ORG),
  organization_members: exclude(ORG),
  organization_billing_line_items: exclude(ORG),
  system_documents: exclude(ORG),
  contact_messages: exclude(VLS_BUSINESS),
  discount_codes: exclude(VLS_BUSINESS),
  founding_lab_applications: exclude(VLS_BUSINESS),
  invoice_requests: exclude(VLS_BUSINESS),
  newsletter_subscribers: exclude(VLS_BUSINESS),
  schedule_event_types: exclude("Veritas Lab Services demo-booking calendar, not the lab's records."),
  schedule_availability_rules: exclude("Veritas Lab Services demo-booking calendar, not the lab's records."),
  schedule_blackouts: exclude("Veritas Lab Services demo-booking calendar, not the lab's records."),
  schedule_bookings: exclude("Veritas Lab Services demo-booking calendar, not the lab's records."),
  backup_integrity_log: exclude("Veritas system monitoring."),
  csp_reports: exclude("Veritas system monitoring."),
  phi_scan_log: exclude("Veritas system monitoring (counts only)."),
  continuous_backup_probe: exclude("Veritas system monitoring (backup restore probes)."),
  continuous_backup_checks: exclude("Veritas system monitoring (backup watchdog results)."),
  nightly_snapshots: exclude("Daily counts Veritas derives from the records; the records themselves are exported."),
  pt_vendor_programs: exclude(REFERENCE),
  state_lab_licensure_registry: exclude(REFERENCE),
};

// Temporary tables a migration creates and renames in the same boot (never present afterwards).
export const TRANSIENT_TABLE = /(_new|_rebuild)$/;

// Never written to the export, whatever the table: sign-in secrets, invite links, and billing-processor ids.
export const DROPPED_COLUMN = /(password|secret|(^|_)token($|_)|totp|recovery|code_hash|token_hash|_enc$|^stripe_|code_verifier|nonce)/i;
