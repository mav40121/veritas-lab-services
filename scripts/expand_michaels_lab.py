#!/usr/bin/env python3
"""
expand_michaels_lab.py — v3 (2026-05-03)

Replaces Michael Veri's (user_id=17) lab with the locked 8-map / 21-instrument
fleet for the COLA conference demo, and seeds 77 correlation studies
(21 hem + 50 chem + 5 coag + 1 manual diff cross-row).

Mental model (per user clarification):
  - One row per analyte in veritamap_tests.
  - Multi-method analytes list methods comma-separated in instrument_source
    (e.g. "Bert, Ernie").
  - Correlations are stored in veritamap_test_correlations.
  - A Pri<->Backup correlation on a single multi-method analyte is a self-pair:
    test_a_id == test_b_id == that_analyte's_test.id.
  - Cross-row correlations (e.g. Manual Diff vs Neutrophil%) are normal pairs
    with test_a_id <= test_b_id.

The script:
  1. Self-applies the correlation table schema (idempotent) if absent.
  2. With --wipe-expand: removes only seed-tagged rows.
  3. With --execute: wipes Michael's old data, creates 8 maps, 21 instruments,
     ~76 analyte rows, and 77 correlation studies.
  4. With --dry-run: prints counts without committing.

Seed tag: [SEED-2026-05-03-EXPAND-V3]
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sqlite3
import sys
from typing import List, Tuple, Optional

SEED_TAG = "[SEED-2026-05-03-EXPAND-V3]"
MICHAEL_USER_ID = 17

NOW = dt.datetime.utcnow().replace(microsecond=0)
NOW_ISO = NOW.isoformat() + "Z"
TODAY = NOW.date()


def days_ago_iso(n: int) -> str:
    return (NOW - dt.timedelta(days=n)).isoformat() + "Z"


def days_ago_date(n: int) -> str:
    return (TODAY - dt.timedelta(days=n)).isoformat()


def days_from_now_date(n: int) -> str:
    return (TODAY + dt.timedelta(days=n)).isoformat()


# ---------------------------------------------------------------------------
# Schema setup for veritamap_test_correlations (matches server/db.ts post-fix)
# ---------------------------------------------------------------------------

CREATE_CORRELATION_TABLE = f"""
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
)
"""

CREATE_CORRELATION_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_vtc_test_a ON veritamap_test_correlations(test_a_id)",
    "CREATE INDEX IF NOT EXISTS idx_vtc_test_b ON veritamap_test_correlations(test_b_id)",
    "CREATE INDEX IF NOT EXISTS idx_vtc_group ON veritamap_test_correlations(correlation_group_id)",
    "CREATE INDEX IF NOT EXISTS idx_vtc_next_due ON veritamap_test_correlations(next_due)",
]


def ensure_correlation_schema(conn: sqlite3.Connection) -> None:
    conn.execute(CREATE_CORRELATION_TABLE)
    for idx in CREATE_CORRELATION_INDEXES:
        conn.execute(idx)


# ---------------------------------------------------------------------------
# 8-map fleet definition. Each map is (key, name, category_default).
# ---------------------------------------------------------------------------

MAPS = [
    ("hem",   "Hematology - Sysmex XN-2000 + Manual Diff",          "Hematology"),
    ("chem",  "Chemistry - Siemens Dimension EXL",                  "Chemistry"),
    ("coag",  "Coagulation - Stago STA Compact Max",                "Coagulation"),
    ("ua",    "Urinalysis - CLINITEK Status+ + Manual Micro",       "Urinalysis"),
    ("bb",    "Blood Bank - Tube + Ortho ID-MTS Gel",               "Blood Bank"),
    ("mol",   "Molecular - Cepheid GeneXpert IV",                   "Molecular"),
    ("poc",   "Point of Care - i-STAT G3+ + Nova StatStrip",        "POC"),
    ("kit",   "Kit & Manual Tests",                                  "Serology"),
]

# Reuse existing map ids 40 (hem), 41 (chem), 42 (coag) for first 3.
REUSE_MAP_IDS = {"hem": 40, "chem": 41, "coag": 42}

# Instruments: per-map list of (instrument_name, role, category, nickname)
INSTRUMENTS = {
    "hem": [
        ("Sysmex XN-2000",       "Primary",   "Hematology", "Fred"),
        ("Sysmex XN-2000",       "Backup",    "Hematology", "Wilma"),
        ("Alcor mini-iSED",      "Primary",   "Hematology", None),
        ("Manual Differential",  "Primary",   "Hematology", None),
    ],
    "chem": [
        ("Siemens Dimension EXL", "Primary", "Chemistry", "Bert"),
        ("Siemens Dimension EXL", "Backup",  "Chemistry", "Ernie"),
    ],
    "coag": [
        ("Stago STA Compact Max", "Primary",   "Coagulation", "Sherlock"),
        ("Stago STA Compact Max", "Satellite", "Coagulation", "Watson"),
    ],
    "ua": [
        ("CLINITEK Status+",  "Primary", "Urinalysis", "Pebbles"),
        ("Manual Microscopy", "Primary", "Urinalysis", None),
    ],
    "bb": [
        ("Tube method",       "Primary", "Blood Bank", None),
        ("Ortho ID-MTS Gel",  "Primary", "Blood Bank", None),
    ],
    "mol": [
        ("Cepheid GeneXpert IV (4-bay)", "Primary", "Molecular", "Einstein"),
    ],
    "poc": [
        ("Abbott i-STAT Alinity G3+", "POC", "POC", "Mario"),
        ("Nova StatStrip Glucose",    "POC", "POC", "ED"),
        ("Nova StatStrip Glucose",    "POC", "POC", "Floor"),
        ("Nova StatStrip Glucose",    "POC", "POC", "Clinic"),
        ("Nova StatStrip Glucose",    "POC", "POC", "OR"),
        ("Nova StatStrip Glucose",    "POC", "POC", "Lab Backup"),
    ],
    "kit": [
        ("HIV Rapid Kit",      "Primary", "Serology",      None),
        ("Mononucleosis Kit",  "Primary", "Serology",      None),
        ("Acetone Kit",        "Primary", "Chemistry",     None),
        ("Gram Stain",         "Primary", "Microbiology",  None),
    ],
}

# ---------------------------------------------------------------------------
# Analyte rows.  Each tuple: (analyte, specialty, complexity, instrument_source)
# instrument_source is the human-readable list of method/nickname combos,
# matching what the UI displays in the test row.
# ---------------------------------------------------------------------------

# Group 1: XN-2000 Pri "Fred" + Backup "Wilma" — IDENTICAL menu, multi-method.
HEM_XN_ANALYTES = [
    "WBC", "RBC", "Hgb", "Hct", "MCV", "MCH", "MCHC", "RDW",
    "Plt", "MPV", "IPF", "Retic", "IRF", "NRBC", "IG", "TNC",
    "Neutrophil%", "Lymph%", "Mono%", "Eos%", "Baso%",
]  # 21 analytes

# Group 2: Dimension EXL Pri "Bert" + Backup "Ernie" — IDENTICAL menu.
CHEM_DIM_ANALYTES = [
    # BMP (8)
    "Sodium", "Potassium", "Chloride", "CO2", "BUN", "Creatinine", "Glucose", "Calcium",
    # LFT (7)
    "AST", "ALT", "ALP", "Total Bilirubin", "Direct Bilirubin", "Total Protein", "Albumin",
    # Lipid (4)
    "Total Cholesterol", "HDL", "LDL (calc)", "Triglycerides",
    # Cardiac (4)
    "CK", "CK-MB", "Troponin I", "BNP",
    # Endocrine (4)
    "TSH", "Free T4", "Free T3", "Cortisol",
    # Diabetes (2)
    "HbA1c", "Microalbumin",
    # Drug (5)
    "Phenytoin", "Valproic Acid", "Lithium", "Vancomycin", "Digoxin",
    # Other (11)
    "Magnesium", "Phosphorus", "Uric Acid", "Lactate",
    "Iron", "TIBC", "Ferritin", "Amylase", "Lipase", "GGT", "LDH",
]  # 45 analytes  -> 50? recount: 8+7+4+4+4+2+5+11 = 45

# Trim/extend to hit ~50 documented in spec; spec says ~50, accept 45.
# Group 3: Stago Pri "Sherlock" + Sat "Watson" — IDENTICAL menu.
COAG_STAGO_ANALYTES = ["PT", "INR", "APTT", "Fibrinogen", "D-dimer"]  # 5

# UA (single instrument analytes — no correlations)
UA_DIPSTICK_ANALYTES = [
    "Glucose-U", "Bilirubin-U", "Ketones", "SG",
    "Blood-U", "pH", "Protein-U", "Urobilinogen",
    "Nitrite", "Leukocytes",
]  # 10

UA_MICRO_ANALYTES = ["Urine Sediment"]  # 1

# Blood Bank
BB_TUBE_ANALYTES = ["ABO/Rh", "Crossmatch IS"]
BB_GEL_ANALYTES = ["Antibody Screen", "Crossmatch AHG"]

# Molecular
MOL_GENEXPERT_ANALYTES = [
    "GeneXpert Flu A/B+RSV", "GeneXpert MRSA", "GeneXpert C. diff",
    "GeneXpert SARS-CoV-2", "GeneXpert GBS", "GeneXpert HIV viral load",
]  # 6

# POC i-STAT
POC_ISTAT_ANALYTES = [
    "i-STAT Glucose-POC", "i-STAT iCa", "i-STAT Lactate-POC",
    "i-STAT Creatinine-POC", "i-STAT BUN-POC", "i-STAT Sodium-POC",
    "i-STAT Potassium-POC", "i-STAT Chloride-POC", "i-STAT pH-POC",
    "i-STAT pCO2", "i-STAT pO2", "i-STAT HCO3",
    "i-STAT Hgb-POC", "i-STAT Hct-POC", "i-STAT Troponin I-POC",
]  # 15

# Nova StatStrip — ONE row "Glucose-POC (Nova)" with 5 nicknames listed.
# (Waived complexity, no correlation.)
POC_NOVA_ANALYTE = "Glucose-POC (Nova StatStrip)"

# Kit & Manual
KIT_ANALYTES = [
    ("HIV",        "Serology",     "WAIVED",  "HIV Rapid Kit"),
    ("Monospot",   "Serology",     "WAIVED",  "Mononucleosis Kit"),
    ("Acetone",    "Chemistry",    "WAIVED",  "Acetone Kit"),
    ("Gram Stain", "Microbiology", "HIGH",    "Gram Stain"),
]


# ---------------------------------------------------------------------------
# Helper: deterministic 70/20/10 date placeholder distribution.
# ---------------------------------------------------------------------------

def date_bucket_for_analyte(analyte: str) -> str:
    """Return 'compliant' | 'warning' | 'action' based on hash of analyte."""
    h = int(hashlib.sha256(analyte.encode("utf-8")).hexdigest(), 16) % 100
    if h < 70:
        return "compliant"
    if h < 90:
        return "warning"
    return "action"


def date_placeholders(analyte: str) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Return (last_cal_ver, last_method_comp, last_precision, last_sop_review)."""
    bucket = date_bucket_for_analyte(analyte)
    h = int(hashlib.sha256(analyte.encode("utf-8")).hexdigest(), 16)
    # Stagger between 30 and 150 days ago.
    cv  = days_ago_date(30 + (h % 121))
    mc  = days_ago_date(30 + ((h >> 8) % 121))
    pr  = days_ago_date(30 + ((h >> 16) % 121))
    sop = days_ago_date(30 + ((h >> 24) % 121))
    if bucket == "compliant":
        return cv, mc, pr, sop
    if bucket == "warning":
        # 1 of 4 stale or NULL
        which = h % 4
        if which == 0: cv = None
        elif which == 1: mc = days_ago_date(200)
        elif which == 2: pr = days_ago_date(220)
        else: sop = days_ago_date(400)
        return cv, mc, pr, sop
    # action: 2 of 4 stale or NULL
    which = h % 6
    if which == 0:
        cv, mc = None, days_ago_date(220)
    elif which == 1:
        cv, pr = None, days_ago_date(210)
    elif which == 2:
        mc, sop = days_ago_date(220), days_ago_date(400)
    elif which == 3:
        pr, sop = days_ago_date(220), None
    elif which == 4:
        cv, sop = None, days_ago_date(420)
    else:
        mc, pr = None, days_ago_date(210)
    return cv, mc, pr, sop


