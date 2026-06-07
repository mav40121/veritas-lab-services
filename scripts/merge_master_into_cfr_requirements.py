#!/usr/bin/env python3
"""
merge_master_into_cfr_requirements.py

Sync server/cfrRequirements.ts accreditor ID arrays from the canonical
master citation index xlsx. Preserves all codebase-side fields
(id / chapter / standard / description / etc.) and every codebase-side
accreditor ID. Adds master-side IDs that the codebase is missing.

This is the operationalization of the audit Michael called out on
2026-06-07: the codebase snapshot had drifted from master across all
four accreditor columns. Future re-syncs should re-run this script
against the latest master version.

Strategy:
  1. Read master xlsx CFR_Library + Accreditor_Orphans + CAP_Uncompressed.
  2. For each codebase row, normalize the CFR citation to master form
     ("42 CFR §493.X" -> "42 CFR 493.X"), look up all master rows that
     match (a single CFR row in code may map to multiple master rows
     covering different facets — union the IDs).
  3. Expand compressed CAP runs via CAP_Uncompressed when present so
     the output is uniform bare-ID form.
  4. Union the four accreditor ID sets (codebase + master), sort,
     replace just those four arrays in the codebase row. Leave every
     other field untouched.
  5. Re-emit cfrRequirements.ts with line-by-line surgical edits, NOT a
     full re-serialization (preserves the file's line structure for a
     readable git diff).
"""

import argparse
import json
import pathlib
import re
import sys
from collections import defaultdict
from typing import Set, Dict, List

import pandas as pd


MASTER_XLSX = pathlib.Path(
    r"C:\Users\veril\OneDrive\Desktop\Lab\Regulatory"
    r"\aaa Truth Master Document\veritaassure_master_citation_index_v0.11.xlsx"
)
CODEBASE_TS = pathlib.Path(
    r"C:\Users\veril\projects\veritas-lab-services\server\cfrRequirements.ts"
)


def normalize_codebase_cite(s: str) -> str:
    """Codebase: '42 CFR §493.1235' -> master form '42 CFR 493.1235'."""
    return re.sub(r"\s*§\s*", " ", s).strip()


def strip_paraphrase(token: str) -> str:
    """
    Master cells like 'PER 5 (six-element competency)' -> 'PER 5'.
    The ID is always at the start, paraphrase always follows after a
    space-paren, e.g. 'COM.04000 (Quality Management System (QMS))'.
    Master ID formats (PER N, GEN.NNNNN, COM.NNNNN, QSA.NN.NN.NN, etc.)
    never contain '(', so truncating at the first ' (' is safe and
    correctly handles nested parens (which a non-greedy regex
    mishandles — the regex finds the inner ')' and leaves the outer
    dangling).
    """
    idx = token.find(" (")
    if idx != -1:
        return token[:idx].strip()
    return token.strip()


def parse_master_ids(cell, run_expansion: Dict[str, List[str]]) -> Set[str]:
    """
    Extract bare IDs from a master cell. Handles:
      - 'PER 5 (six-element competency assessment)' -> 'PER 5'
      - 'COM.30000 (Critical Result Notification)' -> 'COM.30000'
      - 'GEN.13750-GEN.13900 (10 IDs)' -> expanded via run_expansion if present
      - Comma- or newline-separated lists
    """
    if cell is None or isinstance(cell, float):
        return set()
    s = str(cell)
    out: Set[str] = set()
    # Split on commas at top level (parenthetical topics may contain commas,
    # so do a paren-aware split).
    chunks: List[str] = []
    depth = 0
    buf = ""
    for ch in s:
        if ch == "(":
            depth += 1
            buf += ch
        elif ch == ")":
            depth = max(0, depth - 1)
            buf += ch
        elif ch in ",\n" and depth == 0:
            if buf.strip():
                chunks.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        chunks.append(buf.strip())

    for chunk in chunks:
        bare = strip_paraphrase(chunk)
        # Run expansion: 'GEN.13750-GEN.13900' or 'CHM.13700-CHM.13900 (3 IDs)'
        if re.match(r"^[A-Z]+\.\d+-[A-Z]+\.\d+$", bare):
            if bare in run_expansion:
                out.update(run_expansion[bare])
                continue
            stem = re.match(r"^([A-Z]+\.\d+-[A-Z]+\.\d+)", bare)
            if stem and stem.group(1) in run_expansion:
                out.update(run_expansion[stem.group(1)])
                continue
            # Unmapped run: DROP it. Per audit findings, master's expanded
            # IDs for the same CFR cite are present elsewhere in the same
            # row's cell (or in CAP_Uncompressed); keeping the compressed
            # literal "GEN.55499-GEN.55505" as an ID was a bug that
            # introduced non-ID strings into the union.
            continue
        # Single ID: 'PER 5', 'GEN.13750', 'QSA.05.04.01', 'NPSG.01.01.01'
        if re.match(r"^[A-Z]+\.?\s*\d+(?:\.\d+)*$", bare):
            out.add(bare)
        elif bare and not bare.startswith("("):
            # Unrecognized but non-empty; keep so we don't drop data
            out.add(bare)
    return out


