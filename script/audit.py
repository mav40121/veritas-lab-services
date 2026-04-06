#!/usr/bin/env python3
"""
VeritaAssure Code Audit Script
Run before reporting any build complete: python3 script/audit.py
Exits 1 if any ERRORS found.
"""

import os
import sys
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ERRORS = []
WARNINGS = []

SKIP_DIRS = {"node_modules", "dist", ".git", ".claude"}
SKIP_EXTENSIONS = {".lock", ".map", ".png", ".jpg", ".jpeg", ".ico", ".woff", ".woff2", ".ttf", ".eot"}
SCAN_EXTENSIONS = {".ts", ".tsx", ".html", ".md"}

def collect_files():
    results = []
    for root, dirs, files in os.walk(ROOT):
        # Prune skip dirs in-place
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fname in files:
            ext = os.path.splitext(fname)[1].lower()
            if ext not in SCAN_EXTENSIONS:
                continue
            fpath = os.path.join(root, fname)
            rel = os.path.relpath(fpath, ROOT)
            # Skip this script itself and standing requirements
            if "audit" in fname.lower() or "STANDING_REQUIREMENTS" in fname:
                continue
            results.append((rel, fpath))
    return sorted(results)

def check_file(rel, fpath):
    try:
        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        WARNINGS.append(f"[{rel}] Could not read file: {e}")
        return

    lines = content.splitlines()
    is_client = rel.startswith("client/")
    is_server = rel.startswith("server/")
    is_source = is_client or is_server or rel.startswith("shared/")
    is_ts = rel.endswith(".ts") or rel.endswith(".tsx")
    is_html = rel.endswith(".html")
    is_checkable = is_ts or is_html

    # ── 1. DANGEROUS SQL ──────────────────────────────────────────────────────
    # Only flag DELETEs that appear hardcoded (not using req.params, req.user, userId, or ? placeholder with dynamic binding)
    dangerous_delete_pattern = re.compile(
        r'DELETE FROM (studies|veritamap_maps|veritascan_scans|cumsum_trackers)', re.IGNORECASE
    )
    safe_patterns = re.compile(
        r'req\.params|req\.user|userId|user_id = \?|demoUserId|\.run\(demoUserId|WHERE id = \?|WHERE.*= \?'
    )
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        if dangerous_delete_pattern.search(line):
            if not safe_patterns.search(line):
                ERRORS.append(f"[{rel}:{i}] Hardcoded DELETE on core table -- verify this is intentional:")
                ERRORS.append(f"  >> {stripped}")

    # ── 2. HARDCODED SECRETS ──────────────────────────────────────────────────
    stripe_live = re.compile(r'sk_live_[a-zA-Z0-9]{20,}')
    railway_token = re.compile(r'7a567f5e-0399-4c82-a4d6-e57381b8c85b')
    github_token = re.compile(r'ghp_[a-zA-Z0-9]{36}')
    resend_key = re.compile(r're_[a-zA-Z0-9]{20,}')
    admin_secret = re.compile(r'veritas-admin-2026')

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("#"):
            continue
        if stripe_live.search(line):
            ERRORS.append(f"[{rel}:{i}] Stripe LIVE key hardcoded -- use process.env.STRIPE_SECRET_KEY")
        if railway_token.search(line) and is_source:
            ERRORS.append(f"[{rel}:{i}] Railway token hardcoded in source file")
        if github_token.search(line) and is_source:
            ERRORS.append(f"[{rel}:{i}] GitHub token hardcoded in source file")
        if resend_key.search(line) and is_source:
            ERRORS.append(f"[{rel}:{i}] Resend API key hardcoded in source file")
        if admin_secret.search(line) and is_client:
            ERRORS.append(f"[{rel}:{i}] Admin secret in client-side file")

    if not is_checkable:
        return

    # ── 3. COPY VIOLATIONS ────────────────────────────────────────────────────
    em_dash = "\u2014"
    registered = "\u00ae"
    trademark = "\u2122"

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Skip comment lines
        if stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("{/*"):
            pass  # still check these -- violations in comments still matter

        # Em dash -- only flag in user-facing content (JSX strings, HTML text), not code comments
        if em_dash in line:
            is_comment = stripped.startswith("//") or stripped.startswith("*") or stripped.startswith("#") or stripped.startswith("{/*")
            if not is_comment:
                WARNINGS.append(f"[{rel}:{i}] Em dash in user-facing content -- use comma, colon, or hyphen:")
                WARNINGS.append(f"  >> {stripped[:120]}")

        # ® on product names
        product_reg = re.compile(
            r'(VeritaCheck|VeritaMap|VeritaScan|VeritaComp|VeritaStaff|VeritaLab|VeritaAssure|VeritaPT)\u00ae',
            re.IGNORECASE
        )
        if product_reg.search(line):
            ERRORS.append(f"[{rel}:{i}] Registered trademark ® on product name -- must be ™")

        # EP Evaluator
        if re.search(r'EP Evaluator', line, re.IGNORECASE):
            ERRORS.append(f"[{rel}:{i}] 'EP Evaluator' name must not appear -- use 'other evaluation tools'")

        # CAMLAB
        if re.search(r'\bCAMLAB\b', line, re.IGNORECASE):
            ERRORS.append(f"[{rel}:{i}] CAMLAB reference -- use 'TJC standard'")

        # LabVine
        if re.search(r'\bLabVine\b', line, re.IGNORECASE):
            ERRORS.append(f"[{rel}:{i}] LabVine reference -- remove entirely")

        # APHL (warn only -- could be legitimate in some contexts)
        if re.search(r'\bAPHL\b', line, re.IGNORECASE):
            WARNINGS.append(f"[{rel}:{i}] 'APHL' detected -- VeritaPT uses API (American Proficiency Institute), not APHL")

    # ── 4. PDF COMPLIANCE (pdfReport.ts only) ────────────────────────────────
    if "pdfReport" in rel:
        # Must reference CLIA
        if not re.search(r'clia', content, re.IGNORECASE):
            WARNINGS.append(f"[{rel}] No CLIA reference in PDF generator -- every report must show CLIA number")

        # "laboratory director" without "or designee"
        for i, line in enumerate(lines, 1):
            if re.search(r'laboratory director', line, re.IGNORECASE):
                if not re.search(r'or designee', line, re.IGNORECASE):
                    stripped = line.strip()
                    # Skip if it's in a comment or string concatenation fragment
                    if not stripped.startswith("//") and not stripped.startswith("*"):
                        WARNINGS.append(f"[{rel}:{i}] 'laboratory director' without 'or designee':")
                        WARNINGS.append(f"  >> {stripped[:120]}")

        # VeritaScan PDF must NOT have director signature block
        if re.search(r'veritascan', content, re.IGNORECASE):
            if re.search(r'LABORATORY DIRECTOR OR DESIGNEE REVIEW', content):
                WARNINGS.append(f"[{rel}] Director signature block found in VeritaScan PDF context -- VeritaScan is internal use only")


def main():
    files = collect_files()
    print(f"Scanning {len(files)} files from {ROOT}\n")

    for rel, fpath in files:
        check_file(rel, fpath)

    print("=" * 60)

    if WARNINGS:
        print(f"\nWARNINGS ({len(WARNINGS)} items -- review before shipping):")
        for w in WARNINGS:
            print(f"  {w}")

    if ERRORS:
        print(f"\nERRORS ({len(ERRORS)} items -- must fix before committing):")
        for e in ERRORS:
            print(f"  {e}")
        print(f"\nAudit FAILED -- {len(ERRORS)} error(s), {len(WARNINGS)} warning(s)")
        sys.exit(1)
    else:
        print(f"\nAudit PASSED -- 0 errors, {len(WARNINGS)} warning(s)")
        sys.exit(0)


if __name__ == "__main__":
    main()
