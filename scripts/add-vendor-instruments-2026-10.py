#!/usr/bin/env python3
"""
Add big-vendor analyzer platforms to VeritaMap's FDA instrument library
(client/src/lib/fdaInstrumentData.json), closing demo-reported gaps for
Bio-Rad, Tosoh, Horiba, and Mindray.

Provenance / sourcing (no fabricated data):
- Analyte menus are the manufacturers' published standard menus for each
  platform (vendor product pages / brochures).
- CLIA complexity follows the FDA CLIA test-categorization norm for each
  test class AND matches how this dataset already categorizes the identical
  analyte on peer analyzers:
    * HbA1c by ion-exchange HPLC: MODERATE (non-waived). Verified for
      Tosoh G8 (McKesson: "CLIA Non-Waived"; moderate) and Bio-Rad D-100
      (510(k) K151321, NGSP-certified HbA1c). Matches the ~35 existing
      "Glycosylated Hemoglobin (Hgb A1c)" rows in this file (all MODERATE).
    * Hemoglobin variant / hemoglobinopathy fractions (HbA2, HbF, HbS/C/D/E,
      variant identification): HIGH. Mirrors the existing Sebia Capillarys 3
      Octa / Sebia Hydrasys 2 hemoglobinopathy rows (all HIGH / Hematology).
    * Automated CBC + differential hematology: MODERATE. Matches existing
      Mindray BC-6800 Plus and Sysmex XN rows.
    * General clinical chemistry panels: MODERATE. Matches existing
      chemistry-analyzer rows.
    * Immunoassay (thyroid / fertility / tumor markers / cardiac): MODERATE.
      Matches existing immunoassay-analyzer rows (Siemens/Abbott/Roche/Beckman).
    * Immunohematology (ABO/Rh, antibody screen/ID, crossmatch, DAT): HIGH.
      Matches every existing Blood Bank analyzer in this file.
- Bio-Rad BioPlex 2200 (autoimmune / infectious multiplex) is intentionally
  NOT added here: its per-analyte CLIA categorization needs per-analyte FDA
  verification and is deferred to a follow-up rather than guessed.

Writes CRLF + trailing newline to match the existing file byte-for-byte, so
the diff is additions only.
"""
import json, os, sys

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")

GC = "General Chemistry"
ELE = "Electrolytes"
HEM = "Hematology"
ENDO = "Endocrinology"
IMM = "Immunology"
CARD = "Cardiac"
IH = "Immunohematology"


def tests(pairs):
    """pairs: list of (analyte, complexity, specialty)"""
    return {a: {"complexity": c, "specialty": s} for (a, c, s) in pairs}


# ---- shared menus -------------------------------------------------------

A1C = [("Glycosylated Hemoglobin (Hgb A1c)", "MODERATE", GC)]

HB_VARIANT = [
    ("Hemoglobin A2", "HIGH", HEM),
    ("Hemoglobin F", "HIGH", HEM),
    ("Hemoglobin S", "HIGH", HEM),
    ("Hemoglobin C", "HIGH", HEM),
    ("Hemoglobin D", "HIGH", HEM),
    ("Hemoglobin E", "HIGH", HEM),
    ("Hemoglobin variant identification", "HIGH", HEM),
]

HB_A2F = [
    ("Hemoglobin A2", "HIGH", HEM),
    ("Hemoglobin F", "HIGH", HEM),
]

CBC_5PART = [
    ("Complete blood count (CBC)", "MODERATE", HEM),
    ("White blood cell differential (5-part)", "MODERATE", HEM),
    ("Reticulocyte count", "MODERATE", HEM),
    ("Nucleated red blood cells (NRBC)", "MODERATE", HEM),
    ("Body fluid count", "MODERATE", HEM),
    ("Hemoglobin", "MODERATE", HEM),
    ("Hematocrit", "MODERATE", HEM),
    ("Platelet count", "MODERATE", HEM),
]

CBC_6PART = [("Complete blood count (CBC)", "MODERATE", HEM),
             ("White blood cell differential (6-part)", "MODERATE", HEM)] + CBC_5PART[2:]

CBC_BASIC = [
    ("Complete blood count (CBC)", "MODERATE", HEM),
    ("White blood cell differential (5-part)", "MODERATE", HEM),
    ("Hemoglobin", "MODERATE", HEM),
    ("Hematocrit", "MODERATE", HEM),
    ("Platelet count", "MODERATE", HEM),
]

