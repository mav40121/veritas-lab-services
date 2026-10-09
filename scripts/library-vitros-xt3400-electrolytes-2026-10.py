"""BUG-005 (2026-10-09), part 1: VeritaMap instrument library.

1. ADD "Ortho VITROS XT 3400" from the FDA CLIA database (accessdata.fda.gov
   cfCLIA results.cfm, Test_System_Name "VITROS XT 3400", fetched 2026-10-09 and
   parsed cell by cell): 47 records, all MODERATE, test system "Ortho Clinical
   Diagnostics VITROS XT 3400 Chemistry System" (documents CR200111 / CR200364 /
   CR210390). Source rows are committed at scripts/data/fda_clia_vitros_xt3400_2026-10-09.json.
   Analyte names are the FDA's own; complexity is the FDA categorization, never inferred.
2. RETURN ELECTROLYTES TO GENERAL CHEMISTRY (Michael, 2026-10-09: "We separated
   electrolytes from general chemistry at the time of creation. Now I see that that
   causes more problems than it solves."). The 2026-03-29 split (89333b03) filed
   calcium, phosphorus, sodium, potassium, magnesium, chloride and total CO2 under an
   "Electrolytes" specialty on some entries but not others, which is why the VITROS
   4600's Electrolytes group showed 2 tests while its sodium/potassium/chloride sat
   in General Chemistry. Every "Electrolytes" test in the library becomes "General
   Chemistry". Specialty label only: names and complexity are unchanged.
The VITROS 4600 entry's own menu is NOT rebuilt here (separate change, sourced
from the FDA CLIA data).

Usage: python scripts/library-vitros-xt3400-electrolytes-2026-10.py [--verify]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_vitros_xt3400_2026-10-09.json")
KEY = "Ortho VITROS XT 3400"
FDA_SPECIALTY = {"General Chemistry": "General Chemistry", "Toxicology / TDM": "Toxicology", "General Immunology": "General Immunology"}


def build_xt3400(rows):
    tests = {}
    for r in rows:
        name = r["analyte"].strip()
        cx = r["complexity"].upper()
        assert cx in ("WAIVED", "MODERATE", "HIGH"), r
        if name in tests:
            assert tests[name]["complexity"] == cx, ("conflicting FDA complexity", name)
            continue
        tests[name] = {"complexity": cx, "specialty": FDA_SPECIALTY[r["specialty"]]}
    return {"vendor": "QuidelOrtho", "category": "Chemistry", "testCount": len(tests), "tests": tests, "menuLastVerifiedAt": "2026-10-09"}


def apply(lib, rows):
    merged = {}
    for name, entry in lib.items():
        n = 0
        for t in entry["tests"].values():
            if t.get("specialty") == "Electrolytes":
                t["specialty"] = "General Chemistry"
                n += 1
        if n:
            merged[name] = n
    lib[KEY] = build_xt3400(rows)
    return merged


def verify(lib, rows):
    fails = 0
    def check(label, ok, detail=""):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), label, detail)
        fails += 0 if ok else 1
    left = [(n, a) for n, e in lib.items() for a, t in e["tests"].items() if t.get("specialty") == "Electrolytes"]
    check("no library test is filed under Electrolytes", not left, str(left[:5]))
    e = lib.get(KEY)
    check("XT 3400 entry exists", e is not None)
    if e:
        fda = {r["analyte"].strip(): r["complexity"].upper() for r in rows}
        check("XT 3400 has every FDA record (47)", set(e["tests"]) == set(fda), f"{len(e['tests'])} tests")
        check("XT 3400 complexity equals the FDA value for every test", all(e["tests"][a]["complexity"] == c for a, c in fda.items()))
        lytes = ["Sodium", "Potassium", "Chloride", "Calcium, total", "Carbon dioxide, total (CO2)", "Magnesium", "Phosphorus"]
        check("XT 3400 electrolytes are under General Chemistry", all(e["tests"][a]["specialty"] == "General Chemistry" for a in lytes))
        check("XT 3400 testCount matches", e["testCount"] == len(e["tests"]))
    print("ALL PASS" if fails == 0 else f"{fails} FAILURE(S)")
    return fails


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    lib = json.load(open(LIB, encoding="utf-8"))
    if "--verify" in sys.argv:
        sys.exit(1 if verify(lib, rows) else 0)
    # Guard: apart from the new entry, only specialty labels may change.
    def shape(l):
        return {n: {a: (t.get("complexity"), t.get("specialty") if t.get("specialty") != "Electrolytes" else "General Chemistry") for a, t in e["tests"].items()} for n, e in l.items() if n != KEY}
    expected = shape(lib)
    merged = apply(lib, rows)
    assert shape(lib) == expected, "something other than the Electrolytes label changed"
    with open(LIB, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"added {KEY} with {lib[KEY]['testCount']} tests; Electrolytes -> General Chemistry in {len(merged)} entries ({sum(merged.values())} tests)")


if __name__ == "__main__":
    main()
