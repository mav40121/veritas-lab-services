"""
Phase 3 Clusters 3-8: consolidate 19 source policies into 6 combined policies.

Batched into one script since each individual cluster has only 2-4 sources
and separate scripts would be repetitive overhead.

  106  Waived and Point-of-Care Testing            <- 85, 86, 87, 88     (Cluster 3)
  107  Molecular Testing                           <- 75, 76, 77         (Cluster 4)
  108  Health Information Management               <- 25, 26, 27         (Cluster 5)
  109  Laboratory Governance and Leadership        <- 29, 30, 31, 32     (Cluster 6)
  110  Infection Prevention and Standard Precautions <- 22, 23           (Cluster 7)
  111  Human Cells, Tissues, and HCT/Ps            <- 82, 83, 84         (Cluster 8)

Notes:
  - Cluster 5 has 2 sources that STAY standalone (#24 LIS Downtime and #89
    Cybersecurity Incident); only #25 + #26 + #27 merge.
  - All other clusters merge every listed source.
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
    "106": ["85", "86", "87", "88"],
    "107": ["75", "76", "77"],
    "108": ["25", "26", "27"],
    "109": ["29", "30", "31", "32"],
    "110": ["22", "23"],
    "111": ["82", "83", "84"],
}

COMBINED = {
    "106": {
        "policy_id": "106",
        "slug": "waived_and_point_of_care_testing",
        "policy_name": "Waived and Point-of-Care Testing Policy",
        "section": "Testing",
        "purpose": (
            "This policy describes how <<LAB_NAME>> conducts waived and point-of-care "
            "(POC) testing: scope of waived tests offered, manufacturer-prescribed "
            "quality control, testing personnel competency, and oversight by the "
            "laboratory's CLIA director. Required by 42 CFR 493.15 (waived tests), "
            "42 CFR 493.1235 (competency for all personnel), and 42 CFR 493.1256 "
            "(QC for non-waived; waived QC follows manufacturer)."
        ),
        "scope": (
            "All <<LAB_NAME>> personnel performing waived or POC tests, the "
            "Laboratory Director or designee, and the POC oversight role."
        ),
        "policy_statements": [
            "Waived testing is performed strictly per the manufacturer's instructions; deviation from the package insert reclassifies the test as non-waived.",
            "Manufacturer-required QC is performed on each new lot, on each new shipment, after each instrument service event, and at the manufacturer's prescribed frequency; QC failures bar patient testing until resolved.",
            "Every person performing waived testing receives a documented orientation to the specific test and to the lab's QC and result-reporting expectations before testing patients.",
            "Competency for waived testing is assessed on the same Initial / 6-month / Annual cadence as non-waived, against the six CLIA elements at 42 CFR 493.1235 (a streamlined six-element form is acceptable).",
            "POC testing across the facility (in any clinic, ED, ICU, or off-site location) is centrally overseen by <<LAB_NAME>>; sites are inventoried, QC results aggregated, and competency tracked centrally.",
            "Records (QC, competency, training, lot tracking) are retained per 42 CFR 493.1105 and on the per-test retention schedule.",
        ],
        "procedure_steps": [
            "On new waived test or new POC site, register the test/site in the central oversight inventory; assign the responsible POC coordinator.",
            "Verify each testing site has current manufacturer's instructions, in-date reagents, and a documented operator list.",
            "Run the manufacturer-required QC at every required event; document and review; remediate any failure before resuming patient testing.",
            "Run Initial / 6-month / Annual competency assessment for every waived-test operator using the six-element form; evaluator signs.",
            "Aggregate QC and competency results centrally for the Laboratory Director or designee's monthly review.",
            "Audit each POC site annually; document findings and corrective action plan.",
        ],
        "definitions": [
            ["Waived test", "Test categorized as waived by FDA under CLIA per 42 CFR 493.17, indicating simple methodology with negligible risk of erroneous result when used per manufacturer instructions."],
            ["Point-of-care testing", "Testing performed at or near the patient (bedside, clinic exam room, ED, ICU) rather than in the central laboratory. POC tests are often waived but not exclusively."],
            ["POC coordinator", "Designated role responsible for inventory, QC, competency, and oversight of POC testing across all sites under the lab's CLIA certificate."],
        ],
    },
    "107": {
        "policy_id": "107",
        "slug": "molecular_testing",
        "policy_name": "Molecular Testing Policy",
        "section": "Testing",
        "purpose": (
            "This policy describes how <<LAB_NAME>> performs molecular testing: "
            "method verification, quality control specific to molecular methods, and "
            "the additional requirements for molecular genetic testing. Required by "
            "42 CFR 493.1253(b)(2) (verification of performance specifications), "
            "42 CFR 493.1256(d) (QC), and 42 CFR 493.1276(a) (cytogenetics and "
            "molecular pathology specialty requirements)."
        ),
        "scope": (
            "All <<LAB_NAME>> personnel performing molecular testing, the Technical "
            "Supervisor for high-complexity molecular work, and the Laboratory "
            "Director or designee."
        ),
        "policy_statements": [
            "Every molecular test is verified for performance specifications before patient use: accuracy, precision, reportable range, reference interval (where applicable), and analytical sensitivity / specificity per 42 CFR 493.1253(b)(2).",
            "Molecular QC includes positive control, negative control, and (where applicable) internal amplification control on each run; QC failures bar patient result reporting until resolved.",
            "Molecular genetic testing (germline or somatic) follows the additional requirements of 42 CFR 493.1276 including documented test methodology, clinical and analytical performance characteristics, and report interpretation guidance.",
            "Contamination prevention (unidirectional workflow, dedicated equipment, periodic decontamination) is documented and audited for amplification-based molecular methods.",
            "Molecular results requiring clinical interpretation include a signed interpretive comment from the Laboratory Director or designee where the assay type and clinical context warrant.",
            "Records (verification, QC, lot tracking, interpretation, sign-out) are retained per 42 CFR 493.1105 with the longer retention applicable to genetic test results.",
        ],
        "procedure_steps": [
            "Before a new molecular assay goes live, complete the verification study (accuracy, precision, reportable range, reference interval, sensitivity / specificity); document and sign.",
            "Run positive, negative, and internal-amplification controls on every assay run; review QC against acceptance criteria; document.",
            "For genetic testing, follow the documented test methodology; include interpretive guidance and limitations in the final report.",
            "Audit contamination-prevention practices on the documented cadence; document findings.",
            "Route genetic-test reports to the Laboratory Director or designee for interpretive sign-out as defined by the assay's standing rule.",
            "File verification, QC, lot, and reporting records per the applicable retention schedule.",
        ],
        "definitions": [
            ["Molecular genetic testing", "Testing of nucleic acids for germline or somatic variants; subject to additional requirements at 42 CFR 493.1276 beyond general molecular QC."],
            ["Internal amplification control", "A control built into the reaction (separate template or co-amplified sequence) confirming the reaction chemistry worked even when the patient analyte is undetectable."],
        ],
    },
    "108": {
        "policy_id": "108",
        "slug": "health_information_management",
        "policy_name": "Health Information Management Policy",
        "section": "Information Systems",
        "purpose": (
            "This policy describes how <<LAB_NAME>> manages health information: "
            "privacy under HIPAA, security (administrative, physical, technical "
            "safeguards), and data capture, transmission, and retention. Required by "
            "42 CFR 493.1231 (confidentiality of patient information), 42 CFR "
            "493.1283 (test records), and 45 CFR Part 164 Subparts C and E (HIPAA "
            "Security and Privacy Rules). LIS downtime and cybersecurity incident "
            "response remain separate standalone policies."
        ),
        "scope": (
            "All <<LAB_NAME>> personnel handling patient health information, the "
            "Privacy Officer, the Security Officer, the IT function, and the "
            "Laboratory Director or designee."
        ),
        "policy_statements": [
            "Patient health information is treated as confidential per HIPAA Privacy Rule (45 CFR 164 Subpart E) and per 42 CFR 493.1231; access is limited to those with a documented need-to-know.",
            "Administrative, physical, and technical safeguards required by HIPAA Security Rule (45 CFR 164 Subpart C) are implemented and documented: access control, audit controls, integrity controls, transmission security.",
            "Test results are transmitted only through validated, encrypted channels (LIS interfaces, secure messaging); unsolicited transmission of PHI via unencrypted email is prohibited.",
            "Result records are retained per 42 CFR 493.1105 (typically 2 years for non-immunohematology results, 10 years for immunohematology, 5 years for cytology, 10 years for pathology) and the lab's HIPAA-aligned retention policy.",
            "Patient access to their own information follows the HIPAA Privacy Rule access provisions; the lab's documented procedure routes requests to the Privacy Officer for response within the regulatory timeframe.",
            "Breaches of unsecured PHI follow the Breach Notification Rule (45 CFR 164.402 onward) and the lab's documented breach-response procedure (which includes coordination with the LIS Downtime policy when applicable and the Cybersecurity Incident Response policy for security incidents).",
        ],
        "procedure_steps": [
            "At hire, every staff member completes HIPAA training; training is repeated at the lab's documented cadence and is documented in the personnel record.",
            "Workforce access to the LIS and other PHI systems is granted on a need-to-know basis and is periodically reviewed; terminated staff lose access on the day of termination.",
            "All transmission of PHI uses validated, encrypted channels; the IT function maintains the list of approved channels and audits actual usage.",
            "Records retention follows the documented schedule; secure destruction at end of retention follows the documented procedure.",
            "On a suspected privacy or security event, the Privacy or Security Officer is notified within the documented timeframe; the breach-response procedure determines whether the Breach Notification Rule applies.",
            "Audit the HIPAA safeguards (administrative, physical, technical) annually; document findings and corrective action.",
        ],
        "definitions": [
            ["PHI", "Protected Health Information; individually identifiable health information held or transmitted by a HIPAA covered entity or business associate, per 45 CFR 160.103."],
            ["Breach", "Acquisition, access, use, or disclosure of PHI in a manner not permitted under HIPAA Privacy Rule that compromises the security or privacy of the PHI, per 45 CFR 164.402."],
        ],
    },
    "109": {
        "policy_id": "109",
        "slug": "laboratory_governance_and_leadership",
        "policy_name": "Laboratory Governance and Leadership Policy",
        "section": "Leadership",
        "purpose": (
            "This policy describes <<LAB_NAME>>'s governance structure and "
            "leadership framework: organizational chart and reporting structure, "
            "governance responsibilities, culture of safety and quality, and code "
            "of ethical conduct. Required by 42 CFR 493.1441 (Laboratory Director "
            "qualifications), 42 CFR 493.1445 (Laboratory Director "
            "responsibilities), 42 CFR 493.1100 (overall CLIA structure), 42 CFR "
            "493.1200 (laboratory quality systems), and 42 CFR 493.1232 (specimen "
            "and result integrity)."
        ),
        "scope": (
            "All <<LAB_NAME>> personnel, the Laboratory Director, the governing "
            "body, and the laboratory leadership team."
        ),
        "policy_statements": [
            "<<LAB_NAME>> maintains a current organizational chart that names each CLIA-required role (Laboratory Director, Technical Supervisor, General Supervisor, Technical Consultant, Testing Personnel) and the reporting line from each to the Director.",
            "The Laboratory Director holds the responsibilities listed at 42 CFR 493.1445, including final responsibility for every result reported, and may delegate specific duties to qualified designees while retaining responsibility.",
            "The laboratory's quality program (42 CFR 493.1200) is governed by the Laboratory Director or designee, with documented review of QC, PT, complaints, incidents, and corrective action on the lab's documented cadence.",
            "<<LAB_NAME>> cultivates a culture of safety and quality: staff are expected to report errors, near-misses, and unsafe conditions without fear of retaliation; the lab supports just-culture principles in incident review.",
            "All laboratory personnel adhere to a documented code of ethical conduct covering result integrity, conflict of interest, professional behavior, confidentiality, and reporting of suspected misconduct.",
            "Leadership reviews the governance structure annually, updates the org chart as roles change, and re-affirms the Laboratory Director's responsibilities in writing.",
        ],
        "procedure_steps": [
            "Maintain the organizational chart in the leadership binder; update on every role change; annual review with sign-off by the Laboratory Director.",
            "Document the Laboratory Director's delegation of any specific responsibilities in writing; designee acknowledges in writing.",
            "Hold the documented governance/quality review cadence (typically quarterly); minutes filed in the quality binder.",
            "Maintain the just-culture incident-reporting channel; report into the quality review.",
            "On hire, every staff member acknowledges the code of ethical conduct in writing; annual re-acknowledgment.",
            "Conduct the annual leadership review of governance, structure, and code; document.",
        ],
        "definitions": [
            ["Just culture", "A workplace framework that distinguishes human error (console and coach), at-risk behavior (coach), and reckless behavior (sanction), used in incident review to drive learning instead of blame."],
        ],
    },
    "110": {
        "policy_id": "110",
        "slug": "infection_prevention_and_standard_precautions",
        "policy_name": "Infection Prevention and Standard Precautions Policy",
        "section": "Safety",
        "purpose": (
            "This policy describes <<LAB_NAME>>'s infection prevention program "
            "and the implementation of standard precautions with personal "
            "protective equipment (PPE). Required by 42 CFR 493.1101(c) "
            "(physical environment and safety) and 29 CFR 1910.1030 (OSHA "
            "Bloodborne Pathogens Standard, including PPE provision and exposure "
            "control)."
        ),
        "scope": (
            "All <<LAB_NAME>> laboratory personnel, the Safety Officer, and any "
            "non-laboratory staff entering the testing area."
        ),
        "policy_statements": [
            "<<LAB_NAME>> maintains an infection prevention program covering exposure control, hand hygiene, PPE, sharps handling, biological spill response, and post-exposure follow-up; the program is reviewed annually and updated as needed.",
            "Standard precautions are observed for every specimen and every patient interaction; PPE (gloves, lab coats, eye protection, masks as appropriate) is provided by the employer and worn whenever the task indicates exposure risk per OSHA 29 CFR 1910.1030(d)(3).",
            "Hand hygiene is performed before patient contact, before clean/aseptic procedures, after contact with specimens or contaminated surfaces, after removing PPE, and on entering/leaving the lab.",
            "Sharps handling, including safer-engineered sharps where applicable, follows the documented sharps injury log and exposure control plan.",
            "Biological spills are managed per the documented spill response procedure; spill kits are stocked in every testing area.",
            "Post-exposure (needlestick, splash, contamination) follow-up is initiated immediately per the documented post-exposure procedure; reports retained per OSHA recordkeeping requirements.",
        ],
        "procedure_steps": [
            "At hire and annually, every staff member completes OSHA-required Bloodborne Pathogens training; documented in the personnel record.",
            "PPE inventory is maintained at point-of-use; restocked before depletion; substitutions or shortages reported to the Safety Officer.",
            "On any exposure event, the staff member follows the post-exposure procedure immediately; supervisor and Safety Officer notified; medical follow-up arranged per the exposure control plan.",
            "Maintain the sharps injury log; review at the documented cadence; identify trends and corrective actions.",
            "Audit infection-prevention practices on the documented cadence (typically quarterly walk-rounds); document findings and corrective actions.",
            "Annual review and update of the exposure control plan and infection prevention program; signed by the Laboratory Director or designee and Safety Officer.",
        ],
        "definitions": [
            ["Standard precautions", "Infection prevention practices applied to every patient and every specimen regardless of suspected or confirmed infection status."],
            ["Exposure control plan", "The OSHA-required written plan describing how the laboratory eliminates or minimizes employee exposure to bloodborne pathogens, including engineering controls, work practice controls, PPE, training, and post-exposure follow-up."],
        ],
    },
    "111": {
        "policy_id": "111",
        "slug": "hct_p_human_cells_tissues",
        "policy_name": "Human Cells, Tissues, and Cellular Tissue-Based Products (HCT/P) Policy",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> handles human cells, tissues, "
            "and cellular and tissue-based products (HCT/Ps): donation eligibility, "
            "tissue handling, and post-distribution safety surveillance. Required "
            "by 21 CFR Part 1271 (HCT/Ps), specifically 21 CFR 1271.85 (donor "
            "eligibility), 21 CFR 1271.155 (tissue tracking and labeling), and "
            "21 CFR 1271.350 (adverse reaction reporting). This policy applies only "
            "to laboratories that recover, process, or distribute HCT/Ps."
        ),
        "scope": (
            "<<LAB_NAME>> personnel handling HCT/Ps, the medical director or "
            "designee, and the tissue program coordinator."
        ),
        "policy_statements": [
            "Donor eligibility for HCT/Ps is determined per 21 CFR 1271.85 before recovery: relevant medical records review, infectious disease screening, physical assessment as applicable; ineligible donations are not used for transplantation.",
            "Tissue handling (receipt, storage, labeling, distribution, return) follows 21 CFR 1271.155 with full traceability from donor through transplant recipient.",
            "Storage temperatures are validated and monitored continuously; alarm response follows the documented procedure.",
            "Adverse reactions in tissue recipients are investigated, reported to the source tissue establishment, and reported to FDA per 21 CFR 1271.350 within the required timeframe.",
            "Tissue records (donor eligibility, recovery, processing, distribution, recipient, adverse events) are retained for at least 10 years after the distribution date per 21 CFR 1271.270.",
            "Personnel handling HCT/Ps complete documented training before working with tissue products; competency is reassessed at the lab's documented cadence.",
        ],
        "procedure_steps": [
            "For each donation, complete the donor eligibility determination per 21 CFR 1271.85; the medical director or designee approves.",
            "Receive, label, and store tissue per the validated procedure; document temperature, time, and condition on receipt.",
            "Distribute or transplant tissue only after eligibility determination is complete; document the distribution event with full traceability.",
            "On suspected adverse reaction, initiate the investigation procedure within the FDA-required timeframe; coordinate with the source tissue establishment; report to FDA per 21 CFR 1271.350.",
            "Retain all tissue records for at least 10 years post-distribution.",
        ],
        "definitions": [
            ["HCT/P", "Human cells, tissues, and cellular and tissue-based products as defined in 21 CFR 1271.3(d); includes bone, ligaments, skin, dura mater, heart valves, corneas, semen, ova, and others."],
        ],
    },
}


def aggregate_cfr_blocks(source_files):
    """Dedupe by citation alone (same regulation = one entry)."""
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
    print(f"{'New':<5} {'Name':<55} {'Sources':<8} {'CFR blocks':<10}")
    print("-" * 80)
    for nid, name, n_src, n_cfr in summary:
        print(f"{nid:<5} {name[:53]:<55} {n_src:<8} {n_cfr:<10}")


if __name__ == "__main__":
    main()
