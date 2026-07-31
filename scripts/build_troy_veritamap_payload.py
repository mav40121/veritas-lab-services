#!/usr/bin/env python3
"""
build_troy_veritamap_payload.py

Builds the /api/admin/veritamap/seed-map payload for Troy Regional Medical
Center (map 77, lab 17) from Rachel Hermosilla's Laboratory_Test_Menu_Tracker.xlsx.

Each sheet is one specialty area; the "Machine / Method" column is the
instrument. Tests are grouped by instrument name; each test carries the
specialty (from the sheet) and the lab-stated CLIA complexity (from the row).
Complexity is NEVER defaulted: a row whose complexity does not map to
WAIVED/MODERATE/HIGH is reported as an error and the payload is not emitted.

Writes payload JSON to the path given as argv[1]. Prints a summary.
Secrets are NOT handled here; the POST is done separately with the admin secret
pulled from Railway env at call time.
"""
import sys, json, openpyxl

SRC = r"C:\Users\veril\Downloads\Laboratory_Test_Menu_Tracker.xlsx"
OUT = sys.argv[1] if len(sys.argv) > 1 else "troy_seedmap_payload.json"

# Sheet name -> canonical VeritaMap specialty (matches server CFR_MAP keys).
SHEET_SPECIALTY = {
    "Chemistry 1": "General Chemistry",
    "Chemistry 2": "General Chemistry",
    "Hematology 1": "Hematology",
    "Hematology (2)": "Hematology",
    "Coagulation": "Coagulation",
    "Coagulation (2)": "Coagulation",
    "Microscopy": "Urinalysis",
    "Microscopy (2)": "Urinalysis",
    "Blood Bank": "Immunohematology",
    "Microbiology": "Microbiology",
}

# Director determination for rows the tracker left blank on complexity. This
# is NOT a default: it records Michael Veri's 2026-07-31 call that Troy's
# manual Hematology blood-smear reviews (interpretive differential / morphology
# / platelet estimate) are HIGH complexity under CLIA. Keyed (sheet, analyte).
DIRECTOR_COMPLEXITY_OVERRIDE = {
    ("Hematology (2)", "Differential Count (Blood Smear)"): "HIGH",
    ("Hematology (2)", "Platelet Estimate (Blood Smear)"): "HIGH",
    ("Hematology (2)", "RBC Morphology (Blood Smear)"): "HIGH",
}

def map_complexity(raw):
    s = str(raw or "").strip().lower()
    if "waiv" in s: return "WAIVED"
    if "high" in s: return "HIGH"
    if "moderate" in s: return "MODERATE"
    return None

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)

# instrument name -> {"serialNumber": str|None, "tests": {analyte: {specialty, complexity}}}
instruments = {}
errors = []            # hard errors (no machine / unmapped sheet) -> block
needs_complexity = []  # blank complexity -> director call, skipped from payload
raw_rows = 0

for ws in wb.worksheets:
    specialty = SHEET_SPECIALTY.get(ws.title)
    if specialty is None:
        errors.append(f"UNMAPPED SHEET: {ws.title}")
        continue
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    # header is at row index 3 (Test/Analyte, Machine/Method, Serial Number, CLIA Complexity, Proficiency)
    for r in rows[4:]:
        if not r or len(r) < 4:
            continue
        analyte = str(r[0]).strip() if r[0] not in (None, "") else ""
        machine = str(r[1]).strip() if r[1] not in (None, "") else ""
        serial = str(r[2]).strip() if r[2] not in (None, "") and str(r[2]).strip().lower() != "none" else None
        cx_raw = r[3]
        if not analyte:
            continue
        raw_rows += 1
        if not machine:
            errors.append(f"[{ws.title}] '{analyte}' has no Machine/Method")
            continue
        cx = map_complexity(cx_raw)
        if cx is None:
            # Blank / unmappable complexity is a DIRECTOR call, never defaulted.
            # Apply an explicit director determination if one is on record;
            # otherwise surface the row for sign-off and skip it.
            cx = DIRECTOR_COMPLEXITY_OVERRIDE.get((ws.title, analyte))
        if cx is None:
            needs_complexity.append(f"[{ws.title}] '{analyte}' on '{machine}' (stated: {cx_raw!r})")
            continue
        inst = instruments.setdefault(machine, {"serialNumber": None, "tests": {}})
        if serial and not inst["serialNumber"]:
            inst["serialNumber"] = serial
        # dedupe by analyte per instrument (first wins)
        if analyte not in inst["tests"]:
            inst["tests"][analyte] = {"analyte": analyte, "specialty": specialty, "complexity": cx}

# Build ordered payload
payload_instruments = []
for name, data in instruments.items():
    payload_instruments.append({
        "name": name,
        "serialNumber": data["serialNumber"],
        "tests": list(data["tests"].values()),
    })

total_tests = sum(len(i["tests"]) for i in payload_instruments)

print("=== Troy VeritaMap seed payload ===")
print(f"raw data rows read: {raw_rows}")
print(f"instruments: {len(payload_instruments)}")
print(f"total tests (deduped per instrument): {total_tests}")
print()
# complexity distribution
from collections import Counter
cxc = Counter(t["complexity"] for i in payload_instruments for t in i["tests"])
spc = Counter(t["specialty"] for i in payload_instruments for t in i["tests"])
print("complexity:", dict(cxc))
print("specialty :", dict(spc))
print()
for i in payload_instruments:
    print(f"  {i['name']}  (serial={i['serialNumber']})  -> {len(i['tests'])} tests  [{i['tests'][0]['specialty']}]")

if needs_complexity:
    print("\n*** NEEDS DIRECTOR COMPLEXITY (excluded from payload, add after sign-off) ***")
    for e in needs_complexity:
        print("  ", e)

if errors:
    print("\n!!! HARD ERRORS (payload NOT written) !!!")
    for e in errors:
        print("  ", e)
    sys.exit(1)

with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"mapId": 77, "defaultActive": 1, "instruments": payload_instruments}, f, indent=1)
print(f"\nwrote payload -> {OUT}  ({total_tests} tests, {len(payload_instruments)} instruments)")
