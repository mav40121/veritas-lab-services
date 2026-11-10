#!/usr/bin/env python3
"""Receipt for the regulatory citation repair (site review 2026-11-05: CHK-01, R-009 to R-021, R-065 to R-067, SCN-01).

Checks, printing PASS or FAIL per case and exiting non-zero on any FAIL:
  1. Every CAP requirement number used in client/src, server and shared exists in the CAP checklists (MAS_*.xlsx), when
     those files are available. Existence only: whether a number fits its row is a human reading of the requirement.
  2. teaData in client/src/lib/cliaTeaData.ts matches the expected set below, row for row. The expected set was taken
     from the eCFR tables on 2026-11-05 (42 CFR 493.927, .931, .933, .937, .941, .959; renderer date 2026-11-03).
  3. CLIA_PRESETS in VeritaCheckPage.tsx matches that set, and the dropdown shows every preset under its own section.
  4. Numbers and paragraphs that were found wrong stay out of the VeritaCheck PDF table, the VeritaScan crosswalk, the
     sample reports and the stored PDFs.

Run: python scripts/verify-citations-tea-cap.py
Set CAP_CHECKLIST_DIR to read the checklists from another folder. The CAP and stored-PDF cases print SKIP, not FAIL,
when the checklists, openpyxl or PyMuPDF are not available.
"""
import base64
import glob
import io
import os
import re
import site
import sys
import warnings

warnings.filterwarnings("ignore")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAP_DIR = os.environ.get("CAP_CHECKLIST_DIR", r"C:\Users\veril\OneDrive - veritaslabservices com\Lab\Regulatory\2026 Cap checklists")
HELD = "ANP|CHM|COM|CYP|DRA|GEN|HEM|IMM|MIC|POC|TRM|URN"
ID_RE = re.compile(r"\b((?:" + HELD + r")\.\d{5})\b")

# Numbers still in the repo that belong to another fix group's file. Printed as OPEN, not failed, and named in the report.
KNOWN_OPEN = {}

