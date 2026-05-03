#!/usr/bin/env python3
"""generate_seed_all_modules_sql.py

Generates a SQL artifact that fills in the remaining demo modules for
Michael Veri (user_id=17, account_id=17, lab_id=3) BEYOND what
seed-michaels-lab.sql and expand-michaels-lab v3 already covered.

Targets:
  - PI entries: 12 months of values for all 14 metrics  (~168 entries)
  - Productivity months: 12 months
  - Cumsum entries: 12 weekly entries on the existing tracker
  - VeritaTrack signoffs: 1 most-recent + 1 prior signoff per task (~58)
  - Competency method groups: 3 (one per program)
  - Competency assessments: 2 per employee per applicable program (~20)
  - Staff competency schedules: 1 per staff_employees row (5)
  - VeritaScan: create scan #N for user 17, populate ALL 168 items, assess ~50

Output: scripts/seed/michaels_seed_all_modules_2026_05_03.sql
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import random
import sys
from typing import List

SEED_TAG = "[SEED-2026-05-03-MODULES]"
USER_ID = 17
ACCOUNT_ID = 17
LAB_ID = 3
NOW_ISO = dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
TODAY = dt.date.today()

random.seed(20260503)


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return str(v)
    s = str(v).replace("'", "''")
    return f"'{s}'"


def days_ago(n: int) -> str:
    return (TODAY - dt.timedelta(days=n)).isoformat()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--scan-data", required=True,
                   help="Path to client/src/lib/veritaScanData.ts")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    out: List[str] = []
    out.append(f"-- {os.path.basename(args.out)}")
    out.append(f"-- Seed tag: {SEED_TAG}")
    out.append("")
    out.append("BEGIN;")
    out.append("")

    # ----------------------------------------------------------------------
    # 0. Remove obsolete cumsum data for Michael (cumsum is a VeritaCheck
    #    sub-module; it does not belong in the demo lab dataset).
    # ----------------------------------------------------------------------
    out.append("-- Remove orphan cumsum data --")
    out.append(f"DELETE FROM cumsum_entries WHERE tracker_id IN (SELECT id FROM cumsum_trackers WHERE user_id={USER_ID});")
    out.append(f"DELETE FROM cumsum_trackers WHERE user_id={USER_ID};")
    out.append("")

    # ----------------------------------------------------------------------
    # 1. PI entries: 12 months, all 14 metrics
    # ----------------------------------------------------------------------
    out.append("-- PI entries (12 months x 14 metrics, realistic trends) --")
    # Each metric: (start_value_12mo_ago, end_value_now, direction, monthly_volume_baseline, unit)
    # Direction:
    #   'lower_is_better' -> end <= start (improvement is downward)
    #   'higher_is_better' -> end >= start (improvement is upward)
    # Trends are mostly monotonic with small monthly noise so the
    # trend-line tells a coherent improvement story while still
    # looking like real human data.
    metric_trends = {
        # Blood bank
        "Wasted Product Rate":               (3.8, 1.4, "lower",  900,  0.25),
        "Transfusion Reaction Rate":         (0.9, 0.3, "lower",  450,  0.10),
        "Crossmatch-to-Transfusion Ratio":   (2.5, 1.7, "lower",  900,  0.10),
        # Microbiology / infection control
        "C. difficile Rate":                 (4.8, 2.1, "lower",  1800, 0.40),
        "MRSA Rate":                         (2.7, 1.0, "lower",  1800, 0.25),
        "Blood Culture Contamination Rate":  (3.0, 1.4, "lower",  1500, 0.20),
        "Urine Contamination Rate":          (4.2, 2.1, "lower",  3200, 0.30),
        # TAT (minutes; trending down = improvement)
        "Avg TAT - Received to Verified":    (78, 48, "lower",  4800, 3.5),
        "Avg TAT - Ordered to Collected":    (26, 16, "lower",  4800, 1.5),
        "Avg TAT - Collected to Received":   (40, 24, "lower",  4800, 2.0),
        "Avg TAT - Received to Resulted":    (55, 32, "lower",  4800, 2.5),
        "Avg TAT - Resulted to Verified":    (18, 9,  "lower",  4800, 1.0),
        "Avg TAT - Ordered to Verified":     (140, 88, "lower", 4800, 5.0),
        # Higher-is-better
        "Critical Value Notification Rate":  (93.5, 98.6, "higher", 380, 0.7),
    }
    today = TODAY
    # Generate the 12 (year, month) tuples in chronological order (oldest first).
    months_seq = []
    for months_ago in range(12, 0, -1):
        anchor = today.replace(day=1)
        # Move back months_ago months from anchor.
        m = anchor.month - months_ago
        y = anchor.year
        while m <= 0:
            m += 12
            y -= 1
        months_seq.append((y, m))
    n = len(months_seq)
    for metric_name, (start, end, _dir, vol_base, noise_amp) in metric_trends.items():
        for i, (y, m) in enumerate(months_seq):
            # Linear interpolation start -> end across 12 months
            base = start + (end - start) * (i / (n - 1))
            # Symmetric noise that doesn't dominate the trend
            jitter = random.uniform(-noise_amp, noise_amp)
            raw = base + jitter
            # Don't let TAT/% go negative
            raw = max(0.0, raw)
            # Round sensibly
            value = round(raw, 1) if raw >= 10 else round(raw, 2)
            # Volume grows mildly through the year (8% over 12 months)
            volume = int(vol_base * (1.0 + 0.08 * (i / (n - 1))) * random.uniform(0.93, 1.07))
            out.append(
                "INSERT OR REPLACE INTO pi_entries "
                "(metric_id, account_id, year, month, value, volume, notes, created_at, updated_at) VALUES ("
                f"(SELECT id FROM pi_metrics WHERE account_id={ACCOUNT_ID} AND name={lit(metric_name)} LIMIT 1), "
                f"{ACCOUNT_ID}, {y}, {m}, {value}, {volume}, {lit(SEED_TAG)}, {lit(NOW_ISO)}, {lit(NOW_ISO)});"
            )
    out.append("")

    # ----------------------------------------------------------------------
    # 2. Productivity months
    # ----------------------------------------------------------------------
    out.append("-- Productivity months (12 months, coherent growth curve) --")
    # Test volume grows from ~32K -> ~44K over the year. Productive
    # hours track volume with a flattening efficiency curve (lab
    # gets more efficient over time => productive hours grow slower
    # than volume). Overtime declines as efficiency improves.
    for i, (y, m) in enumerate(months_seq):
        progress = i / (n - 1)  # 0.0 -> 1.0
        billable = int(32000 + 12000 * progress + random.uniform(-1200, 1200))
        productive = round(1180 + 180 * progress + random.uniform(-25, 25), 1)
        nonprod = round(180 - 60 * progress + random.uniform(-12, 12), 1)
        ot = round(85 - 50 * progress + random.uniform(-6, 6), 1)
        ftes = round(7.4 + 1.6 * progress + random.uniform(-0.15, 0.15), 2)
        out.append(
            "INSERT OR REPLACE INTO productivity_months "
            "(account_id, year, month, billable_tests, productive_hours, non_productive_hours, "
            "overtime_hours, total_ftes, facility_type, notes, created_at, updated_at) VALUES ("
            f"{ACCOUNT_ID}, {y}, {m}, {billable}, {productive}, {nonprod}, {ot}, {ftes}, "
            f"'community', {lit(SEED_TAG)}, {lit(NOW_ISO)}, {lit(NOW_ISO)});"
        )
    out.append("")

    # ----------------------------------------------------------------------
    # 2b. VeritaTrack common lab tasks (idempotent by name)
    # ----------------------------------------------------------------------
    # Categories pulled from the in-app seed-defaults endpoint plus a few extras
    # that surveyors look for. Inserted only when (user_id, name) not already
    # present so this is safe to re-run on top of analyte-level tasks already
    # seeded by expand-michaels-lab.
    # ----------------------------------------------------------------------
    # 2a. Repair staff lab_id mismatch
    # ----------------------------------------------------------------------
    # The original seed_michaels_lab.py hard-coded lab_id=3, but in production
    # Michael's staff_labs row was assigned id=5. That stranded his employees,
    # roles, and competency schedules on a foreign lab. Re-anchor to the real
    # lab id (looked up dynamically so this is safe to rerun).
    out.append("-- Repair staff lab_id mismatch for Michael (lab_id was 3, real id is whatever staff_labs.id resolves to for user 17) --")
    out.append(f"""