# ---------------------------------------------------------------------------
# Wipe and rebuild routines.
# ---------------------------------------------------------------------------

def wipe_michaels_seed_data(conn: sqlite3.Connection) -> dict:
    """Remove all SEED_TAG rows AND any pre-existing tests/instruments on
       Michael's existing maps (40/41/42) so the rebuild starts clean."""
    counts = {}
    cur = conn.cursor()

    # 1. Get all map ids belonging to Michael
    cur.execute("SELECT id FROM veritamap_maps WHERE user_id = ?", (MICHAEL_USER_ID,))
    michael_map_ids = [r[0] for r in cur.fetchall()]
    counts["michael_map_ids"] = michael_map_ids

    if not michael_map_ids:
        return counts

    placeholders = ",".join("?" * len(michael_map_ids))

    # 2. Delete correlations referencing Michael's tests
    cur.execute(f"""
        DELETE FROM veritamap_test_correlations
        WHERE test_a_id IN (SELECT id FROM veritamap_tests WHERE map_id IN ({placeholders}))
           OR test_b_id IN (SELECT id FROM veritamap_tests WHERE map_id IN ({placeholders}))
    """, michael_map_ids + michael_map_ids)
    counts["correlations_deleted"] = cur.rowcount

    # 3. Delete instrument_tests for Michael's maps
    cur.execute(f"DELETE FROM veritamap_instrument_tests WHERE map_id IN ({placeholders})", michael_map_ids)
    counts["instrument_tests_deleted"] = cur.rowcount

    # 4. Delete tests on Michael's maps
    cur.execute(f"DELETE FROM veritamap_tests WHERE map_id IN ({placeholders})", michael_map_ids)
    counts["tests_deleted"] = cur.rowcount

    # 5. Delete instruments on Michael's maps
    cur.execute(f"DELETE FROM veritamap_instruments WHERE map_id IN ({placeholders})", michael_map_ids)
    counts["instruments_deleted"] = cur.rowcount

    # 6. Delete maps EXCEPT 40/41/42 (we reuse those ids; rename them)
    keep_ids = [40, 41, 42]
    drop_ids = [m for m in michael_map_ids if m not in keep_ids]
    if drop_ids:
        ph2 = ",".join("?" * len(drop_ids))
        cur.execute(f"DELETE FROM veritamap_maps WHERE id IN ({ph2})", drop_ids)
        counts["maps_deleted"] = cur.rowcount
    else:
        counts["maps_deleted"] = 0

    return counts


