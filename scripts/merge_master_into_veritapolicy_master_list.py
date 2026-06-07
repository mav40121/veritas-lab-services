#!/usr/bin/env python3
"""
merge_master_into_veritapolicy_master_list.py

Sync server/veritapolicyMasterList.ts accreditor citation strings from
the canonical master citation index xlsx. Same discipline as
merge_master_into_cfr_requirements.py, but the file shape is different:

  - cfrRequirements.ts:    one row per CFR cite. Citations are array fields.
  - veritapolicyMasterList.ts: one row per policy_id. Citations are
    semicolon-joined strings, and each policy may reference multiple
    CFR sections.

For each policy row, the script:
  1. Parses cfr_citations into individual CFR cites.
  2. For each CFR cite, looks up master CFR_Library row(s).
  3. Skips contributions from multi-facet CFRs (different section_titles)
     — same safe-mode rule as the cfrRequirements.ts merge.
  4. Unions accreditor IDs (codebase ∪ master) across all single-row
     contributions.
  5. Re-emits as alphabetized semicolon-joined strings.

Customer-visible consequence: VeritaPolicy per-policy DOCX downloads
(PR #400 / veritapolicyDocx.ts) read this file to render the
Accreditor Crosswalk section. Re-syncing makes the crosswalk show the
current master content for every per-policy DOCX a director downloads.
"""

import argparse
import json
import pathlib
import re
import sys
from collections import defaultdict
from typing import Dict, List, Set

import pandas as pd


MASTER_XLSX = pathlib.Path(
    r"C:\Users\veril\OneDrive\Desktop\Lab\Regulatory"
    r"\aaa Truth Master Document\veritaassure_master_citation_index_v0.11.xlsx"
)
CODEBASE_TS = pathlib.Path(
    r"C:\Users\veril\projects\veritas-lab-services\server\veritapolicyMasterList.ts"
)


def strip_paraphrase(token: str) -> str:
    """
    Master cells like 'PER 5 (six-element competency)' -> 'PER 5'.
    ID is always at the start, paraphrase follows after a space-paren.
    """
    idx = token.find(" (")
    if idx != -1:
        return token[:idx].strip()
    return token.strip()


def parse_master_ids(cell, run_expansion: Dict[str, List[str]]) -> Set[str]:
    """Same ID extractor used for cfrRequirements.ts."""
    if cell is None or isinstance(cell, float):
        return set()
    s = str(cell)
    out: Set[str] = set()
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
        if re.match(r"^[A-Z]+\.\d+-[A-Z]+\.\d+$", bare):
            if bare in run_expansion:
                out.update(run_expansion[bare])
                continue
            stem = re.match(r"^([A-Z]+\.\d+-[A-Z]+\.\d+)", bare)
            if stem and stem.group(1) in run_expansion:
                out.update(run_expansion[stem.group(1)])
                continue
            continue  # drop unmappable compressed-run literal
        if re.match(r"^[A-Z]+\.?\s*\d+(?:\.\d+)*$", bare):
            out.add(bare)
        elif bare and not bare.startswith("("):
            out.add(bare)
    return out


def build_cap_run_expansion(cap_uncompressed: pd.DataFrame) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    if "Compressed CAP IDs (in Crosswalk)" not in cap_uncompressed.columns:
        return out
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
        uncomp_ids = [
            strip_paraphrase(x.strip())
            for x in split_re.split(str(uncompressed))
            if x.strip()
        ]
        uncomp_ids = [x for x in uncomp_ids if x]
        if not uncomp_ids:
            continue
        for run in split_re.split(str(compressed).strip()):
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
):
    """
    Per CFR cite: dict of {accreditor: set(ids)}.
    Also returns a multi-facet set for the safe-mode skip rule.
    """
    by_cite: Dict[str, Dict[str, Set[str]]] = defaultdict(
        lambda: {"cap_ids": set(), "tjc_ids": set(), "cola_ids": set(), "aabb_ids": set()}
    )
    facets: Dict[str, Set[str]] = defaultdict(set)
    for _, row in cfr_library.iterrows():
        cite = row.get("cfr_citation")
        if cite is None or isinstance(cite, float):
            continue
        cite = str(cite).strip()
        st = row.get("section_title")
        st = "" if (st is None or isinstance(st, float)) else str(st).strip()
        facets[cite].add(st)
        for col in ("cap_ids", "tjc_ids", "cola_ids", "aabb_ids"):
            by_cite[cite][col] |= parse_master_ids(row.get(col), run_expansion)
    return by_cite, facets


def is_single_facet(cite: str, facets: Dict[str, Set[str]]) -> bool:
    titles = facets.get(cite) or set()
    return len(titles) <= 1


