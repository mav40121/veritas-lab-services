# VeritaPolicy Phase 3 — Coverage Verification Report

Generated automatically. For each of the 11 combined policies (IDs 97-111), this report lists what the combined template ships PLUS every source policy_statement / procedure_step / definition that was absorbed into it. A naive word-trigram overlap score flags 🚩 LOW OVERLAP (less than 25% trigram overlap with any combined statement) so your eye lands first on source obligations that may not be carried into the combined version.

**The flag is a hint, not a verdict.** A 🚩 may be perfectly covered by different wording the algorithm didn't catch. A high score may still miss substantive nuance. The reviewer makes the call.


---

## Combined #97
(1:1 mapping from source #41 — coverage risk is low; not detailed here. Read the combined template directly if you want to verify.)

---

## Combined #98

**Combined policy_name:** Pretransfusion Testing Policy

**Source IDs absorbed:** 49, 50, 51


### Combined content (what we ship)

**policy_statements:**

1. Specimens for type and crossmatch are collected by trained personnel using two-patient-identifier verification at the bedside; each tube is labeled in the patient's presence with patient name, DOB or MRN, date and time of collection, and the collector's initials. Pre-printed labels are NOT applied before collection.
2. Specimens that are unlabeled, mislabeled, or have any discrepancy between tube and requisition are rejected without exception; the only resolution is recollect.
3. Pretransfusion specimen validity window: typically 3 days when the patient has been pregnant or transfused within the prior 3 months (or when history is unknown); validity may extend longer when no recent immunologic exposure has occurred, per the lab's policy approved by the medical director or designee.
4. Pretransfusion specimens are kept refrigerated at 1 to 6 degrees C when not in use and retained for at least 7 days after the last transfusion or compatibility test per the lab's transfusion service retention policy.
5. <<LAB_NAME>> performs ABO grouping by both forward (cell) and reverse (serum) typing on every recipient specimen; reverse typing is NOT performed on newborns under 4 months of age per the lab's transfusion service protocol approved by the medical director or designee; discrepancies are resolved before any blood is issued.
6. Rh(D) typing is performed on every recipient specimen using anti-D reagent per manufacturer instructions; weak D testing is performed on initial typing of donor units and on patients per the lab's defined indications (e.g., prenatal, infant of D-negative mother).
7. The current ABO/Rh result is compared to any historical result on file before any blood product is issued; any discrepancy is investigated and resolved by the medical director or designee before issue, and the resolution is documented.
8. Daily-of-use QC for ABO/Rh reagents is performed per 42 CFR 493.1256 and 42 CFR 493.1273(a): positive and negative controls for anti-A, anti-B, and anti-D; A1 and B reactive cells confirmed reactive with the corresponding antisera; antiglobulin reagent confirmed reactive with IgG-sensitized control cells.
9. Compatibility testing (crossmatch) is performed on every red cell unit before issue and includes an antiglobulin (indirect Coombs) phase, unless emergency release is invoked per the lab's written emergency release policy. Electronic crossmatch may substitute for the serologic crossmatch only when the recipient meets all FDA-recognized electronic-crossmatch criteria (no clinically significant antibodies current or historical, two ABO determinations on file, validated LIS algorithm).
10. Historical patient records are checked at each crossmatch; any prior clinically significant antibody is honored regardless of current screen result; the component selected is antigen-negative for any previously identified clinically significant antibody.
11. Incompatible crossmatch triggers investigation by the Technical Supervisor or medical director or designee before any component is issued; the investigation is documented (history review, repeat testing on fresh specimen, antibody identification or expanded panel, selection of alternate donor units).
12. Repeat patient ABO/Rh testing on a second specimen drawn at a different time is required before the first non-O group-specific transfusion, per AABB and FDA guidance, unless an electronic patient-identification system meeting the medical director or designee's approved equivalence criteria is in use.
13. Pretransfusion testing records (results, QC, reagent lot numbers, technologist initials, verification of historical comparison) are reviewed before component issue and retained for at least 10 years per 42 CFR 493.1105(a)(7).

**procedure_steps:**

1. At specimen receipt, verify the requisition matches the specimen label (name, DOB or MRN, draw date/time, phlebotomist initials); reject any mismatched or unlabeled specimen and notify the ordering provider.
2. Log specimen receipt in the LIS with patient identifiers, collection time, receipt time, and the receiving staff member; refrigerate at 1 to 6 degrees C between tests.
3. At the start of each day of patient immunohematology testing, run the required daily QC per 42 CFR 493.1273(a): reagent red cells with positive and negative antisera; antisera with known antigen-positive and antigen-negative reference cells; antiglobulin reagent with IgG-sensitized control cells. Failed QC pauses patient testing on the affected reagent.
4. Perform ABO forward and reverse typing and Rh(D) typing per the lab's validated procedure; interpret reactions as 0, 1+, 2+, 3+, or 4+; resolve any forward/reverse discrepancy before reporting.
5. Compare the current ABO/Rh interpretation to any prior on-file result; if a prior result exists and differs, do NOT issue blood; investigate and document the resolution; notify the medical director or designee.
6. Perform antibody screen on every recipient specimen; identify any reactive antibody through panel testing before crossmatching; honor any historical antibody by selecting antigen-negative donor units.
7. Perform serologic crossmatch on every red cell unit with immediate spin (or computer crossmatch where eligible), antibody-detection phase (incubation at 37 degrees C), and antiglobulin (indirect Coombs) phase; document compatibility result.
8. If incompatible, the Technical Supervisor or medical director or designee initiates the documented investigation; component issue is held pending resolution.
9. Document QC, patient result, technologist, historical comparison, and any incompatibility investigation in the transfusion service record; retain for at least 10 years.

**definitions:**

- **Forward typing** — ABO grouping performed by testing patient red cells with reagent anti-A and anti-B.
- **Reverse typing** — ABO grouping performed by testing patient serum or plasma against reagent A1 and B cells; must agree with forward typing. Not performed on newborns under 4 months of age.
- **Electronic crossmatch** — Compatibility determination based on validated computer logic comparing recipient ABO/Rh with donor unit ABO/Rh; permitted only when recipient meets all FDA-recognized criteria including two ABO determinations on file and no current or historical clinically significant antibodies.
- **Weak D** — An expression of the D antigen that requires indirect antiglobulin testing to detect; affects donor unit labeling and may affect Rh(D)-negative recipient management.
- **Specimen validity window** — The time period during which a pretransfusion specimen can be used for compatibility testing. Typically 3 days when the patient has been pregnant or transfused in the prior 3 months or history is unknown.
- **Historical comparison** — Comparison of the current ABO/Rh result against any prior result on file at this facility before blood is issued. A discrepancy halts issue pending investigation.
- **Second-sample confirmation** — An ABO determination on a second, independently collected sample from the patient before non-O group-specific red cells are issued.
- **Clinically significant antibody** — An unexpected red cell antibody capable of causing transfusion reactions or hemolytic disease of the newborn. Triggers antigen-negative unit selection at every subsequent crossmatch regardless of current screen result.
- **Pretransfusion specimen** — A specimen collected for ABO/Rh typing, antibody screen, antibody identification, or compatibility testing in preparation for blood component transfusion. Subject to the specimen validity window and the 7-day post-transfusion retention rule.
- **Major crossmatch** — Compatibility test between donor red cells and patient plasma or serum to confirm ABO compatibility and detect clinically significant antibodies. Includes immediate spin, antibody-detection (37 degrees C), and antiglobulin (indirect Coombs) phases.
- **Antibody screen** — Test of patient plasma or serum against screening cells of known antigen profile to detect unexpected red cell antibodies. Performed on every recipient specimen; positive screens trigger antibody identification before component selection.
- **Daily QC** — The CLIA-required reactivity testing performed at the start of each day of patient immunohematology testing per 42 CFR 493.1273(a): reagent red cells, antisera, antiglobulin reagent (against IgG-sensitized control), and negative controls.

### Source-side coverage check


#### Source #49: Specimen Collection for Typing and Crossmatching Policy

_(6 statements · 5 steps · 2 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Pretransfusion specimens are collected only after two-identifier patient verification at the bedside (name and DOB or MRN matched against the patient's wristband or equivalent).
2. [✓ (100%)] Each tube is labeled in the patient's presence with: patient name, DOB or MRN, date and time of collection, and the collector's initials. Pre-printed labels are NOT applied before collection.
3. [✓ (100%)] Specimens that are unlabeled, mislabeled, or have any discrepancy between tube and requisition are rejected without exception; the only resolution is recollect.
4. [✓ (67%)] Pretransfusion specimens are typically valid for 3 days when the patient has been pregnant or transfused within the prior 3 months (or when history is unknown); valid for longer when no recent immunologic exposure has occurred, per the lab's policy approved by the medical director or designee.
5. [✓ (62%)] Specimens for pretransfusion testing are kept refrigerated (1-6 deg C) when not in use and retained for at least 7 days after the last transfusion or compatibility test per the lab's transfusion service retention policy.
6. [🚩 LOW OVERLAP] Specimen receipt is logged in the LIS with patient identifiers, collection time, receipt time, and the receiving staff member; any discrepancy triggers immediate review and ordering provider notification.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At the bedside, the collector verifies the patient using two identifiers against the wristband; the collector confirms the requisition matches the patient.
2. [🚩 LOW OVERLAP] Tubes are drawn (typically EDTA-anticoagulated whole blood or clot tubes per the lab's required tube type); the collector labels each tube in the patient's presence with name, DOB/MRN, date/time, and initials.
3. [🚩 LOW OVERLAP] Specimens are transported to the lab promptly; receipt staff verify labeling against the requisition; any discrepancy triggers rejection and recollect.
4. [🚩 LOW OVERLAP] Acceptable specimens are accessioned in the LIS; refrigerated storage at 1-6 deg C until and between tests.
5. [🚩 LOW OVERLAP] Specimens are retained for at least 7 days after the last transfusion or crossmatch; disposal follows the biohazard waste procedure.

**Source definitions:**

- [✓] **Pretransfusion specimen** — A specimen collected for ABO/Rh typing, antibody screen, antibody identification, or compatibility testing in preparation for blood component transfusion.
- [✓] **Specimen validity window** — The time period during which a pretransfusion specimen can be used for compatibility testing. Typically 3 days when recent immunologic exposure (pregnancy or transfusion) has occurred or history is unknown.


#### Source #50: ABO and Rh Blood Typing Policy

_(6 statements · 7 steps · 4 definitions)_

**Source policy_statements:**

1. [✓ (50%)] Every patient ABO/Rh determination uses concurrent forward (red cell) and reverse (serum/plasma) typing with anti-A, anti-B, A1 cells, and B cells. Reverse typing is not performed on newborns under 4 months of age per the lab's transfusion service protocol approved by the medical director or designee.
2. [✓ (73%)] D(Rho) typing uses anti-D reagent per manufacturer instructions; weak D testing is performed on donor units and on patients per the lab's defined indications (e.g., prenatal, infant of D-negative mother).
3. [✓ (100%)] The current ABO/Rh result is compared to any historical result on file before any blood product is issued. Any discrepancy is investigated and resolved by the medical director or designee before issue; the resolution is documented.
4. [⚠️  partial] QC for ABO/Rh reagents is performed on each day of patient testing per 42 CFR 493.1256: positive and negative controls for anti-A, anti-B, and anti-D; A1 and B cells reactive with their corresponding antisera.
5. [⚠️  partial] A second-sample confirmation of the patient ABO/Rh is obtained before issuing non-O red cells, or an electronic positive patient identification system meeting the medical director or designee's approved equivalence criteria is in use.
6. [✓ (55%)] All ABO/Rh results, QC, reagent lot numbers, technologist initials, and verification of historical comparison are documented in the transfusion service record and retained per 42 CFR 493.1105 (10 years for immunohematology records).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Verify the specimen meets pretransfusion testing requirements: two patient identifiers on the tube, collection date/time, collector initials, and a current type-and-screen or type-and-crossmatch order.
2. [🚩 LOW OVERLAP] Set up forward typing: add patient red cells (washed or suspended per the manufacturer's instructions) to wells or tubes labeled anti-A, anti-B, and anti-D. Add the corresponding antiserum to each.
3. [🚩 LOW OVERLAP] Set up reverse typing: add patient serum or plasma to wells labeled A1 cells and B cells, then add the corresponding reagent red cells.
4. [🚩 LOW OVERLAP] Run forward and reverse tests per manufacturer instructions (centrifugation time, reading method); record reactions as 0, 1+, 2+, 3+, or 4+.
5. [⚠️  partial] Interpret the ABO group from the forward/reverse pattern; resolve any forward/reverse discrepancy before reporting. Interpret D type from the anti-D reaction.
6. [✓ (76%)] Compare the current ABO/Rh interpretation to any prior result on file. If a prior result exists and differs, do NOT issue blood; investigate and document the resolution; notify the medical director or designee.
7. [🚩 LOW OVERLAP] Document QC for the reagents and cells used (lot number, expiration, control result), the patient result, the technologist, and the historical comparison in the transfusion service record.

**Source definitions:**

- [🚩 NOT IN COMBINED] **Forward type** — ABO grouping performed by testing unknown red cells against known anti-A and anti-B reagents.
- [🚩 NOT IN COMBINED] **Reverse type** — ABO grouping performed by testing unknown serum or plasma against known A1 and B red cells. Not performed on newborns under 4 months of age.
- [✓] **Historical comparison** — Comparison of the current ABO/Rh result against any prior result on file at this facility before blood products are issued, required by 42 CFR 493.1271(c). Discrepancies must be resolved by the medical director or designee.
- [✓] **Second-sample confirmation** — An ABO determination on a second, independently collected sample from the patient before non-O red cells are issued. An electronic positive patient identification system approved by the medical director or designee may substitute.


#### Source #51: Compatibility Testing Policy

_(6 statements · 6 steps · 4 definitions)_

**Source policy_statements:**

1. [⚠️  partial] Every red blood cell component issue is preceded by a major crossmatch that demonstrates ABO compatibility and detects clinically significant antibodies, including an antiglobulin (indirect Coombs) test, UNLESS an emergency release procedure is invoked per the lab's written emergency release policy.
2. [🚩 LOW OVERLAP] Every pretransfusion specimen has a current antibody screen performed; positive screens trigger antibody identification before component selection.
3. [✓ (88%)] Historical patient records are checked at each crossmatch; any prior antibody is honored regardless of current screen result; the component selected is antigen-negative for any previously identified clinically significant antibody.
4. [⚠️  partial] Computer (electronic) crossmatch may substitute for the serologic crossmatch only when the lab meets the criteria defined in writing (current and historical ABO concordance, no clinically significant antibodies current or historical, validated LIS algorithm).
5. [🚩 LOW OVERLAP] Compatibility test results are documented with: technologist, date/time, method, donor unit, patient specimen, reactions, and the interpretation (compatible/incompatible).
6. [✓ (100%)] Incompatible crossmatch triggers investigation by the technical supervisor or medical director or designee before any component is issued; the investigation is documented.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On crossmatch order, the transfusion service confirms the patient has a current type and screen; if not, completes ABO/Rh and antibody screen first.
2. [🚩 LOW OVERLAP] Antigen-typed donor units of compatible ABO/Rh are selected; for patients with prior clinically significant antibodies, units are confirmed antigen-negative for the identified antibody.
3. [✓ (55%)] Major crossmatch is performed per the active SOP: immediate spin (or computer crossmatch where eligible), antibody-detection phase (incubation at 37 deg C), and antiglobulin phase.
4. [🚩 LOW OVERLAP] Reactions are read, recorded as 0, 1+, 2+, 3+, or 4+; any positive reaction triggers investigation and may halt component issue pending resolution.
5. [🚩 LOW OVERLAP] Compatible units are reserved for the patient; documentation in the LIS or transfusion service log includes patient, donor unit, technologist, date/time, method, and interpretation.
6. [🚩 LOW OVERLAP] If incompatible, the technical supervisor or medical director or designee investigates: review of patient history, repeat testing on fresh specimen, antibody identification or expanded panel, selection of alternate donor units.

**Source definitions:**

- [✓] **Major crossmatch** — Compatibility test between donor red cells and patient plasma or serum to confirm ABO compatibility and detect clinically significant antibodies.
- [✓] **Antibody screen** — Test of patient plasma or serum against screening cells of known antigen profile to detect unexpected red cell antibodies.
- [🚩 NOT IN COMBINED] **Computer (electronic) crossmatch** — Crossmatch performed by an LIS algorithm against current and historical ABO and antibody records, in lieu of serologic crossmatch. Eligible only when the lab's written criteria are met.
- [✓] **Clinically significant antibody** — An unexpected red cell antibody capable of causing transfusion reactions or hemolytic disease of the fetus and newborn. Honored at every subsequent transfusion regardless of current screen result.


---

## Combined #99

**Combined policy_name:** Blood Component Handling Policy

**Source IDs absorbed:** 42, 44, 45, 46, 47, 48, 55, 56, 57


### Combined content (what we ship)

**policy_statements:**

1. <<LAB_NAME>> maintains an inventory management system that tracks every blood component from receipt to final disposition (transfused, transferred, discarded, expired, returned to supplier) with unique unit identification.
2. Inventory is rotated First Expiry First Out (FEFO) for issue; minimum-on-hand targets by component and ABO/Rh are defined and approved by the medical director or designee, with reorder triggers when on-hand falls below the minimum.
3. Components are stored under component-specific conditions: Red Blood Cells at 1 to 6 degrees C; Platelets at 20 to 24 degrees C with continuous gentle agitation; Fresh Frozen Plasma at -18 degrees C or colder; Cryoprecipitate at -18 degrees C or colder. The most stringent of regulatory and manufacturer requirements applies.
4. Storage refrigerators, freezers, and platelet incubators have continuous temperature monitoring with audible and visual alarms; alarm thresholds are set inside the regulatory storage range so corrective action begins before excursion. Temperature monitoring records are retained.
5. Components issued for transfusion are transported in validated coolers (red cells), unpacked validated containers (platelets), or insulated containers per the component's requirements; transport time and temperature are documented.
6. Components returned to inventory are accepted only if they have been continuously in approved conditions: red cells returned within 30 minutes of issue (or longer if validated cooler maintained 1 to 10 degrees C per current standards and component integrity is intact); platelets, FFP, and cryo per the lab's validated return criteria. Returns that do not meet criteria are quarantined and discarded per the Component Disposal procedure.
7. Release of components to external organizations follows a written sharing agreement, an emergency request from a recognized facility, or an FDA recall/look-back response; component traceability is maintained end-to-end and the medical director or designee is notified of any emergency external release within 5 business days.
8. Blood bank reagents meet manufacturer reactivity criteria; reactivity QC is performed each day of use per 42 CFR 493.1273(a) (reagent red cells confirmed reactive; antisera confirmed reactive with known antigen-positive reference cells; antiglobulin reagent confirmed reactive with IgG-sensitized reference cells; negative controls confirmed non-reactive). New reagent lots are parallel-tested against the prior lot and against patient samples covering the expected range of reactivity; acceptance is documented before placing the new lot into service.
9. Plasma components are processed (thawed, pooled, divided) per validated procedures. Thawing is performed in a validated plasma thawer (water bath or dry heat) per the manufacturer's instructions; thaw time and temperature are documented. ABO compatibility for plasma issue: AB plasma is universal; A plasma is compatible with A and O recipients; B plasma is compatible with B and O recipients; O plasma is compatible only with O recipients.
10. Irradiated cellular blood components are issued to patients at risk of Transfusion-Associated Graft-Versus-Host Disease (TA-GVHD), including: intrauterine and neonatal transfusion, HLA-matched units, units from biologic relatives, hematologic malignancy, hematopoietic stem cell transplant recipients, congenital immunodeficiency, and other indications per the medical director or designee's approved list.
11. Leukoreduced cellular components are issued to patients at risk of CMV transmission, febrile non-hemolytic transfusion reactions, HLA-alloimmunization, or per the medical director or designee's approved indication list. Pre-storage leukoreduction is the standard when supplier-supported; the supplier's certificate of leukoreduction or unit labeling indicating leukoreduced status is verified at receipt and at issue.
12. Records of inventory, storage temperature, alarm events, reagent QC, component processing, and component disposition are retained per 42 CFR 493.1105(a)(7) and 21 CFR 606.160.

**procedure_steps:**

1. On supplier receipt, verify supplier paperwork against physical units (count, ABO/Rh, expiration); log unit ID, ABO/Rh, expiration, supplier, and receipt temperature; place in validated storage immediately at the FEFO position.
2. Daily, transfusion service staff reconcile physical count against the LIS or paper inventory; investigate any discrepancy and document resolution. Units nearing expiration are flagged for use-first or quarantined for disposal if unsuitable.
3. Daily, verify refrigerator, freezer, and platelet incubator temperatures against the lab's acceptance range; any out-of-range reading triggers immediate investigation.
4. On storage alarm: respond immediately 24/7; verify the temperature on the local display and centralized monitoring; identify the cause (door open, power loss, equipment failure); triage stored components (continue use if storage remained in range; quarantine if exposed to out-of-range temperature beyond validated tolerance); notify the medical director or designee for any quarantine or discard event; document on the Storage Alarm Response log with timestamp, cause, response actions, components affected, and disposition.
5. Monthly, the medical director or designee reviews the Storage Alarm Response log to identify trends and prompt equipment replacement or process change.
6. On component issue, pack per the component's transport requirements (red cells in validated cooler with monitored temperature; platelets without agitation interruption beyond validated time; FFP frozen); document issue time, courier, and destination.
7. On component return, confirm transport conditions (cooler temperature in range, component appearance intact, time-since-issue within validated return window); accept or quarantine per the criteria; document.
8. Each day of use, perform reactivity QC per 42 CFR 493.1273(a) before patient testing begins; document results with reagent lot, control material lot, and accept/reject decision; failed QC pauses patient testing on the affected reagent.
9. On new reagent lot introduction, perform parallel testing against the prior lot using reference cells and patient samples; document acceptance before placing in service.
10. For external release, verify the written agreement is current, obtain medical director or designee authorization for non-routine releases, document component release with recipient organization, unit ID, and expected use; obtain receipt acknowledgment; the medical director or designee reviews emergency releases within 5 business days.
11. For plasma processing, thaw in the validated thawer per manufacturer instructions; document thaw time and temperature; verify ABO compatibility (AB universal; A to A and O; B to B and O; O to O only) before issue; apply new expiration time and label per 21 CFR 606.122.
12. For irradiation, check the patient's irradiation indication at order receipt; select only irradiated units; verify irradiation evidence (indicator label, supplier documentation); document irradiation status in the transfusion record; flag the patient in the LIS for ongoing future transfusions.
13. For leukoreduction, confirm the patient indication; verify leukoreduced status on selected units (supplier documentation or unit label); document leukoreduction status in the transfusion record.
14. Periodically reconcile inventory against records; investigate any discrepancy; document resolution. Disposal is logged with unit number, reason, disposal route, and staff member.

**definitions:**

- **Component traceability** — The end-to-end record of a blood component from donor collection through final disposition, including every custody transfer.
- **FEFO** — First Expiry First Out. Rotation rule that issues the unit with the earliest expiration first, to minimize waste.
- **Chain of custody** — Documented continuous tracking of a component from supplier to issue with no unaccounted-for time.
- **Validated cooler** — A transport cooler whose temperature performance has been documented to maintain components within the required range for the validated duration.
- **Return window** — The lab's defined maximum time during which a transported component may be returned to inventory and remain acceptable for issue.
- **Storage alarm** — Audible and visual notification that a refrigerator, freezer, or platelet incubator is outside its set acceptance range.
- **Quarantine** — Hold status placed on a component pending medical director or designee disposition decision after a storage excursion or other deviation.
- **Reactivity QC** — Daily-of-use quality control on blood bank reagents confirming each reagent performs as expected with known reactive and non-reactive controls per 42 CFR 493.1273(a).
- **Antiglobulin reagent (Coombs reagent)** — Reagent containing antibodies to human immunoglobulin used to detect antibody bound to red cells. Polyspecific (anti-IgG plus anti-C3d) is the standard.
- **Thawed plasma** — Plasma component thawed from frozen and stored at 1 to 6 degrees C for use within the lab's validated stability window.
- **TA-GVHD** — Transfusion-Associated Graft-Versus-Host Disease; rare but typically fatal complication where donor lymphocytes engraft and attack the recipient. Prevented by irradiation of cellular components for at-risk recipients.
- **Leukoreduction** — Reduction of white blood cells in a cellular blood component to below an FDA-defined threshold (less than 5 x 10^6 residual leukocytes per unit). Reduces febrile non-hemolytic reactions, HLA alloimmunization, and CMV transmission risk.
- **External release** — Issue of a blood component to an organization other than the lab's parent facility. Requires a written sharing agreement, an emergency request from a recognized facility, or an FDA recall/look-back response. Medical director or designee reviews every non-routine emergency external release within 5 business days.
- **Daily QC** — The CLIA-required reactivity testing performed at the start of each day of patient immunohematology testing per 42 CFR 493.1273(a): reagent red cells, antisera, antiglobulin reagent (against IgG-sensitized control), and negative controls. Failed daily QC pauses patient testing on the affected reagent until resolution.

### Source-side coverage check


#### Source #42: Blood and Blood Component Inventory Management Policy

_(6 statements · 5 steps · 2 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Components are received from the supplier with documented chain of custody; receipt is logged with unit number, ABO/Rh, expiration, date/time, supplier, and the receiving staff member.
2. [🚩 LOW OVERLAP] Inventory is stored under the component-specific conditions and rotated FEFO (First Expiry First Out) for issue.
3. [🚩 LOW OVERLAP] Inventory levels are managed against a defined minimum-on-hand for each component and ABO/Rh group, with reorder triggers; the medical director or designee approves the inventory targets.
4. [🚩 LOW OVERLAP] Daily inventory reconciliation confirms physical count matches the LIS or paper record; discrepancies trigger investigation.
5. [🚩 LOW OVERLAP] Expired components, components received in unacceptable condition, and components returned in unacceptable condition are quarantined and disposed of per the Component Disposal procedure; disposal is documented.
6. [🚩 LOW OVERLAP] Inventory records are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [⚠️  partial] On receipt, the staff member verifies the supplier paperwork against physical units (count, ABO/Rh, expiration); discrepancies trigger immediate supplier notification.
2. [🚩 LOW OVERLAP] Units are entered into the LIS or paper inventory log and placed in storage at FEFO position.
3. [🚩 LOW OVERLAP] Daily reconciliation by the transfusion service staff confirms physical count matches inventory record.
4. [🚩 LOW OVERLAP] When a unit nears expiration, it is flagged for use-first or, if unsuitable for use, quarantined for disposal.
5. [✓ (100%)] Disposal is logged with unit number, reason, disposal route, and staff member.

**Source definitions:**

- [✓] **FEFO** — First Expiry First Out. Rotation rule that issues the unit with the earliest expiration first to minimize waste.
- [✓] **Chain of custody** — Documented continuous tracking of a component from supplier to issue, with no unaccounted-for time.


#### Source #44: Blood Component Release to External Organizations Policy

_(4 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (64%)] Release of components to an external organization occurs only under a written sharing agreement, an emergency request from a recognized facility, or an FDA recall/look-back response.
2. [🚩 LOW OVERLAP] Released components are documented with: unit number, ABO/Rh, expiration, receiving organization, requesting clinician (if emergency), date/time, packaging and transport conditions, and the releasing technologist.
3. [🚩 LOW OVERLAP] Components are packaged for transport per the component's validated transport requirements; receipt acknowledgment is obtained from the receiving organization.
4. [⚠️  partial] The medical director or designee is notified of any emergency release to an external organization; documentation is reviewed within 5 business days.

**Source procedure_steps:**

1. [⚠️  partial] On request, the technologist verifies the requesting organization, the indication (sharing agreement, emergency, recall), and obtains the medical director or designee authorization for non-routine releases.
2. [🚩 LOW OVERLAP] Components are pulled, packaged per transport requirements, and released with the documentation listed in the policy statements.
3. [🚩 LOW OVERLAP] Receipt acknowledgment is obtained and filed.
4. [⚠️  partial] Documentation is reviewed by the medical director or designee within 5 business days for non-routine releases.

**Source definitions:**

- [✓] **External release** — Issue of a blood component to an organization other than <<LAB_NAME>>'s parent facility.


#### Source #45: Blood Transport, Storage, and Return Policy

_(6 statements · 5 steps · 3 definitions)_

**Source policy_statements:**

1. [⚠️  partial] Red blood cells are stored between 1 and 6 deg C; platelets are stored at 20-24 deg C with continuous gentle agitation; fresh frozen plasma is stored at -18 deg C or colder; cryoprecipitate is stored at -18 deg C or colder. Manufacturer's instructions or the most stringent of regulatory and manufacturer requirements apply.
2. [⚠️  partial] Refrigerator, freezer, and platelet incubator temperatures are continuously monitored with audible alarms; alarm thresholds are set inside the storage range so corrective action begins before excursion. Temperature monitoring records are retained.
3. [✓ (88%)] Components issued for transfusion are transported in validated coolers (red cells), unpacked validated containers (platelets), or insulated containers per the component's requirements. Transport time and temperature are documented for storage validation.
4. [✓ (88%)] Components returned to inventory are accepted only if they have been continuously in approved conditions: red cells returned within 30 minutes of issue (or longer if validated cooler maintained 1-10 deg C per current standards and component integrity is intact); platelets, FFP, and cryo per the lab's validated return criteria.
5. [⚠️  partial] Returned components that do not meet acceptance criteria are quarantined and discarded per the lab's component disposal procedure; the discard is documented.
6. [🚩 LOW OVERLAP] Storage alarm response: any alarm triggers immediate investigation, temperature read at the affected location, component triage (accept, quarantine, or discard), and documentation per the Blood Storage Alarm Response procedure.

**Source procedure_steps:**

1. [✓ (73%)] Daily, the transfusion service verifies refrigerator, freezer, and platelet incubator temperatures against the lab's acceptance range; any out-of-range reading triggers immediate investigation.
2. [✓ (100%)] On component issue: pack per the component's transport requirements (red cells in validated cooler with monitored temperature, platelets without agitation interruption beyond validated time, FFP frozen); document issue time, courier, destination.
3. [✓ (100%)] On component return: confirm transport conditions (cooler temperature in range, component appearance intact, time-since-issue within validated return window); accept or quarantine per the criteria; document.
4. [✓ (50%)] On storage alarm: respond immediately, read affected location temperature, triage components (accept, quarantine, discard), notify the medical director or designee for any quarantine or discard event, document on the Storage Alarm Response log.
5. [🚩 LOW OVERLAP] Discarded components are recorded on the Component Disposal log with reason, quantity, and disposal route.

**Source definitions:**

- [✓] **Validated cooler** — A transport cooler whose temperature performance has been documented to maintain components within the required temperature range for a defined duration. Validation is repeated periodically per the lab's cooler validation schedule.
- [✓] **Return window** — The lab's defined maximum time during which a transported component may be returned to inventory and reissued. Set per component type based on storage validation.
- [✓] **Storage alarm** — Audible and visual notification that a refrigerator, freezer, or platelet incubator is outside its set acceptance range. Triggers immediate response and component triage.


#### Source #46: Blood Storage Alarm Response Policy

_(6 statements · 6 steps · 2 definitions)_

**Source policy_statements:**

1. [⚠️  partial] Every refrigerator, freezer, and platelet incubator used for blood component storage has continuous temperature monitoring with audible/visual alarms; alarms trigger immediate response 24/7.
2. [✓ (73%)] Alarm thresholds are set inside the regulatory storage range so corrective action begins before the storage range is exceeded.
3. [🚩 LOW OVERLAP] On alarm, the responder verifies the temperature, identifies the cause (door open, power loss, equipment failure), and triages stored components (continue use, move to backup, quarantine).
4. [🚩 LOW OVERLAP] If components were exposed to out-of-range temperature beyond the validated tolerance, they are quarantined and reviewed by the medical director or designee for disposition.
5. [🚩 LOW OVERLAP] Every alarm event is logged on the Storage Alarm Response log with timestamp, cause, response actions, components affected, and disposition.
6. [🚩 LOW OVERLAP] Monthly review of the Storage Alarm Response log by the medical director or designee identifies trends and prompts equipment replacement or process change.

**Source procedure_steps:**

1. [⚠️  partial] On alarm, the on-duty technologist responds immediately, verifies the temperature on the local display and the centralized monitoring (if any).
2. [🚩 LOW OVERLAP] Cause is identified: door left open (close, allow re-equilibration), power loss (verify backup power), equipment failure (initiate equipment-out-of-service process and move components to backup).
3. [🚩 LOW OVERLAP] Components are triaged: if storage remained within range, continue use; if exposed to out-of-range, quarantine.
4. [🚩 LOW OVERLAP] Quarantined components are reviewed by the medical director or designee with the alarm data; disposition (return to inventory, discard) is documented.
5. [⚠️  partial] The Storage Alarm Response log is completed with timestamp, cause, response, components affected, and disposition.
6. [🚩 LOW OVERLAP] Equipment failures trigger an IT/facilities ticket; failed monitoring devices are replaced before storage resumes.

**Source definitions:**

- [✓] **Storage alarm** — Audible/visual notification that a component-storage device is outside its set acceptance range.
- [✓] **Quarantine** — Hold status placed on a component pending medical director or designee disposition decision after a temperature excursion or other quality concern.


#### Source #47: Blood Bank Reagent Criteria Policy

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Blood bank reagents are FDA-cleared and used per the manufacturer's instructions; modified or non-cleared reagents are not used without performance establishment per the Method Verification policy and medical director or designee approval.
2. [✓ (91%)] Reactivity QC on reagents is performed each day of use per 42 CFR 493.1273(a): reagent red cells confirmed reactive, antisera confirmed reactive with known antigen-positive reference cells, antiglobulin reagent confirmed reactive with IgG-sensitized reference cells, negative controls confirmed non-reactive.
3. [✓ (87%)] Reagent lot acceptance: new lots are parallel-tested against the prior lot and against patient samples covering the expected range of reactivity; acceptance is documented before placing the new lot into service.
4. [🚩 LOW OVERLAP] Storage of reagents per manufacturer instructions; expired reagents are removed from inventory and discarded.
5. [🚩 LOW OVERLAP] Reagent QC records and lot acceptance documentation are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On reagent receipt, log lot, expiration, date, and store per manufacturer instructions.
2. [✓ (67%)] Each day of use, perform reactivity QC per 42 CFR 493.1273(a); failed QC pauses patient testing on the affected reagent.
3. [✓ (91%)] On new-lot introduction, perform parallel testing against the prior lot using reference cells and patient samples; document acceptance.
4. [🚩 LOW OVERLAP] Discard expired reagents and log the disposal.

**Source definitions:**

- [✓] **Reactivity QC** — Daily-of-use quality control on blood bank reagents confirming each reagent performs as expected with known reference cells.
- [✓] **Antiglobulin reagent (Coombs reagent)** — Reagent containing antibodies to human immunoglobulin used to detect antibody bound to red cells. Polyspecific (anti-IgG plus anti-complement) or monospecific (anti-IgG only).


#### Source #48: Reagent Reactivity Testing Policy (Blood Bank)

_(4 statements · 3 steps · 1 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Each day of patient immunohematology testing, the technologist performs reactivity QC on every in-use reagent per 42 CFR 493.1273(a) before patient testing begins.
2. [🚩 LOW OVERLAP] QC results (positive controls reactive, negative controls non-reactive) are documented on the daily QC log with date, technologist, reagent lot, control material lot, and accept/reject decision.
3. [🚩 LOW OVERLAP] Failed QC pauses patient testing on the affected reagent until the issue is resolved (reagent replaced, new lot opened, instrument issue corrected); the resolution is documented.
4. [🚩 LOW OVERLAP] QC review by the technical supervisor or designee occurs weekly; the medical director or designee performs the monthly review per the Quality Control Plan policy.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At the start of each shift performing immunohematology testing, the technologist runs the required QC: reagent red cells with positive and negative antisera, antisera with known antigen-positive and antigen-negative reference cells, antiglobulin reagent with IgG-sensitized control cells.
2. [🚩 LOW OVERLAP] Each QC result is recorded; failed QC triggers immediate investigation and resolution before patient testing.
3. [🚩 LOW OVERLAP] Daily QC log is filed; weekly and monthly reviews are documented and signed.

**Source definitions:**

- [✓] **Daily QC** — The CLIA-required reactivity testing performed at the start of each day of patient immunohematology testing per 42 CFR 493.1273(a).


#### Source #55: Plasma Component Processing and Transfusion Policy

_(5 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] FFP and FP24 are stored at -18 deg C or colder; thawed plasma is stored at 1-6 deg C and used within the validated thawed-stability window per the lab's procedure.
2. [✓ (100%)] Thawing is performed in a validated plasma thawer (water bath or dry heat) per the manufacturer's instructions and the lab's procedure; thaw time and temperature are documented.
3. [✓ (88%)] ABO-compatibility for plasma issue: AB plasma is universal; A plasma is compatible with A and O recipients; B plasma is compatible with B and O recipients; O plasma is compatible only with O recipients.
4. [🚩 LOW OVERLAP] Plasma issued is documented with unit number, ABO, expiration, recipient, issue time, and technologist; bedside check confirms patient ID and component before transfusion.
5. [🚩 LOW OVERLAP] Records are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On request, the technologist verifies the order, the recipient's ABO/Rh, and selects ABO-compatible plasma.
2. [🚩 LOW OVERLAP] Plasma is thawed in the validated thawer; thaw time and temperature are documented.
3. [🚩 LOW OVERLAP] Issue documentation is completed and the unit is released for transfusion.
4. [🚩 LOW OVERLAP] Bedside check by two clinical staff occurs immediately before transfusion.

**Source definitions:**

- [✓] **Thawed plasma** — Plasma component thawed from frozen and stored at 1-6 deg C for use within the lab's validated stability window.


#### Source #56: Blood Irradiation Policy

_(5 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (86%)] Irradiated cellular blood components (red cells, platelets, granulocytes) are issued to patients at risk of transfusion-associated graft-versus-host disease (TA-GVHD): intrauterine and neonatal transfusion, HLA-matched units, units from biologic relatives, hematologic malignancy, hematopoietic stem cell transplant recipients, congenital immunodeficiency, and other indications per the medical director or designee's approved list.
2. [🚩 LOW OVERLAP] Indications are flagged in the LIS by diagnosis or by clinician order; the transfusion service confirms the irradiation requirement at each component issue.
3. [🚩 LOW OVERLAP] Irradiated components are sourced from a supplier with documented irradiation capability OR irradiated on-site if the lab holds the appropriate license and equipment.
4. [🚩 LOW OVERLAP] Irradiation is verified by the indicator on the unit (radiation-sensitive label) and by supplier documentation; units without acceptable irradiation evidence are not issued to patients requiring irradiation.
5. [🚩 LOW OVERLAP] Records of irradiation status are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On order receipt, the transfusion service checks the patient's irradiation indication; if positive, only irradiated units are selected.
2. [✓ (50%)] Selected units are verified for irradiation evidence (indicator label, supplier documentation).
3. [🚩 LOW OVERLAP] Issue and bedside check confirm the irradiation requirement was met.
4. [⚠️  partial] Any patient with a new irradiation indication is flagged in the LIS for ongoing future transfusions.

**Source definitions:**

- [✓] **TA-GVHD** — Transfusion-Associated Graft-Versus-Host Disease, a rare but typically fatal complication where donor lymphocytes attack the recipient. Prevented by irradiating cellular components for at-risk patients.


#### Source #57: Leukoreduction Policy

_(4 statements · 3 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Leukoreduced cellular components are issued to patients at risk of CMV transmission, febrile non-hemolytic transfusion reactions, HLA-alloimmunization, or per the medical director or designee's approved indication list.
2. [🚩 LOW OVERLAP] Leukoreduction may be performed at the supplier (pre-storage filtration with documented compliance to FDA residual leukocyte criteria) or at the bedside via leukoreduction filter; pre-storage leukoreduction is the lab's standard when supplier-supported.
3. [✓ (100%)] The supplier's certificate of leukoreduction (or unit labeling indicating leukoreduced status) is verified at receipt and at issue.
4. [🚩 LOW OVERLAP] Records of leukoreduction status are retained per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On order receipt, transfusion service confirms whether the patient indication requires leukoreduction.
2. [🚩 LOW OVERLAP] Selected units are verified for leukoreduced status (supplier documentation or unit label).
3. [🚩 LOW OVERLAP] Issue and bedside check confirm leukoreduction status.

**Source definitions:**

- [✓] **Leukoreduction** — Reduction of white blood cells in a cellular blood component to below an FDA-defined threshold (<5x10^6 per unit for red cells). Reduces risk of CMV transmission, febrile reactions, and HLA-alloimmunization.


---

## Combined #100

**Combined policy_name:** Transfusion Administration Policy

**Source IDs absorbed:** 52, 53, 54, 58, 59, 60


### Combined content (what we ship)

**policy_statements:**

1. At component issue, the issuing technologist verifies that patient name and second identifier on the issue slip match the unit's patient assignment tag, ABO/Rh on the unit matches the patient's compatible result, expiration is current, and visual inspection shows no abnormality.
2. At the bedside immediately before transfusion, two qualified clinical staff independently verify the patient identity against the unit's patient assignment tag and the component label (ABO/Rh, unit number, expiration); both staff sign the bedside check. If any element fails verification, the transfusion is NOT started; the component is returned to the transfusion service and the discrepancy is investigated.
3. Emergency release of blood is invoked only by a physician who certifies in writing that the urgency of the patient's condition does not permit completion of pretransfusion testing. The physician's signature and certification language are required at the time of release or as soon thereafter as practical.
4. Group O red cells are issued by default for emergency release: Group O Rh-negative for women of childbearing potential; Group O Rh-positive otherwise. Type-specific units may be issued if a current ABO/Rh result is on file at <<LAB_NAME>>.
5. Pretransfusion testing (ABO/Rh, antibody screen, crossmatch) is completed as soon as feasible on the patient specimen drawn before or concurrent with the emergency release; any incompatibility is reported to the ordering physician immediately. The medical director or designee reviews every emergency release within 5 business days; the review is signed and documented.
6. Rh Immune Globulin (RhIG) is offered to every D-negative woman who is pregnant or postpartum with a D-positive infant, who has had a pregnancy loss or termination, or who has experienced a fetomaternal hemorrhage event. The standard antepartum dose is one vial (300 mcg) at approximately 28 weeks gestation; the standard postpartum dose is one vial within 72 hours of delivery of a D-positive infant.
7. Fetomaternal hemorrhage (FMH) screening (rosette test or equivalent) is performed on the postpartum maternal sample of every D-negative woman delivering a D-positive infant; positive screens trigger quantitative testing (Kleihauer-Betke or flow cytometry) and dose adjustment.
8. RhIG dose calculation for FMH greater than 30 mL fetal whole blood: one additional vial per 30 mL fetal whole blood (or equivalent calculation per the manufacturer's instructions); the calculation is documented and verified by a second technologist or the medical director or designee.
9. Neonatal transfusion (recipient under 4 months of age) follows pediatric-specific rules: reverse ABO typing is NOT performed; the lab uses the mother's antibody screen result if maternal specimen is available; small-volume aliquots are prepared from approved parent units with full traceability to the parent unit; the medical director or designee approves the standing component-selection protocol (CMV-safe, irradiated, fresh, volume-reduced as clinically indicated).
10. Intrauterine transfusion follows the obstetric specialist's order with components selected per the parent-unit ABO compatibility rules for the mother and fetus. Exchange transfusion follows the medical director or designee-approved component-selection protocol for the indication.
11. Transfusion is monitored by qualified clinical staff: baseline vitals immediately before transfusion start, vitals at 15 minutes (when the highest risk of reaction occurs), and at completion. Visual observation continues throughout. Any sign of adverse reaction triggers immediate transfusion stop.
12. On suspected transfusion reaction, the clinical staff stops the transfusion, keeps the IV line open with normal saline, retains the unit and tubing, and notifies the transfusion service immediately. The transfusion service workup includes clerical check first, visual inspection of post-transfusion specimen for hemolysis, repeat ABO/Rh on pre- and post-transfusion specimens, direct antiglobulin test (DAT) on the post-transfusion specimen, and additional testing as ordered by the medical director or designee.
13. Confirmed fatal transfusion reactions are reported to FDA Center for Biologics Evaluation and Research (CBER) as soon as possible by telephone or electronic transmission; the written report is submitted within 7 days per 21 CFR 606.170(b).
14. Adverse reactions and their investigation outcomes are documented in the transfusion reaction file per 21 CFR 606.170; the Transfusion Adverse Event Register is reviewed quarterly by the medical director or designee.

**procedure_steps:**

1. At issue, the technologist completes the issue slip with patient identifiers and unit identifiers; both are verified visually against the unit label and the crossmatch record.
2. At the bedside, two clinical staff independently verify patient against unit per the bedside check procedure; both sign. Any discrepancy halts the transfusion and triggers transfusion service notification.
3. For emergency release, the ordering physician provides certification (verbal at time of request, written within the same shift); transfusion service issues Group O red cells (Rh-negative for women of childbearing potential, Rh-positive otherwise) unless current ABO/Rh on file supports type-specific issue; the technologist documents patient ID, unit numbers, date/time, physician, certification status, and technologist initials.
4. The patient specimen drawn before or concurrent with the emergency release is processed for full pretransfusion testing as soon as the emergency is contained; results are reported promptly to the ordering physician.
5. For RhIG, the transfusion service confirms the indication and the patient's D-negative status. For postpartum issue to a D-negative mother of a D-positive infant, perform rosette test (or equivalent FMH screen) on the maternal sample; if negative, issue one standard vial; if positive, perform quantitative FMH (Kleihauer-Betke or flow cytometry) and calculate dose (one additional vial per 30 mL fetal whole blood).
6. Dose calculation is verified by a second technologist or the medical director or designee and documented. Pull the calculated number of vials; verify lot, expiration, and integrity; document dose, lot, route, and administration time.
7. For neonatal transfusion (under 4 months), perform forward ABO only (no reverse), use mother's antibody screen if available, prepare aliquots from approved parent units with documented traceability; the medical director or designee-approved protocol guides component selection.
8. Clinical staff record baseline vitals immediately before transfusion start, then at 15 minutes and at completion; visual observation is continuous.
9. On suspected reaction, clinical staff stops the transfusion, keeps the IV line open with normal saline, retains the unit and tubing, and notifies transfusion service and the ordering physician immediately. Post-transfusion specimen (EDTA tube), remaining component, and IV tubing are sent to the transfusion service.
10. Transfusion service performs the workup: clerical check first; visual inspection of post-transfusion specimen for hemolysis; repeat ABO/Rh on pre- and post-transfusion specimens; DAT on post-transfusion specimen; additional testing per the medical director or designee.
11. If the reaction is confirmed fatal, the medical director or designee notifies FDA CBER as soon as possible by phone or electronic transmission; the written 7-day report is submitted per 21 CFR 606.170(b).
12. Findings are documented on the Transfusion Reaction Investigation form; the medical director or designee signs the conclusion; entry is closed on the Transfusion Adverse Event Register when investigation is complete.
13. Quarterly, the medical director or designee reviews the Adverse Event Register for trend; recurring patterns trigger root-cause analysis and process change.

**definitions:**

- **Two-identifier verification** — Independent confirmation of recipient identity using two of: name, DOB, MRN, account number; performed at specimen draw and at component issue.
- **Bedside check** — Two-staff independent verification of patient identity against the unit immediately before transfusion; both staff sign.
- **Emergency release** — Issue of blood components without full pretransfusion testing under a physician certification that the urgency does not permit testing. Group O red cells are the default.
- **Physician certification** — Written statement signed by the ordering physician justifying the emergency release. Required by FDA 21 CFR 606.151(d).
- **RhIG** — Rh Immune Globulin; concentrated anti-D antibody preparation administered to D-negative individuals to prevent anti-D alloimmunization after exposure to D-positive red cells.
- **Fetomaternal hemorrhage (FMH)** — Transfer of fetal red cells into the maternal circulation, typically at delivery. May exceed the volume covered by a standard RhIG dose, requiring quantitative measurement.
- **Rosette test** — Qualitative screening test for fetomaternal hemorrhage. Negative result confirms FMH is below the threshold covered by a standard RhIG dose; positive triggers quantitative testing.
- **Kleihauer-Betke / flow cytometry** — Quantitative methods for measuring the volume of fetal red cells in the maternal circulation, used to calculate RhIG dose when the rosette test is positive.
- **Neonatal transfusion** — Transfusion of a patient under 4 months of age. Specific rules apply for ABO typing, maternal antibody use, and aliquot preparation.
- **Aliquot** — A sub-volume of a parent blood component, prepared sterilely with full traceability to the parent unit.
- **TRALI** — Transfusion-Related Acute Lung Injury; serious adverse reaction with acute hypoxemia during or within 6 hours of transfusion.
- **DAT (Direct Antiglobulin Test)** — Test that detects antibody or complement bound to a patient's red cells; positive on a post-transfusion specimen suggests immune hemolysis.
- **Transfusion reaction** — Any adverse event during or after transfusion of a blood component. May be immune (acute hemolytic, allergic, febrile non-hemolytic), non-immune (volume overload, sepsis from bacterial contamination), or delayed.
- **Transfusion adverse event** — Any unexpected occurrence during or after transfusion that may be related to the transfusion. Includes confirmed reactions and suspected reactions still under investigation. Tracked on the Transfusion Adverse Event Register.
- **Transfusion Adverse Event Register** — The lab's central log of all suspected and confirmed transfusion adverse events, used for individual investigation closure and aggregate trend analysis. Reviewed quarterly by the medical director or designee.
- **Clerical check** — First step of every transfusion reaction investigation: confirm the patient receiving the component matches the component label and the transfusion service records. A mismatch triggers immediate medical director or designee notification.

### Source-side coverage check


#### Source #52: Donor and Recipient Blood Identification Policy

_(4 statements · 3 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (85%)] At component issue from the transfusion service, the issuing technologist verifies: patient name and second identifier on the issue slip match the unit's patient assignment tag; ABO/Rh on the unit matches the patient's compatible result; expiration is current; visual inspection shows no abnormality.
2. [✓ (100%)] At the bedside immediately before transfusion, two qualified clinical staff independently verify the patient identity against the unit's patient assignment tag and the component label (ABO/Rh, unit number, expiration); both staff sign the bedside check.
3. [✓ (100%)] If any element fails verification, the transfusion is NOT started; the component is returned to the transfusion service and the discrepancy is investigated.
4. [🚩 LOW OVERLAP] All identification verifications (issue slip, bedside check) are documented and retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [✓ (100%)] At issue, the technologist completes the issue slip with patient identifiers and unit identifiers; both are verified visually against the unit label and the crossmatch record.
2. [✓ (100%)] At the bedside, two clinical staff independently verify patient against unit per the bedside check procedure; both sign.
3. [✓ (100%)] Any discrepancy halts the transfusion and triggers transfusion service notification.

**Source definitions:**

- [✓] **Bedside check** — Two-staff independent verification of patient identity against the unit immediately before transfusion start. The most critical control against ABO-mismatch.


#### Source #53: Emergency Release of Blood Policy

_(6 statements · 6 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (90%)] Emergency release is invoked only by a physician who certifies in writing that the urgency of the patient's condition does not permit completion of pretransfusion testing. The physician's signature and the certification language are required at the time of release or as soon thereafter as practical.
2. [✓ (50%)] Group O red cells are issued by default (Group O Rh-negative for women of childbearing potential, Group O Rh-positive otherwise) unless a current ABO/Rh result is available on the patient at <<LAB_NAME>>.
3. [✓ (100%)] Pretransfusion testing (ABO/Rh, antibody screen, crossmatch) is completed as soon as feasible on the patient specimen drawn before or concurrent with the emergency release; any incompatibility is reported to the ordering physician immediately.
4. [🚩 LOW OVERLAP] Every emergency release is documented in the transfusion service record with: patient identifier, components issued (unit number, ABO/Rh), date/time of issue, physician name and signature on the emergency certification, technologist, and any subsequent pretransfusion test results.
5. [⚠️  partial] All emergency release events are reviewed by the medical director or designee within 5 business days; the review is signed and documented.
6. [🚩 LOW OVERLAP] Emergency release records are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [⚠️  partial] Ordering physician requests emergency release and provides certification (verbal at time of request, written within the same shift). The certification states that delay for full pretransfusion testing would risk patient life.
2. [✓ (81%)] Transfusion service issues Group O red cells (Rh-negative for women of childbearing potential, Rh-positive otherwise) unless a current ABO/Rh on file at <<LAB_NAME>> supports type-specific issue.
3. [⚠️  partial] The technologist documents the issue: patient ID, unit numbers issued, date/time, ordering physician, certification status, technologist initials.
4. [✓ (100%)] The patient specimen drawn before or concurrent with the emergency release is processed for full pretransfusion testing as soon as the emergency is contained; results are reported promptly to the ordering physician.
5. [🚩 LOW OVERLAP] If any incompatibility is detected on subsequent testing, the ordering physician is notified immediately.
6. [⚠️  partial] The medical director or designee reviews the event within 5 business days and signs the review.

**Source definitions:**

- [✓] **Emergency release** — Issue of blood components without full pretransfusion testing under a physician certification that the urgency of the patient's condition does not permit delay.
- [✓] **Physician certification** — Written statement signed by the ordering physician justifying the emergency action. Required by FDA 21 CFR 606.151(d).


#### Source #54: Rh Immune Globulin (RhIG) Administration Policy

_(7 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [✓ (53%)] RhIG is offered to every D-negative woman who is pregnant or postpartum with a D-positive infant, who has had a pregnancy loss or termination, or who has experienced a fetomaternal-hemorrhage event. The indication is determined by the ordering clinician based on patient circumstances.
2. [✓ (64%)] Standard antepartum dose is one vial (300 mcg) administered at approximately 28 weeks gestation; the postpartum dose is one vial within 72 hours of delivery of a D-positive infant.
3. [✓ (100%)] Fetomaternal hemorrhage (FMH) screening (rosette test or equivalent) is performed on the postpartum maternal sample of every D-negative woman delivering a D-positive infant; positive screens trigger quantitative testing (Kleihauer-Betke or flow cytometry) and dose adjustment.
4. [✓ (100%)] RhIG dose calculation for FMH greater than 30 mL fetal whole blood: one additional vial per 30 mL fetal whole blood (or equivalent calculation per the manufacturer's instructions); the calculation is documented and verified by a second technologist or the medical director or designee.
5. [🚩 LOW OVERLAP] Every RhIG issue is documented in the transfusion service record with: patient identifier, indication, dose (vial count, lot, expiration), date/time of issue, ordering clinician, technologist, and (where applicable) FMH screen result and calculation.
6. [🚩 LOW OVERLAP] RhIG storage follows the manufacturer's instructions; expired RhIG is removed from inventory and not issued.
7. [🚩 LOW OVERLAP] Records are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [⚠️  partial] On order receipt, the transfusion service confirms the indication and the patient's D-negative status (current type on file or new type).
2. [✓ (89%)] For postpartum issue to a D-negative mother of a D-positive infant: perform rosette test (or equivalent FMH screen) on the maternal sample; if negative, issue one standard vial; if positive, perform quantitative FMH and calculate dose.
3. [✓ (100%)] Dose calculation is verified by a second technologist or the medical director or designee and documented.
4. [✓ (57%)] Pull the calculated number of vials from inventory; verify lot, expiration, and integrity; document.
5. [🚩 LOW OVERLAP] Issue to the patient location with full documentation; the ordering clinician administers and documents the administration in the patient chart.
6. [🚩 LOW OVERLAP] File the transfusion service record with the 10-year retention flag.

**Source definitions:**

- [✓] **RhIG (Rh Immune Globulin)** — Concentrated anti-D antibody preparation administered to D-negative individuals to prevent anti-D alloimmunization following exposure to D-positive red cells.
- [✓] **Fetomaternal hemorrhage (FMH)** — Transfer of fetal red cells into the maternal circulation, typically at delivery. May exceed the volume covered by a standard RhIG dose, requiring quantitative measurement and dose adjustment.
- [✓] **Rosette test** — Qualitative screening test for fetomaternal hemorrhage. Negative result confirms FMH is below the threshold covered by one standard vial of RhIG; positive triggers quantitative testing.


#### Source #58: Transfusion and Neonatal Transfusion Policies

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Routine adult and pediatric transfusion follows the Compatibility Testing policy and the bedside identification controls per the Donor and Recipient Blood Identification policy.
2. [✓ (67%)] Neonatal transfusion (under 4 months of age) follows pediatric-specific rules: reverse ABO typing is NOT performed; the lab uses the mother's antibody screen result if mother's specimen is available; small-volume aliquots are prepared from approved parent units per the lab's aliquot preparation procedure with full traceability to the parent unit.
3. [✓ (100%)] Intrauterine transfusion follows the obstetric specialist's order with components selected per the parent-unit ABO compatibility rules for the mother and fetus.
4. [✓ (58%)] Exchange transfusion follows the medical director or designee-approved component-selection protocol for the indication (neonatal hyperbilirubinemia, sickle cell crisis, etc.).
5. [🚩 LOW OVERLAP] All neonatal transfusions are documented with the same elements as adult transfusions, with the addition of the maternal antibody screen status when applicable.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Routine transfusions follow the standard Compatibility Testing procedure.
2. [✓ (83%)] For neonatal transfusion: forward ABO only (no reverse), use mother's antibody screen if available, prepare aliquots from approved parent units with documented traceability.
3. [🚩 LOW OVERLAP] Intrauterine and exchange transfusion follow medical director or designee-approved protocols.
4. [🚩 LOW OVERLAP] Documentation is complete and retained per the 10-year retention rule.

**Source definitions:**

- [✓] **Neonatal transfusion** — Transfusion of a patient under 4 months of age. Specific rules apply for ABO typing, maternal antibody utilization, and small-volume aliquot preparation.
- [✓] **Aliquot** — A sub-volume of a parent component, prepared sterilely with full traceability to the parent unit.


#### Source #59: Transfusion Monitoring and Adverse Event Reporting Policy

_(5 statements · 5 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (74%)] Every transfusion is monitored by qualified clinical staff: baseline vitals before the transfusion starts, vitals at 15 minutes (when the highest risk of reaction occurs), and at completion. Visual observation continues throughout.
2. [🚩 LOW OVERLAP] Any sign of adverse reaction (fever, chills, hypotension, dyspnea, urticaria, hemoglobinuria, pain at the infusion site, unusual change in patient status) triggers immediate transfusion stop and notification of the transfusion service per the Transfusion Reaction Investigation policy.
3. [🚩 LOW OVERLAP] All confirmed reactions are logged on the Transfusion Adverse Event Register with: date, patient, component, reaction type, severity, investigation outcome, and any reporting to external authorities.
4. [🚩 LOW OVERLAP] Quarterly, the medical director or designee reviews the Adverse Event Register for trend; recurring patterns trigger root-cause analysis and process change.
5. [🚩 LOW OVERLAP] Records of adverse events and investigations are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [✓ (100%)] Clinical staff record baseline vitals immediately before transfusion start, then at 15 minutes and at completion; visual observation is continuous.
2. [🚩 LOW OVERLAP] Any adverse sign triggers transfusion stop; the IV line is kept open with normal saline; the transfusion service is notified per the Transfusion Reaction Investigation policy.
3. [🚩 LOW OVERLAP] The clinical event, vitals, intervention, and patient outcome are documented in the patient chart and on the Transfusion Adverse Event Register.
4. [🚩 LOW OVERLAP] Transfusion service performs the investigation; the conclusion is filed and the Adverse Event Register entry is closed when the investigation is complete.
5. [⚠️  partial] Quarterly review by the medical director or designee summarizes incidents, trends, and any required corrective action.

**Source definitions:**

- [✓] **Transfusion adverse event** — Any unexpected occurrence during or after transfusion that may be related to the transfusion. May be immune-mediated, non-immune, infectious, or related to volume.
- [✓] **Transfusion Adverse Event Register** — The lab's central log of all suspected and confirmed transfusion adverse events, used for individual investigation closure and aggregate trend analysis.


#### Source #60: Transfusion Reaction Investigation Policy

_(8 statements · 7 steps · 3 definitions)_

**Source policy_statements:**

1. [⚠️  partial] Any suspected transfusion reaction is reported to <<LAB_NAME>> transfusion service immediately; the transfusion is stopped and the IV line is kept open with normal saline.
2. [🚩 LOW OVERLAP] Clerical check is performed first: confirm patient identity matches the component label, confirm component matches the patient's records.
3. [🚩 LOW OVERLAP] A post-transfusion specimen (EDTA tube) is collected from the patient and sent with the remaining component, IV tubing, and any unused components to the transfusion service for workup.
4. [✓ (63%)] Investigation includes: clerical check, visual inspection of post-transfusion specimen for hemolysis, repeat ABO/Rh on pre- and post-transfusion specimens, direct antiglobulin test (DAT) on post-transfusion specimen, comparison of post-transfusion to pre-transfusion specimen.
5. [🚩 LOW OVERLAP] Additional testing (antibody screen, antibody ID, repeat crossmatch, culture of component if bacterial contamination is suspected) is performed as indicated by the workup findings and the medical director or designee's judgment.
6. [🚩 LOW OVERLAP] Every suspected reaction is documented on the Transfusion Reaction Investigation form: clinical signs, component identification, workup steps, findings, conclusion, and signature of the medical director or designee.
7. [🚩 LOW OVERLAP] Confirmed fatal reactions are reported to FDA CBER by telephone or electronic transmission as soon as possible, with a written report within 7 days per 21 CFR 606.170(b).
8. [🚩 LOW OVERLAP] Transfusion reaction records are retained for at least 10 years per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [✓ (53%)] Clinical staff stops the transfusion at the first sign of suspected reaction, keeps the IV line open with normal saline, and notifies the transfusion service and the ordering physician immediately.
2. [🚩 LOW OVERLAP] Transfusion service receives the post-transfusion specimen, the remaining component (clamped), and any unused components.
3. [🚩 LOW OVERLAP] Clerical check: confirm patient ID matches component label and crossmatch records; any mismatch triggers immediate medical director or designee notification.
4. [🚩 LOW OVERLAP] Visual inspection of post-transfusion specimen: pink or red plasma suggests intravascular hemolysis; investigation proceeds urgently.
5. [✓ (67%)] Repeat ABO/Rh on pre- and post-transfusion specimens; DAT on post-transfusion specimen; compare to pre-transfusion.
6. [⚠️  partial] Findings are reviewed by the medical director or designee; further testing is ordered as indicated; conclusion is documented on the Transfusion Reaction Investigation form.
7. [✓ (100%)] If the reaction is confirmed to be fatal, the medical director or designee notifies FDA CBER as soon as possible by phone or electronic transmission; the written 7-day report is submitted.

**Source definitions:**

- [✓] **Transfusion reaction** — Any adverse event during or after transfusion of a blood component. May be immune (acute hemolytic, allergic, febrile non-hemolytic), non-immune (volume overload, sepsis from contamination), or delayed.
- [✓] **Clerical check** — First step of every transfusion reaction investigation: confirm the patient receiving the component matches the component label and the transfusion service records.
- [✓] **DAT (Direct Antiglobulin Test)** — Test that detects antibody or complement bound to a patient's red cells; positive on a post-transfusion specimen suggests immune-mediated reaction.


---

## Combined #101

**Combined policy_name:** Blood Recipient Look-Back Policy (HIV and HCV)

**Source IDs absorbed:** 61, 62


### Combined content (what we ship)

**policy_statements:**

1. On notification of HIV or HCV look-back from a blood supplier, the transfusion service identifies all components from the implicated donor units received at the lab and determines disposition (transfused, in inventory, discarded).
2. Recipients of transfused components are identified from the transfusion service records; the recipient's treating physician (or the physician of record at the time of transfusion if the patient has moved) is notified within the FDA-required timeframe with the appropriate HIV-specific or HCV-specific language.
3. In-inventory components from the implicated donor are quarantined immediately and disposed of per FDA recall guidance.
4. Notifications, recipient identifications, and component disposition are documented on the Look-Back log; records are retained per 42 CFR 493.1105(a)(7).
5. The medical director or designee reviews every look-back event and signs the final documentation.

**procedure_steps:**

1. On supplier notification, log the date of receipt, the implicated donor units, the agent (HIV or HCV), and the supplier's communication.
2. Search transfusion service records for components from the implicated donor units; identify transfused recipients with date of transfusion.
3. Notify each recipient's treating physician within the FDA-required timeframe using the HIV-specific (21 CFR 610.46) or HCV-specific (21 CFR 610.47) notification language; document each notification.
4. Quarantine and dispose of in-inventory implicated components per FDA recall guidance; document.
5. Submit the completed Look-Back documentation to the medical director or designee for review and signature; file.

**definitions:**

- **Look-back** — FDA-mandated process initiated when a prior blood donor is found to be infectious for HIV (21 CFR 610.46) or HCV (21 CFR 610.47); recipients of prior components from that donor are identified and treating physicians notified.

### Source-side coverage check


#### Source #61: HIV Look-Back Notification Policy (Blood Recipients)

_(5 statements · 5 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (100%)] On notification of HIV look-back from a blood supplier, the transfusion service identifies all components from the implicated donor units received at the lab and determines disposition (transfused, in inventory, discarded).
2. [✓ (100%)] Recipients of transfused components are identified from the transfusion service records; the recipient's treating physician (or the physician of record at the time of transfusion if the patient has moved) is notified within the FDA-required timeframe.
3. [✓ (100%)] In-inventory components from the implicated donor are quarantined immediately and disposed of per FDA recall guidance.
4. [✓ (100%)] Notifications, recipient identifications, and component disposition are documented on the Look-Back log; records are retained per 42 CFR 493.1105(a)(7).
5. [✓ (100%)] The medical director or designee reviews every look-back event and signs the final documentation.

**Source procedure_steps:**

1. [✓ (67%)] On supplier notification, log the date of receipt, the implicated donor units, and the supplier's communication.
2. [✓ (100%)] Search transfusion service records for components from the implicated donor units; identify transfused recipients with date of transfusion.
3. [✓ (71%)] Notify each recipient's treating physician within the FDA-required timeframe; document each notification.
4. [✓ (100%)] Quarantine and dispose of in-inventory implicated components per FDA recall guidance; document.
5. [✓ (100%)] Submit the completed Look-Back documentation to the medical director or designee for review and signature; file.

**Source definitions:**

- [✓] **Look-back** — Process initiated when a prior blood donor is found to be infectious for HIV (or HCV per 21 CFR 610.47); recipients of prior components from that donor are identified and treating physicians notified.


#### Source #62: HCV Look-Back Notification Policy (Blood Recipients)

_(3 statements · 1 steps · 1 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Look-back triggered by HCV notification follows the same workflow as HIV look-back (see policy #61): identify implicated units, identify recipients, notify treating physicians within FDA-required timeframe, quarantine and dispose of any remaining in-inventory components.
2. [🚩 LOW OVERLAP] HCV-specific notification language and recipient testing recommendations follow current FDA and CDC guidance.
3. [⚠️  partial] All look-back events are documented and reviewed by the medical director or designee; records are retained per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Follow the look-back procedure as documented in the HIV Look-Back policy (#61), substituting HCV-specific notification language and follow-up testing recommendations.

**Source definitions:**

- [✓] **HCV look-back** — FDA-mandated process under 21 CFR 610.47 to identify and notify recipients of components from a donor subsequently found to be HCV-positive.


---

## Combined #102

**Combined policy_name:** Donor Operations Policy

**Source IDs absorbed:** 43, 63, 64, 65


### Combined content (what we ship)

**policy_statements:**

1. For blood components purchased from a supplier, <<LAB_NAME>> maintains a written supplier agreement covering: components and quantities, ordering process, delivery and emergency-delivery commitments, packaging and transport temperature commitments, recall and look-back communication, billing, and term/termination.
2. Every blood supplier holds a current FDA registration as a blood establishment per 21 CFR 607; registration is verified at contracting and at each renewal.
3. Supplier performance (on-time delivery, recall responsiveness, component quality, customer service) is reviewed annually; the review is signed by the medical director or designee and filed. Recurring issues trigger discussion and may trigger supplier change.
4. Recall and look-back notifications from the supplier are acted on within the timeframes specified in the agreement and per FDA guidance; the lab's response is documented.
5. If <<LAB_NAME>> is a collection establishment, donor eligibility is determined per 21 CFR 630.10 at every donation: in good health; free of transfusion-transmitted infections per screening questions and required testing; meets demographic and physical criteria; has not received deferral-triggering exposures or treatments. Eligibility findings, vital signs, hemoglobin, and the deferral check are documented.
6. Donor consent is obtained in writing before donation; the consent covers the donation process, risks, post-donation testing, and notification of abnormal findings.
7. Donor screening uses the current FDA-recognized Donor History Questionnaire (DHQ); deferrals are applied per the published criteria and documented on the Donor Deferral register.
8. Post-donation testing for ABO/Rh, antibody screen, and transfusion-transmitted infectious diseases is performed on every collection per 21 CFR 610.40 through 610.45.
9. Donor notification of abnormal findings is performed per 21 CFR 630.40 with the required information and follow-up resources.
10. Donor blood collection follows the validated SOP per 21 CFR 606.110: site prep, venipuncture, collection volume, anticoagulant ratio, post-donation care. Donor is monitored throughout collection for adverse signs (vasovagal, hematoma, citrate reaction); any reaction triggers immediate intervention per the lab's Donor Adverse Reaction procedure.
11. Post-collection care includes rest, hydration, snack; donor is not released until alert and able to ambulate safely; any post-collection reaction is documented.
12. Therapeutic apheresis is performed under physician supervision per 21 CFR 606.110, with validated procedures for each apheresis modality (red cell exchange, plasma exchange, leukapheresis, etc.). Indication, prescribed regimen (number of procedures, volume, replacement fluid), informed consent, and continuous monitoring (vitals, machine alarms, adverse reactions) are documented before and during each procedure.
13. Donor records (eligibility, collection, post-donation, deferral, supplier qualification) are retained per 21 CFR 606.160 (typically 10 years post-distribution) and 42 CFR 493.1105(a)(7); donor confidentiality is maintained per HIPAA where applicable.

**procedure_steps:**

1. For supplier-sourced components, verify the supplier agreement is current and the supplier's qualification (FDA registration, accreditation status) is on file; renew the agreement annually; complete the annual supplier performance review with medical director or designee signature.
2. On recall or look-back communication, log on receipt and act per the response procedure within the agreement's specified timeframe and per FDA guidance.
3. If collection establishment: donor presents and identity is verified; written consent is obtained covering donation process, risks, post-donation testing, and abnormal-finding notification; the FDA-recognized DHQ is administered.
4. Eligibility is determined per the DHQ responses, physical exam findings, vital signs, hemoglobin, and current deferrals; ineligible donors are deferred with documented reason and reentry criteria.
5. Perform venipuncture and collection per the FDA-validated procedure for the collection type (whole blood, plateletpheresis, plasmapheresis, leukapheresis, etc.); document any adverse reaction (vasovagal, hematoma, citrate); intervene immediately and notify the supervising physician.
6. Deliver post-collection care: rest, hydration, snack; verify alertness and ambulation before release; document any post-collection reaction.
7. Perform post-donation testing per 21 CFR 610.40 through 610.45 on every collection; results are reviewed.
8. On abnormal findings, notify the donor per 21 CFR 630.40 with the required information and follow-up resources; document the notification.
9. For therapeutic apheresis: verify the physician order, patient identity, indication, prescribed regimen, and signed informed consent; set up the apheresis machine per the manufacturer's procedure; verify replacement fluid identity and integrity; perform the procedure with continuous monitoring; document vitals on the cadence; address alarms and adverse reactions per the lab's procedure; notify the supervising physician.
10. Complete post-procedure care and discharge per the protocol; file procedure records, deferrals, and donor adverse reactions with the required 10-year retention; submit any required reports (e.g., suspected transfusion-transmitted infection traceback) to FDA per 21 CFR 606.170.

**definitions:**

- **Collection establishment** — An FDA-registered facility that collects, prepares, processes, or compatibility-tests blood or blood components. Most hospital transfusion services are NOT collection establishments and instead purchase components from a supplier.
- **Blood supplier** — An FDA-registered blood establishment that collects, processes, or distributes blood components to the lab under a written supplier agreement.
- **Donor History Questionnaire (DHQ)** — Standardized FDA-recognized questionnaire used to screen blood donors for eligibility. The lab uses the current FDA-recognized version.
- **Deferral** — Temporary or permanent exclusion of a donor from blood donation based on eligibility criteria. Documented on the Donor Deferral register with reason and reentry criteria.
- **Adverse donor reaction** — Any unexpected event during or after blood collection that may be related to the collection (vasovagal, hematoma, citrate reaction, delayed reaction). Triggers immediate intervention and documentation.
- **Therapeutic apheresis** — Apheresis procedure performed for medical treatment of the patient (red cell exchange, plasma exchange, leukapheresis), distinct from donor apheresis (collection).
- **Look-back** — Process initiated when a donor is subsequently found to be infectious for a transfusion-transmitted disease; supplier notifications trigger the lab's response per the agreement and FDA guidance.

### Source-side coverage check


#### Source #43: Blood Supplier Agreement Policy

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Every blood supplier holds a current FDA registration as a blood establishment per 21 CFR 607; registration is verified at contracting and at each renewal.
2. [✓ (79%)] Written supplier agreements cover: components and quantities, ordering process, delivery and emergency-delivery commitments, packaging and transport temperature commitments, recall and look-back communication, billing, and term/termination.
3. [✓ (88%)] Supplier performance (on-time delivery, recall responsiveness, component quality, customer service) is reviewed annually; recurring issues trigger discussion and may trigger supplier change.
4. [✓ (100%)] Recall and look-back notifications from the supplier are acted on within the timeframes specified in the agreement and per FDA guidance; the lab's response is documented.
5. [🚩 LOW OVERLAP] Records of supplier qualification, the written agreement, and performance reviews are retained per 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At supplier selection, the medical director or designee confirms FDA registration, reviews the supplier's QMS evidence, and approves the supplier; the approval is documented.
2. [🚩 LOW OVERLAP] A written agreement is executed covering the items listed in the policy statements.
3. [🚩 LOW OVERLAP] Annual performance review of each supplier is conducted; the review is signed by the medical director or designee and filed.
4. [🚩 LOW OVERLAP] Recall or look-back communications from the supplier are logged on receipt and acted on per the response procedure.

**Source definitions:**

- [✓] **Blood supplier** — An FDA-registered blood establishment that collects, processes, or distributes blood components to the lab for transfusion.
- [✓] **Look-back** — Process initiated when a donor is subsequently found to be infectious for a transfusion-transmitted disease; recipients of prior components from that donor are identified and the treating clinicians are notified.


#### Source #63: Blood Donation Policy

_(6 statements · 5 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Donor eligibility is determined per 21 CFR 630.10 at every donation: in good health, free of transfusion-transmitted infections (per screening questions and required testing), meets demographic and physical criteria, has not received deferral-triggering exposures or treatments.
2. [✓ (100%)] Donor consent is obtained in writing before donation; the consent covers the donation process, risks, post-donation testing, and notification of abnormal findings.
3. [✓ (100%)] Donor screening uses the current FDA-recognized Donor History Questionnaire; deferrals are applied per the published criteria and documented.
4. [✓ (86%)] Post-donation testing for ABO/Rh, antibody screen, and transfusion-transmitted infectious diseases is performed on every collection per 21 CFR 610.40-45.
5. [✓ (100%)] Donor notification of abnormal findings is performed per 21 CFR 630.40 with the required information and follow-up resources.
6. [🚩 LOW OVERLAP] Records are retained for at least 10 years per 21 CFR 606.160 and 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [⚠️  partial] Donor presents; identity is verified; consent is obtained; the DHQ is administered.
2. [✓ (83%)] Eligibility is determined per the DHQ responses, physical exam findings, and current deferrals; ineligible donors are deferred with documented reason and reentry criteria.
3. [🚩 LOW OVERLAP] Collection is performed per the FDA-validated procedure.
4. [🚩 LOW OVERLAP] Post-collection testing is completed; results are reviewed; abnormal findings trigger donor notification per 21 CFR 630.40.
5. [🚩 LOW OVERLAP] All steps are documented and retained per the 10-year rule.

**Source definitions:**

- [✓] **Donor History Questionnaire (DHQ)** — Standardized questionnaire used to screen blood donors for eligibility. FDA-recognized versions are updated periodically.
- [✓] **Deferral** — Temporary or permanent exclusion of a donor from blood donation based on eligibility criteria. Documented with reason and reentry criteria.


#### Source #64: Donor Blood Collection Policy

_(6 statements · 5 steps · 1 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Collection is performed by trained phlebotomy personnel following the FDA-validated procedure for the collection type (whole blood, plateletpheresis, plasmapheresis, leukapheresis, etc.).
2. [🚩 LOW OVERLAP] Donor identity is verified at the collection chair; the collection site is prepped per the disinfection procedure; collection volume is monitored.
3. [✓ (100%)] Donor is monitored throughout collection for adverse signs (vasovagal, hematoma, citrate reaction); any reaction triggers immediate intervention per the lab's Donor Adverse Reaction procedure.
4. [✓ (100%)] Post-collection care: rest, hydration, snack; donor is not released until alert and able to ambulate safely; any post-collection reaction is documented.
5. [🚩 LOW OVERLAP] Apheresis procedures are conducted under the supervision of a qualified physician per 21 CFR 606.110.
6. [🚩 LOW OVERLAP] Records are retained for at least 10 years per 21 CFR 606.160 and 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Phlebotomy or apheresis personnel verify donor identity, prep the collection site, and perform the collection per the validated procedure.
2. [🚩 LOW OVERLAP] Donor is monitored throughout; vitals are reassessed per the procedure cadence.
3. [🚩 LOW OVERLAP] Adverse reactions trigger immediate intervention and documentation; reactions are reported to the supervising physician.
4. [🚩 LOW OVERLAP] Post-collection care is delivered; donor release is documented.
5. [🚩 LOW OVERLAP] Adverse reactions are aggregated for periodic review.

**Source definitions:**

- [✓] **Adverse donor reaction** — Any unexpected event during or after blood collection that may be related to the collection. Includes vasovagal, hematoma, citrate reaction, and rarely cardiac events.


#### Source #65: Therapeutic Apheresis Policy

_(5 statements · 7 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Therapeutic apheresis is performed under physician supervision per 21 CFR 606.110.
2. [✓ (89%)] Indication, prescribed regimen (number of procedures, volume, replacement fluid), and informed consent are documented before each procedure.
3. [⚠️  partial] Patient is monitored throughout the procedure; vitals, machine alarms, and any adverse reactions are documented; adverse reactions trigger physician notification and intervention.
4. [🚩 LOW OVERLAP] Post-procedure care includes return of cellular components (where applicable), monitoring for delayed reactions, and discharge criteria.
5. [🚩 LOW OVERLAP] Procedure records, monitoring logs, and adverse events are retained per 21 CFR 606.160 and 42 CFR 493.1105(a)(7).

**Source procedure_steps:**

1. [✓ (100%)] Verify the physician order, patient identity, indication, and prescribed regimen.
2. [🚩 LOW OVERLAP] Verify consent is signed.
3. [✓ (57%)] Set up the apheresis machine per the manufacturer's procedure for the indication; verify replacement fluid identity and integrity.
4. [✓ (50%)] Perform the procedure with continuous patient monitoring; document vitals on the procedure cadence.
5. [✓ (100%)] Address alarms and adverse reactions per the lab's procedure; notify the supervising physician.
6. [✓ (100%)] Complete post-procedure care and discharge per the protocol.
7. [🚩 LOW OVERLAP] File procedure record with the 10-year retention flag.

**Source definitions:**

- [✓] **Therapeutic apheresis** — Apheresis procedure performed for medical treatment of the patient, not for component collection. Examples: plasma exchange for TTP, red cell exchange for sickle cell crisis, photopheresis for cutaneous T-cell lymphoma.


---

## Combined #103

**Combined policy_name:** Personnel Qualifications Policy

**Source IDs absorbed:** 17, 91, 92, 93, 94


### Combined content (what we ship)

**policy_statements:**

1. Every person performing or supervising laboratory testing at <<LAB_NAME>> meets the CLIA qualifications for the role and complexity level they perform, per 42 CFR 493 Subpart M (high complexity) or the parallel moderate-complexity sections.
2. The Laboratory Director meets the qualifications of 42 CFR 493.1443 (moderate complexity) or 42 CFR 493.1405 (high complexity) and holds responsibility for every test result reported by the laboratory. The Director may delegate specific duties to a qualified designee in writing, but cannot delegate the overall responsibility for laboratory operation and compliance.
3. The Director's responsibilities per 42 CFR 493.1445 (moderate) or 42 CFR 493.1407 (high) are documented in the Director's job description, signed and dated at appointment and at any change in responsibilities. The Director's oversight model (on-site days per month, remote access, on-call coverage) is documented and reviewed annually.
4. On any change of Laboratory Director, the lab notifies CMS in writing within 30 days per 42 CFR 493.1775 (and the Accreditation Body Notification policy); the new Director re-reads, re-signs, and re-dates every active procedure within 6 months of appointment.
5. The Technical Supervisor (for high-complexity testing) meets 42 CFR 493.1449 and is responsible for technical and scientific oversight per 42 CFR 493.1451(b). Each high-complexity specialty has a named Technical Supervisor; vacancies are reported to the medical director or designee and any vacancy longer than 30 days is escalated for resolution. Each Technical Supervisor is named on the lab's organizational chart and on the CLIA certification record; performance against the eight CLIA responsibilities is reviewed annually and the review is signed and filed.
6. The General Supervisor (for high-complexity testing) meets 42 CFR 493.1461 and provides day-to-day supervision per 42 CFR 493.1463(b). Day-to-day oversight model is documented: when high-complexity testing is being performed, a General Supervisor is on-site, accessible by phone, or otherwise able to be present in person within a reasonable time per CMS guidance.
7. Orientation of every new testing staff member is delivered or directly overseen by the General Supervisor (per 42 CFR 493.1463(b)(4)); the orientation is documented per the Training and Competency policy.
8. Annual performance evaluation of every testing staff member is completed by the General Supervisor (or delegated to a qualified peer) per 42 CFR 493.1463(b)(5); evaluations are filed in the personnel record.
9. Testing Personnel meet 42 CFR 493.1489 (high complexity) or 493.1423 (moderate complexity) and may perform testing only after orientation and the initial competency assessment is documented (see Training and Competency policy). Any qualification gap identified at hire or during the role removes the individual from CLIA-qualifying duties until the gap is closed.
10. Credentials (degree, transcripts, licensure, board certification where applicable) are verified at hire from primary source and retained in the personnel record. Credentials with expiration dates (state license, board certification) are tracked on the Credential Expiry register; the lab notifies the role holder at least 60 days before expiration and confirms renewal before expiry.
11. If a role holder's credentials lapse, the individual is removed from CLIA-qualifying duties until the credential is restored; the lapse, restoration date, and medical director or designee approval are documented.
12. Personnel records (qualifications, position description, signed competency assessments, performance evaluations) are retained per 42 CFR 493.1105 and applicable HR retention policy.

**procedure_steps:**

1. At hire, HR collects required credential evidence: state license number for primary-source check, board certificate or registry verification, transcripts or registrar letters, prior-employment verification for experience claims.
2. HR or the medical director or designee performs primary-source verification through the state licensure board, the certifying body's online registry, the issuing institution's registrar, or the prior employer; verification results (date verified, source, evidence captured) are filed in the personnel record.
3. Map each new hire to the specific CLIA role(s) they will perform; the personnel record is reviewed by the medical director or designee against the applicable CLIA qualification pathway before clearance for patient testing; the role assignment is documented in the position description.
4. Re-verify time-bound credentials (licenses, board certifications) at renewal; expiring credentials are tracked on the Credential Expiry register with notifications to the role holder at 60 and 30 days before expiration; restoration evidence is filed at renewal.
5. On any credential lapse, immediately remove the individual from CLIA-qualifying duties; document removal, restoration date, and medical director or designee approval.
6. On Laboratory Director change: HR collects primary-source verification of license, board certification, degree, and required training/experience for the new Director; the new Director signs the job description acknowledging the full set of CLIA responsibilities; the medical director or designee notifies CMS in writing within 30 days per 42 CFR 493.1775; within 6 months of appointment, the new Director re-reads, re-signs, and re-dates every active procedure.
7. Annually, the Director's documented oversight model (on-site cadence, remote access, on-call) is reviewed and re-signed.
8. Any written delegation of specific duties to a designee is documented with the designee's name, scope, effective date, and both signatures; filed in the personnel records.
9. On Technical Supervisor appointment: HR collects credential evidence; primary-source verification is filed; medical director or designee confirms qualifications meet 42 CFR 493.1449; the supervisor signs the job description acknowledging the eight CLIA responsibilities; org chart and CLIA certification record are updated.
10. Annually, the medical director or designee reviews each Technical Supervisor's performance against the eight CLIA responsibilities at 42 CFR 493.1451(b); the review is signed and filed.
11. Any Technical Supervisor vacancy is logged on the Role Vacancy register; interim coverage is documented; fill within 30 days is the lab's target; vacancies longer than 30 days are escalated to the medical director or designee for CMS notification per 42 CFR 493.1775 if appropriate.
12. On General Supervisor appointment: credential evidence is collected and primary-source verified; medical director or designee confirms qualifications meet 42 CFR 493.1461; supervisor signs the job description acknowledging the five CLIA responsibilities; schedule of on-site presence and on-call coverage is documented and reviewed annually.
13. On any role change (e.g., testing personnel promoted to general supervisor), confirm the new role's CLIA qualifications are met and update the position description; primary-source verification for new credentials is filed.

**definitions:**

- **High complexity testing** — Testing classified as high complexity by FDA under 42 CFR 493.17; subject to the personnel requirements in 42 CFR 493 Subpart M sections 493.1441 through 493.1495.
- **Moderate complexity testing** — Testing classified as moderate complexity by FDA under 42 CFR 493.17; subject to the parallel personnel requirements in 42 CFR 493 sections 493.1361 through 493.1413.
- **Primary source verification** — Confirmation of a credential directly from the issuing institution (e.g., university registrar, ASCP for board certification, state for licensure), not from a copy supplied by the candidate.
- **Medical director / Laboratory Director** — The individual responsible for the overall operation and administration of the laboratory per 42 CFR 493.1445 (moderate) or 493.1407 (high). The terms are used interchangeably in this policy.
- **Designee** — An individual to whom the Laboratory Director has, in writing, delegated specific duties. The Director may delegate duties but cannot delegate the overall responsibility.
- **Director-oversight model** — The lab's documented arrangement for on-site presence, remote access, and on-call coverage by the medical director, reviewed and re-signed annually.
- **Role Vacancy register** — Log of any CLIA-required role currently vacant, the interim coverage arrangement, and the target fill date. Vacancies longer than 30 days trigger escalation.
- **Credential Expiry register** — Audit trail of every credential with an expiration date, the expiry, the renewal notifications sent at 60 and 30 days, and the restoration evidence.
- **Day-to-day oversight** — On-site presence, telephone availability, or other accessibility model that allows the General Supervisor to be present in person within a reasonable time when high-complexity testing is being performed.
- **Qualifying pathway** — The specific 42 CFR 493 paragraph the staff member uses to satisfy the qualification requirement (e.g., 493.1489(b)(2)(ii)(A) for high-complexity testing personnel with an accredited training program).
- **CLIA-defined roles** — Laboratory Director, Technical Consultant (moderate complexity), Technical Supervisor (high complexity), Clinical Consultant (moderate complexity), General Supervisor (high complexity), and Testing Personnel. Qualifications and responsibilities per 42 CFR 493.1441 through 493.1467 (high) and the parallel moderate-complexity sections.
- **Technical Supervisor** — The individual responsible per 42 CFR 493.1451 for the technical and scientific oversight of a high-complexity specialty. Qualifications per 42 CFR 493.1449. Each high-complexity specialty has a named Technical Supervisor.
- **General Supervisor** — The individual responsible per 42 CFR 493.1463 for day-to-day supervision of high-complexity testing. Qualifications per 42 CFR 493.1461. Provides on-site, telephone, or otherwise-accessible oversight when high-complexity testing is being performed.
- **Specialty** — A subset of laboratory testing defined in 42 CFR 493.1271 through 493.1278 (e.g., bacteriology, chemistry, hematology, immunohematology, molecular pathology). Each high-complexity specialty has its own Technical Supervisor.
- **Credential evidence** — The documented credential itself (license certificate, board certificate, transcript, training program completion) plus the primary-source verification of authenticity. Filed in the personnel record before the individual performs patient testing.

### Source-side coverage check


#### Source #17: Staff Credential Verification Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] <<LAB_NAME>> verifies and documents the CLIA qualifications of every testing person, supervisor, consultant, and the laboratory director at hire and at any role change.
2. [🚩 LOW OVERLAP] Primary-source verification is required for: state license (if applicable), board certification (where the CLIA pathway requires certification), and degree (transcript or registrar verification).
3. [🚩 LOW OVERLAP] Experience and training claims required by the applicable CLIA qualification pathway are verified through employment-history checks, training-completion records, or other contemporaneous documentation.
4. [🚩 LOW OVERLAP] The completed credential verification package is filed in the personnel record before the individual performs patient testing or assumes supervisory responsibility.
5. [✓ (88%)] Credentials with expiration dates (state license, board certification) are tracked; the lab notifies the role holder at least 60 days before expiration and confirms renewal before expiry.
6. [✓ (100%)] If a role holder's credentials lapse, the individual is removed from CLIA-qualifying duties until the credential is restored; the lapse and restoration are documented.

**Source procedure_steps:**

1. [✓ (100%)] At hire, HR collects the required credential evidence: state license number for primary-source check, board certificate or registry verification, transcripts or registrar letters, prior-employment verification for experience claims.
2. [✓ (100%)] HR or the medical director or designee performs primary-source verification through the state licensure board, the certifying body's online registry, the issuing institution's registrar, or the prior employer.
3. [✓ (75%)] Verification results (date verified, source, evidence captured) are filed in the personnel record with the credential evidence.
4. [✓ (64%)] The personnel record is reviewed by the medical director or designee against the applicable CLIA qualification pathway before the individual is cleared for patient testing.
5. [✓ (83%)] Expiring credentials are tracked on the Credential Expiry register; notifications go to the role holder at 60 and 30 days; restoration evidence is filed at renewal.
6. [⚠️  partial] Any credential lapse triggers removal from CLIA-qualifying duties; the removal, the restoration date, and the medical director or designee approval are documented.

**Source definitions:**

- [🚩 NOT IN COMBINED] **Primary-source verification** — Confirmation of a credential by contacting the issuing authority directly (state licensure board, certifying body, registrar). More authoritative than a copy of the credential supplied by the individual.
- [✓] **Credential evidence** — The documented credential itself (license certificate, board certificate, transcript) plus the primary-source verification of authenticity.
- [✓] **Credential Expiry register** — Audit trail of every credential with an expiration date, the expiry, the renewal notifications sent, and the restoration evidence.


#### Source #91: Laboratory Director Qualifications and Responsibilities Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] The medical director of <<LAB_NAME>> meets the applicable CLIA qualification requirements for the highest complexity testing performed by the lab (moderate: 42 CFR 493.1443; high: 42 CFR 493.1405).
2. [🚩 LOW OVERLAP] Director qualifications are verified at appointment and the verification (primary-source license, board certification, degree, training, experience) is filed in the director's personnel record.
3. [✓ (75%)] The director's responsibilities per 42 CFR 493.1445 (moderate) or 42 CFR 493.1407 (high) are documented in the director's job description, signed and dated by the director at appointment and at any change in responsibilities.
4. [🚩 LOW OVERLAP] On any change of director, the lab notifies CMS within 30 days per 42 CFR 493.1775; the new director re-approves all active procedures within 6 months of appointment per the Test Procedure Approval policy.
5. [✓ (100%)] The director may delegate specific duties to a qualified designee in writing, but cannot delegate the overall responsibility for laboratory operation and compliance.
6. [✓ (53%)] The director provides on-site or remote oversight as required by the testing complexity and CMS guidance; the oversight model (on-site days per month, remote access, on-call coverage) is documented and reviewed annually.

**Source procedure_steps:**

1. [✓ (54%)] At director appointment, HR collects primary-source verification of license, board certification, degree, and required training or experience; the package is filed in the director's personnel record.
2. [✓ (71%)] The director signs and dates the job description acknowledging the full set of CLIA responsibilities for the complexity level performed.
3. [✓ (56%)] The medical director or designee notifies CMS in writing within 30 days of the change per the Accreditation Body Notification policy.
4. [✓ (75%)] Within 6 months of appointment, the new director re-reads, re-signs, and re-dates every active procedure per the Test Procedure Approval and Review policy.
5. [✓ (50%)] Any written delegation of specific duties to a designee is documented with the designee's name, the scope of the delegation, the effective date, and both signatures; the delegation is filed in the personnel records.
6. [✓ (62%)] The lab's director-oversight model (on-site cadence, remote access, on-call) is reviewed and re-signed annually by the director.

**Source definitions:**

- [✓] **Medical director** — The individual responsible for the overall operation and administration of the laboratory per 42 CFR 493.1441 (moderate complexity) or 42 CFR 493.1405 (high complexity).
- [✓] **Designee** — An individual to whom the medical director has, in writing, delegated specific duties. The medical director retains overall responsibility and cannot delegate that overall responsibility.
- [✓] **Director-oversight model** — The lab's documented arrangement for on-site presence, remote access, and on-call coverage by the medical director. Reviewed at least annually.


#### Source #92: Technical Supervisor Qualifications and Responsibilities Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Each high complexity specialty performed at <<LAB_NAME>> has a named technical supervisor who meets the applicable CLIA qualification per 42 CFR 493.1449.
2. [🚩 LOW OVERLAP] Technical supervisor qualifications are verified at appointment and the verification (license, board certification, degree, experience) is filed in the personnel record.
3. [🚩 LOW OVERLAP] The supervisor's responsibilities per 42 CFR 493.1451(b) are documented in a signed job description.
4. [🚩 LOW OVERLAP] Vacancies in any technical supervisor role are filled or covered by a qualified individual; vacancies longer than 30 days are reported to the medical director or designee for escalation.
5. [✓ (100%)] Each technical supervisor is named on the lab's organizational chart and on the CLIA certification record.
6. [⚠️  partial] Performance of each supervisor against the eight CLIA responsibilities is reviewed annually by the medical director or designee; the review is signed and filed.

**Source procedure_steps:**

1. [⚠️  partial] At appointment, HR collects credential evidence per the Staff Credential Verification policy; primary-source verification is filed in the personnel record.
2. [🚩 LOW OVERLAP] The medical director or designee confirms the candidate's qualifications meet the applicable CLIA pathway for the specialty before clearing them for the role.
3. [✓ (62%)] The supervisor signs the job description acknowledging the eight CLIA responsibilities; filed with the verification package.
4. [🚩 LOW OVERLAP] The org chart is updated to name the supervisor and the specialties they cover.
5. [✓ (50%)] Annually, the medical director or designee reviews the supervisor's performance against the eight responsibilities; the review is signed and filed.
6. [✓ (100%)] Any vacancy is logged on the Role Vacancy register; interim coverage is documented; fill within 30 days is the lab's target.

**Source definitions:**

- [✓] **Technical supervisor** — The individual responsible per 42 CFR 493.1451 for the technical and scientific oversight of a high complexity specialty. Qualifications per 42 CFR 493.1449.
- [✓] **Specialty** — A subset of laboratory testing defined in 42 CFR 493.1271-1278 (e.g., bacteriology, chemistry, hematology, immunohematology). Each high complexity specialty has its own technical supervisor.
- [✓] **Role Vacancy register** — Log of any CLIA-required role currently vacant, the interim coverage arrangement, and the target fill date.


#### Source #93: General Supervisor Qualifications and Responsibilities Policy

_(6 statements · 6 steps · 2 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] <<LAB_NAME>> appoints a general supervisor for high complexity testing who meets the applicable CLIA qualification per 42 CFR 493.1461.
2. [🚩 LOW OVERLAP] Qualification evidence is verified and filed in the personnel record at appointment.
3. [🚩 LOW OVERLAP] The supervisor's responsibilities per 42 CFR 493.1463(b) are documented in a signed job description.
4. [✓ (67%)] The general supervisor provides day-to-day oversight: when high complexity testing is being performed, a general supervisor is on-site, accessible by phone, or otherwise able to be present in person within a reasonable time per CMS guidance.
5. [✓ (78%)] Orientation of every new testing staff member is delivered or directly overseen by the general supervisor; documented per the Staff Orientation policy.
6. [✓ (64%)] Annual performance evaluation of every testing staff member is completed by the general supervisor or their delegate; documented per the Staff Performance Evaluation policy.

**Source procedure_steps:**

1. [⚠️  partial] At appointment, credential evidence is collected and primary-source verification is filed per the Staff Credential Verification policy.
2. [✓ (50%)] The medical director or designee confirms qualifications meet 42 CFR 493.1461 before clearing the general supervisor for the role.
3. [✓ (56%)] The general supervisor signs the job description acknowledging the five CLIA responsibilities; filed with the verification package.
4. [✓ (67%)] The general supervisor's schedule of on-site presence and on-call coverage is documented; reviewed annually.
5. [🚩 LOW OVERLAP] Orientation of new testing staff is delivered or directly overseen by the general supervisor; the Orientation Checklist is signed.
6. [🚩 LOW OVERLAP] Annual performance evaluations are completed by the general supervisor (or delegated to a qualified peer) and filed.

**Source definitions:**

- [✓] **General supervisor** — The individual responsible per 42 CFR 493.1463 for day-to-day supervision of high complexity testing. Qualifications per 42 CFR 493.1461.
- [✓] **Day-to-day oversight** — On-site presence, telephone availability, or other accessibility model that allows the supervisor to address technical problems while testing is being performed. Documented and reviewed annually.


#### Source #94: Testing Personnel Qualifications Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every testing person meets the applicable CLIA qualification for the highest complexity testing they perform (moderate: 42 CFR 493.1423; high: 42 CFR 493.1489).
2. [🚩 LOW OVERLAP] State license (where required) is current; primary-source verified at hire and at every renewal.
3. [🚩 LOW OVERLAP] Degree and training evidence is primary-source verified and filed in the personnel record before the individual performs patient testing.
4. [🚩 LOW OVERLAP] If the qualification pathway requires laboratory training, the training records (clinical lab training program completion, military laboratory specialty completion, or three-months-per-specialty documented training) are filed in the personnel record.
5. [🚩 LOW OVERLAP] Initial competency assessment per the Staff Competency Assessment policy is completed after orientation and training but before independent patient testing.
6. [✓ (100%)] Any qualification gap identified at hire or during the role removes the individual from CLIA-qualifying duties until the gap is closed.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At hire, HR collects all qualification evidence applicable to the pathway: license, degree (transcript or registrar verification), training program completion (program transcript or certificate), military service record where applicable, and documented experience.
2. [🚩 LOW OVERLAP] Primary-source verification is performed per the Staff Credential Verification policy.
3. [🚩 LOW OVERLAP] The medical director or designee reviews the package against the applicable CLIA pathway (493.1423 for moderate, 493.1489 for high) and approves the individual for the corresponding complexity level.
4. [🚩 LOW OVERLAP] The personnel record is filed with the verification package, the signed job description, and the orientation/training records.
5. [🚩 LOW OVERLAP] Initial competency assessment is scheduled and completed before independent patient testing.
6. [🚩 LOW OVERLAP] State licenses with expiration dates are tracked on the Credential Expiry register; renewal evidence is verified and filed before expiry.

**Source definitions:**

- [✓] **Moderate complexity testing** — Testing categorized as moderate complexity under CLIA. Personnel qualifications per 42 CFR 493.1423.
- [✓] **High complexity testing** — Testing categorized as high complexity under CLIA. Personnel qualifications per 42 CFR 493.1489 (more stringent than moderate).
- [✓] **Qualifying pathway** — The specific 42 CFR 493 paragraph the staff member uses to satisfy the qualification requirement (e.g., 'bachelor's degree in clinical laboratory science from accredited institution' under 493.1423(b)(2)).


---

## Combined #104

**Combined policy_name:** Training and Competency Policy

**Source IDs absorbed:** 18, 19, 20


### Combined content (what we ship)

**policy_statements:**

1. New testing personnel complete a documented orientation before performing patient testing on any test or test family. Orientation covers: lab organizational structure and reporting chain; location of procedures and the procedure manual; location of safety equipment and emergency procedures; HIPAA and patient privacy training; infection prevention and PPE training; specimen handling and identification; downtime procedures; critical value reporting; and incident reporting.
2. Test-specific orientation (test menu, instrument operation, QC review, result release) is documented per test or test family on the Initial Training record before the staff member runs patient specimens for that test.
3. Continuing education and training are provided on new test introduction, procedure changes, lessons-learned from incident review, and any change in regulatory or accreditor expectation; participation is documented. Continuing-education events (external CE, internal in-services, vendor training, conference attendance) are logged in the personnel record with date, topic, hours, and certificate where applicable.
4. When a test system, reagent, calibrator, or procedure changes materially, re-training is delivered to all staff who perform the affected test and documented on the Re-Training record BEFORE the change goes into effect.
5. Competency for each test performed is assessed against the six CLIA-required elements at 42 CFR 493.1235: (1) direct observation of routine patient test performance; (2) monitoring the recording and reporting of test results; (3) review of intermediate test results, worksheets, QC, PT, and preventive maintenance; (4) direct observation of instrument maintenance and function checks; (5) assessment of test performance through blind or PT samples; (6) assessment of problem-solving skills.
6. Initial competency is documented before the tester is released for unsupervised testing; 6-month re-assessment is completed during the first year of performing the test; annual re-assessment is completed every 12 months thereafter. Subsequent assessment dates are driven by the PRIOR assessment date, not by calendar year.
7. Evaluator role by complexity: Technical Supervisor for high-complexity; Technical Consultant for moderate-complexity; General Supervisor for waived and PPM (per CMS guidance for waived complexity). The evaluator signs the competency record; the Laboratory Director or designee reviews and signs the final record.
8. Element 1 (direct observation of testing) and Element 4 (direct observation of maintenance) require the OBSERVER'S initials, not the evaluator's. The observer must hold the role of Laboratory Director, Technical Consultant, or Technical Supervisor.
9. Element 3 records the date the staff member RAN the QC, not the date the QC was reviewed.
10. The same person may serve as both the observer and the evaluator if their role qualifies; both signature fields are required regardless.
11. Competency records, orientation, education, and re-training documentation are retained per 42 CFR 493.1105 and the applicable HR retention policy. Training records are retained for the entire time the staff member is employed plus 2 years after separation.

**procedure_steps:**

1. At hire, HR notifies the medical director or designee; a supervisor is assigned to deliver orientation; the supervisor walks the new staff member through each Orientation Checklist item; each item is initialed and dated as completed.
2. Test-specific Initial Training is delivered per test or test family by a qualified trainer (Laboratory Director, Technical Consultant, Technical Supervisor, or a senior staff member designated by the medical director or designee); the trainer walks the staff member through the procedure, instrument operation, QC, and specimen handling; the trainer observes the staff member running known specimens and reviews documentation.
3. On completion of orientation and Initial Training, the supervisor schedules the initial competency assessment; the initial assessment must be completed before the staff member performs unsupervised patient testing.
4. Initial competency: evaluator completes all six CLIA elements; Element 1 and Element 4 record the OBSERVER'S initials (observer must be LD, TC, or TS); Element 3 records the date the staff member RAN the QC; the evaluator signs the record.
5. Six months after the initial training date, the assessor performs the six-element re-assessment; document each element; evaluator signs.
6. One year after the six-month assessment, the assessor performs the first annual; subsequent annual assessments are scheduled relative to the prior assessment date (not by calendar year).
7. When a test system, reagent, calibrator, or procedure changes materially, schedule re-training BEFORE the change goes into effect; the trainer-observation-sign-off cycle is repeated; the re-training record is filed.
8. Route the completed competency record to the Laboratory Director or designee for review and signature; file in the personnel record with the configured retention.
9. Failed elements trigger retraining and re-assessment before the tester resumes the affected activity unsupervised; document the corrective action and the closure date.
10. Continuing education events are logged with date, topic, hours, and certificate (where applicable) in the personnel record.

**definitions:**

- **Orientation** — The initial introduction of a new staff member to the laboratory, covering organizational, safety, and procedural topics. Delivered before any patient testing.
- **Initial Training** — Test-specific training on a particular test or test family delivered before the staff member performs the test on patient specimens. Documented on the Initial Training record.
- **Re-training** — Test-specific training delivered to staff when the test system, reagent, calibrator, or procedure changes materially. Delivered before the change goes into effect.
- **Continuing education** — Ongoing professional learning relevant to laboratory practice. Logged in the personnel record.
- **Initial competency** — Documented competency assessment of all six CLIA elements completed before the tester is released for unsupervised testing on a given test.
- **6-month re-assessment** — Second competency assessment of all six CLIA elements, completed within 6 months of initial assessment, during the tester's first year on the test.
- **Annual re-assessment** — Yearly competency assessment of all six CLIA elements after the first-year cadence is complete. Anchored to the prior assessment date, not calendar year.
- **Six CLIA elements** — The six required competency-assessment activities at 42 CFR 493.1235: direct observation of testing, recording/reporting monitoring, intermediate-results/QC/PT review, observation of instrument maintenance, blind/PT sample testing, problem-solving.
- **Direct observation** — An assessor watches the staff member perform the test or maintenance step in real time and records the observation. Required for Elements 1 and 4 of the competency assessment.
- **Competency assessment** — A documented evaluation of a staff member's ability to perform assigned testing tasks, covering the six CLIA-required elements at 42 CFR 493.1235. Performed at initial training, at 6 months, and annually thereafter. Required for waived, moderate, and high complexity testing personnel.

### Source-side coverage check


#### Source #18: Staff Orientation Policy

_(5 statements · 5 steps · 3 definitions)_

**Source policy_statements:**

1. [✓ (67%)] Every new testing staff member completes a documented orientation before performing patient testing on any test or test family.
2. [✓ (100%)] Orientation covers: lab organizational structure and reporting chain, location of procedures and the procedure manual, location of safety equipment and emergency procedures, HIPAA and patient privacy training, infection prevention and PPE training, specimen handling and identification, downtime procedures, critical value reporting, and incident reporting.
3. [🚩 LOW OVERLAP] Orientation is documented on the Orientation Checklist, signed by the new staff member and by the supervisor responsible for orientation, and filed in the personnel record.
4. [✓ (100%)] Test-specific orientation (test menu, instrument operation, QC review, result release) is documented per test or test family on the Initial Training record before the staff member runs patient specimens for that test.
5. [🚩 LOW OVERLAP] Orientation precedes the initial competency assessment; the initial competency assessment confirms the staff member is ready for independent testing per 42 CFR 493.1235.

**Source procedure_steps:**

1. [✓ (100%)] At hire, HR notifies the medical director or designee and a supervisor is assigned to deliver orientation.
2. [✓ (100%)] The supervisor walks the new staff member through each Orientation Checklist item; each item is initialed and dated as completed.
3. [⚠️  partial] Test-specific Initial Training is delivered per test or test family, documented on the Initial Training record, and completed before the staff member performs the test on patient specimens.
4. [✓ (70%)] On completion of orientation and Initial Training, the supervisor schedules the initial competency assessment per the Staff Competency Assessment policy.
5. [🚩 LOW OVERLAP] The completed Orientation Checklist and Initial Training records are filed in the staff member's personnel record and retained per the lab's record retention schedule.

**Source definitions:**

- [✓] **Orientation** — The initial introduction of a new staff member to the laboratory, covering organizational, safety, and procedural foundations. Required before any patient testing.
- [✓] **Initial Training** — Test-specific training on a particular test or test family. Documented per test on the Initial Training record.
- [✓] **Initial competency assessment** — The first CLIA-required six-element competency assessment, performed after orientation and Initial Training are complete and before the staff member tests patient specimens independently.


#### Source #19: Staff Education and Training Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every testing staff member receives documented initial training on each test or test family before performing the test on patient specimens.
2. [🚩 LOW OVERLAP] Initial training covers: the active procedure, instrument operation, calibration and QC procedures, specimen handling specific to the test, expected reportable range and critical values, troubleshooting common issues, and documentation requirements.
3. [🚩 LOW OVERLAP] Training is delivered by a qualified trainer (Laboratory Director, Technical Consultant, Technical Supervisor, or a senior staff member designated by the medical director or designee) and documented on the Initial Training record.
4. [✓ (100%)] When a test system, reagent, calibrator, or procedure changes materially, re-training is delivered to all staff who perform the affected test and documented on the Re-Training record before the change goes into effect.
5. [⚠️  partial] Continuing education is encouraged and tracked: external CE, internal in-services, vendor training, and conference attendance are logged in the staff member's personnel record.
6. [✓ (100%)] Training records are retained for the entire time the staff member is employed plus 2 years after separation.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] When a new test is added or a staff member is assigned to a new test, the supervisor schedules initial training.
2. [✓ (100%)] The trainer walks the staff member through the procedure, instrument operation, QC, and specimen handling; the trainer observes the staff member running known specimens and reviews documentation.
3. [🚩 LOW OVERLAP] On completion, the trainer and the staff member sign the Initial Training record; the record is filed in the personnel record.
4. [🚩 LOW OVERLAP] Before the staff member tests patient specimens independently, the initial competency assessment per the Staff Competency Assessment policy is performed.
5. [⚠️  partial] When a procedure or test system changes, the supervisor schedules re-training; the same trainer-observation-sign-off cycle is repeated; the re-training record is filed.
6. [✓ (100%)] Continuing education events are logged with date, topic, hours, and certificate (where applicable) in the personnel record.

**Source definitions:**

- [✓] **Initial training** — Test-specific training delivered to a staff member before they perform the test on patient specimens. Documented on the Initial Training record.
- [✓] **Re-training** — Test-specific training delivered to a staff member when the test system, reagent, calibrator, or procedure changes materially. Documented on the Re-Training record.
- [✓] **Continuing education** — Ongoing professional learning relevant to laboratory practice. Logged in the personnel record.


#### Source #20: Staff Competency Assessment Policy

_(6 statements · 5 steps · 4 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every staff member performing patient testing is assessed for competency on each test or test family at initial training, again six months after initial training, twelve months after the six-month assessment (the first annual), and annually thereafter.
2. [⚠️  partial] Competency assessment covers the six CLIA-required elements per 42 CFR 493.1235: direct observation of routine testing, monitoring of result recording and reporting, review of QC and PT records, direct observation of instrument maintenance, blind sample or PT-style performance, and problem-solving skills.
3. [🚩 LOW OVERLAP] The competency assessor's title is set by test complexity: Technical Consultant for moderate complexity testing, Technical Supervisor for high complexity testing, and General Supervisor for waived and PPM testing.
4. [✓ (88%)] Element 1 (direct observation) and Element 4 (direct observation of maintenance) require the OBSERVER'S initials, not the evaluator's. The observer must hold the role of Laboratory Director, Technical Consultant, or Technical Supervisor.
5. [✓ (100%)] Element 3 records the date the staff member RAN the QC, not the date the QC was reviewed.
6. [✓ (58%)] The completed competency assessment is signed by the evaluator; the same person may serve as both the observer and the evaluator if their role qualifies. Both signature fields are required.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At hire, the staff member completes initial training on each test or test family they will perform; the trainer documents completion on the Initial Training record.
2. [⚠️  partial] Six months after the initial training date, the assessor performs the six-element competency assessment and documents each element on the Competency Assessment form.
3. [✓ (56%)] One year after the six-month assessment, the assessor performs the first annual assessment, again documenting all six elements.
4. [⚠️  partial] Subsequent assessments occur annually, with the assessment date driven by the prior assessment date (not by calendar year).
5. [🚩 LOW OVERLAP] All completed Competency Assessment forms are filed in the staff member's competency record and retained for at least two years after the staff member leaves the lab or the test is retired.

**Source definitions:**

- [✓] **Competency assessment** — A documented evaluation of a staff member's ability to perform assigned testing tasks, covering the six CLIA elements at 42 CFR 493.1235.
- [✓] **Direct observation** — An assessor watches the staff member perform the test or maintenance step in real time and records the observation.
- [✓] **Initial training** — The first instance of training a staff member on a test or test family; completion is documented before the staff member performs the test on patient specimens.
- [🚩 NOT IN COMBINED] **Six-month assessment** — The CLIA-required follow-up assessment six months after initial training, after which assessments occur annually.


---

## Combined #105
(1:1 mapping from source #21 — coverage risk is low; not detailed here. Read the combined template directly if you want to verify.)

---

## Combined #106

**Combined policy_name:** Waived and Point-of-Care Testing Policy

**Source IDs absorbed:** 85, 86, 87, 88


### Combined content (what we ship)

**policy_statements:**

1. Every waived test performed at <<LAB_NAME>> is on the current CMS waived-test list and is performed exactly per the manufacturer's instructions, with no modification.
2. Modification of a waived test (different sample type, off-label use, calculation alteration, interpretation change) reclassifies the test as HIGH complexity per CMS guidance; the lab does not modify waived tests unless the higher complexity certification, personnel, and QC are in place.
3. Manufacturer-required QC is performed on each new lot, on each new shipment, after each instrument service event, and at the manufacturer's prescribed frequency; QC failures bar patient testing until resolved. The medical director or designee may approve additional QC frequency based on the lab's risk profile.
4. Critical results from waived tests follow the lab's Critical Value Reporting policy; the manufacturer's stated reportable range and limitations are followed at all times.
5. Every person performing waived testing receives documented orientation to the specific test and to the lab's QC and result-reporting expectations before testing patients.
6. Competency for waived testing is assessed on the same Initial / 6-month / Annual cadence as non-waived, against the six CLIA elements at 42 CFR 493.1235 (a streamlined six-element form is acceptable). The assessor for waived testing is the General Supervisor, the Technical Consultant, or the medical director or designee per CMS guidance for waived complexity.
7. Every POCT site operating under the <<LAB_NAME>> CLIA certificate is listed on the lab's CLIA application and approved by the medical director or designee. A new POCT site at a different address triggers a CLIA certificate update per 42 CFR 493.1775.
8. POCT operators are trained, competency-assessed, and authorized in the lab's POCT roster before performing patient testing; the roster is maintained current.
9. POCT results are entered into the LIS or EHR with operator ID, device ID, date/time, and result; critical results are reported per the lab's Critical Value Reporting policy.
10. POC testing across the facility (in any clinic, ED, ICU, or off-site location) is centrally overseen by <<LAB_NAME>>; sites are inventoried, QC results aggregated, competency tracked centrally, and reagent inventory managed by the central lab or POC coordinator. Expired reagents are removed from POCT sites promptly.
11. POCT compliance audits are performed at each site at least annually by the central lab or POC coordinator; findings are tracked to closure.
12. Records (QC, competency, training, lot tracking, POCT roster, audit findings) are retained per 42 CFR 493.1105 and on the per-test retention schedule.

**procedure_steps:**

1. On new waived test, the medical director or designee confirms the test is on the CMS waived-test list and the lab holds the appropriate CLIA certificate; register the test in the central oversight inventory; assign the responsible POC coordinator.
2. On new POCT site, the medical director or designee approves; if the new site is at a different address, the CLIA certificate is updated per 42 CFR 493.1775 before testing begins at that site.
3. Place manufacturer's instructions, QC requirements, and quick-reference card at every testing site; verify each site has current manufacturer's instructions, in-date reagents, and a documented operator list.
4. Train every operator on the specific test; complete Initial Training; perform initial competency assessment before independent patient testing; add operator to the POCT roster.
5. Run manufacturer-required QC at every required event (new lot, new shipment, after service, prescribed frequency); document control identity, lot number, expiration, result, accept/reject decision, operator, date/time; failed QC pauses patient testing on the affected device until QC is in control.
6. On failed QC, investigate (operator technique, device issue, expired control, environmental factor), rerun QC; if QC cannot be brought into control, take the device out of service, notify the medical director or designee, review affected prior patient results for potential impact.
7. Run Initial / 6-month / Annual competency assessment for every waived-test operator using the six-element form; the assessor (GS, TC, or medical director or designee) signs; failed elements trigger retraining and reassessment before the operator continues independent testing.
8. Enter every POCT result in the LIS or EHR with operator ID, device ID, date/time, and result; report critical results per the Critical Value Reporting policy.
9. Aggregate QC, competency, and audit results centrally; the medical director or designee reviews monthly and signs.
10. Audit each POC site at least annually: verify procedure availability, expired-reagent control, training, competency records, QC documentation, and result documentation; document findings and corrective action plan; track to closure.
11. Maintain the POCT roster; update on hire, separation, or competency lapse; archive prior versions per the lab's retention schedule.

**definitions:**

- **Waived test** — Test categorized as waived by FDA under CLIA per 42 CFR 493.15 and 493.17, indicating simple methodology with negligible risk of erroneous result when used per manufacturer instructions.
- **Modification** — Any change from the manufacturer's instructions (sample type, calculation, interpretation, reagent substitution). Modification of a waived test reclassifies it as HIGH complexity per CMS guidance.
- **Manufacturer's instructions** — The package insert, operator's manual, or quick-reference card supplied by the test manufacturer. Waived testing must follow these without modification.
- **External QC** — QC using a control material separate from the patient sample. Most waived tests have external QC requirements per the manufacturer.
- **Internal QC** — Built-in QC features of the device itself (e.g., internal control line on a lateral flow assay). Manufacturer-dependent; does not replace external QC unless the manufacturer states so.
- **Point-of-care testing (POCT)** — Laboratory testing performed at or near the site of patient care, outside the central laboratory. POC tests are often waived but not exclusively.
- **POCT operator** — An individual trained and competency-assessed to perform a specific POCT test under the central lab's CLIA certificate. Listed on the POCT roster.
- **POC coordinator** — Designated role responsible for inventory, QC, competency, training, and oversight of POC testing across all sites under the lab's CLIA certificate.
- **Waived competency** — CLIA-required six-element competency assessment for staff performing waived testing, on the same Initial / 6-month / Annual cadence as moderate and high complexity testing. Assessor is the General Supervisor, Technical Consultant, or medical director or designee per CMS guidance.

### Source-side coverage check


#### Source #85: Waived Testing Policies and Procedures

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [✓ (67%)] Every waived test performed at <<LAB_NAME>> is on the current CLIA waived-test list and is performed exactly per the manufacturer's instructions, with no modification.
2. [✓ (91%)] Modification of a waived test (different sample type, off-label use, calculation alteration) reclassifies the test as high complexity per CMS guidance; the lab does not modify waived tests unless the higher complexity certification, personnel, and QC are in place.
3. [🚩 LOW OVERLAP] Waived testing personnel receive documented training on each waived test before testing patient specimens; competency is assessed annually per the lab's Waived Testing Competency Assessment policy.
4. [🚩 LOW OVERLAP] Manufacturer-required QC is run at the manufacturer-specified frequency and documented; missing or failed QC triggers corrective action before patient testing resumes.
5. [✓ (100%)] Critical results from waived tests follow the lab's Critical Value Reporting policy; the manufacturer's stated reportable range and limitations are followed.
6. [🚩 LOW OVERLAP] Waived test results are reported with the testing site identified and retained per 42 CFR 493.1105.

**Source procedure_steps:**

1. [✓ (75%)] When a new waived test is added, the medical director or designee confirms the test is on the CMS waived-test list and the lab holds the appropriate CLIA certificate.
2. [⚠️  partial] The manufacturer's instructions, QC requirements, and quick-reference card are placed at every testing site; staff are trained and competency-assessed.
3. [🚩 LOW OVERLAP] On each patient test, staff follow the manufacturer's instructions exactly; result is recorded with patient ID, date/time, result, lot number, expiration, and tester initials.
4. [🚩 LOW OVERLAP] QC is run at the manufacturer-specified frequency (typically per lot, per shipment, per new operator, or per defined interval); QC results are documented.
5. [🚩 LOW OVERLAP] Failed QC triggers corrective action: investigate, document, and rerun QC; patient testing on the affected device pauses until QC is in control.
6. [🚩 LOW OVERLAP] Critical results are reported per the lab's Critical Value Reporting policy; the result and notification are documented.

**Source definitions:**

- [✓] **Waived test** — A test categorized as waived under CLIA at 42 CFR 493.15. Waived tests are simple, accurate, and pose minimal risk if performed incorrectly.
- [✓] **Manufacturer's instructions** — The package insert, operator's manual, or quick-reference card supplied by the test manufacturer. Waived tests must be performed exactly per these instructions to retain waived status.
- [✓] **Modification** — Any change from the manufacturer's instructions (sample type, calculation, interpretation, reagent substitution). Modification reclassifies the test as high complexity per CMS guidance.


#### Source #86: Waived Testing Quality Control Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] QC for every waived test is run at the manufacturer's specified frequency at minimum; the lab may run additional QC if recommended by the medical director or designee for the lab's risk profile.
2. [🚩 LOW OVERLAP] QC materials are stored, handled, and used per the manufacturer's instructions; expired QC material is not used.
3. [🚩 LOW OVERLAP] QC results are documented with: control identity, lot number, expiration, result, accept/reject decision, operator, date/time.
4. [🚩 LOW OVERLAP] Failed QC triggers immediate corrective action: investigate (operator, device, lot, environment), document, rerun QC; patient testing pauses on the affected device until QC is in control.
5. [🚩 LOW OVERLAP] QC results are reviewed monthly by the medical director or designee; trends are analyzed and corrective action taken where indicated.
6. [🚩 LOW OVERLAP] QC records are retained for at least 2 years per 42 CFR 493.1105.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At the manufacturer-specified frequency, the operator runs the required QC on the device.
2. [🚩 LOW OVERLAP] QC result is interpreted against the manufacturer's acceptance criteria.
3. [🚩 LOW OVERLAP] If accepted, the operator documents the QC (control, lot, result, operator, date/time) and proceeds with patient testing.
4. [⚠️  partial] If rejected, patient testing pauses; the operator investigates (operator technique, device issue, expired control, environmental factor), rerunds QC.
5. [⚠️  partial] If QC cannot be brought into control, the device is taken out of service; the medical director or designee is notified; affected prior patient results are reviewed for potential impact.
6. [⚠️  partial] The medical director or designee reviews QC documentation monthly and signs the review.

**Source definitions:**

- [✓] **Waived test QC** — Quality control performed per the test manufacturer's instructions on a CLIA-waived test. CLIA does not specify frequency; manufacturer instructions control.
- [✓] **External QC** — QC using a control material separate from the patient sample. Most waived tests have external QC requirements at minimum per lot, per shipment, or per operator.
- [✓] **Internal QC** — Built-in QC features of the device itself (e.g., internal control line on a lateral flow assay). Manufacturer-defined; documented per device.


#### Source #87: Waived Testing Competency Assessment Policy

_(4 statements · 5 steps · 1 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every staff member performing waived testing is competency-assessed at initial training, six months after initial training, twelve months after the six-month (the first annual), and annually thereafter.
2. [🚩 LOW OVERLAP] Competency assessment covers the six CLIA-required elements per 42 CFR 493.1235 scaled to waived complexity: direct observation of test performance, monitoring of result recording and reporting, review of QC records, direct observation of any instrument function checks, blind sample or split-sample performance, and problem-solving skills.
3. [✓ (100%)] Assessor for waived testing is the General Supervisor, the Technical Consultant, or the medical director or designee per CMS guidance for waived complexity.
4. [🚩 LOW OVERLAP] Completed competency assessments are signed by the staff member and the assessor; filed in the personnel record.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] At hire, the staff member completes Initial Training on each waived test they will perform; training is documented.
2. [🚩 LOW OVERLAP] Six months after initial training, the assessor performs the six-element competency assessment and documents each element on the Waived Competency form.
3. [🚩 LOW OVERLAP] One year after the six-month assessment, the first annual is performed; annually thereafter.
4. [⚠️  partial] Failed elements trigger retraining and reassessment before the staff member continues independent testing on the affected test.
5. [🚩 LOW OVERLAP] Records are filed in the personnel record and retained per the lab's retention schedule.

**Source definitions:**

- [✓] **Waived competency** — CLIA-required six-element competency assessment for staff performing waived testing, on the same cadence as moderate and high complexity.


#### Source #88: Point-of-Care Testing Oversight Policy

_(7 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Every POCT site operating under the <<LAB_NAME>> CLIA certificate is listed on the lab's CLIA application and approved by the medical director or designee.
2. [🚩 LOW OVERLAP] Each POCT device, kit, or method has a written procedure, QC requirements, operator training, and competency assessment as required by CLIA for the complexity level.
3. [✓ (100%)] POCT operators are trained, competency-assessed, and authorized in the lab's POCT roster before performing patient testing; the roster is maintained current.
4. [🚩 LOW OVERLAP] POCT QC is performed at the manufacturer-specified frequency at minimum; QC results, failed-QC corrective actions, and operator/device/lot identifiers are documented and reviewed by the POCT coordinator or designee monthly.
5. [✓ (100%)] POCT results are entered into the LIS or EHR with operator ID, device ID, date/time, and result; critical results are reported per the lab's Critical Value Reporting policy.
6. [⚠️  partial] POCT inventory (devices, reagents, controls) is managed by the central lab or POCT coordinator; expired reagents are removed from POCT sites promptly.
7. [✓ (70%)] POCT compliance audits are performed at each site at least annually by the central lab or POCT coordinator; findings are tracked to closure.

**Source procedure_steps:**

1. [⚠️  partial] When a new POCT site or device is added, the medical director or designee approves; the CLIA certificate is updated if the new site is at a different address.
2. [✓ (75%)] POCT operators complete documented training; their initial competency assessment is performed before independent patient testing.
3. [🚩 LOW OVERLAP] Daily, weekly, or per-shipment QC (per manufacturer) is performed by the POCT operator or POCT coordinator and documented.
4. [🚩 LOW OVERLAP] Failed QC triggers immediate corrective action; affected POCT testing pauses until QC is in control; the central lab is notified.
5. [🚩 LOW OVERLAP] Patient results, QC records, and competency records flow to the central lab; the POCT coordinator (or designee) reviews monthly.
6. [✓ (64%)] Annual on-site POCT audits verify procedure availability, expired-reagent control, training, competency records, QC documentation, and result documentation.

**Source definitions:**

- [✓] **Point-of-Care Testing (POCT)** — Laboratory testing performed at or near the site of patient care, outside the central laboratory.
- [✓] **POCT operator** — An individual trained and competency-assessed to perform a specific POCT test under the central lab's CLIA certificate.
- [🚩 NOT IN COMBINED] **POCT coordinator** — The role responsible for day-to-day oversight of POCT across sites: training, competency, QC review, audit, inventory.


---

## Combined #107

**Combined policy_name:** Molecular Testing Policy

**Source IDs absorbed:** 75, 76, 77


### Combined content (what we ship)

**policy_statements:**

1. Every molecular test (FDA-cleared, modified, or laboratory-developed) has documented performance verification or establishment per 42 CFR 493.1253 before patient testing begins: accuracy, precision, reportable range, reference interval (where applicable), and analytical sensitivity / specificity.
2. Workflow controls minimize contamination: physical separation of pre-amplification and post-amplification areas, unidirectional workflow, dedicated pipettes and reagents per area, and decontamination of work surfaces. Contamination-prevention practices are documented and audited on the documented cadence.
3. Every molecular run includes appropriate controls: positive control (template at clinical decision concentration), negative control (no-template), and internal amplification control (where the test design supports). Quantitative assays include at least two concentration levels of positive control per 42 CFR 493.1256(d)(3).
4. Failed controls (positive control negative, negative control positive, internal amplification control failed) trigger run rejection and corrective action before patient results are released. Investigation, corrective action, and re-run are documented.
5. Molecular genetic testing (germline or somatic) follows the additional requirements of 42 CFR 493.1276: documented test methodology, clinical and analytical performance characteristics, and report interpretation guidance signed by the Laboratory Director or designee.
6. Genetic test orders include indication, family history when relevant, ethnicity when used in interpretation, and any prior testing in the patient or family.
7. Informed consent for genetic testing is documented when required by state law or by the lab's policy; the consent covers the implications of positive, negative, and indeterminate results.
8. Test interpretation includes variant classification per current ACMG-style criteria or equivalent (pathogenic, likely pathogenic, variant of uncertain significance, likely benign, benign); clinical significance; and any implications for family members.
9. Genetic test reports include: the regions or genes tested, variants identified, variant classification, recommended follow-up (genetic counseling, family testing, clinical correlation), and limitations of the test methodology.
10. Variant classification is reviewed periodically as new evidence emerges; clinically significant reclassifications trigger amended reports and provider notification per the lab's variant reclassification procedure.
11. QC results are documented per run with control identity, lot, result, accept/reject, and operator; reviewed monthly by the medical director or designee.
12. Records (verification, QC, lot tracking, interpretation, sign-out, amended reports) are retained per 42 CFR 493.1105 with the longer retention applicable to genetic test results per state genetic privacy law where applicable.

**procedure_steps:**

1. Before a new molecular assay goes live, complete the verification or establishment study per 42 CFR 493.1253: accuracy, precision, reportable range, reference interval, analytical sensitivity, analytical specificity (including interfering substances); document and sign; reverify after any test-system change.
2. Run setup includes the required controls: positive, negative, and internal amplification control where applicable; for quantitative assays, at least two concentration levels of positive control per run; controls are tracked with patient samples.
3. Control results are interpreted alongside patient results; failed controls trigger run rejection; investigation, corrective action, and re-run are documented before patient results are released.
4. Workflow controls (separation of pre-amp and post-amp areas, unidirectional workflow, dedicated equipment, decontamination of surfaces) are observed continuously and audited on the documented cadence; document findings.
5. On genetic test order: confirm indication, family history when relevant, ethnicity when used in interpretation, prior testing; confirm consent (where required by state law or lab policy) is signed and on file before testing begins.
6. Perform testing per the validated procedure with documented controls; interpretation by qualified personnel; classify variants per ACMG-style criteria; reports include regions/genes tested, variants identified, classification, recommended follow-up, and methodology limitations.
7. Route genetic-test reports to the Laboratory Director or designee for interpretive sign-out as defined by the assay's standing rule.
8. On new evidence triggering reclassification of a previously reported variant: follow the variant reclassification procedure; issue an amended report; notify the ordering provider per the lab's communication procedure; document.
9. Monthly QC review by the medical director or designee documents the review and any unresolved concerns.
10. File verification, QC, lot, reporting, and amended-report records per the applicable retention schedule.

**definitions:**

- **Molecular genetic testing** — Testing of nucleic acids for germline or somatic variants; subject to additional requirements at 42 CFR 493.1276 beyond general molecular QC.
- **Pre-amplification area** — Lab area where reagents are prepared and patient specimens are added to reaction mixtures, before amplification. Physically separated from the post-amplification area with unidirectional workflow to minimize amplicon contamination.
- **Internal amplification control (IAC)** — A control sequence amplified in the same reaction as the target. Confirms the reaction chemistry worked and there is no PCR inhibition even when the patient analyte is undetectable.
- **Run-level QC** — Quality control performed within each batch of patient testing, as opposed to daily-aggregate QC. Includes positive, negative, and IAC controls per molecular run.
- **Variant classification** — Categorization of a genetic variant by likelihood of clinical significance per ACMG-style criteria: pathogenic, likely pathogenic, variant of uncertain significance (VUS), likely benign, benign.
- **Variant reclassification** — Update of a previously reported variant classification based on new evidence. Clinically significant reclassifications trigger amended reports and provider notification.

### Source-side coverage check


#### Source #75: Molecular Testing Policies and Procedures

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Every molecular test (FDA-cleared, modified, or laboratory-developed) has documented performance verification or establishment per 42 CFR 493.1253 before patient testing begins.
2. [✓ (100%)] Workflow controls minimize contamination: physical separation of pre-amplification and post-amplification areas, unidirectional workflow, dedicated pipettes and reagents per area, decontamination of work surfaces.
3. [✓ (94%)] Every test run includes appropriate controls: positive control (template at clinical decision concentration), negative control (no-template), and internal amplification control (where the test design supports).
4. [🚩 LOW OVERLAP] Reportable range and analytical sensitivity are established and documented; results outside the reportable range are reported with the appropriate qualifier.
5. [🚩 LOW OVERLAP] Records retained per 42 CFR 493.1105.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Performance verification or establishment is completed and signed before first patient use.
2. [🚩 LOW OVERLAP] Each run includes the required controls; failed controls pause patient result release until in control.
3. [🚩 LOW OVERLAP] Results are interpreted per the validated cutoffs; reported with appropriate clinical comments.
4. [⚠️  partial] Workflow controls (separation, unidirectional movement, decontamination) are observed continuously and audited periodically.

**Source definitions:**

- [✓] **Pre-amplification area** — Lab area where reagents are prepared and patient specimens are added to reaction mixtures, before any amplified product exists. Kept physically separated from post-amplification to prevent amplicon contamination.
- [✓] **Internal amplification control (IAC)** — A control sequence amplified in the same reaction as the target. Confirms the reaction worked and the absence of a target signal is not due to inhibition.


#### Source #76: Molecular QC Policy

_(4 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (57%)] Every molecular run includes positive control(s), negative control (no-template), and internal amplification control where applicable.
2. [✓ (100%)] Quantitative assays include at least two concentration levels of positive control.
3. [✓ (87%)] Failed controls (positive control negative, negative control positive, IAC failed) trigger run rejection and corrective action before patient results are released.
4. [✓ (100%)] QC results are documented per run with control identity, lot, result, accept/reject, and operator; reviewed monthly by the medical director or designee.

**Source procedure_steps:**

1. [✓ (50%)] Run setup includes the required controls; controls are tracked with patient samples.
2. [✓ (100%)] Control results are interpreted alongside patient results; failed controls trigger run rejection.
3. [✓ (62%)] Failed runs are investigated, corrective action documented, and re-run performed before patient results are released.
4. [✓ (100%)] Monthly QC review by the medical director or designee documents the review and any unresolved concerns.

**Source definitions:**

- [✓] **Run-level QC** — Quality control performed within each batch of patient testing, as opposed to daily-aggregate QC.


#### Source #77: Molecular Genetic Testing Policy

_(6 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (100%)] Genetic test orders include indication, family history when relevant, ethnicity when used in interpretation, and any prior testing in the patient or family.
2. [✓ (100%)] Informed consent for genetic testing is documented when required by state law or by the lab's policy; the consent covers the implications of positive, negative, and indeterminate results.
3. [✓ (82%)] Test interpretation includes the variant classification (per current ACMG-style criteria or equivalent), clinical significance, and any implications for family members.
4. [✓ (100%)] Reports include the regions or genes tested, variants identified, variant classification, recommended follow-up (genetic counseling, family testing, clinical correlation), and limitations of the test methodology.
5. [✓ (100%)] Variant classification is reviewed periodically as new evidence emerges; clinically significant reclassifications trigger amended reports and provider notification per the lab's variant reclassification procedure.
6. [🚩 LOW OVERLAP] Genetic testing records are retained per 42 CFR 493.1105 with additional retention as required by state genetic privacy law.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Order receipt confirms indication, consent (where required), and pre-analytic information.
2. [✓ (100%)] Testing performed per the validated procedure with documented controls.
3. [⚠️  partial] Interpretation by qualified personnel; reports include all required elements.
4. [🚩 LOW OVERLAP] Variant reclassifications triggered by new evidence are managed per the variant reclassification procedure with amended reports and notification.

**Source definitions:**

- [✓] **Variant classification** — Categorization of a genetic variant by likelihood of clinical significance: pathogenic, likely pathogenic, uncertain significance (VUS), likely benign, benign.
- [✓] **Variant reclassification** — Update of a previously reported variant classification based on new evidence. May trigger amended report and provider notification.


---

## Combined #108

**Combined policy_name:** Health Information Management Policy

**Source IDs absorbed:** 25, 26, 27


### Combined content (what we ship)

**policy_statements:**

1. Patient health information is treated as confidential per HIPAA Privacy Rule (45 CFR 164 Subpart E) and per 42 CFR 493.1231; access is limited to those with a documented need-to-know.
2. The minimum-necessary standard (45 CFR 164.502(b)) applies to every internal use, external disclosure, and request: only the PHI needed for the purpose is accessed, used, or shared.
3. Administrative, physical, and technical safeguards required by HIPAA Security Rule (45 CFR 164 Subpart C) are implemented and documented: access control, audit controls, integrity controls, transmission security, and workforce security.
4. Access to ePHI is restricted by role; unique user IDs are assigned to every workforce member; multi-factor authentication is enforced for remote access and for any administrative role; shared accounts are prohibited.
5. Audit logs of access to and modification of ePHI are maintained, retained for at least 6 years per the HIPAA Security Rule retention requirement, and reviewed at least monthly by the Security Officer for anomalies.
6. ePHI is encrypted at rest on portable devices (laptops, tablets, removable media) and encrypted in transit across non-internal networks; encryption keys are managed per the lab's key management procedure.
7. Test results are transmitted only through validated, encrypted channels (LIS interfaces, secure messaging); unsolicited transmission of PHI via unencrypted email is prohibited.
8. Calculation verification of test transmission from instrument to LIS, and end-to-end validation of LIS-to-EHR result transmission, is performed at interface go-live and re-verified after any interface change, per 42 CFR 493.1281(c) and the lab's documented procedure.
9. Business Associate Agreements (BAA) are in place with every vendor, courier, billing service, IT service, cloud provider, or contractor that creates, receives, maintains, or transmits PHI on the lab's behalf, per 45 CFR 164.502(e) and 45 CFR 164.504(e); BAAs are reviewed annually and at vendor change.
10. Result records are retained per 42 CFR 493.1105 (typically 2 years for non-immunohematology results, 5 years for cytology, 10 years for immunohematology and pathology) and the lab's HIPAA-aligned retention policy.
11. Patient access to their own information follows HIPAA Privacy Rule 45 CFR 164.524 and 42 CFR 493.1291(l); the lab's documented procedure routes requests to the Privacy Officer for response within 30 days.
12. Breaches of unsecured PHI follow the Breach Notification Rule (45 CFR 164.402 onward): risk assessment per 164.402, notification to affected individuals without unreasonable delay and in no case later than 60 days, notification to HHS via the breach portal (annually for breaches affecting fewer than 500 individuals; without unreasonable delay and no later than 60 days for breaches affecting 500 or more), and notification to prominent media outlets for breaches affecting 500 or more residents of a state or jurisdiction. Coordination with the LIS Downtime policy applies when relevant; coordination with the Cybersecurity Incident Response policy applies for security incidents.

**procedure_steps:**

1. At hire, every staff member completes HIPAA Privacy and Security training, signs the lab's Confidentiality Agreement, and receives a unique user account with role-appropriate access provisioned by IT; training and account provisioning are documented in the personnel record. Annual refresher training is delivered and tracked.
2. Workforce access to the LIS and other PHI systems is granted on a need-to-know basis; access rights are reviewed at least annually and adjusted within one business day of any role change; on separation, IT disables access by close of business the same day and physical credentials are collected.
3. Multi-factor authentication is enforced at provisioning for all remote access and all administrative-role accounts; the IT function audits MFA enforcement at the documented cadence and reports any exception to the Security Officer.
4. Audit logs are generated automatically for ePHI access and modification; the Security Officer reviews the logs at least monthly for anomalies (access outside normal hours, access to records not assigned, repeated authentication failures); anomalies trigger investigation and are documented; logs are retained at least 6 years.
5. All transmission of PHI uses validated, encrypted channels; the IT function maintains the list of approved channels and audits actual usage at the documented cadence; ePHI on portable devices is encrypted at hardware provisioning and the encryption status is re-verified annually.
6. Calculation verification at LIS interface go-live: IT and the medical director or designee complete a documented end-to-end test using sample patients across each result type (numeric, text, coded), confirm receipt in the downstream system, and confirm that units of measure and reference ranges display correctly; the verification is signed before the interface goes live. The same procedure is repeated for the affected analytes after any interface change.
7. Daily, the LIS administrator or designee reviews the interface error queue for failed transmissions and corrects within the same business day; persistent errors trigger an IT ticket and notification to the medical director or designee.
8. Business Associate Agreements are executed before any vendor handles PHI on the lab's behalf; the Privacy Officer reviews all BAAs annually and at vendor change; renewals or amendments are filed.
9. Records retention follows the documented schedule; secure destruction at end of retention requires medical director or designee approval and is documented in the destruction log.
10. Patient access requests are routed to the Privacy Officer; the patient's identity is verified; the requested PHI is provided within 30 days in the form requested where readily producible.
11. On a suspected privacy or security event, the staff member who observes or causes the event notifies the Privacy Officer or Security Officer immediately; the officer logs the event, performs the breach risk assessment per 45 CFR 164.402, and (when notification is required) drives notifications: affected individuals within 60 days, HHS via the breach portal per the threshold rule, and prominent media outlets if 500 or more individuals in a state or jurisdiction are affected.
12. Annually, the Security Officer and Privacy Officer audit the HIPAA safeguards (administrative, physical, technical) and the BAA inventory; findings and corrective actions are documented and signed.

**definitions:**

- **PHI** — Protected Health Information; individually identifiable health information held or transmitted by a HIPAA covered entity or business associate, per 45 CFR 160.103.
- **ePHI** — Electronic Protected Health Information; PHI in electronic form. Subject to the HIPAA Security Rule (45 CFR Part 164 Subpart C).
- **Minimum necessary** — The HIPAA standard requiring that PHI uses, disclosures, and requests be limited to the minimum amount of PHI needed to accomplish the intended purpose. Per 45 CFR 164.502(b) and 164.514(d).
- **Business Associate Agreement (BAA)** — Written contract required by HIPAA between a covered entity and any vendor that creates, receives, maintains, or transmits PHI on the covered entity's behalf. Required by 45 CFR 164.502(e) and 45 CFR 164.504(e).
- **Audit log** — Record of access to and activity within systems containing ePHI. Required by 45 CFR 164.312(b). Retained at least 6 years per HIPAA Security Rule retention.
- **Calculation verification** — End-to-end check that a test result generated by an instrument arrives in the LIS and downstream EHR with correct numeric value, units of measure, and reference range display. Required at interface go-live and after any interface change per 42 CFR 493.1281(c).
- **Interface error queue** — The LIS queue of messages that failed to send or be received. Reviewed every business day; persistent failures trigger an IT ticket and medical director or designee notification.
- **Breach** — Acquisition, access, use, or disclosure of PHI in a manner not permitted under HIPAA Privacy Rule that compromises the security or privacy of the PHI, per 45 CFR 164.402.
- **Multi-factor authentication (MFA)** — Authentication requiring two or more independent credentials (e.g., password plus a one-time code on a registered device). Enforced for remote access and administrative-role accounts.
- **Security incident** — Attempted or successful unauthorized access, use, disclosure, modification, or destruction of ePHI, or interference with system operations in an information system holding ePHI. Reported immediately to the Security Officer; investigation determines whether the Breach Notification Rule applies.
- **Result transmission log** — Audit trail of every test result sent from the LIS, including timestamp, sender, recipient system, and acknowledgment of receipt where the receiving system supports it. Reviewed for anomalies and persistent failures.

### Source-side coverage check


#### Source #25: Health Information Privacy Policy

_(7 statements · 6 steps · 4 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every staff member completes HIPAA Privacy and Security training at hire and annually thereafter; completion is documented in the personnel record.
2. [🚩 LOW OVERLAP] PHI is used and disclosed only for permitted purposes (treatment, payment, health care operations, or other purposes permitted or required by 45 CFR Part 164).
3. [✓ (89%)] The minimum-necessary standard applies to every internal use, external disclosure, and request: only the PHI needed for the purpose is accessed or shared.
4. [🚩 LOW OVERLAP] Verbal discussions of PHI are conducted in private areas not within earshot of patients or visitors; computer screens displaying PHI face away from public areas; printed reports are not left unattended.
5. [🚩 LOW OVERLAP] Patients have the right to access their own results per 45 CFR 164.524 and 42 CFR 493.1291(l); access requests are processed within 30 days.
6. [✓ (80%)] Business associate agreements are in place with every vendor, courier, or contractor that creates, receives, maintains, or transmits PHI on the lab's behalf.
7. [🚩 LOW OVERLAP] Privacy incidents (unauthorized access, lost paper records, misdirected reports, lost devices) are reported immediately to the privacy officer and documented in the Privacy Incident log; breach determination follows 45 CFR 164.402 and notifications follow 45 CFR 164.404.

**Source procedure_steps:**

1. [✓ (80%)] At hire, every staff member completes HIPAA Privacy and Security training and signs the lab's Confidentiality Agreement; both are filed in the personnel record.
2. [🚩 LOW OVERLAP] Annual HIPAA refresher training is delivered to all staff; completion is tracked.
3. [🚩 LOW OVERLAP] When PHI is accessed, used, or disclosed, the staff member applies the minimum-necessary standard: only the data needed for the immediate purpose is accessed or shared.
4. [✓ (100%)] Patient access requests are routed to the privacy officer; the patient's identity is verified; the requested PHI is provided within 30 days in the form requested where readily producible.
5. [🚩 LOW OVERLAP] Privacy incidents are reported by any staff member who observes or causes one; the privacy officer logs the incident, performs breach risk assessment per 45 CFR 164.402, and notifies affected individuals, HHS, and (if 500+ individuals) media per 45 CFR 164.404 when notification is required.
6. [✓ (71%)] Business associate agreements are reviewed annually and at vendor change; renewals or amendments are filed.

**Source definitions:**

- [✓] **Protected Health Information (PHI)** — Individually identifiable health information held or transmitted by a covered entity or business associate in any form (paper, electronic, oral). Defined at 45 CFR 160.103.
- [✓] **Minimum necessary** — The HIPAA standard requiring that PHI uses, disclosures, and requests be limited to the minimum amount needed to accomplish the intended purpose (45 CFR 164.502(b)).
- [✓] **Business Associate Agreement (BAA)** — Written contract required by HIPAA between a covered entity and any vendor that handles PHI on the entity's behalf. Defines permitted uses, safeguards, and breach notification.
- [✓] **Breach** — Acquisition, access, use, or disclosure of PHI in a manner not permitted by the HIPAA Privacy Rule that compromises the security or privacy of the PHI (45 CFR 164.402).


#### Source #26: Health Information Security Policy

_(7 statements · 6 steps · 4 definitions)_

**Source policy_statements:**

1. [⚠️  partial] <<LAB_NAME>> implements administrative, physical, and technical safeguards for ePHI as required by 45 CFR Part 164 Subpart C.
2. [⚠️  partial] Access to ePHI is restricted by role; unique user IDs are assigned to every workforce member; access rights are reviewed at least annually and adjusted promptly on role change or separation.
3. [✓ (62%)] Authentication uses individually assigned credentials; multi-factor authentication is enforced for remote access and for any administrative role; shared accounts are prohibited.
4. [✓ (75%)] Audit logs of access to and modification of ePHI are maintained, retained for at least 6 years per the HIPAA Security Rule, and reviewed at least monthly for anomalies.
5. [✓ (67%)] ePHI is encrypted at rest on portable devices and during transmission across non-internal networks; encryption keys are managed per the lab's key management procedure.
6. [🚩 LOW OVERLAP] Workforce HIPAA Security training is delivered at hire and annually; completion is documented.
7. [🚩 LOW OVERLAP] Security incidents (unauthorized access, malware, lost devices, suspected breach) are reported immediately to the security officer; investigated; documented; and reported externally where required by 45 CFR 164.404.

**Source procedure_steps:**

1. [⚠️  partial] At hire, IT provisions a unique user account with role-appropriate access; the workforce member completes HIPAA Security training; both are documented.
2. [🚩 LOW OVERLAP] On role change, IT adjusts access within one business day of HR notification; the change is documented in the access log.
3. [⚠️  partial] On separation, IT disables access by close of business the same day as separation; physical credentials (badges, tokens) are collected; the de-provisioning is documented.
4. [✓ (53%)] Audit logs are reviewed monthly by the security officer; anomalies (access outside normal hours, access to records not assigned, repeated authentication failures) trigger investigation.
5. [🚩 LOW OVERLAP] Encryption is verified at hardware provisioning (portable devices) and at transmission go-live (interfaces, file transfers); evidence is filed.
6. [⚠️  partial] Security incidents are logged on the Security Incident log; the security officer performs risk assessment per 45 CFR 164.402; breach determination drives notifications per 45 CFR 164.404 (affected individuals within 60 days, HHS via the breach portal, media if 500+ in a state).

**Source definitions:**

- [✓] **Electronic Protected Health Information (ePHI)** — PHI in electronic form. Subject to the HIPAA Security Rule (45 CFR Part 164 Subpart C).
- [✓] **Audit log** — Record of access to and activity within systems containing ePHI. Required by 45 CFR 164.312(b).
- [✓] **Security incident** — Attempted or successful unauthorized access, use, disclosure, modification, or destruction of ePHI, or interference with system operations in an information system holding ePHI.
- [✓] **Breach** — Acquisition, access, use, or disclosure of PHI in a manner not permitted by the HIPAA Privacy Rule that compromises the security or privacy of the PHI (45 CFR 164.402).


#### Source #27: Data Capture, Transmission, and Retention Policy

_(6 statements · 6 steps · 4 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Every patient test result transmitted from an instrument to the LIS is verified by a calculation verification at interface go-live and reverified after any interface change, per 42 CFR 493.1281(c).
2. [🚩 LOW OVERLAP] LIS-to-EHR result transmission is verified at go-live and after any interface change with a documented end-to-end test (sample patient, sample result, confirm display in the EHR matches the LIS).
3. [🚩 LOW OVERLAP] All result transmission is logged with date, time, sender, recipient, and confirmation of receipt where the receiving system supports acknowledgment.
4. [🚩 LOW OVERLAP] Access to the LIS and to result data is restricted by role; access is provisioned by HR/IT at hire and de-provisioned on the same business day as separation.
5. [🚩 LOW OVERLAP] Result retention: patient test records, including instrument printouts, are retained for at least 2 years from the date of testing per 42 CFR 493.1105; immunohematology records are retained for at least 10 years; pathology slides are retained per 42 CFR 493.1105(a)(7).
6. [🚩 LOW OVERLAP] Any unauthorized access, alteration, or transmission of patient data is reported as a HIPAA security incident per the lab's HIPAA Security Policy and is documented in the security incident log.

**Source procedure_steps:**

1. [✓ (64%)] At LIS or interface installation, IT and the lab medical director or designee complete a documented validation: test patient, test results across each result type (numeric, text, coded), confirm receipt in downstream system, confirm units of measure and reference ranges display correctly.
2. [🚩 LOW OVERLAP] After any interface change, repeat the validation for the affected analytes and document the recheck before the interface returns to production use.
3. [✓ (100%)] Daily, the LIS administrator (or designee) reviews the interface error queue for failed transmissions and corrects within the same business day; persistent errors trigger an IT ticket and notification to the medical director or designee.
4. [🚩 LOW OVERLAP] On staff hire, HR notifies IT and IT provisions LIS access at the role-appropriate level (testing, review, release, admin). The provisioning request and approval are documented.
5. [⚠️  partial] On staff separation, HR notifies IT and IT removes LIS access by close of business the same day. The de-provisioning is documented in the security log.
6. [⚠️  partial] Patient records and instrument printouts are retained per the retention schedule; record disposal at end-of-retention requires medical director or designee approval and is documented in the destruction log.

**Source definitions:**

- [✓] **Calculation verification** — End-to-end check that a test result entered or generated in the instrument arrives in the LIS and the EHR with the same numeric value, units, and reference range. Required at interface go-live and after change.
- [✓] **Interface error queue** — The LIS queue of messages that failed to send or receive. Reviewed every business day; persistent failures are escalated.
- [✓] **Result transmission log** — Audit trail of every test result sent from the LIS, including timestamp, sender, recipient, and acknowledgment.
- [✓] **HIPAA security incident** — Any actual or suspected unauthorized access, use, disclosure, modification, or destruction of electronic PHI. Reported per the HIPAA Security Policy.


---

## Combined #109

**Combined policy_name:** Laboratory Governance and Leadership Policy

**Source IDs absorbed:** 29, 30, 31, 32


### Combined content (what we ship)

**policy_statements:**

1. <<LAB_NAME>> maintains a current organizational chart that names each CLIA-required role (Laboratory Director, Technical Consultant for moderate complexity, Technical Supervisor for high complexity, General Supervisor, Clinical Consultant for moderate complexity, Testing Personnel) and the reporting line from each to the Director.
2. The org chart is reviewed and approved by the medical director or designee at least annually and any time a CLIA-defined role changes; the current chart is posted in the lab and available to inspectors on request; previous versions are archived for at least 2 years per the record retention policy.
3. Any vacancy in a CLIA-required role (Director, Technical Consultant or Supervisor, General Supervisor, Clinical Consultant) is filled or covered by a qualified individual immediately; vacancies lasting more than 30 days are reported to the medical director or designee for escalation to CMS notification per 42 CFR 493.1775.
4. <<LAB_NAME>> has a defined governance structure: ownership entity, governing body (board or equivalent), medical director or designee, and operational management. The governing body's responsibilities are documented and include: appointment and oversight of the medical director or designee, approval of major operational and capital decisions, financial stewardship, and final accountability for regulatory compliance.
5. The Laboratory Director holds the responsibilities listed at 42 CFR 493.1445, including final responsibility for every result reported, and may delegate specific duties to qualified designees while retaining responsibility. The Director reports to the governing body and is responsible for the overall operation and administration of the lab.
6. The laboratory's quality program (42 CFR 493.1200) is governed by the Laboratory Director or designee, with documented review of QC, PT, complaints, incidents, and corrective action on the lab's documented cadence (typically quarterly); minutes are filed in the quality binder.
7. <<LAB_NAME>> commits to a non-punitive (just-culture) approach to error and near-miss reporting: staff who report in good faith are not subject to discipline solely for the report. Errors caused by reckless behavior, willful misconduct, or knowing violation of policy are subject to disciplinary action; honest mistakes and system failures are addressed through process improvement, not blame.
8. Quality and safety metrics (error rate, near-miss reports, complaint volume, staff-perceived safety climate) are tracked and reviewed at least annually by the medical director or designee; trends drive system change.
9. Every staff member conducts themselves with integrity, honesty, and respect for patients, colleagues, and the regulatory environment. Fabrication of test results, alteration of records, falsification of QC data, falsification of competency assessments, and any other form of fraud are absolute violations resulting in immediate termination and reporting to the appropriate licensing and regulatory authorities.
10. Conflicts of interest (financial relationships with vendors, ownership of competing labs, family members in regulatory or referring positions) are disclosed at hire, on change, and annually; the lab's COI committee or medical director or designee reviews and manages.
11. <<LAB_NAME>> complies with anti-kickback obligations under 42 USC 1320a-7b and Stark Law obligations under 42 USC 1395nn; the lab does not solicit or accept anything of value in exchange for referrals.
12. Every staff member completes Code of Ethical Conduct training at hire and annually; signed acknowledgments are filed in the personnel record.
13. Leadership reviews the governance structure annually, updates the org chart as roles change, and re-affirms the Laboratory Director's responsibilities in writing.

**procedure_steps:**

1. Maintain the organizational chart in the leadership binder; update on every role change within 5 business days; annual review with sign-off by the Laboratory Director.
2. Post the current org chart at each testing site; archive prior versions with the personnel records for the 2-year retention.
3. Log any CLIA-required role vacancy on the Role Vacancy register; medical director or designee approves any interim coverage arrangement; vacancies longer than 30 days are escalated to CMS notification per 42 CFR 493.1775.
4. Document the Laboratory Director's delegation of any specific responsibilities in writing; designee acknowledges in writing.
5. Governing body meetings occur on a regular schedule (typically quarterly); minutes are retained; annual review of governance roles, reporting lines, and decision authorities is documented and signed.
6. Hold the documented governance/quality review cadence (typically quarterly); minutes filed in the quality binder; trends in QC, PT, complaints, and incidents drive corrective action.
7. Maintain the just-culture incident-reporting channel; report into the quality review; investigation distinguishes between system failure, at-risk behavior (lapse), and reckless behavior; corrective action matches the category.
8. Annual culture-of-safety review by the medical director or designee assesses metrics and survey data; findings drive system change.
9. On hire, every staff member receives and signs the Code of Ethical Conduct, which includes COI disclosure, anti-fraud, confidentiality, anti-kickback, and Stark obligations; the signed acknowledgment is filed.
10. Annual refresher training covers conflicts of interest, anti-fraud, confidentiality, and anti-kickback obligations; tracked in the personnel record.
11. COI disclosures are collected at hire, annually, and on change; the medical director or designee or the COI committee reviews and manages; the disclosure register is updated.
12. Suspected violations are reported via the lab's reporting channels (medical director or designee, anonymous hotline, or external authority); investigation follows the Whistleblower policy.
13. On change of ownership, governing body composition, or Laboratory Director: updated documentation is filed and CMS is notified per the Accreditation Body Notification policy and 42 CFR 493.1775.
14. Conduct the annual leadership review of governance, structure, and code; document.

**definitions:**

- **Just culture** — A workplace framework that distinguishes human error (console and coach), at-risk behavior (coach), and reckless behavior (sanction), used in incident review to drive learning instead of blame.
- **Non-punitive reporting** — The lab's commitment that staff reporting errors or near-misses in good faith are not subject to discipline solely for the report. Reckless behavior remains subject to discipline.
- **Reporting line** — The supervisor each role holder reports to for technical, quality, and personnel matters. Documented on the organizational chart.
- **Role Vacancy register** — Log of any CLIA-required role currently vacant, the interim coverage arrangement, and the target fill date. Vacancies longer than 30 days trigger escalation.
- **Governing body** — The board or equivalent group with final accountability for the lab's operations and compliance. May be the hospital board, the lab's own board, or the ownership entity.
- **Decision authority** — The level of governance approval required for specific decisions (capital purchases, director changes, major operational changes). Documented in the governance structure.
- **Conflict of interest (COI)** — Any financial, family, or personal relationship that could reasonably appear to influence the staff member's lab decisions. Disclosed at hire, annually, and on change.
- **Anti-kickback** — 42 USC 1320a-7b prohibition on soliciting or receiving remuneration in exchange for referrals of federal health care program business.
- **Stark Law** — 42 USC 1395nn prohibition on physician self-referral for designated health services payable by Medicare or Medicaid.
- **CLIA-defined roles** — Laboratory Director, Technical Consultant (moderate complexity), Technical Supervisor (high complexity), Clinical Consultant (moderate complexity), General Supervisor (high complexity), and Testing Personnel. Each role appears on the organizational chart with reporting line to the Director. Qualifications and responsibilities per 42 CFR 493.1441 through 493.1467 (high) and the parallel moderate-complexity sections.

### Source-side coverage check


#### Source #29: Organizational Chart and Reporting Structure Policy

_(5 statements · 5 steps · 3 definitions)_

**Source policy_statements:**

1. [✓ (70%)] <<LAB_NAME>> maintains a current organizational chart that shows the laboratory director, technical consultant (moderate complexity) or technical supervisor (high complexity), general supervisor (high complexity), clinical consultant (moderate complexity), and all testing personnel with their reporting lines.
2. [✓ (100%)] The org chart is reviewed and approved by the medical director or designee at least annually and any time a CLIA-defined role changes.
3. [🚩 LOW OVERLAP] Each named role on the org chart has a current job description on file in the personnel record, signed by the role holder and by the medical director or designee.
4. [✓ (100%)] The current org chart is posted in the lab and available to inspectors on request; previous versions are archived for at least 2 years per the record retention policy.
5. [✓ (100%)] Any vacancy in a CLIA-required role (director, technical consultant or supervisor, general supervisor, clinical consultant) is filled or covered by a qualified individual immediately; vacancies lasting more than 30 days are reported to the medical director or designee for escalation to CMS notification per 42 CFR 493.1775.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] The medical director or designee maintains the current org chart with role titles, named individuals, CLIA-required qualifications met, and reporting lines.
2. [🚩 LOW OVERLAP] Any change in role assignment (hire, separation, role change) is reflected on the chart within 5 business days of the change.
3. [🚩 LOW OVERLAP] At each annual review, the medical director or designee re-signs and re-dates the chart and updates job descriptions for any role whose responsibilities changed.
4. [🚩 LOW OVERLAP] The current chart is posted at each testing site; archived versions are filed with the personnel records for 2-year retention.
5. [✓ (62%)] Any CLIA-required role left vacant is logged on the Role Vacancy register; the medical director or designee approves any interim coverage arrangement.

**Source definitions:**

- [✓] **CLIA-defined roles** — Laboratory director, technical consultant (moderate complexity), technical supervisor (high complexity), clinical consultant (moderate complexity), general supervisor (high complexity), testing personnel. Qualifications and responsibilities per 42 CFR 493.1441-1467.
- [✓] **Reporting line** — The supervisor each role holder reports to for technical, quality, and personnel matters. Documented on the org chart.
- [✓] **Role Vacancy register** — Log of any CLIA-required role currently vacant, the interim coverage arrangement, and the target fill date.


#### Source #30: Governance Responsibilities Policy

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (100%)] <<LAB_NAME>> has a defined governance structure: ownership entity, governing body (board or equivalent), medical director or designee, and operational management.
2. [✓ (100%)] The governing body's responsibilities are documented and include: appointment and oversight of the medical director or designee, approval of major operational and capital decisions, financial stewardship, and final accountability for regulatory compliance.
3. [⚠️  partial] The medical director or designee reports to the governing body and is responsible for the overall operation and administration of the lab per 42 CFR 493.1445 (moderate complexity) or 42 CFR 493.1407 (high complexity).
4. [🚩 LOW OVERLAP] Governance roles, reporting lines, and decision authorities are documented and reviewed annually.
5. [🚩 LOW OVERLAP] Conflicts of interest among governance members are disclosed and managed per the lab's Code of Ethical Conduct policy.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Governance roles are defined in writing; each role holder signs the role description at appointment.
2. [✓ (100%)] Governing body meetings occur on a regular schedule (typically quarterly); minutes are retained.
3. [✓ (100%)] Annual review of governance roles, reporting lines, and decision authorities is documented and signed.
4. [⚠️  partial] Any change in ownership, governing body composition, or medical director or designee is reflected in updated documentation and triggers CMS notification per the Accreditation Body Notification policy.

**Source definitions:**

- [✓] **Governing body** — The board or equivalent group with final accountability for the lab's operations and compliance. May be the owner if a small lab, or a board of directors if larger.
- [✓] **Decision authority** — The level of governance approval required for specific decisions (capital purchases, director change, scope of services change, etc.). Defined in the governance documentation.


#### Source #31: Culture of Safety and Quality Policy

_(5 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (85%)] <<LAB_NAME>> commits to a non-punitive approach to error and near-miss reporting: staff who report in good faith are not subject to discipline solely for the report.
2. [✓ (100%)] Errors caused by reckless behavior, willful misconduct, or knowing violation of policy are subject to disciplinary action; honest mistakes and system failures are addressed through process improvement, not blame.
3. [🚩 LOW OVERLAP] Every staff member is trained at hire and annually on the lab's error reporting channels, non-retaliation commitment, and the distinction between system failure and individual misconduct (the 'Just Culture' framework).
4. [✓ (100%)] Quality and safety metrics (error rate, near-miss reports, complaint volume, staff-perceived safety climate) are tracked and reviewed at least annually by the medical director or designee; trends drive system change.
5. [🚩 LOW OVERLAP] Leadership models culture-of-safety behaviors: visible response to reports, acknowledgment of contributions, transparency about findings and actions, and consistent application of the just-culture distinctions.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] On hire, every staff member receives culture-of-safety training including the non-punitive reporting commitment and the Just Culture framework; refreshed annually.
2. [🚩 LOW OVERLAP] Errors and near-misses are reported on the Quality Event log; reports are acknowledged within 5 business days.
3. [✓ (83%)] Investigation distinguishes between system failure, at-risk behavior (lapse), and reckless behavior; corrective action is matched to the category.
4. [✓ (100%)] Annual culture-of-safety review by the medical director or designee assesses metrics and survey data; findings drive system change.

**Source definitions:**

- [✓] **Just Culture** — Framework distinguishing human error (managed by system change), at-risk behavior (managed by coaching), and reckless behavior (managed by discipline).
- [✓] **Non-punitive reporting** — The lab's commitment that staff reporting errors or near-misses in good faith are not subject to discipline solely for the report.


#### Source #32: Code of Ethical Conduct Policy

_(6 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (70%)] Every staff member at <<LAB_NAME>> conducts themselves with integrity, honesty, and respect for patients, colleagues, and the regulatory environment.
2. [✓ (100%)] Fabrication of test results, alteration of records, falsification of QC data, falsification of competency assessments, and any other form of fraud are absolute violations resulting in immediate termination and reporting to the appropriate licensing and regulatory authorities.
3. [✓ (100%)] Conflicts of interest (financial relationships with vendors, ownership of competing labs, family members in regulatory or referring positions) are disclosed at hire, on change, and annually; the lab's COI committee or medical director or designee reviews and manages.
4. [🚩 LOW OVERLAP] Confidentiality of patient data, employee data, and proprietary lab data is maintained at all times per the Health Information Privacy and Security policies.
5. [✓ (64%)] Anti-kickback obligations (42 USC 1320a-7b) and Stark Law obligations (42 USC 1395nn) are met; the lab does not solicit or accept anything of value in exchange for referrals.
6. [✓ (100%)] Every staff member completes Code of Ethical Conduct training at hire and annually.

**Source procedure_steps:**

1. [✓ (75%)] At hire, every staff member receives and signs the Code of Ethical Conduct; the signed acknowledgment is filed.
2. [✓ (100%)] Annual refresher training covers conflicts of interest, anti-fraud, confidentiality, and anti-kickback obligations.
3. [✓ (100%)] COI disclosures are collected at hire, annually, and on change; the medical director or designee or the COI committee reviews and manages.
4. [✓ (100%)] Suspected violations are reported via the lab's reporting channels (medical director or designee, anonymous hotline, or external authority); investigation follows the Whistleblower policy.

**Source definitions:**

- [✓] **Conflict of interest (COI)** — Any financial, family, or personal relationship that could reasonably appear to influence the staff member's professional judgment.
- [✓] **Anti-kickback** — 42 USC 1320a-7b prohibition on soliciting or receiving remuneration in exchange for referrals of federal healthcare program business.


---

## Combined #110

**Combined policy_name:** Infection Prevention and Standard Precautions Policy

**Source IDs absorbed:** 22, 23


### Combined content (what we ship)

**policy_statements:**

1. <<LAB_NAME>> maintains a written Exposure Control Plan and infection prevention program covering exposure determination, hand hygiene, PPE, sharps handling, biological spill response, Hepatitis B vaccination, and post-exposure evaluation and follow-up; the program is reviewed at least annually and updated whenever new tasks or procedures introduce new exposure risks.
2. Standard precautions are observed for every specimen and every patient interaction; PPE (gloves, lab coats, eye protection, masks as appropriate) is provided by the employer at no cost to the employee and worn whenever the task indicates exposure risk per OSHA 29 CFR 1910.1030(d)(3).
3. Eating, drinking, smoking, applying cosmetics or lip balm, handling contact lenses, and mouth pipetting are prohibited in the laboratory work area; food and drink are not stored in refrigerators, freezers, shelves, cabinets, or on counter-tops or bench-tops where blood or other potentially infectious materials are present.
4. Hand hygiene is performed before patient contact, before clean or aseptic procedures, after contact with specimens or contaminated surfaces, after removing PPE, and on entering and leaving the laboratory.
5. Hepatitis B vaccination is offered at no cost to every staff member with occupational exposure within 10 working days of initial assignment, per 29 CFR 1910.1030(f); declination is documented in writing using the OSHA-mandated declination form and the staff member retains the right to accept the vaccination later at no cost.
6. Sharps handling uses safer-engineered sharps wherever feasible; sharps are not bent, recapped, or removed by hand; sharps containers are puncture-resistant, leak-proof, color-coded or labeled, and replaced when the fill line is reached; the Sharps Injury Log is maintained per 29 CFR 1910.1030(h)(5).
7. Biological spills are managed per the documented spill response procedure: contain, absorb, disinfect with an EPA-registered tuberculocidal disinfectant per the manufacturer's contact time, dispose as biohazard waste, document on the Spill log; spill kits are stocked and inventoried in every testing area.
8. Reusable lab coats and other contaminated garments are sent to a laundry that handles bloodborne-pathogen-contaminated items per the lab's laundry contract; contaminated garments are NOT taken home by staff for laundering.
9. On any exposure incident (needlestick, splash to mucous membrane or non-intact skin, contamination), the staff member follows the post-exposure procedure immediately, the source patient is identified and tested per OSHA 29 CFR 1910.1030(f)(3) wherever the source is identifiable and consent is obtained, and the exposed staff member is offered the post-exposure medical evaluation at no cost.
10. Exposure incident records and post-exposure evaluation records are maintained for the duration of employment plus 30 years per 29 CFR 1910.1020; the Sharps Injury Log entries are retained for at least 5 years per 29 CFR 1910.1030(h)(5)(iii).

**procedure_steps:**

1. At hire and annually, every staff member with occupational exposure completes OSHA-required Bloodborne Pathogens training covering the Exposure Control Plan, PPE selection and use, engineering and work-practice controls, the Hepatitis B vaccination offer, and exposure reporting; completion is documented in the personnel record.
2. Within 10 working days of initial assignment to a position with occupational exposure, the employer offers Hepatitis B vaccination at no cost; the staff member either accepts (vaccination series is initiated and documented) or signs the OSHA declination form (filed in the personnel record).
3. Before any specimen handling task, the staff member selects PPE appropriate to the task: gloves and lab coat as baseline; face shield or eye protection if splash potential; respirator (N95 or higher) if respiratory pathogen handling is indicated by the lab's risk assessment.
4. PPE is donned per the standard donning sequence (gown, mask or respirator, eye protection, gloves) and doffed per the standard doffing sequence (gloves, gown, eye protection, mask or respirator) with hand hygiene performed before donning and immediately after doffing.
5. PPE inventory is maintained at point-of-use; checked at the documented cadence (typically weekly); replenished within one business day of any depletion; substitutions or shortages reported to the Safety Officer.
6. On any exposure event: the staff member renders first aid (wash with soap and water for skin exposures; flush mucous membranes with water or saline), notifies the supervisor and the Safety Officer immediately, and is sent to the occupational health provider for post-exposure medical evaluation; the source patient (where identifiable) is identified and the lab requests source-patient testing per OSHA and the lab's procedure; results and PEP recommendations are documented on the Exposure Incident log.
7. Maintain the Sharps Injury Log with date, type and brand of device, work area where the injury occurred, and an explanation of the circumstances; review at the documented cadence (typically quarterly) to identify trends and corrective actions.
8. Spill response: trained staff don PPE, contain the spill, cover with absorbent material, apply an EPA-registered tuberculocidal disinfectant for the manufacturer's full contact time, dispose of contaminated absorbent and sharps as biohazard waste, document the event on the Spill log; the Spill Kit is restocked.
9. Audit infection-prevention practices on the documented cadence (typically quarterly walk-rounds covering PPE use, hand hygiene, food/drink ban, sharps disposal, spill-kit availability, and reusable-garment laundering); document findings and corrective actions.
10. Annual review and update of the Exposure Control Plan and infection prevention program by the medical director or designee and the Safety Officer; both sign and date the reviewed plan; the plan is updated whenever a new task or procedure introduces new exposure risk.

**definitions:**

- **Standard precautions** — Infection prevention practices applied to every patient and every specimen regardless of suspected or confirmed infection status.
- **Exposure Control Plan** — The OSHA-required written plan describing how the laboratory eliminates or minimizes employee exposure to bloodborne pathogens, including the exposure determination, engineering controls, work practice controls, PPE, Hepatitis B vaccination, communication of hazards, recordkeeping, and post-exposure evaluation and follow-up. Required by 29 CFR 1910.1030(c)(1).
- **Exposure incident** — A specific eye, mouth, other mucous membrane, non-intact skin, or parenteral contact with blood or other potentially infectious materials resulting from the performance of an employee's duties. Triggers the post-exposure evaluation and follow-up procedure per 29 CFR 1910.1030(f)(3).
- **Personal Protective Equipment (PPE)** — Specialized clothing or equipment worn by an employee for protection against infectious materials. Includes gloves, gowns, lab coats, face shields, masks, eye protection, and respirators. Provided by the employer at no cost per 29 CFR 1910.1030(d)(3).
- **Spill Kit** — Pre-assembled set of materials for cleaning up blood or body-fluid spills: absorbent material, EPA-registered tuberculocidal disinfectant, biohazard bags, PPE, and a scoop or forceps for picking up broken glass or other sharps.
- **Hepatitis B vaccination** — Series of vaccinations against the Hepatitis B virus. Offered at no cost by the employer to every employee with occupational exposure within 10 working days of initial assignment per 29 CFR 1910.1030(f); declination is documented in writing on the OSHA-mandated form.
- **Sharps Injury Log** — OSHA-required log recording each sharps injury: date, type and brand of device involved, work area where the injury occurred, and circumstances. Maintained per 29 CFR 1910.1030(h)(5) and retained at least 5 years.

### Source-side coverage check


#### Source #22: Infection Prevention and Control Program Policy

_(6 statements · 5 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] <<LAB_NAME>> maintains a written Exposure Control Plan that identifies job classifications with occupational exposure to blood or other potentially infectious materials and the methods used to eliminate or minimize exposure.
2. [🚩 LOW OVERLAP] Standard Precautions apply to all human blood and other potentially infectious materials: PPE (gloves, gown, eye protection, face shield as needed), engineering controls (sharps containers, biosafety cabinets, splash guards), and work practice controls (no eating, drinking, mouth pipetting, or applying cosmetics in the lab).
3. [✓ (85%)] Hepatitis B vaccination is offered at no cost to every staff member with occupational exposure within 10 working days of initial assignment; declination is documented in writing.
4. [🚩 LOW OVERLAP] Sharps injuries and other exposure incidents are reported immediately, evaluated by the occupational health provider, and documented on the Exposure Incident log per 29 CFR 1910.1030(f).
5. [✓ (56%)] The Exposure Control Plan is reviewed and updated annually and whenever new tasks or procedures introduce new exposure risks.
6. [🚩 LOW OVERLAP] Hand hygiene per CDC guidelines is performed on entry and exit of the lab, between glove changes, and after any specimen handling.

**Source procedure_steps:**

1. [⚠️  partial] On hire, every staff member with occupational exposure receives training on the Exposure Control Plan, PPE use, engineering and work-practice controls, and the exposure reporting process; documented and re-delivered annually.
2. [🚩 LOW OVERLAP] Hepatitis B vaccination is offered within 10 working days of initial assignment; the staff member's acceptance or written declination is filed in the personnel record.
3. [🚩 LOW OVERLAP] Any sharps injury or exposure incident is reported immediately to the supervisor and to occupational health; first aid is rendered and the source patient (where identifiable) is tested per OSHA requirements.
4. [🚩 LOW OVERLAP] The Exposure Incident is documented on the Exposure Incident log: date/time, route, source patient ID (if known), staff member, PPE in use, immediate action, source-patient testing, staff post-exposure prophylaxis or follow-up.
5. [🚩 LOW OVERLAP] The medical director or designee reviews exposure incidents quarterly and the Exposure Control Plan annually; updates are documented.

**Source definitions:**

- [✓] **Exposure Control Plan** — The lab's written plan for eliminating or minimizing occupational exposure to blood and other potentially infectious materials. Required by 29 CFR 1910.1030.
- [✓] **Standard Precautions** — The CDC infection-control approach treating all human blood and body fluids as if known to be infectious for bloodborne pathogens.
- [✓] **Exposure incident** — A specific eye, mouth, other mucous membrane, non-intact skin, or parenteral contact with blood or other potentially infectious materials that results from the performance of an employee's duties (29 CFR 1910.1030).


#### Source #23: Standard Precautions and PPE Policy

_(6 statements · 6 steps · 3 definitions)_

**Source policy_statements:**

1. [🚩 LOW OVERLAP] Standard Precautions apply to every patient specimen and every shared lab surface as if known to be infectious for bloodborne pathogens.
2. [🚩 LOW OVERLAP] <<LAB_NAME>> provides at no cost to staff: gloves, lab coats, face shields or masks, eye protection, and other PPE appropriate to the task.
3. [🚩 LOW OVERLAP] Minimum PPE: gloves and lab coat at all times when handling specimens; eye protection or face shield when there is potential for splash or aerosol; respirator (N95 or higher) when handling specimens with respiratory pathogens per the lab's risk assessment.
4. [✓ (100%)] Eating, drinking, smoking, applying cosmetics or lip balm, handling contact lenses, and mouth pipetting are prohibited in the lab work area.
5. [🚩 LOW OVERLAP] PPE is removed and disposed of (or sent to laundry for reusable items) before leaving the lab work area; hands are washed immediately after PPE removal.
6. [🚩 LOW OVERLAP] Spills of blood or other potentially infectious materials are cleaned up immediately by trained staff using the lab's Spill Response procedure; spills are logged.

**Source procedure_steps:**

1. [✓ (89%)] Before any specimen handling task, the staff member selects PPE appropriate to the task: gloves and lab coat as baseline; face shield or eye protection if splash potential; respirator if respiratory pathogen handling is required.
2. [✓ (95%)] PPE is donned per the standard donning sequence (gown, mask/respirator, eye protection, gloves) and doffed per the standard doffing sequence (gloves, gown, eye protection, mask/respirator) with hand hygiene before and after.
3. [🚩 LOW OVERLAP] Single-use PPE is disposed of in the appropriate biohazard or sharps container at the end of each task or when soiled.
4. [🚩 LOW OVERLAP] Reusable lab coats are sent to laundry per the lab's laundry contract (NOT taken home); the laundry contract specifies bloodborne-pathogen handling.
5. [🚩 LOW OVERLAP] Spills are addressed using the Spill Kit: contain, absorb, disinfect with EPA-registered tuberculocidal disinfectant per the manufacturer's contact time, dispose as biohazard waste, document on the Spill log.
6. [⚠️  partial] PPE inventory is maintained so that no staff member is ever without appropriate PPE; the inventory is checked weekly and replenished within one business day of any depletion.

**Source definitions:**

- [✓] **Standard Precautions** — The CDC approach to infection control that treats all human blood and certain body fluids as if known to be infectious for bloodborne pathogens. Applies regardless of patient diagnosis or perceived risk.
- [✓] **Personal Protective Equipment (PPE)** — Specialized clothing or equipment worn by an employee for protection against infectious materials. Includes gloves, gowns, lab coats, masks, respirators, and eye protection.
- [✓] **Spill Kit** — Pre-assembled set of materials for cleaning up blood or body fluid spills: absorbent material, EPA-registered disinfectant, biohazard bag, gloves, and disposal materials.


---

## Combined #111

**Combined policy_name:** Human Cells, Tissues, and Cellular Tissue-Based Products (HCT/P) Policy

**Source IDs absorbed:** 82, 83, 84


### Combined content (what we ship)

**policy_statements:**

1. Donor eligibility for HCT/Ps is determined per 21 CFR 1271.85 before recovery: review of relevant medical records for risk factors for and clinical evidence of relevant communicable disease agents, infectious-disease screening using FDA-licensed/approved/cleared donor screening tests per manufacturer instructions, and physical assessment as applicable. Ineligible donations are not used for transplantation.
2. Required infectious-disease markers tested per 21 CFR 1271.85 include: HIV-1, HIV-2, Hepatitis B virus (HBV), Hepatitis C virus (HCV), Human T-lymphotropic virus type I (HTLV-I), Human T-lymphotropic virus type II (HTLV-II), Treponema pallidum (syphilis treponemal test), and other agents per the current FDA list.
3. Results of donor eligibility testing are reported to the procuring organization with full specimen identification, test methods, reactive or non-reactive determination, and any limitations.
4. Tissue products are received with complete donor eligibility documentation per 21 CFR 1271.155 through 1271.170; products missing eligibility evidence are NOT accepted.
5. Storage temperatures are validated and monitored continuously per the tissue product's specific requirements (temperature, container, light); storage is monitored with alarmed devices; alarm response follows the documented procedure.
6. Release of HCT/Ps to surgical use requires the four-element verification: (1) verified donor eligibility documentation; (2) intact packaging; (3) valid expiration; and (4) recipient/product identification matching the request. All four elements are documented before release.
7. Adverse reactions in tissue recipients involving a possible communicable disease related to HCT/P products are investigated by the medical director or designee in cooperation with the procuring organization and the recipient's treating clinician.
8. Reportable adverse reactions per 21 CFR 1271.350(a) (fatal; life-threatening; permanent impairment or damage; necessitating medical or surgical intervention including hospitalization) are reported to FDA within 15 days of the lab becoming aware.
9. Adverse events involving HCT/P deviations (departure from manufacturing requirements, applicable regulations, or established specifications) are reported to FDA per 21 CFR 1271.350 with full investigation documentation.
10. Tissue records (donor eligibility, recovery, processing, distribution, recipient, adverse events) are retained for at least 10 years after the distribution date per 21 CFR 1271.270 (and per the longer of that or 42 CFR 493.1105 where applicable).
11. Personnel handling HCT/Ps complete documented training before working with tissue products; competency is reassessed at the lab's documented cadence.

**procedure_steps:**

1. For each donation, complete the donor eligibility determination per 21 CFR 1271.85: review medical records for risk factors and clinical evidence of relevant communicable disease agents; perform required infectious-disease testing (HIV-1, HIV-2, HBV, HCV, HTLV-I, HTLV-II, syphilis treponemal, others per current FDA list) using FDA-licensed/approved/cleared screening tests per the manufacturer's instructions; the medical director or designee approves the eligibility determination before recovery.
2. Report donor testing results to the procuring organization in writing with full specimen identification, test methods, reactive/non-reactive determination, and limitations.
3. On receipt of tissue from a supplier or recovery: verify donor eligibility documentation is complete, packaging is intact, expiration is valid, and storage history during transport is acceptable; products missing eligibility evidence are NOT accepted.
4. Store tissue per the product's specific requirements (temperature, container, light) with continuous alarmed monitoring; document temperature, time, and condition on receipt.
5. On release to surgical use, complete the four-element verification: (1) verified donor eligibility; (2) intact packaging; (3) valid expiration; (4) recipient/product identification matching the request; document all four elements before release.
6. Distribute or transplant tissue only after eligibility determination is complete; document the distribution event with full traceability (donor ID, product ID, recipient, date, surgeon).
7. On report of an adverse reaction: the medical director or designee initiates investigation; coordinate with the procuring organization and the recipient's treating clinician to gather information; determine whether the reaction meets the reportable threshold per 21 CFR 1271.350(a) (fatal, life-threatening, permanent impairment, requires medical/surgical intervention).
8. If reportable, submit the FDA report within 15 days of becoming aware; document the investigation, conclusion, determination of whether the HCT/P was the cause, and corrective actions; retain per the record retention rules.
9. Retain all tissue records for at least 10 years post-distribution per 21 CFR 1271.270; longer where state law or 42 CFR 493.1105 requires.

**definitions:**

- **HCT/P** — Human cells, tissues, and cellular and tissue-based products as defined in 21 CFR 1271.3(d); includes bone, ligaments, skin, dura mater, heart valves, corneas, semen, ova, and others.
- **Donor eligibility testing** — Infectious-disease screening required for HCT/P donors per 21 CFR 1271.85 to confirm absence of communicable disease agents (HIV-1, HIV-2, HBV, HCV, HTLV-I, HTLV-II, syphilis treponemal, others per current FDA list).
- **HCT/P deviation** — Departure from manufacturing requirements, applicable regulations, or established specifications for an HCT/P. Reported to FDA per 21 CFR 1271.350.
- **HCT/P adverse reaction** — Adverse event in a recipient of an HCT/P that may involve transmission of a communicable disease. Reportable to FDA within 15 days of awareness when fatal, life-threatening, causing permanent impairment, or requiring medical or surgical intervention per 21 CFR 1271.350(a).
- **Four-element release verification** — The required pre-release check for HCT/Ps: verified donor eligibility, intact packaging, valid expiration, recipient/product identification matching the request. All four documented before release.

### Source-side coverage check


#### Source #82: Organ, Tissue, and Eye Donation Policy

_(4 statements · 4 steps · 2 definitions)_

**Source policy_statements:**

1. [✓ (50%)] Donor specimens for HCT/P eligibility are tested using FDA-licensed, approved, or cleared donor screening tests per 21 CFR 1271.85.
2. [🚩 LOW OVERLAP] Required infectious-disease markers (HIV-1/2, HBV, HCV, HTLV-I/II, syphilis treponemal, others per current FDA list) are tested per the manufacturer's instructions.
3. [✓ (91%)] Results are reported to the procuring organization with full specimen identification, test methods, reactive/non-reactive determination, and any limitations.
4. [🚩 LOW OVERLAP] Records of donor testing are retained per 21 CFR 1271.270 (typically 10 years past distribution) and 42 CFR 493.1105.

**Source procedure_steps:**

1. [🚩 LOW OVERLAP] Specimens received from organ procurement, tissue bank, or eye bank are accessioned with full traceability to the procuring organization and donor ID.
2. [⚠️  partial] Testing is performed using current FDA-cleared donor screening tests per the manufacturer's instructions.
3. [🚩 LOW OVERLAP] Results are reported in writing to the procuring organization with all required elements.
4. [🚩 LOW OVERLAP] Records are retained per the longer of 21 CFR 1271.270 and 42 CFR 493.1105.

**Source definitions:**

- [✓] **HCT/P** — Human Cells, Tissues, and Cellular and Tissue-Based Products. Regulated by FDA under 21 CFR 1271.
- [✓] **Donor eligibility testing** — Infectious disease screening required for HCT/P donors to confirm absence of communicable disease agents per 21 CFR 1271.85.


#### Source #83: Transplant Tissue Handling Policy

_(5 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (73%)] Tissue products are received with complete donor eligibility documentation per 21 CFR 1271.155-170; products missing eligibility evidence are not accepted.
2. [✓ (58%)] Storage follows the tissue product's specific requirements (temperature, container, light); storage is monitored continuously with alarmed devices.
3. [✓ (69%)] Release to surgical use requires verified donor eligibility, intact packaging, valid expiration, and recipient/product identification matching the request.
4. [🚩 LOW OVERLAP] Adverse events related to tissue products are reported to the supplier and to FDA per 21 CFR 1271.350 (HCT/P deviation reporting).
5. [🚩 LOW OVERLAP] Records retained per 21 CFR 1271.270 (10 years past distribution) and 42 CFR 493.1105.

**Source procedure_steps:**

1. [✓ (50%)] On receipt, verify donor eligibility documentation, packaging integrity, expiration, and storage history during transport.
2. [🚩 LOW OVERLAP] Store per the product's requirements with alarmed monitoring.
3. [🚩 LOW OVERLAP] On release, verify recipient/product match, eligibility, packaging, and expiration; document.
4. [🚩 LOW OVERLAP] Report adverse events to the supplier and FDA per regulation; document.

**Source definitions:**

- [✓] **HCT/P deviation** — Departure from manufacturing requirements, applicable regulations, or established specifications for HCT/P products. Reportable to FDA per 21 CFR 1271.350.


#### Source #84: Transplant Safety Surveillance Policy

_(3 statements · 4 steps · 1 definitions)_

**Source policy_statements:**

1. [✓ (58%)] Adverse reactions in transplant recipients involving a possible communicable disease related to HCT/P products are investigated by the lab in cooperation with the procuring organization.
2. [✓ (71%)] Reportable adverse reactions per 21 CFR 1271.350(a) are reported to FDA within 15 days of the lab becoming aware.
3. [🚩 LOW OVERLAP] Investigation outcomes are documented, including the determination of whether the HCT/P was the cause; records retained per 21 CFR 1271.270 and 42 CFR 493.1105.

**Source procedure_steps:**

1. [✓ (100%)] On report of an adverse reaction, the medical director or designee initiates investigation.
2. [✓ (100%)] Coordinate with the procuring organization and the recipient's treating clinician to gather information.
3. [✓ (56%)] Determine whether the reaction meets the reportable threshold per 21 CFR 1271.350(a); if so, submit the FDA report within 15 days.
4. [✓ (60%)] Document the investigation, conclusion, and corrective actions; retain per record retention rules.

**Source definitions:**

- [✓] **HCT/P adverse reaction** — Adverse event in a recipient of an HCT/P that may involve transmission of a communicable disease. Reportable to FDA when meeting the 21 CFR 1271.350(a) criteria.


---
