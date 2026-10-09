"""Detect body text running under a floating page header in rendered policy PDFs (Troy format, BUG-013 follow-up).
On every page after the first, the header band is a table whose bottom rule is the lowest ruled line in the top
quarter of the page. Header rows hold a few words each; a body paragraph line holds many. Any line of more than
8 words that starts above the band's bottom rule means the body runs under the header.
Usage: python detect_header_overlap.py <pdf> [<pdf> ...]  -> one line per PDF: pages that overlap."""
import sys
import fitz

for pdf in sys.argv[1:]:
    d = fitz.open(pdf)
    bad = []
    for i in range(1, len(d)):
        p = d[i]
        rules = [r["rect"].y1 for r in p.get_drawings() if r["rect"].y1 < p.rect.height / 4]
        if not rules:
            continue
        band_bottom = max(rules)
        lines = {}
        for w in p.get_text("words"):
            lines.setdefault((w[5], w[6]), []).append(w)
        if any(len(ws) > 8 and min(w[1] for w in ws) < band_bottom - 1 for ws in lines.values()):
            bad.append(i + 1)
    print(f"{pdf.replace(chr(92), '/').split('/')[-1]}\t{len(d)} pages\toverlap on pages: {bad or 'none'}")
