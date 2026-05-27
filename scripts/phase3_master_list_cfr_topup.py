"""
Phase 3 master list CFR-citation top-up.

After the Phase3_Curated_Gaps enrichment of the 12 combined templates,
several new federal citations were introduced into the JSON templates
that are not yet reflected in the corresponding rows of
server/veritapolicyMasterList.ts under cfr_citations.

This script appends only the missing citations to each row, dedup-safe.
No existing citations are removed or reordered.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_LIST = REPO_ROOT / "server" / "veritapolicyMasterList.ts"

ADD = {
    "98":  ["42 CFR 493.1256"],
    "102": ["21 CFR 607.20", "21 CFR 630.40"],
    "103": ["42 CFR 493.1775"],
    "104": ["42 CFR 493.1413", "42 CFR 493.1451"],
    "106": ["42 CFR 493.17", "42 CFR 493.1775"],
    "108": ["42 CFR 493.1281", "42 CFR 493.1283", "45 CFR 164.502", "45 CFR 164.504", "45 CFR 164.404"],
    "109": ["42 CFR 493.1200", "42 CFR 493.1775"],
    "110": ["29 CFR 1910.1020"],
    "111": ["21 CFR 1271.85", "21 CFR 1271.270", "21 CFR 1271.350"],
}


def main():
    text = MASTER_LIST.read_text(encoding="utf-8")
    m = re.search(
        r"(export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*)\[(.*)\];\s*$",
        text, re.DOTALL,
    )
    if not m:
        print("FATAL: could not locate master list", file=sys.stderr)
        sys.exit(1)
    header, body = m.group(1), m.group(2)
    rows = json.loads("[" + body + "]")
    print(f"Parsed {len(rows)} rows")

    changes = 0
    for r in rows:
        pid = r["policy_id"]
        if pid not in ADD:
            continue
        existing = [c.strip() for c in (r.get("cfr_citations") or "").split(";") if c.strip()]
        appended_for_row = []
        for new_cit in ADD[pid]:
            if new_cit not in existing:
                existing.append(new_cit)
                appended_for_row.append(new_cit)
        if appended_for_row:
            r["cfr_citations"] = "; ".join(existing)
            print(f"  #{pid}: appended {appended_for_row}")
            changes += 1
        else:
            print(f"  #{pid}: nothing to add (all citations already present)")

    if not changes:
        print("Nothing to write. Exiting clean.")
        return

    keys = ["policy_id","policy_name","section","subspecialty","service_line",
            "description","cfr_citations","tjc_citations","cap_citations",
            "cola_citations","aabb_citations","notes"]

    def serialize_row(r):
        body_lines = [f'    "{k}": {json.dumps(r[k], ensure_ascii=False)}' for k in keys if k in r]
        return "  {\n" + ",\n".join(body_lines) + "\n  }"

    body_out = ",\n".join(serialize_row(r) for r in rows)
    new_text = header + "[\n" + body_out + "\n];\n"
    MASTER_LIST.write_text(new_text, encoding="utf-8")
    print(f"\nWrote {MASTER_LIST}  ({changes} rows updated)")


if __name__ == "__main__":
    main()
