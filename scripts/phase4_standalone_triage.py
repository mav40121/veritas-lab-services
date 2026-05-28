"""
Phase 4 standalone-template triage report.

Walks the 43 standalone (non-combined) policy templates and produces a
markdown report ranked by thinness, with a recommendation per template.
Categories:

  - ENRICH: universal applicability + content score <=15. Worth bringing to
    the depth of the enriched combineds (~30+).
  - REVIEW: moderate applicability or moderate thinness. Director call.
  - SPECIALTY: very narrow scope (e.g. radioactive tissue, EM safety).
    Most labs will mark N/A. Lower priority for enrichment.
  - OK: score >=20. Already in good shape.

Output:
  scripts/Phase4_Standalone_Triage.md
  C:\\Users\\veril\\OneDrive\\Desktop\\Lab\\Verita Products\\Phase4_Standalone_Triage.md
"""
import json, os, re, shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "server" / "policyTemplates" / "data"
ML   = REPO / "server" / "veritapolicyMasterList.ts"
OUT  = REPO / "scripts" / "Phase4_Standalone_Triage.md"
DESK = Path(r"C:\Users\veril\OneDrive\Desktop\Lab\Verita Products\Phase4_Standalone_Triage.md")

# Editorial classification per template ID. Based on subspecialty scope and
# how many real-world labs would actually use it.
SPECIALTY_TAGS = {
    "5":   ("OK",  "Universal: every lab collects specimens."),
    "7":   ("SPECIALTY", "Narrow: only labs offering maternal-serum-marker screening."),
    "8":   ("OK",  "Universal: every lab identifies specimens."),
    "10":  ("OK",  "Universal: every lab has system downtime."),
    "11":  ("OK",  "Universal: every lab reports critical values."),
    "12":  ("OK",  "Universal: every lab retains records."),
    "13":  ("OK",  "Universal: handoff communication is TJC standard."),
    "14":  ("REVIEW", "Hospital-based labs more than reference labs."),
    "15":  ("OK",  "Universal: environment of care applies broadly."),
    "16":  ("SPECIALTY", "Narrow: only labs handling radioactive materials."),
    "24":  ("OK",  "Universal: LIS downtime applies broadly."),
    "28":  ("OK",  "Universal: LIS validation/verification."),
    "33":  ("OK",  "Universal: PT enrollment per 42 CFR 493.801."),
    "34":  ("OK",  "Universal: performance improvement plan."),
    "35":  ("OK",  "Universal: QC plan per 42 CFR 493.1256."),
    "36":  ("OK",  "Universal: method verification per 42 CFR 493.1253."),
    "37":  ("OK",  "Universal: corrective action."),
    "38":  ("OK",  "Universal: reagent management."),
    "39":  ("OK", "Enriched Phase 4 (was ENRICH at score 10, now ~33). Universal reagent/solution labeling."),
    "40":  ("REVIEW", "Microbiology subspecialty — moderate applicability."),
    "66":  ("OK", "Enriched Phase 4 (was ENRICH at score 9, now ~38). Universal manual hematology QC."),
    "67":  ("REVIEW", "Coagulation testing — moderate applicability."),
    "68":  ("SPECIALTY", "Very narrow: HLA / histocompatibility labs only."),
    "69":  ("SPECIALTY", "Very narrow: apheresis labs only."),
    "70":  ("REVIEW", "Anatomic pathology / surgical specimen labs."),
    "71":  ("SPECIALTY", "Very narrow: labs handling radioactive tissue."),
    "72":  ("SPECIALTY", "Very narrow: EM (electron microscope) labs only."),
    "73":  ("REVIEW", "Anatomic pathology QMP — moderate applicability."),
    "74":  ("SPECIALTY", "Very narrow: Mohs surgery / dermatopathology."),
    "78":  ("SPECIALTY", "Narrow: parasitology shops."),
    "79":  ("SPECIALTY", "Very narrow: radiobioassay QC."),
    "80":  ("REVIEW", "Virology QC — moderate applicability (molecular/micro)."),
    "81":  ("OK", "Universal: sentinel event."),
    "82":  ("REVIEW", "Will be merged into combined #111 (HCT/P) — leave alone."),
    "83":  ("REVIEW", "Will be merged into combined #111 (HCT/P) — leave alone."),
    "84":  ("REVIEW", "Will be merged into combined #111 (HCT/P) — leave alone."),
    "85":  ("REVIEW", "Will be merged into combined #106 (Waived/POCT) — leave alone."),
    "86":  ("REVIEW", "Will be merged into combined #106 — leave alone."),
    "87":  ("REVIEW", "Will be merged into combined #106 — leave alone."),
    "88":  ("REVIEW", "Will be merged into combined #106 — leave alone."),
    "89":  ("OK",  "Universal: cybersecurity incident response."),
    "90":  ("OK",  "Universal: specimen rejection criteria."),
    "95":  ("OK",  "Universal: internal audit."),
    "96":  ("OK",  "Universal: reference lab selection."),
    "2":   ("OK",  "Universal: public concern reporting (TJC standard)."),
    "1":   ("OK",  "Universal: accreditation body notification."),
    "3":   ("OK",  "Universal: non-retaliation / whistleblower."),
    "4":   ("OK",  "Universal: unsuccessful PT response."),
    "6":   ("OK",  "Universal: test ordering."),
    "9":   ("OK",  "Universal: results reporting."),
    "18":  ("OK",  "Will be merged into combined #104 — leave alone."),
    "19":  ("OK",  "Will be merged into combined #104 — leave alone."),
    "20":  ("OK",  "Will be merged into combined #104 — leave alone."),
    "21":  ("OK",  "1:1 → combined #105 — leave alone."),
    "22":  ("OK",  "Will be merged into combined #110 — leave alone."),
    "23":  ("OK",  "Will be merged into combined #110 — leave alone."),
    "25":  ("OK",  "Will be merged into combined #108 — leave alone."),
    "26":  ("OK",  "Will be merged into combined #108 — leave alone."),
    "27":  ("OK",  "Will be merged into combined #108 — leave alone."),
    "29":  ("OK",  "Will be merged into combined #109 — leave alone."),
    "30":  ("OK",  "Will be merged into combined #109 — leave alone."),
    "31":  ("OK",  "Will be merged into combined #109 — leave alone."),
    "32":  ("OK",  "Will be merged into combined #109 — leave alone."),
}


