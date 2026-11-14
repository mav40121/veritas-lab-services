"""BUG-009 (2026-11-13): correct the "Abbott ARCHITECT c4000" library entry, as Michael approved it (Q329 = 1).

The entry listed 173 tests; 114 were not on FDA's CLIA records for the c4000, mostly immunoassays and serology that
Abbott runs on its i-series analyzers. The review (VeritaMap Library\\ARCHITECT c4000 review 2026-11-13.xlsx, built by
vls-ops c4000_review_workbook.py) proposed, test by test with FDA's evidence, and the plan file holds:
  remove 84 - FDA records them only on Abbott immunoassay analyzers (30), or on no ARCHITECT or Alinity system (54,
              including Calcidiol, a second name for Vitamin D on this entry, and BRAHMS PCT, the i-series kit);
  keep 30   - chemistry FDA records on ARCHITECT chemistry analyzers, or the same test as an FDA test on the c4000;
  add 13    - FDA tests the entry lacks, with FDA's name, complexity, specialty and document;
  held 15   - FDA's names for tests the entry keeps under its own name (the 2026-10-09 same-test rule), not added.
The 59 tests FDA does list for the c4000 are untouched.

Guards: the entry must hold exactly 173 tests including every planned removal and keep, no add may already be there or
be the same test as one that stays, and only this entry's text is rewritten (splice_entries, as rebuild_corrupt.py).

Usage:
  python scripts/fda-menus/correct_c4000.py            # write
  python scripts/fda-menus/correct_c4000.py --verify   # check
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rebuild_corrupt import LIB, VALID_CX, splice_entries  # noqa: E402
from apply_ready import same_test  # noqa: E402

PLAN = os.path.join(HERE, "c4000_plan_2026-11-13.json")
KEY = "Abbott ARCHITECT c4000"
BEFORE_COUNT = 173
BUILT = "2026-11-13"


def load():
    return json.load(open(PLAN, encoding="utf-8")), json.load(open(LIB, encoding="utf-8"))


def apply():
    plan, lib = load()
    assert plan["instrument"] == KEY
    before = {k: json.dumps(v, sort_keys=True) for k, v in lib.items()}
    used_specialties = {t["specialty"] for e in lib.values() for t in e["tests"].values()}
    tests = lib[KEY]["tests"]
    remove = [r["test"] for r in plan["remove"]]
    keep = [k["test"] for k in plan["keep"]]
    assert len(tests) == BEFORE_COUNT, ("the entry changed since the review; stop and review", len(tests))
    missing = [t for t in remove + keep if t not in tests]
    assert not missing, ("planned tests not on the entry", missing)
    assert not set(remove) & set(keep), "a test is both removed and kept"
    for t in remove:
        del tests[t]
    for a in plan["add"]:
        name = a["analyte"]
        assert name not in tests, ("already on the entry", name)
        clash = sorted(t for t in tests if same_test(t, name))
        assert not clash, ("an add is the same test as one that stays", name, clash)
        assert a["complexity"] in VALID_CX, (name, a["complexity"])
        assert a["specialty"] in used_specialties, (name, "specialty not used in the library", a["specialty"])
        assert a.get("evidence"), (name, "no FDA evidence")
        tests[name] = {"complexity": a["complexity"], "specialty": a["specialty"]}
    for h in plan["held_same_test"]:
        assert h["fda"] not in tests and h["library"] in tests, ("held pair out of step", h)
    lib[KEY]["testCount"] = len(tests)  # order kept: removals drop out in place, adds go at the end (as apply_ready.py)
    lib[KEY]["menuLastVerifiedAt"] = BUILT
    for k, v in lib.items():
        if k != KEY:
            assert json.dumps(v, sort_keys=True) == before[k], ("other entry changed", k)
    original = open(LIB, encoding="utf-8", newline="").read()
    text = splice_entries(original, lib, [KEY])
    assert json.loads(text) == lib, "spliced library does not read back as the corrected library"
    with open(LIB, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"written: removed {len(remove)}, added {len(plan['add'])}, held {len(plan['held_same_test'])}, testCount {len(tests)}")


def verify():
    plan, lib = load()
    tests = lib[KEY]["tests"]
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else "  :: " + str(detail)[:240]))

    left = [r["test"] for r in plan["remove"] if r["test"] in tests]
    check(f"none of the {len(plan['remove'])} planned removals is on the entry", not left, left)
    gone = [k["test"] for k in plan["keep"] if k["test"] not in tests]
    check(f"every one of the {len(plan['keep'])} kept tests is still there", not gone, gone)
    bad = [a["analyte"] for a in plan["add"] if tests.get(a["analyte"]) != {"complexity": a["complexity"], "specialty": a["specialty"]}]
    check(f"the {len(plan['add'])} adds carry FDA's complexity and specialty", not bad, bad)
    held = [h["fda"] for h in plan["held_same_test"] if h["fda"] in tests]
    check(f"none of the {len(plan['held_same_test'])} held FDA names was added", not held, held)
    want = BEFORE_COUNT - len(plan["remove"]) + len(plan["add"])
    check(f"testCount {lib[KEY]['testCount']} = {BEFORE_COUNT} - {len(plan['remove'])} + {len(plan['add'])} = {want}",
          lib[KEY]["testCount"] == len(tests) == want, (lib[KEY]["testCount"], len(tests)))
    added = {a["analyte"] for a in plan["add"]}
    dup = sorted({tuple(sorted((a, b))) for a in added for b in tests if a != b and same_test(a, b)})
    check("no add is the same test as another test on the entry", not dup, dup)
    # Left as found (not in the approved plan): pairs that were both on the entry before this change.
    old = sorted({tuple(sorted((a, b))) for a in tests for b in tests if a != b and a not in added and b not in added and same_test(a, b)})
    print(f"NOTE  pairs already on the entry before this change, left as they are: {old}")
    print("ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true")
    a = p.parse_args()
    if a.verify:
        raise SystemExit(0 if verify() else 1)
    apply()
