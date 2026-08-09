"""
audit-site-factcheck.py
=======================

Reads scripts/site_audit_claims.json, cross-checks every claim against
canonical sources, and emits scripts/site_audit_findings.md with
findings organized by tier (Tier 1 = factual / customer-facing,
Tier 2 = consistency / dead-link, Tier 3 = polish / SEO / em-dash).

Canonical sources (constants below):
  - The 17 modules confirmed by the operator: 11 compliance + 6 ops
  - Pricing from CLAUDE.md section 10
  - Credentials from CLAUDE.md section 0
  - Forbidden copy terms from CLAUDE.md section 3
  - Internal routes from client/src/App.tsx
"""

import json
import re
from pathlib import Path

ROOT = Path(r"C:\Users\veril\projects\veritas-lab-services")
CLAIMS_PATH = ROOT / "scripts" / "site_audit_claims.json"
APP_TSX = ROOT / "client" / "src" / "App.tsx"
OUT_MD = ROOT / "scripts" / "site_audit_findings.md"

# ─── canonical sources ─────────────────────────────────────────────────
CANON_COMPLIANCE_MODULES = [
    "VeritaCheck", "VeritaMap", "VeritaScan", "VeritaComp", "VeritaPolicy",
    "VeritaStaff", "VeritaLab", "VeritaPT", "VeritaTrack", "VeritaResponse",
    "VeritaQC",
]
CANON_OPS_MODULES = [
    "VeritaBench", "VeritaPace", "VeritaShift", "VeritaQA", "VeritaStock",
    "VeritaOps",
]
CANON_ALL_MODULES = set(CANON_COMPLIANCE_MODULES + CANON_OPS_MODULES)
CANON_SUITE_NAME = "VeritaAssure"
CANON_MODULE_COUNT = 17
CANON_COMPLIANCE_COUNT = 11
CANON_OPS_COUNT = 6

CANON_PRICES = {
    "$25": "Per Study (one-time)",
    "$299": "VeritaCheck Unlimited year 1",
    "$499": "VeritaCheck Unlimited year 2+",
    "$999": "Clinic tier (or VeritaAssure starting price)",
    "$2,125": "Community tier",
    "$4,995": "Hospital tier",
    "$500": "Clinic per-seat add-on",
    "$425": "Community per-seat add-on",
    "$333": "Hospital per-seat add-on",
    "$99": "View-only seat add-on",
}

CANON_CREDS = ["MS", "MBA", "MLS(ASCP)", "CPHQ"]

FORBIDDEN_TERMS = [
    ("EP Evaluator", "Use 'other evaluation tools' instead"),
    ("CAMLAB", "Use 'TJC standard' instead"),
    ("LabVine", "Removed permanently"),
    ("method validation", "Labs verify; manufacturers validate"),
    ("validation suite", "Use 'performance verification' / 'verification suite'"),
]

USPTO_FILED = ["VeritaCheck", "VeritaMap", "VeritaScan", "VeritaAssure"]
USPTO_NOT_FILED = ["VeritaComp"]  # per CLAUDE.md section 11


# ─── helpers ───────────────────────────────────────────────────────────
def extract_app_routes(text: str) -> set:
    return set(re.findall(r'<Route\s+path="([^"]+)"', text))


def fmt_page(p: str) -> str:
    return f"`{p}`"


