"""BUG-094 bug-class sweep (2026-10-24): find saves that DELETE a set of rows and then INSERT the replacement rows into the
same table OUTSIDE one transaction. A failure between the two (a "database is locked" timeout, a bad value, a crash)
commits the delete alone and leaves the record empty; that is how a VeritaMap instrument could lose its whole test menu.

For every `DELETE FROM <table>` it looks ahead for an INSERT into the same table in the same handler, and reports the
pair as SAFE when the DELETE sits inside a `.transaction(` callback or between sqlite.exec("BEGIN") and COMMIT, else RISK.
Heuristic (brace depth on the raw text); every RISK line is reviewed by hand, and a reviewed false positive carries a
"delete-reinsert-ok: <reason>" comment so the sweep stays at 0.
Usage: python scripts/audit-delete-reinsert.py [--fail-on-risk] [files...]   (default: server/*.ts)
"""
import glob
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEL = re.compile(r"DELETE\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)", re.I)
LOOKAHEAD = 40


def enclosing_txn(lines, i):
    """True when line i is inside a .transaction( callback, or after an exec("BEGIN") with no COMMIT/ROLLBACK yet."""
    depth = 0
    for j in range(i, max(-1, i - 400), -1):
        s = lines[j]
        if j != i:
            depth += s.count("}") - s.count("{")
        if depth < 0 and ".transaction(" in s:
            return True
        if depth <= 0 and re.search(r"exec\(\s*[\"'`]BEGIN", s):
            between = "\n".join(lines[j:i])
            if not re.search(r"exec\(\s*[\"'`](COMMIT|ROLLBACK)", between):
                return True
        if re.match(r"\s*app\.(get|post|put|patch|delete)\(", s) or re.match(r"(export )?(async )?function ", s):
            break
    return False


def scan(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out = []
    for i, s in enumerate(lines):
        m = DEL.search(s)
        if not m or s.strip().startswith("//"):
            continue
        table = m.group(1)
        # Reviewed by hand and not a delete-then-replace (a prepared statement run inside a transaction elsewhere, a
        # cascade delete, a toggle, an expiry cleanup): marked "delete-reinsert-ok: <reason>" on the line or just above.
        if any("delete-reinsert-ok:" in lines[k] for k in range(max(0, i - 2), i + 1)):
            continue
        ins = re.compile(r"INSERT\s+(OR\s+\w+\s+)?INTO\s+" + re.escape(table) + r"\b", re.I)
        for k in range(i + 1, min(len(lines), i + LOOKAHEAD)):
            if re.match(r"\s*app\.(get|post|put|patch|delete)\(", lines[k]):
                break
            if ins.search(lines[k]):
                out.append((i + 1, k + 1, table, "SAFE" if enclosing_txn(lines, i) else "RISK"))
                break
    return out


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")] or sorted(glob.glob(os.path.join(ROOT, "server", "*.ts")))
    risks = 0
    for f in files:
        for d, ins, table, verdict in scan(f):
            print(f"{verdict}  {os.path.relpath(f, ROOT)}:{d}  DELETE {table} -> INSERT line {ins}")
            risks += verdict == "RISK"
    print(f"{risks} RISK pair(s)")
    sys.exit(1 if risks and "--fail-on-risk" in sys.argv else 0)


if __name__ == "__main__":
    main()
