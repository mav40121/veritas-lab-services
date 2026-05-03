#!/usr/bin/env python3
"""
Seed Michaels Lab (user_id=17, lab_id=3, CLIA 55D5555555) with realistic
"lived-in" demo data for the COLA conference booth (May 6-8, 2026).

Profile: small POL-style lab, COLA-accredited only, mix of compliant /
needs-attention / immediate-action items. Built for booth demos where a
prospect should see a populated, working lab.

Usage:
    python3 seed_michaels_lab.py --db /path/to/db --dry-run
    python3 seed_michaels_lab.py --db /path/to/db --execute

Idempotency: each insert uses a marker tag in `notes` so re-runs do not
duplicate rows. To wipe seed data, use --wipe-seeds.
"""

from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

USER_ID = 17
LAB_ID = 3
SEED_TAG = "[SEED-2026-05-03]"
NOW_ISO = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

# ── Helpers ──────────────────────────────────────────────────────────────
def days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d")

def days_ahead(n: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=n)).strftime("%Y-%m-%d")

def iso_days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat().replace("+00:00", "Z")

# ── Seed data definitions ────────────────────────────────────────────────
# Realistic POL-style: 1 director, 1 supervisor, 3 techs

STAFF_EMPLOYEES = [
    # (last, first, mi, title, hire_date, qualifications, complexity, performs_testing, status)
    ("Veri",     "Michael", "A", "Lab Director / MLS(ASCP)", "2014-03-10",
        "MLS(ASCP), CPHQ. 200+ TJC inspections. 12 yrs lab director experience.", "H", 1, "active"),
    ("Veri",     "Lisa",    "J", "Hematology Supervisor / MLS(ASCP)CM", "2016-08-22",
        "MLS(ASCP)CM. Hematology specialist. MLM Cover August 2023.", "H", 1, "active"),
    ("Martinez", "Jennifer","R", "Senior MLS(ASCP)", "2020-03-15",
        "MLS(ASCP). Generalist. Chemistry / Hematology / Urinalysis.", "H", 1, "active"),
    ("Chen",     "Robert",  "T", "MT(ASCP)", "2018-06-01",
        "MT(ASCP). Generalist + POC trainer.", "H", 1, "active"),
    ("Williams", "Sarah",   "K", "MLT(ASCP)", "2022-01-10",
        "MLT(ASCP). Hematology / Urinalysis.", "M", 1, "active"),
    ("Nguyen",   "David",   "P", "Phlebotomy Supervisor", "2019-09-20",
        "PBT(ASCP). Pre-analytical lead.", "M", 0, "active"),
]

# competency_employees mirrors staff_employees but for the competency module
COMPETENCY_EMPLOYEES = [
    ("Michael Veri",     "MLS(ASCP), CPHQ",  "2014-03-10", "MAV", "active"),
    ("Lisa Veri",        "MLS(ASCP)CM",      "2016-08-22", "LJV", "active"),
    ("Jennifer Martinez","MLS(ASCP)",        "2020-03-15", "JRM", "active"),
    ("Robert Chen",      "MT(ASCP)",         "2018-06-01", "RTC", "active"),
    ("Sarah Williams",   "MLT(ASCP)",        "2022-01-10", "SKW", "active"),
]

LAB_CERTIFICATES = [
    # (cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director)
    ("clia", "CLIA Certificate of Compliance", "55D5555555",
        "Centers for Medicare & Medicaid Services (CMS)", "2024-08-01", "2026-07-31",
        "Michael Veri, MLS(ASCP), CPHQ"),
    ("cola", "COLA Laboratory Accreditation", "COLA-2024-MV-44128",
        "COLA, Inc.", "2024-08-15", "2026-08-14",
        "Michael Veri, MLS(ASCP), CPHQ"),
    ("state", "Arizona Laboratory License", "AZ-LAB-2026-3091",
        "Arizona Department of Health Services", "2026-01-01", "2026-12-31",
        "Michael Veri, MLS(ASCP), CPHQ"),
    ("director", "Laboratory Director Qualifications", "MLS-ASCP-0421067",
        "ASCP Board of Certification", "2010-06-15", "2030-06-14",
        "Michael Veri, MLS(ASCP), CPHQ"),
]

