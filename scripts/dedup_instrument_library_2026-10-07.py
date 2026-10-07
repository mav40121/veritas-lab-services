#!/usr/bin/env python3
"""Remove the near-duplicate analytes the name-keyed Siemens (#1479) and Abbott (#1482)
menu batches introduced into client/src/lib/fdaInstrumentData.json (parking lot #57).

Michael approved the full plan (option 2, 2026-10-07 morning): every row in
scripts/data/instrument_library_dedup_2026-10-07.csv is applied: the KEEP name stays,
the REMOVE name is deleted from that instrument entry's `tests` and testCount is
recomputed. 127 same-base names whose parenthetical is a real discriminator
(Crossmatch IS vs AHG, Basophils absolute vs %, pO2(A) vs (A-a) ...) are NOT in the
CSV and are untouched by construction.

Usage (repo root):  python scripts/dedup_instrument_library_2026-10-07.py
Then the receipt:   python scripts/dedup_instrument_library_2026-10-07.py --verify
The receipt re-reads the pre-change file from git (HEAD) and proves, entry by entry,
that only the planned removals changed and every KEEP survived.
"""
import csv, json, subprocess, sys

LIB = "client/src/lib/fdaInstrumentData.json"
PLAN = "scripts/data/instrument_library_dedup_2026-10-07.csv"


def load_lib(raw: bytes):
    return json.loads(raw.decode("utf-8"))


def dump_lib(lib) -> bytes:
    # Byte-identical round-trip format of the committed file (2-space, non-ASCII kept, CRLF).
    return (json.dumps(lib, indent=2, ensure_ascii=False) + "\n").replace("\n", "\r\n").encode("utf-8")


def plan_rows():
    with open(PLAN, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def apply():
    raw = open(LIB, "rb").read()
    assert dump_lib(load_lib(raw)) == raw, "library does not round-trip byte-identically; stop"
    lib = load_lib(raw)
    rows = plan_rows()
    removed, touched, problems = 0, set(), []
    for r in rows:
        e = lib.get(r["entry"])
        if e is None:
            problems.append(f"entry missing: {r['entry']}"); continue
        tests = e["tests"]
        if r["keep"] not in tests:
            problems.append(f"KEEP missing, refusing to touch: {r['entry']} :: {r['keep']}"); continue
        if r["remove"] not in tests:
            problems.append(f"remove already absent: {r['entry']} :: {r['remove']}"); continue
        del tests[r["remove"]]
        removed += 1
        touched.add(r["entry"])
    for k in touched:
        lib[k]["testCount"] = len(lib[k]["tests"])
    if problems:
        print("PROBLEMS (nothing written):"); [print("  " + p) for p in problems]; sys.exit(1)
    open(LIB, "wb").write(dump_lib(lib))
    print(f"applied: {removed} removals across {len(touched)} entries; plan rows {len(rows)}")


def verify():
    before = load_lib(subprocess.check_output(["git", "show", f"HEAD:{LIB}"]))
    after = load_lib(open(LIB, "rb").read())
    rows = plan_rows()
    plan = {}
    for r in rows:
        plan.setdefault(r["entry"], {"keep": set(), "remove": set()})
        plan[r["entry"]]["keep"].add(r["keep"]); plan[r["entry"]]["remove"].add(r["remove"])
    fails = 0
    def check(name, ok, detail=""):
        nonlocal fails
        print(("PASS  " if ok else "FAIL  ") + name + (("  :: " + detail) if detail else ""))
        if not ok: fails += 1
    check("same entry set before and after", set(before) == set(after), f"{len(before)} vs {len(after)}")
    untouched_changed = [k for k in before if k not in plan and before[k] != after[k]]
    check(f"{len(before) - len(plan)} untouched entries are byte-for-byte identical", not untouched_changed, ", ".join(untouched_changed[:5]))
    total_removed = 0
    for k, p in plan.items():
        b, a = before[k], after[k]
        bt, at = b["tests"], a["tests"]
        expected_removed = {n for n in p["remove"] if n in bt}
        actually_removed = set(bt) - set(at)
        total_removed += len(actually_removed)
        ok = (actually_removed == expected_removed
              and all(n in at for n in p["keep"])
              and all(at[n] == bt[n] for n in at)              # surviving rows unchanged
              and a["testCount"] == len(at)
              and {x: y for x, y in a.items() if x not in ("tests", "testCount")} == {x: y for x, y in b.items() if x not in ("tests", "testCount")})
        check(f"{k}: removed {len(actually_removed)}, keeps present, survivors unchanged, testCount {b['testCount']}->{a['testCount']}", ok,
              "" if ok else f"expected {sorted(expected_removed)} got {sorted(actually_removed)}")
    check(f"total removed equals the plan ({len(rows)})", total_removed == len(rows), str(total_removed))
    check("file round-trips byte-identically after the edit", dump_lib(after) == open(LIB, "rb").read())
    print("\nALL PASS" if fails == 0 else f"\n{fails} FAILED")
    sys.exit(0 if fails == 0 else 1)


if __name__ == "__main__":
    verify() if "--verify" in sys.argv else apply()
