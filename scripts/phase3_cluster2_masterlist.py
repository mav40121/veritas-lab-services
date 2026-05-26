"""
Phase 3 Cluster 2 master-list update. Mirrors phase3_cluster1_masterlist.py.

Removes 9 Personnel source rows (IDs 17-21, 91-94) and inserts 3 combined
rows (IDs 103-105) with aggregated accreditor citations.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_LIST_PATH = REPO_ROOT / "server" / "veritapolicyMasterList.ts"

SOURCE_TO_COMBINED = {
    "17": "103", "91": "103", "92": "103", "93": "103", "94": "103",
    "18": "104", "19": "104", "20": "104",
    "21": "105",
}
COMBINED_IDS = sorted(set(SOURCE_TO_COMBINED.values()), key=int)

COMBINED_META = {
    "103": {
        "policy_name": "Personnel Qualifications Policy",
        "section": "Personnel",
        "subspecialty": "",
        "service_line": "all",
        "description": "Qualifications, credential verification, and CLIA-defined responsibilities for every personnel role: Laboratory Director, Technical Supervisor (high complexity), General Supervisor (moderate complexity), Technical Consultant where applicable, and Testing Personnel. Credentials are verified from primary source at hire and re-verified on the lab's defined cadence (typically at license renewal).",
        "notes": "Consolidates sources #17, #91, #92, #93, #94. Covers 42 CFR 493 Subpart M (high complexity 493.1441-493.1495) plus parallel moderate-complexity sections (493.1361-493.1413).",
    },
    "104": {
        "policy_name": "Training and Competency Policy",
        "section": "Personnel",
        "subspecialty": "",
        "service_line": "all",
        "description": "Orientation, continuing education, and competency assessment for testing personnel. Competency assessed against the six CLIA-required elements at 42 CFR 493.1235 on the Initial / 6-month / Annual cadence. Evaluator role enforced by complexity (Technical Supervisor for high; Technical Consultant for moderate). Laboratory Director or designee signs the final record.",
        "notes": "Consolidates sources #18, #19, #20. Six CLIA elements: direct observation of testing, recording/reporting monitoring, intermediate-results/QC/PT review, observation of instrument maintenance, blind/PT sample testing, problem-solving.",
    },
    "105": {
        "policy_name": "Staff Performance Evaluation Policy",
        "section": "Personnel",
        "subspecialty": "",
        "service_line": "all",
        "description": "HR-driven annual performance evaluation distinct from CLIA competency assessment. Covers role-based competencies, dependability, communication, teamwork, policy adherence, compliance behavior, and development goals. Conducted by direct supervisor and reviewed by the Laboratory Director or designee.",
        "notes": "1:1 mapping from source #21 (renamed for combined-cluster consistency). Performance evaluation is a separate document from CLIA competency assessment and does not substitute for it.",
    },
}


def join_unique(citations_list):
    seen = []
    for cits in citations_list:
        for c in (cits or "").split(";"):
            c = c.strip()
            if c and c not in seen:
                seen.append(c)
    return "; ".join(seen)


def main():
    with open(MASTER_LIST_PATH, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(
        r"(export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*)\[(.*)\];\s*$",
        text, re.DOTALL,
    )
    if not m:
        print("FATAL: could not locate master list array", file=sys.stderr)
        sys.exit(1)
    header = m.group(1)
    body = m.group(2)
    rows = json.loads("[" + body + "]")
    print(f"Parsed {len(rows)} existing rows")

    kept = [r for r in rows if r["policy_id"] not in SOURCE_TO_COMBINED]
    sources = [r for r in rows if r["policy_id"] in SOURCE_TO_COMBINED]
    print(f"  -> {len(kept)} kept, {len(sources)} sources to merge")

    new_rows = []
    for combined_id in COMBINED_IDS:
        src_for_this = [r for r in sources if SOURCE_TO_COMBINED[r["policy_id"]] == combined_id]
        meta = COMBINED_META[combined_id]
        new_row = {
            "policy_id": combined_id,
            "policy_name": meta["policy_name"],
            "section": meta["section"],
            "subspecialty": meta["subspecialty"],
            "service_line": meta["service_line"],
            "description": meta["description"],
            "cfr_citations":  join_unique(r.get("cfr_citations","")  for r in src_for_this),
            "tjc_citations":  join_unique(r.get("tjc_citations","")  for r in src_for_this),
            "cap_citations":  join_unique(r.get("cap_citations","")  for r in src_for_this),
            "cola_citations": join_unique(r.get("cola_citations","") for r in src_for_this),
            "aabb_citations": join_unique(r.get("aabb_citations","") for r in src_for_this),
            "notes": meta["notes"],
        }
        new_rows.append(new_row)
        print(f"  Built {combined_id}: cfr={len(new_row['cfr_citations'].split('; ')) if new_row['cfr_citations'] else 0} tjc={len(new_row['tjc_citations'].split('; ')) if new_row['tjc_citations'] else 0}")

    final_rows = kept + new_rows
    print(f"Final master list: {len(final_rows)} rows")

    def serialize_row(r):
        keys = ["policy_id","policy_name","section","subspecialty","service_line",
                "description","cfr_citations","tjc_citations","cap_citations",
                "cola_citations","aabb_citations","notes"]
        body_lines = [f'    "{k}": {json.dumps(r[k], ensure_ascii=False)}' for k in keys if k in r]
        return "  {\n" + ",\n".join(body_lines) + "\n  }"

    body_out = ",\n".join(serialize_row(r) for r in final_rows)
    new_text = header + "[\n" + body_out + "\n];\n"
    with open(MASTER_LIST_PATH, "w", encoding="utf-8") as f:
        f.write(new_text)
    print(f"\nWrote {MASTER_LIST_PATH}  ({len(new_text):,} chars)")


if __name__ == "__main__":
    main()