# Policies — 12 row mix mapped to common COLA chapters. Status mix:
#   complete (recent review)  ~7
#   in_progress              ~3
#   not_started              ~2
LAB_POLICIES = [
    # (number, name, owner, status, last_reviewed, next_review)
    ("POL-001", "Specimen Collection and Handling SOP", "Lisa Veri, MLS(ASCP)CM", "complete", "2026-01-15", "2027-01-15"),
    ("POL-002", "Critical Value Reporting Policy",      "Michael Veri, MLS(ASCP)", "complete", "2026-01-20", "2027-01-20"),
    ("POL-003", "Quality Control Plan (IQCP)",          "Michael Veri, MLS(ASCP)", "complete", "2026-02-01", "2027-02-01"),
    ("POL-004", "Staff Competency Assessment Policy",   "Michael Veri, MLS(ASCP)", "complete", "2026-01-25", "2027-01-25"),
    ("POL-005", "Method Validation and Verification",   "Lisa Veri, MLS(ASCP)CM",  "complete", "2026-02-10", "2027-02-10"),
    ("POL-006", "Proficiency Testing Program",          "Michael Veri, MLS(ASCP)", "complete", "2026-02-15", "2027-02-15"),
    ("POL-007", "Record Retention and Documentation",   "Jennifer Martinez, MLS(ASCP)", "in_progress", None, None),
    ("POL-008", "Safety and Infection Control Plan",    "Robert Chen, MT(ASCP)",   "complete", "2026-03-01", "2027-03-01"),
    ("POL-009", "LIS Backup and Disaster Recovery",     "Michael Veri, MLS(ASCP)", "in_progress", None, None),
    ("POL-010", "Reagent and Calibrator Management",    "Lisa Veri, MLS(ASCP)CM",  "complete", "2026-02-25", "2027-02-25"),
    ("POL-011", "Test Result Reporting and Amendments", "Michael Veri, MLS(ASCP)", "in_progress", None, None),
    ("POL-012", "Waived Testing Quality Plan",          "Robert Chen, MT(ASCP)",   "not_started", None, None),
]

# VeritaPolicy requirement_status — populate ~40 of 81 COLA requirements
# with a mix of statuses. We do NOT touch the canonical requirement set,
# only the user's status for each.
# Status values seen elsewhere: 'complete', 'in_progress', 'not_started'
# Mix targets: 24 complete, 10 in_progress, 6 not_started, 0 N/A.
# Requirement IDs come from server/colaRequirements.ts (6001..6081).
VERITAPOLICY_STATUS = []
_COMPLETE_IDS = list(range(6001, 6025))   # 24 complete
_IN_PROGRESS_IDS = list(range(6025, 6035))  # 10 in_progress
_NOT_STARTED_IDS = list(range(6035, 6041))  # 6 not_started
_POLICY_BY_REQ = {
    # map a few requirements to specific lab policies for verisimilitude
    6001: "POL-005", 6002: "POL-005", 6003: "POL-008", 6004: "POL-005",
    6010: "POL-008", 6011: "POL-008", 6012: "POL-008", 6013: "POL-008",
    6021: "POL-009", 6022: "POL-009", 6023: "POL-009", 6024: "POL-009",
    # in_progress reqs linked to in_progress policies
    6025: "POL-007", 6026: "POL-007", 6027: "POL-007",
    6028: "POL-011", 6029: "POL-011",
    6030: "POL-009", 6031: "POL-009",
    # not_started reqs linked to POL-012 (Waived Testing) where appropriate
    6035: "POL-012", 6036: "POL-012",
}
for rid in _COMPLETE_IDS:
    VERITAPOLICY_STATUS.append((rid, "complete", _POLICY_BY_REQ.get(rid)))
for rid in _IN_PROGRESS_IDS:
    VERITAPOLICY_STATUS.append((rid, "in_progress", _POLICY_BY_REQ.get(rid)))
for rid in _NOT_STARTED_IDS:
    VERITAPOLICY_STATUS.append((rid, "not_started", _POLICY_BY_REQ.get(rid)))

# PT enrollments — small POL-style menu
PT_ENROLLMENTS = [
    ("API",  "API General Chemistry",  "Chemistry",   2026),
    ("API",  "API Hematology",         "Hematology",  2026),
    ("API",  "API Urinalysis",         "Urinalysis",  2026),
    ("API",  "API Hemoglobin A1c",     "Chemistry",   2026),
    ("API",  "API Blood Gas",          "Chemistry",   2026),
]