def load_master_ids():
    text = ML.read_text(encoding="utf-8")
    m = re.search(r"export const VERITAPOLICY_MASTER_LIST:[^=]*=\s*(\[[\s\S]*?\]);\s*$", text, re.MULTILINE)
    if not m:
        raise RuntimeError("Could not parse master list")
    rows = json.loads(m.group(1))
    combined_ids = {str(i) for i in range(97, 112)}
    return [r for r in rows if r["policy_id"] not in combined_ids], rows


def find_template(pid):
    padded = str(pid).zfill(3)
    for fn in os.listdir(DATA):
        if fn.startswith(padded + "_") and fn.endswith(".json"):
            return DATA / fn
    return None


def score_template(p):
    fp = find_template(p["policy_id"])
    if not fp: return None
    t = json.loads(fp.read_text(encoding="utf-8"))
    s  = len(t.get("policy_statements", []))
    st = len(t.get("procedure_steps", []))
    d  = len(t.get("definitions", []))
    c  = len(t.get("cfr_text_blocks", []))
    return {
        "policy_id": p["policy_id"],
        "policy_name": p["policy_name"],
        "section": p.get("section", ""),
        "subspecialty": p.get("subspecialty", "") or "—",
        "statements": s, "steps": st, "defs": d, "cfr_blocks": c,
        "score": s + st + d + c,
    }


