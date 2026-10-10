"""Write scripts/data/ecfr_sections_<date>.json: every CFR section the VeritaPolicy master-list crosswalk cites,
with its eCFR heading, fetched from the eCFR point-in-time edition. A citation whose section the eCFR does not
have stops the build. scripts/verify-policy-crosswalk-cfr.mjs checks the crosswalk against this file, so adding
a citation means re-running this script (which proves the section exists)."""
import json, os, re
import rebuild_cfr_quotes as R
from apply_crosswalk import MASTER, parse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data", f"ecfr_sections_{R.ECFR_DATE}.json")


def main():
    rows = parse(open(MASTER, encoding="utf-8").read())
    corpus = R.Corpus()
    secs, missing = {}, []
    for r in rows:
        for cite in [c.strip() for c in r["cfr_citations"].split(";") if c.strip()]:
            m = re.match(r"(\d+)\s*CFR\s*(?:Part\s*)?(\d+)(?:\.(\d+[a-z]?))?", cite)
            if not m:
                missing.append((r["policy_id"], cite, "unparsed")); continue
            title, part, sec = m.groups()
            key = f"{title} CFR {part}" + (f".{sec}" if sec else "")
            if key in secs:
                continue
            if not sec:
                secs[key] = f"Part {part}"; continue
            s = f"{part}.{sec}"
            if s not in corpus.sections:
                try:
                    corpus.load_part(title, part) if (title, part) in R.WHOLE_PARTS else corpus.load_section(title, part, s)
                except Exception:
                    pass
            if s in corpus.sections:
                secs[key] = R.clean(corpus.heads.get(s, ""))
            else:
                missing.append((r["policy_id"], cite, "not in the eCFR"))
    if missing:
        raise SystemExit(f"crosswalk cites sections the eCFR does not have: {missing}")
    json.dump({"source": f"eCFR point-in-time {R.ECFR_DATE}", "sections": dict(sorted(secs.items()))}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"{len(secs)} sections -> {OUT}")


if __name__ == "__main__":
    main()
