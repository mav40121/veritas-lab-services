"""BUG-013 in-text citations (Michael Q48 = 1, 2026-10-09: Claude does the work, Michael approves the sheet).
Policy text that cites a section the quote review corrected, or a paragraph that does not exist, is changed to
the citation whose eCFR text supports the sentence. Each edit is an exact string with an expected count; if any
count differs, nothing is written. Sentences that stated the regulation wrongly (066) are corrected to what the
CFR says. Adds an 'In-text changes' sheet to the review workbook.

Usage: python apply_intext_citations.py "<review workbook path>"
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(os.path.dirname(HERE)), "server", "policyTemplates", "data")
NOTICE = re.compile(r"42 CFR 493\.1775(?![\d(])")

# (template, old, new, expected count, reason)
EDITS = [
    ("001_accreditation_body_notification.json", "42 CFR 493.1775(a)", "42 CFR 493.63(a)", 1, "30-day change notice for accredited labs is 493.63(a); 493.1775 is inspection of waiver/PPM labs."),
    ("006_test_ordering.json", "within 30 days per 42 CFR 493.1241(a)", "within 30 days per 42 CFR 493.1241(b)", 1, "Oral requests and the 30-day written authorization are 493.1241(b)."),
    ("016_radiation_safety.json", "obligations at 42 CFR 493.1101(c)", "obligations at 42 CFR 493.1101(d)", 1, "Personnel safety procedures are 493.1101(d)."),
    ("028_lis_validation_verification.json", "CLIA at 42 CFR 493.1281(c) requires verification that test result transmission is accurate", "CLIA at 42 CFR 493.1291(a) requires verification that test result transmission is accurate", 1, "Accurate transmission from data entry to final report is 493.1291(a)."),
    ("028_lis_validation_verification.json", "42 CFR 493.1281(c)", "42 CFR 493.1281(a)", 3, "Method/instrument comparison twice a year is 493.1281(a); (c) is documentation."),
    ("037_corrective_action.json", "42 CFR 493.1282(a)(3)", "42 CFR 493.1291(k)(3)", 2, "493.1282(a)(3) does not exist; keeping the original and corrected report is 493.1291(k)(3)."),
    ("040_microbiology_isolation_id.json", "42 CFR 493.1262(a)", "42 CFR 493.1256(e)(4)", 2, "Media checks are 493.1256(e)(4); 493.1262 is Mycobacteriology."),
    ("066_manual_hematology_qc.json", "have two levels of commercial control material run within each 8 hours of operation and each time a change in reagents occurs, per 42 CFR 493.1261(a).",
     "have two levels of commercial control material run within each 8 hours of operation and each time a change in reagents occurs, which exceeds the 42 CFR 493.1269(a) minimum of one control material each 8 hours with patient specimens and controls tested in duplicate.", 1,
     "Manual cell count QC is 493.1269(a), which requires one control each 8 hours (in duplicate), not two levels; the sentence now says the lab's practice exceeds it."),
    ("066_manual_hematology_qc.json", "Subject to 42 CFR 493.1261(a) two-level, 8-hour control requirement.",
     "Subject to 42 CFR 493.1269(a): one control material each 8 hours of operation, with patient specimens and controls tested in duplicate.", 1,
     "States the 493.1269(a) requirement as written; 493.1261 is Bacteriology."),
    ("073_histopathology_qmp.json", "42 CFR 493.1273(a)(2)", "42 CFR 493.1252(d)", 1, "493.1273(a)(2) does not exist; not using substandard reagents and materials is 493.1252(d)."),
    ("080_virology_qc.json", "42 CFR 493.1256(d)(2)(i)", "42 CFR 493.1256(d)(3)(i)", 1, "Two control concentrations for quantitative procedures is 493.1256(d)(3)(i)."),
    ("098_pretransfusion_testing.json", "per 42 CFR 493.1256 and 42 CFR 493.1273(a)", "per 42 CFR 493.1256(e)(1) and 21 CFR 606.65(c)", 1, "493.1273 is Histopathology. Daily blood bank reagent testing is the 21 CFR 606.65(c) table; lot checks are 493.1256(e)(1)."),
    ("098_pretransfusion_testing.json", "42 CFR 493.1273(a)", "21 CFR 606.65(c)", 2, "Daily reagent QC (anti-human globulin, blood grouping reagents, screening cells: each day of use) is 21 CFR 606.65(c)."),
    ("099_blood_component_handling.json", "42 CFR 493.1273(a)", "21 CFR 606.65(c)", 4, "Same as policy 098."),
    ("100_transfusion_administration.json", "Required by FDA 21 CFR 606.151(d).", "Required by FDA 21 CFR 606.151(e).", 1, "Emergency release documentation signed by a physician is 606.151(e)."),
    ("103_personnel_qualifications.json", "42 CFR 493.1443 (moderate complexity) or 42 CFR 493.1405 (high complexity)", "42 CFR 493.1405 (moderate complexity) or 42 CFR 493.1443 (high complexity)", 1, "The two sections were swapped: 493.1405 is moderate, 493.1443 is high complexity."),
    ("103_personnel_qualifications.json", NOTICE, "42 CFR 493.63(a)", 4, "Director change notice within 30 days is 493.63(a)."),
    ("103_personnel_qualifications.json", "42 CFR 493.1463(b)(5)", "42 CFR 493.1463(b)(4)", 1, "493.1463(b)(5) does not exist; evaluating and documenting testing personnel competency is (b)(4)."),
    ("106_waived_and_point_of_care_testing.json", NOTICE, "42 CFR 493.63(a)", 3, "Location and other changes are notified under 493.63(a)."),
    ("108_health_information_management.json", "42 CFR 493.1281(c) (verification of test transmission accuracy)", "42 CFR 493.1291(a) (accurate transmission of test results to the final report)", 1, "The transmission requirement is 493.1291(a)."),
    ("108_health_information_management.json", "42 CFR 493.1281(c)", "42 CFR 493.1291(a)", 2, "Same as above."),
    ("109_laboratory_governance_and_leadership.json", NOTICE, "42 CFR 493.63(a)", 4, "Notification of changes is 493.63(a)."),
    ("110_infection_prevention_and_standard_precautions.json", "42 CFR 493.1101(c)", "42 CFR 493.1101(d)", 1, "Safety procedures are 493.1101(d)."),
]


def main():
    report = sys.argv[1] if len(sys.argv) > 1 else None
    by_file = {}
    for e in EDITS:
        by_file.setdefault(e[0], []).append(e)
    staged, log = {}, []
    for f, edits in by_file.items():
        p = os.path.join(DATA, f)
        raw = open(p, encoding="utf-8", newline="").read()
        before = json.loads(raw)
        new = raw
        for _, old, rep, n, why in edits:
            if isinstance(old, re.Pattern):
                count = len(old.findall(new))
                if count != n:
                    raise SystemExit(f"{f}: expected {n} of {old.pattern}, found {count}; nothing written")
                new = old.sub(rep, new)
                log.append((f, old.pattern.replace("\\", "").replace("(?![d(])", ""), rep, n, why))
            else:
                count = new.count(old)
                if count != n:
                    raise SystemExit(f"{f}: expected {n} of {old!r}, found {count}; nothing written")
                new = new.replace(old, rep)
                log.append((f, old, rep, n, why))
        after = json.loads(new)
        if after.get("cfr_text_blocks") != before.get("cfr_text_blocks"):
            raise SystemExit(f"{f}: an in-text edit touched the quote blocks; nothing written")
        staged[p] = new
    for p, new in staged.items():
        open(p, "w", encoding="utf-8", newline="").write(new)
    print(f"in-text edits: {sum(x[3] for x in log)} citations in {len(staged)} templates")
    if report:
        from openpyxl import load_workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        wb = load_workbook(report)
        if "In-text changes" in wb.sheetnames:
            del wb["In-text changes"]
        ws = wb.create_sheet("In-text changes")
        ws.append(["Template", "Was", "Now", "Times", "Reason", "Michael OK? (Y, or what to change)"])
        for c in ws[1]:
            c.fill, c.font = PatternFill("solid", fgColor="01696F"), Font(bold=True, color="FFFFFF")
        for x in log:
            ws.append([x[0][:-5], x[1], x[2], x[3], x[4], ""])
        for col, w in zip("ABCDEF", [30, 60, 60, 7, 60, 20]):
            ws.column_dimensions[col].width = w
        for row in ws.iter_rows(min_row=2):
            for c in row:
                c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.freeze_panes = "B2"
        wb.save(report)
        print(f"sheet 'In-text changes' written to {report}")


if __name__ == "__main__":
    main()
