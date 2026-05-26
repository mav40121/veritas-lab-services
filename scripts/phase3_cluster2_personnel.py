"""
Phase 3 Cluster 2: consolidate 9 Personnel policy templates into 3.

  103  Personnel Qualifications        <- 17, 91, 92, 93, 94
  104  Training and Competency         <- 18, 19, 20
  105  Performance Evaluation          <- 21  (1:1 rename for consistency)

Same pattern as phase3_cluster1_transfusion.py: hand-authored combined
templates, mechanical CFR aggregation deduped by citation, source files
moved to deprecated/.

Run:
    python scripts/phase3_cluster2_personnel.py
"""

import json
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR   = REPO_ROOT / "server" / "policyTemplates" / "data"
DEPREC_DIR = DATA_DIR / "deprecated"
DEPREC_DIR.mkdir(exist_ok=True)

CLUSTER_MAP = {
    "103": ["17", "91", "92", "93", "94"],
    "104": ["18", "19", "20"],
    "105": ["21"],
}

COMBINED = {
    "103": {
        "policy_id": "103",
        "slug": "personnel_qualifications",
        "policy_name": "Personnel Qualifications Policy",
        "section": "Personnel",
        "purpose": (
            "This policy defines the qualifications, credential verification, and "
            "responsibilities for every CLIA-defined personnel role at <<LAB_NAME>>: "
            "Laboratory Director, Technical Consultant (where applicable), Technical "
            "Supervisor (high-complexity), General Supervisor (moderate-complexity), "
            "and Testing Personnel. Required by 42 CFR 493 Subpart M (laboratories "
            "performing high complexity testing: 493.1441 through 493.1495) and "
            "Subpart M parallel sections for moderate complexity (493.1361 through "
            "493.1413). Credentials are verified at hire and on a defined "
            "re-verification cadence."
        ),
        "scope": (
            "All <<LAB_NAME>> laboratory personnel and the human resources function "
            "supporting credential verification."
        ),
        "policy_statements": [
            "Every person performing or supervising laboratory testing at <<LAB_NAME>> meets the CLIA qualifications for the role and complexity level they perform, per 42 CFR 493 Subpart M (high complexity) or the parallel moderate-complexity sections.",
            "The Laboratory Director meets the qualifications of 42 CFR 493.1443 (high complexity) or 493.1405 (moderate complexity) and holds responsibility for every test result reported by the laboratory.",
            "The Technical Supervisor (for high-complexity testing) meets 42 CFR 493.1449 and is responsible for technical and scientific oversight of the lab's high-complexity testing.",
            "The General Supervisor (for moderate-complexity testing) meets 42 CFR 493.1461 and is responsible for day-to-day supervision of moderate-complexity testing.",
            "Testing Personnel meet 42 CFR 493.1489 (high complexity) or 493.1423 (moderate complexity) and may perform testing only after orientation and the initial competency assessment is documented (see Training and Competency policy).",
            "Credentials (degree, transcripts, licensure, board certification where applicable) are verified at hire from primary source and retained in the personnel record; the verification is repeated on the lab's defined re-verification cadence (typically at license renewal).",
            "Personnel records (qualifications, position description, signed competency assessments, performance evaluations) are retained per 42 CFR 493.1105 and applicable HR retention policy.",
        ],
        "procedure_steps": [
            "At hire, verify each credential (degree, transcripts, licensure, board certification) from primary source; document the verification in the personnel record.",
            "Map each new hire to the specific CLIA role(s) they will perform; document the role assignment in the position description.",
            "Confirm the Laboratory Director (or designee) has signed off that the new hire meets the CLIA qualifications for the assigned role before testing begins.",
            "Re-verify time-bound credentials (licenses, board certifications) at renewal; flag any lapse.",
            "On any role change (e.g., testing personnel promoted to general supervisor), confirm the new role's CLIA qualifications are met and update the position description.",
        ],
        "definitions": [
            ["High complexity testing", "Testing classified as high complexity by FDA under 42 CFR 493.17; subject to the personnel requirements in 42 CFR 493 Subpart M sections 493.1441 through 493.1495."],
            ["Moderate complexity testing", "Testing classified as moderate complexity by FDA under 42 CFR 493.17; subject to the parallel personnel requirements in 42 CFR 493 sections 493.1361 through 493.1413."],
            ["Primary source verification", "Confirmation of a credential directly from the issuing institution (e.g., university registrar, ASCP for board certification, state for licensure), not from a copy supplied by the candidate."],
        ],
    },
    "104": {
        "policy_id": "104",
        "slug": "training_and_competency",
        "policy_name": "Training and Competency Policy",
        "section": "Personnel",
        "purpose": (
            "This policy describes how <<LAB_NAME>> orients new testing personnel, "
            "delivers continuing education and training, and assesses competency "
            "against the six CLIA-required elements at 42 CFR 493.1235. Cadence is "
            "Initial assessment before unsupervised testing, 6-month re-assessment "
            "during the first year, and Annual assessment thereafter."
        ),
        "scope": (
            "All <<LAB_NAME>> testing personnel, evaluators (Technical Consultants, "
            "Technical Supervisors, General Supervisors as appropriate to "
            "complexity), and the Laboratory Director or designee."
        ),
        "policy_statements": [
            "New testing personnel complete a documented orientation to the lab, the test menu they will perform, the relevant safety and QC procedures, and the lab's documentation expectations before performing unsupervised testing.",
            "Continuing education and training are provided on new test introduction, procedure changes, lessons-learned from incident review, and any change in regulatory or accreditor expectation; participation is documented.",
            "Competency for each test performed is assessed against the six CLIA-required elements at 42 CFR 493.1235: (1) direct observation of routine patient test performance; (2) monitoring the recording and reporting of test results; (3) review of intermediate test results, worksheets, QC, PT, and preventive maintenance; (4) direct observation of instrument maintenance and function checks; (5) assessment of test performance through blind or PT samples; (6) assessment of problem-solving skills.",
            "Initial competency is documented before the tester is released for unsupervised testing; 6-month re-assessment is completed during the first year of performing the test; annual re-assessment is completed every 12 months thereafter.",
            "Evaluator role is enforced by complexity: Technical Supervisor for high-complexity, Technical Consultant for moderate-complexity. The evaluator signs the competency record; the Laboratory Director or designee reviews and signs the final record.",
            "Competency records and orientation/education documentation are retained per 42 CFR 493.1105 and the applicable HR retention policy.",
        ],
        "procedure_steps": [
            "At hire and on assignment to a new test, complete the documented orientation; collect the tester's signed acknowledgment.",
            "Schedule initial competency before the tester is released for unsupervised testing; complete all six CLIA elements; evaluator signs.",
            "Schedule 6-month re-assessment for the first year on the test; document all six elements; evaluator signs.",
            "Schedule annual re-assessment every 12 months thereafter; document all six elements; evaluator signs.",
            "Route the completed competency record to the Laboratory Director or designee for review and signature; file in the personnel record with the configured retention.",
            "Track corrective action for any element where the tester did not meet expectation; document remediation and re-assessment before the tester resumes that activity unsupervised.",
        ],
        "definitions": [
            ["Initial competency", "Documented competency assessment of all six CLIA elements completed before the tester is released for unsupervised testing on a given test."],
            ["6-month re-assessment", "Second competency assessment of all six CLIA elements, completed within 6 months of initial assessment, during the tester's first year on the test."],
            ["Annual re-assessment", "Yearly competency assessment of all six CLIA elements after the first-year cadence is complete."],
            ["Six CLIA elements", "The six required competency-assessment activities at 42 CFR 493.1235: direct observation of testing, recording/reporting monitoring, intermediate-results/QC/PT review, observation of instrument maintenance, blind/PT sample testing, problem-solving."],
        ],
    },
    "105": {
        "policy_id": "105",
        "slug": "performance_evaluation",
        "policy_name": "Staff Performance Evaluation Policy",
        "section": "Personnel",
        "purpose": (
            "This policy describes how <<LAB_NAME>> conducts the HR-side staff "
            "performance evaluation for laboratory personnel: cadence, content, and "
            "documentation. This is distinct from CLIA competency assessment (see the "
            "Training and Competency policy). Required by general HR practice and by "
            "42 CFR 493.1235 references to staff performance review."
        ),
        "scope": (
            "All <<LAB_NAME>> laboratory personnel, their direct supervisors, the "
            "Laboratory Director or designee, and the HR function."
        ),
        "policy_statements": [
            "Every laboratory staff member receives a documented performance evaluation at least annually, conducted by the staff member's direct supervisor and reviewed by the Laboratory Director or designee.",
            "Performance evaluation covers role-based competencies, dependability, communication, teamwork, adherence to lab policies, regulatory compliance behavior, and individual development goals; it is distinct from (and does not substitute for) the CLIA competency assessment.",
            "Performance issues identified in evaluation are documented with a corrective action plan, a follow-up timeline, and the supervisor's signature; HR is engaged when required by policy.",
            "Completed performance evaluations are filed in the personnel record per HR retention policy.",
        ],
        "procedure_steps": [
            "Schedule each staff member's performance evaluation at the annual anniversary of hire (or per the lab's documented cadence).",
            "Conduct the evaluation conversation; document the evaluation form covering all required dimensions; both supervisor and staff member sign.",
            "Route to the Laboratory Director or designee for review and signature.",
            "For any documented performance issue, attach the corrective action plan and follow-up schedule; engage HR per policy.",
            "File the completed evaluation in the personnel record per HR retention.",
        ],
        "definitions": [
            ["Performance evaluation", "HR-driven annual review of a staff member's overall job performance, distinct from CLIA competency assessment which is a per-test technical assessment."],
        ],
    },
}


