"""BUG-009 step 2 (2026-10-09): write FDA's menu to the 'ready' library instruments.

Michael approved (Q41 = 1, 2026-10-09): for every instrument the review report marks
'ready', add the FDA tests the library is missing and apply the complexity changes
where every FDA record agrees. Nothing else changes:
  - only instruments whose name_map bucket is "ready";
  - adds come from name_map.json "proposed_adds" (FDA analyte name, FDA complexity,
    FDA specialty); adds where FDA records disagree are held, never written;
  - complexity changes come from "proposed_complexity" (library value must still be
    the "from" value, else the script stops);
  - no library test is removed or renamed; every other instrument is untouched;
  - each written entry gets menuLastVerifiedAt = the report date.
A manifest of every change with its FDA evidence is written next to the name map.

name_map.json is produced by build_report.py from FDA clia_detail.zip; re-run that
first if the FDA file or the library changes.

Usage:
  python scripts/fda-menus/apply_ready.py            # write
  python scripts/fda-menus/apply_ready.py --verify   # check the written library
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
HERE = os.path.dirname(os.path.abspath(__file__))
NAME_MAP = os.path.join(HERE, "name_map.json")
MANIFEST = os.path.join(HERE, "applied_ready_2026-10-09.json")
VALID_CX = {"WAIVED", "MODERATE", "HIGH"}

# SAME-TEST GUARD (2026-10-09). An FDA test is never added beside a library test
# that is the same measurand under another name: the library would list it twice
# and a lab picking different names on two analyzers would miss the correlation
# (BUG-011). Two names are the same test when they share an identity key: FDA-style
# aliases (full name, leading phrase, parenthetical abbreviation of 3+ characters),
# plural folded, or a pair in SAME_TEST below (found reviewing every unpaired name
# on the 'ready' instruments). This list is the seed of the BUG-011 identity table.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_report import loose  # noqa: E402
import re  # noqa: E402

SAME_TEST = [
    ("PT/INR", "Prothrombin time (PT)"),
    ("Parathyroid hormone (PTH)", "Parathyroid hormone - intact"),
    ("Cocaine", "Cocaine metabolites"),
    ("Cystatin C", "Cystacin C"),
    ("Glycosylated Hemoglobin (Hgb A1c)", "Glycated hemoglobin, total"),
    ("Microalbumin", "Albumin, urinary"),
    ("Transferrin receptor (TFR)", "Soluble transferrin receptor (sTfR)"),
    ("Soluble Transferrin Receptor (sTfR)", "Transferrin receptor (TFR)"),
    ("IgG Subclasses (1, 2, 3, 4)", "Immunoglobulins IgG subclasses"),
    ("T uptake (TU)", "Thyroxine uptake (T4U) (TU)"),
    ("T uptake (TU)", "Triiodothyronine uptake (T3U) (TU)"),
]
# Alias tokens too generic to identify a test on their own.
GENERIC = {"urine", "serum", "plasma", "manual", "rapid", "qualitative", "quantitative", "csf", "poc", "wholeblood",
           "direct", "total", "free", "igg", "igm", "iga", "ige", "antibody", "antibodies", "antigen", "dna", "rna",
           "mrna", "pcr", "naat", "screen", "confirmation", "confirmatory", "neonatal", "cardiac"}


def _fold(k):
    return k[:-1] if len(k) > 4 and k.endswith("s") else k


def _parts(name):
    """(full, leading phrase, parenthetical codes, trailing qualifier?) in loose form.
    "Prostatic specific antigen (PSA), free" -> trailing qualifier ", free", so it is a
    different test from "Prostatic specific antigen (PSA)"."""
    n = name.strip()
    full = _fold(loose(n))
    lead = _fold(loose(n.split("(")[0]))
    codes = {_fold(loose(c)) for c in re.findall(r"\(([^)]*)\)", n)}
    codes = {c for c in codes if len(c) >= 3 and c not in GENERIC}
    trailing = bool(re.search(r"\)\s*[,;-]?\s*[A-Za-z0-9]", n))
    return full, lead, codes, trailing


def same_test(a, b):
    """True when two names are the same measurand (see SAME-TEST GUARD above)."""
    la, lb = a.strip().lower(), b.strip().lower()
    if la == lb:
        return True
    for x, y in SAME_TEST:
        if {la, lb} == {x.lower(), y.lower()}:
            return True
    fa, ea, ca, ta = _parts(a)
    fb, eb, cb, tb = _parts(b)
    if ta or tb:
        # a qualifier after the name ("(PSA), free") makes it its own test
        return fa == fb and fa not in GENERIC
    if (ca & cb) or (ca & {eb, fb}) or (cb & {ea, fa}):
        return True  # shared code, or one name's code is the other's name (EDDP)
    if ca and cb:
        return False  # different codes in parentheses: phospho-Tau (217P) vs (181P)
    if fa and fa == fb and fa not in GENERIC:
        return True
    return bool(ea) and ea == eb and ea not in GENERIC


def load():
    nm = json.load(open(NAME_MAP, encoding="utf-8"))
    lib = json.load(open(LIB, encoding="utf-8"))
    ready = {k: v for k, v in nm["instruments"].items() if v.get("bucket") == "ready"}
    return nm, lib, ready


def save(lib):
    with open(LIB, "w", encoding="utf-8") as f:
        f.write(json.dumps(lib, ensure_ascii=False, indent=2) + "\n")


def apply():
    nm, lib, ready = load()
    before = {k: json.dumps(v, sort_keys=True) for k, v in lib.items()}
    used_specialties = {t["specialty"] for e in lib.values() for t in e["tests"].values()}
    manifest = {"source": nm.get("source"), "report_built": nm.get("built"), "instruments": {}}
    n_add = n_cx = 0
    for key in sorted(ready):
        entry, plan = lib[key], ready[key]
        tests = entry["tests"]
        done = {"adds": [], "complexity": [], "held_adds_fda_disagrees": plan.get("held_adds_fda_disagrees", []),
                "held_same_test_on_instrument": []}
        for a in plan["proposed_adds"]:
            name = a["analyte"]
            clash = sorted(t for t in tests if same_test(t, name))
            if clash:
                done["held_same_test_on_instrument"].append({**a, "already_on_instrument_as": clash})
                continue
            assert name not in tests, (key, "already in library", name)
            assert a["complexity"] in VALID_CX, (key, name, a["complexity"])
            assert a["specialty"] in used_specialties, (key, name, "specialty not used in the library", a["specialty"])
            tests[name] = {"complexity": a["complexity"], "specialty": a["specialty"]}
            done["adds"].append(a)
            n_add += 1
        for c in plan["proposed_complexity"]:
            t = c["analyte"]
            assert t in tests, (key, "missing", t)
            assert tests[t]["complexity"].upper() == c["from"], (key, t, "library value changed since the report", tests[t]["complexity"], c["from"])
            assert c["to"] in VALID_CX, (key, t, c["to"])
            tests[t]["complexity"] = c["to"]
            done["complexity"].append(c)
            n_cx += 1
        entry["testCount"] = len(tests)
        if done["adds"] or done["complexity"]:
            entry["menuLastVerifiedAt"] = nm.get("built")
        manifest["instruments"][key] = done
    for k, v in lib.items():
        if k not in ready:
            assert json.dumps(v, sort_keys=True) == before[k], ("non-ready entry changed", k)
    save(lib)
    manifest["totals"] = {"instruments": len(ready), "adds": n_add, "complexity_changes": n_cx,
                          "held_adds": sum(len(v["held_adds_fda_disagrees"]) for v in manifest["instruments"].values()),
                          "held_same_test": sum(len(v["held_same_test_on_instrument"]) for v in manifest["instruments"].values())}
    with open(MANIFEST, "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print("written:", manifest["totals"])


def verify():
    nm, lib, ready = load()
    man = json.load(open(MANIFEST, encoding="utf-8"))
    fails = 0

    def check(label, ok, detail=""):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), label, detail)
        fails += 0 if ok else 1

    missing = [(k, a["analyte"]) for k, v in man["instruments"].items() for a in v["adds"]
               if a["analyte"] not in lib[k]["tests"] or lib[k]["tests"][a["analyte"]] != {"complexity": a["complexity"], "specialty": a["specialty"]}]
    check("every approved add is in the library with FDA complexity and specialty", not missing, f"{man['totals']['adds']} adds; wrong {missing[:3]}")
    wrong = [(k, c["analyte"]) for k, v in man["instruments"].items() for c in v["complexity"] if lib[k]["tests"][c["analyte"]]["complexity"] != c["to"]]
    check("every approved complexity change is applied", not wrong, f"{man['totals']['complexity_changes']} changes; wrong {wrong[:3]}")
    held = [(k, h["analyte"]) for k, v in man["instruments"].items() for h in v["held_adds_fda_disagrees"] if h["analyte"] in lib[k]["tests"]]
    check("adds where FDA records disagree were not written", not held, f"{man['totals']['held_adds']} held")
    dup = [(k, h["analyte"]) for k, v in man["instruments"].items() for h in v["held_same_test_on_instrument"] if h["analyte"] in lib[k]["tests"]]
    check("adds that are the same test as one already on the instrument were not written", not dup, f"{man['totals']['held_same_test']} held")
    new_twice = []
    for k, v in man["instruments"].items():
        for ad in v["adds"]:
            others = [t for t in lib[k]["tests"] if t != ad["analyte"] and same_test(t, ad["analyte"])]
            if others:
                new_twice.append((k, ad["analyte"], others))
    check("no written test is the same test as another test on its instrument", not new_twice, f"{new_twice[:4]}")
    cases = [("Prostatic specific antigen (PSA)", "Prostatic specific antigen (PSA), free", False),
             ("phospho-Tau (181P)", "phospho-Tau (217P)", False), ("Urea Nitrogen (BUN)", "Urea (BUN)", True),
             ("Ammonia", "Ammonia, plasma/serum", True), ("Triglycerides", "Triglyceride", True),
             ("Methadone metabolite (EDDP)", "EDDP (methadone metabolite)", True), ("PT/INR", "Prothrombin time (PT)", True),
             ("Cancer antigen 125 (CA 125)", "CA 19-9", False), ("Glucose", "Glucose, urine", False),
             ("Thyroxine, free (FT4)", "Thyroxine (T4)", False), ("Hepatitis B surface antibody", "Hepatitis B surface antigen (HBsAg)", False)]
    bad = [(x, y) for x, y, want in cases if same_test(x, y) != want]
    check("same-test rule on known pairs (same and different)", not bad, f"{len(cases)} cases; wrong {bad}")
    bad_count = [k for k, e in lib.items() if e.get("testCount") != len(e["tests"])]
    check("testCount matches the tests on every written entry", not [k for k in bad_count if k in ready], f"{len(ready)} entries")
    check("only 'ready' instruments were written", set(man["instruments"]) == set(ready), f"{len(ready)} ready")
    bad_cx = [(k, t) for k, e in lib.items() for t, v in e["tests"].items() if v["complexity"] not in VALID_CX]
    check("every complexity in the library is WAIVED, MODERATE or HIGH", not bad_cx, f"{bad_cx[:3]}")
    print("\nALL PASS" if fails == 0 else f"\n{fails} FAILURE(S)")
    return fails


if __name__ == "__main__":
    if "--verify" in sys.argv:
        sys.exit(1 if verify() else 0)
    apply()
