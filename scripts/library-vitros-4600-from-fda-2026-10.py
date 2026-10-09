"""BUG-005 (2026-10-09), part 2: rebuild the "Ortho VITROS 4600" library entry from
the FDA CLIA database, the library's source of truth (Michael, 2026-10-09).

Source: FDA CLIA download file clia_detail.zip
  https://www.accessdata.fda.gov/premarket/ftparea/clia_detail.zip
  (linked from https://www.fda.gov/medical-devices/medical-device-databases/clinical-laboratory-improvement-amendments-download-data),
  downloaded 2026-10-09, 80,999 records. Every record whose TEST_SYSTEM_NAME contains
  "VITROS 4600" (both spellings: "Ortho-Clinical Diagnostics VITROS 4600 Chemistry
  System" holds Ortho's own 75-record menu, which the web search page does not
  return; "Ortho Clinical Diagnostics VITROS 4600 ..." holds 2 native records and
  the third-party reagents run on the 4600). 112 records, 101 distinct analytes, no
  analyte with conflicting complexity. Extract committed at
  scripts/data/fda_clia_vitros4600_2026-10-09.json.

Rules (same as the original March build, which used this file):
  - analyte name = FDA ANALYTE_NAME; complexity = FDA COMPLEXITY, never inferred;
  - specialty = FDA SPECIALTY_ID, mapped by the IDs confirmed against the FDA web
    page's own labels on 2026-10-09: 2 General Chemistry, 3 General Immunology,
    4 Hematology, 6 Endocrinology, 7 Toxicology (FDA "Toxicology / TDM"),
    17 Syphilis Serology. Electrolytes are General Chemistry (Michael, 2026-10-09).
The old entry (rebuilt 2026-05-07 from an uncommitted research file: all 138 tests
HIGH, no calcium, electrolytes misfiled, HIV and SARS-CoV-2 on a chemistry
analyzer) is REPLACED, not patched.

Usage: python scripts/library-vitros-4600-from-fda-2026-10.py [--verify]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_vitros4600_2026-10-09.json")
KEY = "Ortho VITROS 4600"
SPECIALTY = {"2": "General Chemistry", "3": "General Immunology", "4": "Hematology", "6": "Endocrinology", "7": "Toxicology", "17": "Syphilis Serology"}


def build(rows):
    tests = {}
    for r in rows:
        name = r["ANALYTE_NAME"].strip()
        cx = r["COMPLEXITY"].strip().upper()
        assert cx in ("WAIVED", "MODERATE", "HIGH"), r
        spec = SPECIALTY[r["SPECIALTY_ID"].strip()]
        if name in tests:
            assert tests[name]["complexity"] == cx, ("conflicting FDA complexity", name)
            continue
        tests[name] = {"complexity": cx, "specialty": spec}
    return {"vendor": "QuidelOrtho", "category": "Chemistry", "testCount": len(tests), "tests": tests, "menuLastVerifiedAt": "2026-10-09"}


def verify(lib, rows):
    fails = 0
    def check(label, ok, detail=""):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), label, detail)
        fails += 0 if ok else 1
    e = lib.get(KEY)
    fda = {}
    for r in rows:
        fda[r["ANALYTE_NAME"].strip()] = r["COMPLEXITY"].strip().upper()
    check("4600 entry exists", e is not None)
    if not e:
        return 1
    check("4600 has exactly the FDA analytes (101)", set(e["tests"]) == set(fda), f"{len(e['tests'])} tests")
    check("4600 complexity equals the FDA value for every test", all(e["tests"][a]["complexity"] == c for a, c in fda.items()))
    native = {r["ANALYTE_NAME"].strip() for r in rows if not r["QUALIFIER1"] and not r["QUALIFIER2"]}
    check("Ortho's own 4600 menu is all MODERATE", all(e["tests"][a]["complexity"] == "MODERATE" for a in native), f"{len(native)} native analytes")
    lytes = ["Sodium", "Potassium", "Chloride", "Calcium, total", "Carbon dioxide, total (CO2)", "Magnesium", "Phosphorus"]
    check("4600 has Na, K, Cl, Ca, CO2, Mg, Phos under General Chemistry", all(e["tests"].get(a, {}).get("specialty") == "General Chemistry" for a in lytes), str([a for a in lytes if a not in e["tests"]]))
    check("no HIV / SARS-CoV-2 / hepatitis tests on the 4600", not [a for a in e["tests"] if any(x in a.lower() for x in ("hiv", "sars", "hepatitis"))])
    check("testCount matches", e["testCount"] == len(e["tests"]))
    print("ALL PASS" if fails == 0 else f"{fails} FAILURE(S)")
    return fails


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    lib = json.load(open(LIB, encoding="utf-8"))
    if "--verify" in sys.argv:
        sys.exit(1 if verify(lib, rows) else 0)
    others = {n: json.dumps(v, sort_keys=True) for n, v in lib.items() if n != KEY}
    old = lib.get(KEY)
    lib[KEY] = build(rows)
    assert others == {n: json.dumps(v, sort_keys=True) for n, v in lib.items() if n != KEY}, "another entry changed"
    with open(LIB, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"replaced {KEY}: {old['testCount'] if old else 0} -> {lib[KEY]['testCount']} tests (all from FDA)")


if __name__ == "__main__":
    main()
