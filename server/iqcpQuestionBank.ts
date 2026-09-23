// server/iqcpQuestionBank.ts
//
// IQCP (Individualized Quality Control Plan) content for the VeritaQC IQCP
// Builder. Sourced from the CMS "IQCP: Developing an IQCP, A Step-by-Step
// Guide" workbook (Appendix A-F), the CMS IQCP CLIA brochure (#13), and the
// CLIA regulations at 42 CFR Part 493. CMS publications are U.S. Government
// works in the public domain.
//
// IQCP is a VOLUNTARY QC option for NONWAIVED (moderate and high complexity)
// testing. It lets a laboratory run a documented, risk-based QC plan that may
// use less external QC than the CLIA default, but never less than the
// manufacturer's instructions. It is not available for waived tests, and the
// pathology disciplines that do not use traditional QC (histopathology, oral
// pathology, cytology) are outside its scope. Labs VERIFY performance;
// manufacturers VALIDATE. (Copy rule: no em dashes; product names carry the
// trademark in UI copy, not here.)

export interface IqcpScreenQuestion {
  id: "nonwaived" | "reduce_intent" | "mfr_less_strict";
  prompt: string;
  help: string;
}

// The 3-question pre-screen. Michael's front door: ask these before doing any
// of the work, to see whether an IQCP is even worth building. ALL THREE must
// be "yes". If any is "no", an IQCP is not indicated: run the CLIA default QC
// and document it.
export const IQCP_PRESCREEN: IqcpScreenQuestion[] = [
  {
    id: "nonwaived",
    prompt: "Is this a nonwaived (moderate or high complexity) test?",
    help: "Waived tests never require or use an IQCP. IQCP applies only to nonwaived testing. If the test is waived, stop here and follow the manufacturer's instructions for the waived test.",
  },
  {
    id: "reduce_intent",
    prompt: "Do you intend to run less external QC than the CLIA default (fewer than 2 levels of external control on each day of testing)?",
    help: "The entire point of an IQCP is to justify a reduced QC pattern. If you are content running the CLIA default QC, you do not need an IQCP. Just run default QC and skip the paperwork.",
  },
  {
    id: "mfr_less_strict",
    prompt: "Do the manufacturer's instructions specify a QC pattern less stringent than the CLIA default?",
    help: "The manufacturer's recommended QC (for example built-in procedural or electronic controls, or external QC less often than each day of testing) is the risk-assessment basis for a reduced plan. If the manufacturer's QC meets or exceeds the CLIA default, follow the more stringent instruction. There is nothing to reduce, so no IQCP is needed.",
  },
];

export const IQCP_PRESCREEN_GATE =
  "If the answer to all three is not yes, an IQCP is not indicated. Run the CLIA default QC and document it. An IQCP earns its keep only when the test is nonwaived, you want to run less QC than the default, and the manufacturer's instructions support a lighter pattern.";

export type PrescreenAnswers = {
  nonwaived?: string;
  reduce_intent?: string;
  mfr_less_strict?: string;
};

// Pure gate logic. Returns whether an IQCP is indicated and the plain-language
// reason to show the user. Used by the pre-screen endpoint and reusable by the
// verify script.
export function evaluatePrescreen(a: PrescreenAnswers): { indicated: boolean; reason: string } {
  const yes = (v?: string) => (v || "").trim().toLowerCase() === "yes";
  if (!yes(a.nonwaived)) {
    return {
      indicated: false,
      reason:
        "Waived tests never require an IQCP. Follow the manufacturer's instructions for the waived test.",
    };
  }
  if (!yes(a.reduce_intent)) {
    return {
      indicated: false,
      reason:
        "You do not intend to run less QC than the CLIA default, so an IQCP is not needed. Run the CLIA default QC (at least 2 levels of external control on each day of testing) and document it.",
    };
  }
  if (!yes(a.mfr_less_strict)) {
    return {
      indicated: false,
      reason:
        "The manufacturer's QC instructions are at least as stringent as the CLIA default, so there is no reduction to justify. Follow the manufacturer's instructions and run default QC.",
    };
  }
  return {
    indicated: true,
    reason:
      "All three screening questions are yes. An IQCP is a valid QC option for this test system. Proceed to the risk assessment.",
  };
}

