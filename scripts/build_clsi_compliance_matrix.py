#!/usr/bin/env python3
"""Generate the VeritaCheck CLSI Regulatory Standards Compliance Matrix leaflet.

One-page landscape PDF covering the SIX core VeritaCheck verification study types,
each mapped to its CLSI guideline(s), CLIA 42 CFR 493 section, CAP checklist item(s),
and TJC standard. Every citation is checked by scripts/verify-citations-tea-cap.py.
No citation is invented.

Output base64 is embedded in server/downloadAssets.ts as CLSI_COMPLIANCE_MATRIX_B64
and served at GET /api/downloads/clsi-compliance-matrix.

Run:  python scripts/build_clsi_compliance_matrix.py [out.pdf]
"""
import sys, io, base64
from datetime import datetime
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.enums import TA_LEFT

TEAL = colors.HexColor("#01696F")
TEXT = colors.HexColor("#28251D")
GRAY = colors.HexColor("#6B7280")
ALT  = colors.HexColor("#EBF3F8")
BORDER = colors.HexColor("#D0D0D0")

# Column headers
HEADERS = ["Study Type", "CLSI Guideline(s)", "CLIA (42 CFR 493)",
           "CAP Checklist", "TJC Standard", "VeritaCheck Calculations", "When It Applies"]

# The six core verification study types. Rebuilt 2026-11-05 from primary sources:
#   CFR: eCFR 42 CFR Part 493 (2026-11-03). 493.1271 is the immunohematology standard and is not cited here.
#   CAP: each requirement's text read in the 12/09/2025 MAS_*.xlsx checklists.
#   TJC: standard text read in the newest full manual on file. EP numbers are left off until checked against the
#        current edition.
#   CLSI: clsi.org store pages (2026-11-05). Editions are named only where the current edition is the one the
#        study follows; H47 and H21 have newer editions than the app was built on, so no edition is printed.
#   Calculations: client/src/lib/calculations.ts.
ROWS = [
    ["Calibration Verification / Linearity",
     "EP06-Ed2 (Evaluation of Linearity)",
     "493.1255(b); 493.1253(b)(1)(i)(C)",
     "CHM.13400; CHM.13600; HEM.37365; HEM.37375; IMM.33670; IMM.33818",
     "QSA.02.02.01; QSA.02.03.01",
     "Recovery and difference at each level, OLS slope and intercept, R-squared, pass/fail per level against the adopted criterion",
     "At least every 6 months and at the events listed in 493.1255(b)(3)"],
    ["Correlation / Method Comparison",
     "EP09c (Method Comparison and Bias Estimation)",
     "493.1281(a); 493.1253(b)(1)(i)(A)",
     "COM.04250; COM.04300; COM.40300",
     "QSA.02.08.01; QSA.02.01.01",
     "Deming regression, OLS regression, 95% CI, SEE, Bland-Altman, per-specimen pass rule against the adopted criterion",
     "Twice a year when the same test runs on different methods, instruments, or sites; when replacing a test or instrument"],
    ["Precision (Repeatability and Within-Laboratory)",
     "EP15-A3 (User Verification of Precision)",
     "493.1253(b)(1)(i)(B)",
     "COM.40300",
     "QSA.02.01.01",
     "Mean, SD, and %CV per level; within-run, between-run, and total SD and %CV in the advanced path; comparison to the adopted criterion",
     "Before reporting patient results on a new unmodified test system"],
    ["Lot-to-Lot Reagent Verification",
     "EP26-Ed2 (User Evaluation of a Reagent Lot Change)",
     "493.1255(b)(3)(i); 493.1256(d)(6)",
     "COM.30450",
     "QSA.02.13.01",
     "Percent difference per paired specimen, mean absolute percent difference, percent of specimens within the adopted criterion",
     "Each new reagent lot or shipment, before or concurrent with placing it in service"],
    ["QC Range Establishment",
     "C24-Ed4 (Statistical Quality Control)",
     "493.1256(d)(10)",
     "CHM.14000; HEM.19380; IMM.34140",
     "QSA.02.07.01",
     "Mean, SD, %CV, proposed control ranges (2 SD and 3 SD), optional prior-lot and vendor comparison",
     "Each new lot of control material"],
    ["Coagulation New Lot Verification (PT / aPTT / Fibrinogen)",
     "H47 (PT and APTT Testing); H21 (Coagulation Specimens); EP26-Ed2",
     "493.1255(b)(3)(i); 493.1256(d)(6)",
     "COM.30450; HEM.37830",
     "QSA.02.13.01",
     "Per-analyte paired comparison and regression, geometric mean normal PT, INR with the lot's ISI, comparison to the adopted criterion",
     "Each new reagent lot or shipment, before or concurrent with placing it in service"],
]

