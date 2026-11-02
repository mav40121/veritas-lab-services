# scripts/verify-competency-record-pdf-entries.py
#
# Receipt for the VeritaComp record PDF's signed entries (Michael 2026-11-02, Q115 = 1). Reads the record.pdf that
# scripts/verify-competency-signed-entries-ui.mjs saves from a scratch DB with made-up people, and checks:
#   1. page 1 keeps the method matrix and the evaluator sign-off block, and carries no signed entries (CLAUDE.md 5)
#   2. the signed entries start on page 2: both chemistry sign-offs (6-month and the earlier initial) with their
#      entries, observers named, the N/A reason, both Element 5 samples, the documentation note, and the waived
#      method's evidence
#   3. no em dash in the entries pages
# It also renders pages 1 and 2 to PNG next to the PDF for a visual check.
# Run: python scripts/verify-competency-record-pdf-entries.py <dir holding record.pdf>
import os
import sys

import fitz  # PyMuPDF

out = sys.argv[1] if len(sys.argv) > 1 else "."
doc = fitz.open(os.path.join(out, "record.pdf"))
failures = 0


def check(name, cond, detail=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  :: ' + detail if detail else ''}")
    if not cond:
        failures += 1


pages = [" ".join(p.get_text().split()) for p in doc]
p1 = pages[0] if pages else ""
p2 = pages[1] if len(pages) > 1 else ""
entries = " ".join(pages[1:-1]) if len(pages) > 2 else p2

check("1a. page 1 keeps the method matrix and the evaluator sign-off block",
      "COMPETENCY BY METHOD" in p1.upper() and "EVALUATOR SIGN-OFF BY METHOD" in p1.upper(), p1[:120])
check("1b. page 1 carries no signed entries", "The entries each method was signed on" not in p1 and "S-6MO" not in p1)
check("2a. page 2 starts the signed entries", "SIGNED ENTRIES" in p2.upper()[:80], p2[:80])
check("2b. the 6-month block: header, specimen S-6MO, observer named, N/A reason",
      "Beckman Coulter AU5800 · 6-month" in entries and "S-6MO" in entries and "CT (Tate, Casey)" in entries
      and "N/A: QC reviewed under element 2 for this cycle" in entries, entries[:200])
check("2c. the earlier initial block: S-INIT, MC (Chen, Morgan), both samples, the documentation note",
      "S-INIT" in entries and "MC (Chen, Morgan)" in entries and "Sample 1: PT, PT-1, acceptable" in entries
      and "Sample 2: PT, PT-2, acceptable" in entries and "Documentation: Paper record in the competency binder" in entries)
check("2d. the waived urinalysis block: evidence and initials",
      "Siemens CLINITEK Status+ · Initial" in entries and "Blind BS-1 read correctly" in entries and "Written test 10/10" in entries)
check("3. no em dash on the entries pages", "—" not in entries)

for i in range(min(2, len(doc))):
    doc[i].get_pixmap(dpi=110).save(os.path.join(out, f"record_page{i + 1}.png"))
print(f"{len(doc)} pages")
print(f"\n{failures} FAILED" if failures else "\nALL PASS")
sys.exit(1 if failures else 0)