UPDATE staff_employees
SET lab_id = (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1),
    updated_at = {lit(NOW_ISO)}
WHERE user_id = {USER_ID}
  AND lab_id != (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1);
""".strip())
    out.append(f"""
UPDATE staff_competency_schedules
SET lab_id = (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1)
WHERE employee_id IN (SELECT id FROM staff_employees WHERE user_id = {USER_ID})
  AND lab_id != (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1);
""".strip())
    out.append(f"""
UPDATE staff_roles
SET lab_id = (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1)
WHERE employee_id IN (SELECT id FROM staff_employees WHERE user_id = {USER_ID})
  AND lab_id != (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1);
""".strip())
    out.append(f"""
UPDATE users
SET lab_id = (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1)
WHERE id IN ({USER_ID}, 19, 22)
  AND lab_id != (SELECT id FROM staff_labs WHERE user_id = {USER_ID} ORDER BY id LIMIT 1);
""".strip())
    out.append("")

    out.append("-- VeritaTrack common lab tasks (idempotent by name) --")
    common_tasks = [
        # QC Review (Monthly)
        ("QC Review - Chemistry",        "QC Review",         "Monthly",   1),
        ("QC Review - Hematology",       "QC Review",         "Monthly",   1),
        ("QC Review - Coagulation",      "QC Review",         "Monthly",   1),
        ("QC Review - Urinalysis",       "QC Review",         "Monthly",   1),
        ("QC Review - Blood Bank",       "QC Review",         "Monthly",   1),
        ("QC Review - Microbiology",     "QC Review",         "Monthly",   1),
        # Proficiency Testing review (Quarterly)
        ("Proficiency Testing Review - Chemistry",     "Quality Assessment", "Quarterly", 3),
        ("Proficiency Testing Review - Hematology",    "Quality Assessment", "Quarterly", 3),
        ("Proficiency Testing Review - Coagulation",   "Quality Assessment", "Quarterly", 3),
        ("Proficiency Testing Review - Microbiology",  "Quality Assessment", "Quarterly", 3),
        ("Proficiency Testing Review - Blood Bank",    "Quality Assessment", "Quarterly", 3),
        # Annual training
        ("HIPAA Training - Annual Review",                "HIPAA",               "Annual", 12),
        ("Bloodborne Pathogen Training - Annual",         "Bloodborne Pathogen", "Annual", 12),
        ("Chemical Hygiene / Hazard Communication Training", "Safety",          "Annual", 12),
        ("Fire and Emergency Preparedness Training",      "Safety",              "Annual", 12),
        ("Competency Assessment - Annual (all staff)",    "Competency",          "Annual", 12),
        # Equipment calibration / verification
        ("Pipette Calibration",                  "Equipment Calibration", "Annual",   12),
        ("Thermometer Calibration",              "Equipment Calibration", "Annual",   12),
        ("Centrifuge RPM Verification",          "Equipment Calibration", "Annual",   12),
        ("Timer Verification",                   "Equipment Calibration", "Annual",   12),
        ("Eyewash Station Inspection",           "Safety",                "Weekly",   1),
        # Blood Bank alarm checks (Quarterly)
        ("Blood Bank Alarm Check - Refrigerator",       "Blood Bank Alarm Checks", "Quarterly", 3),
        ("Blood Bank Alarm Check - Freezer",            "Blood Bank Alarm Checks", "Quarterly", 3),
        ("Blood Bank Alarm Check - Platelet Incubator", "Blood Bank Alarm Checks", "Quarterly", 3),
        # Water testing
        ("Water Contamination Testing",          "Water Contamination",   "Monthly", 1),
        # Daily lab checks
        ("Refrigerator/Freezer Temperature Log Review", "Daily Checks",   "Monthly", 1),
        ("Critical Value Read-Back Audit",       "Quality Assessment",     "Monthly", 1),
        ("Levey-Jennings Chart Review",          "QC Review",              "Monthly", 1),
        # Document control / SOP review
        ("SOP Biennial Review - Chemistry",      "Policy Review",          "Biennial", 24),
        ("SOP Biennial Review - Hematology",     "Policy Review",          "Biennial", 24),
        ("SOP Biennial Review - Blood Bank",     "Policy Review",          "Biennial", 24),
        # Inventory / vendor
        ("Reagent Inventory Reconciliation",     "Inventory",              "Monthly", 1),
        ("Vendor Performance Review",            "Vendor Management",      "Quarterly", 3),
    ]
    for name, cat, freq, months in common_tasks:
        out.append(
            f"INSERT INTO veritatrack_tasks (user_id, name, category, frequency, frequency_months, active, created_at, updated_at) "
            f"SELECT {USER_ID}, {lit(name)}, {lit(cat)}, {lit(freq)}, {months}, 1, {lit(NOW_ISO)}, {lit(NOW_ISO)} "
            f"WHERE NOT EXISTS (SELECT 1 FROM veritatrack_tasks WHERE user_id={USER_ID} AND name={lit(name)});"
        )
    out.append("")

    # ----------------------------------------------------------------------
    # 3. VeritaTrack signoffs - one recent + one prior per task
    # ----------------------------------------------------------------------
    out.append("-- VeritaTrack signoffs (~58+: 2 per task, including new common tasks) --")
    out.append(f"DELETE FROM veritatrack_signoffs WHERE user_id={USER_ID};")
    # We can't enumerate task ids in SQL, so we use a SELECT inside INSERT...SELECT
    # For each task, insert two signoffs at predictable offsets.
    out.append(f"""
INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, initials, performed_by, notes, created_at)
SELECT
  t.id, {USER_ID},
  date('now', '-' || (40 + (t.id % 50)) || ' days'),
  'MV', 'Michael Veri', '{SEED_TAG} most recent', {lit(NOW_ISO)}
FROM veritatrack_tasks t WHERE t.user_id = {USER_ID};
""".strip())
    out.append(f"""
INSERT INTO veritatrack_signoffs (task_id, user_id, completed_date, initials, performed_by, notes, created_at)
SELECT
  t.id, {USER_ID},
  date('now', '-' || (220 + (t.id % 60)) || ' days'),
  'MV', 'Michael Veri', '{SEED_TAG} prior', {lit(NOW_ISO)}
FROM veritatrack_tasks t WHERE t.user_id = {USER_ID};
""".strip())
    out.append("")

    # ----------------------------------------------------------------------
    # 5. Competency method groups (one per program)
    # ----------------------------------------------------------------------
    out.append("-- Competency method groups (one per program) --")
    out.append(f"""
DELETE FROM competency_method_groups WHERE program_id IN (SELECT id FROM competency_programs WHERE user_id={USER_ID});
""".strip())
    method_groups = [
        ("Chemistry Technical Competency 2026", "Dimension EXL Pri/Backup",
         json.dumps(["Bert", "Ernie"]),
         json.dumps(["Sodium", "Potassium", "Glucose", "Creatinine", "AST", "ALT"])),
        ("Hematology Technical Competency 2026", "XN-2000 Pri/Backup + Manual Diff",
         json.dumps(["Fred", "Wilma", "Manual Differential"]),
         json.dumps(["WBC", "Hgb", "Hct", "Plt", "Manual Diff"])),
        ("Lab-Wide Non-Technical Orientation 2026", "All instruments",
         json.dumps(["All"]),
         json.dumps(["N/A"])),
    ]
    for prog_name, mg_name, instr_json, analyte_json in method_groups:
        out.append(
            "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES ("
            f"(SELECT id FROM competency_programs WHERE user_id={USER_ID} AND name={lit(prog_name)} LIMIT 1), "
            f"{lit(mg_name)}, {lit(instr_json)}, {lit(analyte_json)}, {lit(SEED_TAG)});"
        )
    out.append("")

    # ----------------------------------------------------------------------
    # 6. Competency assessments (2 per employee for chem + hem programs)
    # ----------------------------------------------------------------------
    out.append("-- Competency assessments (technical x 5 employees x 2 programs = 10) --")
    out.append(f"""
