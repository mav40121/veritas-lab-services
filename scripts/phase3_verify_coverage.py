"""
Phase 3 coverage verification report.

For each of the 11 combined policies (IDs 97-111), reads its hand-authored
combined JSON template and every source template that was absorbed into
it (from server/policyTemplates/data/deprecated/), and produces a
side-by-side markdown report so Michael can scan for any source
obligation that is not represented in the combined policy.

The script includes a naive coverage hint: for each source policy_statement,
it counts the longest shared word-trigram between that source statement and
the combined statements. Source statements with a low overlap score are
flagged "LOW OVERLAP" so the reviewer's eye lands on them first. The score
is a hint, not a verdict — the reviewer makes the call.

Output: scripts/phase3_coverage_report.md  (and a copy in the Verita
Products desktop folder for easy review)

Run:
    python scripts/phase3_verify_coverage.py
"""

import json
import re
import shutil
from collections import Counter
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR   = REPO_ROOT / "server" / "policyTemplates" / "data"
DEPREC_DIR = DATA_DIR / "deprecated"
REPORT_PATH = REPO_ROOT / "scripts" / "phase3_coverage_report.md"
ALSO_COPY_TO = Path(r"C:\Users\veril\OneDrive\Desktop\Lab\Verita Products\Phase3_Coverage_Report.md")

# Full source-to-combined map across all 8 clusters.
CLUSTER_MAP = {
    "97":  ["41"],
    "98":  ["49", "50", "51"],
    "99":  ["42", "44", "45", "46", "47", "48", "55", "56", "57"],
    "100": ["52", "53", "54", "58", "59", "60"],
    "101": ["61", "62"],
    "102": ["43", "63", "64", "65"],
    "103": ["17", "91", "92", "93", "94"],
    "104": ["18", "19", "20"],
    "105": ["21"],
    "106": ["85", "86", "87", "88"],
    "107": ["75", "76", "77"],
    "108": ["25", "26", "27"],
    "109": ["29", "30", "31", "32"],
    "110": ["22", "23"],
    "111": ["82", "83", "84"],
}


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_template(combined_id):
    padded = combined_id.zfill(3)
    for fn in DATA_DIR.iterdir():
        if fn.name.startswith(padded + "_") and fn.name.endswith(".json"):
            return fn
    return None


def find_source(source_id):
    padded = source_id.zfill(3)
    for fn in DEPREC_DIR.iterdir():
        if fn.name.startswith(padded + "_") and fn.name.endswith(".json"):
            return fn
    return None


# Naive word-trigram overlap. Returns a 0-100 score for how well `src_stmt`
# is represented somewhere in `combined_stmts`. Not a real semantic match —
# just a hint for which source statements deserve eyeballs first.
def tokenize(text):
    # Lowercase, strip punctuation, split on whitespace, drop short noise words.
    words = re.findall(r"[a-z0-9][a-z0-9-]+", text.lower())
    return [w for w in words if len(w) >= 4 and w not in {
        "this","that","with","from","into","when","where","what","which",
        "their","there","have","been","must","shall","will","would","could",
        "policy","procedure","record","records","laboratory","review","reviewed",
        "documented","required","applicable","including","follow","followed",
        "every","each","also","only","upon","both","ensure","ensures","provide",
        "provides","include","includes","other","other_","retained","retain",
        "label","labeled","store","stored","perform","performed","performs",
        "complete","completes","conduct","conducted","date","dates","time","times",
    }]


def trigrams(tokens):
    return set(tuple(tokens[i:i+3]) for i in range(len(tokens) - 2)) if len(tokens) >= 3 else set(tuple(tokens))


def overlap_score(src_stmt, combined_stmts):
    src_tg = trigrams(tokenize(src_stmt))
    if not src_tg:
        return 100  # nothing to match (short statement) — assume covered
    best = 0
    for c in combined_stmts:
        c_tg = trigrams(tokenize(c))
        if not c_tg:
            continue
        shared = src_tg & c_tg
        pct = round(100 * len(shared) / len(src_tg))
        best = max(best, pct)
    return best


