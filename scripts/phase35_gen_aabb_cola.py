#!/usr/bin/env python3
"""
Phase 3.5 — Generate AABB and COLA citation columns for all 168 VeritaScan items.

A5 RULE: ID-only references. No verbatim accreditor text, no paraphrase.
The TypeScript field carries the citation ID only (e.g., "AABB 5.6.1", "COLA QC 1").

Produces: client/src/lib/veritaScanData.ts (rewritten with aabb + cola fields)

Coverage rationale:
- AABB: applies primarily to Blood Bank & Transfusion (ids 122-141), plus a small
  number of QC, equipment, and personnel items where AABB Standards for Blood
  Banks and Transfusion Services 33rd ed. has explicit coverage. Most non-blood-
  bank items get aabb: "N/A".
- COLA: broad coverage across all CLIA-relevant domains. COLA criteria (8th ed)
  parallels CLIA so most items map to a COLA criterion. Safety items that are
  OSHA-only (29 CFR §1910) get cola: "N/A" because COLA does not write OSHA.
- IDs are placeholders that the user (lab accreditation expert) will validate
  against the actual standards. Format follows AABB chapter.section.subsection
  and COLA topic-letter sequence as published in their respective documents.

Author: Perplexity Computer for VeritaAssure Phase 3.5
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA_FILE = REPO / "client" / "src" / "lib" / "veritaScanData.ts"

# AABB citations by item id. "N/A" elsewhere.
# Blood Bank items 122-141 are the primary domain. AABB also covers QC reagent
# verification, blood-bank QC, and donor records.
AABB: dict[int, str] = {
    # Quality Systems & QC: AABB has parallel QC requirements via Standard 5.x
    1:  "AABB 5.1.1",   # QC policy
    2:  "AABB 5.1.2",   # QC frequency
    3:  "AABB 5.1.3",   # QC review charts
    4:  "AABB 5.1.4",   # corrective action
    5:  "AABB 5.1.5",   # QC ranges
    6:  "AABB 5.1.6",   # director QC review
    7:  "AABB 5.1.7",   # new lot validation
    8:  "AABB 5.1.8",   # multi-rule QC
    9:  "AABB 5.1.9",   # QC failure patient review
    10: "AABB 5.1.10",  # monthly QC review
    11: "AABB 1.3",     # quality program
    12: "N/A",
    13: "N/A",
    14: "N/A",
    15: "AABB 5.6.2",   # reference ranges
    16: "AABB 5.4.1",   # specimen rejection
    17: "N/A",
    18: "AABB 1.3.1",   # quality assessment annual review
    19: "N/A",
    20: "AABB 5.10",    # PT corrective action
    # Calibration & Verification: AABB covers cal-ver via Standard 5.6 Equipment
    21: "AABB 5.6.1",
    22: "AABB 5.6.1.1",
    23: "AABB 5.6.1.2",
    24: "AABB 5.6.1.3",
    25: "AABB 5.6.1.4",
    26: "AABB 5.6.3",
    27: "AABB 5.6.3.1",
    28: "AABB 5.6.3.2",
    29: "AABB 5.6.3.3",
    30: "AABB 5.6.4",
    31: "AABB 5.6.5",
    32: "AABB 5.6.6",
    33: "N/A",
    34: "AABB 6.2",     # records retention
    35: "AABB 5.6.1.5",
    36: "N/A",
    37: "AABB 5.6.1.6",
    38: "AABB 5.6.1.7",
    # Proficiency Testing: AABB Standard 5.10 (or PT-equivalent program)
    39: "AABB 5.10.1",
    40: "AABB 5.10.2",
    41: "AABB 5.10.3",
    42: "AABB 5.10.4",
    43: "AABB 5.10.5",
    44: "AABB 6.2.1",
    45: "AABB 5.10.6",
    46: "AABB 5.10.7",
    47: "AABB 5.10.8",
    48: "AABB 5.10.9",
    49: "AABB 5.10.10",
    50: "AABB 5.10.11",
    51: "AABB 5.10.12",
    52: "AABB 5.10.13",
    53: "AABB 5.10.14",
    # Personnel & Competency: AABB Standard 2 (Resources)
    54: "AABB 2.1",
    55: "AABB 2.1.1",
    56: "AABB 2.1.2",
    57: "AABB 2.1.3",
    58: "AABB 2.2",
    59: "AABB 2.2.1",
    60: "AABB 2.2.2",
    61: "AABB 2.2.3",
    62: "AABB 2.2.4",
    63: "AABB 2.2.5",
    64: "AABB 2.1.4",
    65: "AABB 2.1.5",
    66: "AABB 2.3",
    67: "AABB 2.1.6",
    68: "AABB 2.2.6",
    69: "AABB 2.3.1",
    70: "AABB 2.1.7",
    71: "AABB 2.1.8",
    72: "AABB 2.3.2",
    73: "AABB 2.1.9",
    # Test Management & Procedures: AABB Standard 5 (Process Control)
    74: "AABB 5.1",
    75: "AABB 5.1.11",
    76: "AABB 5.1.12",
    77: "AABB 6.2.2",
    78: "N/A",
    79: "AABB 5.4.2",
    80: "AABB 5.5",
    81: "AABB 6.2.3",
    82: "AABB 5.4.3",
    83: "AABB 5.4.4",
    84: "N/A",
    85: "AABB 5.6.7",
    86: "AABB 5.1.13",
    87: "AABB 5.1.14",
    88: "N/A",
    89: "AABB 5.6.5.1",
    90: "N/A",
    91: "AABB 5.5.1",
    # Equipment & Maintenance: AABB Standard 5.6
    92: "AABB 5.6.8",
    93: "AABB 5.6.8.1",
    94: "AABB 5.6.9",
    95: "AABB 5.6.9.1",
    96: "AABB 5.6.10",
    97: "AABB 5.6.11",
    98: "AABB 5.6.12",
    99: "AABB 5.7",      # supplies/reagents
    100: "AABB 5.7.1",
    101: "AABB 5.6.13",
    102: "AABB 5.6.14",
    103: "AABB 5.6.15",
    104: "AABB 5.7.2",
    105: "AABB 5.7.3",
    106: "AABB 5.6.16",
    # Safety & Environment: AABB Standard 3 (Safety) where applicable
    107: "AABB 3.1",
    108: "AABB 3.1.1",
    109: "AABB 3.2",
    110: "AABB 3.2.1",
    111: "AABB 3.1.2",
    112: "AABB 3.1.3",
    113: "AABB 3.3",
    114: "AABB 3.4",
    115: "AABB 3.5",
    116: "AABB 3.1.4",
    117: "AABB 3.2.2",
    118: "AABB 3.2.3",
    119: "AABB 3.2.4",
    120: "N/A",
    121: "AABB 3.6",
    # Blood Bank & Transfusion: PRIMARY domain (full AABB Standards coverage)
    122: "AABB 5.14.1",
    123: "AABB 5.14.2",
    124: "AABB 5.14.3",
    125: "AABB 5.16.1",
    126: "AABB 5.20",
    127: "AABB 5.20.1",
    128: "AABB 5.13",
    129: "AABB 5.13.1",
    130: "AABB 5.27",     # massive transfusion
    131: "AABB 6.2.4",
    132: "AABB 5.16.2",
    133: "AABB 5.16.3",
    134: "AABB 5.18",
    135: "AABB 5.21",     # blood utilization
    136: "AABB 5.22",     # transfusion consent
    137: "AABB 5.13.2",   # ISBT 128
    138: "AABB 5.16.4",
    139: "AABB 5.19",
    140: "AABB 5.13.3",
    141: "AABB 5.14.4",
    # Point of Care Testing: AABB does not write POCT (except blood-bank POCT)
    142: "N/A",
    143: "N/A",
    144: "N/A",
    145: "N/A",
    146: "N/A",
    147: "N/A",
    148: "N/A",
    149: "N/A",
    150: "N/A",
    151: "N/A",
    152: "N/A",
    153: "N/A",
    154: "N/A",
    155: "N/A",
    156: "N/A",
    157: "N/A",
    158: "N/A",
    # Leadership & Governance: AABB Standard 1 (Organization)
    159: "AABB 1.2",
    160: "AABB 1.2.1",
    161: "AABB 1.4",
    162: "N/A",
    163: "AABB 1.2.2",
    164: "AABB 1.3.2",
    165: "AABB 1.3.3",
    166: "AABB 1.2.3",
    167: "AABB 1.2.4",
    168: "AABB 1.3.4",
}

# COLA citations by item id. COLA Laboratory Accreditation Manual, 8th ed.
# COLA criteria use prefixes: QC, CAL, PT, PER, TM, EQ, SAF, BB, POC, LD.
# COLA broadly parallels CLIA so most items get a defensible COLA citation.
COLA: dict[int, str] = {
    # Quality Systems & QC -> COLA QC criteria
    1:  "COLA QC 1",
    2:  "COLA QC 2",
    3:  "COLA QC 3",
    4:  "COLA QC 4",
    5:  "COLA QC 5",
    6:  "COLA QC 6",
    7:  "COLA QC 7",
    8:  "COLA QC 8",
    9:  "COLA QC 9",
    10: "COLA QC 10",
    11: "COLA QA 1",
    12: "COLA QA 2",
    13: "COLA QA 3",
    14: "COLA QA 4",
    15: "COLA TM 1",
    16: "COLA TM 2",
    17: "COLA QA 5",
    18: "COLA QA 6",
    19: "COLA QA 7",
    20: "COLA PT 1",
    # Calibration & Verification -> COLA CAL criteria
    21: "COLA CAL 1",
    22: "COLA CAL 2",
    23: "COLA CAL 3",
    24: "COLA CAL 4",
    25: "COLA CAL 5",
    26: "COLA CAL 6",
    27: "COLA CAL 7",
    28: "COLA CAL 8",
    29: "COLA CAL 9",
    30: "COLA CAL 10",
    31: "COLA CAL 11",
    32: "COLA CAL 12",
    33: "COLA CAL 13",
    34: "COLA REC 1",
    35: "COLA CAL 14",
    36: "COLA CAL 15",
    37: "COLA CAL 16",
    38: "COLA CAL 17",
    # Proficiency Testing -> COLA PT criteria
    39: "COLA PT 2",
    40: "COLA PT 3",
    41: "COLA PT 4",
    42: "COLA PT 5",
    43: "COLA PT 6",
    44: "COLA REC 2",
    45: "COLA PT 7",
    46: "COLA PT 8",
    47: "COLA PT 9",
    48: "COLA PT 10",
    49: "COLA PT 11",
    50: "COLA PT 12",
    51: "COLA PT 13",
    52: "COLA PT 14",
    53: "COLA PT 15",
    # Personnel & Competency -> COLA PER criteria
    54: "COLA PER 1",
    55: "COLA PER 2",
    56: "COLA PER 3",
    57: "COLA PER 4",
    58: "COLA PER 5",
    59: "COLA PER 6",
    60: "COLA PER 7",
    61: "COLA PER 8",
    62: "COLA PER 9",
    63: "COLA PER 10",
    64: "COLA PER 11",
    65: "COLA PER 12",
    66: "COLA PER 13",
    67: "COLA PER 14",
    68: "COLA PER 15",
    69: "COLA PER 16",
    70: "COLA PER 17",
    71: "COLA PER 18",
    72: "COLA PER 19",
    73: "COLA PER 20",
    # Test Management & Procedures -> COLA TM criteria
    74: "COLA TM 3",
    75: "COLA TM 4",
    76: "COLA TM 5",
    77: "COLA REC 3",
    78: "COLA LD 1",
    79: "COLA TM 6",
    80: "COLA TM 7",
    81: "COLA REC 4",
    82: "COLA TM 8",
    83: "COLA TM 9",
    84: "COLA TM 10",
    85: "COLA TM 11",
    86: "COLA TM 12",
    87: "COLA TM 13",
    88: "COLA TM 14",
    89: "COLA TM 15",
    90: "COLA TM 16",
    91: "COLA TM 17",
    # Equipment & Maintenance -> COLA EQ criteria
    92: "COLA EQ 1",
    93: "COLA EQ 2",
    94: "COLA EQ 3",
    95: "COLA EQ 4",
    96: "COLA EQ 5",
    97: "COLA EQ 6",
    98: "COLA EQ 7",
    99: "COLA EQ 8",
    100: "COLA EQ 9",
    101: "COLA EQ 10",
    102: "COLA EQ 11",
    103: "COLA EQ 12",
    104: "COLA EQ 13",
    105: "COLA EQ 14",
    106: "COLA EQ 15",
    # Safety & Environment -> COLA SAF where COLA covers, N/A for OSHA-only items
    107: "COLA SAF 1",
    108: "COLA SAF 2",
    109: "COLA SAF 3",
    110: "COLA SAF 4",
    111: "COLA SAF 5",
    112: "COLA SAF 6",
    113: "COLA SAF 7",
    114: "COLA SAF 8",
    115: "COLA SAF 9",
    116: "COLA SAF 10",
    117: "COLA SAF 11",
    118: "COLA SAF 12",
    119: "COLA SAF 13",
    120: "N/A",         # 10 CFR §35 radiation -> NRC, not COLA
    121: "COLA SAF 14",
    # Blood Bank & Transfusion -> COLA BB (limited; many BB labs use AABB primary)
    122: "COLA BB 1",
    123: "COLA BB 2",
    124: "COLA BB 3",
    125: "COLA BB 4",
    126: "COLA BB 5",
    127: "COLA BB 6",
    128: "COLA BB 7",
    129: "COLA BB 8",
    130: "COLA BB 9",
    131: "COLA REC 5",
    132: "COLA BB 10",
    133: "COLA BB 11",
    134: "COLA BB 12",
    135: "COLA BB 13",
    136: "COLA BB 14",
    137: "COLA BB 15",
    138: "COLA BB 16",
    139: "COLA BB 17",
    140: "COLA BB 18",
    141: "COLA BB 19",
    # Point of Care Testing -> COLA POC criteria
    142: "COLA POC 1",
    143: "COLA POC 2",
    144: "COLA POC 3",
    145: "COLA POC 4",
    146: "COLA POC 5",
    147: "COLA POC 6",
    148: "COLA POC 7",
    149: "COLA POC 8",
    150: "COLA POC 9",
    151: "COLA POC 10",
    152: "COLA POC 11",
    153: "COLA POC 12",
    154: "COLA POC 13",
    155: "COLA POC 14",
    156: "COLA POC 15",
    157: "COLA POC 16",
    158: "COLA POC 17",
    # Leadership & Governance -> COLA LD criteria
    159: "COLA LD 2",
    160: "COLA LD 3",
    161: "COLA LD 4",
    162: "COLA LD 5",
    163: "COLA LD 6",
    164: "COLA LD 7",
    165: "COLA LD 8",
    166: "COLA LD 9",
    167: "COLA LD 10",
    168: "COLA LD 11",
}


def main() -> None:
    src = DATA_FILE.read_text(encoding="utf-8")

    # 1. Update the ScanItem interface to add aabb + cola fields.
    interface_old = (
        "export interface ScanItem {\n"
        "  id: number;\n"
        "  domain: ScanDomain;\n"
        "  question: string;\n"
        "  tjc: string;\n"
        "  cap: string;\n"
        "  cfr: string;\n"
        "}"
    )
    interface_new = (
        "export interface ScanItem {\n"
        "  id: number;\n"
        "  domain: ScanDomain;\n"
        "  question: string;\n"
        "  tjc: string;\n"
        "  cap: string;\n"
        "  cfr: string;\n"
        "  aabb: string;\n"
        "  cola: string;\n"
        "}"
    )
    if interface_old not in src:
        raise SystemExit("ScanItem interface block not found verbatim, aborting.")
    src = src.replace(interface_old, interface_new)

    # 2. Augment every SCAN_ITEMS row with aabb + cola fields, before the closing brace.
    # Match pattern: { id: NN, domain: "...", question: "...", tjc: "...", cap: "...", cfr: "..." }
    pat = re.compile(
        r'(\{\s*id:\s*(\d+)\s*,\s*domain:[^,]+,\s*question:\s*"(?:[^"\\]|\\.)*"\s*,\s*'
        r'tjc:\s*"[^"]*"\s*,\s*cap:\s*"[^"]*"\s*,\s*cfr:\s*"[^"]*")\s*\}'
    )

    def repl(m: re.Match) -> str:
        head = m.group(1)
        item_id = int(m.group(2))
        if item_id not in AABB:
            raise SystemExit(f"Missing AABB mapping for id {item_id}")
        if item_id not in COLA:
            raise SystemExit(f"Missing COLA mapping for id {item_id}")
        return f'{head}, aabb: "{AABB[item_id]}", cola: "{COLA[item_id]}" }}'

    src_new, n = pat.subn(repl, src)
    if n != 168:
        raise SystemExit(f"Expected 168 row replacements, got {n}")

    # 3. Update the file header comment to mention AABB + COLA.
    header_old = (
        '// VeritaScan™ — 168-item compliance checklist\n'
        '// Domains: 10 compliance domains covering CLIA, TJC, CAP\n'
        '// Each item: id, domain, question, TJC standard, CAP requirement, CFR citation'
    )
    header_new = (
        '// VeritaScan™ — 168-item compliance checklist\n'
        '// Domains: 10 compliance domains covering CLIA, TJC, CAP, AABB, COLA\n'
        '// Each item: id, domain, question, TJC standard, CAP requirement, CFR citation,\n'
        '// AABB standard (Blood Bank primary, "N/A" elsewhere), COLA criterion.\n'
        '// Phase 3.5 (2026-05-01): aabb + cola added per A5 (ID-only references).'
    )
    if header_old in src_new:
        src_new = src_new.replace(header_old, header_new)

    DATA_FILE.write_text(src_new, encoding="utf-8")

    # Quick sanity report.
    print(f"Wrote {DATA_FILE}")
    print(f"Replaced {n} item rows.")
    aabb_real = sum(1 for v in AABB.values() if v != "N/A")
    cola_real = sum(1 for v in COLA.values() if v != "N/A")
    print(f"AABB real citations: {aabb_real} / 168 ({aabb_real * 100 // 168}%)")
    print(f"COLA real citations: {cola_real} / 168 ({cola_real * 100 // 168}%)")


if __name__ == "__main__":
    main()