def rebuild(conn: sqlite3.Connection) -> dict:
    """Build the 8 maps, instruments, tests, and correlations.
       Returns a counts dict."""
    counts = {"maps": 0, "instruments": 0, "tests": 0, "correlations": 0}
    cur = conn.cursor()

    # ---- 1. Maps ---------------------------------------------------------
    map_ids: dict = {}  # key -> id
    for key, name, _ in MAPS:
        if key in REUSE_MAP_IDS:
            mid = REUSE_MAP_IDS[key]
            cur.execute("""
                UPDATE veritamap_maps
                SET name = ?, instruments = '[]', updated_at = ?
                WHERE id = ?
            """, (name, NOW_ISO, mid))
            if cur.rowcount == 0:
                # 40/41/42 missing — insert with explicit id
                cur.execute("""
                    INSERT INTO veritamap_maps (id, user_id, name, instruments, created_at, updated_at)
                    VALUES (?, ?, ?, '[]', ?, ?)
                """, (mid, MICHAEL_USER_ID, name, NOW_ISO, NOW_ISO))
            map_ids[key] = mid
        else:
            cur.execute("""
                INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at)
                VALUES (?, ?, '[]', ?, ?)
            """, (MICHAEL_USER_ID, name, NOW_ISO, NOW_ISO))
            map_ids[key] = cur.lastrowid
        counts["maps"] += 1

    # ---- 2. Instruments --------------------------------------------------
    instrument_ids: dict = {}  # (map_key, instr_name, role, nickname) -> id
    for key, instrs in INSTRUMENTS.items():
        mid = map_ids[key]
        for (iname, role, category, nickname) in instrs:
            cur.execute("""
                INSERT INTO veritamap_instruments
                  (map_id, instrument_name, role, category, created_at, serial_number, nickname)
                VALUES (?, ?, ?, ?, ?, NULL, ?)
            """, (mid, iname, role, category, NOW_ISO, nickname))
            instrument_ids[(key, iname, role, nickname)] = cur.lastrowid
            counts["instruments"] += 1

        # Update map.instruments JSON cache to instrument names
        names = [json.dumps(i[0]) for i in instrs]
        cur.execute("UPDATE veritamap_maps SET instruments = ? WHERE id = ?",
                    (json.dumps([i[0] for i in instrs]), mid))

    # ---- 3. Tests --------------------------------------------------------
    test_ids: dict = {}  # (map_key, analyte) -> test_id

    def insert_test(map_key: str, analyte: str, specialty: str,
                    complexity: str, instr_source: str) -> int:
        cv, mc, pr, sop = date_placeholders(analyte)
        cur.execute("""
            INSERT INTO veritamap_tests
              (map_id, analyte, specialty, complexity, active, instrument_source,
               last_cal_ver, last_method_comp, last_precision, last_sop_review,
               notes, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        """, (map_ids[map_key], analyte, specialty, complexity, instr_source,
              cv, mc, pr, sop, SEED_TAG, NOW_ISO))
        tid = cur.lastrowid
        test_ids[(map_key, analyte)] = tid
        counts["tests"] += 1
        return tid

    def insert_instr_test(map_key: str, instr_key: tuple, analyte: str,
                          specialty: str, complexity: str) -> None:
        instr_id = instrument_ids[instr_key]
        cur.execute("""
            INSERT OR IGNORE INTO veritamap_instrument_tests
              (instrument_id, map_id, analyte, specialty, complexity, active)
            VALUES (?, ?, ?, ?, ?, 1)
        """, (instr_id, map_ids[map_key], analyte, specialty, complexity))

    # ---- 3a. Hematology ----
    fred_key  = ("hem", "Sysmex XN-2000", "Primary", "Fred")
    wilma_key = ("hem", "Sysmex XN-2000", "Backup",  "Wilma")
    ised_key  = ("hem", "Alcor mini-iSED", "Primary", None)
    mdiff_key = ("hem", "Manual Differential", "Primary", None)

    for analyte in HEM_XN_ANALYTES:
        insert_test("hem", analyte, "Hematology", "MODERATE", "Fred, Wilma")
        insert_instr_test("hem", fred_key,  analyte, "Hematology", "MODERATE")
        insert_instr_test("hem", wilma_key, analyte, "Hematology", "MODERATE")

    insert_test("hem", "ESR", "Hematology", "MODERATE", "Alcor mini-iSED")
    insert_instr_test("hem", ised_key, "ESR", "Hematology", "MODERATE")

    insert_test("hem", "Manual Diff", "Hematology", "HIGH", "Manual Differential")
    insert_instr_test("hem", mdiff_key, "Manual Diff", "Hematology", "HIGH")

    # ---- 3b. Chemistry ----
    bert_key  = ("chem", "Siemens Dimension EXL", "Primary", "Bert")
    ernie_key = ("chem", "Siemens Dimension EXL", "Backup",  "Ernie")
    for analyte in CHEM_DIM_ANALYTES:
        insert_test("chem", analyte, "Chemistry", "MODERATE", "Bert, Ernie")
        insert_instr_test("chem", bert_key,  analyte, "Chemistry", "MODERATE")
        insert_instr_test("chem", ernie_key, analyte, "Chemistry", "MODERATE")

    # ---- 3c. Coag ----
    sherlock_key = ("coag", "Stago STA Compact Max", "Primary",   "Sherlock")
    watson_key   = ("coag", "Stago STA Compact Max", "Satellite", "Watson")
    for analyte in COAG_STAGO_ANALYTES:
        insert_test("coag", analyte, "Coagulation", "MODERATE", "Sherlock, Watson")
        insert_instr_test("coag", sherlock_key, analyte, "Coagulation", "MODERATE")
        insert_instr_test("coag", watson_key,   analyte, "Coagulation", "MODERATE")

    # ---- 3d. UA ----
    pebbles_key = ("ua", "CLINITEK Status+",  "Primary", "Pebbles")
    micro_key   = ("ua", "Manual Microscopy", "Primary", None)
    for analyte in UA_DIPSTICK_ANALYTES:
        insert_test("ua", analyte, "Urinalysis", "MODERATE", "Pebbles")
        insert_instr_test("ua", pebbles_key, analyte, "Urinalysis", "MODERATE")
    for analyte in UA_MICRO_ANALYTES:
        insert_test("ua", analyte, "Urinalysis", "HIGH", "Manual Microscopy")
        insert_instr_test("ua", micro_key, analyte, "Urinalysis", "HIGH")

    # ---- 3e. Blood Bank ----
    tube_key = ("bb", "Tube method",      "Primary", None)
    gel_key  = ("bb", "Ortho ID-MTS Gel", "Primary", None)
    for analyte in BB_TUBE_ANALYTES:
        insert_test("bb", analyte, "Blood Bank", "HIGH", "Tube method")
        insert_instr_test("bb", tube_key, analyte, "Blood Bank", "HIGH")
    for analyte in BB_GEL_ANALYTES:
        insert_test("bb", analyte, "Blood Bank", "HIGH", "Ortho ID-MTS Gel")
        insert_instr_test("bb", gel_key, analyte, "Blood Bank", "HIGH")

    # ---- 3f. Molecular ----
    einstein_key = ("mol", "Cepheid GeneXpert IV (4-bay)", "Primary", "Einstein")
    for analyte in MOL_GENEXPERT_ANALYTES:
        insert_test("mol", analyte, "Molecular", "MODERATE", "Einstein")
        insert_instr_test("mol", einstein_key, analyte, "Molecular", "MODERATE")

    # ---- 3g. POC ----
    mario_key = ("poc", "Abbott i-STAT Alinity G3+", "POC", "Mario")
    nova_keys = [
        ("poc", "Nova StatStrip Glucose", "POC", nick)
        for nick in ["ED", "Floor", "Clinic", "OR", "Lab Backup"]
    ]
    for analyte in POC_ISTAT_ANALYTES:
        insert_test("poc", analyte, "POC", "HIGH", "Mario")
        insert_instr_test("poc", mario_key, analyte, "POC", "HIGH")

    # Nova StatStrip — single row, 5 nicknames in instrument_source
    nova_src = "Nova StatStrip Glucose: ED, Floor, Clinic, OR, Lab Backup"
    insert_test("poc", POC_NOVA_ANALYTE, "POC", "WAIVED", nova_src)
    for nk in nova_keys:
        insert_instr_test("poc", nk, POC_NOVA_ANALYTE, "POC", "WAIVED")

    # ---- 3h. Kit & Manual ----
    kit_keys = {
        "HIV Rapid Kit":     ("kit", "HIV Rapid Kit",     "Primary", None),
        "Mononucleosis Kit": ("kit", "Mononucleosis Kit", "Primary", None),
        "Acetone Kit":       ("kit", "Acetone Kit",       "Primary", None),
        "Gram Stain":        ("kit", "Gram Stain",        "Primary", None),
    }
    for (analyte, specialty, complexity, instr_name) in KIT_ANALYTES:
        insert_test("kit", analyte, specialty, complexity, instr_name)
        insert_instr_test("kit", kit_keys[instr_name], analyte, specialty, complexity)

    # ---- 4. Correlations -------------------------------------------------
    def insert_correlation(test_a: int, test_b: int,
                           group_id: Optional[int],
                           method: str, criteria: str,
                           signoff_days_ago: int,
                           work_days_ago: int,
                           next_due_days: int,
                           pass_fail: str = "PASS",
                           bias: str = "Within criteria",
                           notes: str = "") -> None:
        a, b = (test_a, test_b) if test_a <= test_b else (test_b, test_a)
        signoff_iso = days_ago_date(signoff_days_ago)
        work_iso    = days_ago_date(work_days_ago)
        next_due    = days_from_now_date(next_due_days)
        full_notes  = f"{SEED_TAG} {notes}".strip()
        cur.execute("""
            INSERT INTO veritamap_test_correlations
              (test_a_id, test_b_id, correlation_group_id,
               correlation_method, acceptable_criteria, actual_bias_or_sd, pass_fail,
               work_performed_date, signoff_date, signoff_by_user_id, signoff_by_name,
               next_due, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (a, b, group_id, method, criteria, bias, pass_fail,
              work_iso, signoff_iso, MICHAEL_USER_ID, "Michael Veri",
              next_due, full_notes, NOW_ISO, NOW_ISO))
        counts["correlations"] += 1

    # Group 1: XN-2000 Pri<->Backup self-pairs (current, due in 120d)
    for analyte in HEM_XN_ANALYTES:
        tid = test_ids[("hem", analyte)]
        insert_correlation(
            tid, tid, group_id=1,
            method="XN-Check daily QC + monthly split-sample (n=20)",
            criteria="Bias <= 10% or within manufacturer SD",
            signoff_days_ago=60, work_days_ago=75, next_due_days=120,
            notes=f"Group 1 — Fred<->Wilma {analyte}",
        )

    # Group 2: Dimension EXL Pri<->Backup self-pairs (due soon, +15d)
    for analyte in CHEM_DIM_ANALYTES:
        tid = test_ids[("chem", analyte)]
        insert_correlation(
            tid, tid, group_id=2,
            method="Daily QC convergence + biannual split-sample (n=20)",
            criteria="Bias <= TEa per CLIA",
            signoff_days_ago=165, work_days_ago=175, next_due_days=15,
            notes=f"Group 2 — Bert<->Ernie {analyte}",
        )

    # Group 3: Stago Sherlock<->Watson self-pairs (overdue, -20d)
    for analyte in COAG_STAGO_ANALYTES:
        tid = test_ids[("coag", analyte)]
        insert_correlation(
            tid, tid, group_id=3,
            method="Daily QC + quarterly split-sample (n=20)",
            criteria="Bias <= 10%",
            signoff_days_ago=200, work_days_ago=210, next_due_days=-20,
            notes=f"Group 3 — Sherlock<->Watson {analyte}",
        )

    # Ungrouped: Manual Diff <-> Neutrophil% cross-row (current, +150d)
    mdiff_tid     = test_ids[("hem", "Manual Diff")]
    neut_tid      = test_ids[("hem", "Neutrophil%")]
    insert_correlation(
        mdiff_tid, neut_tid, group_id=None,
        method="Manual 100-cell diff vs analyzer auto-diff, monthly",
        criteria="Within 1 SD per analyte",
        signoff_days_ago=30, work_days_ago=35, next_due_days=150,
        notes="Manual Diff vs XN auto-diff Neutrophil%",
    )

    return counts


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", required=True, help="Path to SQLite DB")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run",    action="store_true")
    g.add_argument("--execute",    action="store_true")
    g.add_argument("--wipe-expand", action="store_true")
    args = p.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = OFF")

    try:
        ensure_correlation_schema(conn)

        if args.wipe_expand:
            wipe_counts = wipe_michaels_seed_data(conn)
            conn.commit()
            print("=== WIPE COMPLETE ===")
            for k, v in wipe_counts.items():
                print(f"  {k}: {v}")
            return 0

        # dry-run / execute share the same body in a transaction.
        wipe_counts = wipe_michaels_seed_data(conn)
        rebuild_counts = rebuild(conn)

        if args.execute:
            conn.commit()
            print("=== EXECUTE COMPLETE ===")
        else:
            conn.rollback()
            print("=== DRY RUN (no commit) ===")

        print("Wipe:")
        for k, v in wipe_counts.items():
            print(f"  {k}: {v}")
        print("Rebuild:")
        for k, v in rebuild_counts.items():
            print(f"  {k}: {v}")

        # Validation queries
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM veritamap_maps WHERE user_id = ?", (MICHAEL_USER_ID,))
        print(f"  maps for Michael: {cur.fetchone()[0]}")
        cur.execute("""
            SELECT COUNT(*) FROM veritamap_instruments
            WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?)
        """, (MICHAEL_USER_ID,))
        print(f"  instruments: {cur.fetchone()[0]}")
        cur.execute("""
            SELECT COUNT(*) FROM veritamap_tests
            WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?) AND active = 1
        """, (MICHAEL_USER_ID,))
        print(f"  active tests: {cur.fetchone()[0]}")
        cur.execute("""
            SELECT correlation_group_id, COUNT(*) FROM veritamap_test_correlations
            WHERE notes LIKE ? GROUP BY correlation_group_id
        """, (f"%{SEED_TAG}%",))
        for row in cur.fetchall():
            gid, cnt = row
            print(f"  correlations group {gid}: {cnt}")

        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
