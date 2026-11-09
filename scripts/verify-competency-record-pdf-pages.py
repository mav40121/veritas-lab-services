"""Receipt for BUG-144 (2026-11-09): what the VeritaComp Employee Competency Record prints on each PDF page.

A live record with 36 methods printed only its header on page 1: the evaluator sign-off block was kept whole, it was taller
than a page, so Chrome moved all of it to page 2. The layout checks in scripts/verify-competency-record-signoff-page1.mjs read
a screen layout, which has no pages, so they passed. This reads the PDFs that script writes, page by page.

Run after it, on the same folder:
  node --import tsx scripts/verify-competency-record-signoff-page1.mjs        (writes out-signoff-page1/record-*.pdf)
  python scripts/verify-competency-record-pdf-pages.py out-signoff-page1
Checks, for every record: page 1 holds the sign-off heading and the first method's sign-off line, and every method's line
prints somewhere in the sign-off section; for 36 methods, page 1 holds at least 15 lines and the column headings repeat on the
page the block continues on; the method table prints after the block.
"""
import os
import sys

import fitz

OUT = sys.argv[1] if len(sys.argv) > 1 else "out-signoff-page1"
failures = 0


def check(name, cond, detail=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  :: ' + detail if detail else ''}")
    if not cond:
        failures += 1


def pages(name):
    doc = fitz.open(os.path.join(OUT, f"record-{name}.pdf"))
    return [p.get_text() for p in doc]


HEAD = "EVALUATOR SIGN-OFF BY METHOD"
TABLE = "COMPETENCY BY METHOD"
for name, first in (("short", "Beckman Coulter AU5800"), ("long14", "Sysmex CA-620 / CA-660"), ("many24", "Analyzer 1"), ("many36", "Analyzer 01")):
    txt = pages(name)
    p1 = txt[0]
    check(f"{name}: page 1 holds the sign-off heading", HEAD in p1.upper())
    check(f"{name}: page 1 holds the first method's sign-off line", first in p1.split(TABLE)[0] if TABLE in p1.upper() else first in p1)

t36 = pages("many36")
p1 = t36[0]
on_p1 = sum(1 for i in range(1, 37) if f"Analyzer {i:02d}" in p1)
check("many36: page 1 holds at least 15 sign-off lines", on_p1 >= 15, f"{on_p1} of 36 on page 1")
sign_text = "\n".join(t36)
upper_all = sign_text.upper()
before_table = sign_text[: upper_all.index(TABLE)] if TABLE in upper_all else sign_text
check("many36: every method has its sign-off line before the method table", all(f"Analyzer {i:02d}" in before_table for i in range(1, 37)))
cont = next((t for t in t36[1:] if "Analyzer 36" in t), "")
check("many36: the column headings repeat on the page the block continues on", "EVALUATOR NAME" in cont.upper() and "DATE SIGNED" in cont.upper())
check("many36: the method table prints after the sign-off block", TABLE in upper_all and upper_all.index(HEAD) < upper_all.index(TABLE))
check("many36: page 1 is not just the header", len(p1.strip()) > 1500, f"{len(p1.strip())} characters on page 1")
print("ALL PASS" if not failures else f"{failures} FAIL")
sys.exit(1 if failures else 0)
