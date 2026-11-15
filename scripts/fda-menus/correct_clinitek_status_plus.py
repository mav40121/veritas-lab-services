"""BUG-009 (2026-11-15): the "Siemens CLINITEK Status+" library entry listed every test MODERATE; FDA lists the
CLINITEK Status+ as WAIVED.

FDA's CLIA file (clia_detail.zip) holds 51 records for the five CLINITEK Status test-system names the name map gives
this entry. The Status+ itself is "Siemens, CLINITEK Status+ Analyzer", K091216, effective 2010-01-04: twelve
analytes, every one WAIVED. The only MODERATE records are the original "BAYER, CLINITEK STATUS ANALYZER" of
December 2003 (dipstick chemistries K031947, urine hCG K032563), from before the waiver; from 2005 every record is
WAIVED. The 2026-10-09 review (build_report.py) proposed these complexity changes on this entry under the Q41 rule
(a change is listed only when every FDA record for the test agrees) and none was applied, because the entry sat in
the parameter-level review group, not the ready group.

This writes WAIVED on eleven tests:
  the ten the review proposed - dipstick pH, bilirubin, blood, creatinine, glucose, ketone, leukocytes, nitrite,
                                protein and urobilinogen (urobilinogen's one FDA record is K031947, WAIVED);
  "Total solids (specific gravity)" - the Status+'s only specific gravity reading, the strip's pad, which FDA lists
                                as "Urine qualitative dipstick specific gravity", WAIVED, K091216.
Left as they are: "Urine qualitative dipstick chemistries" (FDA's only record is the 2003 MODERATE one, and FDA has
no Status+ record of it); the six "<test>, urine" and "Creatinine" names, which are not FDA's names for this system
and repeat tests the entry already lists (BUG-009's naming work). No test is added, removed or renamed, and the
entry's count, category and vendor are unchanged. "Siemens Clinitek Status+", the other spelling, already lists its
tests WAIVED and is not touched.

Saved instruments keep their own rows; this changes what a lab gets when it adds the analyzer. The saved rows on
production are corrected separately with POST /api/admin/veritamap/set-complexity (vls-ops
prod_clinitek_set_complexity.mjs), only on Michael's go.

Guards: the entry must hold exactly the 18 tests named below with every one MODERATE before the write; only this
entry's text is rewritten (splice_entries, as rebuild_corrupt.py); every other entry is unchanged.

Usage:
  python scripts/fda-menus/correct_clinitek_status_plus.py            # write
  python scripts/fda-menus/correct_clinitek_status_plus.py --verify   # check
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from rebuild_corrupt import LIB, splice_entries  # noqa: E402

KEY = "Siemens CLINITEK Status+"
OTHER = "Siemens Clinitek Status+"
# test -> FDA evidence for WAIVED
TO_WAIVED = {
    "Urine qualitative dipstick Ph": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick bilirubin": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick blood": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick creatinine": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick glucose": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick ketone": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick leukocytes": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick nitrite": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick protein": "K091216 Siemens, CLINITEK Status+ Analyzer",
    "Urine qualitative dipstick urobilinogen": "K031947 Bayer Clinitek Status Urine Chemistry Analyzer",
    "Total solids (specific gravity)": "K091216 Siemens, CLINITEK Status+ Analyzer (Urine qualitative dipstick specific gravity)",
}
UNCHANGED = [
    "Urine qualitative dipstick chemistries",
    "Protein, total, urine",
    "Nitrite, urine",
    "pH, urine",
    "Bilirubin, urine",
    "Urobilinogen, urine",
    "Creatinine",
]


def load():
    with open(LIB, encoding="utf-8", newline="") as f:
        text = f.read()
    return text, json.loads(text)


def apply():
    text, lib = load()
    entry = lib.get(KEY)
    if entry is None:
        raise SystemExit(f"STOP: {KEY!r} is not in the library")
    tests = entry["tests"]
    if sorted(tests) != sorted(list(TO_WAIVED) + UNCHANGED):
        raise SystemExit(f"STOP: {KEY!r} no longer holds the 18 tests this was written for: {sorted(tests)}")
    not_moderate = [t for t in TO_WAIVED if tests[t]["complexity"] != "MODERATE"]
    if not_moderate:
        raise SystemExit(f"STOP: already changed, nothing written: {not_moderate}")
    before = {k: json.dumps(v, sort_keys=True) for k, v in lib.items()}
    for t in TO_WAIVED:
        tests[t]["complexity"] = "WAIVED"
    new_text = splice_entries(text, lib, [KEY])
    new_lib = json.loads(new_text)
    if list(new_lib) != list(lib):
        raise SystemExit("STOP: the library's entries or their order changed")
    for k in new_lib:
        if k != KEY and json.dumps(new_lib[k], sort_keys=True) != before[k]:
            raise SystemExit(f"STOP: another entry changed: {k!r}")
    with open(LIB, "w", encoding="utf-8", newline="") as f:
        f.write(new_text)
    print(f"{KEY}: {len(TO_WAIVED)} tests MODERATE -> WAIVED")
    return verify()


def verify():
    _, lib = load()
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else "  :: " + str(detail)[:240]))

    e = lib.get(KEY, {"tests": {}})
    tests = e["tests"]
    wrong = [t for t in TO_WAIVED if tests.get(t, {}).get("complexity") != "WAIVED"]
    check(f"{KEY}: the {len(TO_WAIVED)} tests FDA lists as waived read WAIVED", not wrong, wrong)
    moved = [t for t in UNCHANGED if tests.get(t, {}).get("complexity") != "MODERATE"]
    check(f"the {len(UNCHANGED)} tests left for the naming work are unchanged (MODERATE)", not moved, moved)
    check("the entry still lists its 18 tests (none added, removed or renamed)",
          sorted(tests) == sorted(list(TO_WAIVED) + UNCHANGED) and e.get("testCount") == 18, sorted(tests))
    check("vendor and category unchanged", e.get("vendor") == "Siemens Healthineers" and e.get("category") == "Urinalysis",
          (e.get("vendor"), e.get("category")))
    other = lib.get(OTHER, {"tests": {}})
    check(f"{OTHER} untouched: 11 tests, all WAIVED",
          other.get("testCount") == 11 and all(v["complexity"] == "WAIVED" for v in other["tests"].values()),
          {k: v["complexity"] for k, v in other["tests"].items()})
    bad = [k for k in lib if lib[k].get("testCount") != len(lib[k].get("tests", {}))]
    check("every library entry's testCount matches its tests", not bad, bad)
    print("ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true")
    a = p.parse_args()
    raise SystemExit(0 if (verify() if a.verify else apply()) else 1)
