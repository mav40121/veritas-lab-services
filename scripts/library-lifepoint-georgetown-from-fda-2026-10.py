"""Lifepoint Georgetown Community Hospital (Brittany Harrison, REQ-101, 2026-10-23: "cannot find these instruments/ kits...
CA-600, Sedimat-15, Binax Legionella, Binax Strep pnuemo"): add what is missing to the VeritaMap library from FDA CLIA
records only (BUG-009 rules), and make the CA-600 findable by the names on the analyzer.

  Polymedco Sedimat 15 Plus: ESR, MODERATE (CR160437; FDA also lists SEDIPLAST ESR read on the Sedimat reader, E990048,
    MODERATE). Test name matches the library's other ESR analyzers so they pair for correlation.
  Abbott BinaxNOW Legionella Urinary Antigen Card: Legionella pneumophila serogroup 1 antigen, MODERATE (CR190368; FDA
    spells it "pneumophilia").
  Abbott BinaxNOW Streptococcus pneumoniae Antigen Card: S. pneumoniae antigen, MODERATE (CR190367; urine and CSF are both
    MODERATE). Antigen kits are named as antigen tests (the Curian precedent) so they never pair with the molecular panels'
    organism rows.
  Siemens CA-600 (already in the library, 7 tests): FDA lists the analyzer as the Sysmex (and Siemens Healthineers)
    "Automated Blood Coagulation Analyzer CA-620" and "CA-660", so the entry gets those names as search aliases. Its menu
    is unchanged; every library test on it has a CA-620/CA-660 record at the library's complexity.
Evidence: scripts/data/fda_clia_lifepoint_georgetown_2026-10-23.json.
Usage: python scripts/library-lifepoint-georgetown-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_lifepoint_georgetown_2026-10-23.json")
CA_KEY = "_Sysmex CA-600 series (CA-620, CA-660), the library's Siemens CA-600"
M, HEM, BA, MP = "MODERATE", "Hematology", "Bacteriology", "Manual Procedures"
DATE = "2026-10-23"
WANT = {
    "Polymedco Sedimat 15 Plus": ("Polymedco", "ESR", {
        "Erythrocyte Sedimentation Rate (ESR)": (M, HEM)}),
    "Abbott BinaxNOW Legionella Urinary Antigen Card": ("Abbott", MP, {
        "Legionella pneumophila serogroup 1 antigen": (M, BA)}),
    "Abbott BinaxNOW Streptococcus pneumoniae Antigen Card": ("Abbott", MP, {
        "Streptococcus pneumoniae antigen": (M, BA)}),
}
# FDA analyte name behind each library test name.
FDA_ANALYTE = {"Erythrocyte Sedimentation Rate (ESR)": "Erythrocyte sedimentation rate (non-waived proced)",
               "Legionella pneumophila serogroup 1 antigen": "Legionella pneumophilia serogroup 1 antigen",
               "Streptococcus pneumoniae antigen": "Streptococcus pneumoniae"}
CA600 = "Siemens CA-600"
CA600_ALIASES = ["Sysmex CA-600 series", "Sysmex CA-620", "Sysmex CA-660"]


def main():
    verify = "--verify" in sys.argv
    src = json.load(open(SRC, encoding="utf-8"))
    for name, (_, _, tests) in WANT.items():
        recs = src[name]
        assert recs and all(r["COMPLEXITY"] == M for r in recs), f"{name}: FDA records disagree on complexity"
        for t, (cx, sp) in tests.items():
            fa = FDA_ANALYTE.get(t, t)
            assert any(r["ANALYTE_NAME"] == fa and r["COMPLEXITY"] == cx and r["SPECIALTY"] == sp for r in recs), f"{name}/{t}: no FDA record"
    ca_recs = src[CA_KEY]
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    lib = json.loads(raw)
    nl = "\r\n" if "\r\n" in raw else "\n"
    missing = [n for n in WANT if n not in lib]
    if not verify and (missing or lib[CA600].get("aliases") != CA600_ALIASES):
        if lib[CA600].get("aliases") != CA600_ALIASES:
            # Add the aliases inside the existing CA-600 block, after its testCount line, without reformatting the file.
            start = raw.index(json.dumps(CA600) + ": {")
            anchor = raw.index('"testCount"', start)
            line_start = raw.rindex(nl, 0, anchor) + len(nl)
            indent = raw[line_start:anchor]
            raw = raw[:line_start] + indent + '"aliases": ' + json.dumps(CA600_ALIASES) + "," + nl + raw[line_start:]
        if missing:
            blocks = []
            for n in missing:
                vendor, cat, tests = WANT[n]
                entry = {"vendor": vendor, "category": cat, "testCount": len(tests),
                         "tests": {t: {"complexity": cx, "specialty": sp} for t, (cx, sp) in tests.items()},
                         "menuLastVerifiedAt": DATE}
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
    ca = lib[CA600]
    ok = ca.get("aliases") == CA600_ALIASES and ca["testCount"] == 7 == len(ca["tests"])
    print(("PASS" if ok else "FAIL"), CA600, "carries the aliases", CA600_ALIASES, "and keeps its 7 tests")
    fails += 0 if ok else 1
    # Every CA-600 library test has a CA-620/CA-660 record at the library's complexity (the alias is the same analyzer).
    for t, v in ca["tests"].items():
        ok = any(r["ANALYTE_NAME"] == t and r["COMPLEXITY"] == v["complexity"] for r in ca_recs)
        print(("PASS" if ok else "FAIL"), f"{CA600} / {t} {v['complexity']} has a CA-620/CA-660 FDA record")
        fails += 0 if ok else 1
    known = {n for n in lib}
    ok = all(a not in known for a in CA600_ALIASES)
    print(("PASS" if ok else "FAIL"), "no alias collides with another library entry name")
    fails += 0 if ok else 1
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
