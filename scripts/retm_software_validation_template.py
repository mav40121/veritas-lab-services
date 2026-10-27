#!/usr/bin/env python3
"""Switch the four USPTO-registered marks in the stored Software Validation Template PDF from TM to the registered
symbol (2026-10-27; VeritaAssure Reg. 8521603, VeritaCheck 8521591, VeritaMap 8521596, VeritaScan 8521598).

The template (SOFTWARE_VALIDATION_TEMPLATE_B64 in server/downloadAssets.ts, served at
/api/downloads/software-validation-template) has no generator in the repo. It is a ReportLab PDF in Helvetica with
WinAnsiEncoding, so the trademark sign is the byte 0x99 (written \\231 in the content streams) and the registered sign
is 0xAE (\\256). Only the byte directly after one of the four registered names changes; every other Verita name keeps
TM. The result is checked by extracting the text back out.

Usage: python scripts/retm_software_validation_template.py   (rewrites server/downloadAssets.ts in place)
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
REGISTERED = (b"VeritaAssure", b"VeritaCheck", b"VeritaMap", b"VeritaScan")
SWAP = re.compile(rb"(" + rb"|".join(REGISTERED) + rb")\\231")

src = io.open(ASSETS, encoding="utf-8", newline="").read()
m = re.search(NAME + r' = "([^"]+)"', src)
doc = fitz.open(stream=base64.b64decode(m.group(1)), filetype="pdf")
swapped = 0
for x in range(1, doc.xref_length()):
    if not doc.xref_is_stream(x):
        continue
    s = doc.xref_stream(x)
    if not s or b"Verita" not in s:
        continue
    new, n = SWAP.subn(rb"\1\\256", s)
    if n:
        doc.update_stream(x, new)
        swapped += n
out = doc.tobytes(garbage=3, deflate=True)

check = fitz.open(stream=out, filetype="pdf")
text = "".join(p.get_text() for p in check)
bad = [n.decode() for n in REGISTERED if n.decode() + chr(0x2122) in text]
assert not bad, ("still TM on", bad)
print(f"swapped {swapped}; pages {check.page_count}; registered signs now {text.count(chr(0xAE))}; TM left {text.count(chr(0x2122))}")

b64 = base64.b64encode(out).decode("ascii")
src = src[:m.start(1)] + b64 + src[m.end(1):]
io.open(ASSETS, "w", encoding="utf-8", newline="").write(src)
print("rewrote", ASSETS)
