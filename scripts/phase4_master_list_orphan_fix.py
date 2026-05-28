"""
Patch master list rows for #39 + #66 after Phase 4 enrichment added CFR text
blocks not previously advertised. Found by
scripts/verify-veritapolicy-template-integrity.js. Idempotent.
"""
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MASTER_LIST = REPO / "server" / "veritapolicyMasterList.ts"

ADD = {
    "39":  ["29 CFR 1910.1200", "42 CFR 493.1105"],
    "66":  ["42 CFR 493.1252", "42 CFR 493.927", "29 CFR 1910.1030"],
}


def main():
    text = MASTER_LIST.read_text(encoding="utf-8")
    m = re.search(r"(export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*)\[(.*)\];\s*$", text, re.DOTALL)
    if not m:
        print("FATAL: could not locate master list", file=sys.stderr); sys.exit(1)
    header, body = m.group(1), m.group(2)
    rows = json.loads("[" + body + "]")
    changes = 0
    for r in rows:
        pid = r["policy_id"]
        if pid not in ADD: continue
        existing = [c.strip() for c in (r.get("cfr_citations") or "").split(";") if c.strip()]
        for new in ADD[pid]:
            if new not in existing:
                existing.append(new)
                print(f"  #{pid}: + {new}")
                changes += 1
        r["cfr_citations"] = "; ".join(existing)
    if not changes:
        print("Nothing to add."); return
    keys = ["policy_id","policy_name","section","subspecialty","service_line",
            "description","cfr_citations","tjc_citations","cap_citations",
            "cola_citations","aabb_citations","notes"]
    def ser(r):
        return "  {\n" + ",\n".join(f'    "{k}": {json.dumps(r[k], ensure_ascii=False)}' for k in keys if k in r) + "\n  }"
    body_out = ",\n".join(ser(r) for r in rows)
    MASTER_LIST.write_text(header + "[\n" + body_out + "\n];\n", encoding="utf-8")
    print(f"Wrote {MASTER_LIST}  ({changes} citations added)")


if __name__ == "__main__":
    main()