DELETE FROM competency_assessments WHERE employee_id IN (SELECT id FROM competency_employees WHERE user_id={USER_ID});
""".strip())
    # For each employee, insert 1 initial assessment + 1 6-month/annual assessment
    # for both chemistry and hematology technical programs.
    employee_names = ["Michael Veri", "Lisa Veri", "Jennifer Martinez", "Robert Chen", "Sarah Williams"]
    tech_programs = ["Chemistry Technical Competency 2026", "Hematology Technical Competency 2026"]
    nontech_program = "Lab-Wide Non-Technical Orientation 2026"
    evaluators = [("Michael Veri", "Lab Director", "MV")] * 5
    for emp_idx, emp_name in enumerate(employee_names):
        for prog_idx, prog_name in enumerate(tech_programs):
            init_date = days_ago(360 + emp_idx * 5)
            recent_date = days_ago(60 + emp_idx * 7 + prog_idx * 3)
            ev_name, ev_title, ev_init = evaluators[emp_idx]
            for assess_type, assess_date, c_type, status in [
                ("initial", init_date, "technical", "pass"),
                ("annual", recent_date, "technical", "pass"),
            ]:
                out.append(
                    "INSERT INTO competency_assessments "
                    "(program_id, employee_id, assessment_type, assessment_date, evaluator_name, "
                    "evaluator_title, evaluator_initials, competency_type, status, "
                    "remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at) VALUES ("
                    f"(SELECT id FROM competency_programs WHERE user_id={USER_ID} AND name={lit(prog_name)} LIMIT 1), "
                    f"(SELECT id FROM competency_employees WHERE user_id={USER_ID} AND name={lit(emp_name)} LIMIT 1), "
                    f"{lit(assess_type)}, {lit(assess_date)}, {lit(ev_name)}, {lit(ev_title)}, {lit(ev_init)}, "
                    f"{lit(c_type)}, {lit(status)}, NULL, 1, 1, {lit(NOW_ISO)});"
                )
        # Plus one non-technical orientation assessment per employee
        out.append(
            "INSERT INTO competency_assessments "
            "(program_id, employee_id, assessment_type, assessment_date, evaluator_name, "
            "evaluator_title, evaluator_initials, competency_type, status, "
            "remediation_plan, employee_acknowledged, supervisor_acknowledged, created_at) VALUES ("
            f"(SELECT id FROM competency_programs WHERE user_id={USER_ID} AND name={lit(nontech_program)} LIMIT 1), "
            f"(SELECT id FROM competency_employees WHERE user_id={USER_ID} AND name={lit(emp_name)} LIMIT 1), "
            f"'initial', {lit(days_ago(330 + emp_idx * 5))}, 'Michael Veri', 'Lab Director', 'MV', "
            f"'non-technical', 'pass', NULL, 1, 1, {lit(NOW_ISO)});"
        )
    out.append("")

    # ----------------------------------------------------------------------
    # 7. Staff competency schedules (1 per staff_employees row)
    # ----------------------------------------------------------------------
    out.append("-- Staff competency schedules --")
    out.append(f"""
