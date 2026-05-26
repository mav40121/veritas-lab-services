"""
Phase 3 Cluster 1 master-list update.

Companion to phase3_cluster1_transfusion.py. That script writes the 6 new
combined-policy JSON templates. This script updates server/veritapolicyMasterList.ts:

  - Removes 25 source rows (policy_id 41 through 65).
  - Aggregates each source row's tjc/cap/cola/aabb citations into the
    corresponding combined-policy row (deduped, semicolon-joined).
  - Inserts 6 new rows (policy_id 97 through 102) at the end of the array
    just before the closing `];`.
  - Authors the description + notes fields by hand (one paragraph each)
    so the new rows read like real master-list content, not concatenated
    source descriptions.

The Effort/Importance/per-AO-citation aggregation is done by parsing the
existing array as a JSON-like blob (after stripping TS export wrappers),
which is safe because the rows are pure data (no expressions).

Run:
    python scripts/phase3_cluster1_masterlist.py
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MASTER_LIST_PATH = REPO_ROOT / "server" / "veritapolicyMasterList.ts"

# Source ID -> combined ID
SOURCE_TO_COMBINED = {
    "41": "97",
    "49": "98", "50": "98", "51": "98",
    "42": "99", "44": "99", "45": "99", "46": "99", "47": "99",
    "48": "99", "55": "99", "56": "99", "57": "99",
    "52": "100", "53": "100", "54": "100", "58": "100", "59": "100", "60": "100",
    "61": "101", "62": "101",
    "43": "102", "63": "102", "64": "102", "65": "102",
}
COMBINED_IDS = sorted(set(SOURCE_TO_COMBINED.values()), key=int)

# Hand-authored per-combined-policy metadata. Accreditor citations are
# aggregated from sources by code; description and notes are written here
# to flow as a real master-list entry rather than a concat of source descs.
COMBINED_META = {
    "97": {
        "policy_name": "Transfusion Service Master Policies and Procedures",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "Top-level framework for the laboratory's transfusion service: scope, governance, and the structure linking every transfusion-service sub-policy. Sub-policies cover pretransfusion testing, blood component handling, transfusion administration, recipient look-back, and donor operations. The medical director or designee approves the master and every sub-policy.",
        "notes": "Replaces source #41. The five sub-policies (#98-#102) sit under this master. Records retained at least 10 years per 42 CFR 493.1105(a)(7).",
    },
    "98": {
        "policy_name": "Pretransfusion Testing Policy",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "Specimen collection, ABO and Rh typing, antibody screen, and compatibility testing for every transfusion recipient. Includes two-identifier verification at draw, forward and reverse ABO grouping, weak D where applicable, and serologic or electronic crossmatch. Repeat ABO/Rh on a second specimen before the first non-O group-specific transfusion unless an electronic patient-identification system is in place.",
        "notes": "Consolidates sources #49 + #50 + #51. Electronic crossmatch permitted only when recipient meets all FDA-recognized criteria.",
    },
    "99": {
        "policy_name": "Blood Component Handling Policy",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "Component handling from supplier receipt through final disposition: inventory management, release to internal and external organizations, transport and storage, storage alarm response, reagent criteria and reactivity testing, plasma processing, irradiation, and leukoreduction. Continuous temperature monitoring, daily reagent QC, and unit-level traceability throughout.",
        "notes": "Consolidates sources #42, #44, #45, #46, #47, #48, #55, #56, #57. Records of storage temp, alarm events, reagent QC, and component disposition retained per 42 CFR 493.1105 and 21 CFR 606.160.",
    },
    "100": {
        "policy_name": "Transfusion Administration Policy",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "Component issue, donor/recipient identification at issue, emergency release, Rh Immune Globulin administration, neonatal and pediatric transfusion, transfusion monitoring, and transfusion reaction investigation. Two-identifier verification at every component issue; FDA fatality reporting timeframes observed.",
        "notes": "Consolidates sources #52, #53, #54, #58, #59, #60. Transfusion reaction file maintained per 21 CFR 606.170. Fatalities reported to FDA CBER within required timeframe.",
    },
    "101": {
        "policy_name": "Blood Recipient Look-Back Policy (HIV and HCV)",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "FDA-mandated look-back response when a previous blood donor tests positive for HIV (21 CFR 610.46) or HCV (21 CFR 610.47): identify recipients of components from the implicated donor, notify the recipients' treating physicians within the FDA-required timeframe with the agent-specific language, and quarantine any in-inventory components.",
        "notes": "Consolidates sources #61 (HIV) + #62 (HCV) into one workflow. Medical director or designee signs every look-back event.",
    },
    "102": {
        "policy_name": "Donor Operations Policy",
        "section": "Specialty Services",
        "subspecialty": "Blood Bank / Transfusion",
        "service_line": "blood_bank",
        "description": "Donor operations across two distinct modes: (1) supplier agreements when components are purchased from a collection establishment, and (2) donor screening, collection, and therapeutic apheresis when the lab itself is the collection establishment. Donor eligibility per 21 CFR 630.10; collection per 21 CFR 606.110.",
        "notes": "Consolidates sources #43, #63, #64, #65. Applies only to labs operating as a collection establishment or maintaining supplier agreements. Most hospital transfusion services purchase components and only need the supplier-agreement portion.",
    },
}


def join_unique(citations_list):
    """Take a list of citation strings (each potentially semicolon-joined),
    split them, dedupe in-order, return a single semicolon-joined string."""
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

    # Extract the array body between `export const VERITAPOLICY_MASTER_LIST: VeritaPolicyMasterRow[] = [` and `];`
    m = re.search(
        r"(export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*)\[(.*)\];\s*$",
        text, re.DOTALL,
    )
    if not m:
        print("FATAL: could not locate the master list array", file=sys.stderr)
        sys.exit(1)
    header = m.group(1)
    body = m.group(2)

    # The body is valid JSON if we wrap it in []. Parse it.
    rows = json.loads("[" + body + "]")
    print(f"Parsed {len(rows)} existing rows from master list")

    # Partition: kept rows vs source rows to merge.
    kept = [r for r in rows if r["policy_id"] not in SOURCE_TO_COMBINED]
    sources = [r for r in rows if r["policy_id"] in SOURCE_TO_COMBINED]
    print(f"  -> {len(kept)} kept rows, {len(sources)} source rows to merge")

    if len(sources) != len(SOURCE_TO_COMBINED):
        print(f"WARN: expected {len(SOURCE_TO_COMBINED)} source rows, found {len(sources)}", file=sys.stderr)

    # Build the 6 new rows. Aggregate accreditor citations from source rows
    # in each cluster; dedupe and order-preserve.
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
        # Print citation summary
        print(f"  Built {combined_id} ({meta['policy_name'][:50]}): "
              f"tjc={len(new_row['tjc_citations'].split('; ')) if new_row['tjc_citations'] else 0} "
              f"cap={len(new_row['cap_citations'].split('; ')) if new_row['cap_citations'] else 0} "
              f"cola={len(new_row['cola_citations'].split('; ')) if new_row['cola_citations'] else 0} "
              f"aabb={len(new_row['aabb_citations'].split('; ')) if new_row['aabb_citations'] else 0}")

    final_rows = kept + new_rows
    print(f"Final master list: {len(final_rows)} rows ({len(kept)} kept + {len(new_rows)} new)")

    # Serialize back. Use 2-space indent (matches existing file). Preserve
    # field ordering by using the original key order in COMBINED_META + the
    # parser's key order for kept rows.
    def serialize_row(r):
        # Use json.dumps for proper escaping, then reformat manually so the
        # output matches the existing 4-space-inside-object style.
        keys = ["policy_id", "policy_name", "section", "subspecialty", "service_line",
                "description", "cfr_citations", "tjc_citations", "cap_citations",
                "cola_citations", "aabb_citations", "notes"]
        body_lines = []
        for k in keys:
            if k in r:
                body_lines.append(f'    "{k}": {json.dumps(r[k], ensure_ascii=False)}')
        return "  {\n" + ",\n".join(body_lines) + "\n  }"

    body_out = ",\n".join(serialize_row(r) for r in final_rows)
    new_text = header + "[\n" + body_out + "\n];\n"

    with open(MASTER_LIST_PATH, "w", encoding="utf-8") as f:
        f.write(new_text)
    print(f"\nWrote {MASTER_LIST_PATH}")
    print(f"File size: {len(new_text):,} chars (was {len(text):,})")


if __name__ == "__main__":
    main()
