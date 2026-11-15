"""BUG-009 / BUG-011 class (2026-11-14): remove the second name of a test that a library entry lists twice, as Michael
approved it (Q330).

The duplicate review (VeritaMap Library\\Same test listed twice 2026-11-14.xlsx, built by vls-ops dup_review_workbook.py
from lib_same_test_sweep.py and lib_dup_strict.py) found 21 entries listing one test under two names, for example
"Calcium" and "Calcium, total". A new instrument starts with every library test switched on, so a lab adding one of these
analyzers got the test twice on its map. The plan (dup_names_plan_2026-11-14.json) keeps, per test, the name more library
instruments use, then the name FDA's CLIA records use, then the shorter, and removes the other: 73 names.
None came from the 10/9 FDA load. Saved maps don't change: the build page keeps every saved test, and a name no longer
in the library shows as the lab's own test.

Guards: each entry must hold its planned test count and every kept and removed name, a kept name must carry the removed
name's complexity, and only these entries' text is rewritten (splice_entries, as rebuild_corrupt.py). A kept name whose
specialty differs from the removed one's is listed (the kept name carries FDA's specialty).

Usage:
  python scripts/fda-menus/remove_duplicate_names.py            # write
  python scripts/fda-menus/remove_duplicate_names.py --verify   # check
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rebuild_corrupt import LIB, splice_entries  # noqa: E402
from remove_case_duplicate_entries import REMOVE as CASE_DUPLICATES_REMOVED  # noqa: E402

PLAN = os.path.join(HERE, "dup_names_plan_2026-11-14.json")


def load():
    return json.load(open(PLAN, encoding="utf-8")), json.load(open(LIB, encoding="utf-8"))


def verify_plan(plan, lib):
    """The plan as --verify reads it now: an entry remove_case_duplicate_entries.py later took out of the library (the
    same entry under a name differing only in capitals) is checked through the entry that stayed, which the plan also
    lists with the same groups."""
    out = {}
    for k, s in plan["instruments"].items():
        if k not in lib and k in CASE_DUPLICATES_REMOVED:
            print(f"NOTE  {k}: removed later as a repeat of {CASE_DUPLICATES_REMOVED[k]} (remove_case_duplicate_entries.py)")
            continue
        out[k] = s
    return {**plan, "instruments": out}


def apply():
    plan, lib = load()
    before = {k: json.dumps(v, sort_keys=True) for k, v in lib.items()}
    removed, specialty_moves = 0, []
    for key, spec in plan["instruments"].items():
        tests = lib[key]["tests"]
        assert len(tests) == spec["before_count"] == lib[key]["testCount"], ("the entry changed since the review; stop and review", key, len(tests))
        for g in spec["groups"]:
            keep = g["keep"]
            assert keep in tests, ("kept name not on the entry", key, keep)
            for r in g["remove"]:
                assert r in tests, ("planned removal not on the entry", key, r)
                assert r != keep, (key, r)
                assert tests[r]["complexity"] == tests[keep]["complexity"], ("complexity differs; stop and review", key, keep, r)
                if tests[r]["specialty"] != tests[keep]["specialty"]:
                    specialty_moves.append((key, keep, tests[keep]["specialty"], r, tests[r]["specialty"]))
                del tests[r]  # order kept: a removal drops out in place
                removed += 1
        lib[key]["testCount"] = len(tests)
    for k, v in lib.items():
        if k not in plan["instruments"]:
            assert json.dumps(v, sort_keys=True) == before[k], ("other entry changed", k)
    original = open(LIB, encoding="utf-8", newline="").read()
    text = splice_entries(original, lib, list(plan["instruments"]))
    assert json.loads(text) == lib, "spliced library does not read back as the corrected library"
    with open(LIB, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    print(f"written: removed {removed} names on {len(plan['instruments'])} entries")
    for m in specialty_moves:
        print("  kept name's specialty differs: %s | keep %s (%s) | removed %s (%s)" % m)


def verify():
    plan, lib = load()
    plan = verify_plan(plan, lib)
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else "  :: " + str(detail)[:240]))

    total = sum(len(g["remove"]) for s in plan["instruments"].values() for g in s["groups"])
    left = [(k, r) for k, s in plan["instruments"].items() for g in s["groups"] for r in g["remove"] if r in lib[k]["tests"]]
    check(f"none of the {total} planned removals is on its entry", not left, left)
    gone = [(k, g["keep"]) for k, s in plan["instruments"].items() for g in s["groups"] if g["keep"] not in lib[k]["tests"]]
    check("every kept name is still on its entry", not gone, gone)
    counts = [(k, lib[k]["testCount"], len(lib[k]["tests"]), s["before_count"] - sum(len(g["remove"]) for g in s["groups"]))
              for k, s in plan["instruments"].items()]
    bad = [c for c in counts if not (c[1] == c[2] == c[3])]
    check(f"each of the {len(counts)} entries' testCount = its tests = before - removals", not bad, bad)
    print("ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true")
    a = p.parse_args()
    if a.verify:
        raise SystemExit(0 if verify() else 1)
    apply()