DISCLAIMER = ("Disclaimer: VeritaCheck is a statistical calculation tool. Results require interpretation by a "
    "licensed medical director or designee. Not medical advice. No PHI should be entered in any field. Final "
    "approval and clinical determination must be made by the laboratory director or designee. CLSI guidelines "
    "referenced are current as of the publication date; verify against your current CLSI subscriptions. "
    "VeritaAssure\u00ae, VeritaMap\u00ae, VeritaScan\u00ae and VeritaCheck\u00ae are registered trademarks of "
    "Veritas Lab Services, LLC. Other Verita product names are trademarks of Veritas Lab Services, LLC. "
    "Governing law: Massachusetts.")  # notice wording: VLS Legal 2026-10-27, no registration numbers


def build(out_path: str):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(letter),
                            leftMargin=0.4*inch, rightMargin=0.4*inch,
                            topMargin=0.4*inch, bottomMargin=0.35*inch)
    ss = getSampleStyleSheet()
    reg = "®"  # VeritaAssure and VeritaCheck: registered marks (USPTO, issued 2026-10-27)
    h_brand = ParagraphStyle("brand", parent=ss["Normal"], fontName="Helvetica-Bold",
                             fontSize=15, textColor=TEAL, spaceAfter=1, leading=17)
    h_sub = ParagraphStyle("sub", parent=ss["Normal"], fontName="Helvetica", fontSize=7.5,
                           textColor=GRAY, spaceAfter=6, leading=9)
    h_title = ParagraphStyle("title", parent=ss["Normal"], fontName="Helvetica-Bold",
                             fontSize=12.5, textColor=TEXT, spaceAfter=1, leading=14)
    h_tag = ParagraphStyle("tag", parent=ss["Normal"], fontName="Helvetica-Oblique",
                           fontSize=8.5, textColor=TEXT, spaceAfter=8, leading=10)
    cell = ParagraphStyle("cell", parent=ss["Normal"], fontName="Helvetica", fontSize=6.6,
                          textColor=TEXT, leading=8, alignment=TA_LEFT)
    cell_b = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
    hd = ParagraphStyle("hd", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=7,
                        textColor=colors.white, leading=8.5)
    disc = ParagraphStyle("disc", parent=ss["Normal"], fontName="Helvetica", fontSize=6.2,
                          textColor=GRAY, leading=7.6, spaceBefore=8)
    foot = ParagraphStyle("foot", parent=ss["Normal"], fontName="Helvetica", fontSize=7,
                          textColor=TEAL, spaceBefore=4, spaceAfter=6)

    story = []
    story.append(Paragraph(f"VeritaAssure{reg}", h_brand))
    story.append(Paragraph("Veritas Lab Services, LLC  |  www.veritaslabservices.com", h_sub))
    story.append(Paragraph(f"VeritaCheck{reg} Regulatory Standards Compliance Matrix", h_title))
    story.append(Paragraph(f"Maps the core VeritaCheck{reg} verification study types to applicable CLSI, "
                           "CLIA, CAP, and TJC standards", h_tag))

    data = [[Paragraph(h, hd) for h in HEADERS]]
    for r in ROWS:
        row = [Paragraph(r[0], cell_b)] + [Paragraph(c, cell) for c in r[1:]]
        data.append(row)

    col_w = [1.30*inch, 1.35*inch, 1.05*inch, 1.15*inch, 0.95*inch, 2.55*inch, 1.20*inch]
    tbl = Table(data, colWidths=col_w, repeatRows=1)
    style = [
        ("BACKGROUND", (0,0), (-1,0), TEAL),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("TOPPADDING", (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
        ("LEFTPADDING", (0,0), (-1,-1), 4),
        ("RIGHTPADDING", (0,0), (-1,-1), 4),
        ("GRID", (0,0), (-1,-1), 0.5, BORDER),
        ("LINEBELOW", (0,0), (-1,0), 0.75, TEAL),
    ]
    for i in range(1, len(ROWS)+1):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0,i), (-1,i), ALT))
    tbl.setStyle(TableStyle(style))
    story.append(tbl)

    stamp = datetime.now().strftime("%B %Y")
    story.append(Paragraph(f"VeritaAssure{reg}  |  VeritaCheck{reg}  |  Confidential - For Internal Lab Use Only  |  "
                           f"Generated {stamp}", foot))
    story.append(Paragraph(DISCLAIMER, disc))
    doc.build(story)

    pdf = buf.getvalue()
    with open(out_path, "wb") as f:
        f.write(pdf)
    b64 = base64.b64encode(pdf).decode("ascii")
    with open(out_path + ".b64.txt", "w", encoding="utf-8") as f:
        f.write(b64)
    print(f"wrote {out_path} ({len(pdf)} bytes), base64 {len(b64)} chars -> {out_path}.b64.txt")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "clsi_matrix_new.pdf"
    build(out)
