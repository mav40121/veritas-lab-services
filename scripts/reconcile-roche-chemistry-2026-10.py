#!/usr/bin/env python3
"""
VeritaMap menu-accuracy sweep (item #57) -- BATCH 1: Roche chemistry c-module.

Michael 2026-10-06: verify every instrument menu is accurate/complete, not just
that the instrument exists. Roche is first (a Roche demo surfaced the cobas 8000
missing Sodium/Potassium).

Source of truth for the Roche c-module menu: Roche's own "Serum Work Area --
Clinical Chemistry and homogeneous immunoassays" consolidated parameter list
(March 2024), verified against the downloaded PDF. Roche presents one consolidated
c-module menu: c303/c501/c502/c503 share a column and c701/c702 carry that menu
plus extras, so c701/c702 >= c501. Therefore our existing, verified "Roche cobas
c 501" entry (97 analytes, with correct per-analyte complexity/specialty already
in our data) is the canonical c-module menu, and the module-scoped siblings are
leveled UP to it.

No fabrication: every analyte added here is copied from our own verified c501
entry (name + complexity + specialty), for analyzers Roche documents as running
at least the c501 menu. Nothing invented.

Scope (leveled up to c501):
  - Roche cobas c 502, Roche cobas pure, Roche cobas c 702,
    Roche cobas 8000 (c702 module), Roche cobas c 703
Deliberately NOT touched:
  - Roche cobas c 311 (Roche's documented SMALLER-subset analyzer; leveling it
    to the full menu would overstate it)
  - Roche cobas 6000 (c501 module) (already identical to c501)
  - e-module immunoassay entries (handled in a later batch; e411<e601<e801 are
    genuinely different-size menus and must not be blanket-leveled)

Dedup: exact match on lowercased+trimmed name, plus the known "Cystacin C"->
"Cystatin C" typo, so HDL/LDL/Total cholesterol etc. are never wrongly merged.
Writes CRLF + trailing newline to keep the diff additions-only.
"""
import json, os, re

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")
CANON = "Roche cobas c 501"
TARGETS = [
    "Roche cobas c 502",
    "Roche cobas pure",
    "Roche cobas c 702",
    "Roche cobas 8000 (c702 module)",
    "Roche cobas c 703",
]


def norm(name):
    s = name.strip().lower()
    s = s.replace("cystacin", "cystatin")  # known typo in the dataset
    s = re.sub(r"\s+", " ", s)
    return s


def main():
    raw = open(PATH, encoding="utf-8").read()
    d = json.loads(raw)
    canon = d[CANON]["tests"]

    report = []
    for key in TARGETS:
        tests = d[key]["tests"]
        have = {norm(a) for a in tests}
        added = []
        for analyte, meta in canon.items():
            if norm(analyte) in have:
                continue
            tests[analyte] = {"complexity": meta["complexity"], "specialty": meta["specialty"]}
            have.add(norm(analyte))
            added.append(analyte)
        d[key]["testCount"] = len(tests)
        report.append((key, len(added), d[key]["testCount"]))

    out = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    open(PATH, "wb").write(out.replace("\n", "\r\n").encode("utf-8"))

    d2 = json.loads(open(PATH, encoding="utf-8").read())
    for key, n, tc in report:
        # integrity: testCount matches, and no exact-dup names within the entry
        names = [a.lower() for a in d2[key]["tests"]]
        dup = len(names) != len(set(names))
        print(f"{key}: +{n} -> testCount {tc} | dup-names={dup} | count-ok={d2[key]['testCount']==len(d2[key]['tests'])}")
    # confirm the demo-critical gaps are now closed
    for k in ["Roche cobas 8000 (c702 module)", "Roche cobas pure", "Roche cobas c 703"]:
        t = d2[k]["tests"]
        print(f"  {k}: Na={'Sodium' in t} K={'Potassium' in t} Cl={'Chloride' in t} CRP={'C-reactive protein (CRP)' in t or any('c-reactive' in x.lower() for x in t)}")


if __name__ == "__main__":
    main()
