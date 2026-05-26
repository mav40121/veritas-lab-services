"""
Phase 3 Clusters 3-8 master-list update.

Removes 19 source rows from server/veritapolicyMasterList.ts and inserts
6 combined rows (IDs 106-111). Aggregates accreditor citations from
sources into the corresponding combined rows.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_LIST_PATH = REPO_ROOT / "server" / "veritapolicyMasterList.ts"

SOURCE_TO_COMBINED = {
    # Cluster 3 (Waived/POCT) -> 106
    "85": "106", "86": "106", "87": "106", "88": "106",
    # Cluster 4 (Molecular) -> 107
    "75": "107", "76": "107", "77": "107",
    # Cluster 5 (Health Info Mgmt true merge only; #24 and #89 stay standalone) -> 108
    "25": "108", "26": "108", "27": "108",
    # Cluster 6 (Leadership Governance) -> 109
    "29": "109", "30": "109", "31": "109", "32": "109",
    # Cluster 7 (Infection Prevention) -> 110
    "22": "110", "23": "110",
    # Cluster 8 (HCT/P) -> 111
    "82": "111", "83": "111", "84": "111",
}
COMBINED_IDS = sorted(set(SOURCE_TO_COMBINED.values()), key=int)

COMBINED_META = {
    "106": {
        "policy_name": "Waived and Point-of-Care Testing Policy",
        "section": "Testing",
        "subspecialty": "Waived / POCT",
        "service_line": "all",
        "description": "Scope of waived tests offered, manufacturer-prescribed quality control, testing personnel competency on the Initial / 6-month / Annual cadence (six elements per 42 CFR 493.1235), and central oversight of POC testing across all sites under the lab's CLIA certificate. Waived tests are performed strictly per the manufacturer's package insert; any deviation reclassifies as non-waived.",
        "notes": "Consolidates sources #85, #86, #87, #88. POC sites (clinics, ED, ICU, off-site) inventoried and overseen centrally by the lab. Records retained per 42 CFR 493.1105.",
    },
    "107": {
        "policy_name": "Molecular Testing Policy",
        "section": "Testing",
        "subspecialty": "Molecular",
        "service_line": "molecular",
        "description": "Method verification for performance specifications, molecular-specific QC (positive, negative, internal amplification controls), contamination prevention for amplification-based methods, and additional requirements for molecular genetic testing under 42 CFR 493.1276. Genetic test reports include interpretive guidance signed by the Laboratory Director or designee.",
        "notes": "Consolidates sources #75, #76, #77. Service-line gated to labs offering molecular work. Genetic-test records carry longer retention than general molecular records.",
    },
    "108": {
        "policy_name": "Health Information Management Policy",
        "section": "Information Systems",
        "subspecialty": "",
        "service_line": "all",
        "description": "HIPAA privacy and security (administrative, physical, technical safeguards) plus data capture, transmission, and retention. PHI transmitted only through validated encrypted channels; need-to-know access control with periodic review; breach notification per 45 CFR 164.402 onward.",
        "notes": "Consolidates sources #25, #26, #27. LIS Downtime (#24) and Cybersecurity Incident Response (#89) remain separate standalone policies per the consolidation plan because their event-driven shape differs from steady-state privacy/security.",
    },
    "109": {
        "policy_name": "Laboratory Governance and Leadership Policy",
        "section": "Leadership",
        "subspecialty": "",
        "service_line": "all",
        "description": "Organizational chart and reporting structure, Laboratory Director responsibilities (42 CFR 493.1445), quality program governance (42 CFR 493.1200), culture of safety and quality using just-culture principles, and code of ethical conduct for all personnel. Annual leadership review of the governance structure and code of conduct.",
        "notes": "Consolidates sources #29, #30, #31, #32. Org chart maintained in the leadership binder, updated on every role change.",
    },
    "110": {
        "policy_name": "Infection Prevention and Standard Precautions Policy",
        "section": "Safety",
        "subspecialty": "",
        "service_line": "all",
        "description": "Infection prevention program covering exposure control, hand hygiene, PPE, sharps handling, biological spill response, and post-exposure follow-up. Standard precautions for every specimen and every patient interaction. OSHA Bloodborne Pathogens training at hire and annually for every staff member.",
        "notes": "Consolidates sources #22 and #23. Sharps injury log reviewed on documented cadence; exposure control plan signed by Laboratory Director or designee and Safety Officer annually.",
    },
    "111": {
        "policy_name": "Human Cells, Tissues, and Cellular Tissue-Based Products (HCT/P) Policy",
        "section": "Specialty Services",
        "subspecialty": "HCT/P",
        "service_line": "hct_p",
        "description": "Donor eligibility determination per 21 CFR 1271.85 before recovery, tissue handling and tracking per 21 CFR 1271.155, and post-distribution adverse reaction reporting to FDA per 21 CFR 1271.350. Tissue records retained at least 10 years post-distribution per 21 CFR 1271.270.",
        "notes": "Consolidates sources #82, #83, #84. Applies only to laboratories that recover, process, or distribute HCT/Ps. Most clinical hospital labs do not have this scope.",
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
    header, body = m.group(1), m.group(2)
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
        print(f"  Built {combined_id}: cfr={len(new_row['cfr_citations'].split('; ')) if new_row['cfr_citations'] else 0}")
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