// ---------------------------------------------------------------------------
// Step 1: Risk Assessment
// The five components CMS requires every IQCP risk assessment to evaluate, at
// a minimum, across the pre-analytic, analytic, and post-analytic phases:
// Specimen, Test System, Reagent, Environment, Testing Personnel.
// Each component carries the workbook's "Questions to Consider" plus the
// Appendix D additional questions (a mixture of CLIA requirements and
// recommended good laboratory practices).
// ---------------------------------------------------------------------------

export type IqcpPhase = "Pre-analytic" | "Analytic" | "Post-analytic";

export const IQCP_PHASES: IqcpPhase[] = ["Pre-analytic", "Analytic", "Post-analytic"];

export interface IqcpComponent {
  key: "specimen" | "test_system" | "reagent" | "environment" | "testing_personnel";
  label: string;
  // Lead-in framing from the workbook.
  prompt: string;
  // Workbook "General Questions to Consider" for this component.
  generalQuestions: string[];
  // Appendix D "Additional Risk Assessment Questions" for this component.
  additionalQuestions: string[];
}

export const IQCP_COMPONENTS: IqcpComponent[] = [
  {
    key: "specimen",
    label: "Specimen",
    prompt: "Do you see a potential risk of an error in test results if:",
    generalQuestions: [
      "The manufacturer's instructions for specimen requirements, including but not limited to specimen tube or container type, patient preparation, or specimen storage, are not followed.",
      "The current version of the manufacturer's instructions is not used.",
      "The specimen is improperly labeled.",
      "The specimen is not accurately identified throughout the testing process.",
      "Criteria for specimen rejection are not established and followed.",
    ],
    additionalQuestions: [
      "Are specimens collected in the correct container, with proper preservatives?",
      "Are the manufacturer's instructions followed for proper centrifugation (time and speed) to ensure proper and adequate separation of cells from serum or plasma?",
      "Are written procedures followed for managing unacceptable specimens?",
      "Are the manufacturer's instructions followed for proper specimen collection and use of specimen collection containers?",
      "Are there written procedures for specimen referral to other laboratories?",
    ],
  },
  {
    key: "test_system",
    label: "Test System",
    prompt: "Do you see a potential risk of producing incorrect test results if:",
    generalQuestions: [
      "Maintenance procedures are not consistent with the manufacturer's instructions.",
      "The test is performed outside of its intended use as described in the manufacturer's instructions.",
      "The limitations to the test system are ignored. For example, do lipemia or medications interfere with the test system's performance.",
      "Built-in monitors do not exist for the test system, for example the ability to detect inadequate specimen volume.",
      "The laboratory information system (LIS) is not transmitting results or other information accurately.",
      "The test system does not have a means to ensure positive patient identification, such as a functioning bar code reader.",
      "There is no mechanism, such as an operator lockout, to ensure only trained personnel use the test system.",
    ],
    additionalQuestions: [
      "Does the laboratory have an established range for an acceptable calibration that includes a minimum (or zero), midpoint, and a maximum value near the upper limit of the range that verifies the laboratory's reportable range?",
      "Is the laboratory able to detect mechanical or electronic errors on this test system?",
      "Does the laboratory define and document mechanisms to detect test system optical, pipette, or barcode reader errors?",
      "Does the laboratory perform system controls and function checks according to the manufacturer's instructions, including built-in procedural and electronic (internal) controls, external or internal liquid quality control (assayed vs. unassayed), and temperature monitors and systems?",
      "Does the laboratory utilize hardware and software that is current and appropriate for the needs of the facility?",
      "Is an evaluation of instrument and reagent stability performed following relocation of instruments?",
      "Does the laboratory have established corrective action policies and procedures, including corrective action for out of range controls and calibrations?",
      "Does the laboratory document corrective actions taken, including resolutions, and review and share them with testing personnel?",
      "Does the laboratory have an adequate manual or electronic system in place to accurately and reliably transmit patient results in a timely manner from data entry point to final report destination?",
      "Are final results reviewed by a laboratory supervisor within 24 hours?",
      "Does the laboratory have a Laboratory Information System (LIS)? If so, are there procedures to monitor the accuracy and completeness of the information being transmitted to the LIS?",
      "Does the laboratory have multiple locations? If so, has a risk assessment been performed for each test system (method) at each location for which an IQCP will be established?",
      "Are procedures written according to the manufacturer's instructions for this test?",
      "Are commercial tests performed following the manufacturer's instructions and within the laboratory's stated performance specifications?",
      "Does the laboratory perform and document calibration procedures following the manufacturer's recommendations and using calibration material appropriate for the test systems?",
      "Does the system recognize when external QC and calibrations are expired and prevent users from reporting results if these are due to be performed?",
    ],
  },
  {
    key: "reagent",
    label: "Reagent",
    prompt: "Do you see a potential risk of producing incorrect test results if:",
    generalQuestions: [
      "Storage requirements for reagents are not followed.",
      "Integrity of reagents is not checked when received. For example, some manufacturers ship reagents on dry ice or ice packs to maintain required temperatures.",
      "There is a delay in storing reagents upon receipt.",
      "Reagents are shipped to the laboratory at a time when staff are not available to ensure proper storage, for example a weekend or holiday.",
      "Reagents with different lot numbers are mixed. Consider whether the test system has a mechanism to identify reagent lot numbers or if the laboratory will need to track them manually.",
      "Manufacturer's instructions for reagent preparation are not followed, for example reconstitution of reagents or bringing to room temperature.",
      "The specified type of water required by the test system is not used.",
    ],
    additionalQuestions: [
      "Are expiration dates clearly identified and in agreement with the manufacturer's recommendations (properly labeled)?",
      "Are all reagents, controls, and calibrators used within the manufacturer's designated expiration date?",
      "Are all reagents removed from storage and disposed of when they have reached their expiration date?",
      "Are lot numbers recorded in a log when new lots are received and when beginning use of different lot numbers?",
      "Is there a procedure for evaluating new lot numbers before beginning use for patient testing?",
    ],
  },
  {
    key: "environment",
    label: "Environment",
    prompt: "Do you see a potential risk of producing incorrect test results if:",
    generalQuestions: [
      "The manufacturer's instructions for space and the testing environment are not followed.",
      "The manufacturer's ventilation and airflow requirements are not adhered to.",
      "There is insufficient lighting and space for workflow and the test system.",
      "The manufacturer's instructions for maintaining the appropriate temperature and humidity for the test system are not followed.",
      "Workspace is not free of clutter, dust, or debris.",
    ],
    additionalQuestions: [
      "Does the laboratory have ventilation adequate for conducting all phases of laboratory testing?",
      "Do the manufacturer's instructions specify requirements for ventilation and airflow?",
      "Do the manufacturer's instructions specify the type of water required for this testing process?",
      "Does the laboratory have adequate space to perform testing, prevent cross contamination, and prevent injury?",
      "Is lighting adequate to perform visual interpretation of test results, where required?",
      "Are surge protectors used to prevent fluctuations of the power source in testing areas?",
      "Is the testing area kept clean and clear of clutter and debris that could interfere with the testing process or disrupt airflow?",
    ],
  },
  {
    key: "testing_personnel",
    label: "Testing Personnel",
    prompt: "Do you see a potential risk of an error in test results if:",
    generalQuestions: [
      "Laboratory personnel do not have a formal certification or license if required by the state.",
      "The laboratory does not have adequate personnel to perform patient testing in a safe and timely manner.",
      "There is no documentation of CLIA-required competency assessment for all laboratory personnel.",
      "Laboratory personnel are not trained on specimen requirements (collection and type) required for the test system.",
      "Laboratory personnel are not trained to follow the manufacturer's instructions in their entirety.",
      "Laboratory personnel make transcription errors when reporting results, either written or when using an LIS.",
    ],
    additionalQuestions: [
      "Do all personnel who collect specimens and perform testing follow the manufacturer's instructions?",
      "Do all testing personnel perform QC and PT?",
      "Do all laboratory personnel meet the appropriate educational and training requirements specified by CLIA?",
      "Do laboratory personnel have a formal certification or license, if required by their state?",
      "Does the laboratory have adequate personnel to perform testing in a safe and timely manner?",
      "Does the laboratory have an ongoing and documented competency assessment program that includes the six elements required by CLIA for all personnel categories?",
    ],
  },
];

