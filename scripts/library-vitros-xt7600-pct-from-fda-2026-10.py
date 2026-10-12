"""BUG-042 (2026-10-12, Redington-Fairview via Michael: "For vitros 7600 it appears to be missing procalcitonin and TSH"):
add Procalcitonin (PCT) to the "Ortho VITROS XT 7600" VeritaMap library menu from the FDA CLIA database (BUG-009 rules:
FDA records only; nothing inferred).

Cause: FDA's PCT record names two instruments, "Ortho-Clinical Diagnostics VITROS 5600/ XT7600 Integrated System
{BRAHMS PCT}" (CR200191, parent K200236, MODERATE, Endocrinology). The 2026-10-09 menu rebuild
(scripts/fda-menus/name_map.json) assigned that system to the VITROS 5600 only, so the XT 7600 never got it. A scan of
every FDA system name with "/" in name_map.json found no other record that names two library instruments and reached
only one ("Vitros 3600/Vitros 5600" went to both).

TSH is NOT added: no FDA record names the XT 7600 for TSH (only 5600, 3600, ECi/ECiQ). Evidence:
scripts/data/fda_clia_vitros_xt7600_pct_2026-10-12.json.

Usage: python scripts/library-vitros-xt7600-pct-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_vitros_xt7600_pct_2026-10-12.json")
NAME, TEST = "Ortho VITROS XT 7600", "Procalcitonin (PCT)"
WANT = {"complexity": "MODERATE", "specialty": "Endocrinology"}


def main():
    verify = "--verify" in sys.argv
    rec = json.load(open(SRC, encoding="utf-8"))["records"][0]
    assert "XT7600" in rec["TEST_SYSTEM_NAME"] and rec["COMPLEXITY"] == "MODERATE" and rec["ANALYTE_NAME"] == TEST, "FDA record does not support the add"
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    assert lib["Ortho VITROS 5600"]["tests"][TEST] == WANT, "test name/specialty must match the VITROS 5600 entry"
    e = lib[NAME]
    if TEST not in e["tests"] and not verify:
        nl = "\r\n" if "\r\n" in raw else "\n"
        i = raw.index(f'"{NAME}": {{')
        j = raw.index('"menuLastVerifiedAt"', i)
        k = raw.rindex("}", i, j)          # closes "tests": {
        last = raw.rindex("}", i, k)       # closes the last test object
        ins = f',{nl}      "{TEST}": {{{nl}        "complexity": "MODERATE",{nl}        "specialty": "Endocrinology"{nl}      }}'
        raw = raw[: last + 1] + ins + raw[last + 1:]
        n0 = e["testCount"]
        a = raw.index('"testCount": ', i)
        b = raw.index(",", a)
        raw = raw[:a] + f'"testCount": {n0 + 1}' + raw[b:]
        io.open(LIB, "w", encoding="utf-8", newline="").write(raw)
        lib = json.loads(raw)
        e = lib[NAME]
    ok = e["tests"].get(TEST) == WANT and e["testCount"] == len(e["tests"]) and "Thyroid stimulating hormone (TSH)" not in e["tests"]
    print(("PASS" if ok else "FAIL"), f"{NAME}: {TEST} MODERATE/Endocrinology from FDA CR200191; testCount {e['testCount']} = {len(e['tests'])} tests; TSH not added (no FDA record)")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
