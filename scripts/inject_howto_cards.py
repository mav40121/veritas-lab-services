"""One-time helper: inject ModuleHowToCard JSX into 11 remaining app pages.
Already done by hand: VeritaQCAppPage, VeritaOpsAppPage.
"""

from pathlib import Path

CARDS = {
  "VeritaLabAppPage": dict(
    moduleKey="veritalab", moduleName="VeritaLab™",
    what="VeritaLab tracks every laboratory certificate and accreditation: CLIA, CAP, TJC, COLA, state laboratory licenses, lab director credentials. Advance email reminders fire at 90, 60, and 30 days before expiration. Document archive holds the certificate PDF for every cert on the roster.",
    how=[
      "Add each certificate with its issuing body, certificate number, issue date, and expiration date.",
      "Upload the certificate PDF to the document archive against the cert.",
      "The system emails you 90, 60, and 30 days before expiration; renew before the 30-day warning.",
      "Upload the renewed certificate; the expiration auto-recalculates and the warning cycle resets.",
      "Run the certificate-status report before an inspection or board meeting.",
    ],
  ),
  "VeritaPolicyAppPage": dict(
    moduleKey="veritapolicy", moduleName="VeritaPolicy™",
    what="VeritaPolicy ships 96 CFR-anchored generic policy templates the lab can adopt as starting points. Each template opens with verbatim eCFR text, then the lab standing rule in plain CFR voice. Token placeholders for lab name, CLIA number, and director are replaced with your lab identity at download time.",
    how=[
      "Browse the 96-row master list; service-line toggles auto-apply N/A to policies not relevant to your scope.",
      "Click any policy to download a personalized DOCX with your lab identity already filled in.",
      "Edit the lab-specific operational details (responsible roles, escalation paths, forms referenced) for your workflow.",
      "Sign the policy with the medical director or designee; file as adopted.",
      "The inspection-ready report tracks adoption by section and surfaces the readiness score.",
    ],
  ),
  "VeritaStockPage": dict(
    moduleKey="veritastock", moduleName="VeritaStock™",
    what="VeritaStock manages reagent and supply inventory. Lot and expiration tracking, reorder-point calculation by burn rate, vendor-grouped Order PDF and Excel for routine reorders, and Snap Order for emergency stockouts.",
    how=[
      "Add inventory items with vendor, catalog number, pack size, lead time, and safety stock days.",
      "Receive shipments; on-hand quantity and average burn rate update automatically.",
      "The system computes reorder point as burn-rate times (lead time + safety stock); items at or below are flagged.",
      "Generate the Order PDF or Excel for each vendor at reorder time; the medical director or designee signs.",
      "For an unexpected stockout, use Snap Order: enter the catalog number and quantity, generate the PDF immediately.",
    ],
  ),
  "VeritaMapAppPage": dict(
    moduleKey="veritamap", moduleName="VeritaMap™",
    what="VeritaMap maps every instrument and analyte in your lab with CLIA complexity, specialty, FDA classification, reportable range, reference intervals, and critical values. The test menu feeds VeritaCheck for study setup, VeritaComp for competency programs, and VeritaPT for proficiency testing coverage.",
    how=[
      "Pick your instruments from the database of 190+ FDA-cleared analyzers.",
      "Toggle the tests your lab actually performs on each instrument; CLIA complexity auto-populates.",
      "Enter your verified reference ranges, critical values, and AMR per 42 CFR 493.1253. Do not pre-populate without verification.",
      "Export your test menu to Excel for survey reference or finance review.",
      "Other Verita modules read from this menu automatically; update here when you add or retire a test.",
    ],
  ),
  "VeritaScanAppPage": dict(
    moduleKey="veritascan", moduleName="VeritaScan™",
    what="VeritaScan walks 168 inspection-readiness items across 10 domains aligned to TJC and CAP standards. Item-by-item status (compliant, needs attention, not applicable), evidence attachment, executive summary, full PDF export for internal-use distribution.",
    how=[
      "Pick a new scan and walk through items domain by domain.",
      "Mark each item compliant, needs attention, or not applicable; attach evidence (policies, completed forms, training records) as you go.",
      "Watch the readiness score update by domain; flagged items track to closure.",
      "Export the executive summary or full PDF before your accreditor walks in.",
      "Re-run quarterly so the readiness picture stays current.",
    ],
  ),
  "VeritaCompAppPage": dict(
    moduleKey="veritacomp", moduleName="VeritaComp™",
    what="VeritaComp manages competency assessment for testing personnel using the six CLIA-required elements at 42 CFR 493.1235. Tracks Initial / 6-month / Annual cadence, embeds a scored quiz engine, and produces the per-employee competency record with appendix PDF.",
    how=[
      "Add your testing personnel and assign them to the tests they perform.",
      "The system tracks each person next-due assessment per the CLIA timeline.",
      "Document each of the six elements as you observe or test the staff member.",
      "Optional: assign a scored quiz; the score appends to the competency record.",
      "The evaluator signs; generate the PDF and file in the personnel record. Retain per 42 CFR 493.1105.",
    ],
  ),
  "VeritaStaffAppPage": dict(
    moduleKey="veritastaff", moduleName="VeritaStaff™",
    what="VeritaStaff is the personnel roster with CLIA role assignments (Laboratory Director, Technical Consultant, Technical Supervisor, General Supervisor, Testing Personnel) and specialty tracking. Auto-generates the CMS 209 Laboratory Personnel Report.",
    how=[
      "Add each staff member with their CLIA role, qualifications, and assigned specialties.",
      "Update credentials, license expirations, and training records as they change.",
      "Generate the CMS 209 Laboratory Personnel Report with one click when CMS asks.",
      "Cross-link to VeritaComp for the competency side of each staff member.",
      "Run the roster view weekly to see who is current, who is due, and who is overdue.",
    ],
  ),
  "VeritaTrackAppPage": dict(
    moduleKey="veritatrack", moduleName="VeritaTrack™",
    what="VeritaTrack is the regulatory calendar. Every timed task in one place: calibration verification, correlations, competency, equipment maintenance, QC review, PT enrollment, license renewal. Auto-imports schedules from VeritaMap so adding a new instrument creates its cal-ver cadence automatically.",
    how=[
      "Set up your test menu in VeritaMap; tasks auto-create here at their CLIA cadence.",
      "Add ad-hoc tasks (equipment service, contract renewals, accreditor application deadlines).",
      "Sign off tasks as complete with initials, date, and reviewer name.",
      "Export to Excel in the regulatory-calendar format your lab already uses.",
      "Review the calendar weekly; track overdue items to closure with the medical director or designee.",
    ],
  ),
  "VeritaPTAppPage": dict(
    moduleKey="veritapt", moduleName="VeritaPT™",
    what="VeritaPT reads your VeritaMap test menu, checks each analyte against CLIA proficiency-testing requirements (42 CFR 493 Subpart I), and shows you required gaps, recommended programs, and current coverage. Tracks CAP, API, and WSLH enrollments. Alternative-assessment-method analytes count as coverage per 42 CFR 493.1236(c)(1).",
    how=[
      "Confirm your test menu in VeritaMap is current; this is the source of truth for required PT.",
      "Open VeritaPT; the coverage table flags required gaps in red and recommended in amber.",
      "For each gap, enroll in a PT program through CAP, API, or WSLH (links open in-app).",
      "Record your enrollment; the analyte status flips to covered automatically.",
      "Re-check coverage every PT cycle and any time your test menu changes.",
    ],
  ),
  "VeritaResponseAppPage": dict(
    moduleKey="veritaresponse", moduleName="VeritaResponse™",
    what="VeritaResponse turns post-survey deficiencies into one tracked finding per cited standard. Per-accreditor due-date clocks (CAP 30 days, TJC 60 days, CMS-2567 10 days, AABB event-driven). Renders the federal CMS-2567 Plan of Correction PDF with all 5 POC elements labeled.",
    how=[
      "Open a new finding when you receive a citation; pick the accreditor and the cited standard.",
      "Author the response covering the 5 POC elements: root cause, immediate action, corrective action, monitoring plan, completion date.",
      "Attach evidence as you complete each element (training records, revised SOPs, completed QC).",
      "Generate the CMS-2567 PDF or the accreditor-specific response document.",
      "Submit before the per-accreditor deadline; the dashboard tracks every open finding through closure.",
    ],
  ),
  "VeritaBenchPage": dict(
    moduleKey="veritabench", moduleName="VeritaBench™",
    what="VeritaBench is the productivity calculator. Tracks billable tests per productive hour, compares to industry benchmarks (community hospital, large trauma center, reference lab), surfaces month-over-month trend, and feeds the staffing-by-hour analysis.",
    how=[
      "Enter monthly billable test count and productive hours for each month you want to track.",
      "The dashboard shows your tests-per-productive-hour ratio versus the benchmark range for your facility type.",
      "Drill into the trend to see month-over-month direction and seasonal patterns.",
      "Use the gap delta versus benchmark to drive staffing or workflow conversations with hospital leadership.",
      "Export the dashboard to share with finance or the lab oversight committee.",
    ],
  ),
}


