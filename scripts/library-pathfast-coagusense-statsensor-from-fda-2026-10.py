"""Michael 2026-10-12 ("add the pathfast analyzer", "add this analyzer", "add this analzyer as well"): add three
instruments to the VeritaMap library from the FDA CLIA records he sent (BUG-009 rules: FDA records only).

  PHC PATHFAST (Immunoassay): Troponin-I, Myoglobin, CKMB, CRP, BNP, D-dimer; all MODERATE.
    D-dimer: FDA record K072288 is "PATHFAST Diagnostic System {D-Dimer Assay}" but its analyte field reads
    "Antithrombin III (ATIII)"; the library lists the assay the record clears (D-dimer) with the record's
    complexity and specialty. Evidence note in the data file.
  CoaguSense Coag-Sense PT/INR Monitoring System (Professional) (Point of Care): Prothrombin time (PT), WAIVED
    (K050243). The Self-Test home-use record (K093243) is not a lab device and is not added.
  Nova StatSensor Creatinine Hospital Meter (Point of Care): Creatinine, MODERATE (CR170203, parent K171059).

Test names are the library's most common names for the same tests, so these group with other analyzers.
Evidence: scripts/data/fda_clia_pathfast_coagusense_statsensor_2026-10-12.json.
Usage: python scripts/library-pathfast-coagusense-statsensor-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_pathfast_coagusense_statsensor_2026-10-12.json")
M, GC, GI, HE, W = "MODERATE", "General Chemistry", "General Immunology", "Hematology", "WAIVED"
WANT = {
    "PHC PATHFAST": ("PHC Corporation", "Immunoassay", {
        "Troponin-I (cardiac)": (M, GC), "Myoglobin": (M, GC), "Creatine kinase MB fraction (CKMB)": (M, GC),
        "C-reactive protein (CRP)": (M, GI), "B-type natriuretic peptide (BNP)": (M, GC), "D-dimer": (M, HE)}),
    "CoaguSense Coag-Sense PT/INR Monitoring System (Professional)": ("CoaguSense", "Point of Care", {
        "Prothrombin time (PT)": (W, HE)}),
    "Nova StatSensor Creatinine Hospital Meter": ("Nova Biomedical", "Point of Care", {
        "Creatinine": (M, GC)}),
}
# FDA analyte name per library test (the D-dimer record carries ATIII in its analyte field; see the data file).
FDA_ANALYTE = {"D-dimer": "Antithrombin III (ATIII)"}


def main():
    verify = "--verify" in sys.argv
    src = json.load(open(SRC, encoding="utf-8"))
    for name, (_, _, tests) in WANT.items():
        recs = src[name]
        for t, (cx, sp) in tests.items():
            fa = FDA_ANALYTE.get(t, t)
            assert any(r["ANALYTE_NAME"] == fa and r["COMPLEXITY"] == cx and r["SPECIALTY"] == sp for r in recs), f"{name}/{t}: no FDA record"
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    nl = "\r\n" if "\r\n" in raw else "\n"
    missing = [n for n in WANT if n not in lib]
    if missing and not verify:
        blocks = []
        for n in missing:
            vendor, cat, tests = WANT[n]
            entry = {"vendor": vendor, "category": cat, "testCount": len(tests),
                     "tests": {t: {"complexity": cx, "specialty": sp} for t, (cx, sp) in tests.items()},
                     "menuLastVerifiedAt": "2026-10-12"}
            body = json.dumps(entry, indent=2, ensure_ascii=False).replace("\n", nl + "  ")
            blocks.append("  " + json.dumps(n) + ": " + body)
        end = raw.rstrip().rindex("}")  # the file's closing brace
        head = raw[:end].rstrip()
        raw = head + "," + nl + ("," + nl).join(blocks) + nl + raw[end:]
        io.open(LIB, "w", encoding="utf-8", newline="").write(raw)
        lib = json.loads(raw)
    fails = 0
    for n, (vendor, cat, tests) in WANT.items():
        e = lib.get(n)
        ok = bool(e) and e["vendor"] == vendor and e["category"] == cat and e["testCount"] == len(tests) == len(e["tests"]) \
            and all(e["tests"].get(t) == {"complexity": cx, "specialty": sp} for t, (cx, sp) in tests.items())
        print(("PASS" if ok else "FAIL"), n, "matches the FDA records:", ", ".join(f"{t} {cx}" for t, (cx, _) in tests.items()))
        fails += 0 if ok else 1
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