// ---------------------------------------------------------------------------
// Step 2: Quality Control Plan (QCP)
// The workbook's "General Quality Control Questions to Consider for Your
// Laboratory's QCP". A complete QCP must specify the type, number, and
// frequency of QC and the criteria for acceptable results, and must never
// require less QC than the manufacturer's instructions.
// ---------------------------------------------------------------------------

export const IQCP_QCP_QUESTIONS: string[] = [
  "Do the QC activities identified in your risk assessment provide for immediate detection of errors for each phase of the testing process (before, during, and after testing) for the test?",
  "Do they specify the number, type, and frequency of testing QC materials?",
  "Do they contain criteria to determine acceptable QC results?",
  "Do they require the laboratory to perform QC as specified by the manufacturer's instructions, but not less than the manufacturer's instructions?",
  "Does the QCP indicate that your laboratory director has reviewed, signed, and dated the QCP document?",
];

export const IQCP_QCP_RULE =
  "A complete QCP specifies the type, number, and frequency of QC and the criteria for acceptable results. It may reduce external QC below the CLIA default, but it can never require less QC than the manufacturer's instructions. The laboratory director must review, sign, and date the QCP before implementation.";

// ---------------------------------------------------------------------------
// Step 3: Quality Assessment (QA)
// Appendix E "Quality Assessment (QA) Activities": the ongoing monitoring that
// makes the IQCP complete. Without QA you do not have a complete IQCP.
// ---------------------------------------------------------------------------