def build_card(c):
    indent = "          "
    how_items = ",\n".join(indent + '"' + s.replace('"', '\\"') + '"' for s in c["how"])
    return (
        "\n      <ModuleHowToCard\n"
        f'        moduleKey="{c["moduleKey"]}"\n'
        f'        moduleName="{c["moduleName"]}"\n'
        f'        whatItDoes="{c["what"]}"\n'
        "        howToUse={[\n"
        f"{how_items}\n"
        "        ]}\n"
        "      />\n"
    )


def main():
    inserted, skipped = [], []
    for fn, c in CARDS.items():
        p = Path(f"client/src/pages/{fn}.tsx")
        t = p.read_text(encoding="utf-8")
        if f'moduleKey="{c["moduleKey"]}"' in t:
            skipped.append(fn)
            print(f"  skip (already has card): {fn}")
            continue
        card = build_card(c)
        idx = t.find("</h1>")
        if idx < 0:
            print(f"  NO </h1> in {fn}")
            continue
        # Find the closing </div> after </h1> to land card after the header bar
        cursor = idx + len("</h1>")
        depth = 0
        end_div = -1
        # naive scan: find next </div> following </h1>
        rest = t[cursor:]
        # find first </div>
        next_close = rest.find("</div>")
        if next_close < 0:
            insert_at = cursor
        else:
            # insert after that </div>
            insert_at = cursor + next_close + len("</div>")
        new_t = t[:insert_at] + card + t[insert_at:]
        p.write_text(new_t, encoding="utf-8")
        inserted.append(fn)
        print(f"  inserted: {fn}")
    print(f"\nInserted {len(inserted)}, skipped {len(skipped)}")


if __name__ == "__main__":
    main()
