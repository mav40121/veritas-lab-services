#!/usr/bin/env python3
"""
add_cfr_summaries_v1.py  (parking-lot #30, summary expansion)

Adds operator-reviewable plain-language `summary` fields to high-traffic CFR
sections in server/cfrRequirements.ts, matching the voice of the 5 pilot
summaries (493.1235/1252/1253/1281/1289). CFR is public domain; each summary is
a faithful plain-language paraphrase of the section's own requirements, authored
for lab-director scannability. The verbatim `description` stays the authority.

Draft for Michael's voice review before it ships: these 14 are a PR, not a
unilateral content change. Expanding further stays a reviewed content task.

Matching: the `standard` field is always followed by `, "name"`, so each section
is matched on `<number>", "name"`. Rows that already carry a summary are skipped.
Run: python scripts/add_cfr_summaries_v1.py
"""
import re
import sys
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "server" / "cfrRequirements.ts"

# section-number (within the standard field) -> plain-language summary
SUMMARIES = {
    "493.801": "Enroll in an HHS-approved proficiency testing program for every specialty and subspecialty you are certified to test. Handle PT samples exactly like patient specimens, run by the personnel who normally run those tests, and never discuss results with, or refer samples to, another laboratory before the event closes. Referral or communication of PT samples is the one PT violation CLIA treats as cause for certificate revocation.",
    "493.1105": "Keep the records that prove how a result was produced. The general minimum is two years for test requisitions, procedures, QC and instrument-maintenance records, test reports, PT records, and quality-assessment records. Longer holds apply where the clinical stakes are higher: immunohematology (blood bank) records five years, pathology reports ten years, cytology slides five years, histopathology slides ten years, and paraffin blocks two years. Keep a discontinued procedure for two years after it stops being used.",
    "493.1251": "Maintain a written procedure manual covering every test the lab performs, available at the bench and actually followed. Each procedure states the steps, specimen and reagent requirements, calibration and QC, reportable range, interpretation, and the action to take when a result is outside limits. The laboratory director reviews, signs, and dates the manual, and re-signs when a procedure changes or a new director takes over. Manufacturer inserts may supplement the manual but do not replace it.",
    "493.1254": "Follow the manufacturer's maintenance and function checks for each instrument at the frequency they specify, and document that you did it. If you modified the system, or the manufacturer gives no instructions, establish your own maintenance and function-check protocol and frequency, then follow it. Undocumented maintenance is treated as maintenance not done.",
    "493.1255": "Calibrate each test system following the manufacturer's instructions, using the number and type of calibrators they specify. Recalibrate or verify calibration at least every six months, and sooner whenever you change to a new reagent lot (unless you verify it has no effect), replace a major part or perform major maintenance, QC shows a trend or exceeds limits, or the manufacturer requires it. Calibration verification confirms the system stays accurate across the full reportable range.",
    "493.1256": "Run quality control that monitors the accuracy and precision of the complete analytic process for every test system. Unless the manufacturer's instructions or an approved IQCP allow less, test at least two levels of control each day patient samples are tested, at the frequency the method requires. Establish acceptable ranges, review QC before reporting, and do not release patient results when controls are out of range until the problem is identified and corrected.",
    "493.1282": "Have written corrective-action procedures and follow them when QC, calibration, PT, or instrument checks fall outside limits, or when any problem threatens result quality. Document what went wrong, what you did, and that patient results reported during the problem window were evaluated and corrected if needed. The record has to show the problem was actually closed, not just noticed.",
    "493.1283": "Keep records that let you reconstruct any reported result: the specimen's identity and condition, the date and time of receipt and testing, who performed the test, the instrument used, and the result as reported. The point is traceability. If a result is ever questioned, these records are what let you show exactly how it was produced.",
    "493.1290": "Meet the test-reporting requirements of 493.1291, and run an ongoing quality review of the postanalytic phase the same way you do for the analytic phase. This covers how results leave the lab and reach the right clinician accurately and on time. Monitor it, correct problems, and document the review.",
    "493.1291": "Report results accurately and reliably to the person who ordered the test, with the information CLIA requires: patient and laboratory identity, test name, result and units, reference intervals, and any condition that limits the result. Flag results outside the reportable range, notify critical values promptly per your policy, and keep the ability to retrieve the original data. A corrected report must identify the change and reach the ordering clinician.",
    "493.1407": "In moderate-complexity testing the director carries overall responsibility: competent staff, a sound testing environment, working QC and quality-assessment programs, and test systems verified before patient reporting. The director makes sure personnel are qualified and competency-assessed and that a technical consultant and clinical consultant are available. Responsibilities may be delegated in writing; accountability does not transfer.",
    "493.1411": "A moderate-complexity lab must have a technical consultant for each specialty it tests, qualified by education plus training or experience (the exact combination depends on degree level and specialty). The technical consultant owns the scientific and technical side: method selection, QC and verification, resolving technical problems, and competency assessment. It is the moderate-complexity counterpart to the technical supervisor role in high-complexity testing.",
    "493.1445": "The high-complexity laboratory director owns the whole operation: competent staffing, a safe and adequate environment, and test systems that produce accurate results. The director ensures QC and quality-assessment programs are in place and working, verification and calibration are done before reporting, personnel are qualified and competency-assessed, and technical supervisors, a clinical consultant, and general supervisors are available. Duties may be delegated in writing, but the responsibility stays with the director.",
    "493.1463": "The general supervisor provides day-to-day oversight of testing personnel and result reporting when the director and technical supervisor are not on site. They make sure testing is performed correctly, results are reported only when QC and test systems are acceptable, and problems are corrected or referred up. In high-complexity labs the general supervisor is the on-the-floor accountability layer.",
}


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    added = {k: 0 for k in SUMMARIES}
    skipped_has = 0
    for i, line in enumerate(lines):
        if '"standard"' not in line:
            continue
        for num, summary in SUMMARIES.items():
            if f'{num}", "name"' in line:
                if '"summary"' in line:
                    skipped_has += 1
                    break
                nl = line.rstrip("\r\n")
                eol = line[len(nl):]
                idx = nl.rfind("}")
                if idx == -1:
                    break
                nl = nl[:idx] + f', "summary": "{esc(summary)}"' + nl[idx:]
                lines[i] = nl + eol
                added[num] += 1
                break
    SRC.write_text("".join(lines), encoding="utf-8")
    total = sum(added.values())
    print(f"Added summary to {total} rows across {sum(1 for v in added.values() if v)} sections "
          f"({skipped_has} rows already had one).")
    for num, n in added.items():
        print(f"  {num}: {n} rows")
    missing = [k for k, v in added.items() if v == 0]
    if missing:
        print(f"WARNING: no rows matched for: {missing}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
