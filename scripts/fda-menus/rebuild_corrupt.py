"""BUG-009 (2026-11-13): rebuild a library entry whose test list is corrupt, from FDA's menu.

The 2026-11-13 review re-run found one library entry that is not a menu at all:
"Beckman Coulter UniCel DxI 600" held 8 "tests": one 1,839-character string of Beckman
product names scraped as a single test, and 7 reagent codes (TSH3, TSH3d, PTH, PTHIO,
HCG5, HCG5d, d-CG5), every one marked HIGH complexity. A scan of every library test
name (long strings, comma runs, reagent-code shapes) found no other entry like it.
No production map used the instrument (admin instruments-by-name, 2026-11-13).

The entry is rebuilt by the rule Michael approved for the 'ready' instruments on
2026-10-09 (Q41 = 1): FDA's menu for the instrument (FDA analyte name, FDA complexity,
FDA specialty), every add carrying FDA's document number; adds where FDA records
disagree are held. The corrupt names are removed. Nothing else in the library changes.

Guard: the script stops unless the entry still holds exactly the corrupt names, so it
can't remove a test someone adds later.

Usage:
  python scripts/fda-menus/rebuild_corrupt.py --name-map <name_map.json from build_report.py>   # write
  python scripts/fda-menus/rebuild_corrupt.py --verify                                        # check
"""
import argparse
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "rebuilt_corrupt_2026-11-13.json")
VALID_CX = {"WAIVED", "MODERATE", "HIGH"}
BUILT = "2026-11-13"

CORRUPT = {
    "Beckman Coulter UniCel DxI 600": {
        "codes": {"TSH3", "TSH3d", "PTH", "PTHIO", "HCG5", "HCG5d", "d-CG5"},
        "scraped_prefix": "Access 2, Access 2i, Access 2 Immunoassay Analyzer, Access AccuTnI+3,",
    },
}


def corrupt_names(key, tests):
    spec = CORRUPT[key]
    scraped = [t for t in tests if t.startswith(spec["scraped_prefix"])]
    return set(scraped) | (set(tests) & spec["codes"]), scraped


def save(path, obj, indent):
    with open(path, "w", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False, indent=indent) + "\n")


def splice_entries(text, lib, keys):
    """Replace only the named top-level entries' text in the library file, so every other entry keeps its bytes
    (the file mixes one-line and wrapped lists, which a full re-serialize would change)."""
    nl = "\r\n" if "\r\n" in text else "\n"
    for key in keys:
        head = nl + "  " + json.dumps(key, ensure_ascii=False) + ": {" + nl
        start = text.index(head) + len(nl)
        end = re.compile(re.escape(nl) + r"  \}(,?)" + re.escape(nl)).search(text, start)
        body = json.dumps(lib[key], ensure_ascii=False, indent=2).replace("\n", nl + "  ")
        text = text[:start] + "  " + json.dumps(key, ensure_ascii=False) + ": " + body + end.group(1) + nl + text[end.end():]
    return text


def apply(name_map_path):
    nm = json.load(open(name_map_path, encoding="utf-8"))
    lib = json.load(open(LIB, encoding="utf-8"))
    before = {k: json.dumps(v, sort_keys=True) for k, v in lib.items()}
    used_specialties = {t["specialty"] for k, e in lib.items() if k not in CORRUPT for t in e["tests"].values()}
    manifest = {"source": nm.get("source"), "report_built": nm.get("built"), "instruments": {}}
    for key in CORRUPT:
        entry, plan = lib[key], nm["instruments"][key]
        tests = entry["tests"]
        bad, scraped = corrupt_names(key, tests)
        assert len(scraped) == 1, (key, "expected one scraped string", len(scraped))
        assert set(tests) == bad, (key, "entry no longer holds only the corrupt names; stop and review", sorted(set(tests) - bad))
        removed = [{"name": n if len(n) <= 120 else n[:120] + "...", "length": len(n), **tests[n]} for n in sorted(bad)]
        new = {}
        for a in plan["proposed_adds"]:
            assert a["complexity"] in VALID_CX, (key, a["analyte"], a["complexity"])
            assert a["specialty"] in used_specialties, (key, a["analyte"], "specialty not used in the library", a["specialty"])
            assert a.get("evidence"), (key, a["analyte"], "no FDA evidence")
            new[a["analyte"]] = {"complexity": a["complexity"], "specialty": a["specialty"]}
        assert new, (key, "FDA menu is empty")
        entry["tests"] = new
        entry["testCount"] = len(new)
        entry["menuLastVerifiedAt"] = BUILT
        manifest["instruments"][key] = {"removed_corrupt": removed, "adds": plan["proposed_adds"],
                                        "held_adds_fda_disagrees": plan.get("held_adds_fda_disagrees", [])}
    for k, v in lib.items():
        if k not in CORRUPT:
            assert json.dumps(v, sort_keys=True) == before[k], ("other entry changed", k)
    original = open(LIB, encoding="utf-8", newline="").read()
    text = splice_entries(original, lib, CORRUPT)
    assert json.loads(text) == lib, "spliced library does not read back as the rebuilt library"
    with open(LIB, "w", encoding="utf-8", newline="") as f:
        f.write(text)
    save(MANIFEST, manifest, 1)
    print("written:", {k: {"removed": len(v["removed_corrupt"]), "adds": len(v["adds"]), "held": len(v["held_adds_fda_disagrees"])}
                       for k, v in manifest["instruments"].items()})


def verify():
    lib = json.load(open(LIB, encoding="utf-8"))
    man = json.load(open(MANIFEST, encoding="utf-8"))
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(("PASS  " if cond else "FAIL  ") + name + ("" if cond else "  :: " + str(detail)[:200]))

    for key, m in man["instruments"].items():
        tests = lib[key]["tests"]
        bad, _ = corrupt_names(key, tests)
        check(f"{key}: no corrupt name left", not bad, sorted(bad))
        want = {a["analyte"]: {"complexity": a["complexity"], "specialty": a["specialty"]} for a in m["adds"]}
        check(f"{key}: the menu is FDA's {len(want)} tests with FDA's complexity and specialty", tests == want,
              sorted(set(tests) ^ set(want)))
        check(f"{key}: testCount {lib[key]['testCount']} matches", lib[key]["testCount"] == len(tests))
        check(f"{key}: no test name longer than 100 characters", all(len(t) <= 100 for t in tests))
        held = [h["analyte"] for h in m["held_adds_fda_disagrees"] if h["analyte"] in tests]
        check(f"{key}: no held FDA-disagree test written", not held, held)
    print("ALL PASS" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--name-map")
    p.add_argument("--verify", action="store_true")
    a = p.parse_args()
    if a.verify:
        raise SystemExit(0 if verify() else 1)
    if not a.name_map:
        p.error("--name-map is required to write")
    apply(a.name_map)