# PT events — last 4 quarters worth, mostly pass with one fail (realistic)
# (vendor_index, event_name, event_date, analyte, your_result, peer_mean, peer_sd, sdi, pass_fail)
PT_EVENTS = [
    (0, "API GC 2025-Q4 Event 1", "2025-10-15", "Glucose",        102.0, 100.5, 2.1,  0.71, "pass"),
    (0, "API GC 2025-Q4 Event 1", "2025-10-15", "Sodium",         142.8, 140.2, 1.5,  1.73, "pass"),
    (0, "API GC 2025-Q4 Event 1", "2025-10-15", "Potassium",      4.2,   4.15,  0.10, 0.50, "pass"),
    (0, "API GC 2026-Q1 Event 1", "2026-01-20", "Glucose",        119.3, 115.0, 2.3,  1.87, "pass"),
    (0, "API GC 2026-Q1 Event 1", "2026-01-20", "Creatinine",     1.42,  1.20,  0.06, 3.67, "fail"),
    (0, "API GC 2026-Q1 Event 1", "2026-01-20", "BUN",            18.0,  17.8,  0.9,  0.22, "pass"),
    (1, "API HEM 2026-Q1",        "2026-02-05", "Hemoglobin",     14.2,  14.1,  0.3,  0.33, "pass"),
    (1, "API HEM 2026-Q1",        "2026-02-05", "Hematocrit",     43.4,  42.0,  0.9,  1.56, "pass"),
    (2, "API UA 2026-Q1",         "2026-02-12", "Glucose UA",     "Negative", None, None, None, "pass"),
    (3, "API HbA1c 2026-Q1",      "2026-03-10", "HbA1c",          7.1,   6.9,   0.2,  1.00, "pass"),
]

# Corrective actions — one for the failed creatinine event
PT_CORRECTIVE = [
    {
        "event_idx": 4,  # the failed creatinine event above
        "root_cause": "Reagent lot variation; new lot not properly cross-checked before patient testing.",
        "corrective_action": "Re-tested specimen with current lot. Re-ran calibrators + 2 levels of QC; all in range. Accepted result.",
        "preventive_action": "Updated reagent lot changeover SOP to require parallel testing of 5 patient samples before release.",
        "responsible_person": "Lisa Veri, MLS(ASCP)CM",
        "date_initiated": "2026-01-22",
        "date_completed": "2026-02-03",
        "status": "complete",
        "verified_by": "Michael Veri, MLS(ASCP)",
        "verified_date": "2026-02-04",
    }
]

# Lab certificate reminders — 90/60/30 day reminders for each cert
# generated programmatically below from LAB_CERTIFICATES

# Inventory items — small POL menu
INVENTORY_ITEMS = [
    # (name, catalog, lot, dept, category, qty, reorder, unit, expiration, vendor, location)
    ("Glucose Reagent",      "REF-GL2400", "G24A0157", "Chemistry",  "Reagent", 18, 6,  "kit", "2026-09-30", "Beckman Coulter", "Chemistry Refrigerator"),
    ("Creatinine Reagent",   "REF-CR2400", "C24B0931", "Chemistry",  "Reagent", 12, 4,  "kit", "2026-08-15", "Beckman Coulter", "Chemistry Refrigerator"),
    ("BMP Calibrator Set",   "CAL-BMP-22", "BMP24K88", "Chemistry",  "Calibrator", 6, 2,  "set", "2026-12-31", "Beckman Coulter", "Chemistry Refrigerator"),
    ("BMP QC Level 1",       "QC-BMP-L1",  "QCL1247",  "Chemistry",  "Control",  10, 4,  "vial", "2026-10-15", "Bio-Rad", "Chemistry Refrigerator"),
    ("BMP QC Level 2",       "QC-BMP-L2",  "QCL2247",  "Chemistry",  "Control",  10, 4,  "vial", "2026-10-15", "Bio-Rad", "Chemistry Refrigerator"),
    ("Sysmex CBC Reagent",   "CELLPACK",   "CP24Q441", "Hematology", "Reagent",  8,  3,  "case", "2027-01-31", "Sysmex", "Hematology Bench"),
    ("Sysmex e-Check Control","XN-CHECK",  "XNC24P82", "Hematology", "Control",  6,  2,  "kit", "2026-08-30", "Sysmex", "Hematology Refrigerator"),
    ("Urinalysis Strips",    "MULTISTIX",  "MS24R915", "Urinalysis", "Reagent",  24, 8,  "bottle","2026-11-30", "Siemens", "Urinalysis Bench"),
    ("HbA1c Reagent",        "DCA-HBA1C",  "DCA24L70", "Chemistry",  "Reagent",  4,  2,  "kit", "2026-09-15", "Siemens", "POC Cabinet"),
    ("Lancets (2.0mm)",      "L-200",      "LP24M100", "Phlebotomy", "Supply",   500,200,"box", None,         "BD",      "Phlebotomy Cart"),
    ("EDTA Lavender Tubes",  "BD-EDTA",    "BDE24N81", "Phlebotomy", "Supply",   2000,500,"box","2027-04-30", "BD",      "Phlebotomy Cart"),
    ("Gold-Top SST Tubes",   "BD-SST",     "BDS24N82", "Phlebotomy", "Supply",   1500,400,"box","2027-04-30", "BD",      "Phlebotomy Cart"),
]