def build_cap_run_expansion(cap_uncompressed: pd.DataFrame) -> Dict[str, List[str]]:
    """
    Returns 'COMPRESSED_RUN_KEY' -> ['ID1', 'ID2', ...].
    CAP_Uncompressed shape (from audit): Compressed CAP IDs | Uncompressed CAP IDs | Runs Compressed (JSON)
    """
    out: Dict[str, List[str]] = {}
    if "Compressed CAP IDs (in Crosswalk)" not in cap_uncompressed.columns:
        return out
    # Master cells use newlines AND commas/semicolons as separators.
    # Earlier version split on [;,] only, which left multi-line cell
    # content as a single giant string and injected it as a fake ID.
    split_re = re.compile(r"[;,\n]")
    for _, row in cap_uncompressed.iterrows():
        compressed = row.get("Compressed CAP IDs (in Crosswalk)")
        uncompressed = row.get("Uncompressed CAP IDs (full list)")
        if (
            compressed is None
            or isinstance(compressed, float)
            or uncompressed is None
            or isinstance(uncompressed, float)
        ):
            continue
        comp_s = str(compressed).strip()
        # Strip the paraphrase suffix from each uncompressed ID and
        # drop blanks.
        uncomp_ids = [
            strip_paraphrase(x.strip())
            for x in split_re.split(str(uncompressed))
            if x.strip()
        ]
        uncomp_ids = [x for x in uncomp_ids if x]
        if not uncomp_ids:
            continue
        # Map each separator-split run in the compressed cell to the same
        # uncompressed list. CAP_Uncompressed is row-scoped to a specific
        # CFR row, so all runs on the same row share the same uncompressed
        # set.
        for run in split_re.split(comp_s):
            run = run.strip()
            if not run:
                continue
            stem = re.match(r"^([A-Z]+\.\d+-[A-Z]+\.\d+)", run)
            key = stem.group(1) if stem else run
            out[key] = uncomp_ids
    return out


def build_master_index(
    cfr_library: pd.DataFrame,
    run_expansion: Dict[str, List[str]],
) -> Dict[str, Dict[str, Set[str]]]:
    """
    Returns master_cite -> {'cap_ids': set, 'tjc_ids': set,
                            'cola_ids': set, 'aabb_ids': set}.
    Unions IDs across all rows sharing the same cfr_citation.
    """
    idx: Dict[str, Dict[str, Set[str]]] = defaultdict(
        lambda: {
            "cap_ids": set(),
            "tjc_ids": set(),
            "cola_ids": set(),
            "aabb_ids": set(),
        }
    )
    for _, row in cfr_library.iterrows():
        cite = row.get("cfr_citation")
        if cite is None or isinstance(cite, float):
            continue
        cite = str(cite).strip()
        for col, key in [
            ("cap_ids", "cap_ids"),
            ("tjc_ids", "tjc_ids"),
            ("cola_ids", "cola_ids"),
            ("aabb_ids", "aabb_ids"),
        ]:
            idx[cite][key] |= parse_master_ids(row.get(col), run_expansion)
    return idx


