"""BUG-005 (2026-10-09), part 1: VeritaMap instrument library.

1. ADD "Ortho VITROS XT 3400" from the FDA CLIA database (accessdata.fda.gov
   cfCLIA results.cfm, Test_System_Name "VITROS XT 3400", fetched 2026-10-09 and
   parsed cell by cell): 47 records, all MODERATE, test system "Ortho Clinical
   Diagnostics VITROS XT 3400 Chemistry System" (documents CR200111 / CR200364 /
   CR210390). Source rows are committed at scripts/data/fda_clia_vitros_xt3400_2026-10-09.json.
   Analyte names are the FDA's own (the vocabulary the other FDA-built entries use);
   complexity is the FDA categorization, never inferred.
2. REGROUP electrolytes on the three other entries rebuilt 2026-05-07, which filed
   them under General Chemistry: Abbott ARCHITECT c4000, Siemens ADVIA 2400,
   Siemens Dimension Vista 1000T. Specialty label only: names and complexity are
   unchanged (renaming would leave duplicates on lab maps that already saved them).
   The Electrolytes group is the 2026-03-29 rule (89333b03): calcium, phosphorus,
   sodium, potassium, magnesium, chloride, total CO2.
The VITROS 4600 entry is NOT touched here: FDA has no native record list for it
(only third-party reagents), so its source is a separate decision.

Usage: python scripts/library-vitros-xt3400-electrolytes-2026-10.py [--verify]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_vitros_xt3400_2026-10-09.json")
KEY = "Ortho VITROS XT 3400"
REGROUP = ["Abbott ARCHITECT c4000", "Siemens ADVIA 2400", "Siemens Dimension Vista 1000T"]
ELECTROLYTE_NAMES = {
    "sodium", "potassium", "chloride", "magnesium", "phosphorus",
    "calcium", "calcium, total", "carbon dioxide", "carbon dioxide, total (co2)",
}
FDA_SPECIALTY = {"General Chemistry": "General Chemistry", "Toxicology / TDM": "Toxicology", "General Immunology": "General Immunology"}


def build_xt3400(rows):
    tests = {}
    for r in rows:
        name = r["analyte"].strip()
        spec = "Electrolytes" if name.lower() in ELECTROLYTE_NAMES else FDA_SPECIALTY[r["specialty"]]
        cx = r["complexity"].upper()
        assert cx in ("WAIVED", "MODERATE", "HIGH"), r
        if name in tests:
            assert tests[name]["complexity"] == cx, ("conflicting FDA complexity", name)
            continue
        tests[name] = {"complexity": cx, "specialty": spec}
    return {"vendor": "QuidelOrtho", "category": "Chemistry", "testCount": len(tests), "tests": tests, "menuLastVerifiedAt": "2026-10-09"}


def apply(lib, rows):
    lib[KEY] = build_xt3400(rows)
    moved = {}
    for name in REGROUP:
        n = 0
        for analyte, t in lib[name]["tests"].items():
            if analyte.lower() in ELECTROLYTE_NAMES and t.get("specialty") != "Electrolytes":
                t["specialty"] = "Electrolytes"
                n += 1
        moved[name] = n
    return moved


def verify(lib, rows):
    fails = 0
    def check(label, ok, detail=""):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), label, detail)
        fails += 0 if ok else 1
    e = lib.get(KEY)
    check("XT 3400 entry exists", e is not None)
    if e:
        fda = {r["analyte"].strip(): r["complexity"].upper() for r in rows}
        check("XT 3400 has every FDA record (47)", set(e["tests"]) == set(fda), f"{len(e['tests'])} tests")
        check("XT 3400 complexity equals the FDA value for every test", all(e["tests"][a]["complexity"] == c for a, c in fda.items()))
        lytes = sorted(a for a, t in e["tests"].items() if t["specialty"] == "Electrolytes")
        check("XT 3400 electrolytes grouped (Na, K, Cl, Ca, CO2, Mg, Phos)", len(lytes) == 7, str(lytes))
        check("XT 3400 testCount matches", e["testCount"] == len(e["tests"]))
    for name in REGROUP:
        t = lib[name]["tests"]
        stray = [a for a, v in t.items() if a.lower() in ELECTROLYTE_NAMES and v["specialty"] != "Electrolytes"]
        check(f"{name}: no electrolyte left under another group", not stray, str(stray))
        check(f"{name}: has an Electrolytes group", any(v["specialty"] == "Electrolytes" for v in t.values()))
    print("ALL PASS" if fails == 0 else f"{fails} FAILURE(S)")
    return fails


def main():
    rows = json.load(open(SRC, encoding="utf-8"))
    lib = json.load(open(LIB, encoding="utf-8"))
    if "--verify" in sys.argv:
        sys.exit(1 if verify(lib, rows) else 0)
    before = {n: json.dumps(lib[n], sort_keys=True) for n in lib if n not in REGROUP and n != KEY}
    moved = apply(lib, rows)
    after = {n: json.dumps(lib[n], sort_keys=True) for n in lib if n not in REGROUP and n != KEY}
    assert before == after, "an entry outside the intended four changed"
    with open(LIB, "w", encoding="utf-8") as f:
        json.dump(lib, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("added", KEY, "with", lib[KEY]["testCount"], "tests; electrolytes regrouped:", moved)


if __name__ == "__main__":
    main()