# Veritamap test additions — Michael already has a Sysmex map (id 40).
# We'll add a Beckman AU480 chemistry map + tests for booth realism.
NEW_MAPS = [
    {
        "name": "Beckman AU480 Chemistry",
        "instruments": [
            ("Beckman Coulter AU480", "Primary",  "Chemistry"),
            ("Beckman Coulter AU480", "Backup",   "Chemistry"),
        ],
        "tests": [
            ("Glucose",      "Chemistry", "MODERATE"),
            ("BUN",          "Chemistry", "MODERATE"),
            ("Creatinine",   "Chemistry", "MODERATE"),
            ("Sodium",       "Chemistry", "MODERATE"),
            ("Potassium",    "Chemistry", "MODERATE"),
            ("Chloride",     "Chemistry", "MODERATE"),
            ("CO2",          "Chemistry", "MODERATE"),
            ("Calcium",      "Chemistry", "MODERATE"),
            ("Total Protein","Chemistry", "MODERATE"),
            ("Albumin",      "Chemistry", "MODERATE"),
            ("ALT",          "Chemistry", "MODERATE"),
            ("AST",          "Chemistry", "MODERATE"),
            ("Total Bilirubin","Chemistry","MODERATE"),
            ("Alkaline Phosphatase","Chemistry","MODERATE"),
        ],
    },
    {
        "name": "Siemens DCA Vantage POC",
        "instruments": [
            ("Siemens DCA Vantage", "Primary", "POC"),
        ],
        "tests": [
            ("HbA1c",       "Chemistry", "WAIVED"),
            ("Microalbumin","Chemistry", "WAIVED"),
        ],
    },
]

# Update existing scan #4 ("Test") — fill more items so it looks like
# active assessment work, not abandoned. Currently 14 of 168 assessed.
# Target: ~120 of 168 assessed with realistic mix.
# Mix: 70 Compliant, 30 Needs Attention, 15 Immediate Action, 5 N/A
SCAN_FILLS_ID = 4
SCAN_FILL_COUNTS = {"Compliant": 70, "Needs Attention": 30, "Immediate Action": 15, "N/A": 5}

