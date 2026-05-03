"""Replace placeholder seed notes with policy/practice-grounded notes.

Each note references the SOP/policy library location, the practice/check
performed, and where evidence is filed. VeritaPolicy is named explicitly
so signoffs link the operator back to the document hub.

Idempotent: only updates rows whose notes start with [SEED-2026-05-03-MODULES].
"""
import argparse
import sqlite3
import sys

PRIOR = "[SEED-2026-05-03-MODULES] prior"
RECENT = "[SEED-2026-05-03-MODULES] most recent"

# Map by category, with task-name overrides where the topic is specific.
# Each value is a tuple: (prior_note, recent_note).
# Prior = older signoff (within action plan); Recent = current cycle close-out.

CATEGORY_NOTES = {
    "QC Review": (
        "Reviewed prior month Levey-Jennings charts per QC SOP (VeritaPolicy: QC Review Policy QA-QC-001). Two 1-2s warnings on shift change, no rule violations requiring corrective action. Charts initialed and filed in QC binder.",
        "Monthly QC review complete per VeritaPolicy QA-QC-001. Westgard rules evaluated, no out-of-control events this cycle. Bias and CV trended within manufacturer claims. Documentation filed in QC binder and scanned to shared drive.",
    ),
    "Quality Assessment": (
        "Prior PT event reviewed per Proficiency Testing Policy (VeritaPolicy: QA-PT-002). All graded analytes within acceptable range. Investigation log reviewed for any unsuccessful results, none open. Records retained 2 years per CLIA.",
        "Current PT cycle closed per VeritaPolicy QA-PT-002. Director attestation signed, no PT referral, no result alteration. Remediation tracker reviewed and clean. Files staged for COLA on-site review.",
    ),
    "Policy Review": (
        "Prior biennial SOP review completed per Document Control Policy (VeritaPolicy: DOC-001). Redlines incorporated, version stamped, training acknowledgment captured for affected staff.",
        "Biennial SOP review signed by laboratory director per VeritaPolicy DOC-001. Effective date and revision number updated. Superseded copy archived; current copy in active SOP binder and intranet.",
    ),
    "Calibration Verification": (
        "Prior CalVer/CVR run per Calibration Verification Policy (VeritaPolicy: ANA-CALVER-001). Three levels spanning AMR, results inside +/-10% acceptance. Records filed with method validation packet.",
        "Calibration verification current per VeritaPolicy ANA-CALVER-001. Six-month interval met, AMR re-established, exception report empty. Documentation filed with reagent lot records.",
    ),
    "Correlation": (
        "Prior method correlation per Method Comparison Policy (VeritaPolicy: ANA-CORR-001). Bias within total allowable error budget; Bland-Altman reviewed.",
        "Semi-annual correlation closed per VeritaPolicy ANA-CORR-001. Paired analyzer comparison passing across clinical decision points. Investigation memo retained with QM file.",
    ),
    "Precision Verification": (
        "Prior precision study reviewed per Performance Verification Policy (VeritaPolicy: ANA-PERF-001). Within-run and between-run CV inside manufacturer claim.",
        "Precision verification current per VeritaPolicy ANA-PERF-001. Twenty-replicate study repeated at two levels, statistics retained with validation binder.",
    ),
    "Equipment Calibration": (
        "Prior equipment calibration per Equipment Management Policy (VeritaPolicy: EQ-CAL-001). NIST-traceable standards used, deviation within tolerance, sticker updated.",
        "Calibration current per VeritaPolicy EQ-CAL-001. Service tag posted on instrument, certificate filed in equipment folder, next-due date scheduled.",
    ),
    "Daily Checks": (
        "Prior temperature log reviewed per Storage Monitoring Policy (VeritaPolicy: EQ-TEMP-001). All readings inside acceptable range; one excursion documented with corrective action.",
        "Daily temperature checks current per VeritaPolicy EQ-TEMP-001. Min/max captured, alarm function tested, log countersigned by supervisor.",
    ),
    "Blood Bank Alarm Checks": (
        "Prior alarm test per Blood Bank Storage Policy (VeritaPolicy: BB-ALARM-001) and AABB Standards. Audible and visual alarm verified at high and low set points.",
        "Quarterly alarm test current per VeritaPolicy BB-ALARM-001. Independent thermometer used, response time logged, calibration label updated. Record filed in blood bank QA binder.",
    ),
    "Water Contamination": (
        "Prior water testing per Reagent Water Quality Policy (VeritaPolicy: SUP-H2O-001) and CLSI GP40. Conductivity and microbial limits met.",
        "Water quality current per VeritaPolicy SUP-H2O-001. CLRW specification verified, system maintenance log countersigned. Out-of-spec response plan reviewed with staff.",
    ),
    "Safety": (
        "Prior safety drill per Laboratory Safety Plan (VeritaPolicy: SAF-001). Eyewash flushed weekly, fire extinguisher tags current, MSDS index audited.",
        "Safety inspection closed per VeritaPolicy SAF-001. Chemical hygiene plan reviewed with staff. Findings logged on safety dashboard, no open corrective actions.",
    ),
    "HIPAA": (
        "Prior HIPAA refresher per Privacy and Security Policy (VeritaPolicy: COMP-HIPAA-001). Workforce attestations on file, training matrix current.",
        "Annual HIPAA training closed per VeritaPolicy COMP-HIPAA-001. Quiz scores retained, breach response plan reviewed, BAAs verified current.",
    ),
    "Bloodborne Pathogen": (
        "Prior BBP refresher per Exposure Control Plan (VeritaPolicy: SAF-BBP-001) per OSHA 29 CFR 1910.1030. Hepatitis B status documented.",
        "Annual BBP training closed per VeritaPolicy SAF-BBP-001. Sharps log reviewed, PPE inventory verified, post-exposure protocol re-affirmed.",
    ),
    "Competency": (
        "Prior competency assessment per Competency Assessment Policy (VeritaPolicy: HR-COMP-001). All six CLIA elements evaluated; remediation tracked where needed.",
        "Annual competency closed per VeritaPolicy HR-COMP-001. Records signed by technical consultant; assessor qualifications attached; due dates rolled forward.",
    ),
    "Inventory": (
        "Prior inventory reconciliation per Reagent Management Policy (VeritaPolicy: SUP-INV-001). Lot-to-lot validation logged, expired stock removed.",
        "Inventory cycle count closed per VeritaPolicy SUP-INV-001. Par levels reset, vendor reorder triggered, cold-chain receiving log reviewed.",
    ),
    "Vendor Management": (
        "Prior vendor performance review per Procurement and Vendor Policy (VeritaPolicy: SUP-VEND-001). Service tickets, response times, and CAPA closure tracked.",
        "Vendor scorecard updated per VeritaPolicy SUP-VEND-001. Recall notices reconciled, contracts confirmed current, performance discussed at QM meeting.",
    ),
}

