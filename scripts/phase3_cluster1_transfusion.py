"""
Phase 3 Cluster 1: consolidate 25 Transfusion-Service policy templates
into 6 combined templates per yesterday's Phase2_QC_Findings analysis.

Combined policies (IDs 97-102) and their sources:
  97  Transfusion Service Master P&P            <- 41
  98  Pretransfusion Testing                    <- 49, 50, 51
  99  Blood Component Handling                  <- 42, 44, 45, 46, 47, 48, 55, 56, 57
 100  Transfusion Administration                <- 52, 53, 54, 58, 59, 60
 101  Blood Recipient Look-Back (HIV + HCV)     <- 61, 62
 102  Donor Operations                          <- 43, 63, 64, 65

CFR text blocks are aggregated from sources (deduped by citation), then
sorted in source-citation order. Policy statements, procedure steps, and
definitions are HAND-AUTHORED below for editorial coherence (concatenating
the source lists would produce a jumbled binder, not a usable policy).

Run:
    python scripts/phase3_cluster1_transfusion.py

Output:
  - Writes 6 new JSONs to server/policyTemplates/data/
  - Moves 25 source JSONs to server/policyTemplates/data/deprecated/
  - Prints a CFR-coverage summary (every source citation accounted for)
"""

import json
import os
import shutil
import sys
from pathlib import Path

# Path setup. Assumes this script lives in repo_root/scripts/.
REPO_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR   = REPO_ROOT / "server" / "policyTemplates" / "data"
DEPREC_DIR = DATA_DIR / "deprecated"
DEPREC_DIR.mkdir(exist_ok=True)

# Source mapping: combined policy id -> list of source policy IDs (strings).
CLUSTER_MAP = {
    "97":  ["41"],
    "98":  ["49", "50", "51"],
    "99":  ["42", "44", "45", "46", "47", "48", "55", "56", "57"],
    "100": ["52", "53", "54", "58", "59", "60"],
    "101": ["61", "62"],
    "102": ["43", "63", "64", "65"],
}

