#!/bin/bash
# VeritaAssure Code Audit Script
# Run before reporting any build complete.
# Usage: bash script/audit.sh
# Exits 1 if any ERRORS found.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ERRORS=()
WARNINGS=()

# Files to scan (exclude node_modules, dist, lock files, this script itself)
FILES=$(find "$ROOT" \( -name "*.ts" -o -name "*.tsx" -o -name "*.html" -o -name "*.md" \) \
  | grep -vE "node_modules|/dist/|\.lock$|audit\.sh$|STANDING_REQUIREMENTS" \
  | sort)

echo "Scanning $(echo "$FILES" | wc -l | tr -d ' ') files..."
echo ""

for FILE in $FILES; do
  REL="${FILE#$ROOT/}"
  CONTENT=$(cat "$FILE")

  # ── 1. DANGEROUS SQL ───────────────────────────────────────────────────────
  # Flag DELETEs that use hardcoded values -- not req.params/req.user/dynamic userId
  DANGEROUS=$(echo "$CONTENT" | grep -nE "DELETE FROM (studies|veritamap|veritascan|cumsum|competency)" \
    | grep -v "req\.params" \
    | grep -v "req\.user" \
    | grep -v "userId" \
    | grep -v "user_id = ?" \
    | grep -v "^\.//")
  if [ -n "$DANGEROUS" ]; then
    ERRORS+=("[$REL] Possibly hardcoded DELETE on user/demo table -- verify this is safe:")
    while IFS= read -r line; do ERRORS+=("  $line"); done <<< "$DANGEROUS"
  fi

  # ── 2. HARDCODED SECRETS ──────────────────────────────────────────────────
  if echo "$CONTENT" | grep -qE "sk_live_[a-zA-Z0-9]{20,}"; then
    ERRORS+=("[$REL] Stripe live key hardcoded")
  fi
  if echo "$CONTENT" | grep -qE "7a567f5e-0399-4c82-a4d6-e57381b8c85b"; then
    ERRORS+=("[$REL] Railway token hardcoded")
  fi
  if echo "$CONTENT" | grep -qE "ghp_[a-zA-Z0-9]{36}"; then
    ERRORS+=("[$REL] GitHub token hardcoded")
  fi
  if echo "$CONTENT" | grep -qE "re_[a-zA-Z0-9]{20,}"; then
    # Only flag in source files, not in docs/handoffs
    if echo "$REL" | grep -qE "^(server|client|shared)/"; then
      ERRORS+=("[$REL] Resend API key hardcoded")
    fi
  fi
  if echo "$REL" | grep -qE "^client/" && echo "$CONTENT" | grep -q "veritas-admin-2026"; then
    ERRORS+=("[$REL] Admin secret in client-side file")
  fi

  # ── 3. COPY VIOLATIONS ────────────────────────────────────────────────────
  if echo "$REL" | grep -qE "\.(tsx|ts|html)$"; then
    # Em dashes
    if echo "$CONTENT" | grep -qP "\u2014"; then
      COUNT=$(echo "$CONTENT" | grep -cP "\u2014")
      WARNINGS+=("[$REL] $COUNT em dash(es) -- use comma, colon, or hyphen")
    fi

    # ® on product names
    if echo "$CONTENT" | grep -qP "(VeritaCheck|VeritaMap|VeritaScan|VeritaComp|VeritaStaff|VeritaLab|VeritaAssure|VeritaPT)\u00AE"; then
      ERRORS+=("[$REL] ® on product name -- must be ™")
    fi

    # EP Evaluator
    if echo "$CONTENT" | grep -qi "EP Evaluator"; then
      ERRORS+=("[$REL] 'EP Evaluator' name -- use 'other evaluation tools'")
    fi

    # CAMLAB
    if echo "$CONTENT" | grep -qi "CAMLAB"; then
      ERRORS+=("[$REL] CAMLAB reference -- use 'TJC standard'")
    fi

    # LabVine
    if echo "$CONTENT" | grep -qi "LabVine"; then
      ERRORS+=("[$REL] LabVine reference -- remove entirely")
    fi

    # APHL
    if echo "$CONTENT" | grep -qi "\bAPHL\b"; then
      WARNINGS+=("[$REL] 'APHL' detected -- verify this is not a VeritaPT context (should be API)")
    fi
  fi

  # ── 4. PDF COMPLIANCE CHECKS (pdfReport.ts only) ─────────────────────────
  if echo "$REL" | grep -q "pdfReport"; then
    # Must have CLIA number on every report
    if ! echo "$CONTENT" | grep -qi "clia"; then
      WARNINGS+=("[$REL] No CLIA reference found in PDF generator -- every report must show CLIA number")
    fi
    # Must not have "laboratory director" alone (needs "or designee")
    LAB_DIR_ALONE=$(echo "$CONTENT" | grep -iE "laboratory director[^a-z]" | grep -iv "or designee" | grep -v "^\s*//" | head -3)
    if [ -n "$LAB_DIR_ALONE" ]; then
      WARNINGS+=("[$REL] 'laboratory director' without 'or designee':")
      while IFS= read -r line; do WARNINGS+=("  $line"); done <<< "$LAB_DIR_ALONE"
    fi
    # VeritaScan PDFs must not have director signature
    if echo "$CONTENT" | grep -qi "veritascan" && echo "$CONTENT" | grep -qi "LABORATORY DIRECTOR OR DESIGNEE REVIEW"; then
      WARNINGS+=("[$REL] Possible director signature block in VeritaScan PDF -- VeritaScan is internal use only")
    fi
  fi

done

# ── Print Results ─────────────────────────────────────────────────────────────
echo "=============================="
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo ""
  echo "WARNINGS (review before shipping):"
  for W in "${WARNINGS[@]}"; do echo "  $W"; done
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "ERRORS (must fix before committing):"
  for E in "${ERRORS[@]}"; do echo "  $E"; done
  echo ""
  echo "Audit FAILED -- ${#ERRORS[@]} error(s), ${#WARNINGS[@]} warning(s)"
  exit 1
else
  echo ""
  echo "Audit PASSED -- 0 errors, ${#WARNINGS[@]} warning(s)"
  exit 0
fi
