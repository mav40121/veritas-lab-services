"""Print the eCFR text (2026-10-01 edition, house dashes) at one or more citations, from the same
parser rebuild_cfr_quotes.py uses. Usage: python show_cfr.py "42 CFR 493.1101(d)" "21 CFR 606.151(c)" ..."""
import sys
import rebuild_cfr_quotes as R

corpus = R.Corpus()
for cite in sys.argv[1:]:
    c = R.parse_cite(cite)
    if (c["title"], c["part"]) in R.WHOLE_PARTS:
        corpus.load_part(c["title"], c["part"])
    else:
        corpus.load_section(c["title"], c["part"], c["section"])
    t = corpus.text_at(c["section"], c["path"], c["upto"], c.get("intro"))
    print(f"== {cite}  [{corpus.heads.get(c['section'], '')}]  {len(t or '')} chars")
    print("   " + (R.house(t)[:1400] if t else "(not found)"))