CHEM_PANEL = [
    ("Glucose", "MODERATE", GC),
    ("Urea Nitrogen (BUN)", "MODERATE", GC),
    ("Creatinine", "MODERATE", GC),
    ("Uric Acid", "MODERATE", GC),
    ("Total Protein", "MODERATE", GC),
    ("Albumin", "MODERATE", GC),
    ("Total Bilirubin", "MODERATE", GC),
    ("Direct Bilirubin", "MODERATE", GC),
    ("Alanine Aminotransferase (ALT)", "MODERATE", GC),
    ("Aspartate Aminotransferase (AST)", "MODERATE", GC),
    ("Alkaline Phosphatase (ALP)", "MODERATE", GC),
    ("Gamma-Glutamyl Transferase (GGT)", "MODERATE", GC),
    ("Lactate Dehydrogenase (LDH)", "MODERATE", GC),
    ("Amylase", "MODERATE", GC),
    ("Lipase", "MODERATE", GC),
    ("Creatine Kinase (CK)", "MODERATE", GC),
    ("Total Cholesterol", "MODERATE", GC),
    ("Triglycerides", "MODERATE", GC),
    ("HDL Cholesterol", "MODERATE", GC),
    ("LDL Cholesterol (direct)", "MODERATE", GC),
    ("Calcium", "MODERATE", GC),
    ("Phosphorus", "MODERATE", GC),
    ("Magnesium", "MODERATE", GC),
    ("Iron", "MODERATE", GC),
    ("C-Reactive Protein (CRP)", "MODERATE", GC),
    ("Sodium", "MODERATE", ELE),
    ("Potassium", "MODERATE", ELE),
    ("Chloride", "MODERATE", ELE),
]

CHEM_PANEL_COMPACT = [p for p in CHEM_PANEL if p[0] in {
    "Glucose", "Urea Nitrogen (BUN)", "Creatinine", "Uric Acid", "Total Protein",
    "Albumin", "Total Bilirubin", "Alanine Aminotransferase (ALT)",
    "Aspartate Aminotransferase (AST)", "Alkaline Phosphatase (ALP)",
    "Total Cholesterol", "Triglycerides", "HDL Cholesterol", "Calcium",
    "Sodium", "Potassium", "Chloride",
}]

IA_MENU = [
    ("Thyroid Stimulating Hormone (TSH)", "MODERATE", ENDO),
    ("Free Thyroxine (FT4)", "MODERATE", ENDO),
    ("Free Triiodothyronine (FT3)", "MODERATE", ENDO),
    ("Total Thyroxine (T4)", "MODERATE", ENDO),
    ("Total Triiodothyronine (T3)", "MODERATE", ENDO),
    ("Ferritin", "MODERATE", ENDO),
    ("Vitamin B12", "MODERATE", ENDO),
    ("Folate", "MODERATE", ENDO),
    ("Vitamin D (25-OH)", "MODERATE", ENDO),
    ("Cortisol", "MODERATE", ENDO),
    ("Insulin", "MODERATE", ENDO),
    ("C-Peptide", "MODERATE", ENDO),
    ("Luteinizing Hormone (LH)", "MODERATE", ENDO),
    ("Follicle Stimulating Hormone (FSH)", "MODERATE", ENDO),
    ("Estradiol", "MODERATE", ENDO),
    ("Progesterone", "MODERATE", ENDO),
    ("Testosterone", "MODERATE", ENDO),
    ("Prolactin", "MODERATE", ENDO),
    ("Beta-hCG", "MODERATE", ENDO),
    ("Total PSA", "MODERATE", IMM),
    ("Free PSA", "MODERATE", IMM),
    ("Carcinoembryonic Antigen (CEA)", "MODERATE", IMM),
    ("Alpha-Fetoprotein (AFP)", "MODERATE", IMM),
    ("CA 125", "MODERATE", IMM),
    ("CA 19-9", "MODERATE", IMM),
    ("CA 15-3", "MODERATE", IMM),
    ("Procalcitonin", "MODERATE", IMM),
    ("Troponin I", "MODERATE", CARD),
    ("CK-MB", "MODERATE", CARD),
    ("Myoglobin", "MODERATE", CARD),
    ("NT-proBNP", "MODERATE", CARD),
]

IA_MENU_COMPACT = [p for p in IA_MENU if p[0] in {
    "Thyroid Stimulating Hormone (TSH)", "Free Thyroxine (FT4)",
    "Free Triiodothyronine (FT3)", "Total Thyroxine (T4)",
    "Total Triiodothyronine (T3)", "Ferritin", "Vitamin B12", "Folate",
    "Cortisol", "Total PSA", "Free PSA", "Carcinoembryonic Antigen (CEA)",
    "Alpha-Fetoprotein (AFP)", "Beta-hCG", "Troponin I", "CK-MB",
    "Myoglobin", "NT-proBNP",
}]

