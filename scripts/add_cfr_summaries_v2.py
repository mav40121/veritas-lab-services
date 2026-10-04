#!/usr/bin/env python3
"""
add_cfr_summaries_v2.py  (parking-lot #30, summary expansion tranche 2)

Second batch of operator-reviewable plain-language `summary` fields for
high-traffic CFR sections in server/cfrRequirements.ts, same voice and rules as
v1 (public-domain CFR paraphrase; verbatim stays authoritative; drafts ship in
the PR for Michael's voice review). Idempotent: skips rows that already carry a
summary, so re-running after v1 only adds the new sections.
Run: python scripts/add_cfr_summaries_v2.py
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "server" / "cfrRequirements.ts"

SUMMARIES = {
    "493.1101": "Provide a testing environment that protects staff, specimens, and result quality: adequate space and utilities, temperature and humidity control where the methods require it, safety provisions, and protection of records and specimens from loss or damage. The facility itself cannot be a source of error, and conditions that affect testing have to be monitored and documented.",
    "493.1232": "Have written policies that keep positive patient and specimen identification from collection through reporting, and that protect specimen integrity in transit and storage. Every specimen is labeled and traceable to the right patient, and specimens that are mislabeled, improperly collected, or compromised are rejected or handled under written criteria. Misidentification is the root of most wrong-patient results, so this is where a survey of the preanalytic phase starts.",
    "493.1236": "Review every PT result when it comes back, including the ones you passed. Investigate unacceptable and unsatisfactory scores, document the cause and the corrective action, and keep those records with the signed PT attestation. Two unsuccessful events out of three, or two consecutive, in a specialty or analyte is unsuccessful performance and forces mandatory action up to loss of testing for that analyte.",
    "493.1239": "Run an ongoing quality review of the general systems that cut across all testing: specimen handling and tracking, the information system, internal and external communication, complaint handling, and competent staffing. Monitor these, correct problems, review the data with staff, and document it.",
    "493.1242": "Have written policies for how tests are ordered and how specimens are collected, labeled, preserved, transported, and, when needed, referred out. The request must capture the patient's identity, the test ordered, the ordering provider, and the collection date and time. Referral testing goes only to a CLIA-certified laboratory, and your report identifies the laboratory that actually performed the test.",
    "493.1249": "Run an ongoing quality review of the preanalytic phase: test ordering, specimen collection, labeling, transport, and receipt. Monitor for the errors that happen before testing starts, correct them, document the review, and feed what you find into the lab's overall quality assessment.",
    "493.1443": "The high-complexity laboratory director must meet one of CLIA's specific qualification pathways: a licensed physician with pathology board certification, or with the required laboratory training and experience, or a doctoral scientist certified by an HHS-approved board with the required experience, each subject to state licensure where it applies. Surveyors verify the director's credentials against the CMS-116, because the lab's legal standing rests on them. Meeting the qualification is separate from meeting the director responsibilities in 493.1445.",
    "493.1451": "The technical supervisor owns the technical and scientific operation for each specialty they cover: selecting test methods, establishing and verifying performance specifications, setting QC, resolving technical problems, and assessing the competency of testing personnel. In high-complexity testing this is the role accountable for whether the methods themselves are sound. Duties may be delegated in writing, but the responsibility stays with the technical supervisor.",
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