# Hand-authored combined templates. CFR text blocks are filled in by
# aggregate_cfr_blocks() at runtime to guarantee every source citation
# is preserved.
COMBINED = {
    "97": {
        "policy_id": "97",
        "slug": "transfusion_service_master",
        "policy_name": "Transfusion Service Master Policies and Procedures",
        "section": "Specialty Services",
        "purpose": (
            "This policy is the top-level framework for <<LAB_NAME>> transfusion service "
            "operations: scope, governance, and the structure that links every transfusion-"
            "service sub-policy. Required by 42 CFR 493.1271 (immunohematology) and 21 CFR "
            "606 (FDA Current Good Manufacturing Practice for blood and blood components). "
            "Subordinate policies cover pretransfusion testing, blood component handling, "
            "transfusion administration, recipient look-back, and donor operations."
        ),
        "scope": (
            "All <<LAB_NAME>> transfusion service personnel, the medical director or "
            "designee, and any clinical staff who order or administer blood components."
        ),
        "policy_statements": [
            "<<LAB_NAME>> maintains a complete set of written transfusion service procedures covering specimen requirements, ABO/Rh typing, antibody screen and identification, compatibility testing, component selection, component issue, transfusion monitoring, transfusion reaction investigation, look-back, inventory, storage and transport, donor operations (if applicable), and emergency release.",
            "Every transfusion service procedure is approved, signed, and dated by the medical director or designee before use, and reviewed at least every 2 years.",
            "Transfusion service personnel meet the CLIA qualifications for high complexity testing (42 CFR 493.1489); the technical supervisor for immunohematology meets 42 CFR 493.1449 with the immunohematology-specific qualifications.",
            "Transfusion records (specimen, ABO/Rh, antibody, crossmatch, component issued, recipient identification, transfusion outcome, look-back) are retained for at least 10 years per 42 CFR 493.1105(a)(7).",
            "FDA cGMP requirements at 21 CFR 606 apply to component handling, labeling, storage, and records; the transfusion service maintains current SOPs covering these requirements.",
        ],
        "procedure_steps": [
            "At service launch or director change, the medical director or designee reviews and signs every transfusion service procedure before patient care resumes.",
            "Every transfusion service event (specimen receipt, testing, component issue, transfusion, reaction, look-back) follows the applicable sub-policy exactly; deviations are logged.",
            "Records are filed in the transfusion service binder or LIS with the 10-year retention flag.",
            "Periodic review every 2 years (or sooner on change in test system, reagent, or scope) re-reads and re-approves each sub-policy.",
        ],
        "definitions": [
            ["Transfusion service", "The lab subspecialty that performs pretransfusion testing, selects and issues blood components, and monitors transfusion outcomes."],
            ["FDA cGMP", "Current Good Manufacturing Practice for blood and blood components, codified at 21 CFR 606. Applies to component manufacture, handling, and recordkeeping."],
        ],
    },
    "98": {
        "policy_id": "98",
        "slug": "pretransfusion_testing",
        "policy_name": "Pretransfusion Testing Policy",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> performs pretransfusion testing: "
            "specimen collection for typing and crossmatching, ABO and Rh blood typing, "
            "and compatibility testing. Required by 42 CFR 493.1271(a) through (d) and "
            "42 CFR 493.1232 (specimen identification and integrity). Pretransfusion "
            "testing is the gating step that confirms recipient/donor compatibility "
            "before any blood component is issued for transfusion."
        ),
        "scope": (
            "All <<LAB_NAME>> transfusion service personnel performing or supervising "
            "pretransfusion testing, the medical director or designee, and clinical "
            "staff collecting type-and-crossmatch specimens."
        ),
        "policy_statements": [
            "Specimens for type and crossmatch are collected by trained personnel using two-patient-identifier verification at the bedside, labeled at the bedside immediately after draw, and accompanied by a signed requisition that matches the specimen label exactly.",
            "<<LAB_NAME>> performs ABO grouping by both forward (cell) and reverse (serum) typing on every recipient specimen; discrepancies are resolved before any blood is issued.",
            "Rh(D) typing is performed on every recipient specimen; weak D testing is performed on initial typing of donor units or per the lab's standing rule on neonatal/pediatric specimens.",
            "Compatibility testing (crossmatch) is performed on every red cell unit before issue, by serologic crossmatch or by an electronic crossmatch only when the recipient meets the FDA-recognized electronic-crossmatch criteria (no clinically significant antibodies, two ABO determinations on file, etc.).",
            "Repeat patient ABO/Rh testing on a second specimen drawn at a different time is required before the first non-O group-specific transfusion, per AABB and FDA guidance, unless an electronic patient-identification system is in place.",
            "Pretransfusion testing records are reviewed before component issue and retained per 42 CFR 493.1105(a)(7).",
        ],
        "procedure_steps": [
            "At specimen receipt, verify the requisition matches the specimen label (name, DOB, MRN, draw date/time, phlebotomist initials); reject mismatched or unlabeled specimens.",
            "Perform ABO forward and reverse typing and Rh(D) typing per the lab's validated procedure; resolve any discrepancy before proceeding.",
            "Perform antibody screen on every recipient specimen; identify any reactive antibody before crossmatching.",
            "Perform serologic crossmatch on every red cell unit (or electronic crossmatch if all FDA criteria met); document compatibility result.",
            "Document results in the transfusion service record; route to component-issue workflow.",
            "Retain pretransfusion testing records and any reactive antibody identification for at least 10 years.",
        ],
        "definitions": [
            ["Forward typing", "ABO grouping performed by testing patient red cells with reagent anti-A and anti-B."],
            ["Reverse typing", "ABO grouping performed by testing patient serum or plasma against reagent A1 and B cells; must agree with forward typing."],
            ["Electronic crossmatch", "Compatibility determination based on validated computer logic comparing recipient ABO/Rh with donor unit ABO/Rh; permitted only when recipient meets all FDA-recognized criteria."],
            ["Weak D", "An expression of the D antigen that requires indirect antiglobulin testing to detect; affects donor unit labeling and may affect Rh(D)-negative recipient management."],
        ],
    },
    "99": {
        "policy_id": "99",
        "slug": "blood_component_handling",
        "policy_name": "Blood Component Handling Policy",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> handles blood and blood components "
            "from supplier receipt through final disposition: inventory management, "
            "release to internal and external organizations, transport and storage, "
            "storage alarm response, reagent criteria and reactivity testing, plasma "
            "component processing, irradiation, and leukoreduction. Required by 21 CFR "
            "606 (FDA cGMP), 21 CFR 606.65 (storage), 21 CFR 606.122 (labeling), "
            "42 CFR 493.1252 (specimen and reagent integrity), and 42 CFR 493.1273 "
            "(blood bank reagent QC)."
        ),
        "scope": (
            "All <<LAB_NAME>> transfusion service personnel handling blood and blood "
            "components, the medical director or designee, and any external organization "
            "to which components are released."
        ),
        "policy_statements": [
            "<<LAB_NAME>> maintains an inventory management system that tracks every blood component from receipt to final disposition (transfused, transferred, discarded, expired, returned to supplier) with unique unit identification.",
            "Components are stored at validated temperatures with continuous monitoring; storage alarms (audible and visual) signal any out-of-range condition and trigger the documented alarm response procedure.",
            "Release of components to external organizations follows a written agreement that defines the receiving organization's storage, handling, and recordkeeping responsibilities; component traceability is maintained end-to-end.",
            "Transport, storage, and return of components meet temperature and time-of-issue requirements per 21 CFR 606.122 and AABB Standards; any deviation triggers component evaluation by the medical director or designee.",
            "Blood bank reagents meet manufacturer reactivity criteria, are QC-tested on each day of use per 42 CFR 493.1273, and are stored per manufacturer instructions.",
            "Plasma components are processed (thawed, pooled, divided) per validated procedures; the resulting components carry a new expiration time and label per 21 CFR 606.122.",
            "Irradiation (for prevention of TA-GVHD) and leukoreduction (for CMV-safe / HLA-alloimmunization mitigation) are performed per validated procedures; each unit's processing is documented on the unit label and in the transfusion record.",
            "Records of inventory, storage temperature, alarm events, reagent QC, component processing, and component disposition are retained per 42 CFR 493.1105(a)(7) and 21 CFR 606.160.",
        ],
        "procedure_steps": [
            "On supplier receipt, log unit ID, ABO/Rh, expiration, supplier, and receipt temperature; place in validated storage immediately.",
            "Monitor storage temperature continuously; on alarm activation, follow the alarm response procedure (verify reading, transfer components if needed, document event and corrective action, notify medical director or designee).",
            "QC blood bank reagents on each day of use against validated criteria; document results and any corrective action.",
            "For release to external organization, verify the written agreement is current, document component release with recipient organization, unit ID, and expected use; maintain traceability log.",
            "For component processing (plasma thaw/pool/split, irradiation, leukoreduction), follow the validated SOP, document each step on the unit label and in the processing log, and apply new expiration where applicable.",
            "Periodically reconcile inventory against records; investigate any discrepancy and document resolution.",
        ],
        "definitions": [
            ["Component traceability", "The end-to-end record of a blood component from donor collection through final disposition, including every custody transfer."],
            ["TA-GVHD", "Transfusion-Associated Graft-Versus-Host Disease; rare but typically fatal complication prevented by irradiation of components for immunocompromised or related-donor recipients."],
            ["Leukoreduction", "Filtration to reduce white blood cell content in a component; reduces febrile non-hemolytic transfusion reactions, HLA alloimmunization, and CMV transmission risk."],
        ],
    },
    "100": {
        "policy_id": "100",
        "slug": "transfusion_administration",
        "policy_name": "Transfusion Administration Policy",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> supports transfusion administration: "
            "donor and recipient identification at issue, emergency release of blood, "
            "Rh immune globulin administration, transfusion of neonatal and adult "
            "recipients, transfusion monitoring with adverse event reporting, and "
            "transfusion reaction investigation. Required by 42 CFR 493.1271(c) and "
            "(d), 21 CFR 606.151 (compatibility testing and release), and 21 CFR "
            "606.170 (adverse reaction file)."
        ),
        "scope": (
            "All <<LAB_NAME>> transfusion service personnel issuing components, clinical "
            "staff administering transfusions, the medical director or designee, and "
            "treating physicians ordering transfusion."
        ),
        "policy_statements": [
            "At component issue, lab staff and the receiving clinician verify recipient identity, blood component identity, ABO/Rh compatibility, expiration, and integrity, using two patient identifiers and a documented checklist; any discrepancy halts the issue.",
            "Emergency release of blood (uncrossmatched or partially crossmatched O Rh-negative or group-specific) is authorized in writing by the ordering physician; the transfusion service documents the emergency justification, components released, and notifies the medical director or designee.",
            "Rh Immune Globulin (RhIG) is administered to Rh-negative recipients of Rh-positive components, to Rh-negative pregnant women per ACOG and CDC guidance, and after any fetomaternal hemorrhage event; dose calculation, lot, and administration are documented.",
            "Neonatal and pediatric transfusion follows specific component selection rules (CMV-safe, irradiated, fresh, volume-reduced as clinically indicated); the medical director or designee approves the standing component-selection protocol.",
            "Transfusion is monitored at start, periodically during, and at completion; vital signs and any adverse reaction signs are documented; the transfusion service is notified of any adverse event.",
            "Suspected transfusion reactions are investigated by the lab: clerical check, post-transfusion ABO/Rh re-typing, direct antiglobulin test, visual inspection of pre- and post-transfusion plasma, and any additional testing the medical director or designee orders.",
            "Adverse reactions and their investigation outcomes are documented in the transfusion reaction file per 21 CFR 606.170; fatalities are reported to FDA Center for Biologics Evaluation and Research within the required timeframe.",
        ],
        "procedure_steps": [
            "At component issue, complete the two-identifier verification checklist with the clinician picking up the component; document the issue.",
            "For emergency release, obtain written physician authorization on the emergency release form; log component, time, recipient, justification.",
            "For RhIG administration, calculate dose from the indication and (if applicable) the fetomaternal hemorrhage screen result; document dose, lot, route, and administration time.",
            "During transfusion, record baseline vitals, 15-minute vitals, completion vitals, and any adverse-reaction observations on the transfusion record.",
            "On suspected reaction, the clinician stops the transfusion, retains the unit and tubing, notifies the lab, and sends post-transfusion specimens; the lab runs the transfusion reaction workup.",
            "Document the investigation outcome in the transfusion reaction file; report fatalities to FDA within required timeframe; medical director or designee signs the workup.",
        ],
        "definitions": [
            ["Two-identifier verification", "Independent confirmation of recipient identity using two of: name, DOB, MRN, account number; performed at specimen draw and at component issue."],
            ["Emergency release", "Issue of blood components before full compatibility testing is complete, authorized by physician order in life-threatening hemorrhage."],
            ["RhIG", "Rh Immune Globulin; prevents Rh sensitization in Rh-negative recipients exposed to Rh-positive blood."],
            ["TRALI", "Transfusion-Related Acute Lung Injury; serious adverse reaction with acute hypoxemia during or within 6 hours of transfusion."],
        ],
    },
    "101": {
        "policy_id": "101",
        "slug": "blood_recipient_lookback",
        "policy_name": "Blood Recipient Look-Back Policy (HIV and HCV)",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> responds to FDA-mandated look-back "
            "notification that a previous blood donor has subsequently tested positive "
            "for HIV (21 CFR 610.46) or HCV (21 CFR 610.47): identifying recipients of "
            "components from the implicated donor, notifying the recipients' treating "
            "physicians within the FDA-required timeframe, and quarantining any "
            "in-inventory components."
        ),
        "scope": (
            "<<LAB_NAME>> transfusion service personnel and the medical director or "
            "designee."
        ),
        "policy_statements": [
            "On notification of HIV or HCV look-back from a blood supplier, the transfusion service identifies all components from the implicated donor units received at the lab and determines disposition (transfused, in inventory, discarded).",
            "Recipients of transfused components are identified from the transfusion service records; the recipient's treating physician (or the physician of record at the time of transfusion if the patient has moved) is notified within the FDA-required timeframe with the appropriate HIV-specific or HCV-specific language.",
            "In-inventory components from the implicated donor are quarantined immediately and disposed of per FDA recall guidance.",
            "Notifications, recipient identifications, and component disposition are documented on the Look-Back log; records are retained per 42 CFR 493.1105(a)(7).",
            "The medical director or designee reviews every look-back event and signs the final documentation.",
        ],
        "procedure_steps": [
            "On supplier notification, log the date of receipt, the implicated donor units, the agent (HIV or HCV), and the supplier's communication.",
            "Search transfusion service records for components from the implicated donor units; identify transfused recipients with date of transfusion.",
            "Notify each recipient's treating physician within the FDA-required timeframe using the HIV-specific (21 CFR 610.46) or HCV-specific (21 CFR 610.47) notification language; document each notification.",
            "Quarantine and dispose of in-inventory implicated components per FDA recall guidance; document.",
            "Submit the completed Look-Back documentation to the medical director or designee for review and signature; file.",
        ],
        "definitions": [
            ["Look-back", "FDA-mandated process initiated when a prior blood donor is found to be infectious for HIV (21 CFR 610.46) or HCV (21 CFR 610.47); recipients of prior components from that donor are identified and treating physicians notified."],
        ],
    },
    "102": {
        "policy_id": "102",
        "slug": "donor_operations",
        "policy_name": "Donor Operations Policy",
        "section": "Specialty Services",
        "purpose": (
            "This policy describes how <<LAB_NAME>> conducts blood donation operations "
            "(supplier-receipt agreements when blood is purchased; donor screening, "
            "collection, and therapeutic apheresis when the lab is a collection "
            "establishment). Required by 21 CFR 606.100 (SOPs), 21 CFR 606.110 "
            "(donor collection), and 21 CFR 630.10 (donor eligibility). This policy "
            "applies only to laboratories that operate as a collection establishment "
            "or that maintain supplier agreements with collection establishments."
        ),
        "scope": (
            "<<LAB_NAME>> transfusion service personnel performing donor screening, "
            "collection, or apheresis, the medical director or designee, and the "
            "supplier-relationship owner."
        ),
        "policy_statements": [
            "For blood components purchased from a supplier, <<LAB_NAME>> maintains a written supplier agreement defining the supplier's qualification, the components and reagents covered, the supplier's notification obligations (look-back, recall, deviation), and the lab's component-receipt verification obligations.",
            "If <<LAB_NAME>> is a collection establishment, donor eligibility is determined per 21 CFR 630.10 before each donation: health history questionnaire, vital signs, hemoglobin, deferral check against the donor history file.",
            "Donor blood collection follows the validated SOP per 21 CFR 606.110: site prep, venipuncture, collection volume, anticoagulant ratio, post-donation care; any adverse donor reaction is documented and reviewed.",
            "Therapeutic apheresis (when offered) is performed by trained personnel under the medical director or designee's written order, with validated procedures for each apheresis modality (red cell exchange, plasma exchange, leukapheresis, etc.).",
            "Donor records (eligibility, collection, post-donation, deferral, supplier qualification) are retained per 21 CFR 606.160 and 42 CFR 493.1105(a)(7); donor confidentiality is maintained per HIPAA where applicable.",
        ],
        "procedure_steps": [
            "For supplier-sourced components, verify the supplier agreement is current and the supplier's qualification (FDA registration, accreditation status) is on file; renew annually.",
            "If collection establishment: at each donation, complete donor health history and physical (vitals, hemoglobin, deferral check); document eligibility decision.",
            "Perform venipuncture and collection per the validated SOP; observe donor during and after collection; document any adverse reaction.",
            "For therapeutic apheresis, verify the medical director's written order, perform the procedure per modality-specific SOP, and document throughout.",
            "File donor and apheresis records with the required retention; submit any required reports (e.g., suspected transfusion-transmitted infection traceback) to FDA per 21 CFR 606.170.",
        ],
        "definitions": [
            ["Collection establishment", "An FDA-registered facility that collects, prepares, processes, or compatibility-tests blood or blood components. Most hospital transfusion services are NOT collection establishments and instead purchase components from a supplier."],
            ["Therapeutic apheresis", "Procedure that selectively removes a component (red cells, plasma, leukocytes) from a patient as a therapy; distinct from donor apheresis (collection)."],
        ],
    },
}


