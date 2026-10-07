#!/usr/bin/env python3
"""
VeritaMap menu-accuracy sweep (item #57) -- BATCH 4: Beckman Coulter chemistry.

FINDING (why this batch is normalize-ONLY, unlike Abbott/Siemens which also added
missing assays): the Beckman chemistry entries are ALREADY well-populated (e.g.
"Beckman Coulter AU5800" carries 134 tests), and the library names analytes in a
full-name convention ("Creatine kinase (CK)", "Lactate dehydrogenase (LDH)",
"Gamma glutamyl transferase (GGT)", "Glycosylated Hemoglobin (Hgb A1c)",
"Protein, total", "Cholesterol", "Carbon dioxide, total (CO2)"), while Beckman's
published menu is abbreviation/alt-order first ("CK", "LDH", "GGT", "HbA1c",
"Total protein", "Cholesterol, total", "Carbon dioxide / bicarbonate"). A name-keyed
auto-add would therefore INSERT duplicate analytes for assays already present under
the library name. Beckman's menu was verified against source (scratchpad/
beckman_menus.json; AU menu + Protein Chemistry Menu by Platform PDFs spot-checked)
and the entries show no Roche-style gaps, so the safe, high-value action is the
complexity normalization the sweep rule calls for.

RULE (Michael-approved "normalize as you go"): Beckman AU/DxC-AU/UniCel-DxC/IMMAGE
are moderate-complexity clinical chemistry / specific-protein / integrated analyzers,
so every analyte on them is MODERATE. This fixes stray HIGH/WAIVED complexity (e.g.
Tacrolimus tagged HIGH on AU5800) without touching analyte membership or names.
Additions/completeness for Beckman are deferred to an abbreviation-aware follow-up.

Writes CRLF + trailing newline. Only complexity fields on the listed entries change.
"""
import json
import os

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")

ENTRIES = [
    "Beckman Coulter AU5800",
    "Beckman Coulter AU680",
    "Beckman Coulter AU480",
    "Beckman Coulter AU640",
    "Beckman Coulter DxC 700 AU",
    "Beckman Coulter DxC 700AU",
    "Beckman Coulter DxC 500AU",
    "Beckman Coulter DxC 500i",
    "Beckman Coulter IMMAGE 800",
]
# UniCel DxC i-series (860i/660i/880i/680i) are DEFERRED from this batch: their
# published SYNCHRON menu was only partially sourced (completeness follow-up), and
# two of their analytes ("Cortisol, urine (extraction procedure)", "Folate, red
# blood cell (RBC folate)") carry manual extraction/prep steps that can legitimately
# be HIGH complexity, so they should not be blanket-normalized. Handle in the
# abbreviation-aware UniCel follow-up.


def main():
    d = json.loads(open(PATH, encoding="utf-8").read())

    report = []
    total = 0
    for e in ENTRIES:
        if e not in d:
            report.append((e, None, []))
            continue
        tests = d[e]["tests"]
        changed = []
        for a, m in tests.items():
            if m.get("complexity") != "MODERATE":
                changed.append(f"{a}: {m.get('complexity')} -> MODERATE")
                m["complexity"] = "MODERATE"
        total += len(changed)
        d[e]["testCount"] = len(tests)
        report.append((e, len(changed), changed))

    out = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    open(PATH, "wb").write(out.replace("\n", "\r\n").encode("utf-8"))

    # Verify + report
    d2 = json.loads(open(PATH, encoding="utf-8").read())
    for e, n, changed in report:
        if n is None:
            print(f"!! {e}: NOT FOUND")
            continue
        allmod = all(m["complexity"] == "MODERATE" for m in d2[e]["tests"].values())
        names = list(d2[e]["tests"].keys())
        dup = len(names) != len(set(names))
        print(f"{e}: {n} complexity-normalized -> tc {d2[e]['testCount']} | allMODERATE={allmod} | dup={dup}")
        for c in changed:
            print(f"      {c}")
    print(f"\nTOTAL complexity values normalized to MODERATE: {total}")


if __name__ == "__main__":
    main()
