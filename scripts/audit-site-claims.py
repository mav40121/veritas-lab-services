"""
audit-site-claims.py
====================

Walks every page in client/src/pages/, extracts structured claims, and
emits JSON to scripts/site_audit_claims.json. Companion fact-check
script consumes this file.

Claims extracted per page:
  - SEO title and description from useSEO() call
  - All H1/H2 text
  - Stat numbers in customer-rendered JSX
  - Pricing strings ($... / yr, $... one-time, etc.)
  - Credentials strings (MS, MBA, MLS, CPHQ, etc.)
  - Module name mentions (Verita*)
  - Internal links (href="/...")
  - External links (href="https://...")
  - Mentions of count words (twelve, eleven, etc.) and 2-digit
    counts in module/year contexts
  - TODO / FIXME comments
  - Em-dashes inside JSX text nodes (excluding code comments)
"""

import json
import re
from pathlib import Path

PAGES_DIR = Path(r"C:\Users\veril\projects\veritas-lab-services\client\src\pages")
OUT_PATH = Path(r"C:\Users\veril\projects\veritas-lab-services\scripts\site_audit_claims.json")

USESEO_RE = re.compile(
    r'useSEO\(\{\s*title:\s*"([^"]*)"(?:\s*,\s*description:\s*"([^"]*)")?',
    re.MULTILINE | re.DOTALL,
)
H_TAG_RE = re.compile(r'<(h[1-6])[^>]*>(.*?)</\1>', re.DOTALL)
INNER_TEXT_RE = re.compile(r'>([^<{}\n][^<{}]{2,200})<')
HREF_RE = re.compile(r'href=(?:"|\{\s*"?)([^"\s\}]+)')
LINK_TO_RE = re.compile(r'<Link[^>]*\s(?:href|to)="([^"]+)"')
TODO_RE = re.compile(r'(//|/\*)[^\n]*\b(TODO|FIXME|HACK|XXX)\b[^\n]*', re.IGNORECASE)
EM_DASH_RE = re.compile(r'.{0,40}—.{0,40}')
COMMENT_LINE_RE = re.compile(r'^\s*(//|/\*|\*)')
DOLLAR_RE = re.compile(r'\$\s?\d[\d,]*(?:\.\d+)?(?:\s*/\s*(?:yr|year|study|month|seat|hr))?', re.IGNORECASE)
COUNT_WORD_RE = re.compile(
    r'\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|hundred|two\s+hundred|200|300|100|12|15|17|22)\b[^.!?\n]{0,80}\b(modul|year|surve|facilit|inspect|stud|seat|month|hour|day|element|polic)',
    re.IGNORECASE,
)
CRED_RE = re.compile(
    r'\b(MLS\(ASCP\)(?:CM)?|MT\(ASCP\)|MLT\(ASCP\)|H\(ASCP\)|MD|PhD|MS|MBA|CPHQ|DLM|DABCC|FACMG[G]?|FADLM|MASCP|CQA|CQIA|CLC|CQM|CPC|MHA|DCLS|NRCC)\b',
)
# Brand mentions only: require Verita name to be followed by ™ or in a
# user-text context (quoted string, or h1/h2/h3 inner text). Excludes
# React component identifiers like "VeritaCheckPage" / "VeritaMapAppPage"
# by requiring the name NOT to be followed by "Page" or similar
# component-name suffixes.
VERITA_RE = re.compile(r'\b(Verita[A-Z][A-Za-z]+?)(?=™|™|"|\'|\)|\]|\s|,|\.|<|>|/|$)(?!Page|App|Build|Snap|Map|Compliance|My|Finding|Resources|Labwide|Verification|Daily|Inventory|Staffing|PI|Scan)')
NUMBER_NEAR_LABEL_RE = re.compile(r'value:\s*"([^"]+)"[^}]*label:\s*"([^"]+)"')