def main():
    standalones, _ = load_master_ids()
    rows = [score_template(p) for p in standalones]
    rows = [r for r in rows if r is not None]
    rows.sort(key=lambda r: r["score"])

    enrich_rows = []
    review_rows = []
    specialty_rows = []
    ok_rows = []
    for r in rows:
        tag, note = SPECIALTY_TAGS.get(r["policy_id"], ("REVIEW", "Not classified."))
        r["tag"] = tag
        r["note"] = note
        if tag == "ENRICH": enrich_rows.append(r)
        elif tag == "SPECIALTY": specialty_rows.append(r)
        elif tag == "REVIEW": review_rows.append(r)
        else: ok_rows.append(r)

    def fmt(rows):
        lines = ["| ID | Policy | Subspecialty | Stmts | Steps | Defs | CFR | Score | Note |", "|---|---|---|---|---|---|---|---|---|"]
        for r in rows:
            lines.append(f"| {r['policy_id']} | {r['policy_name']} | {r['subspecialty']} | {r['statements']} | {r['steps']} | {r['defs']} | {r['cfr_blocks']} | {r['score']} | {r['note']} |")
        return "\n".join(lines)

    md_parts = [
        "# Phase 4 Standalone Template Triage",
        "",
        f"Of the {len(rows)} non-combined VeritaPolicy templates, this is a per-template recommendation on enrichment priority. Each is classified ENRICH (worth bringing to combined-template depth), REVIEW (moderate applicability, director call), SPECIALTY (narrow scope, low priority), or OK (already at adequate depth, or already going through a Phase 3 merge into a combined).",
        "",
        "**Median score** (statements + steps + defs + cfr_blocks): " + str(sorted([r["score"] for r in rows])[len(rows)//2]),
        "**Mean score**: " + str(round(sum(r["score"] for r in rows) / len(rows), 1)),
        "",
        "Enriched combineds (#98 etc.) average around score 30-45 after the Phase 3 enrichment pass. Anything here at score 15 or below is meaningfully thinner.",
        "",
    ]

    md_parts.extend(["", f"## ENRICH ({len(enrich_rows)})", "", "Universal-applicability templates that are thin enough to warrant enrichment. Each is ~20 minutes of authoring to bring up to combined depth.", "", fmt(enrich_rows)])
    md_parts.extend(["", f"## REVIEW ({len(review_rows)})", "", "Moderate applicability OR moderate thinness. Director call on which to enrich vs leave.", "", fmt(review_rows)])
    md_parts.extend(["", f"## SPECIALTY ({len(specialty_rows)})", "", "Narrow scope (HLA, EM, radioactive, etc.). Most labs will mark these N/A; enrichment is low priority unless you're actively selling to a specialty lab that uses them.", "", fmt(specialty_rows)])
    md_parts.extend(["", f"## OK ({len(ok_rows)})", "", "Already at adequate depth OR going through Phase 3 merge into a combined (leave as-is).", "", fmt(ok_rows)])

    md_parts.extend(["",
        "## Recommended action",
        "",
        f"1. **Enrich the {len(enrich_rows)} ENRICH rows** as a Phase 4 content pass. ~{len(enrich_rows) * 20} minutes total. Highest leverage.",
        f"2. **Spot-check the {len(review_rows)} REVIEW rows** that are NOT going through Phase 3 merges. Some may upgrade to ENRICH after a read.",
        f"3. **Leave SPECIALTY alone** unless a specialty-lab prospect requests it. They're not adding value to the typical Clinic / Community / Hospital customer.",
        f"4. **Do not touch the OK rows currently routing to a Phase 3 merge** (sources #18, #19, #20, #21, #22, #23, #25-32, #82-88) — they get absorbed into the combined templates, separate work won't survive.",
        "",
    ])

    OUT.write_text("\n".join(md_parts), encoding="utf-8")
    print(f"Wrote {OUT}")
    try:
        DESK.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(OUT, DESK)
        print(f"Copied to {DESK}")
    except Exception as e:
        print(f"Could not copy to desktop: {e}")

    # Summary to stdout
    print()
    print(f"Counts:  ENRICH={len(enrich_rows)}  REVIEW={len(review_rows)}  SPECIALTY={len(specialty_rows)}  OK={len(ok_rows)}")


if __name__ == "__main__":
    main()