def parse_codebase_string_list(s: str, run_expansion: Dict[str, List[str]] = None) -> List[str]:
    """
    Parse a semicolon-joined citation string and return clean individual
    IDs. Normalizes:
      - Strips trailing ')' typos (HEAD has 'COM.04000)' on policies
        #34 and #73; we don't carry those forward into the merged set).
      - COLA-style ranges 'FAC 1-FAC 3' are enumerated to individual IDs
        because COLA grouping numbers are small and contiguous.
      - CAP-style ranges 'GEN.20316-GEN.20326' are expanded via the
        CAP_Uncompressed run_expansion dict if known, else the range
        literal is preserved (don't fabricate CAP IDs by numerical
        enumeration — CAP numbering has gaps).
    """
    if not s:
        return []
    parts = [x.strip() for x in re.split(r"[;]", s)]
    cleaned: List[str] = []
    for raw in parts:
        if not raw:
            continue
        # Strip trailing stray close-parens (typo normalization).
        token = re.sub(r"\)+$", "", raw).strip()
        if not token:
            continue
        # COLA-style range: "PREFIX N1-PREFIX N2" with same prefix.
        m = re.match(r"^([A-Z]+)\s+(\d+)-\1\s+(\d+)$", token)
        if m:
            prefix, n1, n2 = m.group(1), int(m.group(2)), int(m.group(3))
            if n2 >= n1 and n2 - n1 <= 50:
                cleaned.extend(f"{prefix} {i}" for i in range(n1, n2 + 1))
                continue
        # CAP-style range: "PREFIX.NNN-PREFIX.MMM" with same prefix.
        m = re.match(r"^([A-Z]+)\.(\d+)-\1\.(\d+)$", token)
        if m:
            stem = f"{m.group(1)}.{m.group(2)}-{m.group(1)}.{m.group(3)}"
            if run_expansion and stem in run_expansion:
                cleaned.extend(run_expansion[stem])
                continue
            # Unknown range: keep the literal so coverage isn't dropped.
            cleaned.append(token)
            continue
        cleaned.append(token)
    return cleaned


def emit_string_list(ids: Set[str]) -> str:
    return "; ".join(sorted(ids))


def normalize_codebase_cfr_cite(cite: str) -> str:
    """
    veritapolicyMasterList uses '42 CFR 493.1100' (no §). Master uses the
    same form. cfrRequirements.ts uses '42 CFR §493.1100' (with §).
    Just normalize whitespace.
    """
    return re.sub(r"\s+", " ", cite).strip()