export const IQCP_QA_ACTIVITIES: string[] = [
  "Review all reports, manufacturer's instructions, and procedure manuals to monitor accuracy and clarity of results reporting; appropriateness of specimen, specimen collection, handling, and transportation; assay accuracy and precision; turnaround time; and compliance with policy and procedures.",
  "Ensure there is a written procedure or manufacturer's instructions for each assay performed and that they are readily accessible to testing personnel, including all information required by CLIA.",
  "Keep a log of known errors and sources of errors encountered over time for specimen collection, temperature variations, reagent and QC performance, and personnel errors.",
  "Ensure all personnel meet the minimum qualifications necessary for performing testing.",
  "Ensure there is a formal training period for all new personnel and refresher training for existing personnel.",
  "Ensure procedures are in place to document corrective actions taken, record reviews, data entry errors, laboratory investigations of failures and errors (including actions taken to prevent future occurrences), personnel training and competency assessment, and complaints received and actions taken to resolve them.",
  "Monitor QC results for shifts and trends.",
  "Ensure that all personnel participate in performing proficiency testing (PT).",
  "Monitor and document laboratory conditions that could adversely affect patient testing.",
];

// ---------------------------------------------------------------------------
// Appendix F Glossary: key IQCP terms with their CLIA / CMS source cites. Used
// for inline help throughout the builder so the regulatory basis is one click
// away.
// ---------------------------------------------------------------------------

export interface IqcpGlossaryEntry {
  term: string;
  definition: string;
  source: string;
}