def build_facet_inventory(
    cfr_library: pd.DataFrame,
    run_expansion: Dict[str, List[str]],
) -> Dict[str, List[Dict]]:
    """
    Returns master_cite -> list of {'section_title', 'cap_ids', 'tjc_ids',
    'cola_ids', 'aabb_ids'} ordered as in master. Used to detect multi-row
    cites that should NOT be auto-merged.

    "Multi-row" = master has 2+ rows for the cite where section_title
    differs (true facets). If all rows share the same section_title, they
    are duplicate-spine rows and can be safely union-merged.
    """
    facets: Dict[str, List[Dict]] = defaultdict(list)
    for _, row in cfr_library.iterrows():
        cite = row.get("cfr_citation")
        if cite is None or isinstance(cite, float):
            continue
        cite = str(cite).strip()
        st = row.get("section_title")
        st = "" if (st is None or isinstance(st, float)) else str(st).strip()
        facets[cite].append({
            "section_title": st,
            "cap_ids": parse_master_ids(row.get("cap_ids"), run_expansion),
            "tjc_ids": parse_master_ids(row.get("tjc_ids"), run_expansion),
            "cola_ids": parse_master_ids(row.get("cola_ids"), run_expansion),
            "aabb_ids": parse_master_ids(row.get("aabb_ids"), run_expansion),
        })
    return facets


def is_single_row(cite: str, facets: Dict[str, List[Dict]]) -> bool:
    """
    Safe to auto-merge if master has 1 row OR every master row for the
    cite shares the same section_title (true duplicate-spine rows).
    """
    rows = facets.get(cite) or []
    if len(rows) <= 1:
        return True
    titles = {r["section_title"] for r in rows}
    return len(titles) == 1


def parse_codebase_rows(ts_text: str) -> List[Dict]:
    """
    Light parser for the line-per-entry shape in cfrRequirements.ts. Each
    entry is on a single line as a JSON-ish object (the file is
    machine-generated). Returns each entry's parsed dict + the raw line.
    """
    entries: List[Dict] = []
    for line_idx, line in enumerate(ts_text.splitlines()):
        stripped = line.strip().rstrip(",")
        if not stripped.startswith("{") or not stripped.endswith("}"):
            continue
        try:
            obj = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if "cfr_citation" in obj or "standard" in obj:
            entries.append({"line_idx": line_idx, "line_raw": line, "obj": obj})
    return entries


def emit_array(ids: Set[str]) -> str:
    if not ids:
        return "[]"
    return "[" + ", ".join(f'"{x}"' for x in sorted(ids)) + "]"


