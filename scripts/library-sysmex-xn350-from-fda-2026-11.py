"""Sysmex XN-350 in the VeritaMap library (Michael 2026-11-19: "is there a sysmex XN-350? if yes, add it to the map
database"). The library had the XN-330, XN-430, XN-450, XN-530 and XN-550 but not the XN-350.

From FDA CLIA records only (BUG-009 rules). FDA lists "Sysmex(R) XN-350 Automated Hematology Analyzer" under document
CR170022, the same document as the XN-450 and XN-550, effective 2018-06-29: nine analytes, all MODERATE, specialty
Hematology (FDA specialty ID 4). Evidence: scripts/data/fda_clia_sysmex_xn350_2026-11-19.json (FDA's bulk file
clia_detail.zip, the copy the 2026-10-09 BUG-009 review used).

The library lists the XN-L analyzers at the parameter level (the 2026-10-09 review's "parameter-level" group), so the
XN-350 lists the same 34 reportable parameters as the XN-450 entry, under the same names, so a lab running both gets one
row per test. Each parameter rides with the FDA analyte record it comes from; calculated indices ride with their measured
parent (MCV with hematocrit, MCH and MCHC with hemoglobin, RDW with the RBC count, MPV with the platelet count). Every
complexity below is read from the XN-350's own FDA record for that analyte, not taken from another entry. FDA's XN-L
records carry no separate body-fluid line; the body-fluid parameters ride on the WBC, RBC and differential records, as
they do on the library's XN-330, XN-450 and XN-550 entries.
Usage: python scripts/library-sysmex-xn350-from-fda-2026-11.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_sysmex_xn350_2026-11-19.json")
FDA_NAME = "Sysmex® XN-350 Automated Hematology Analyzer"
FDA_SIBLING = "Sysmex® XN-450 Automated Hematology Analyzer"
NAME, SIBLING = "Sysmex XN-350", "Sysmex XN-450"
VENDOR, CATEGORY, DATE, DOC = "Sysmex", "Hematology", "2026-11-19", "CR170022"
SPECIALTY = {"4": "Hematology"}  # FDA's legend (scripts/fda-menus/build_report.py)

WBC, RBC, HGB, HCT, PLT = ("White blood cell count (leukocyte count) (WBC)", "Red blood cell count (erythrocyte count) (RBC)",
                           "Hemoglobin", "Hematocrit", "Platelet count")
DIFF, IG, RET, IRF = ("White blood cell differential (WBC diff)", "IG (Immature Granulocyte) Count", "Reticulocyte count",
                      "IRF (immature reticulocyte fraction)")
# Reportable parameter -> the FDA analyte record it rides with. Same names and order as the library's XN-450 entry.
PARAMS = [
    ("WBC", WBC), ("RBC", RBC), ("HGB", HGB), ("HCT", HCT), ("MCV", HCT), ("MCH", HGB), ("MCHC", HGB), ("PLT", PLT),
    ("NEUT%", DIFF), ("NEUT#", DIFF), ("LYMPH%", DIFF), ("LYMPH#", DIFF), ("MONO%", DIFF), ("MONO#", DIFF),
    ("EO%", DIFF), ("EO#", DIFF), ("BASO%", DIFF), ("BASO#", DIFF), ("IG%", IG), ("IG#", IG),
    ("RDW-CV", RBC), ("RDW-SD", RBC), ("MPV", PLT), ("RET%", RET), ("RET#", RET), ("IRF", IRF), ("RET-He", RET),
    ("WBC-BF", WBC), ("RBC-BF", RBC), ("MN%", DIFF), ("MN#", DIFF), ("PMN%", DIFF), ("PMN#", DIFF), ("TC-BF#", WBC),
]


def main():
    verify = "--verify" in sys.argv
    src = json.load(io.open(SRC, encoding="utf-8"))
    recs = src[FDA_NAME]
    assert len(recs) == 9 and all(r["DOCUMENT_NUMBER"] == DOC and r["COMPLEXITY"] == "MODERATE" and r["SPECIALTY_ID"] == "4" for r in recs), "FDA records changed"
    fda = {r["ANALYTE_NAME"]: r for r in recs}
    assert all(a in fda for _, a in PARAMS), "a parameter names an analyte FDA does not list for the XN-350"
    tests = {p: {"complexity": fda[a]["COMPLEXITY"], "specialty": SPECIALTY[fda[a]["SPECIALTY_ID"]]} for p, a in PARAMS}
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    nl = "\r\n" if "\r\n" in raw else "\n"
    if not verify and NAME not in lib:
        entry = {"vendor": VENDOR, "category": CATEGORY, "testCount": len(tests), "tests": tests, "menuLastVerifiedAt": DATE}
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
    check(sum(1 for k in lib if "xn-350" in k.lower() or "xn350" in k.lower()) == 1, "the library holds exactly one XN-350 entry")
    if e:
        check(e["vendor"] == VENDOR and e["category"] == CATEGORY, f"vendor {VENDOR}, category {CATEGORY}")
        check(e["testCount"] == 34 == len(e["tests"]), "34 tests, testCount 34")
        check(all(e["tests"].get(p) == v for p, v in tests.items()), "every test matches its FDA record: MODERATE, Hematology")
        check(e.get("menuLastVerifiedAt") == DATE, f"menuLastVerifiedAt {DATE}")
        # Same FDA document as the XN-450, and the same parameter names, so a lab's XN-350 and XN-450 rows pair.
        sib = src[FDA_SIBLING]
        check({r["DOCUMENT_NUMBER"] for r in sib} == {DOC} and sorted(r["ANALYTE_NAME"] for r in sib) == sorted(fda),
              f"FDA lists the XN-450 under {DOC} with the same nine analytes")
        st = lib.get(SIBLING, {}).get("tests", {})
        check(list(st) == [p for p, _ in PARAMS], f"the parameter names match the {SIBLING} entry, in its order")
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