CHEM, IMMU, ENDO, TOX, HEME, IH = "§493.931", "§493.927", "§493.933", "§493.937", "§493.941", "§493.959"
PN = "±2 dilutions or positive or negative"
RN = "Reactive (positive) or nonreactive (negative)"
EXPECTED = {
    # §493.931 Table 2
    "Alanine Aminotransferase (ALT/SGPT)": ("±15% or ±6 U/L (greater)", CHEM), "Albumin": ("±8%", CHEM), "Alkaline Phosphatase": ("±20%", CHEM),
    "Amylase": ("±20%", CHEM), "Aspartate Aminotransferase (AST/SGOT)": ("±15% or ±6 U/L (greater)", CHEM), "Bilirubin, Total": ("±20% or ±0.4 mg/dL (greater)", CHEM),
    "Blood Gas pCO2": ("±8% or ±5 mm Hg (greater)", CHEM), "Blood Gas pO2": ("±15% or ±15 mmHg (greater)", CHEM), "Blood Gas pH": ("±0.04", CHEM),
    "B-Natriuretic Peptide (BNP)": ("±30%", CHEM), "Pro B-Natriuretic Peptide (proBNP)": ("±30%", CHEM), "Calcium, Total": ("±1.0 mg/dL", CHEM),
    "Carbon Dioxide (CO2/Bicarbonate)": ("±20%", CHEM), "Chloride": ("±5%", CHEM), "Cholesterol, Total": ("±10%", CHEM), "Cholesterol, HDL": ("±20% or ±6 mg/dL (greater)", CHEM),
    "Cholesterol, LDL (direct)": ("±20%", CHEM), "Creatine Kinase (CK)": ("±20%", CHEM), "CK-MB Isoenzymes": ("±25% or ±3 ng/mL (greater) or MB elevated (presence or absence)", CHEM),
    "Creatinine": ("±10% or ±0.2 mg/dL (greater)", CHEM), "Ferritin": ("±20%", CHEM), "Gamma Glutamyl Transferase (GGT)": ("±15% or ±5 U/L (greater)", CHEM),
    "Glucose (excluding home use devices)": ("±8% or ±6 mg/dL (greater)", CHEM), "Hemoglobin A1c (HbA1c)": ("±8%", CHEM), "Iron, Total": ("±15%", CHEM),
    "Lactate Dehydrogenase (LDH)": ("±15%", CHEM), "Magnesium": ("±15%", CHEM), "Phosphorus": ("±10% or ±0.3 mg/dL (greater)", CHEM), "Potassium": ("±0.3 mmol/L", CHEM),
    "Prostate Specific Antigen (PSA), Total": ("±20% or ±0.2 ng/mL (greater)", CHEM), "Sodium": ("±4 mmol/L", CHEM), "Total Iron Binding Capacity (TIBC)": ("±20%", CHEM),
    "Total Protein": ("±8%", CHEM), "Triglycerides": ("±15%", CHEM), "Troponin I": ("±30% or ±0.9 ng/mL (greater)", CHEM), "Troponin T": ("±30% or ±0.2 ng/mL (greater)", CHEM),
    "Urea Nitrogen (BUN)": ("±9% or ±2 mg/dL (greater)", CHEM), "Uric Acid": ("±10%", CHEM),
    # §493.927 Table 2
    "Alpha-1 Antitrypsin": ("±20%", IMMU), "Alpha-Fetoprotein (AFP, tumor marker)": ("±20%", IMMU), "Antinuclear Antibody (ANA)": (PN, IMMU), "Antistreptolysin O (ASO)": (PN, IMMU),
    "Anti-HIV": (RN, IMMU), "Complement C3": ("±15%", IMMU), "Complement C4": ("±20% or ±5 mg/dL (greater)", IMMU), "C-Reactive Protein (hs-CRP)": ("±30% or ±1 mg/L (greater)", IMMU),
    "HBsAg (Hepatitis B Surface Antigen)": (RN, IMMU), "Anti-HBc (Hepatitis B Core Antibody)": (RN, IMMU), "HBeAg (Hepatitis B e Antigen)": (RN, IMMU),
    "Anti-HBs (Hepatitis B Surface Antibody)": (RN, IMMU), "Anti-HCV (Hepatitis C Antibody)": (RN, IMMU), "IgA": ("±20%", IMMU), "IgE": ("±20%", IMMU), "IgG": ("±20%", IMMU), "IgM": ("±20%", IMMU),
    "Infectious Mononucleosis": (PN, IMMU), "Rheumatoid Factor (RF)": (PN, IMMU), "Rubella": ("±2 dilutions or positive or negative or immune or nonimmune", IMMU),
    # §493.933 Table 2
    "Cancer Antigen 125 (CA-125)": ("±20%", ENDO), "Carcinoembryonic Antigen (CEA)": ("±15% or ±1 ng/mL (greater)", ENDO), "Cortisol": ("±20%", ENDO), "Estradiol": ("±30%", ENDO),
    "Folate, Serum": ("±30% or ±1 ng/mL (greater)", ENDO), "Follicle Stimulating Hormone (FSH)": ("±18% or ±2 IU/L (greater)", ENDO), "Free Thyroxine (Free T4)": ("±15% or ±0.3 ng/dL (greater)", ENDO),
    "Human Chorionic Gonadotropin (hCG)": ("±18% or ±3 mIU/mL (greater) or positive or negative", ENDO), "Luteinizing Hormone (LH)": ("±20%", ENDO), "Parathyroid Hormone (PTH)": ("±30%", ENDO),
    "Progesterone": ("±25%", ENDO), "Prolactin": ("±20%", ENDO), "Testosterone": ("±30% or ±20 ng/dL (greater)", ENDO), "T3 Uptake": ("±18%", ENDO), "Triiodothyronine (T3)": ("±30%", ENDO),
    "Thyroid Stimulating Hormone (TSH)": ("±20% or ±0.2 mIU/L (greater)", ENDO), "Thyroxine (T4)": ("±20% or ±1.0 mcg/dL (greater)", ENDO), "Vitamin B12": ("±25% or ±30 pg/mL (greater)", ENDO),
    # §493.937 Table 2
    "Acetaminophen": ("±15% or ±3 mcg/mL (greater)", TOX), "Alcohol, Blood (Ethanol)": ("±20%", TOX), "Blood Lead": ("±10% or ±2 mcg/dL (greater)", TOX), "Carbamazepine": ("±20% or ±1.0 mcg/mL (greater)", TOX),
    "Digoxin": ("±15% or ±0.2 ng/mL (greater)", TOX), "Gentamicin": ("±25%", TOX), "Lithium": ("±15% or ±0.3 mmol/L (greater)", TOX), "Phenobarbital": ("±15% or ±2 mcg/mL (greater)", TOX),
    "Phenytoin (Dilantin)": ("±15% or ±2 mcg/mL (greater)", TOX), "Salicylate": ("±15% or ±2 mcg/mL (greater)", TOX), "Theophylline": ("±20%", TOX), "Tobramycin": ("±20%", TOX),
    "Valproic Acid, Total": ("±20%", TOX), "Vancomycin": ("±15% or ±2 mcg/mL (greater)", TOX),
    # §493.941 Table 2 (prothrombin time is one row in the CFR, "seconds or INR"; the site lists PT and INR separately)
    "Cell Identification": ("80% or greater consensus on identification", HEME),
    "White Blood Cell Differential": ("±3 SD based on the percentage of different types of white blood cells in the samples", HEME),
    "CBC - RBC (Red Blood Cell Count)": ("±4%", HEME), "CBC - Hematocrit": ("±4%", HEME), "CBC - Hemoglobin": ("±4%", HEME), "CBC - WBC (White Blood Cell Count)": ("±10%", HEME),
    "CBC - Platelet Count": ("±25%", HEME), "Fibrinogen": ("±20%", HEME), "Partial Thromboplastin Time (PTT/aPTT)": ("±15%", HEME), "Prothrombin Time (PT)": ("±15%", HEME),
    "INR (International Normalized Ratio)": ("±15%", HEME),
    # §493.959 Table 2
    "ABO Group": ("100% accuracy", IH), "Rh Group (D typing)": ("100% accuracy", IH), "Antibody Detection (Unexpected Antibodies)": ("100% accuracy", IH),
    "Compatibility Testing (Crossmatch)": ("100% accuracy", IH), "Antibody Identification": ("80%+ accuracy", IH),
}
PRESET_ANALYTE = {
    "ALT/SGPT": "Alanine Aminotransferase (ALT/SGPT)", "Albumin": "Albumin", "Alkaline Phosphatase": "Alkaline Phosphatase", "Amylase": "Amylase", "AST": "Aspartate Aminotransferase (AST/SGOT)",
    "Bilirubin, Total": "Bilirubin, Total", "BNP": "B-Natriuretic Peptide (BNP)", "proBNP": "Pro B-Natriuretic Peptide (proBNP)", "Carbon Dioxide / Serum CO2 / Bicarbonate": "Carbon Dioxide (CO2/Bicarbonate)",
    "pCO2, Blood Gas Analyzer": "Blood Gas pCO2", "Blood Gas pO2": "Blood Gas pO2", "Blood Gas pH": "Blood Gas pH", "Calcium, Total": "Calcium, Total", "Chloride": "Chloride", "Cholesterol, Total": "Cholesterol, Total",
    "Cholesterol, HDL": "Cholesterol, HDL", "Cholesterol, LDL Direct": "Cholesterol, LDL (direct)", "CK": "Creatine Kinase (CK)", "CK-MB": "CK-MB Isoenzymes", "Creatinine": "Creatinine", "Ferritin": "Ferritin",
    "GGT": "Gamma Glutamyl Transferase (GGT)", "Glucose": "Glucose (excluding home use devices)", "Hemoglobin A1c": "Hemoglobin A1c (HbA1c)", "Iron, Total": "Iron, Total", "LDH": "Lactate Dehydrogenase (LDH)",
    "Magnesium": "Magnesium", "Phosphorus": "Phosphorus", "Potassium": "Potassium", "PSA, Total": "Prostate Specific Antigen (PSA), Total", "Sodium": "Sodium", "TIBC Direct": "Total Iron Binding Capacity (TIBC)",
    "Total Protein": "Total Protein", "Triglycerides": "Triglycerides", "Troponin I": "Troponin I", "Troponin T": "Troponin T", "Urea Nitrogen/BUN": "Urea Nitrogen (BUN)", "Uric Acid": "Uric Acid",
    "CA-125": "Cancer Antigen 125 (CA-125)", "CEA": "Carcinoembryonic Antigen (CEA)", "Cortisol": "Cortisol", "Estradiol": "Estradiol", "Folate, Serum": "Folate, Serum", "FSH": "Follicle Stimulating Hormone (FSH)",
    "Free T4": "Free Thyroxine (Free T4)", "hCG": "Human Chorionic Gonadotropin (hCG)", "LH": "Luteinizing Hormone (LH)", "Parathyroid Hormone": "Parathyroid Hormone (PTH)", "Progesterone": "Progesterone",
    "Prolactin": "Prolactin", "Testosterone": "Testosterone", "T3 Uptake": "T3 Uptake", "T3, Total": "Triiodothyronine (T3)", "TSH": "Thyroid Stimulating Hormone (TSH)", "T4, Thyroxine": "Thyroxine (T4)",
    "Vitamin B12": "Vitamin B12", "Acetaminophen": "Acetaminophen", "Alcohol, Blood": "Alcohol, Blood (Ethanol)", "Blood Lead": "Blood Lead", "Carbamazepine": "Carbamazepine", "Digoxin": "Digoxin",
    "Gentamicin": "Gentamicin", "Lithium": "Lithium", "Phenobarbital": "Phenobarbital", "Phenytoin": "Phenytoin (Dilantin)", "Salicylate": "Salicylate", "Theophylline": "Theophylline", "Tobramycin": "Tobramycin",
    "Valproic Acid, Total": "Valproic Acid, Total", "Vancomycin": "Vancomycin", "Erythrocyte Count / RBC": "CBC - RBC (Red Blood Cell Count)", "Fibrinogen": "Fibrinogen", "Hematocrit": "CBC - Hematocrit",
    "Hemoglobin": "CBC - Hemoglobin", "Leukocyte Count / WBC": "CBC - WBC (White Blood Cell Count)", "Partial Thromboplastin Time": "Partial Thromboplastin Time (PTT/aPTT)", "Platelet Count": "CBC - Platelet Count",
    "Prothrombin Time / PT": "Prothrombin Time (PT)",
}
# The day EXPECTED was taken from the eCFR. Every VeritaCheck PDF prints this date, so redo the comparison before changing it.
ECFR_COMPARED_ON = "2026-11-05"
LAB_SET = {"Lipase", "Bilirubin, Direct", "Bilirubin, Unbound", "Iron Saturation", "Vitamin D, 25-Hydroxy", "Procalcitonin", "Custom"}

