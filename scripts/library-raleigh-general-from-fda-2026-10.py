"""Raleigh General Hospital (Angela Cedeno, 2026-10-22 "Input" email; Michael: "she has solid points for veritamap"):
VeritaMap library fixes from FDA CLIA records only (BUG-009 rules: per test system, never cloned or inferred).

1. Cepheid GeneXpert Xpress: the entry was a copy of the full GeneXpert menu, every assay MODERATE, including assays
   that are not Xpress assays (MTB, HIV viral load). Replaced with the assays FDA categorizes on the "Cepheid GeneXpert
   Xpress System", all WAIVED: Xpress CoV-2 plus (CW240020), Xpress CoV-2/Flu/RSV plus (CW240019), Xpress Flu and
   Xpress Flu/RSV (CW190006), Xpress Strep A (CW190007), Xpress MVP: BV bacteria, Trichomonas, Candida (CW230013),
   Xpert HCV (CW240017). Xpress GBS has NO Xpress System record (it is MODERATE on the GeneXpert Dx, Infinity, Touchscreen
   and G3 systems, which keep it), so it is not listed here: Angie's "all waived except GBS" matches FDA.
2. Clinical Innovations ROM Plus (K110605): AFP, amniotic fluid (General Chemistry) and IGFBP-1 (Endocrinology), MODERATE.
3. Alcor Scientific miniiSED (CR200085): ESR, MODERATE. Test name matches the iSED entry so the two group together.
4. Beta-hCG Card (Manual): adds "hCG (urine, qualitative)", WAIVED, Endocrinology. This entry is a generic card, not one
   FDA test system, so its urine line rests on the FDA pattern: 190 of 195 card or cassette urine hCG systems are WAIVED
   (the existing serum line matches 157 of 158 card-type serum systems MODERATE). A lab confirms its own kit's listing.
Evidence: scripts/data/fda_clia_raleigh_general_2026-10-22.json.
Usage: python scripts/library-raleigh-general-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_raleigh_general_2026-10-22.json")
W, M = "WAIVED", "MODERATE"
XP_KEY = "Cepheid GeneXpert Xpress System (waived records)"
# library test name -> (complexity, specialty, evidence section, FDA document, FDA analyte)
XPRESS = {
    "Xpress SARS-CoV-2 plus": (W, "Virology", XP_KEY, "CW240020", "SARS-CoV-2"),
    "Xpress CoV-2/Flu/RSV plus": (W, "Virology", XP_KEY, "CW240019", "SARS-CoV-2 and other Respiratory viruses"),
    "Xpress Flu (A/B)": (W, "Virology", XP_KEY, "CW190006", "Influenza A/B"),
    "Xpress Flu/RSV": (W, "Virology", XP_KEY, "CW190006", "Respiratory viruses"),
    "Xpress Strep A": (W, "Bacteriology", XP_KEY, "CW190007", "Streptococcus, group A"),
    "Xpress MVP: bacterial vaginosis-associated bacteria": (W, "Bacteriology", XP_KEY, "CW230013", "Bacteria associated with bacterial vaginosis"),
    "Xpress MVP: Trichomonas vaginalis": (W, "Parasitology", XP_KEY, "CW230013", "Trichomonas"),
    "Xpress MVP: Candida (yeast)": (W, "Mycology", XP_KEY, "CW230013", "Yeast, candida only"),
    "Xpert HCV (HCV RNA, fingerstick)": (W, "General Immunology", XP_KEY, "CW240017", "HCV RNA"),
}
NEW = {
    "Clinical Innovations ROM Plus": ("Clinical Innovations", "Manual Procedures", {
        "Alpha-fetoprotein (AFP), amniotic fluid": (M, "General Chemistry", "Clinical Innovations ROM Plus", "K110605", "Alpha-fetoprotein, amniotic fluid"),
        "IGFBP-1 (insulin-like growth factor binding protein 1)": (M, "Endocrinology", "Clinical Innovations ROM Plus", "K110605", "Insulin-like growth factor bind. protein1 (IGFBP-1)")}),
    "Alcor Scientific miniiSED": ("Alcor Scientific", "ESR", {
        "Erythrocyte Sedimentation Rate (ESR)": (M, "Hematology", "Alcor Scientific miniiSED", "CR200085", "Erythrocyte sedimentation rate (non-waived proced)")}),
}
HCG_CARD, HCG_URINE = "Beta-hCG Card (Manual)", "hCG (urine, qualitative)"
VERIFIED = "2026-10-22"


def check_evidence(src):
    for t, (cx, sp, sec, doc, an) in list(XPRESS.items()) + [kv for _, (_, _, tests) in NEW.items() for kv in tests.items()]:
        assert any(r["DOCUMENT"] == doc and r["ANALYTE_NAME"] == an and r["COMPLEXITY"] == cx and r["SPECIALTY"] == sp
                   for r in src[sec]), f"{t}: no FDA record {doc} / {an} / {cx} / {sp}"
    assert all(r["COMPLEXITY"] != W for r in src["GBS on other GeneXpert systems (no Xpress System record exists)"])
    assert not any("GBS" in r["TEST_SYSTEM_NAME"] for r in src[XP_KEY]), "a GBS Xpress System record exists now: revisit"
    u = src["hCG, urine (all FDA records summarized)"]["card_or_cassette_by_complexity"]
    s = src["hCG, serum (all FDA records summarized)"]["card_or_cassette_by_complexity"]
    assert u.get(W, 0) / sum(u.values()) >= 0.95 and s.get(M, 0) / sum(s.values()) >= 0.95, (u, s)


def main():
    verify = "--verify" in sys.argv
    check_evidence(json.load(open(SRC, encoding="utf-8")))
    raw = io.open(LIB, encoding="utf-8", newline="").read()
    nl = "\r\n" if "\r\n" in raw else "\n"
    lib = json.loads(raw)
    if not verify:
        xp = lib["Cepheid GeneXpert Xpress"]
        xp["tests"] = {t: {"complexity": cx, "specialty": sp} for t, (cx, sp, *_r) in XPRESS.items()}
        xp["testCount"] = len(XPRESS); xp["menuLastVerifiedAt"] = VERIFIED
        for name, (vendor, cat, tests) in NEW.items():
            lib[name] = {"vendor": vendor, "category": cat, "testCount": len(tests),
                         "tests": {t: {"complexity": cx, "specialty": sp} for t, (cx, sp, *_r) in tests.items()},
                         "menuLastVerifiedAt": VERIFIED}
        card = lib[HCG_CARD]
        card["tests"][HCG_URINE] = {"complexity": W, "specialty": "Endocrinology"}
        card["testCount"] = len(card["tests"]); card["menuLastVerifiedAt"] = VERIFIED
        io.open(LIB, "w", encoding="utf-8", newline="").write(json.dumps(lib, indent=2, ensure_ascii=False).replace("\n", nl) + nl)
        lib = json.loads(io.open(LIB, encoding="utf-8", newline="").read())
    fails = 0

    def check(label, ok):
        nonlocal fails
        print(("PASS" if ok else "FAIL"), label); fails += 0 if ok else 1

    xp = lib.get("Cepheid GeneXpert Xpress", {})
    check("GeneXpert Xpress lists exactly the 9 FDA-waived Xpress System assays, all WAIVED",
          xp.get("testCount") == len(XPRESS) == len(xp.get("tests", {})) and all(xp["tests"].get(t) == {"complexity": cx, "specialty": sp} for t, (cx, sp, *_r) in XPRESS.items()))
    check("GeneXpert Xpress no longer carries MTB, HIV or GBS (not Xpress System assays)",
          not any(k for k in xp.get("tests", {}) if any(x in k for x in ("MTB", "HIV", "GBS", "Strep B"))))
    check("GBS still MODERATE on the other GeneXpert entries", all(lib[n]["tests"].get("Strep B (GBS)", {}).get("complexity") == M
          for n in lib if n.startswith("Cepheid GeneXpert") and n != "Cepheid GeneXpert Xpress"))
    for name, (vendor, cat, tests) in NEW.items():
        e = lib.get(name)
        check(f"{name}: {', '.join(f'{t} {cx}' for t, (cx, *_r) in tests.items())}",
              bool(e) and e["vendor"] == vendor and e["category"] == cat and e["testCount"] == len(tests) == len(e["tests"])
              and all(e["tests"].get(t) == {"complexity": cx, "specialty": sp} for t, (cx, sp, *_r) in tests.items()))
    card = lib.get(HCG_CARD, {})
    check("hCG card: urine WAIVED added, serum line unchanged (MODERATE)",
          card.get("tests", {}).get(HCG_URINE) == {"complexity": W, "specialty": "Endocrinology"}
          and card["tests"].get("hCG (serum, qualitative)", {}).get("complexity") == M and card["testCount"] == len(card["tests"]) == 2)
    check("ESR test name matches the iSED entry (they group together)",
          "Erythrocyte Sedimentation Rate (ESR)" in lib["Alcor Scientific iSED"]["tests"])
    print("ALL PASS" if not fails else f"{fails} FAILURE(S)")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
