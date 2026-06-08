#!/usr/bin/env python3
"""
build_cfr_topics_in_our_words.py

Build server/cfrTopicsInOurWords.ts from master xlsx CFR_Library's
topic_in_our_words column. Emits a flat TS map:

  export const CFR_TOPICS_IN_OUR_WORDS: Record<string, string> = {
    "42 CFR §493.1251": "procedure manual required and followed",
    ...
  };

Safe-mode rule: only emit topics for CFR cites where master has a single
section_title (or all rows share the same section_title). Multi-facet
cites are SKIPPED because the appropriate facet would need row-by-row
review.

Used by server/veritapolicyDocx.ts at DOCX render time to render the
plain-language synthesis callout above the Purpose section. Per the
discipline lesson from 2026-06-07: this surfaces master's existing
plain-English column as the canonical source, instead of inventing a
parallel free-text field on each policy template.
"""

import pathlib
import re
from collections import defaultdict

import pandas as pd


MASTER_XLSX = pathlib.Path(
    r"C:\Users\veril\OneDrive\Desktop\Lab\Regulatory"
    r"\aaa Truth Master Document\veritaassure_master_citation_index_v0.11.xlsx"
)
OUT_TS = pathlib.Path(
    r"C:\Users\veril\projects\veritas-lab-services\server\cfrTopicsInOurWords.ts"
)


def main() -> int:
    lib = pd.read_excel(MASTER_XLSX, sheet_name="CFR_Library")
    # Group rows by cfr_citation, collect (section_title, topic) pairs.
    by_cite = defaultdict(list)
    for _, row in lib.iterrows():
        cite = row.get("cfr_citation")
        if cite is None or isinstance(cite, float):
            continue
        cite = str(cite).strip()
        st = row.get("section_title")
        st = "" if (st is None or isinstance(st, float)) else str(st).strip()
        topic = row.get("topic_in_our_words")
        if topic is None or isinstance(topic, float):
            continue
        topic = str(topic).strip()
        if not topic:
            continue
        by_cite[cite].append((st, topic))

    # Safe-mode emit. The codebase uses "42 CFR §493.X" form; master uses
    # "42 CFR 493.X". Normalize on emit.
    out_pairs = []
    skipped_multi = 0
    for cite, entries in sorted(by_cite.items()):
        titles = {st for st, _ in entries}
        if len(titles) > 1:
            skipped_multi += 1
            continue
        # Pick the topic. If multiple rows share the same section_title,
        # they typically share the same topic; if not, pick the first.
        topic = entries[0][1]
        # Normalize codebase form
        codebase_cite = re.sub(r"^(\d+ CFR) (\d)", r"\1 §\2", cite)
        out_pairs.append((codebase_cite, topic))

    # Write TS file with deterministic ordering for diff stability.
    lines = [
        "// Auto-generated from server/scripts/build_cfr_topics_in_our_words.py.",
        "// Source: veritaassure_master_citation_index_v0.11.xlsx CFR_Library.topic_in_our_words.",
        "// Re-run the script when master is updated.",
        "//",
        "// Safe-mode rule: only CFR cites where master has a single section_title",
        "// (or all rows share the same section_title) emit a topic. Multi-facet",
        "// cites are skipped; they need row-by-row review.",
        "//",
        "// Per the 2026-06-07 discipline lesson: this surfaces master's existing",
        "// plain-English column as the canonical source. Do not invent a parallel",
        "// free-text field on policy templates.",
        "",
        "export const CFR_TOPICS_IN_OUR_WORDS: Record<string, string> = {",
    ]
    for cite, topic in out_pairs:
        topic_escaped = topic.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'  "{cite}": "{topic_escaped}",')
    lines.append("};")
    lines.append("")

    OUT_TS.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote: {OUT_TS}")
    print(f"  Cites emitted: {len(out_pairs)}")
    print(f"  Multi-facet skips: {skipped_multi}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