fails = 0
passes = 0


def check(name, ok, detail=""):
    global fails, passes
    if ok:
        passes += 1
        print(f"PASS  {name}")
    else:
        fails += 1
        print(f"FAIL  {name}" + (f"  -> {detail}" if detail else ""))


def read(rel):
    return io.open(os.path.join(ROOT, rel), encoding="utf-8").read()


# ── 1. CAP numbers ───────────────────────────────────────────────────────────
print("== CAP numbers against the checklists")
known = None
try:
    import openpyxl
    files = glob.glob(os.path.join(CAP_DIR, "MAS_*.xlsx"))
    if files:
        known = set()
        for path in files:
            for ws in openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets:
                for row in ws.iter_rows(values_only=True):
                    if row and isinstance(row[0], str) and ID_RE.fullmatch(row[0].strip()):
                        known.add(row[0].strip())
except ImportError:
    pass
used = {}
for top in ("client/src", "server", "shared"):
    for dp, dn, fn in os.walk(os.path.join(ROOT, top)):
        dn[:] = [d for d in dn if d != "node_modules"]
        for f in fn:
            if f.endswith((".ts", ".tsx", ".js", ".json")):
                p = os.path.join(dp, f)
                try:
                    t = io.open(p, encoding="utf-8").read()
                except UnicodeDecodeError:
                    continue
                for i in set(ID_RE.findall(t)):
                    used.setdefault(i, set()).add(os.path.relpath(p, ROOT).replace("\\", "/"))
