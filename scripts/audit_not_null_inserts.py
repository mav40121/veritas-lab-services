#!/usr/bin/env python3
"""
audit_not_null_inserts.py — bug-class sweep for INSERT statements that
omit a NOT NULL column (without DEFAULT) from their column list.

Background: PR #513 (2026-06-02) fixed a synthetic INSERT in the
qa-auto-expire-test endpoint that passed NULL for
policy_documents.owner_user_id, which is NOT NULL. The fix shipped
but raised the question whether other INSERTs in the codebase have
the same shape on customer-reachable paths. This script audits.

Strategy:
  1. Parse CREATE TABLE statements from server/db.ts. For each table,
     build the set of NOT NULL columns that have no DEFAULT clause.
  2. Walk every *.ts file under server/. Find INSERT INTO statements,
     extract the column list, compare against the table's NOT NULL set.
  3. Report any INSERT that omits a NOT NULL-without-DEFAULT column.

Limitations:
  - Skips INSERT...SELECT statements (column list is dynamic).
  - Skips INSERTs to tables not declared in db.ts.
  - Multi-line CREATE TABLE and multi-line INSERTs are both handled
    via a tolerant regex that allows newlines.

Output: prints {path}:{lineno} for every flagged INSERT, and the set
of NOT NULL columns it omitted. Exits 0 regardless of findings; this
is a report, not a CI gate.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO / "server"
DB_FILE = SERVER_DIR / "db.ts"


def parse_schema(db_text: str) -> dict[str, set[str]]:
    """Return {table_name: {col_name, ...}} for NOT NULL columns
    that do NOT have a DEFAULT clause."""
    table_to_required = {}
    pattern = re.compile(
        r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.*?)\)\s*[;`]",
        re.DOTALL | re.IGNORECASE,
    )
    for m in pattern.finditer(db_text):
        table = m.group(1)
        body = m.group(2)
        cols_required = set()
        # Strip SQL line comments before splitting on commas so commas
        # inside comments do not split a column body, and comment text
        # never gets mis-parsed as a column name.
        body_clean = re.sub(r"--[^\n]*", "", body)
        for raw_line in body_clean.split(","):
            line = raw_line.strip()
            if not line:
                continue
            # Skip table-level constraints (FOREIGN KEY, UNIQUE, etc.)
            upper = line.upper()
            if upper.startswith("FOREIGN KEY") or upper.startswith("UNIQUE"):
                continue
            if upper.startswith("PRIMARY KEY") or upper.startswith("CHECK"):
                continue
            # First whitespace-separated token is the column name. Must
            # start with a letter (not a digit) to avoid grabbing numeric
            # literals from arithmetic expressions in DEFAULT clauses.
            name_match = re.match(r"([A-Za-z_]\w*)\s+", line)
            if not name_match:
                continue
            col_name = name_match.group(1)
            # Skip PRIMARY KEY columns (autoincrement, can be NULL on insert).
            if "PRIMARY KEY" in upper:
                continue
            has_not_null = "NOT NULL" in upper
            has_default = "DEFAULT" in upper
            if has_not_null and not has_default:
                cols_required.add(col_name)
        if cols_required:
            table_to_required[table] = cols_required
    return table_to_required


def find_inserts(text: str) -> list[tuple[int, str, list[str], str]]:
    """Find INSERT INTO statements. Returns list of
    (line_no, table_name, column_list, snippet)."""
    results = []
    # Tolerant pattern: INSERT INTO <table> (col1, col2, ...) VALUES ...
    # Allows newlines inside the parens. Captures column list only when
    # an explicit list exists (skip INSERT INTO x SELECT ...).
    pattern = re.compile(
        r"INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*(VALUES|SELECT)",
        re.IGNORECASE | re.DOTALL,
    )
    for m in pattern.finditer(text):
        table = m.group(1)
        cols_text = m.group(2)
        verb = m.group(3).upper()
        if verb == "SELECT":
            # INSERT...SELECT statements: skip, column source is dynamic.
            continue
        cols = [c.strip() for c in cols_text.split(",") if c.strip()]
        # Line number where the match starts.
        line_no = text[: m.start()].count("\n") + 1
        # Brief snippet for context.
        snippet = text[m.start() : m.start() + 100].replace("\n", " ")
        results.append((line_no, table, cols, snippet))
    return results


def main():
    db_text = DB_FILE.read_text(encoding="utf-8")
    table_to_required = parse_schema(db_text)
    print(f"Parsed {len(table_to_required)} tables with NOT NULL-without-DEFAULT columns.")
    print()

    findings = []
    for ts_path in sorted(SERVER_DIR.rglob("*.ts")):
        text = ts_path.read_text(encoding="utf-8")
        for line_no, table, cols, snippet in find_inserts(text):
            required = table_to_required.get(table)
            if not required:
                continue
            cols_set = set(cols)
            missing = required - cols_set
            if missing:
                findings.append((ts_path, line_no, table, missing, snippet))

    if not findings:
        print("No INSERT omits a NOT NULL-without-DEFAULT column. Codebase is clean for this bug class.")
        return 0

    print(f"Found {len(findings)} INSERT statements that omit a NOT NULL column:")
    print()
    for path, line_no, table, missing, snippet in findings:
        rel = path.relative_to(REPO).as_posix()
        print(f"{rel}:{line_no}  table={table}  missing_not_null={sorted(missing)}")
        print(f"  snippet: {snippet[:100]}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
