#!/usr/bin/env python3
"""
audit_lab_routes_auth.py — bug-class sweep for /api/labs/:labId/* routes
that omit authMiddleware from their middleware chain.

A route under /api/labs/:labId/* operates on lab-scoped data and must
require an authenticated user. authMiddleware is the standard shape;
labScopeMiddleware alone is not auth (it only resolves the active lab
from URL + memberships, which it can't do without auth set up first).

Strategy:
  1. Find every `app.<verb>("/api/labs/:labId/...)` registration.
  2. Slice the next ~500 chars from each match (the middleware chain
     and the start of the handler).
  3. Flag any slice that does not contain the literal "authMiddleware".

Limitations:
  - A route using a custom auth-equivalent middleware (e.g. a
    requireAuthOrApiKey wrapper) would be flagged. Spot-check each
    finding before patching.
  - Routes registered with app.use(...) middleware chains rather than
    per-route are out of scope.

Output: prints flagged routes by file:line.
"""

import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO / "server"


def audit_file(path: Path) -> list[tuple[int, str]]:
    """Return [(line_no, route_snippet), ...] for /api/labs/:labId/*
    routes missing authMiddleware."""
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'app\.(get|post|put|patch|delete)\s*\(\s*["`]/api/labs/:labId/[^"`]*["`]',
        re.IGNORECASE,
    )
    flagged = []
    for m in pattern.finditer(text):
        start = m.start()
        # Slice up to the next route registration or 500 chars, whichever
        # comes first, to bound the middleware-chain inspection.
        next_route = re.search(r'\bapp\.(get|post|put|patch|delete)\s*\(', text[m.end():])
        end = m.end() + (next_route.start() if next_route else 500)
        end = min(end, m.start() + 500)
        chain = text[start:end]
        if "authMiddleware" not in chain:
            line_no = text[: m.start()].count("\n") + 1
            # Capture the route path for the report.
            route_match = re.search(r'["`](/api/labs/:labId/[^"`]*)["`]', chain)
            route_path = route_match.group(1) if route_match else "?"
            flagged.append((line_no, f"{m.group(1).upper()} {route_path}"))
    return flagged


def main():
    total = 0
    customer_reachable_flags = []
    for ts_path in sorted(SERVER_DIR.rglob("*.ts")):
        flags = audit_file(ts_path)
        if flags:
            rel = ts_path.relative_to(REPO).as_posix()
            for line_no, snippet in flags:
                customer_reachable_flags.append((rel, line_no, snippet))
            total += len(flags)

    if total == 0:
        print("All /api/labs/:labId/* routes include authMiddleware. Clean.")
        return 0

    print(f"Found {total} /api/labs/:labId/* route(s) without authMiddleware:")
    print()
    for rel, line_no, snippet in customer_reachable_flags:
        print(f"  {rel}:{line_no}  {snippet}")
    print()
    print("Spot-check each: a custom auth wrapper could mean false positive.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