def render_combined(combined_id, sources):
    out = []
    out.append(f"## Combined #{combined_id}\n")

    template_path = find_template(combined_id)
    if not template_path:
        out.append(f"  ⚠️  template file not found in DATA_DIR\n")
        return "\n".join(out)
    tmpl = load_json(template_path)

    out.append(f"**Combined policy_name:** {tmpl['policy_name']}\n")
    out.append(f"**Source IDs absorbed:** {', '.join(sources)}\n")
    out.append("")
    out.append("### Combined content (what we ship)\n")
    out.append("**policy_statements:**\n")
    for i, s in enumerate(tmpl.get("policy_statements", []), start=1):
        out.append(f"{i}. {s}")
    out.append("")
    out.append("**procedure_steps:**\n")
    for i, s in enumerate(tmpl.get("procedure_steps", []), start=1):
        out.append(f"{i}. {s}")
    out.append("")
    out.append("**definitions:**\n")
    for d in tmpl.get("definitions", []):
        if isinstance(d, list) and len(d) == 2:
            out.append(f"- **{d[0]}** — {d[1]}")
        else:
            out.append(f"- {d}")
    out.append("")

    combined_stmts = tmpl.get("policy_statements", [])
    combined_steps = tmpl.get("procedure_steps", [])
    combined_defs = [d[0] for d in tmpl.get("definitions", []) if isinstance(d, list) and len(d) == 2]

    out.append("### Source-side coverage check\n")
    for src_id in sources:
        src_path = find_source(src_id)
        if not src_path:
            out.append(f"\n#### Source #{src_id}: ⚠️  source file not found in deprecated/\n")
            continue
        src = load_json(src_path)
        out.append(f"\n#### Source #{src_id}: {src['policy_name']}\n")
        out.append(f"_({len(src.get('policy_statements',[]))} statements · {len(src.get('procedure_steps',[]))} steps · {len(src.get('definitions',[]))} definitions)_\n")

        out.append("**Source policy_statements:**\n")
        for i, s in enumerate(src.get("policy_statements", []), start=1):
            score = overlap_score(s, combined_stmts)
            flag = "🚩 LOW OVERLAP" if score < 25 else ("⚠️  partial" if score < 50 else f"✓ ({score}%)")
            out.append(f"{i}. [{flag}] {s}")
        out.append("")
        out.append("**Source procedure_steps:**\n")
        for i, s in enumerate(src.get("procedure_steps", []), start=1):
            score = overlap_score(s, combined_steps)
            flag = "🚩 LOW OVERLAP" if score < 25 else ("⚠️  partial" if score < 50 else f"✓ ({score}%)")
            out.append(f"{i}. [{flag}] {s}")
        out.append("")
        out.append("**Source definitions:**\n")
        for d in src.get("definitions", []):
            if isinstance(d, list) and len(d) == 2:
                covered = any(d[0].lower() in cd.lower() or cd.lower() in d[0].lower() for cd in combined_defs)
                flag = "✓" if covered else "🚩 NOT IN COMBINED"
                out.append(f"- [{flag}] **{d[0]}** — {d[1]}")
        out.append("")

    out.append("\n---\n")
    return "\n".join(out)


def main():
    out_lines = []
    out_lines.append("# VeritaPolicy Phase 3 — Coverage Verification Report\n")
    out_lines.append(
        "Generated automatically. For each of the 11 combined policies (IDs "
        "97-111), this report lists what the combined template ships PLUS every "
        "source policy_statement / procedure_step / definition that was absorbed "
        "into it. A naive word-trigram overlap score flags 🚩 LOW OVERLAP (less "
        "than 25% trigram overlap with any combined statement) so your eye lands "
        "first on source obligations that may not be carried into the combined "
        "version.\n"
    )
    out_lines.append(
        "**The flag is a hint, not a verdict.** A 🚩 may be perfectly covered by "
        "different wording the algorithm didn't catch. A high score may still "
        "miss substantive nuance. The reviewer makes the call.\n"
    )
    out_lines.append("\n---\n")

    for combined_id in sorted(CLUSTER_MAP.keys(), key=int):
        sources = CLUSTER_MAP[combined_id]
        # Skip 1:1 mappings — those are just renames, no coverage risk
        if len(sources) == 1:
            out_lines.append(
                f"## Combined #{combined_id}\n"
                f"(1:1 mapping from source #{sources[0]} — coverage risk is "
                f"low; not detailed here. Read the combined template directly "
                f"if you want to verify.)\n\n---\n"
            )
            continue
        out_lines.append(render_combined(combined_id, sources))

    report = "\n".join(out_lines)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Wrote {REPORT_PATH}  ({len(report):,} chars)")

    try:
        ALSO_COPY_TO.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPORT_PATH, ALSO_COPY_TO)
        print(f"Copied to {ALSO_COPY_TO}")
    except Exception as e:
        print(f"Could not copy to desktop: {e}")


if __name__ == "__main__":
    main()