# ── Insert / dry-run engine ──────────────────────────────────────────────
class Op:
    """Represents a planned write. Renders as a human-readable line and
    can execute itself against a sqlite cursor."""
    def __init__(self, label: str, sql: str, params: tuple):
        self.label = label
        self.sql = sql
        self.params = params
    def execute(self, cur):
        cur.execute(self.sql, self.params)
        return cur.lastrowid

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    grp = ap.add_mutually_exclusive_group(required=True)
    grp.add_argument("--dry-run", action="store_true")
    grp.add_argument("--execute", action="store_true")
    grp.add_argument("--wipe-seeds", action="store_true")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    cur = con.cursor()

    if args.wipe_seeds:
        wipe(con)
        return

    # Pre-flight: confirm user 17 + lab 3 exist as expected
    cur.execute("SELECT id, email, name, lab_id FROM users WHERE id=?", (USER_ID,))
    user = cur.fetchone()
    if not user:
        print(f"ERROR: user {USER_ID} not found. Aborting.", file=sys.stderr)
        sys.exit(2)
    cur.execute("SELECT id, lab_name, clia_number, owner_user_id FROM labs WHERE id=?", (LAB_ID,))
    lab = cur.fetchone()
    if not lab or lab[3] != USER_ID:
        print(f"ERROR: lab {LAB_ID} missing or not owned by user {USER_ID}. Aborting.", file=sys.stderr)
        sys.exit(2)
    print(f"Pre-flight OK: user={user}, lab={lab}")
    print()

    ops = build_ops(cur)

    # Summary
    by_table = {}
    for op in ops:
        t = op.label.split(":", 1)[0]
        by_table[t] = by_table.get(t, 0) + 1
    print("=" * 72)
    print(f"PLANNED WRITES — {len(ops)} rows across {len(by_table)} tables")
    print("=" * 72)
    for t, n in sorted(by_table.items()):
        print(f"  {t}: {n} rows")
    print()

    if args.dry_run:
        print("DRY RUN — first 60 ops shown below; full plan saved to /tmp/seed_plan.txt")
        with open("/tmp/seed_plan.txt", "w") as f:
            for op in ops:
                f.write(f"[{op.label}] {op.sql}  params={op.params}\n")
        for op in ops[:60]:
            print(f"  [{op.label}] params={op.params}")
        if len(ops) > 60:
            print(f"  ... and {len(ops)-60} more (see /tmp/seed_plan.txt)")
        return

    # Execute in phases so FK lookups can resolve. We do a single
    # transaction across phases for atomicity.
    print("EXECUTING — wrapping in transaction...")
    try:
        cur.execute("BEGIN")
        for op in ops:
            op.execute(cur)
        # Phase 2: resolve FKs that build_ops left as NULL.
        resolve_fks(cur)
        cur.execute("COMMIT")
        print(f"OK — committed {len(ops)} rows + FK fixups")
    except Exception as e:
        cur.execute("ROLLBACK")
        print(f"FAILED — rolled back: {e}", file=sys.stderr)
        sys.exit(1)

