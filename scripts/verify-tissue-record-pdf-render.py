# scripts/verify-tissue-record-pdf-render.py
# Receipt for the tissue record PDF as a file (Michael Veri 2026-11-09, his approved Heywood mock). Reads the PDF that
# scripts/verify-tissue-record-pdf-ui.mjs downloaded in a real browser, renders page 1 to PNG to look at, and checks the words the
# PDF itself carries (PyMuPDF reads its text; pdf-lib can't): the header, the sections in the mock's order, the patient-chart line,
# the closing line, the footer on every page, the unit's steps in the history, no em dash and no patient field. With --mock it also
# checks the section headings and field labels against the approved mock PDF. Read-only on both PDFs. Exits non-zero on any failure.
#   python scripts/verify-tissue-record-pdf-render.py <record.pdf> <out.png> [--mock <mock.pdf>]
import re
import sys

import fitz  # PyMuPDF

sys.stdout.reconfigure(encoding="utf-8")
args = sys.argv[1:]
mock = None
if "--mock" in args:
    i = args.index("--mock")
    mock = args[i + 1]
    del args[i:i + 2]
src, png = args[0], args[1]
failures = 0


def check(name, cond, detail=""):
    global failures
    print(f"{'PASS' if cond else 'FAIL'}  {name}{'  :: ' + detail if (not cond and detail) else ''}")
    if not cond:
        failures += 1


SECTIONS = ["UNIT", "RECEIVED, MATERIALS MANAGEMENT", "RECEIVED, BLOOD BANK", "ISSUE", "IMPLANT", "TISSUE USAGE AND INFORMATION CARD",
            "RETURNED UNUSED TO BLOOD BANK", "OTHER DISPOSITION (WASTED, RETURNED TO SUPPLIER, EXPIRED)", "STEP HISTORY"]


def lines_of(doc):
    return [[ln.strip() for ln in page.get_text().splitlines() if ln.strip()] for page in doc]


def section_order(flat):
    at = []
    for s in SECTIONS:
        at.append(flat.index(s) if s in flat else -1)
    return at


doc = fitz.open(src)
pages = lines_of(doc)
flat = [ln for p in pages for ln in p]
text = " ".join(flat)
squashed = re.sub(r"\s+", " ", text)
check("one page", doc.page_count == 1, str(doc.page_count))
check("author metadata", doc.metadata.get("author") == "Perplexity Computer", str(doc.metadata.get("author")))
doc[0].get_pixmap(matrix=fitz.Matrix(1.6, 1.6)).save(png)
print(f"rendered page 1: {png}")

check("header: title, lab, CLIA, generated date", "VeritaStock™ Tissue Record" in flat and "Made-up Record Lab" in flat and "CLIA: 99D9999996" in flat
      and any(re.fullmatch(r"Generated \d{4}-\d{2}-\d{2}", ln) for ln in flat))
check("tissue ID and status", "TIS-REC-1" in flat and "Status: Implanted" in flat)
at = section_order(flat)
check("every section, in the mock's order", all(i >= 0 for i in at) and at == sorted(at), str(at))
check("the patient-chart line", "The recipient is recorded in the patient's chart, never in VeritaAssure®. A lookback runs from the tissue ID to this record, then to the chart." in squashed)
check("the closing line", "Recorded in VeritaStock™ by the laboratory's staff. Corrections and undone steps stay in the step history with their reason. Internal use: this is the laboratory's tissue record, not a signed report." in squashed)
for n, p in enumerate(pages, start=1):
    check(f"footer on page {n}", "VeritaAssure® | VeritaStock™ | Confidential, For Internal Lab Use Only" in p and f"Page {n} of {doc.page_count}" in p)
check("no em dash", "—" not in text)
check("no patient field", not re.search(r"recipient name|medical record|\bMRN\b|date of birth", text, re.I))
check("no URL a printed PDF mustn't carry (CLAUDE.md section 4)", not re.search(r"/#/|localhost|127\.0\.0\.1|radiant-quietude|staging|preview|https?://", text, re.I))
check("the current issue is printed: Dr. Second to OR 7", "Dr. Second" in flat and "OR 7" in flat)
check("returned unused: one, both checks", "1 (see step history)" in flat)
hist = flat[at[-1]:] if at[-1] >= 0 else []
steps = [s for s in ["Received in Materials Management", "Received in blood bank and stored", "Issued", "Returned unused to blood bank", "Issued", "Implanted", "Tissue usage card returned"]]
pos, ok = 0, True
for s in steps:
    try:
        pos = hist.index(s, pos) + 1
    except ValueError:
        ok = False
        break
check("history: every step, oldest first", ok, " | ".join(hist[:60]))
hist_text = re.sub(r"\s+", " ", " ".join(hist))
check("history: the return names who brought it, who received it, and the first issue", "Brought by C. Courier; received by R. Tech" in hist_text and "Issue it came back from:" in hist_text and "to OR 4, requested by Dr. Made Up" in hist_text, hist_text[:400])
check("history: the reconstitution", "Reconstituted 08:40 with Made-up Saline, lot SOL-1" in hist_text)

if mock:
    m = fitz.open(mock)
    mflat = [ln for p in lines_of(m) for ln in p]
    mat = section_order(mflat)
    check("the mock has the same sections in the same order", all(i >= 0 for i in mat) and mat == sorted(mat), str(mat))

    def labels(lines):
        # Field labels print in capitals (the CSS uppercases them); headings and values aren't on this list.
        return {ln for ln in lines if re.fullmatch(r"[A-Z][A-Z0-9 :()/,]+", ln) and re.search(r"[A-Z]{3,}", ln) and not ln.startswith("CLIA") and ln not in SECTIONS}
    lm, lr = labels(mflat), labels(flat)
    check("every field label in the mock is in the record", lm <= lr, f"missing: {sorted(lm - lr)}")
    check("the record adds no field label the mock doesn't have", lr <= lm, f"extra: {sorted(lr - lm)}")

print(f"{failures} FAILED" if failures else "ALL PASS")
sys.exit(1 if failures else 0)
