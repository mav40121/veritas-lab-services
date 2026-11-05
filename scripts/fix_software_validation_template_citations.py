#!/usr/bin/env python3
"""Correct the citations and overstatements in the stored Software Validation Template PDF (site review 2026-11-05:
AST-02, OPS-08, OPS-79, FAQ 2).

The template (SOFTWARE_VALIDATION_TEMPLATE_B64 in server/downloadAssets.ts, served at
/api/downloads/software-validation-template) has no generator in the repo. It is a ReportLab PDF in Helvetica with
WinAnsiEncoding, so its lines sit in the content streams as "(text) Tj T*" and each one can be replaced where it stands,
keeping font, size, color and baseline, the way scripts/retm_software_validation_template.py changes the marks. Octal
escapes: \\256 registered, \\231 trademark, \\222 right quote, \\177 bullet.

What changes:
  p1  Purpose and Scope: "satisfies the laboratory's obligation" comes out, and "coagulation new lot validation" reads
      "verification". Labs verify; manufacturers validate.
  p1  The "Regulatory basis" sentence comes out. CAP GEN.20316 is QMS Indicators of Quality, TJC QSA.15.01.01 is
      molecular testing, 42 CFR 493.1251 is the procedure manual, and none of them covers software. Michael chooses
      replacement citations, if any.
  p1  Intended Use: "EP method validation studies" reads "performance verification studies".
  p2  Item 7: "CFR 493.1271(b)(3) cited" (493.1271 is immunohematology) reads "CFR citation is present."
  p3  TEa source: "42 CFR Part 493 Appendix C" reads "42 CFR Part 493, Subpart I".
  p3  VeritaPT is live, not on the roadmap.
  p3  The LIS limitation cites 493.1251, which does not mention IQ/OQ/PQ. The cite comes out.
  all Footer date, re-centered.

Security, PHI and retention statements in the template are left alone: Michael and Legal decide those.

Usage: python scripts/fix_software_validation_template_citations.py   (rewrites server/downloadAssets.ts in place)
"""
import base64
import io
import os
import re
import site
import sys

sys.path.append(site.getusersitepackages())
import fitz  # PyMuPDF

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "server", "downloadAssets.ts")
NAME = "SOFTWARE_VALIDATION_TEMPLATE_B64"
OLD_DATE, NEW_DATE = "April 01, 2026", "November 05, 2026"

# Raw content-stream text, each pair matched exactly once across the document.
EDITS = [
    (rb"(This template documents the validation of VeritaCheck\256 \(Veritas Lab Services, LLC\) as a statistical analysis tool for use in clinical) Tj T* "
     rb"(laboratory compliance documentation, including calibration verification / linearity studies, correlation / method comparison studies,) Tj T* "
     rb"(precision \(EP15\) studies, lot-to-lot reagent verification, QC range establishment, and coagulation new lot validation. Completion of this) Tj T* "
     rb"(template satisfies the laboratory\222s obligation to validate software used in the production of compliance documentation prior to placing it) Tj T* "
     rb"(into service, as required by applicable accreditation standards.) Tj T*",
     rb"(This template documents the laboratory\222s functional check of VeritaCheck\256 \(Veritas Lab Services, LLC\) as a statistical analysis tool for use) Tj T* "
     rb"(in clinical laboratory compliance documentation, including calibration verification / linearity studies, correlation / method comparison) Tj T* "
     rb"(studies, precision \(EP15\) studies, lot-to-lot reagent verification, QC range establishment, and coagulation new lot verification. Whether this) Tj T* "
     rb"(record meets a specific accreditor\222s expectations is the determination of the laboratory director or designee.) Tj T*"),
    (rb"(Regulatory basis for software validation requirement:) Tj /F1 8.5 Tf ( CAP GEN.20316 \(Computer Systems\), TJC QSA.15.01.01 EP1 \(Quality) Tj T* "
     rb"(Management Systems\), CLIA 42 CFR 493.1251 \(Test Systems\), and ISO 15189:2022 Section 6.6 \(Equipment and associated software\).) Tj T*",
     b""),
    (rb"(Statistical analysis and documentation of EP method validation studies for clinical) Tj",
     rb"(Statistical analysis and documentation of performance verification studies for clinical) Tj"),
    (rb"(verdict displayed against CLIA TEa. CFR) Tj T* (493.1271\(b\)\(3\) cited.) Tj",
     rb"(verdict displayed against the adopted) Tj T* (criterion. CFR citation is present.) Tj"),
    (rb"(CLIA TEa values are sourced from 42 CFR Part 493 Appendix C. Values are) Tj",
     rb"(CLIA TEa values are sourced from 42 CFR Part 493, Subpart I. Values are) Tj"),
    (rb"PT results are tracked separately \(see VeritaAssure\256 roadmap for) Tj T* (VeritaPT\231\).) Tj",
     rb"PT results are tracked separately in VeritaPT\231.) Tj"),
    (rb"(\177 This template does not substitute for IQ/OQ/PQ validation required for laboratory information systems \(LIS\) or instrument software per) Tj T* (CLIA 493.1251.) Tj",
     rb"(\177 This template does not substitute for testing that laboratory policy or an accreditor requires for laboratory information systems \(LIS\) or) Tj T* (instrument software.) Tj"),
]
FOOT = re.compile(rb"1 0 0 1 ([\d.]+) ([\d.]+) Tm ((?:(?!Tm).)*?Generated April 01, 2026\) Tj)", re.S)

