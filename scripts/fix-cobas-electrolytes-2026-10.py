#!/usr/bin/env python3
"""
Fix VeritaMap menu accuracy for the Roche cobas photometric-module entries.

Reported 2026-10-06 (Michael, after a Roche demo): the cobas 8000 menu has no
Sodium or Potassium. Root cause: three entries are scoped to the photometric
module (c702 / c502) only, but Na/K/Cl are measured on the cobas ISE module,
which a real cobas 8000/6000 SYSTEM always includes. The c501/c311 entries
already carry Na/K/Cl; these three were missing them.

Fix: add Sodium, Potassium, Chloride (MODERATE / Electrolytes -- the exact
values the Roche cobas c 501 entry already uses) to each affected entry. No
fabrication: these are the ISE electrolytes a cobas 8000/6000 runs, sourced
from the sibling c501 rows in this same file.

Writes CRLF + trailing newline to match the file byte-for-byte (additions
plus the testCount bump on each touched entry).
"""
import json, os, sys

PATH = os.path.join("client", "src", "lib", "fdaInstrumentData.json")

TARGETS = [
    "Roche cobas 8000 (c702 module)",
    "Roche cobas c 702",
    "Roche cobas c 502",
]
ELECTROLYTES = [
    ("Sodium", "MODERATE", "Electrolytes"),
    ("Potassium", "MODERATE", "Electrolytes"),
    ("Chloride", "MODERATE", "Electrolytes"),
]


def main():
    raw = open(PATH, encoding="utf-8").read()
    d = json.loads(raw)

    changed = []
    for key in TARGETS:
        if key not in d:
            print(f"ABORT: entry not found: {key}")
            sys.exit(1)
        tests = d[key]["tests"]
        added = []
        for analyte, complexity, specialty in ELECTROLYTES:
            if analyte in tests:
                continue
            tests[analyte] = {"complexity": complexity, "specialty": specialty}
            added.append(analyte)
        d[key]["testCount"] = len(tests)
        changed.append((key, added, d[key]["testCount"]))

    out = json.dumps(d, indent=2, ensure_ascii=False) + "\n"
    out_crlf = out.replace("\n", "\r\n")
    with open(PATH, "wb") as f:
        f.write(out_crlf.encode("utf-8"))

    d2 = json.loads(open(PATH, encoding="utf-8").read())
    for key, added, count in changed:
        now = list(d2[key]["tests"])
        ok = all(a in now for a in ("Sodium", "Potassium", "Chloride"))
        print(f"{key}: added {added} -> testCount {count}, Na/K/Cl present={ok}")


if __name__ == "__main__":
    main()