if known is None:
    print(f"SKIP  CAP checklists or openpyxl not available ({CAP_DIR}); {len(used)} numbers not checked")
else:
    print(f"      {len(known)} requirement numbers in {len(files)} checklists; {len(used)} used in the repo")
    by_file = {}
    for i, fs_ in used.items():
        for f in fs_:
            by_file.setdefault(f, []).append(i)
    for f in sorted(by_file):
        missing = sorted(i for i in by_file[f] if i not in known and i not in KNOWN_OPEN)
        check(f"{f}: {len(by_file[f])} CAP numbers all exist", not missing, ", ".join(missing))
    for i, why in KNOWN_OPEN.items():
        if i in used and i not in known:
            print(f"OPEN  {i}: {why}")

# ── 2. TEa table ─────────────────────────────────────────────────────────────
print("== teaData against the eCFR tables")
src = read("client/src/lib/cliaTeaData.ts")
rows = re.findall(r'\{ analyte: "([^"]+)", criteria: "([^"]+)", specialty: "[^"]+", cfr: "([^"]+)"', src)
got = {a: (c, s) for a, c, s in rows}
check(f"row count {len(rows)} matches expected {len(EXPECTED)}, no duplicates", len(rows) == len(EXPECTED) == len(got))
for a, want in EXPECTED.items():
    check(f"{a} = {want[0]} {want[1]}", got.get(a) == want, f"got {got.get(a)}")
