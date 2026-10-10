"""REQ-030 / REQ-031 (Redington-Fairview, Brandy Morgan, in-app instrument requests #3 and #4, 2026-10-09):
add the Thermo Fisher Sensititre Vizion and OptiRead readers to the VeritaMap library from the FDA CLIA
database, the library's source of truth (BUG-009 rules: FDA records only; nothing inferred).

Evidence: scripts/data/fda_clia_sensititre_readers_2026-10-10.json, every FDA record that names Vizion or
OptiRead (6 records, all antimicrobial susceptibility, all HIGH):
  Vizion:   K081520 (Vizion), K110331 (AIM autoinoculator with Vizion and AutoReader),
            K103456 (Vizion: Gram-positive, Streptococci, H. influenzae),
            K112276 (Vizion for Sensititre YeastOne plates: caspofungin, fluconazole, itraconazole,
            5-flucytosine, voriconazole)
  OptiRead: K110583 (OptiRead Autoreader 2: non-fastidious Gram-negative rods),
            K103532 (OptiRead Autoreader 2: Gram-positive cocci, fastidious and non-fastidious)
Test names are the library's names for the same tests on "Thermo Fisher Sensititre ARIS HiQ", so the
readers group with the HiQ for correlation. FDA lists no identification records for either reader, so
none is added (a lab that reads ID plates on them adds that test on its own map).

Usage: python scripts/library-sensititre-readers-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_sensititre_readers_2026-10-10.json")
GN = "Antimicrobial susceptibility testing (gram-negative)"
GP = "Antimicrobial susceptibility testing (gram-positive)"
YE = "Yeast antifungal susceptibility testing"
WANT = {
    "Thermo Fisher Sensititre Vizion": {GN: ["K081520", "K110331"], GP: ["K103456"], YE: ["K112276"]},
    "Thermo Fisher Sensititre OptiRead": {GN: ["K110583"], GP: ["K103532"]},
}


def main():
    verify = "--verify" in sys.argv
    recs = {r["DOCUMENT_NUMBER"]: r for r in json.load(open(SRC, encoding="utf-8"))["records"]}
    for name, tests in WANT.items():
        for t, docs in tests.items():
            for d in docs:
                assert d in recs and recs[d]["COMPLEXITY"].strip().upper() == "HIGH", f"{name}/{t}: FDA {d} missing or not HIGH"
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    hiq = lib["Thermo Fisher Sensititre ARIS HiQ"]["tests"]
    fails = 0
    for name, tests in WANT.items():
        assert all(t in hiq for t in tests), "test names must match the ARIS HiQ entry"
        e = lib.get(name)
        ok = bool(e) and e["vendor"] == "Thermo Fisher" and e["category"] == "Microbiology" and e["testCount"] == len(tests) \
            and set(e["tests"]) == set(tests) and all(v == {"complexity": "HIGH", "specialty": "Microbiology"} for v in e["tests"].values())
        print(("PASS" if ok else "FAIL"), name, "matches the FDA records", sorted(tests))
        fails += 0 if ok else 1
        if not e and not verify:
            sys.exit("STOP: insert by text so the rest of the file is untouched; see the 2026-10-10 commit")
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