def aggregate_cfr_blocks(source_files):
    """Dedupe by citation alone (same regulation = same entry)."""
    seen = {}
    order = []
    for fn in source_files:
        with open(fn, "r", encoding="utf-8") as f:
            d = json.load(f)
        for blk in d.get("cfr_text_blocks", []):
            cite = blk.get("citation", "").strip()
            if cite and cite not in seen:
                seen[cite] = blk
                order.append(cite)
    return [seen[k] for k in order]


def main():
    if not DATA_DIR.exists():
        print(f"FATAL: DATA_DIR {DATA_DIR} does not exist", file=sys.stderr)
        sys.exit(1)

    summary = []
    for new_id, src_ids in CLUSTER_MAP.items():
        tmpl = COMBINED[new_id]
        src_paths = []
        for sid in src_ids:
            padded = sid.zfill(3)
            matches = [DATA_DIR / fn for fn in os.listdir(DATA_DIR)
                       if fn.startswith(padded + "_") and fn.endswith(".json")]
            if not matches:
                print(f"WARN: no source file found for ID {sid}")
                continue
            src_paths.append(matches[0])

        cfr_blocks = aggregate_cfr_blocks(src_paths)
        tmpl["cfr_text_blocks"] = cfr_blocks

        out_name = f"{new_id.zfill(3)}_{tmpl['slug']}.json"
        out_path = DATA_DIR / out_name
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(tmpl, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"WROTE {out_name}  ({len(cfr_blocks)} CFR blocks from {len(src_paths)} sources)")

        for sp in src_paths:
            dest = DEPREC_DIR / sp.name
            shutil.move(str(sp), str(dest))
            print(f"   -> moved {sp.name} to deprecated/")

        summary.append((new_id, tmpl["policy_name"], len(src_paths), len(cfr_blocks)))

    print()
    print("=== SUMMARY ===")
    print(f"{'New':<5} {'Name':<50} {'Sources':<8} {'CFR blocks':<10}")
    print("-" * 75)
    for nid, name, n_src, n_cfr in summary:
        print(f"{nid:<5} {name[:48]:<50} {n_src:<8} {n_cfr:<10}")


if __name__ == "__main__":
    main()