def replace_array_in_line(line: str, field: str, new_array: str) -> str:
    """
    Surgically replace just `"<field>": [...]` in one line. Preserves all
    other characters / whitespace so the diff stays narrow.
    """
    pat = re.compile(rf'("{re.escape(field)}"\s*:\s*)\[[^\]]*\]')
    return pat.sub(lambda m: m.group(1) + new_array, line)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Compute the merge and print summary; don't write the file.",
    )
    parser.add_argument(
        "--master",
        type=pathlib.Path,
        default=MASTER_XLSX,
        help="Path to master citation index xlsx.",
    )
    parser.add_argument(
        "--codebase",
        type=pathlib.Path,
        default=CODEBASE_TS,
        help="Path to server/cfrRequirements.ts.",
    )
    args = parser.parse_args()

    print(f"Reading master: {args.master}")
    cfr_library = pd.read_excel(args.master, sheet_name="CFR_Library")
    try:
        cap_uncompressed = pd.read_excel(args.master, sheet_name="CAP_Uncompressed")
    except Exception:
        cap_uncompressed = pd.DataFrame()

    run_expansion = build_cap_run_expansion(cap_uncompressed)
    print(f"  CFR_Library rows: {len(cfr_library)}")
    print(f"  CAP run-expansion keys: {len(run_expansion)}")

    master_index = build_master_index(cfr_library, run_expansion)
    facets = build_facet_inventory(cfr_library, run_expansion)
    print(f"  Distinct master CFR citations: {len(master_index)}")
    multi_row_cites = sorted(c for c in facets if not is_single_row(c, facets))
    print(f"  Multi-facet cites (skipped from auto-merge): {len(multi_row_cites)}")

    print(f"Reading codebase: {args.codebase}")
    ts_text = args.codebase.read_text(encoding="utf-8")
    entries = parse_codebase_rows(ts_text)
    print(f"  Codebase entries parsed: {len(entries)}")

    # Per-row merge.
    added_per_accreditor = defaultdict(int)
    rows_changed = 0
    rows_unmatched: List[str] = []
    rows_skipped_multi_facet = 0
    skipped_cites_seen: Set[str] = set()
    output_lines = ts_text.splitlines(keepends=True)
    biggest_changes: List[tuple] = []

    for e in entries:
        obj = e["obj"]
        std = obj.get("standard") or obj.get("cfr_citation")
        if std is None:
            continue
        cite_norm = normalize_codebase_cite(std)
        m = master_index.get(cite_norm)
        if m is None:
            rows_unmatched.append(std)
            continue
        if not is_single_row(cite_norm, facets):
            rows_skipped_multi_facet += 1
            skipped_cites_seen.add(cite_norm)
            continue
        new_line = e["line_raw"]
        row_added = 0
        for field in ("cap_ids", "tjc_ids", "cola_ids", "aabb_ids"):
            codebase_ids = set(obj.get(field) or [])
            master_ids = m[field]
            union = codebase_ids | master_ids
            added = master_ids - codebase_ids
            if added:
                added_per_accreditor[field] += len(added)
                row_added += len(added)
            new_line = replace_array_in_line(new_line, field, emit_array(union))
        if new_line != e["line_raw"]:
            rows_changed += 1
            output_lines[e["line_idx"]] = new_line + (
                "" if new_line.endswith("\n") else "\n"
            )
            biggest_changes.append((row_added, std, obj.get("name", "")))

    new_text = "".join(output_lines)

    print()
    print("=== Merge summary ===")
    print(f"  Rows changed: {rows_changed} of {len(entries)}")
    print(f"  Rows skipped (multi-facet master): {rows_skipped_multi_facet}")
    print(f"  Distinct cites skipped: {len(skipped_cites_seen)}")
    print(f"  IDs added — CAP : {added_per_accreditor['cap_ids']}")
    print(f"  IDs added — TJC : {added_per_accreditor['tjc_ids']}")
    print(f"  IDs added — COLA: {added_per_accreditor['cola_ids']}")
    print(f"  IDs added — AABB: {added_per_accreditor['aabb_ids']}")
    print(f"  Unmatched codebase cites: {len(rows_unmatched)} "
          f"(first 5: {rows_unmatched[:5]})")
    print()
    print("Top 10 biggest row-level adds:")
    for added, std, name in sorted(biggest_changes, reverse=True)[:10]:
        print(f"  +{added}  {std}  {name[:60]}")

    if args.dry_run:
        print()
        print("--dry-run set; not writing.")
    else:
        args.codebase.write_text(new_text, encoding="utf-8")
        print()
        print(f"Wrote: {args.codebase}")

    # Emit the multi-facet report so Michael can decide row-by-row.
    report_path = args.codebase.parent.parent / "scripts" / "cfr_requirements_multi_facet_review.md"
    with open(report_path, "w", encoding="utf-8") as fp:
        fp.write("# CFR sections with master multi-facet rows (skipped from auto-merge)\n\n")
        fp.write(f"Generated from master xlsx + cfrRequirements.ts on the day of the audit.\n")
        fp.write(f"Total multi-facet cites: {len(multi_row_cites)}\n\n")
        for cite in multi_row_cites:
            fp.write(f"## {cite}\n\n")
            for row in facets[cite]:
                fp.write(f"### {row['section_title']}\n\n")
                for fld in ("cola_ids", "cap_ids", "tjc_ids", "aabb_ids"):
                    ids = sorted(row[fld])
                    if ids:
                        fp.write(f"- **{fld}**: {', '.join(ids)}\n")
                fp.write("\n")
    print(f"Wrote multi-facet report: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