def resolve_fks(cur):
    """Phase 2: insert child rows that need FKs resolved against the
    parents we just inserted (PT events under enrollments, veritamap
    instruments/tests under maps, PT corrective actions under events).
    """
    # PT events: pick an enrollment per event by analyte->category
    cur.execute("SELECT id, vendor, program_name, pt_category FROM pt_enrollments_v2 WHERE user_id=?", (USER_ID,))
    enrollments = cur.fetchall()  # [(id, vendor, program, category)]
    if not enrollments:
        return  # nothing to link
    analyte_to_category = {
        "Glucose": "Chemistry", "Sodium": "Chemistry", "Potassium": "Chemistry",
        "Creatinine": "Chemistry", "BUN": "Chemistry",
        "Hemoglobin": "Hematology", "Hematocrit": "Hematology",
        "Glucose UA": "Urinalysis",
        "HbA1c": "Chemistry",
    }
    # Skip events that already exist for this user with our SEED_TAG
    cur.execute("SELECT event_id FROM pt_events WHERE user_id=? AND notes=?", (USER_ID, SEED_TAG))
    existing_event_ids = {r[0] for r in cur.fetchall()}
    for idx, (vidx, ename, edate, analyte, your, peer_m, peer_sd, sdi, pf) in enumerate(PT_EVENTS):
        ev_id = f"E{idx+1:03d}"
        if ev_id in existing_event_ids:
            continue
        cat = analyte_to_category.get(analyte, "Chemistry")
        match = next((e for e in enrollments if e[3] == cat), enrollments[0])
        cur.execute(
            "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (match[0], USER_ID, ev_id, ename, edate, analyte, str(your), "Beckman AU480",
             peer_m, peer_sd, 145, None, None, sdi, pf, SEED_TAG, NOW_ISO, NOW_ISO),
        )

    # PT corrective actions: attach to the failed creatinine event
    cur.execute("SELECT id FROM pt_events WHERE user_id=? AND notes=? AND analyte='Creatinine' AND pass_fail='fail' LIMIT 1",
                (USER_ID, SEED_TAG))
    fail_event = cur.fetchone()
    if fail_event:
        # Skip if we already created one
        cur.execute("SELECT COUNT(*) FROM pt_corrective_actions WHERE user_id=? AND event_id=?", (USER_ID, fail_event[0]))
        if cur.fetchone()[0] == 0:
            for ca in PT_CORRECTIVE:
                cur.execute(
                    "INSERT INTO pt_corrective_actions (event_id, user_id, root_cause, corrective_action, preventive_action, responsible_person, date_initiated, date_completed, status, verified_by, verified_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (fail_event[0], USER_ID, ca["root_cause"], ca["corrective_action"], ca["preventive_action"],
                     ca["responsible_person"], ca["date_initiated"], ca["date_completed"], ca["status"],
                     ca["verified_by"], ca["verified_date"], NOW_ISO, NOW_ISO),
                )

    # Veritamap instruments + tests under each new map
    cur.execute("SELECT id, name FROM veritamap_maps WHERE user_id=?", (USER_ID,))
    map_id_by_name = {n: i for (i, n) in cur.fetchall()}
    for m in NEW_MAPS:
        mid = map_id_by_name.get(m["name"])
        if not mid:
            continue
        # Skip if instruments already exist for this map
        cur.execute("SELECT COUNT(*) FROM veritamap_instruments WHERE map_id=?", (mid,))
        if cur.fetchone()[0] == 0:
            for iname, role, icat in m["instruments"]:
                cur.execute(
                    "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?,?,?,?,?)",
                    (mid, iname, role, icat, NOW_ISO),
                )
        cur.execute("SELECT COUNT(*) FROM veritamap_tests WHERE map_id=?", (mid,))
        if cur.fetchone()[0] == 0:
            for ti, (analyte, specialty, complexity) in enumerate(m["tests"]):
                # Stagger dates per analyte so they don't all land on the same
                # day. Deterministic offset from analyte name hash, range ±21 days.
                h = sum(ord(c) for c in analyte)
                cv  = days_ago(45 + (h % 31))      # cal verification: 45-75d ago
                mc  = days_ago(60 + ((h * 3) % 47))  # method comp: 60-106d ago
                pr  = days_ago(28 + ((h * 7) % 23))  # precision: 28-50d ago
                sop = days_ago(75 + ((h * 5) % 38))  # SOP review: 75-112d ago
                cur.execute(
                    "INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, last_cal_ver, last_method_comp, last_precision, last_sop_review, notes, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                    (mid, analyte, specialty, complexity, 1, m["instruments"][0][0],
                     cv, mc, pr, sop, SEED_TAG, NOW_ISO),
                )

