#!/usr/bin/env python3
"""Add urine-chemistry analytes + High Sensitivity CRP to the Siemens Atellica
catalog entries, from COPC (Michael Longstreth) feedback 2026-07-29:
  - urine chemistry menu was thin (only urine total protein + microalbumin);
    COPC runs Urine Creatinine + Urine Calcium and asked for more urine chems.
  - the catalog had one CRP; COPC runs both regular CRP and High Sensitivity CRP.

Complexity/specialty MIRROR the analyzer's existing serum versions (verified,
not inferred): Electrolytes for Ca/Mg/Na/K/Cl, General Chemistry for the rest,
General Immunology for CRP -> hs-CRP. All MODERATE, same as the Atellica menu.

Scoped to the two canonical Atellica models COPC uses (CH 930 / CI 1900). The
file round-trips byte-identically through json.dumps(indent=2), so the only diff
is the appended analytes + updated testCount. Idempotent.

Run: python scripts/add_atellica_urine_hscrp.py
"""
import io, sys, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")
MODELS = ["Siemens Atellica CH 930", "Siemens Atellica CI 1900"]

# (analyte name, specialty). All MODERATE complexity.
NEW = [
    ("Creatinine, urine", "General Chemistry"),
    ("Calcium, urine", "Electrolytes"),
    ("Glucose, urine", "General Chemistry"),
    ("Magnesium, urine", "Electrolytes"),
    ("Amylase, urine", "General Chemistry"),
    ("Sodium, urine", "Electrolytes"),
    ("Potassium, urine", "Electrolytes"),
    ("Chloride, urine", "Electrolytes"),
    ("Phosphorus, urine", "General Chemistry"),
    ("Urea nitrogen, urine", "General Chemistry"),
    ("Uric acid, urine", "General Chemistry"),
    ("C-reactive protein, high sensitivity (hs-CRP)", "General Immunology"),
]


def main():
    raw = open(PATH, encoding="utf-8").read()
    data = json.loads(raw)
    for model in MODELS:
        if model not in data:
            raise SystemExit(f"model not found: {model}")
        tests = data[model]["tests"]
        added = []
        for name, specialty in NEW:
            if name in tests:
                continue
            tests[name] = {"complexity": "MODERATE", "specialty": specialty}
            added.append(name)
        data[model]["testCount"] = len(tests)
        print(f"{model}: +{len(added)} -> testCount {data[model]['testCount']}")
        for a in added:
            print("   +", a)
    out = json.dumps(data, indent=2, ensure_ascii=False) + ("\n" if raw.endswith("\n") else "")
    open(PATH, "w", encoding="utf-8").write(out)
    print("wrote", PATH)


if __name__ == "__main__":
    main()