src = io.open(ASSETS, encoding="utf-8", newline="").read()
m = re.search(NAME + r' = "([^"]+)"', src)
if not m:
    sys.exit(f"{NAME} not found in {ASSETS}")
doc = fitz.open(stream=base64.b64decode(m.group(1)), filetype="pdf")

shift = (fitz.get_text_length(NEW_DATE, fontname="helv", fontsize=7) - fitz.get_text_length(OLD_DATE, fontname="helv", fontsize=7)) / 2
applied = [0] * len(EDITS)
footers = 0
for x in range(1, doc.xref_length()):
    if not doc.xref_is_stream(x):
        continue
    s = doc.xref_stream(x)
    if not s or b"Tj" not in s:
        continue
    new = s
    for i, (old, rep) in enumerate(EDITS):
        applied[i] += new.count(old)
        new = new.replace(old, rep)

    def foot(mm):
        global footers
        footers += 1
        return b"1 0 0 1 %.2f %s Tm %s" % (float(mm.group(1)) - shift, mm.group(2), mm.group(3).replace(OLD_DATE.encode(), NEW_DATE.encode()))

    new = FOOT.sub(foot, new)

    # Page 4 was rewritten by the earlier refooter pass, so its footer is a hex string.
    def foot_hex(mm):
        global footers
        text = bytes.fromhex(mm.group(3).decode())
        if OLD_DATE.encode() not in text:
            return mm.group(0)
        footers += 1
        return b"1 0 0 1 %.2f %s Tm <%s>Tj" % (float(mm.group(1)) - shift, mm.group(2), text.replace(OLD_DATE.encode(), NEW_DATE.encode()).hex().encode())

    new = re.sub(rb"1 0 0 1 ([\d.]+) ([\d.]+) Tm <([0-9a-f]+)>Tj", foot_hex, new)
    if new != s:
        doc.update_stream(x, new)
if applied != [1] * len(EDITS):
    sys.exit(f"each edit must match once; got {applied}")
if footers != 4:
    sys.exit(f"expected 4 footers, got {footers}")
out = doc.tobytes(garbage=3, deflate=True)

check = fitz.open(stream=out, filetype="pdf")
text = "".join(p.get_text() for p in check)
flat = re.sub(r"\s+", " ", text)
for bad in ("GEN.20316", "QSA.15.01.01", "493.1271", "Appendix C", "satisfies", "method validation", "new lot validation", OLD_DATE, "CLIA 493.1251", "ISO 15189", "roadmap for VeritaPT"):
    assert bad not in flat, bad
for good in ("Subpart I", "new lot verification", "performance verification studies", NEW_DATE, "VeritaPT" + chr(0x2122), "Confidential " + chr(0x2013)):
    assert good in flat, good
assert check.page_count == 4
print(f"pages {check.page_count}; registered signs {text.count(chr(0xAE))}; TM {text.count(chr(0x2122))}")

b64 = base64.b64encode(out).decode("ascii")
src = src[:m.start(1)] + b64 + src[m.end(1):]
io.open(ASSETS, "w", encoding="utf-8", newline="").write(src)
print("rewrote", ASSETS)