# ── Plan builder ─────────────────────────────────────────────────────────
def build_ops(cur) -> list[Op]:
    ops: list[Op] = []

    # 1) staff_employees (only ones not present)
    cur.execute("SELECT first_name, last_name FROM staff_employees WHERE lab_id=? OR user_id=?", (LAB_ID, USER_ID))
    existing_staff = {(r[0], r[1]) for r in cur.fetchall()}
    for last, first, mi, title, hire, qual, complexity, performs, status in STAFF_EMPLOYEES:
        if (first, last) in existing_staff:
            continue
        ops.append(Op(
            "staff_employees",
            "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, middle_initial, title, hire_date, qualifications_text, highest_complexity, performs_testing, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (LAB_ID, USER_ID, last, first, mi, title, hire, f"{qual} {SEED_TAG}", complexity, performs, status, NOW_ISO, NOW_ISO),
        ))

    # 2) staff_labs (employer card so the staff module shows the lab)
    cur.execute("SELECT id FROM staff_labs WHERE user_id=?", (USER_ID,))
    if not cur.fetchone():
        ops.append(Op(
            "staff_labs",
            "INSERT INTO staff_labs (user_id, lab_name, clia_number, lab_address_street, lab_address_city, lab_address_state, lab_address_zip, lab_phone, certificate_type, accreditation_body, complexity, created_at, updated_at, includes_nys) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (USER_ID, "Michaels Lab", "55D5555555", "123 Main Street", "Globe", "AZ", "85501", "928-555-0140",
             "compliance", "COLA", "moderate", NOW_ISO, NOW_ISO, 0),
        ))

    # 3) competency_employees
    cur.execute("SELECT name FROM competency_employees WHERE user_id=?", (USER_ID,))
    existing_comp_emp = {r[0] for r in cur.fetchall()}
    for name, title, hire, initials, status in COMPETENCY_EMPLOYEES:
        if name in existing_comp_emp:
            continue
        ops.append(Op(
            "competency_employees",
            "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?,?,?,?,?,?,?)",
            (USER_ID, name, title, hire, initials, status, NOW_ISO),
        ))

    # 4) competency_programs (just two — Chemistry + Hematology Technical)
    cur.execute("SELECT name FROM competency_programs WHERE user_id=?", (USER_ID,))
    existing_progs = {r[0] for r in cur.fetchall()}
    for name, dept, ptype in [
        ("Chemistry Technical Competency 2026", "Chemistry", "technical"),
        ("Hematology Technical Competency 2026", "Hematology", "technical"),
        ("Lab-Wide Non-Technical Orientation 2026", "Generalist", "nontechnical"),
    ]:
        if name in existing_progs:
            continue
        ops.append(Op(
            "competency_programs",
            "INSERT INTO competency_programs (user_id, name, department, type, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (USER_ID, name, dept, ptype, NOW_ISO, NOW_ISO),
        ))

    # 5) lab_certificates
    cur.execute("SELECT cert_number FROM lab_certificates WHERE user_id=?", (USER_ID,))
    existing_certs = {r[0] for r in cur.fetchall()}
    for ctype, cname, cnum, body, issued, expires, director in LAB_CERTIFICATES:
        if cnum in existing_certs:
            continue
        ops.append(Op(
            "lab_certificates",
            "INSERT INTO lab_certificates (user_id, cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, notes, is_auto_populated, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (USER_ID, ctype, cname, cnum, body, issued, expires, director, SEED_TAG, 0, 1, NOW_ISO, NOW_ISO),
        ))

    # 6) veritapolicy_lab_policies
    cur.execute("SELECT policy_number FROM veritapolicy_lab_policies WHERE user_id=?", (USER_ID,))
    existing_pol = {r[0] for r in cur.fetchall()}
    for pnum, pname, owner, status, lr, nr in LAB_POLICIES:
        if pnum in existing_pol:
            continue
        ops.append(Op(
            "veritapolicy_lab_policies",
            "INSERT INTO veritapolicy_lab_policies (user_id, policy_number, policy_name, owner, status, last_reviewed, next_review, document_name, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (USER_ID, pnum, pname, owner, status, lr, nr, None, SEED_TAG, NOW_ISO, NOW_ISO),
        ))

    # 7) veritapolicy_requirement_status — populate after policies so we
    # could later resolve lab_policy_id, but here we keep policy_name as
    # text breadcrumb only (lab_policy_id stays NULL).
    cur.execute("SELECT requirement_id FROM veritapolicy_requirement_status WHERE user_id=?", (USER_ID,))
    existing_rs = {r[0] for r in cur.fetchall()}
    for rid, status, policy_num in VERITAPOLICY_STATUS:
        if rid in existing_rs:
            continue
        # Find a friendly policy name
        pname = None
        if policy_num:
            for p in LAB_POLICIES:
                if p[0] == policy_num:
                    pname = p[1]
                    break
        ops.append(Op(
            "veritapolicy_requirement_status",
            "INSERT INTO veritapolicy_requirement_status (user_id, requirement_id, status, is_na, na_reason, lab_policy_id, notes, updated_at, policy_name) VALUES (?,?,?,?,?,?,?,?,?)",
            (USER_ID, rid, status, 0, None, None, SEED_TAG, NOW_ISO, pname),
        ))

    # 8) PT enrollments only — events + corrective actions seeded in phase 2
    cur.execute("SELECT vendor, program_name, year_enrolled FROM pt_enrollments_v2 WHERE user_id=?", (USER_ID,))
    existing_pt = {(r[0], r[1], r[2]) for r in cur.fetchall()}
    for idx, (vendor, prog, cat, yr) in enumerate(PT_ENROLLMENTS):
        if (vendor, prog, yr) in existing_pt:
            continue
        ops.append(Op(
            f"pt_enrollments_v2",
            "INSERT INTO pt_enrollments_v2 (user_id, vendor, program_name, pt_category, year_enrolled, created_at) VALUES (?,?,?,?,?,?)",
            (USER_ID, vendor, prog, cat, yr, NOW_ISO),
        ))

    # 9) Inventory items (account_id stores user_id by convention here)
    cur.execute("SELECT item_name, lot_number FROM inventory_items WHERE account_id=?", (USER_ID,))
    existing_inv = {(r[0], r[1]) for r in cur.fetchall()}
    for name, cat_n, lot, dept, cat, qty, reorder, unit, exp, vendor, location in INVENTORY_ITEMS:
        if (name, lot) in existing_inv:
            continue
        ops.append(Op(
            "inventory_items",
            "INSERT INTO inventory_items (account_id, item_name, catalog_number, lot_number, department, category, quantity_on_hand, reorder_point, unit, expiration_date, vendor, storage_location, notes, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (USER_ID, name, cat_n, lot, dept, cat, qty, reorder, unit, exp, vendor, location, SEED_TAG, "active", NOW_ISO, NOW_ISO),
        ))

    # 10) Veritamap — new maps only (instruments + tests seeded in phase 2)
    cur.execute("SELECT name FROM veritamap_maps WHERE user_id=?", (USER_ID,))
    existing_maps = {r[0] for r in cur.fetchall()}
    for m_idx, m in enumerate(NEW_MAPS):
        if m["name"] in existing_maps:
            continue
        ops.append(Op(
            f"veritamap_maps",
            "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?,?,?,?,?)",
            (USER_ID, m["name"], json.dumps([i[0] for i in m["instruments"]]), NOW_ISO, NOW_ISO),
        ))

    # 11) Cumsum tracker — one for the failed creatinine PT signal
    cur.execute("SELECT id FROM cumsum_trackers WHERE user_id=? AND analyte=?", (USER_ID, "Creatinine"))
    if not cur.fetchone():
        ops.append(Op(
            "cumsum_trackers",
            "INSERT INTO cumsum_trackers (user_id, instrument_name, analyte, created_at) VALUES (?,?,?,?)",
            (USER_ID, "Beckman AU480", "Creatinine", NOW_ISO),
        ))

    # 12) Update existing scan #4 — fill more items so it looks alive.
    # We fetch unassessed items and update a sampled subset to a target mix.
    cur.execute(f"SELECT item_id FROM veritascan_items WHERE scan_id=? AND status='Not Assessed' ORDER BY item_id", (SCAN_FILLS_ID,))
    unassessed = [r[0] for r in cur.fetchall()]
    needed = sum(SCAN_FILL_COUNTS.values())
    pick = unassessed[:needed]
    # build a deterministic status assignment
    statuses = (
        ["Compliant"] * SCAN_FILL_COUNTS["Compliant"] +
        ["Needs Attention"] * SCAN_FILL_COUNTS["Needs Attention"] +
        ["Immediate Action"] * SCAN_FILL_COUNTS["Immediate Action"] +
        ["N/A"] * SCAN_FILL_COUNTS["N/A"]
    )
    for item_id, status in zip(pick, statuses):
        owner = "Michael Veri" if status in ("Immediate Action",) else \
                ("Lisa Veri" if status == "Needs Attention" else "")
        due = days_ahead(14) if status == "Immediate Action" else (days_ahead(60) if status == "Needs Attention" else "")
        notes = SEED_TAG if status not in ("Compliant",) else ""
        ops.append(Op(
            f"veritascan_items:scan{SCAN_FILLS_ID}",
            "UPDATE veritascan_items SET status=?, owner=?, due_date=?, notes=? WHERE scan_id=? AND item_id=?",
            (status, owner, due, notes, SCAN_FILLS_ID, item_id),
        ))

    return ops

def wipe(con):
    cur = con.cursor()
    print(f"WIPING SEED ROWS tagged with: {SEED_TAG}")
    targets = [
        ("staff_employees", "qualifications_text"),
        ("competency_employees", "title"),  # No notes field; skip — wipe by name list instead
    ]
    # Conservative: by tag in notes columns
    notes_tables = [
        "lab_certificates", "veritapolicy_lab_policies", "veritapolicy_requirement_status",
        "pt_events", "inventory_items", "veritamap_tests",
    ]
    for t in notes_tables:
        try:
            r = cur.execute(f"DELETE FROM {t} WHERE user_id=? AND notes LIKE ?", (USER_ID, f"%{SEED_TAG}%"))
            print(f"  {t}: deleted {r.rowcount}")
        except Exception as e:
            print(f"  {t}: SKIP ({e})")
    con.commit()

if __name__ == "__main__":
    main()