def strip_comments_for_dash_check(text: str) -> str:
    """Drop // comment lines and /* */ blocks so em-dash check doesn't
    flag code comments. Keeps everything else byte-aligned-ish."""
    # Remove /* ... */
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    # Drop full-line // comments
    out_lines = []
    for line in text.splitlines():
        if re.match(r'^\s*//', line):
            out_lines.append("")
        else:
            # strip trailing // ...
            out_lines.append(re.sub(r'(?:[^"\']|".*?"|\'.*?\')*?//.*$', lambda m: re.sub(r'//.*$', '', m.group(0)), line, count=1) if "//" in line else line)
    return "\n".join(out_lines)


def extract_page(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    rec: dict = {
        "file": path.name,
        "lines": text.count("\n") + 1,
    }

    # SEO
    m = USESEO_RE.search(text)
    if m:
        rec["seo_title"] = m.group(1)
        rec["seo_description"] = m.group(2) or ""
    else:
        rec["seo_title"] = ""
        rec["seo_description"] = ""

    # Headings
    rec["headings"] = []
    for tag, inner in H_TAG_RE.findall(text):
        flat = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", inner)).strip()
        if flat and len(flat) < 250:
            rec["headings"].append({"tag": tag, "text": flat})

    # Stat panels  { value: "...", label: "..." }
    rec["stats"] = []
    for v, l in NUMBER_NEAR_LABEL_RE.findall(text):
        if 1 <= len(v) <= 30 and 1 <= len(l) <= 60:
            rec["stats"].append({"value": v, "label": l})

    # Count claims that look like factual claims
    rec["count_claims"] = []
    for m in COUNT_WORD_RE.finditer(text):
        ctx = text[max(0, m.start() - 30):m.end() + 30]
        # Skip lines that are clearly code comments
        line_start = text.rfind("\n", 0, m.start()) + 1
        line = text[line_start:text.find("\n", m.end())]
        if COMMENT_LINE_RE.match(line):
            continue
        rec["count_claims"].append(re.sub(r"\s+", " ", ctx).strip())

    # Pricing strings
    rec["pricing_mentions"] = sorted(set(DOLLAR_RE.findall(text)))

    # Credentials
    rec["credentials"] = sorted(set(CRED_RE.findall(text)))

    # Module names
    rec["module_mentions"] = sorted(set(VERITA_RE.findall(text)))

    # Internal + external links
    internal: set = set()
    external: set = set()
    for href in HREF_RE.findall(text):
        if href.startswith("/"):
            # ignore template variables
            if "{" not in href and "${" not in href:
                internal.add(href.split("#")[0].split("?")[0])
        elif href.startswith("http"):
            external.add(href.split("#")[0])
    for href in LINK_TO_RE.findall(text):
        if href.startswith("/") and "{" not in href:
            internal.add(href)
    rec["internal_links"] = sorted(internal)
    rec["external_links"] = sorted(external)

    # TODOs in comments
    rec["todos"] = [m.group(0).strip() for m in TODO_RE.finditer(text)]

    # Em-dashes outside comments
    rec["em_dashes_outside_comments"] = []
    stripped = strip_comments_for_dash_check(text)
    for m in EM_DASH_RE.finditer(stripped):
        snippet = re.sub(r"\s+", " ", m.group(0)).strip()
        # Filter "—" used purely as a string literal placeholder ("—" or '—')
        if re.fullmatch(r'["\']—["\']', snippet) or '"—"' in snippet or "'—'" in snippet:
            rec["em_dashes_outside_comments"].append({"snippet": snippet, "kind": "literal-placeholder"})
        else:
            rec["em_dashes_outside_comments"].append({"snippet": snippet, "kind": "other"})

    return rec


def main():
    pages = sorted(PAGES_DIR.glob("*.tsx"))
    out = {"pages": [], "summary": {}}
    for p in pages:
        out["pages"].append(extract_page(p))
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Extracted {len(out['pages'])} pages -> {OUT_PATH}")


if __name__ == "__main__":
    main()