# Specific overrides keyed by task name (override the category default).
TASK_OVERRIDES = {
    "Levey-Jennings Chart Review": (
        "Prior LJ chart review per QC Review Policy (VeritaPolicy: QA-QC-001). Westgard 1-3s, 2-2s, R-4s, 4-1s evaluated; no run rejected.",
        "LJ charts countersigned per VeritaPolicy QA-QC-001. Mean and SD compared to peer group, shift/trend analysis clean.",
    ),
    "Critical Value Read-Back Audit": (
        "Prior critical value read-back audit per Communication of Critical Results Policy (VeritaPolicy: PRE-CRIT-001) and TJC NPSG.02.03.01. Read-back compliance >95%.",
        "Quarterly read-back audit closed per VeritaPolicy PRE-CRIT-001. Sample of calls reviewed, gaps coached, dashboard updated.",
    ),
    "Refrigerator/Freezer Temperature Log Review": (
        "Prior temperature log review per Storage Monitoring Policy (VeritaPolicy: EQ-TEMP-001). Excursions investigated; product impact assessment retained.",
        "Daily temperature logs reviewed per VeritaPolicy EQ-TEMP-001. Continuous monitoring data archived, alarm tests current.",
    ),
    "Eyewash Station Inspection": (
        "Prior weekly eyewash flush per Laboratory Safety Plan (VeritaPolicy: SAF-001) and ANSI Z358.1. Flow and water clarity verified, tag initialed.",
        "Weekly eyewash inspection current per VeritaPolicy SAF-001. Annual full activation test on schedule; documentation in safety binder.",
    ),
    "Fire and Emergency Preparedness Training": (
        "Prior fire and emergency drill per Emergency Preparedness Policy (VeritaPolicy: SAF-EMER-001). Evacuation route confirmed, extinguisher use rehearsed.",
        "Annual emergency preparedness training closed per VeritaPolicy SAF-EMER-001. After-action notes filed; gaps assigned to safety officer.",
    ),
    "Chemical Hygiene / Hazard Communication Training": (
        "Prior chemical hygiene refresher per Chemical Hygiene Plan (VeritaPolicy: SAF-CHP-001) and OSHA 29 CFR 1910.1450. SDS index audited.",
        "HazCom training closed per VeritaPolicy SAF-CHP-001. Labeling, secondary container, and pictogram review documented.",
    ),
    "Pipette Calibration": (
        "Prior pipette calibration per Pipette Management Policy (VeritaPolicy: EQ-PIP-001). Gravimetric verification at low/mid/high volume within ISO 8655 limits.",
        "Pipette calibration current per VeritaPolicy EQ-PIP-001. Vendor certificate filed; instrument tag and inventory list updated.",
    ),
    "Thermometer Calibration": (
        "Prior thermometer verification per Equipment Management Policy (VeritaPolicy: EQ-CAL-001). NIST-traceable reference compared, offset documented.",
        "Annual thermometer verification current per VeritaPolicy EQ-CAL-001. Offset card placed on each unit; due dates tracked in equipment registry.",
    ),
    "Centrifuge RPM Verification": (
        "Prior centrifuge tachometer check per Equipment Management Policy (VeritaPolicy: EQ-CAL-001). RPM within +/-5%; brushes and gaskets inspected.",
        "Centrifuge verification current per VeritaPolicy EQ-CAL-001. Preventive maintenance log countersigned; certificate retained in equipment folder.",
    ),
    "Timer Verification": (
        "Prior timer accuracy check per Equipment Management Policy (VeritaPolicy: EQ-CAL-001). Verified against NIST time source, deviation within 1 second per minute.",
        "Timer verification current per VeritaPolicy EQ-CAL-001. Labels updated, results filed with equipment binder.",
    ),
    "Timer calibration ": (
        "Prior timer calibration per Equipment Management Policy (VeritaPolicy: EQ-CAL-001). Verified against NIST time source.",
        "Timer calibration current per VeritaPolicy EQ-CAL-001. Documentation filed in equipment binder.",
    ),
    "Reagent Inventory Reconciliation": (
        "Prior reagent reconciliation per Reagent Management Policy (VeritaPolicy: SUP-INV-001). Lot numbers, expiration dates, and storage conditions verified.",
        "Reagent reconciliation current per VeritaPolicy SUP-INV-001. Cold-chain log clean, expired stock removed and documented.",
    ),
    "Vendor Performance Review": (
        "Prior vendor scorecard reviewed per Procurement and Vendor Policy (VeritaPolicy: SUP-VEND-001). Open service tickets and CAPA tracked.",
        "Vendor performance review closed per VeritaPolicy SUP-VEND-001. Discussion captured in QM meeting minutes.",
    ),
    "Competency Assessment - Annual (all staff)": (
        "Prior annual competency window per Competency Assessment Policy (VeritaPolicy: HR-COMP-001). All six CLIA elements evaluated for testing personnel.",
        "Annual competency cycle closed per VeritaPolicy HR-COMP-001. Director attestation on file; remediation actions tracked.",
    ),
}