for a in sorted(set(got) - set(EXPECTED)):
    check(f"{a} is listed in Subpart I", False, "row is not in the expected set")
check("no rows cite non-CFR sources (RCPA, WSLH)", "RCPA" not in src and "WSLH" not in src)
check(f"CLIA_TEA_TABLE_ECFR_DATE is {ECFR_COMPARED_ON}, the day the expected set was taken", f'CLIA_TEA_TABLE_ECFR_DATE = "{ECFR_COMPARED_ON}"' in src)


def parse_criteria(c):
    m = re.match(r"±([\d.]+)% or ±([\d.]+) (.+?) \(greater\)", c)
    if m:
        return float(m[1]) / 100, float(m[2]), m[3], True
    m = re.fullmatch(r"±([\d.]+)%", c)
    if m:
        return float(m[1]) / 100, None, None, True
    m = re.fullmatch(r"±([\d.]+)(?: (.+))?", c)
    return (float(m[1]), None, None, False) if m else None


# ── 3. Presets ───────────────────────────────────────────────────────────────
print("== CLIA_PRESETS against the same set")
page = read("client/src/pages/VeritaCheckPage.tsx")
# The presets live in shared/cliaPresets.ts since 2026-11-10; the page still renders the dropdown (checked below).
block = re.search(r"const CLIA_PRESETS = \[(.*?)\n\];", read("shared/cliaPresets.ts"), re.S).group(1)
presets = []
for line in block.split("\n"):
    m = re.match(r'\s*\{ label: "([^"]+)",\s*value: ([\d.]+)', line)
    if not m:
        continue
    floor = re.search(r"absoluteFloor: ([\d.]+)", line)
    unit = re.search(r'absoluteUnit: "([^"]+)"', line)
    cfr = re.search(r'cfr: "([^"]*)"', line).group(1)
    presets.append(dict(label=m[1], value=float(m[2]), floor=float(floor[1]) if floor else None, unit=unit[1] if unit else None, pct="isPercentage: false" not in line, cfr=cfr))
