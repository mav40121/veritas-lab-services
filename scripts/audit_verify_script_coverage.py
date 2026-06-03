#!/usr/bin/env python3
"""
audit_verify_script_coverage.py — find recent commits that touched
math/logic files without an accompanying scripts/verify-*.js script.

CLAUDE.md §2 verify-*.js convention says: "any change to math,
parsing, escaping, lot-tracking, or any logic with branching ships
with a paired scripts/verify-*.js script that exercises every
meaningful branch." This audit walks the git log to find commits
that violated that convention.

Watched paths (files where a change is considered math/logic):
  - client/src/lib/calculations.ts
  - server/veritapolicyApproval.ts
  - server/veritaqcWestgard.ts
  - server/cfrRequirements.ts (TEa table + CFR matching)

For each touching commit in the lookback window, report whether the
SAME commit added or modified any scripts/verify-*.{js,cjs} file.
Commits without one are flagged as procedural-debt findings.

Output: covered vs not-covered counts, plus the not-covered list so a
backfill PR can be scoped. Exits 0 — this is a report, not a CI gate.
"""

import argparse
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WATCHED_PATHS = [
    "client/src/lib/calculations.ts",
    "server/veritapolicyApproval.ts",
    "server/veritaqcWestgard.ts",
    "server/cfrRequirements.ts",
]


def git(args: list[str]) -> str:
    r = subprocess.run(["git", *args], capture_output=True, text=True, cwd=str(REPO))
    return r.stdout


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="90 days ago",
                    help="git log --since value (default: 90 days ago)")
    args = ap.parse_args()

    raw = git(["log", f"--since={args.since}", "--pretty=format:HASH:%H::%s", "--", *WATCHED_PATHS])
    covered: list[tuple[str, str]] = []
    not_covered: list[tuple[str, str]] = []
    for line in raw.splitlines():
        if not line.startswith("HASH:"):
            continue
        hsh, subj = line[5:].split("::", 1)
        files = git(["show", "--name-only", "--pretty=", hsh]).splitlines()
        has_verify = any(
            f.startswith("scripts/verify-") and (f.endswith(".js") or f.endswith(".cjs"))
            for f in files
        )
        (covered if has_verify else not_covered).append((hsh[:7], subj))

    total = len(covered) + len(not_covered)
    if total == 0:
        print(f"No commits touched watched paths in the last {args.since}. Nothing to audit.")
        return 0

    print(f"Audited {total} commit(s) touching math/logic files since {args.since}.")
    print(f"  With paired verify-*.js: {len(covered)}")
    print(f"  Without paired verify-*.js: {len(not_covered)}")
    print()

    if covered:
        print("=== With paired verify-*.js ===")
        for h, s in covered:
            print(f"  {h}  {s[:100]}")
        print()

    if not_covered:
        print("=== Procedural debt: math/logic commits without paired verify-*.js ===")
        for h, s in not_covered:
            print(f"  {h}  {s[:100]}")
        print()
        print(f"Triage: not every commit here needs a backfill. Renames, citation")
        print(f"swaps, and pure copy changes are exempt by spirit of the convention.")
        print(f"Backfill candidates are commits that introduced NEW math or fixed a")
        print(f"math defect (those should have shipped with a verify script).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
