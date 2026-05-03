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
    out.append("-- PI entries (12 months x 14 metrics) --")
    # We'll INSERT OR REPLACE keyed on (metric_id, year, month).
    # Realistic value ranges per metric name (approximate clinical norms).
    metric_ranges = {
        "Wasted Product Rate":               (0.5, 4.5, "%"),
        "Transfusion Reaction Rate":         (0.1, 1.2, "per 1000 units"),
        "Crossmatch-to-Transfusion Ratio":   (1.5, 2.8, "ratio"),
        "C. difficile Rate":                 (1.0, 6.0, "per 10,000 patient days"),
        "MRSA Rate":                         (0.5, 3.5, "per 10,000 patient days"),
        "Blood Culture Contamination Rate":  (0.8, 3.5, "%"),
        "Urine Contamination Rate":          (1.0, 5.0, "%"),
        "Avg TAT - Received to Verified":    (35, 85, "min"),
        "Avg TAT - Ordered to Collected":    (10, 30, "min"),
        "Avg TAT - Collected to Received":   (15, 45, "min"),
        "Avg TAT - Received to Resulted":    (20, 60, "min"),
        "Avg TAT - Resulted to Verified":    (5, 20, "min"),
        "Avg TAT - Ordered to Verified":     (60, 150, "min"),
        "Critical Value Notification Rate":  (92, 99.5, "%"),
    }
    today = TODAY
    for months_ago in range(12, 0, -1):
        y = today.year if today.month - months_ago > 0 else today.year - 1
        m = ((today.month - months_ago - 1) % 12) + 1
        if today.month - months_ago <= 0:
            y = today.year - 1
        # Pull metric ids by name for account 17.
        # We use a subselect because metric_ids are not guaranteed across DBs.
        for metric_name, (lo, hi, _unit) in metric_ranges.items():
            value = round(random.uniform(lo, hi), 2)
            volume = random.randint(800, 5500)
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
    out.append("-- Productivity months (12 months) --")
    for months_ago in range(12, 0, -1):
        y = today.year if today.month - months_ago > 0 else today.year - 1
        m = ((today.month - months_ago - 1) % 12) + 1
        if today.month - months_ago <= 0:
            y = today.year - 1
        billable = random.randint(28000, 45000)
        productive = round(random.uniform(1100, 1450), 1)
        nonprod = round(random.uniform(80, 220), 1)
        ot = round(random.uniform(20, 95), 1)
        ftes = round(random.uniform(7.0, 9.5), 2)
        out.append(
            "INSERT OR REPLACE INTO productivity_months "
            "(account_id, year, month, billable_tests, productive_hours, non_productive_hours, "
            "overtime_hours, total_ftes, facility_type, notes, created_at, updated_at) VALUES ("
            f"{ACCOUNT_ID}, {y}, {m}, {billable}, {productive}, {nonprod}, {ot}, {ftes}, "
            f"'community', {lit(SEED_TAG)}, {lit(NOW_ISO)}, {lit(NOW_ISO)});"
        )
    out.append("")

    # ----------------------------------------------------------------------
    # 3. VeritaTrack signoffs - one recent + one prior per task
    # ----------------------------------------------------------------------
    out.append("-- VeritaTrack signoffs (~58: 2 per task) --")
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
    # Use last_insert_rowid to insert items in the same script
    # Distribute statuses: 60% Compliant, 18% Needs Attention, 8% Immediate Action, 14% Not Assessed
    statuses = []
    for idx, _iid in enumerate(item_ids):
        h = idx % 100
        if h < 14:
            statuses.append(("Not Assessed", None, None))
        elif h < 22:
            statuses.append(("Immediate Action",
                            f"Action item flagged during pre-COLA review {SEED_TAG}",
                            "Michael Veri"))
        elif h < 40:
            statuses.append(("Needs Attention",
                            f"Documentation gap noted, review scheduled {SEED_TAG}",
                            "Michael Veri"))
        else:
            statuses.append(("Compliant", None, "Michael Veri"))
    for iid, (status, notes, owner) in zip(item_ids, statuses):
        due = None
        if status == "Immediate Action":
            due = days_ago(-30)
        elif status == "Needs Attention":
            due = days_ago(-60)
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
    print(f"  veritascan: 1 scan + {len(item_ids)} items, ~{sum(1 for s,_,_ in statuses if s != 'Not Assessed')} assessed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
