"""Remove the VeritaMap library entries that repeat another entry under a name differing only in capital letters
(BUG-009 parked item, 2026-11-14).

"Abbott Architect c8000" and "Abbott Architect c16000" are each the same entry as "Abbott ARCHITECT c8000" and
"Abbott ARCHITECT c16000" (same vendor, category, count, date and every test with its complexity and specialty), so
searching "c8000" offered the analyzer twice. The ARCHITECT spelling stays: it is Abbott's own, and the library's
c4000 entry uses it. Production held no saved instrument under either spelling of either analyzer (vls-ops
prod_case_dup_instrument_counts.mjs, 417 instruments read, 2026-11-14); the build page finds a saved instrument's
entry by its exact name, so this was checked before removing anything.

Guards: each removed entry must be equal to its twin in every field; only the removed entries' text leaves the
library and the name map (scripts/fda-menus/name_map.json, which build_report.py writes from the library and
apply_ready.py reads key by key); every other entry is unchanged and keeps its place.

Left for Michael: "Siemens CLINITEK Status+" and "Siemens Clinitek Status+" also differ only in capitals, but they
hold different menus (18 and 11 tests) and saved instruments use both, so they are not the same entry.

  python scripts/fda-menus/remove_case_duplicate_entries.py            # remove
  python scripts/fda-menus/remove_case_duplicate_entries.py --verify   # check the library and name map
"""
import argparse
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
NAME_MAP = os.path.join(HERE, "name_map.json")

# removed spelling -> the entry that stays
REMOVE = {
    "Abbott Architect c8000": "Abbott ARCHITECT c8000",
    "Abbott Architect c16000": "Abbott ARCHITECT c16000",
}
# name groups still differing only in case or spacing, each for a reason recorded above
LEFT_FOR_MICHAEL = [("Siemens CLINITEK Status+", "Siemens Clinitek Status+")]


def read(path):
    with io.open(path, encoding="utf-8", newline="") as f:
        return f.read()


def write(path, text):
    with io.open(path, "w", encoding="utf-8", newline="") as f:
        f.write(text)


def cut_entries(text, keys):
    """Remove the named entries (two-space indent, the layout both files use) from the text, comma included, so every
    other byte stays as it was."""
    nl = "\r\n" if "\r\n" in text else "\n"
    for key in keys:
        head = nl + "  " + json.dumps(key, ensure_ascii=False) + ": {" + nl
        if text.count(head) != 1:
            raise SystemExit(f"STOP: {key!r} found {text.count(head)} times as an entry")
        start = text.index(head)
        end = re.compile(re.escape(nl) + r"  \}(,?)(?=" + re.escape(nl) + ")").search(text, start + len(head))
        if not end:
            raise SystemExit(f"STOP: no end for {key!r}")
        if end.group(1) == ",":
            text = text[:start] + text[end.end():]          # drop the entry and its comma; the next entry follows
        else:
            # the last entry: drop the comma that ends the entry before it instead
            before = text.rindex(",", 0, start)
            if text[before + 1:start].strip():
                raise SystemExit(f"STOP: unexpected text before {key!r}")
            text = text[:before] + text[end.end():]
    return text


def folded_groups(lib):
    groups = {}
    for name in lib:
        groups.setdefault(" ".join(name.lower().split()), []).append(name)
    return sorted(tuple(sorted(v)) for v in groups.values() if len(v) > 1)


def apply():
    lib_text, nm_text = read(LIB), read(NAME_MAP)
    lib, nm = json.loads(lib_text), json.loads(nm_text)
    for gone, stays in REMOVE.items():
        if gone not in lib or stays not in lib:
            raise SystemExit(f"STOP: {gone!r} or {stays!r} is not in the library")
        if lib[gone] != lib[stays]:
            raise SystemExit(f"STOP: {gone!r} is not the same entry as {stays!r}")
        if gone not in nm["instruments"]:
            raise SystemExit(f"STOP: {gone!r} is not in the name map")
    new_lib_text = cut_entries(lib_text, REMOVE)
    new_nm_text = cut_entries(nm_text, REMOVE)
    new_lib, new_nm = json.loads(new_lib_text), json.loads(new_nm_text)
    want_keys = [k for k in lib if k not in REMOVE]
    if list(new_lib) != want_keys or any(new_lib[k] != lib[k] for k in want_keys):
        raise SystemExit("STOP: the library changed beyond the removed entries")
    want_nm = [k for k in nm["instruments"] if k not in REMOVE]
    if list(new_nm["instruments"]) != want_nm or any(new_nm["instruments"][k] != nm["instruments"][k] for k in want_nm):
        raise SystemExit("STOP: the name map changed beyond the removed entries")
    if {k: v for k, v in new_nm.items() if k != "instruments"} != {k: v for k, v in nm.items() if k != "instruments"}:
        raise SystemExit("STOP: the name map's header changed")
    write(LIB, new_lib_text)
    write(NAME_MAP, new_nm_text)
    print(f"removed {len(REMOVE)} entries: library {len(lib)} -> {len(new_lib)}, name map"
          f" {len(nm['instruments'])} -> {len(new_nm['instruments'])}")
    return verify()


def verify():
    lib = json.loads(read(LIB))
    nm = json.loads(read(NAME_MAP))
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else "  :: " + str(detail)[:240]))

    left = [k for k in REMOVE if k in lib]
    check(f"the {len(REMOVE)} repeated spellings are gone from the library ({', '.join(REMOVE)})", not left, left)
    left_nm = [k for k in REMOVE if k in nm["instruments"]]
    check("and from the name map", not left_nm, left_nm)
    missing = [v for v in REMOVE.values() if v not in lib or v not in nm["instruments"]]
    check(f"the entries that stay are in both ({', '.join(REMOVE.values())})", not missing, missing)
    bad = [k for k in lib if lib[k].get("testCount") != len(lib[k].get("tests", {}))]
    check("every library entry's testCount matches its tests", not bad, bad)
    groups = folded_groups(lib)
    want = sorted(tuple(sorted(g)) for g in LEFT_FOR_MICHAEL)
    check("no other library names differ only in capitals or spacing (the CLINITEK pair is left for Michael)",
          groups == want, groups)
    stray = sorted(set(nm["instruments"]) - set(lib))
    check("every name map key is a library entry", not stray, stray)
    print("ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser()
    p.add_argument("--verify", action="store_true")
    a = p.parse_args()
    raise SystemExit(0 if (verify() if a.verify else apply()) else 1)
