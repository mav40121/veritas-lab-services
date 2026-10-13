"""Redington-Fairview (Brandy Morgan, REQ-039; Michael approved the 10/12 reply promising these): add the manual
microbiology kits to the VeritaMap library from FDA CLIA records only (BUG-009 rules). Each kit is a Manual Procedures
test system with its own complexity, the way the reply described it.

  AmniSure ROM Test: Placental alpha-1 microglobulin (PAMG-1), MODERATE (K081767).
  TechLab GIARDIA/CRYPTOSPORIDIUM QUIK CHEK: Giardia and Cryptosporidium antigens, MODERATE (K103673).
  TechLab C. DIFF QUIK CHEK COMPLETE: C. difficile GDH antigen and toxins A/B, MODERATE (K082499; FDA spells it "Quick").
  Cardinal Health Mono II Rapid Test: two entries because FDA splits it by specimen (CR170062): Serum/Plasma MODERATE,
    Whole Blood WAIVED. Test name matches the library's Monospot entry so the kits group with it.
Antigen kits are named as antigen tests (the Curian precedent) so they never pair with the molecular panels' organism
rows. The Alere HIV kit is NOT added until Brandy names the product (complexity depends on it).
Evidence: scripts/data/fda_clia_rfgh_micro_kits_2026-10-12.json.
Usage: python scripts/library-rfgh-micro-kits-from-fda-2026-10.py [--verify]
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "client", "src", "lib", "fdaInstrumentData.json")
SRC = os.path.join(ROOT, "scripts", "data", "fda_clia_rfgh_micro_kits_2026-10-12.json")
M, W, GI, PA, BA, MP = "MODERATE", "WAIVED", "General Immunology", "Parasitology", "Bacteriology", "Manual Procedures"
WANT = {
    "AmniSure ROM (Rupture of Fetal Membranes) Test": ("AmniSure International", MP, {
        "Placental alpha-1 microglobulin (PAMG-1)": (M, GI)}),
    "TechLab GIARDIA/CRYPTOSPORIDIUM QUIK CHEK": ("TechLab", MP, {
        "Giardia lamblia antigen": (M, PA), "Cryptosporidium antigen": (M, PA)}),
    "TechLab C. DIFF QUIK CHEK COMPLETE": ("TechLab", MP, {
        "Clostridioides difficile GDH antigen and toxins A/B": (M, BA)}),
    "Cardinal Health Mono II Rapid Test (Serum/Plasma)": ("Cardinal Health", MP, {
        "Heterophile Antibody (monospot)": (M, GI)}),
    "Cardinal Health Mono II Rapid Test (Whole Blood)": ("Cardinal Health", MP, {
        "Heterophile Antibody (monospot)": (W, GI)}),
}
# FDA analyte name behind each library test name.
FDA_ANALYTE = {"Giardia lamblia antigen": "Giardia lamblia", "Cryptosporidium antigen": "Cryptosporidium",
               "Clostridioides difficile GDH antigen and toxins A/B": "Clostridium difficile",
               "Heterophile Antibody (monospot)": "Infectious mononucleosis antibodies (mono)"}


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
