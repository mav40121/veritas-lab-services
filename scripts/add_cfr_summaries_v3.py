#!/usr/bin/env python3
"""
add_cfr_summaries_v3.py  (parking-lot #30, summary expansion tranche 3)

Third batch: the CLIA personnel subpart (consultant / supervisor / testing-
personnel responsibilities and qualifications), the staffing half of survey
readiness. Same voice and rules as v1/v2 (public-domain CFR paraphrase; verbatim
authoritative; drafts for Michael's voice review). Idempotent.
Run: python scripts/add_cfr_summaries_v3.py
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "server" / "cfrRequirements.ts"

SUMMARIES = {
    "493.1413": "The technical consultant is accountable for the technical and scientific side of moderate-complexity testing: selecting methods, establishing and verifying performance specifications, setting QC and resolving out-of-control situations, approving procedures, identifying training needs, and assessing each tester's competency. The consultant need not be on site full time but must be available to the lab. This is the moderate-complexity counterpart to the technical supervisor.",
    "493.1419": "The clinical consultant is the lab's link to the ordering clinicians: available to help choose appropriate tests, interpret results in the clinical context, and advise on clinical significance. The role ensures reports carry what clinicians need for correct interpretation and that consultation is available when questions arise about test selection or results.",
    "493.1457": "The clinical consultant is the lab's link to the ordering clinicians: available to help choose appropriate tests, interpret results in the clinical context, and advise on clinical significance. The role ensures reports carry what clinicians need for correct interpretation and that consultation is available when questions arise about test selection or results.",
    "493.1461": "A high-complexity lab must have one or more general supervisors who meet CLIA's qualification requirements, typically a qualified laboratory scientist or a medical technologist with the required education and experience, or a specific grandfathered or military pathway. The general supervisor works under the director and technical supervisor and provides on-the-floor oversight of day-to-day testing.",
    "493.1489": "Each person performing high-complexity testing must meet one of CLIA's qualification pathways, typically an associate degree or higher in a laboratory science (or equivalent education plus training), or a specific grandfathered or military pathway, with documented training for the tests they perform. Qualifications are verified and documented before the person reports patient results.",
    "493.1495": "Testing personnel in high-complexity testing perform only the tests they are authorized and competent to perform, follow the lab's procedures, run and evaluate QC before reporting, document problems, and report results only when the test system is working correctly. They work under supervision appropriate to the complexity, and they do not release patient results when QC or the system is unacceptable.",
    "493.1423": "Each person performing moderate-complexity testing must meet CLIA's qualifications, typically a high school diploma or equivalent plus documented training appropriate to the testing performed, or higher education. Training and the authorization to test are documented before the person reports patient results.",
    "493.1425": "Testing personnel in moderate-complexity testing perform only the tests they are authorized and trained for, follow the lab's procedures, run and review QC before reporting, document problems, and report results only when the test system is performing acceptably. They do not release patient results when QC or the system is out of control.",
}


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    added = {k: 0 for k in SUMMARIES}
    skipped_has = 0
    for i, line in enumerate(lines):
        if '"standard"' not in line:
            continue
        for num, summary in SUMMARIES.items():
            if f'{num}", "name"' in line:
                if '"summary"' in line:
                    skipped_has += 1
                    break
                nl = line.rstrip("\r\n")
                eol = line[len(nl):]
                idx = nl.rfind("}")
                if idx == -1:
                    break
                nl = nl[:idx] + f', "summary": "{esc(summary)}"' + nl[idx:]
                lines[i] = nl + eol
                added[num] += 1
                break
    SRC.write_text("".join(lines), encoding="utf-8")
    total = sum(added.values())
    print(f"Added summary to {total} rows across {sum(1 for v in added.values() if v)} sections "
          f"({skipped_has} rows already had one).")
    for num, n in added.items():
        print(f"  {num}: {n} rows")
    missing = [k for k, v in added.items() if v == 0]
    if missing:
        print(f"WARNING: no rows matched for: {missing}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