export const IQCP_GLOSSARY: IqcpGlossaryEntry[] = [
  {
    term: "Analytic Phase",
    definition:
      "A part of the total testing process involving workflows related to preparation and processing of patient specimens, analysis of specimens, and interpretation of test results.",
    source: "CLIA 42 CFR 493.1251-493.1283",
  },
  {
    term: "Pre-Analytic Phase",
    definition:
      "A part of the total testing process referring to all steps taken prior to the actual testing of a patient specimen, from the test request to the actual testing of the specimen.",
    source: "CLIA Interpretive Guidelines at 42 CFR 493.1240",
  },
  {
    term: "Post-Analytic Phase",
    definition:
      "A part of the total testing process occurring after analysis. It includes but is not limited to data entry, follow-up plan, and reporting results to the healthcare provider.",
    source: "CLIA 42 CFR 493.1291-493.1299",
  },
  {
    term: "Calibration",
    definition:
      "A process of testing and adjusting an instrument or test system to establish a correlation between the measurement response and the concentration or amount of the substance being measured by the test procedure.",
    source: "CLIA 42 CFR 493.2",
  },
  {
    term: "Competency Assessment",
    definition:
      "A process to monitor and assess laboratory personnel performance to ensure that they are fulfilling their duties as required by federal regulation.",
    source: "CMS CLIA Brochure #10; CLIA 42 CFR 493.1413(b)(8) or 493.1451(b)(8)",
  },
  {
    term: "Corrective Action",
    definition:
      "Actions taken to remedy a situation, remove an error, adjust a condition, or prevent recurrence of a problem.",
    source: "Interpretive Guidelines 42 CFR 493.1239(a)(b)(c), 493.1299(a)(b)(c)",
  },
  {
    term: "External Controls",
    definition:
      "Materials that have a similar matrix to patient specimens, are treated in the same manner as patient specimens, and go through all analytic phases of testing. External controls check the operating characteristics of a test system, including instrument stability and calibration.",
    source: "CDC Good Laboratory Practices for Waived Testing Sites (MMWR 2005)",
  },
  {
    term: "Internal Controls",
    definition:
      "Internal or procedural controls that may only monitor a portion of the test system's analytic components, for example a color change that indicates when a patient's specimen or reagent is added correctly.",
    source: "CDC Good Laboratory Practices for Waived Testing Sites (MMWR 2005)",
  },
  {
    term: "Electronic Controls",
    definition:
      "An internal part of the test system that monitors the electrical or electronic components of the test system.",
    source: "CDC Good Laboratory Practices for Waived Testing Sites (MMWR 2005)",
  },
  {
    term: "Individualized Quality Control Plan (IQCP)",
    definition:
      "A framework for customizing a quality control program for your test systems and your laboratory's unique environment. By performing the steps in an IQCP, you examine the potential sources of error in your pre-analytic, analytic, and post-analytic phases of testing, and establish the appropriate QC and quality practices that reduce the likelihood of errors occurring in your laboratory.",
    source: "CMS CLIA Brochure #13",
  },
  {
    term: "Manufacturer's Instructions",
    definition:
      "Written product information usually supplied by the manufacturer with each test kit or test system, containing instructions and critical details for performing the test. All of the instructions in the product insert, from intended use to limitations of the procedure, must be followed.",
    source: "CDC Good Laboratory Practices for Waived Testing Sites (MMWR 2005)",
  },
  {
    term: "Proficiency Test (PT)",
    definition:
      "The testing of unknown samples sent to a laboratory by a CMS approved PT program.",
    source: "CMS CLIA Brochure #8",
  },
  {
    term: "Quality Assessment (QA)",
    definition:
      "An ongoing review process that encompasses all facets of the laboratory's technical and non-technical functions and all locations where testing is performed. The laboratory must establish and follow written policies and procedures to monitor and assess, and when indicated correct, problems identified, including a review of the effectiveness of corrective actions taken.",
    source:
      "CLIA Interpretive Guidelines at 42 CFR 493.1239, 493.1249, 493.1289, 493.1299",
  },
  {
    term: "Quality Control (QC)",
    definition:
      "The procedures used to detect and correct errors that occur because of test system failure, adverse environmental conditions, and variance in operator performance, as well as the monitoring of the accuracy and precision of test performance over time.",
    source: "CMS CLIA Brochure #12",
  },
  {
    term: "Quality Control Plan (QCP)",
    definition:
      "A laboratory's standard operating procedure that describes the practices, resources, and procedures to control the quality of a particular test process.",
    source: "CMS S&C 13-54-CLIA, IQCP: A New Quality Control (QC) Option",
  },
  {
    term: "Risk Assessment (RA)",
    definition:
      "The identification and evaluation of potential failures and sources of error in a testing process. Risk assessments for IQCP must include, at a minimum, an evaluation of the five components: Specimen, Test System, Reagent, Environment, and Testing Personnel.",
    source: "CMS S&C 13-54-CLIA; CMS CLIA Brochure #13",
  },
  {
    term: "Test System",
    definition:
      "The instructions and all the instrumentation, equipment, reagents, and supplies needed to perform an assay or examination and generate test results.",
    source: "CLIA 42 CFR 493.2",
  },
  {
    term: "Testing Process",
    definition:
      "Includes the pre-analytic, analytic, and post-analytic phases of testing, covering everything that occurs from the time the physician initiates the test request to the time the test result is entered in the patient's medical record.",
    source: "CLIA 42 CFR 493.2",
  },
  {
    term: "Verification",
    definition:
      "The process of the laboratory verifying the manufacturer's analytical claims of a test or test system. Verification of method performance should provide evidence that the accuracy, precision, and reportable range of the procedure are adequate to meet the clients' needs, as determined by the laboratory director and clinical consultant. This process must be completed prior to reporting patient results.",
    source: "CLIA 42 CFR 493.1253(b)(1)",
  },
];