def note_for(category: str, name: str) -> tuple[str, str]:
    if name in TASK_OVERRIDES:
        return TASK_OVERRIDES[name]
    if category in CATEGORY_NOTES:
        return CATEGORY_NOTES[category]
    # Fallback - generic but still policy-grounded.
    return (
        f"Prior signoff for {name} reviewed per applicable laboratory SOP (VeritaPolicy library). Records retained per CLIA documentation requirements.",
        f"{name} signoff current per applicable laboratory SOP (VeritaPolicy library). Documentation filed and available for surveyor review.",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("db", help="Path to SQLite DB")
    parser.add_argument("--user-id", type=int, default=17)
    parser.add_argument("--apply", action="store_true", help="Apply updates")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys=ON")
    cur = conn.cursor()

    cur.execute(
        "SELECT id, name, category FROM veritatrack_tasks WHERE user_id=?",
        (args.user_id,),
    )
    tasks = {row[0]: (row[1], row[2]) for row in cur.fetchall()}

    cur.execute(
        "SELECT id, task_id, notes FROM veritatrack_signoffs WHERE user_id=? ORDER BY task_id, completed_date",
        (args.user_id,),
    )
    rows = cur.fetchall()
    updates = []
    for sid, tid, note in rows:
        if not note or not note.startswith("[SEED-2026-05-03-MODULES]"):
            continue
        meta = tasks.get(tid)
        if not meta:
            continue
        name, category = meta
        prior_text, recent_text = note_for(category, name)
        if "prior" in note:
            new_note = prior_text
        elif "most recent" in note:
            new_note = recent_text
        else:
            new_note = recent_text
        # Em-dash ban + exclamation ban + apologies ban (defensive).
        for bad in ("\u2014", "\u2013", "!"):
            assert bad not in new_note, f"forbidden char in note: {new_note!r}"
        updates.append((new_note, sid))

    print(f"Will update {len(updates)} signoffs")
    if not args.apply:
        # Show 3 samples
        for n, sid in updates[:3]:
            print(f"  id={sid}: {n}")
        return 0

    cur.executemany("UPDATE veritatrack_signoffs SET notes=? WHERE id=?", updates)
    conn.commit()
    print("Applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