def replace_quoted_value_in_line(line: str, field: str, new_value: str) -> str:
    pat = re.compile(rf'("{re.escape(field)}":\s*)"((?:[^"\\]|\\.)*)"')

    def sub(m: re.Match) -> str:
        return m.group(1) + '"' + new_value.replace("\\", "\\\\").replace('"', '\\"') + '"'

    return pat.sub(sub, line)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--master", type=pathlib.Path, default=MASTER_XLSX)
    parser.add_argument("--codebase", type=pathlib.Path, default=CODEBASE_TS)
    args = parser.parse_args()

    print(f"Reading master: {args.master}")
    cfr_library = pd.read_excel(args.master, sheet_name="CFR_Library")
    try:
        cap_uncompressed = pd.read_excel(args.master, sheet_name="CAP_Uncompressed")
    except Exception:
        cap_uncompressed = pd.DataFrame()
    run_expansion = build_cap_run_expansion(cap_uncompressed)
    by_cite, facets = build_master_index(cfr_library, run_expansion)
    print(f"  CFR_Library rows: {len(cfr_library)}")
    print(f"  Distinct master cites: {len(by_cite)}")
    print(f"  Multi-facet cites (skipped contributions): "
          f"{sum(1 for c in by_cite if not is_single_facet(c, facets))}")

    print(f"Reading codebase: {args.codebase}")
    ts_text = args.codebase.read_text(encoding="utf-8")

    # Parse each policy row. The file is `export const VERITAPOLICY_MASTER_LIST: ... = [\n  {...},\n  {...},\n];`.
    # Each row is multi-line (object spans ~13 lines with one field per line).
    # Strategy: extract row blocks by matching balanced { } at top level, parse
    # as JSON, then surgically replace the four citation strings line-by-line.
    rows_changed = 0
    accreditor_added = defaultdict(int)
    skipped_multifacet_contribs = defaultdict(list)  # policy_id -> list of cites
    output_lines = ts_text.splitlines(keepends=True)

    # Find row blocks. Each starts with a line whose stripped form is '{' and
    # ends with a line whose stripped form is '}' or '},'.
    starts: List[int] = []
    ends: List[int] = []
    in_array = False
    depth = 0
    for i, line in enumerate(ts_text.splitlines()):
        stripped = line.strip()
        if not in_array:
            if "VERITAPOLICY_MASTER_LIST" in line and "[" in line:
                in_array = True
            continue
        # within array body
        if stripped == "{":
            if depth == 0:
                starts.append(i)
            depth += 1
        elif stripped in ("}", "},"):
            depth -= 1
            if depth == 0:
                ends.append(i)
        elif stripped == "];":
            in_array = False
            break

    print(f"  Codebase row blocks parsed: {len(starts)}")
    if len(starts) != len(ends):
        print("ERROR: unbalanced row blocks. Aborting.", file=sys.stderr)
        return 2

    for start, end in zip(starts, ends):
        # Re-assemble the row text and parse as JSON.
        row_lines = ts_text.splitlines()[start : end + 1]
        # Strip trailing comma on the closing brace if present so json can parse.
        raw = "\n".join(row_lines).rstrip().rstrip(",")
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            print(f"  WARN: row at lines {start+1}-{end+1} did not parse as JSON; skipping")
            continue

        policy_id = obj.get("policy_id", "?")
        cfr_str = obj.get("cfr_citations") or ""
        cfr_cites = parse_codebase_string_list(cfr_str)
        # Union master IDs across all single-facet cites the policy references.
        merged = {
            "cap_citations": set(parse_codebase_string_list(obj.get("cap_citations") or "", run_expansion)),
            "tjc_citations": set(parse_codebase_string_list(obj.get("tjc_citations") or "", run_expansion)),
            "cola_citations": set(parse_codebase_string_list(obj.get("cola_citations") or "", run_expansion)),
            "aabb_citations": set(parse_codebase_string_list(obj.get("aabb_citations") or "", run_expansion)),
        }
        before_sizes = {k: len(v) for k, v in merged.items()}

        for cite_raw in cfr_cites:
            cite = normalize_codebase_cfr_cite(cite_raw)
            if cite not in by_cite:
                continue  # not indexed by master (e.g., 10 CFR 20, 21 CFR 1271 may be sparse)
            if not is_single_facet(cite, facets):
                skipped_multifacet_contribs[policy_id].append(cite)
                continue
            row_master = by_cite[cite]
            merged["cap_citations"]  |= row_master["cap_ids"]
            merged["tjc_citations"]  |= row_master["tjc_ids"]
            merged["cola_citations"] |= row_master["cola_ids"]
            merged["aabb_citations"] |= row_master["aabb_ids"]

        row_changed = False
        for field in ("cap_citations", "tjc_citations", "cola_citations", "aabb_citations"):
            new_val = emit_string_list(merged[field])
            cur_val = obj.get(field) or ""
            if new_val != cur_val:
                added = len(merged[field]) - before_sizes[field]
                accreditor_added[field] += max(0, added)
                row_changed = True
                # Find the line within the block where this field lives and
                # replace its quoted value.
                for line_idx in range(start, end + 1):
                    line = output_lines[line_idx]
                    if f'"{field}":' in line:
                        output_lines[line_idx] = replace_quoted_value_in_line(line, field, new_val)
                        break

        if row_changed:
            rows_changed += 1

    new_text = "".join(output_lines)

    print()
    print("=== Merge summary ===")
    print(f"  Policy rows changed: {rows_changed} of {len(starts)}")
    print(f"  Policies with skipped multi-facet contributions: "
          f"{len(skipped_multifacet_contribs)}")
    print(f"  Citations added — CAP : {accreditor_added['cap_citations']}")
    print(f"  Citations added — TJC : {accreditor_added['tjc_citations']}")
    print(f"  Citations added — COLA: {accreditor_added['cola_citations']}")
    print(f"  Citations added — AABB: {accreditor_added['aabb_citations']}")

    if args.dry_run:
        print()
        print("--dry-run set; not writing.")
        return 0

    args.codebase.write_text(new_text, encoding="utf-8")
    print()
    print(f"Wrote: {args.codebase}")

    # Skipped-contribution report
    report_path = pathlib.Path("scripts") / "veritapolicy_master_list_multi_facet_skips.md"
    with open(report_path, "w", encoding="utf-8") as fp:
        fp.write("# VeritaPolicy master list: skipped multi-facet contributions\n\n")
        fp.write(
            "For each policy below, these CFR citations were SKIPPED from the master "
            "merge because master decomposes them into per-facet rows that need "
            "row-by-row review. The policy's existing codebase citations on those "
            "fields remain unchanged for now.\n\n"
        )
        for pid in sorted(skipped_multifacet_contribs):
            cites = skipped_multifacet_contribs[pid]
            fp.write(f"## Policy {pid}\n\n")
            for cite in sorted(set(cites)):
                fp.write(f"- {cite}\n")
            fp.write("\n")
    print(f"Wrote skipped-contribution report: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