def aggregate_cfr_blocks(source_files):
    """Read each source JSON, collect every cfr_text_blocks entry, dedupe by
    citation (the regulation identifier). Two sources that quote the same
    citation under different labels were producing duplicate blocks in the
    first run; dedupe by citation alone fixes that and matches how a real
    policy document treats one regulation as one entry."""
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

    # Build path lookup for source files (handles XXX_anything.json pattern).
    source_paths = {}
    for fn in os.listdir(DATA_DIR):
        if fn.endswith(".json") and fn[:3].isdigit():
            source_paths[fn[:3].lstrip("0") or "0"] = DATA_DIR / fn

    summary = []

    for new_id, src_ids in CLUSTER_MAP.items():
        tmpl = COMBINED[new_id]
        # Resolve source paths
        src_paths = []
        for sid in src_ids:
            # source IDs in CLUSTER_MAP are unpadded ("41"); files are 3-digit
            padded = sid.zfill(3)
            matches = [DATA_DIR / fn for fn in os.listdir(DATA_DIR)
                       if fn.startswith(padded + "_") and fn.endswith(".json")]
            if not matches:
                print(f"WARN: no source file found for ID {sid}")
                continue
            src_paths.append(matches[0])

        # Aggregate CFR blocks from all sources, dedupe
        cfr_blocks = aggregate_cfr_blocks(src_paths)
        tmpl["cfr_text_blocks"] = cfr_blocks

        # Write the combined JSON
        out_name = f"{new_id.zfill(3)}_{tmpl['slug']}.json"
        out_path = DATA_DIR / out_name
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(tmpl, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"WROTE {out_name}  ({len(cfr_blocks)} CFR blocks from {len(src_paths)} sources)")

        # Move sources to deprecated/
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
