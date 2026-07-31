#!/usr/bin/env python3
"""Build the 2026 CLIA TEa reference-table PDF (lead-capture content upgrade,
handoff 2026-07-29) from the app's own dataset, so it never drifts from the
live /resources/clia-tea-lookup tool.

Input:  a JSON dump of client/src/lib/cliaTeaData.ts teaData (see companion
        one-liner in the build command).
Output: client/public/clia-tea-reference-2026.pdf (served at /clia-tea-reference-2026.pdf).

Run: npx tsx -e "import {teaData} from './client/src/lib/cliaTeaData'; import fs from 'node:fs'; fs.writeFileSync(process.argv[1], JSON.stringify(teaData));" <json> && python scripts/build_tea_reference_pdf.py <json>
"""
import io, sys, json, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle, Paragraph,
                                Spacer, HRFlowable)

TEAL = colors.HexColor("#01696F"); DARK = colors.HexColor("#0A3A3D")
TEXT = colors.HexColor("#28251D"); GRAY = colors.HexColor("#6B7280")
ALT = colors.HexColor("#EBF3F8"); BORDER = colors.HexColor("#D0D0D0")
TM = "™"


def main():
    src = sys.argv[1]
    data = json.load(open(src, encoding="utf-8"))
    out = os.path.join("client", "public", "clia-tea-reference-2026.pdf")
    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=0.6 * inch,
                            rightMargin=0.6 * inch, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            title="2026 CLIA Allowable Total Error (TEa) Reference Table")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=17, textColor=TEAL, leading=20)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontName="Helvetica", fontSize=9, textColor=GRAY, leading=13)
    sech = ParagraphStyle("sech", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=10.5, textColor=DARK, leading=13, spaceBefore=10, spaceAfter=3)
    cell = ParagraphStyle("cell", parent=ss["Normal"], fontName="Helvetica", fontSize=8.5, textColor=TEXT, leading=11)
    cellb = ParagraphStyle("cellb", parent=cell, fontName="Helvetica-Bold")
    hd = ParagraphStyle("hd", parent=ss["Normal"], fontName="Helvetica-Bold", fontSize=8.5, textColor=colors.white, leading=11)
    small = ParagraphStyle("small", parent=ss["Normal"], fontName="Helvetica", fontSize=7.5, textColor=GRAY, leading=10)

    story = [
        Paragraph(f"2026 CLIA Allowable Total Error (TEa) Reference Table", h1),
        Paragraph("Analytic quality requirements under 42 CFR Part 493, Subpart I (CLIA PT final rule CMS-3355-F, effective January 1, 2025). "
                  "The lab director or designee sets the internal quality goal; this table is the CLIA minimum.", sub),
        Spacer(1, 4),
        HRFlowable(width="100%", thickness=1.2, color=TEAL, spaceAfter=8),
    ]

    # group by specialty, preserving first-seen order
    order, groups = [], {}
    for a in data:
        sp = a.get("specialty", "Other")
        if sp not in groups:
            groups[sp] = []; order.append(sp)
        groups[sp].append(a)

    for sp in order:
        rows = [[Paragraph("Analyte", hd), Paragraph("CLIA Allowable Error (TEa)", hd), Paragraph("CFR", hd)]]
        for a in groups[sp]:
            rows.append([
                Paragraph(a["analyte"], cellb),
                Paragraph(a.get("criteria", ""), cell),
                Paragraph(a.get("cfr", ""), cell),
            ])
        t = Table(rows, colWidths=[3.5 * inch, 2.7 * inch, 1.1 * inch], repeatRows=1)
        st = [("BACKGROUND", (0, 0), (-1, 0), TEAL), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
              ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
              ("GRID", (0, 0), (-1, -1), 0.4, BORDER)]
        for i in range(1, len(rows)):
            if i % 2 == 0:
                st.append(("BACKGROUND", (0, i), (-1, i), ALT))
        t.setStyle(TableStyle(st))
        story += [Paragraph(f"{sp}  ({len(groups[sp])})", sech), t]

    story += [Spacer(1, 10), HRFlowable(width="100%", thickness=0.75, color=BORDER, spaceAfter=6),
              Paragraph(f"Source: 42 CFR Part 493, Subpart I. Provided by VeritaAssure{TM} | Veritas Lab Services. "
                        "Verify current requirements against the eCFR. Live lookup: veritaslabservices.com/resources/clia-tea-lookup.", small)]
    doc.build(story)
    print("wrote", out, "|", len(data), "analytes,", len(order), "specialties")


if __name__ == "__main__":
    main()
