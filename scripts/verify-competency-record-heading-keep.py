# scripts/verify-competency-record-heading-keep.py
#
# Checks the PDFs written by scripts/verify-competency-record-heading-keep.mjs (Michael 2026-11-03, Q138 = 1):
#   1. the long record: the page that carries the "COMPETENCY BY METHOD" heading also carries the method table's header
#      row (EL 1 ... NEXT DUE), so the heading is never left alone at the bottom of a page
#   2. the long record: every sign-off line is still on page 1 (the #1784 rule), the attestation included
#   3. the short record: heading, table and sign-off all on page 1
# Run: python scripts/verify-competency-record-heading-keep.py <dir holding record-heading.pdf>
import os
import sys

import fitz  # PyMuPDF

out = sys.argv[1] if len(sys.argv) > 1 else "out-heading-keep"
failures = 0


def check(name, cond, detail=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  :: ' + detail if detail else ''}")
    if not cond:
        failures += 1


def pages(name):
    return [" ".join(p.get_text().split()).upper() for p in fitz.open(os.path.join(out, name))]


long_pages = pages("record-heading.pdf")
heading_pages = [i for i, t in enumerate(long_pages) if "COMPETENCY BY METHOD" in t]
hp = heading_pages[0] if heading_pages else None
check("1. long record: the heading's page also has the table header (EL 1 ... NEXT DUE)",
      hp is not None and "EL 1" in long_pages[hp] and "NEXT DUE" in long_pages[hp],
      f"heading on page {None if hp is None else hp + 1} of {len(long_pages)}")
p1 = long_pages[0]
check("2. long record: the sign-off block and all 14 sign-off lines are on page 1",
      "EVALUATOR SIGN-OFF BY METHOD" in p1 and "EACH EVALUATOR ATTESTS" in p1 and "SIEMENS CLINITEK ADVANTUS URINALYSIS ANALYZER" in p1.split("COMPETENCY BY METHOD")[0])
short = pages("record-heading-short.pdf")
check("3. short record: sign-off, heading and table all on page 1",
      "EVALUATOR SIGN-OFF BY METHOD" in short[0] and "COMPETENCY BY METHOD" in short[0] and "EL 1" in short[0])
print("ALL PASS" if not failures else f"{failures} FAIL")
sys.exit(1 if failures else 0)