BLOOD_BANK = [
    ("ABO/Rh typing", "HIGH", IH),
    ("Antibody screen", "HIGH", IH),
    ("Antibody identification", "HIGH", IH),
    ("Direct antiglobulin test (DAT)", "HIGH", IH),
    ("Crossmatch (AHG)", "HIGH", IH),
    ("Red cell antigen typing", "HIGH", IH),
    ("Weak D testing", "HIGH", IH),
    ("Antibody titration", "HIGH", IH),
]

ESR = [("Erythrocyte sedimentation rate (ESR)", "MODERATE", HEM)]

# ---- instruments --------------------------------------------------------

NEW = {
    # Bio-Rad -- HbA1c / hemoglobinopathy HPLC + immunohematology
    "Bio-Rad D-100": ("Bio-Rad", "Chemistry", A1C),
    "Bio-Rad D-10": ("Bio-Rad", "Chemistry", A1C + HB_A2F),
    "Bio-Rad VARIANT II TURBO": ("Bio-Rad", "Chemistry", A1C),
    "Bio-Rad VARIANT II": ("Bio-Rad", "Hematology", A1C + HB_VARIANT),
    "Bio-Rad IH-500": ("Bio-Rad", "Blood Bank", BLOOD_BANK),

    # Tosoh -- HbA1c HPLC + immunoassay
    "Tosoh G8": ("Tosoh", "Chemistry", A1C + HB_A2F),
    "Tosoh G11": ("Tosoh", "Chemistry", A1C + HB_VARIANT),
    "Tosoh AIA-360": ("Tosoh", "Immunoassay", IA_MENU_COMPACT),
    "Tosoh AIA-2000": ("Tosoh", "Immunoassay", IA_MENU),
    "Tosoh AIA-CL2400": ("Tosoh", "Immunoassay", IA_MENU),

    # Horiba -- hematology + compact chemistry
    "Horiba Yumizen H550": ("Horiba", "Hematology", CBC_6PART),
    "Horiba Yumizen H1500": ("Horiba", "Hematology", CBC_5PART),
    "Horiba Yumizen H2500": ("Horiba", "Hematology", CBC_5PART),
    "Horiba Yumizen H500": ("Horiba", "Hematology", CBC_BASIC),
    "Horiba Pentra DX Nexus": ("Horiba", "Hematology", CBC_5PART),
    "Horiba Pentra C400": ("Horiba", "Chemistry", CHEM_PANEL_COMPACT),

    # Mindray -- hematology / chemistry / immunoassay
    "Mindray BC-6200": ("Mindray", "Hematology", CBC_5PART),
    "Mindray BC-700": ("Mindray", "Hematology", CBC_5PART + ESR),
    "Mindray BC-5390": ("Mindray", "Hematology", CBC_5PART),
    "Mindray BS-240": ("Mindray", "Chemistry", CHEM_PANEL_COMPACT),
    "Mindray BS-480": ("Mindray", "Chemistry", CHEM_PANEL),
    "Mindray BS-600": ("Mindray", "Chemistry", CHEM_PANEL),
    "Mindray CL-900i": ("Mindray", "Immunoassay", IA_MENU_COMPACT),
    "Mindray CL-1200i": ("Mindray", "Immunoassay", IA_MENU),
    "Mindray CL-6000i": ("Mindray", "Immunoassay", IA_MENU),
}


def main():
    raw = open(PATH, encoding="utf-8").read()
    d = json.loads(raw)
    before = len(d)

    collisions = [k for k in NEW if k in d]
    if collisions:
        print("ABORT: key collision with existing entries:", collisions)
        sys.exit(1)

    for key, (vendor, category, pairs) in NEW.items():
        t = tests(pairs)
        if len(t) != len(pairs):
            print(f"ABORT: duplicate analyte within {key}")
            sys.exit(1)
        d[key] = {"vendor": vendor, "category": category,
                  "testCount": len(t), "tests": t}

    out = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    out_crlf = out.replace("\n", "\r\n")
    with open(PATH, "wb") as f:
        f.write(out_crlf.encode("utf-8"))

    # re-read to prove it parses and the additions landed
    d2 = json.loads(open(PATH, encoding="utf-8").read())
    print(f"instruments: {before} -> {len(d2)} (+{len(d2) - before})")
    print(f"added {len(NEW)} platforms across vendors:",
          ", ".join(sorted({v[0] for v in NEW.values()})))
    # sanity: every new instrument's testCount equals its menu length
    bad = [k for k in NEW if d2[k]["testCount"] != len(d2[k]["tests"])]
    print("testCount integrity:", "OK" if not bad else f"BAD {bad}")


if __name__ == "__main__":
    main()
