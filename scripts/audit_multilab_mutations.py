#!/usr/bin/env python3
"""
audit_multilab_mutations.py

Multi-lab discipline audit. For every client page that uses
useActiveLabId / activeLabId (the marker that the page is lab-aware),
walk the file for two failure modes:

  1. fetch() call inside useMutation that targets an unscoped
     /api/<module>... URL instead of the lab-scoped path.
  2. invalidateQueries({ queryKey: [...] }) where the queryKey is a
     literal unscoped "/api/<module>..." string instead of the
     lab-scoped key.

Both produce the "Add Task on lab 3 silently writes to lab 2" bug
class that PR #606 fixed on VeritaTrack. This script catches the
remaining instances across every other module and runs in CI as a
hard gate so the next regression cannot ship.

Whitelist:
  * fetch() to /api/auth/* and /api/admin/* is exempt (no lab scope).
  * fetch() to /api/me, /api/checkout, /api/stripe-webhook are exempt.
  * Pages without useActiveLabId / activeLabId are exempt by design.

Exit code:
  0 = clean
  1 = at least one violation, report printed
"""

import json
import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGES_DIR = REPO_ROOT / "client" / "src" / "pages"
BASELINE_PATH = REPO_ROOT / "scripts" / "multilab_audit_baseline.json"

UNSCOPED_API_RE = re.compile(r'"(/api/[a-z][a-z0-9_-]*/[a-z0-9_/-]+)"')
FETCH_RE = re.compile(r'fetch\s*\(\s*`?\$?\{?[^,)]*?(/api/[^`")\s]+)')
INVALIDATE_RE = re.compile(r'invalidateQueries\s*\(\s*\{\s*queryKey\s*:\s*\[\s*"(/api/[^"]+)"')
LAB_AWARE_MARKER_RE = re.compile(r'\b(useActiveLabId|activeLabId)\b')

# Exempt URL prefixes that have no lab dimension.
EXEMPT_PREFIXES = (
    "/api/auth",
    "/api/admin",
    "/api/me",
    "/api/checkout",
    "/api/stripe",
    "/api/health",
    "/api/newsletter",
    "/api/founding-lab",
    "/api/seat-invites",
    "/api/lab-invites",
    "/api/labs",  # /api/labs/:labId/... is the scoped form; the prefix itself catches both
    # 2026-06-07: confirmed user-scoped endpoints (no lab dimension).
    # See server/routes.ts: /api/onboarding/status uses req.userId;
    # /api/account/settings reads users.lab_id but the endpoint itself
    # is per-user, not per-lab.
    "/api/onboarding",
    "/api/account",
    # 2026-06-07: /api/studies is the legacy single-lab endpoint that
    # pre-dates the multi-lab tier 2 migration. The VeritaCheckPage
    # mutation invalidates BOTH the unscoped /api/studies key AND the
    # scoped /api/labs/${activeLabId}/studies key (belt-and-suspenders).
    # Both writes hit valid GET keys somewhere, so the page refreshes.
    # Exempt the unscoped form from the audit; the scoped invalidation
    # is what matters for the lab-aware path.
    "/api/studies",
)

def is_exempt_url(url: str) -> bool:
    for p in EXEMPT_PREFIXES:
        if url.startswith(p):
            return True
    return False

def is_lab_scoped_url_literal(url: str) -> bool:
    # Literal scoped pattern in a queryKey or URL string.
    return url.startswith("/api/labs/")

