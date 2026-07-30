#!/usr/bin/env python3
"""Generate the VeritaCheck CLSI Regulatory Standards Compliance Matrix leaflet.

One-page landscape PDF covering the SIX core VeritaCheck verification study types,
each mapped to its CLSI guideline(s), CLIA 42 CFR 493 section, CAP checklist item(s),
and TJC standard. Every citation is carried over verbatim from the prior vetted
leaflet (the two near-duplicate coagulation-new-lot rows are consolidated into one,
taking the union of their citations). No citation is invented.

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
           "CAP Checklist", "TJC Standard", "VeritaCheck Calculations", "Frequency Required"]

# The six core verification study types. Citations verbatim from the prior vetted leaflet.
ROWS = [
    ["Calibration Verification / Linearity",
     "EP06-Ed3 (Linearity Evaluation); EP15-A3 (User Verification)",
     "493.1255(b)(3); 493.1271(b)",
     "CHM.13700; CHM.13750; GEN.40830",
     "QSA.15.01.01 EP2, EP3",
     "Polynomial regression (linear, quadratic), R-squared, linearity assessment, recovery % at each calibrator level",
     "Every 6 months or with reagent lot change"],
    ["Correlation / Method Comparison",
     "EP09-A3 (Method Comparison); EP15-A3 (User Verification)",
     "493.1255(b)(2); 493.1271(b)",
     "CHM.13650; CHM.13700; GEN.40810",
     "QSA.15.01.01 EP1, EP2",
     "Deming regression, OLS regression, 95% CI, SEE, bias at medical decision points, Passing-Bablok",
     "Every 6 months per analyzer / method"],
    ["Precision (Repeatability and Reproducibility)",
     "EP05-A3 (Evaluation of Precision); EP15-A3",
     "493.1255(b)(1); 493.1271(a)",
     "CHM.13600; GEN.40800",
     "QSA.15.01.01 EP1",
     "Within-run SD and %CV, between-run SD and %CV, total SD, repeatability vs. allowable imprecision",
     "At instrument / reagent qualification or annually"],
    ["Lot-to-Lot Reagent Verification",
     "EP07-A2 (Interference Testing); EP26-A",
     "493.1255(b)(3); 493.1271(b)(3)",
     "CHM.13800; GEN.40860",
     "QSA.15.01.01 EP4",
     "Paired t-test, percent difference from reference, bias vs. CLIA allowable error (TEa)",
     "Each new reagent lot before patient use"],
    ["QC Range Establishment",
     "EP23-A (Laboratory Quality Control); C24-A3",
     "493.1256(d)(3); 493.1256(e)",
     "COM.30450; GEN.40500",
     "QSA.15.01.01 EP5",
     "Mean, SD, %CV, proposed control ranges (2 SD and 3 SD), expected performance vs. CLIA TEa",
     "New control lot or initial QC setup"],
    ["Coagulation New Lot Verification (PT / aPTT / Fibrinogen)",
     "H47-A2 (PT Monitoring); H21-A5 (aPTT); EP26-A",
     "493.1255(b)(3); 493.1271(b)(3)",
     "HEM.36160; HEM.36180; HEM.36200; GEN.40860",
     "QSA.15.01.01 EP4, EP6",
     "Per-analyte and multi-analyte paired comparison, bias, recovery %, TEa assessment for PT, aPTT, and fibrinogen",
     "Each new reagent lot before patient use"],
]

DISCLAIMER = ("Disclaimer: VeritaCheck is a statistical calculation tool. Results require interpretation by a "
    "licensed medical director or designee. Not medical advice. No PHI should be entered in any field. Final "
    "approval and clinical determination must be made by the laboratory director or designee. CLSI guidelines "
    "referenced are current as of the publication date; verify against your current CLSI subscriptions. "
    "VeritaAssure is a trademark of Veritas Lab Services, LLC (USPTO Serial No. 99731002). VeritaCheck is a "
    "trademark of Veritas Lab Services, LLC (USPTO Serial No. 99730975). Governing law: Massachusetts.")


def build(out_path: str):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(letter),
                            leftMargin=0.4*inch, rightMargin=0.4*inch,
                            topMargin=0.4*inch, bottomMargin=0.35*inch)
    ss = getSampleStyleSheet()
    tm = "™"  # trademark
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
    story.append(Paragraph(f"VeritaAssure{tm}", h_brand))
    story.append(Paragraph("Veritas Lab Services, LLC  |  veritaslabservices.com", h_sub))
    story.append(Paragraph(f"VeritaCheck{tm} Regulatory Standards Compliance Matrix", h_title))
    story.append(Paragraph(f"Maps the core VeritaCheck{tm} verification study types to applicable CLSI, "
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
    story.append(Paragraph(f"VeritaAssure{tm}  |  VeritaCheck{tm}  |  Confidential - For Internal Lab Use Only  |  "
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
