#!/usr/bin/env python3
"""Replace the trademark sentences in the stored Software Validation Template PDF with VLS Legal's approved notice
(2026-10-27): "VeritaAssure®, VeritaMap®, VeritaScan® and VeritaCheck® are registered trademarks of Veritas Lab
Services, LLC. Other Verita product names are trademarks of Veritas Lab Services, LLC." No registration or serial
numbers (the registered symbol gives notice).

The template (SOFTWARE_VALIDATION_TEMPLATE_B64 in server/downloadAssets.ts, served at
/api/downloads/software-validation-template) has no generator in the repo. The old sentences ("VeritaAssure® is a
trademark of ... (USPTO Serial No. 99731002). VeritaCheck® is a trademark of ... (USPTO Serial No. 99730975).") sit in
the page-4 disclaimer, 7 pt Helvetica, gray, 10 pt line spacing. This keeps the disclaimer's first line, removes the
lines after it, and sets the rest of the paragraph again in the same font, size, color, left edge and line spacing.
The result is checked by extracting the text back out.

Usage: python scripts/refooter_software_validation_template.py   (rewrites server/downloadAssets.ts in place)
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
REG = "®"
REST = ("be entered in any field. Final approval and clinical determination must be made by the laboratory director or "
        f"designee. VeritaAssure{REG}, VeritaMap{REG}, VeritaScan{REG} and VeritaCheck{REG} are registered trademarks "
        "of Veritas Lab Services, LLC. Other Verita product names are trademarks of Veritas Lab Services, LLC. "
        "Governing law: Massachusetts.")

src = io.open(ASSETS, encoding="utf-8", newline="").read()
m = re.search(NAME + r' = "([^"]+)"', src)
if not m:
    sys.exit(f"{NAME} not found in {ASSETS}")
doc = fitz.open(stream=base64.b64decode(m.group(1)), filetype="pdf")
page = doc[3]

# The disclaimer lines: first line starts "Disclaimer:", then the lines up to "Massachusetts."
lines = []
for b in page.get_text("dict")["blocks"]:
    for l in b.get("lines", []):
        lines.append((l, "".join(s["text"] for s in l["spans"])))
first = next(i for i, (_, t) in enumerate(lines) if t.startswith("Disclaimer:"))
last = next(i for i in range(first, len(lines)) if lines[i][1].rstrip().endswith("Massachusetts."))
head, tail = lines[first][0], lines[first + 1:last + 1]
if not tail or "trademark" not in " ".join(t for _, t in tail):
    sys.exit("disclaimer layout not as expected; nothing changed")

span = tail[0][0]["spans"][0]
x0 = span["origin"][0]
base0 = span["origin"][1]
step = tail[1][0]["spans"][0]["origin"][1] - base0 if len(tail) > 1 else 10.0
size = span["size"]
c = span["color"]
color = ((c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255)
right = head["bbox"][2]

# Remove the old lines (the first line stays).
area = fitz.Rect(x0 - 1, tail[0][0]["bbox"][1] - 0.1, right + 2, tail[-1][0]["bbox"][3] + 0.1)
page.add_redact_annot(area)
page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE, graphics=fitz.PDF_REDACT_LINE_ART_NONE)

# Wrap the new text to the first line's width and set it on the original baselines.
width = right - x0
out, cur = [], ""
for word in REST.split(" "):
    trial = (cur + " " + word).strip()
    if fitz.get_text_length(trial, fontname="helv", fontsize=size) <= width:
        cur = trial
    else:
        out.append(cur)
        cur = word
out.append(cur)
for i, text in enumerate(out):
    page.insert_text((x0, base0 + i * step), text, fontname="helv", fontsize=size, color=color)

buf = io.BytesIO()
doc.save(buf, garbage=3, deflate=True)
pdf = buf.getvalue()

check = re.sub(r"\s+", " ", "".join(p.get_text() for p in fitz.open(stream=pdf, filetype="pdf")))
want = (f"VeritaAssure{REG}, VeritaMap{REG}, VeritaScan{REG} and VeritaCheck{REG} are registered trademarks of Veritas "
        "Lab Services, LLC. Other Verita product names are trademarks of Veritas Lab Services, LLC.")
problems = []
if want not in check:
    problems.append("approved notice not found in extracted text")
if "Serial No" in check or "is a trademark of" in check:
    problems.append("old trademark sentence still present")
if "Governing law: Massachusetts." not in check:
    problems.append("governing-law sentence lost")
if problems:
    sys.exit("; ".join(problems))

new_b64 = base64.b64encode(pdf).decode("ascii")
io.open(ASSETS, "w", encoding="utf-8", newline="").write(src.replace(m.group(1), new_b64))
print(f"{NAME}: {len(out)} disclaimer lines re-set on page 4; approved notice present; {len(pdf)} bytes")