for i, p in enumerate(presets):
    name = p["label"].split(" (")[0]
    if name in LAB_SET:
        check(f"[{i}] {name} carries no CLIA TEa or section", p["value"] == 0 and p["cfr"] == "")
        continue
    analyte = PRESET_ANALYTE.get(name)
    if not analyte:
        check(f"[{i}] {name} maps to a Subpart I row", False)
        continue
    crit, sec = EXPECTED[analyte]
    val, floor, unit, pct = parse_criteria(crit.split(" or MB")[0].split(" or positive")[0])
    if analyte == "Human Chorionic Gonadotropin (hCG)":
        val, floor, unit = 0.18, 3.0, "mIU/mL"
    ok = abs(p["value"] - val) < 1e-9 and p["floor"] == floor and p["unit"] == unit and p["pct"] == pct and p["cfr"] == "42 CFR " + sec
    check(f"[{i}] {p['label']}", ok, f"expected {val} {floor} {unit} {sec}, got {p}")
    if floor is not None:
        check(f"[{i}] label states the floor unit", f"{unit}" in p["label"], p["label"])

print("== Dropdown shows every preset under its own section")
groups = re.findall(r"<SelectLabel[^>]*>([^<]+)</SelectLabel>(.*?)</SelectGroup>", page, re.S)
seen = {}
for label, body in groups:
    idx = []
    for a, b in re.findall(r"CLIA_PRESETS\.slice\((\d+), (\d+)\)", body):
        idx += list(range(int(a), int(b)))
    idx += [int(x) for x in re.findall(r"CLIA_PRESETS\[(\d+)\]\.label", body)]
    sec = re.search(r"§[\d.]+", label)
    for i in idx:
        seen[i] = seen.get(i, 0) + 1
        want = ("42 CFR " + sec.group(0)) if sec else ""
        if i < len(presets):
            check(f"[{i}] {presets[i]['label'].split(' (')[0]} sits under {label.strip()}", presets[i]["cfr"] == want, f"its section is {presets[i]['cfr']}")
        else:
            check(f"[{i}] index exists", False)
custom = len(presets) - 1
check("every preset but Custom appears exactly once", [i for i in range(custom) if seen.get(i) != 1] == [], str([i for i in range(custom) if seen.get(i) != 1]))
check("demo button index 19 is Creatinine", presets[19]["label"].startswith("Creatinine"), presets[19]["label"])

# ── 4. Found wrong: must stay out ────────────────────────────────────────────
print("== Citations found wrong stay out")
pdf = read("server/pdfReport.ts")
table = re.search(r"const REGULATORY_REFS:.*?\n\};", pdf, re.S).group(0)
for bad in ("493.1271", "QSA.13.02.01", "QSA.15.01.01", "CHM.13750", "CHM.13840", "GEN.41316", "HEM.37600", "HEM.37800", "CHM.13900", "GEN.40460", "COM.40620", "EP06-Ed3", "EP09-A3", "C24-A3", "EP10-A3"):
    check(f"REGULATORY_REFS does not carry {bad}", bad not in table)
scan = read("client/src/lib/veritaScanData.ts")
items = {int(i): (q, t, c, f) for i, q, t, c, f in re.findall(r'\{ id: (\d+), domain: "[^"]+", question: "((?:[^"\\]|\\.)*)", tjc: "([^"]*)", cap: "([^"]*)", cfr: "([^"]*)"', scan)}
check("VeritaScan has 173 items", len(items) == 173, str(len(items)))
for bad in ("GEN.41770", "GEN.60000", "GEN.60100", "GEN.40900", "COM.30500", "COM.40620", "POC.07037"):
    check(f"VeritaScan does not cite {bad}", not any(bad in v[2] for v in items.values()))
