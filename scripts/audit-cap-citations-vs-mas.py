#!/usr/bin/env python3
"""Audit: does every CAP checklist ID cited in the VeritaPolicy master list exist
in the CAP checklist (MAS xlsx) files? Read-only. Parking lot #5 (CAP column).

Usage: python scripts/audit-cap-citations-vs-mas.py "<folder with MAS_*.xlsx>"
Exit 1 if any cited single ID, or either endpoint of a cited range, is missing.
Existence only: whether each requirement is the RIGHT one for its policy is a
separate, human review.
"""
import glob, os, re, sys
import openpyxl

folder = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/veril/OneDrive/Desktop/Lab/Regulatory/2026 Cap checklists"
src = open(os.path.join(os.path.dirname(__file__), "..", "server", "veritapolicyMasterList.ts"), encoding="utf-8").read()
objs = re.findall(r'\{[^{}]*"policy_id"[^{}]*\}', src, re.S)
cited = set()
for o in objs:
    m = re.search(r'"cap_citations":\s*"([^"]*)"', o)
    if m:
        cited |= {x.strip() for x in m.group(1).split(";") if x.strip()}
pat = re.compile(r"\b([A-Z]{3}\.\d{5})\b")
held, files = set(), sorted(glob.glob(os.path.join(folder, "MAS_*.xlsx")))
for f in files:
    for ws in openpyxl.load_workbook(f, read_only=True, data_only=True).worksheets:
        for row in ws.iter_rows(values_only=True):
            for v in row:
                if isinstance(v, str):
                    held.update(pat.findall(v))
modules = sorted({os.path.basename(f).split("_")[1] for f in files})
missing = []
for c in sorted(cited):
    parts = c.split("-") if "-" in c else [c]
    missing += [f"{c} ({p})" for p in parts if p not in held]
print(f"policies: {len(objs)}; CAP files: {len(files)} ({', '.join(modules)})")
print(f"distinct CAP citations: {len(cited)} ({sum('-' in c for c in cited)} ranges); missing: {len(missing)}")
for m in missing:
    print("  MISSING", m)
sys.exit(1 if missing else 0)