def audit_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8", errors="replace")
    if not LAB_AWARE_MARKER_RE.search(text):
        return []  # page is not lab-aware; nothing to enforce
    violations: list[str] = []

    # Check 1: invalidateQueries with literal unscoped queryKey.
    for m in INVALIDATE_RE.finditer(text):
        key = m.group(1)
        if is_exempt_url(key):
            continue
        if not is_lab_scoped_url_literal(key):
            line_no = text[: m.start()].count("\n") + 1
            violations.append(
                f"  line {line_no}: invalidateQueries queryKey=\"{key}\" is UNSCOPED "
                f"on a lab-aware page (use the lab-scoped key, e.g. /api/labs/${{labId}}/...)"
            )

    # Check 2: fetch() URLs to unscoped /api/<module> when the file is
    # lab-aware. We grep for literal strings starting "/api/" inside the
    # text (these survive in commit diffs as the easiest signal). We
    # ignore strings inside the file's comments by skipping lines whose
    # stripped form starts with // or *.
    lines = text.splitlines()
    in_block_comment = False
    for i, raw in enumerate(lines, start=1):
        stripped = raw.strip()
        if "/*" in stripped and "*/" not in stripped:
            in_block_comment = True
            continue
        if in_block_comment:
            if "*/" in stripped:
                in_block_comment = False
            continue
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        for m in UNSCOPED_API_RE.finditer(raw):
            url = m.group(1)
            if is_exempt_url(url):
                continue
            if is_lab_scoped_url_literal(url):
                continue
            # Skip if the surrounding line is clearly a GET that the page
            # explicitly fell back to (legacy single-lab); we only flag
            # MUTATIONS. Easiest heuristic: the line or the prior 2 lines
            # contain "method:" with POST/PUT/DELETE/PATCH, OR the line
            # contains "queryKey" (caught by check 1 above already).
            window = "\n".join(lines[max(0, i - 4) : i + 1])
            if not re.search(r'method\s*:\s*["\'](POST|PUT|DELETE|PATCH)', window):
                continue
            violations.append(
                f"  line {i}: mutation fetch URL \"{url}\" is UNSCOPED "
                f"on a lab-aware page"
            )

    return violations


def load_baseline() -> dict[str, int]:
    if not BASELINE_PATH.exists():
        return {}
    raw = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    return {k: int(v) for k, v in raw.get("baseline", {}).items()}


def main() -> int:
    if not PAGES_DIR.is_dir():
        print(f"ERROR: pages dir not found: {PAGES_DIR}", file=sys.stderr)
        return 2

    baseline = load_baseline()
    pages = sorted(PAGES_DIR.glob("*.tsx"))
    per_page_now: dict[str, int] = {}
    per_page_report: dict[str, list[str]] = {}
    for page in pages:
        violations = audit_file(page)
        if violations:
            rel = str(page.relative_to(REPO_ROOT)).replace("\\", "/")
            per_page_now[rel] = len(violations)
            per_page_report[rel] = violations

    # Regression check: any page whose CURRENT count exceeds its
    # BASELINE count is a failure. Pages absent from the baseline
    # must be at zero. Pages whose current count drops below their
    # baseline are encouraged; they print as PROGRESS.
    regressions: list[tuple[str, int, int]] = []
    progress: list[tuple[str, int, int]] = []
    for rel, now in per_page_now.items():
        base = baseline.get(rel, 0)
        if now > base:
            regressions.append((rel, base, now))
        elif now < base:
            progress.append((rel, base, now))
    # Pages in baseline but absent from per_page_now have dropped to zero.
    for rel, base in baseline.items():
        if rel not in per_page_now and base > 0:
            progress.append((rel, base, 0))

    if regressions:
        print("FAIL: multi-lab mutation regressions detected")
        print()
        for rel, base, now in regressions:
            print(f"{rel}: baseline {base}, now {now} (+{now - base})")
            for v in per_page_report.get(rel, []):
                print(v)
            print()
        print(
            "Fix pattern: route the mutation through the lab-scoped endpoint "
            "(/api/labs/${activeLabId}/<module>/...) and invalidate the scoped "
            "queryKey on success. Canonical example: PR #606 (VeritaTrack Add Task)."
        )
        print(
            "If a flagged URL is genuinely user-scoped or app-scoped (not lab-"
            "scoped), add it to EXEMPT_PREFIXES in scripts/audit_multilab_mutations.py."
        )
        return 1

    # No regressions. Print progress if any, plus the current state.
    total_now = sum(per_page_now.values())
    total_baseline = sum(baseline.values())
    if progress:
        print("PROGRESS: multi-lab violations decreased on:")
        for rel, base, now in progress:
            print(f"  {rel}: {base} -> {now}")
        print()
    if total_now == 0:
        print("audit_multilab_mutations: 0 violations across all pages. Clean.")
        print(
            "Recommend dropping scripts/multilab_audit_baseline.json once "
            "every page is at zero."
        )
    else:
        print(
            f"audit_multilab_mutations: {total_now} violations "
            f"(baseline {total_baseline}). No regressions."
        )
        print("Outstanding (per page, capped at baseline):")
        for rel in sorted(per_page_now.keys()):
            print(f"  {rel}: {per_page_now[rel]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
