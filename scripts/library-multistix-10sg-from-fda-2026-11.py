"""Siemens Multistix 10 SG Reagent Strips, read by eye, in the VeritaMap library (Michael 2026-11-09: "add this to the test
menu"). Heywood reports single Multistix results "Advantus or manual method" (Corrine Beauvais, 11/9); the library had the
CLINITEK analyzers that read these strips but not the strips read by eye.

From FDA CLIA records only (BUG-009 rules): "Siemens MULTISTIX 10 SG Reagent Strips", 510(k) K992257, ten analytes, all
WAIVED, specialty Urinalysis, effective 05/10/2010 (record IDs 2751 to 2760). Test names are the FDA analyte names, the same
names the library's CLINITEK entries use, so a lab's strip and analyzer rows pair. FDA also lists the same strips under their
older Bayer and Ames names; those are search aliases.
Evidence: scripts/data/fda_clia_multistix_10sg_2026-11-09.json.
Usage: python scripts/library-multistix-10sg-from-fda-2026-11.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_multistix_10sg_2026-11-09.json")
FDA_NAME = "Siemens MULTISTIX 10 SG Reagent Strips"
NAME = "Siemens Multistix 10 SG Reagent Strips (visual read)"
VENDOR, CATEGORY, DATE = "Siemens Healthineers", "Manual Procedures", "2026-11-09"
ALIASES = ["Multistix 10 SG", "Bayer Multistix 10 SG Reagent Strips", "Ames Multistix 10 SG"]


def main():
    verify = "--verify" in sys.argv
    src = json.load(open(SRC, encoding="utf-8"))
    recs = src[FDA_NAME]
    assert len(recs) == 10 and all(r["COMPLEXITY"] == "WAIVED" and r["SPECIALTY"] == "Urinalysis" and r["DOCUMENT_NUMBER"] == "K992257" for r in recs), "FDA records changed"
    tests = {r["ANALYTE_NAME"]: {"complexity": r["COMPLEXITY"], "specialty": r["SPECIALTY"]} for r in recs}
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    nl = "\r\n" if "\r\n" in raw else "\n"
    if not verify and NAME not in lib:
        entry = {"vendor": VENDOR, "category": CATEGORY, "aliases": ALIASES, "testCount": len(tests), "tests": tests, "menuLastVerifiedAt": DATE}
        body = json.dumps(entry, indent=2, ensure_ascii=False).replace("\n", nl + "  ")
        end = raw.rstrip().rindex("}")  # the file's closing brace
        raw = raw[:end].rstrip() + "," + nl + "  " + json.dumps(NAME) + ": " + body + nl + raw[end:]
        io.open(LIB, "w", encoding="utf-8", newline="").write(raw)
        lib = json.loads(raw)
    fails = 0

    def check(ok, text):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), text)
        fails += 0 if ok else 1

    e = lib.get(NAME)
    check(bool(e), f"{NAME} is in the library")
    if e:
        check(e["vendor"] == VENDOR and e["category"] == CATEGORY, f"vendor {VENDOR}, category {CATEGORY}")
        check(e["testCount"] == 10 == len(e["tests"]), "10 tests, testCount 10")
        check(all(e["tests"].get(t) == v for t, v in tests.items()), "every test matches its FDA record: WAIVED, Urinalysis")
        check(e.get("aliases") == ALIASES, f"aliases {ALIASES}")
        check(all(a not in lib for a in ALIASES), "no alias collides with another library entry name")
        # The same analyte names as the CLINITEK Status entry, so a lab's strip and analyzer rows pair.
        cs = lib.get("Siemens Clinitek Status", {}).get("tests", {})
        shared = [t for t in tests if t in cs]
        check(len(shared) == 10, f"all 10 test names also appear on Siemens Clinitek Status ({len(shared)} of 10)")
    # The VeritaMap help text states the library's size by hand; it must match the library (it said 34 manual procedures).
    mp = sum(1 for v in lib.values() if v["category"] == "Manual Procedures")
    want = f"library of {len(lib) - mp} analyzers and {mp} manual procedures."
    pages = ["VeritaMapAppPage", "VeritaMapBuildPage", "VeritaMapLabwidePage", "VeritaMapMapPage", "VeritaMapResourcesPage"]
    stale = [p for p in pages if want not in io.open(os.path.join(ROOT, "client", "src", "pages", p + ".tsx"), encoding="utf-8").read()]
    check(not stale, f"the help text on {len(pages)} VeritaMap pages says '{want}'" + (f" (stale: {', '.join(stale)})" if stale else ""))
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