DELETE FROM staff_competency_schedules WHERE employee_id IN (SELECT id FROM staff_employees WHERE user_id={USER_ID});
""".strip())
    # Insert via INSERT...SELECT keyed on staff_employees rows
    out.append(f"""
INSERT INTO staff_competency_schedules (
  employee_id, lab_id,
  initial_completed_at, initial_signed_by,
  six_month_due_at, six_month_completed_at, six_month_signed_by,
  first_annual_due_at, first_annual_completed_at, first_annual_signed_by,
  annual_due_at, last_annual_completed_at, last_annual_signed_by,
  notes
)
SELECT
  e.id,
  e.lab_id,
  date(e.hire_date, '+30 days'),
  'Michael Veri',
  date(e.hire_date, '+6 months'),
  date(e.hire_date, '+6 months', '+5 days'),
  'Michael Veri',
  date(e.hire_date, '+12 months'),
  date(e.hire_date, '+12 months', '+5 days'),
  'Michael Veri',
  date('now', '+90 days'),
  date('now', '-275 days'),
  'Michael Veri',
  '{SEED_TAG}'
FROM staff_employees e WHERE e.user_id = {USER_ID};
""".strip())
    out.append("")

    # ----------------------------------------------------------------------
    # 8. VeritaScan: create scan + populate ALL 168 items + assess ~50
    # ----------------------------------------------------------------------
    # Parse the SCAN_ITEMS array from veritaScanData.ts
    out.append("-- VeritaScan: create scan + populate 168 items + assess ~50 --")
    with open(args.scan_data, "r") as f:
        ts = f.read()
    # Crude parse: find each item id N
    import re
    item_ids = sorted(set(int(m) for m in re.findall(r"\{\s*id:\s*(\d+),", ts)))
    if not item_ids:
        raise SystemExit("Could not parse SCAN_ITEMS from " + args.scan_data)
    # Drop any existing scan+items for user 17 with the seed tag (idempotent).
    out.append(f"DELETE FROM veritascan_items WHERE scan_id IN (SELECT id FROM veritascan_scans WHERE user_id={USER_ID} AND name LIKE '%[SEED-2026-05-03-MODULES]%');")
    out.append(f"DELETE FROM veritascan_scans WHERE user_id={USER_ID} AND name LIKE '%[SEED-2026-05-03-MODULES]%';")
    out.append("")
    out.append(
        "INSERT INTO veritascan_scans (user_id, name, created_at, updated_at) VALUES ("
        f"{USER_ID}, 'Q2 2026 Pre-COLA Scan {SEED_TAG}', {lit(NOW_ISO)}, {lit(NOW_ISO)});"
    )

    # ------------------------------------------------------------------
    # Parse domain for each item from veritaScanData.ts so notes can
    # reference the correct sibling-module record (policy, PT enrollment,
    # VeritaMap map, VeritaTrack task, competency program, etc.).
    # ------------------------------------------------------------------
    item_domain = {}
    for m in re.finditer(r"\{\s*id:\s*(\d+),\s*domain:\s*\"([^\"]+)\"", ts):
        item_domain[int(m.group(1))] = m.group(2)

    # Per-domain wiring: which seeded VeritaPolicy policy + which
    # sibling module/record each domain points at. These reference
    # real seeded rows (POL-001..POL-012, the 8 VeritaMap maps,
    # the seeded competency programs, PT enrollments, etc.).
    DOMAIN_POLICY = {
        "Quality Systems & QC":          ("POL-003", "Quality Control Plan (IQCP)"),
        "Calibration & Verification":    ("POL-005", "Method Validation and Verification"),
        "Proficiency Testing":           ("POL-006", "Proficiency Testing Program"),
        "Personnel & Competency":        ("POL-004", "Staff Competency Assessment Policy"),
        "Test Management & Procedures": ("POL-001", "Specimen Collection and Handling SOP"),
        "Equipment & Maintenance":       ("POL-010", "Reagent and Calibrator Management"),
        "Safety & Environment":          ("POL-008", "Safety and Infection Control Plan"),
        "Blood Bank & Transfusion":      ("POL-002", "Critical Value Reporting Policy"),
        "Point of Care Testing":         ("POL-012", "Waived Testing Quality Plan"),
        "Leadership & Governance":       ("POL-007", "Record Retention and Documentation"),
    }

    # Per-domain templates referencing sibling modules. Each list has
    # several variants so notes don't repeat. Templates use only data
    # the demo actually has seeded.
    # Tone: Compliant = brief evidence pointer; Needs Attention = gap
    # + corrective action path; Immediate Action = blocking finding +
    # owner + escalation path.
    DOMAIN_REFS = {
        "Quality Systems & QC": {
            "Compliant": [
                "Verified against {pol_num} ({pol_name}). QC review records in VeritaCheck \u2192 Hematology and Chemistry; Levey-Jennings charts current.",
                "Confirmed via {pol_num}. Monthly QC sign-off captured in VeritaTrack \u2192 'QC Monthly Review' task; PI metric 'QC Failures' trending green.",
                "Reviewed {pol_num} \u00a74. End-of-month QC reviewed by Michael Veri; evidence attached in VeritaCheck study log.",
            ],
            "Needs Attention": [
                "Levey-Jennings review behind schedule; {pol_num} \u00a74.2 calls for weekly review. Open VeritaTrack task 'Hematology QC Review' to clear backlog.",
                "Westgard rule application inconsistent on Chemistry. Cross-check VeritaCheck \u2192 Chemistry study and update {pol_num} \u00a76 with current rule set.",
                "Critical-value read-back log incomplete for 3 of last 30 events. Reinforce {pol_num} (Critical Value Reporting) and update VeritaTrack 'Critical Value Audit' task.",
            ],
            "Immediate Action": [
                "Director sign-off on {pol_num} ({pol_name}) overdue >18 months. Open VeritaPolicy \u2192 {pol_num} and route for attestation before COLA arrival.",
                "QC corrective actions not documented for 2 out-of-range events. Reconstruct from VeritaCheck \u2192 Chemistry log and attach CAR to {pol_num}.",
                "Delta-check policy missing from {pol_num}. Draft addendum and circulate via VeritaPolicy before survey.",
            ],
        },
        "Calibration & Verification": {
            "Compliant": [
                "Cal-ver records on file per {pol_num} ({pol_name}). See VeritaMap \u2192 'Chemistry - Siemens Dimension EXL' for analyte-level due dates.",
                "Method comparison documented in VeritaMap \u2192 'Hematology - Sysmex XN-2000 + Manual Diff' (correlation group); meets {pol_num} \u00a73.",
                "Reportable range verified for all quantitative tests; evidence in VeritaMap detail view per {pol_num}.",
            ],
            "Needs Attention": [
                "Cal-ver due in <30 days for 4 Chemistry analytes. See VeritaMap \u2192 'Chemistry - Siemens Dimension EXL' \u2192 next-due column; schedule per {pol_num}.",
                "Method comparison documentation thin for Stago/Stago backup pairing. Re-run correlation per {pol_num} and log in VeritaMap correlation group.",
                "Pearson r threshold not stated in {pol_num}; current practice accepts \u22650.95 but policy is silent. Update policy text.",
            ],
            "Immediate Action": [
                "Cal-ver lapsed >30 days on Dimension EXL Glucose. Halt reporting until verified per {pol_num} \u00a72.1; capture evidence in VeritaMap.",
                "Cross-instrument correlation between i-STAT G3+ and Nova StatStrip (POC Glucose) overdue. Open VeritaMap \u2192 'Point of Care' \u2192 Glucose row and run Pri\u2194Backup correlation.",
            ],
        },
        "Proficiency Testing": {
            "Compliant": [
                "PT enrollment current with API for all regulated analytes per {pol_num}. See VeritaPT enrollments and PT events log.",
                "Director review of PT results documented for last 4 events; evidence in VeritaPT \u2192 events tab per {pol_num}.",
                "PT samples handled identical to patient samples; attestation captured per {pol_num} \u00a72.",
            ],
            "Needs Attention": [
                "PT result trend declining on one Hematology analyte (last 3 events). Open VeritaPT \u2192 corrective actions and document RCA per {pol_num}.",
                "Alternative performance assessment (APA) overdue for one non-regulated analyte; document per {pol_num} \u00a76.",
                "PT enrollment certificate scan missing for 1 program. Upload to VeritaPolicy \u2192 {pol_num} attachments.",
            ],
            "Immediate Action": [
                "Unsuccessful PT performance not investigated within 30 days; {pol_num} \u00a75 requires RCA. Open VeritaPT corrective action and assign to Michael Veri before COLA.",
                "PT records for 1 prior event not retained per 2-year minimum. Locate or reconstruct per {pol_num}; document gap in corrective action log.",
            ],
        },
        "Personnel & Competency": {
            "Compliant": [
                "Competency program current per {pol_num}. See Competency \u2192 'Chemistry Technical Competency 2026' and 'Hematology Technical Competency 2026' assessments.",
                "All 6 CLIA methods captured per assessment; evidence in Competency module per {pol_num} \u00a73.",
                "Annual competency complete for all 5 staff; sign-offs in Competency module and Staff schedule.",
            ],
            "Needs Attention": [
                "6-month competency due in <60 days for 1 employee. See Staff \u2192 competency schedules; schedule observation per {pol_num}.",
                "Remedial training pathway in {pol_num} \u00a75 not exercised in 12 months; verify policy still reflects practice.",
                "Continuing education tracking outside Competency module. Consolidate into Staff records per {pol_num}.",
            ],
            "Immediate Action": [
                "Lapsed competency on file for 1 testing employee. Pull from bench until re-assessed per {pol_num}; capture in Competency \u2192 assessments.",
                "Director attestation of staff qualifications missing for 2026 cycle. Generate via Staff \u2192 Director Attestation report and route per {pol_num}.",
            ],
        },
        "Test Management & Procedures": {
            "Compliant": [
                "SOP set current per {pol_num} ({pol_name}); 2-year director review captured in VeritaPolicy.",
                "Specimen labeling and rejection criteria documented per {pol_num}; staff trained (Competency module).",
                "Result reporting elements meet CLIA per {pol_num}; LIS report template attached.",
            ],
            "Needs Attention": [
                "Two SOPs past 24-month review window. Open VeritaPolicy \u2192 {pol_num} and re-route for director sign-off.",
                "Reflex testing criteria in {pol_num} reference outdated panel. Update before survey.",
                "Biotin interference policy missing patient notification step required by {pol_num}.",
            ],
            "Immediate Action": [
                "LDT validation packet incomplete for 1 in-house method; CLIA \u00a7493.1213 evidence not on file. Reconstruct per {pol_num} or suspend test.",
                "LIS-instrument interface validation not documented after last upgrade. Capture per {pol_num}; reference VeritaMap instrument list.",
            ],
        },
        "Equipment & Maintenance": {
            "Compliant": [
                "PM schedule current; logs in VeritaTrack maintenance tasks per {pol_num} ({pol_name}).",
                "Temperature monitoring continuous; excursion log clean for last 90 days per {pol_num}.",
                "Reagent lot acceptance documented in Inventory module before use per {pol_num} \u00a74.",
            ],
            "Needs Attention": [
                "Pipette calibration due in <30 days for 2 pipettes. Open VeritaTrack \u2192 'Pipette Calibration' task; schedule per {pol_num}.",
                "Centrifuge timer/speed verification log behind by 1 cycle. Add to VeritaTrack and reference {pol_num}.",
                "Water-quality monitoring log gap (1 month) on Chemistry analyzer. Backfill per {pol_num} \u00a76.",
            ],
            "Immediate Action": [
                "Out-of-service Hematology analyzer not documented with patient-result review per {pol_num}. Reconstruct from VeritaCheck and Inventory; close before survey.",
                "New reagent lot placed in service without acceptance testing. Document retroactively per {pol_num} \u00a74.3 or remove from service.",
            ],
        },
        "Safety & Environment": {
            "Compliant": [
                "Exposure control plan current per {pol_num} ({pol_name}); annual training documented in Competency module.",
                "Eyewash weekly checks logged in VeritaTrack \u2192 'Eyewash Inspection' task per {pol_num}.",
                "Chemical hygiene plan reviewed within 12 months per {pol_num} \u00a73.",
            ],
            "Needs Attention": [
                "Annual safety inspection report not yet finalized for 2026. Schedule via VeritaTrack and document per {pol_num}.",
                "SDS index not refreshed since 2025. Update Inventory \u2192 hazardous materials list per {pol_num}.",
                "Hepatitis B declination form on file but not re-offered at policy interval. Confirm per {pol_num}.",
            ],
            "Immediate Action": [
                "Eyewash station weekly checks missing for past 6 weeks. Open VeritaTrack 'Eyewash Inspection' task; backfill per {pol_num}.",
                "Exposure incident from prior quarter has no post-exposure follow-up record. Reconstruct per {pol_num} \u00a76 before survey.",
            ],
        },
        "Blood Bank & Transfusion": {
            "Compliant": [
                "ABO/Rh and antibody screen workflow current; evidence in VeritaMap \u2192 'Blood Bank - Tube + Ortho ID-MTS Gel' per {pol_num}.",
                "Daily reagent QC (anti-sera, screening cells, check cells) logged per {pol_num}; see VeritaCheck Blood Bank study.",
                "Transfusion-reaction workup policy reviewed within cycle per {pol_num}.",
            ],
            "Needs Attention": [
                "Crossmatch (AHG) correlation between Tube and Ortho ID-MTS Gel due in <30 days. Open VeritaMap \u2192 Blood Bank \u2192 Crossmatch correlation group.",
                "Massive transfusion protocol last reviewed 14 months ago; refresh in VeritaPolicy and capture in {pol_num}.",
                "Blood-product visual inspection log inconsistent on weekends. Reinforce per {pol_num} \u00a73.",
            ],
            "Immediate Action": [
                "Transfusion-fatality reporting checklist missing FDA contact path. Update {pol_num} \u00a76 and post in Blood Bank work area.",
                "10-year retention of compatibility-testing records: 1 month gap detected. Reconstruct per {pol_num} or document permanent loss.",
            ],
        },
        "Point of Care Testing": {
            "Compliant": [
                "POCT operator competency current; lockouts active in connectivity middleware per {pol_num} ({pol_name}).",
                "i-STAT G3+ and Nova StatStrip glucose correlation documented in VeritaMap \u2192 Point of Care.",
                "POCT QC daily; logs accessible per {pol_num}.",
            ],
            "Needs Attention": [
                "POCT glucose meter correlation between i-STAT and Nova StatStrip due in <30 days. Open VeritaMap \u2192 Point of Care \u2192 Glucose correlation.",
                "POCT operator roster has 2 lapsed operators; lockout enforced but re-training not scheduled. Add to Competency program per {pol_num}.",
                "POCT critical-value escalation path in {pol_num} differs from core lab. Reconcile.",
            ],
            "Immediate Action": [
                "POCT device CLIA certificate coverage not reconciled to current device list. Update via {pol_num} and Inventory \u2192 devices.",
                "FDA 2016 ICU glucose-meter accuracy attestation missing for 1 location. Capture per {pol_num} before survey.",
            ],
        },
        "Leadership & Governance": {
            "Compliant": [
                "Director review of all required policies current per {pol_num} ({pol_name}); see VeritaPolicy sign-off tab.",
                "CLIA certificate posted; copy attached to {pol_num} in VeritaPolicy.",
                "Annual self-assessment scheduled and tracked in VeritaTrack per {pol_num}.",
            ],
            "Needs Attention": [
                "Corrective-action log has 3 open items >60 days. Triage in VeritaTrack and close per {pol_num} \u00a72.",
                "Strategic plan last reviewed 11 months ago; refresh before annual cycle per {pol_num}.",
                "Disaster-recovery plan references retired LIS vendor. Update {pol_num} \u00a74.",
            ],
            "Immediate Action": [
                "Annual mock inspection not on calendar for 2026. Schedule via VeritaTrack and capture findings per {pol_num}.",
                "Accreditation-body notification not filed for recent director-coverage change. File per {pol_num} \u00a73 immediately.",
            ],
        },
    }

    # ------------------------------------------------------------------
    # Status distribution (deterministic, scattered across all domains).
    # Use a hash that mixes item_id with a salt so Not Assessed items do
    # not cluster on consecutive items in one domain.
    # Targets approx: 60% Compliant, 18% Needs Attention, 8% Immediate, 14% Not Assessed.
    # ------------------------------------------------------------------
    def status_for(iid: int) -> str:
        h = (iid * 73 + 11) % 100
        if h < 14:
            return "Not Assessed"
        if h < 22:
            return "Immediate Action"
        if h < 40:
            return "Needs Attention"
        return "Compliant"

    def note_for(iid: int, status: str) -> str | None:
        if status == "Not Assessed":
            return None
        domain = item_domain.get(iid, "Quality Systems & QC")
        pol_num, pol_name = DOMAIN_POLICY.get(domain, ("POL-003", "Quality Control Plan (IQCP)"))
        variants = DOMAIN_REFS.get(domain, {}).get(status, [])
        if not variants:
            return None
        # Pick a variant deterministically by item_id so notes vary
        # within the same status+domain bucket.
        variant = variants[(iid // 3) % len(variants)]
        # Compliant items often warrant no note in real life; keep ~40%
        # of Compliant items note-less so the demo doesn't look auto-
        # filled. Use a separate hash so it scatters.
        if status == "Compliant" and ((iid * 17 + 5) % 5) < 2:
            return None
        return variant.format(pol_num=pol_num, pol_name=pol_name)

    statuses = []
    for iid in item_ids:
        st = status_for(iid)
        nt = note_for(iid, st)
        owner = None if st == "Not Assessed" else "Michael Veri"
        statuses.append((iid, st, nt, owner))

    for iid, status, notes, owner in statuses:
        due = None
        if status == "Immediate Action":
            due = days_ago(-((iid % 14) + 7))   # 7..20 days out
        elif status == "Needs Attention":
            due = days_ago(-((iid % 30) + 30))  # 30..59 days out
        out.append(
            "INSERT INTO veritascan_items "
            "(scan_id, item_id, status, notes, owner, due_date, updated_at, completion_source) VALUES ("
            f"(SELECT id FROM veritascan_scans WHERE user_id={USER_ID} AND name LIKE '%[SEED-2026-05-03-MODULES]%' ORDER BY id DESC LIMIT 1), "
            f"{iid}, {lit(status)}, {lit(notes)}, {lit(owner)}, {lit(due)}, {lit(NOW_ISO)}, 'manual');"
        )
    out.append("")

    out.append("COMMIT;")
    out.append("")

    with open(args.out, "w") as f:
        f.write("\n".join(out))

    # Summary stats
    print(f"Wrote {args.out} ({len(out)} lines)")
    print(f"  pi_entries: 12 months x 14 metrics = 168")
    print(f"  productivity_months: 12")
    print(f"  veritatrack_signoffs: 2 per task (~58 total)")
    print(f"  competency_method_groups: 3")
    print(f"  competency_assessments: 5 employees x 3 (2 tech + 1 nontech) = 15")
    print(f"  staff_competency_schedules: 1 per staff (5)")
    print(f"  veritascan: 1 scan + {len(item_ids)} items, ~{sum(1 for _,s,_,_ in statuses if s != 'Not Assessed')} assessed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