// Overview shown at the top of the builder: what an IQCP is, its scope, and
// the three steps. Kept faithful to CMS Brochure #13 and S&C 13-54.
export const IQCP_OVERVIEW = {
  whatItIs:
    "An Individualized Quality Control Plan (IQCP) is a voluntary, risk-based QC option under CLIA. It lets a laboratory customize its quality control for a specific test system based on a documented risk assessment, and may use less external QC than the CLIA default, but never less than the manufacturer's instructions.",
  scope:
    "IQCP applies only to nonwaived (moderate and high complexity) testing. It is not available for waived tests, and the pathology disciplines that do not use traditional QC (histopathology, oral pathology, cytology) are outside its scope.",
  steps: [
    {
      n: 1,
      title: "Risk Assessment",
      summary:
        "Identify and evaluate the potential sources of error across the five required components (Specimen, Test System, Reagent, Environment, Testing Personnel) and the three phases of testing (pre-analytic, analytic, post-analytic).",
    },
    {
      n: 2,
      title: "Quality Control Plan",
      summary:
        "Based on the risks identified, define the type, number, and frequency of QC and the criteria for acceptable results. The laboratory director reviews, signs, and dates it.",
    },
    {
      n: 3,
      title: "Quality Assessment",
      summary:
        "Put ongoing monitoring in place to confirm the QCP is working and to detect and correct new sources of error over time. Without QA, the IQCP is not complete.",
    },
  ],
};

// Single assembled payload the question-bank endpoint returns.
export const IQCP_QUESTION_BANK = {
  version: "cms-workbook-2024",
  overview: IQCP_OVERVIEW,
  prescreen: { questions: IQCP_PRESCREEN, gate: IQCP_PRESCREEN_GATE },
  components: IQCP_COMPONENTS,
  phases: IQCP_PHASES,
  qcp: { questions: IQCP_QCP_QUESTIONS, rule: IQCP_QCP_RULE },
  qa: { activities: IQCP_QA_ACTIVITIES },
  glossary: IQCP_GLOSSARY,
};