def main():
    claims = json.loads(CLAIMS_PATH.read_text(encoding="utf-8"))
    app_text = APP_TSX.read_text(encoding="utf-8")
    valid_routes = extract_app_routes(app_text)
    # Add wildcard routes to skip 404 false positives
    valid_routes_normalized = set()
    for r in valid_routes:
        # Strip route parameters
        valid_routes_normalized.add(re.sub(r"/:[^/]+", "/:param", r))

    tier1 = []  # factual / customer-facing wrongness
    tier2 = []  # consistency / dead-link
    tier3 = []  # polish / SEO / em-dash

    # ─── per-page checks ───
    for p in claims["pages"]:
        fname = p["file"]

        # 1. Module count claims
        full_text_blob = " ".join(p.get("count_claims", [])).lower()
        if "twelve module" in full_text_blob or "12 module" in full_text_blob:
            tier1.append({
                "page": fname,
                "category": "module count",
                "finding": "Claims 'twelve / 12 modules' but canonical is 17 (11 compliance + 6 operations)",
                "evidence": [c for c in p.get("count_claims", []) if re.search(r"\b(twelve|12)\b.*\bmodul", c, re.IGNORECASE)][:3],
            })
        for n_word, n_int in [("ten", 10), ("nine", 9), ("eleven", 11), ("thirteen", 13), ("fourteen", 14), ("fifteen", 15), ("sixteen", 16), ("eighteen", 18), ("twenty", 20)]:
            if re.search(rf"\b({n_word}|{n_int})\s+modul", full_text_blob, re.IGNORECASE) and n_int != CANON_MODULE_COUNT:
                tier1.append({
                    "page": fname,
                    "category": "module count",
                    "finding": f"Claims '{n_word}/{n_int} modules' but canonical is 17",
                    "evidence": [c for c in p.get("count_claims", []) if re.search(rf"\b({n_word}|{n_int})\b.*\bmodul", c, re.IGNORECASE)][:3],
                })

        # 2. Module names not in canon
        for name in p.get("module_mentions", []):
            if name not in CANON_ALL_MODULES and name != CANON_SUITE_NAME:
                tier1.append({
                    "page": fname,
                    "category": "unknown module name",
                    "finding": f"References '{name}' which is not in the canonical 17",
                    "evidence": [],
                })

        # 3. Pricing strings not in canon (skip obvious math results like "$0")
        for dollar in p.get("pricing_mentions", []):
            clean = re.sub(r"\s+", "", dollar)
            # Only flag if it looks like a marketing price (no /something)
            if not re.search(r"/(yr|year|study|month|seat|hr)", clean, re.IGNORECASE):
                continue
            base = re.match(r"\$([\d,]+(?:\.\d+)?)", clean)
            if not base:
                continue
            base_str = "$" + base.group(1)
            if base_str not in CANON_PRICES and base_str not in {"$0", "$0.00"}:
                # Skip per-seat band legacy values that may appear in code
                if base_str in {"$199", "$179", "$159", "$139"}:
                    continue
                tier2.append({
                    "page": fname,
                    "category": "pricing",
                    "finding": f"Price string '{dollar}' is not a canonical CLAUDE.md section 10 value",
                    "evidence": [dollar],
                })

        # 4. Internal links to routes that don't exist in App.tsx
        for link in p.get("internal_links", []):
            # Drop trailing slash + query
            ln = link.rstrip("/") or "/"
            if ln in valid_routes:
                continue
            # /api/* are server endpoints, not pages
            if ln.startswith("/api/") or ln.startswith("/auth/"):
                continue
            # Skip mailto:, tel:, etc.
            if ":" in ln and not ln.startswith("/"):
                continue
            # If the link starts with a known route prefix, accept (route params)
            matched = False
            for r in valid_routes:
                if r.endswith("/:id") or r.endswith("/:slug") or "/:":
                    base = r.split(":")[0].rstrip("/")
                    if base and ln.startswith(base + "/"):
                        matched = True
                        break
                if r == ln:
                    matched = True
                    break
            if not matched:
                tier2.append({
                    "page": fname,
                    "category": "internal link",
                    "finding": f"Links to {ln} but no route registered in App.tsx",
                    "evidence": [],
                })

        # 5. SEO missing
        if not p.get("seo_title"):
            tier3.append({
                "page": fname,
                "category": "SEO",
                "finding": "Page does not call useSEO(); missing customized title/description",
                "evidence": [],
            })

        # 6. Em-dashes outside comments (real customer-rendered text)
        real_dashes = [e for e in p.get("em_dashes_outside_comments", []) if e["kind"] != "literal-placeholder"]
        if real_dashes:
            tier3.append({
                "page": fname,
                "category": "em-dash",
                "finding": f"{len(real_dashes)} em-dash(es) outside code comments",
                "evidence": [e["snippet"] for e in real_dashes[:3]],
            })

        # 7. Forbidden term sweep across SEO + headings + count claims + module mentions
        merged = " | ".join([
            p.get("seo_title", ""), p.get("seo_description", ""),
            " ".join(h["text"] for h in p.get("headings", [])),
            " ".join(p.get("count_claims", [])),
        ]).lower()
        for term, advice in FORBIDDEN_TERMS:
            if term.lower() in merged:
                tier1.append({
                    "page": fname,
                    "category": "forbidden term",
                    "finding": f"Mentions '{term}'. {advice}",
                    "evidence": [term],
                })

        # 8. USPTO-filed marks using R instead of TM (or vice versa)
        # (cosmetic; skip until we have an explicit ® check)

    # ─── cross-page consistency: module-list inventory ───
    all_modules_seen = set()
    for p in claims["pages"]:
        for m in p.get("module_mentions", []):
            if m.startswith("Verita"):
                all_modules_seen.add(m)
    missing_from_codebase = sorted(all_modules_seen - CANON_ALL_MODULES - {CANON_SUITE_NAME})
    if missing_from_codebase:
        tier1.append({
            "page": "(cross-page)",
            "category": "module name inventory",
            "finding": "Module names appearing on pages that are NOT in the canonical 17",
            "evidence": missing_from_codebase,
        })
    canon_unused = sorted(CANON_ALL_MODULES - all_modules_seen)
    if canon_unused:
        tier2.append({
            "page": "(cross-page)",
            "category": "module name inventory",
            "finding": "Canonical modules never mentioned anywhere on the site",
            "evidence": canon_unused,
        })

    # ─── write report ───
    def section(title, items):
        out = [f"## {title}", ""]
        if not items:
            out.append("_No findings in this tier._\n")
            return "\n".join(out)
        # group by page
        by_page = {}
        for it in items:
            by_page.setdefault(it["page"], []).append(it)
        for page, lst in sorted(by_page.items()):
            out.append(f"### {fmt_page(page)} ({len(lst)} finding{'s' if len(lst)!=1 else ''})")
            for it in lst:
                out.append(f"- **{it['category']}**: {it['finding']}")
                for ev in it.get("evidence", []) or []:
                    out.append(f"  - `{ev}`")
            out.append("")
        return "\n".join(out)

    body = [
        "# Site-wide audit findings",
        "",
        f"Pages scanned: **{len(claims['pages'])}**",
        f"App.tsx routes: **{len(valid_routes)}**",
        f"Canonical modules: **{CANON_MODULE_COUNT}** ({CANON_COMPLIANCE_COUNT} compliance + {CANON_OPS_COUNT} operations)",
        "",
        f"Tier 1 (factual / customer-facing): **{len(tier1)}** findings",
        f"Tier 2 (consistency / dead-link / off-canon pricing): **{len(tier2)}** findings",
        f"Tier 3 (polish / SEO / em-dash): **{len(tier3)}** findings",
        "",
        "Canonical module set:",
        "- **Compliance (11):** " + ", ".join(CANON_COMPLIANCE_MODULES),
        "- **Operations (6):** " + ", ".join(CANON_OPS_MODULES),
        "",
        section("Tier 1 — factual, customer-facing", tier1),
        section("Tier 2 — consistency / dead links / off-canon pricing", tier2),
        section("Tier 3 — polish / SEO / em-dash", tier3),
    ]
    OUT_MD.write_text("\n".join(body), encoding="utf-8")
    print(f"Wrote {OUT_MD}")
    print(f"Tier 1: {len(tier1)} | Tier 2: {len(tier2)} | Tier 3: {len(tier3)}")


if __name__ == "__main__":
    main()