for bad in ("493.1255(b)(5)", "493.1256(g)(1)", "493.1105(a)(8)", "493.1105(a)(9)", "493.1441(c)", "493.959", "493.833", "10 CFR §35"):
    check(f"VeritaScan does not cite {bad}", not any(bad in v[3] or bad in v[0] for v in items.values()))
for i in (12, 13, 84, 153):
    check(f"VeritaScan item {i} cites 493.1291(g) for critical values", "493.1291(g)" in items[i][3], items[i][3])
check("VeritaScan item 49 no longer compares PT between instruments", "PT results compared" not in items[49][0], items[49][0])
samples = read("client/src/lib/demoSampleReports.ts")
for bad in ("864.7340", "(b)(1)(ii)", "§493.1253(b)(2)\"", "§493.1253(b)(3)", "tea: 0.20", "const tea = 0.15"):
    check(f"sample reports do not carry {bad}", bad not in samples)
check("sample Glucose uses 0.08 with a 6 mg/dL floor", samples.count("0.08, true, 6") == 2)
check("VeritaMap cites no Subpart I section for urinalysis", re.search(r'"Urinalysis": ""', read("server/veritamapData.ts")) is not None and re.search(r'Urinalysis: ""', read("client/src/pages/VeritaMapMapPage.tsx")) is not None)
cfrreq = read("server/cfrRequirements.ts")
for bad in ('"standard": "21 CFR 640.27"', '"standard": "21 CFR 640.3"', '"standard": "29 CFR 1200"', "ASC must arrange for blood"):
    check(f"cfrRequirements does not carry {bad}", bad not in cfrreq)

print("== Stored PDFs")
try:
    sys.path.append(site.getusersitepackages())
    import fitz
except ImportError:
    fitz = None
if fitz is None:
    print("SKIP  PyMuPDF not available")
else:
    assets = read("server/downloadAssets.ts")

    def pdf_text(name):
        d = base64.b64decode(re.search(name + r' = "([^"]+)"', assets).group(1))
        return re.sub(r"\s+", " ", "".join(p.get_text() for p in fitz.open(stream=d, filetype="pdf")))

    matrix = pdf_text("CLSI_COMPLIANCE_MATRIX_B64")
    for bad in ("493.1271", "QSA.15.01.01", "EP06-Ed3", "EP09-A3", "EP26-A", "C24-A3", "EP07", "Passing-Bablok", "Polynomial", "t-test", "HEM.36200", "CHM.13750"):
        check(f"matrix does not carry {bad}", bad not in matrix)
    if known is not None:
        missing = sorted(i for i in set(ID_RE.findall(matrix)) if i not in known)
        check(f"matrix CAP numbers all exist ({len(set(ID_RE.findall(matrix)))})", not missing, ", ".join(missing))
    tmpl = pdf_text("SOFTWARE_VALIDATION_TEMPLATE_B64")
    for bad in ("GEN.20316", "QSA.15.01.01", "493.1271", "493.1251", "Appendix C", "satisfies", "method validation", "new lot validation"):
        check(f"validation template does not carry {bad}", bad not in tmpl)
    tea_pdf = re.sub(r"\s+", " ", "".join(p.get_text() for p in fitz.open(os.path.join(ROOT, "client", "public", "clia-tea-reference-2026.pdf"))))
    for a, (c, _) in EXPECTED.items():
        check(f"TEa PDF lists {a} with {c}", a in tea_pdf and c in tea_pdf)
    for bad in ("Differential -", "MCV", "MCHC", "Reticulocyte", "D-Dimer", "Urinalysis", "January 1, 2025"):
        check(f"TEa PDF does not carry {bad}", bad not in tea_pdf)

print(f"\nSUMMARY: {passes} pass, {fails} fail")
sys.exit(1 if fails else 0)
