// VeritaScan™ — 168-item compliance checklist
// Domains: 10 compliance domains covering CLIA, TJC, CAP
// Each item: id, domain, question, TJC standard, CAP requirement, CFR citation

export type ScanStatus = "Compliant" | "Needs Attention" | "Immediate Action" | "N/A" | "Not Assessed";

export interface ScanItem {
  id: number;
  domain: ScanDomain;
  question: string;
  tjc: string;
  cap: string;
  cfr: string;
}

export type ScanDomain =
  | "Quality Systems & QC"
  | "Calibration & Verification"
  | "Proficiency Testing"
  | "Personnel & Competency"
  | "Test Management & Procedures"
  | "Equipment & Maintenance"
  | "Safety & Environment"
  | "Blood Bank & Transfusion"
  | "Point of Care Testing"
  | "Leadership & Governance";

export const DOMAINS: ScanDomain[] = [
  "Quality Systems & QC",
  "Calibration & Verification",
  "Proficiency Testing",
  "Personnel & Competency",
  "Test Management & Procedures",
  "Equipment & Maintenance",
  "Safety & Environment",
  "Blood Bank & Transfusion",
  "Point of Care Testing",
  "Leadership & Governance",
];

export const SCAN_ITEMS: ScanItem[] = [
  // ─── QUALITY SYSTEMS & QC (20 items) ─────────────────────────────────────
  { id: 1, domain: "Quality Systems & QC", question: "Written QC policy documented, approved by laboratory director, and current within 2 years?", tjc: "QSA.04.01.01 EP1", cap: "GEN.20316", cfr: "42 CFR §493.1256" },
  { id: 2, domain: "Quality Systems & QC", question: "QC performed at required frequency for all analytes and documented in the LIS or QC records?", tjc: "QSA.04.01.01 EP2", cap: "GEN.30200", cfr: "42 CFR §493.1256(d)" },
  { id: 3, domain: "Quality Systems & QC", question: "Levey-Jennings charts (or equivalent) maintained and reviewed by qualified personnel?", tjc: "QSA.04.01.01 EP3", cap: "GEN.30250", cfr: "42 CFR §493.1256(e)" },
  { id: 4, domain: "Quality Systems & QC", question: "Corrective action documented whenever QC results fall outside acceptable ranges?", tjc: "QSA.04.01.01 EP4", cap: "GEN.30300", cfr: "42 CFR §493.1256(g)" },
  { id: 5, domain: "Quality Systems & QC", question: "QC acceptability ranges established for each analyte before patient testing resumes?", tjc: "QSA.04.01.01 EP5", cap: "GEN.30100", cfr: "42 CFR §493.1256(d)(2)" },
  { id: 6, domain: "Quality Systems & QC", question: "Medical director or designee reviews QC records at defined intervals and signs off?", tjc: "QSA.04.01.01 EP6", cap: "GEN.30400", cfr: "42 CFR §493.1291" },
  { id: 7, domain: "Quality Systems & QC", question: "New QC lot numbers validated before being placed in service?", tjc: "QSA.04.01.01 EP7", cap: "GEN.30500", cfr: "42 CFR §493.1256(d)(3)" },
  { id: 8, domain: "Quality Systems & QC", question: "Westgard or equivalent multi-rule system applied and documented for quantitative analytes?", tjc: "QSA.04.01.01 EP8", cap: "GEN.30600", cfr: "42 CFR §493.1256(d)" },
  { id: 9, domain: "Quality Systems & QC", question: "QC failures result in patient result review and corrective action documentation before reporting?", tjc: "QSA.04.03.01 EP1", cap: "GEN.30700", cfr: "42 CFR §493.1256(g)(1)" },
  { id: 10, domain: "Quality Systems & QC", question: "End-of-month QC review performed and documented by department supervisor or director?", tjc: "QSA.04.03.01 EP2", cap: "GEN.30800", cfr: "42 CFR §493.1291" },
  { id: 11, domain: "Quality Systems & QC", question: "Performance improvement (PI) program in place with documented objectives and outcomes?", tjc: "QSA.06.01.01 EP1", cap: "GEN.20350", cfr: "42 CFR §493.1282" },
  { id: 12, domain: "Quality Systems & QC", question: "Critical values policy documented with defined analyte list, limits, and communication requirements?", tjc: "NPSG.02.03.01 EP1", cap: "COM.40000", cfr: "42 CFR §493.1291(h)" },
  { id: 13, domain: "Quality Systems & QC", question: "Critical value communication documented with read-back, time, and recipient identity for each occurrence?", tjc: "NPSG.02.03.01 EP2", cap: "COM.40100", cfr: "42 CFR §493.1291(h)" },
  { id: 14, domain: "Quality Systems & QC", question: "Delta check policy in place and applied to applicable analytes?", tjc: "QSA.04.03.01 EP3", cap: "COM.30500", cfr: "42 CFR §493.1291(d)" },
  { id: 15, domain: "Quality Systems & QC", question: "Reference ranges established, verified, or approved by medical director for all reported analytes?", tjc: "QSA.04.03.01 EP4", cap: "COM.30000", cfr: "42 CFR §493.1291(c)" },
  { id: 16, domain: "Quality Systems & QC", question: "Specimen rejection criteria documented and staff trained on application?", tjc: "QSA.02.01.01 EP3", cap: "PRE.04800", cfr: "42 CFR §493.1241(b)" },
  { id: 17, domain: "Quality Systems & QC", question: "Amended report policy in place with documentation of amendments and notification to ordering provider?", tjc: "QSA.04.03.01 EP5", cap: "COM.40620", cfr: "42 CFR §493.1291(k)" },
  { id: 18, domain: "Quality Systems & QC", question: "Laboratory quality assessment plan reviewed and updated at least annually?", tjc: "QSA.06.01.01 EP2", cap: "GEN.20400", cfr: "42 CFR §493.1282" },
  { id: 19, domain: "Quality Systems & QC", question: "Turnaround time (TAT) monitored with defined goals and documented corrective action for failures?", tjc: "QSA.02.01.01 EP4", cap: "COM.01800", cfr: "42 CFR §493.1291" },
  { id: 20, domain: "Quality Systems & QC", question: "Proficiency testing failures trigger root cause analysis and corrective action documentation?", tjc: "QSA.04.09.01 EP3", cap: "GEN.19400", cfr: "42 CFR §493.801(b)" },

  // ─── CALIBRATION & VERIFICATION (18 items) ────────────────────────────────
  { id: 21, domain: "Calibration & Verification", question: "Calibration verification performed at least every 6 months for all nonwaived tests requiring verification?", tjc: "QSA.04.01.01 EP9", cap: "GEN.40500", cfr: "42 CFR §493.1255" },
  { id: 22, domain: "Calibration & Verification", question: "Calibration verification records include assigned values, observed values, % recovery, and pass/fail determination?", tjc: "QSA.04.01.01 EP10", cap: "GEN.40600", cfr: "42 CFR §493.1255(b)" },
  { id: 23, domain: "Calibration & Verification", question: "Calibration verification uses a minimum of 3 levels spanning the reportable range (low, mid, high)?", tjc: "QSA.04.01.01 EP11", cap: "GEN.40700", cfr: "42 CFR §493.1255(a)(2)" },
  { id: 24, domain: "Calibration & Verification", question: "Acceptability criteria for calibration verification defined and documented (CLIA TEa or manufacturer-stated allowable error)?", tjc: "QSA.04.01.01 EP12", cap: "GEN.40800", cfr: "42 CFR §493.1255(b)(3)" },
  { id: 25, domain: "Calibration & Verification", question: "Failed calibration verification triggers corrective action and patient result review before reporting resumes?", tjc: "QSA.04.01.01 EP13", cap: "GEN.40900", cfr: "42 CFR §493.1255(b)(5)" },
  { id: 26, domain: "Calibration & Verification", question: "Method comparison (correlation) performed before any new method or instrument placed into service?", tjc: "QSA.04.05.01 EP1", cap: "GEN.41000", cfr: "42 CFR §493.1213" },
  { id: 27, domain: "Calibration & Verification", question: "Method comparison includes minimum 20 patient samples spanning the reportable range?", tjc: "QSA.04.05.01 EP2", cap: "GEN.41100", cfr: "42 CFR §493.1213(b)(4)" },
  { id: 28, domain: "Calibration & Verification", question: "Method comparison acceptability criteria defined and applied (Pearson r, slope, bias vs. TEa)?", tjc: "QSA.04.05.01 EP3", cap: "GEN.41200", cfr: "42 CFR §493.1213(b)(5)" },
  { id: 29, domain: "Calibration & Verification", question: "Correlation studies performed when multiple instruments perform the same test and documented on file?", tjc: "QSA.04.05.01 EP4", cap: "GEN.41300", cfr: "42 CFR §493.1213" },
  { id: 30, domain: "Calibration & Verification", question: "Precision verification (EP15 or equivalent) performed before any new method placed into service?", tjc: "QSA.04.05.01 EP5", cap: "GEN.41400", cfr: "42 CFR §493.1213(b)(2)" },
  { id: 31, domain: "Calibration & Verification", question: "Reportable range verified and documented for each test system?", tjc: "QSA.04.05.01 EP6", cap: "GEN.41500", cfr: "42 CFR §493.1213(b)(1)" },
  { id: 32, domain: "Calibration & Verification", question: "Accuracy verification (bias study) performed and documented for each new test method?", tjc: "QSA.04.05.01 EP7", cap: "GEN.41600", cfr: "42 CFR §493.1213(b)(3)" },
  { id: 33, domain: "Calibration & Verification", question: "Waived tests excluded from calibration verification requirement (not performing unnecessary studies)?", tjc: "N/A", cap: "GEN.41700", cfr: "42 CFR §493.15" },
  { id: 34, domain: "Calibration & Verification", question: "Calibration verification records retained for minimum 2 years (10 years for immunohematology)?", tjc: "IM.02.01.01 EP1", cap: "GEN.41800", cfr: "42 CFR §493.1105(a)(8)" },
  { id: 35, domain: "Calibration & Verification", question: "Calibration verification sign-off date (not data collection date) used to calculate next due date?", tjc: "QSA.04.01.01 EP14", cap: "GEN.41900", cfr: "42 CFR §493.1255" },
  { id: 36, domain: "Calibration & Verification", question: "Instruments with factory-locked calibration documented as exempt from calibration verification?", tjc: "N/A", cap: "GEN.42000", cfr: "42 CFR §493.1255" },
  { id: 37, domain: "Calibration & Verification", question: "Materials used for calibration verification have documented true values (calibrators, PT samples, or QC material)?", tjc: "QSA.04.01.01 EP15", cap: "GEN.42100", cfr: "42 CFR §493.1255(a)(1)" },
  { id: 38, domain: "Calibration & Verification", question: "Calibration verification schedule maintained with next-due dates for all applicable instruments?", tjc: "QSA.04.01.01 EP16", cap: "GEN.42200", cfr: "42 CFR §493.1255" },

  // ─── PROFICIENCY TESTING (15 items) ───────────────────────────────────────
  { id: 39, domain: "Proficiency Testing", question: "Laboratory enrolled in approved PT program for all regulated analytes?", tjc: "QSA.04.09.01 EP1", cap: "GEN.19000", cfr: "42 CFR §493.801" },
  { id: 40, domain: "Proficiency Testing", question: "PT samples handled identically to patient samples (same personnel, reagents, instrumentation)?", tjc: "QSA.04.09.01 EP2", cap: "GEN.19100", cfr: "42 CFR §493.801(b)(1)" },
  { id: 41, domain: "Proficiency Testing", question: "PT results submitted on time for each testing event?", tjc: "QSA.04.09.01 EP4", cap: "GEN.19150", cfr: "42 CFR §493.803" },
  { id: 42, domain: "Proficiency Testing", question: "PT results reviewed by laboratory director or designee and documented?", tjc: "QSA.04.09.01 EP5", cap: "GEN.19200", cfr: "42 CFR §493.801(b)(3)" },
  { id: 43, domain: "Proficiency Testing", question: "Unsuccessful PT performance triggers root cause analysis within 30 days?", tjc: "QSA.04.09.01 EP6", cap: "GEN.19300", cfr: "42 CFR §493.801(b)(4)" },
  { id: 44, domain: "Proficiency Testing", question: "PT records retained for minimum 2 years?", tjc: "IM.02.01.01 EP1", cap: "GEN.19350", cfr: "42 CFR §493.1105(a)(8)" },
  { id: 45, domain: "Proficiency Testing", question: "No communication with other laboratories about PT samples before deadline?", tjc: "QSA.04.09.01 EP7", cap: "GEN.19400", cfr: "42 CFR §493.801(b)(1)" },
  { id: 46, domain: "Proficiency Testing", question: "Alternative performance assessment (APA) in place for analytes without approved PT program?", tjc: "QSA.04.09.01 EP8", cap: "GEN.19500", cfr: "42 CFR §493.833" },
  { id: 47, domain: "Proficiency Testing", question: "PT enrollment certificates current and on file for all PT programs?", tjc: "QSA.04.09.01 EP9", cap: "GEN.19600", cfr: "42 CFR §493.801" },
  { id: 48, domain: "Proficiency Testing", question: "Corrective action documented when PT score falls below acceptable threshold (80%)?", tjc: "QSA.04.09.01 EP10", cap: "GEN.19700", cfr: "42 CFR §493.801(b)(4)" },
  { id: 49, domain: "Proficiency Testing", question: "PT results compared between all instruments performing the same test?", tjc: "QSA.04.09.01 EP11", cap: "GEN.19800", cfr: "42 CFR §493.801(b)" },
  { id: 50, domain: "Proficiency Testing", question: "Personnel performing PT testing are the same staff who routinely perform patient testing?", tjc: "QSA.04.09.01 EP12", cap: "GEN.19900", cfr: "42 CFR §493.801(b)(1)" },
  { id: 51, domain: "Proficiency Testing", question: "Trend analysis performed on PT scores over time to identify declining performance?", tjc: "QSA.04.09.01 EP13", cap: "GEN.20000", cfr: "42 CFR §493.801" },
  { id: 52, domain: "Proficiency Testing", question: "PT samples tested in the same manner and time frame as patient samples (not held)?", tjc: "QSA.04.09.01 EP14", cap: "GEN.20100", cfr: "42 CFR §493.801(b)(1)" },
  { id: 53, domain: "Proficiency Testing", question: "Laboratory has documented process for handling and storing PT materials prior to testing?", tjc: "QSA.04.09.01 EP15", cap: "GEN.20200", cfr: "42 CFR §493.801" },

  // ─── PERSONNEL & COMPETENCY (20 items) ────────────────────────────────────
  { id: 54, domain: "Personnel & Competency", question: "Personnel files maintained for all laboratory staff with current licensure/certification on file?", tjc: "HR.01.02.07 EP1", cap: "GEN.54000", cfr: "42 CFR §493.1403" },
  { id: 55, domain: "Personnel & Competency", question: "Laboratory director meets CLIA qualification requirements for the complexity level performed?", tjc: "TLC.01.01.01 EP1", cap: "DIR.10000", cfr: "42 CFR §493.1441" },
  { id: 56, domain: "Personnel & Competency", question: "Technical supervisor qualifications meet CLIA requirements for high-complexity testing (if applicable)?", tjc: "TLC.02.01.01 EP1", cap: "DIR.20000", cfr: "42 CFR §493.1449" },
  { id: 57, domain: "Personnel & Competency", question: "Testing personnel qualifications documented and meet CLIA requirements for complexity level performed?", tjc: "HR.01.02.07 EP2", cap: "GEN.54100", cfr: "42 CFR §493.1489" },
  { id: 58, domain: "Personnel & Competency", question: "Initial competency assessment completed for all new testing personnel before unsupervised patient testing?", tjc: "HR.01.06.01 EP1", cap: "GEN.55500", cfr: "42 CFR §493.1235(b)" },
  { id: 59, domain: "Personnel & Competency", question: "Annual competency assessment completed for all testing personnel?", tjc: "HR.01.06.01 EP2", cap: "GEN.55600", cfr: "42 CFR §493.1235(b)" },
  { id: 60, domain: "Personnel & Competency", question: "Competency assessment includes all 6 required CLIA methods (direct observation, monitoring records, PT, problem-solving, maintenance, test reporting)?", tjc: "HR.01.06.01 EP3", cap: "GEN.55700", cfr: "42 CFR §493.1235(b)(1-6)" },
  { id: 61, domain: "Personnel & Competency", question: "Competency assessment records signed by laboratory director or technical supervisor?", tjc: "HR.01.06.01 EP4", cap: "GEN.55800", cfr: "42 CFR §493.1235(b)" },
  { id: 62, domain: "Personnel & Competency", question: "Remedial training documented and re-assessment performed when competency deficiencies identified?", tjc: "HR.01.06.01 EP5", cap: "GEN.55900", cfr: "42 CFR §493.1235(c)" },
  { id: 63, domain: "Personnel & Competency", question: "Personnel performing testing on infrequently performed tests have documented concurrent QC requirement?", tjc: "QSA.04.03.01 EP3", cap: "GEN.56000", cfr: "42 CFR §493.1235(b)" },
  { id: 64, domain: "Personnel & Competency", question: "Laboratory director attestation on file confirming review of staff qualifications?", tjc: "TLC.01.01.01 EP2", cap: "DIR.30000", cfr: "42 CFR §493.1441" },
  { id: 65, domain: "Personnel & Competency", question: "Job descriptions current and signed for all laboratory positions?", tjc: "HR.01.02.01 EP1", cap: "GEN.54200", cfr: "42 CFR §493.1403" },
  { id: 66, domain: "Personnel & Competency", question: "Training records maintained for all laboratory safety and regulatory training?", tjc: "HR.01.04.01 EP1", cap: "GEN.54300", cfr: "42 CFR §493.1235" },
  { id: 67, domain: "Personnel & Competency", question: "Delegation of authority documented when director is unavailable?", tjc: "TLC.01.01.01 EP3", cap: "DIR.40000", cfr: "42 CFR §493.1441" },
  { id: 68, domain: "Personnel & Competency", question: "Personnel demonstrate knowledge of QC rules applicable to their assigned instruments?", tjc: "HR.01.06.01 EP6", cap: "GEN.56100", cfr: "42 CFR §493.1235(b)(1)" },
  { id: 69, domain: "Personnel & Competency", question: "Staff training documented for any new test, instrument, or procedure before patient testing?", tjc: "HR.01.04.01 EP2", cap: "GEN.54400", cfr: "42 CFR §493.1235(a)" },
  { id: 70, domain: "Personnel & Competency", question: "Current staff roster maintained with testing privileges documented?", tjc: "TLC.01.01.01 EP4", cap: "GEN.54500", cfr: "42 CFR §493.1403" },
  { id: 71, domain: "Personnel & Competency", question: "State licensure requirements for laboratory personnel verified and current (if applicable)?", tjc: "HR.01.02.07 EP3", cap: "GEN.54600", cfr: "42 CFR §493.1403" },
  { id: 72, domain: "Personnel & Competency", question: "Continuing education records maintained for applicable personnel?", tjc: "HR.01.05.03 EP1", cap: "GEN.54700", cfr: "42 CFR §493.1235" },
  { id: 73, domain: "Personnel & Competency", question: "Medical laboratory director physically present or accessible by phone/telecom during all operating hours?", tjc: "TLC.01.01.01 EP5", cap: "DIR.50000", cfr: "42 CFR §493.1441(c)" },

  // ─── TEST MANAGEMENT & PROCEDURES (18 items) ──────────────────────────────
  { id: 74, domain: "Test Management & Procedures", question: "Written SOPs exist for every test performed, including pre-analytic, analytic, and post-analytic steps?", tjc: "QSA.01.01.01 EP1", cap: "GEN.56700", cfr: "42 CFR §493.1251" },
  { id: 75, domain: "Test Management & Procedures", question: "SOPs reviewed, approved, and signed by laboratory director at least every 2 years?", tjc: "QSA.01.01.01 EP2", cap: "GEN.56800", cfr: "42 CFR §493.1251(b)(9)" },
  { id: 76, domain: "Test Management & Procedures", question: "SOPs accessible to all testing personnel at point of use?", tjc: "QSA.01.01.01 EP3", cap: "GEN.56900", cfr: "42 CFR §493.1251(c)" },
  { id: 77, domain: "Test Management & Procedures", question: "Discontinued SOPs retained for minimum 2 years after the date of discontinuance?", tjc: "IM.02.01.01 EP2", cap: "GEN.57000", cfr: "42 CFR §493.1105(a)(9)" },
  { id: 78, domain: "Test Management & Procedures", question: "CLIA test complexity certificates match the complexity level of all tests being performed?", tjc: "LD.04.01.01 EP1", cap: "GEN.09800", cfr: "42 CFR §493.35" },
  { id: 79, domain: "Test Management & Procedures", question: "Test requisition system captures required elements (patient ID, ordering provider, test ordered, date/time)?", tjc: "QSA.02.01.01 EP1", cap: "PRE.04200", cfr: "42 CFR §493.1241(a)" },
  { id: 80, domain: "Test Management & Procedures", question: "Laboratory reports include required elements (patient ID, test name, result, units, reference range, interpretation if applicable)?", tjc: "QSA.04.03.01 EP6", cap: "COM.01300", cfr: "42 CFR §493.1291(c)" },
  { id: 81, domain: "Test Management & Procedures", question: "Patient result records retained for minimum 2 years (5 years for cytology, 10 years for immunohematology)?", tjc: "IM.02.01.01 EP3", cap: "GEN.09000", cfr: "42 CFR §493.1105" },
  { id: 82, domain: "Test Management & Procedures", question: "Specimen labeling policy documented with minimum required identifiers?", tjc: "NPSG.01.01.01 EP1", cap: "PRE.04400", cfr: "42 CFR §493.1241(b)" },
  { id: 83, domain: "Test Management & Procedures", question: "Specimen collection procedures documented with required pre-analytic instructions for each test type?", tjc: "QSA.02.01.01 EP2", cap: "PRE.04600", cfr: "42 CFR §493.1241" },
  { id: 84, domain: "Test Management & Procedures", question: "Panic value notification documented with required read-back confirmation for each occurrence?", tjc: "NPSG.02.03.01 EP3", cap: "COM.40200", cfr: "42 CFR §493.1291(h)" },
  { id: 85, domain: "Test Management & Procedures", question: "LDTs (laboratory developed tests) validated per CLIA requirements with full validation documentation on file?", tjc: "QSA.04.05.01 EP8", cap: "GEN.42300", cfr: "42 CFR §493.1213" },
  { id: 86, domain: "Test Management & Procedures", question: "Package inserts current and accessible for all kit-based tests?", tjc: "QSA.01.01.01 EP4", cap: "GEN.57100", cfr: "42 CFR §493.1251" },
  { id: 87, domain: "Test Management & Procedures", question: "Reflex testing criteria and authorization documented in policy?", tjc: "QSA.04.03.01 EP7", cap: "COM.30600", cfr: "42 CFR §493.1291" },
  { id: 88, domain: "Test Management & Procedures", question: "STAT vs. routine TAT goals defined for all test types and monitored?", tjc: "QSA.02.01.01 EP5", cap: "COM.01900", cfr: "42 CFR §493.1291" },
  { id: 89, domain: "Test Management & Procedures", question: "Reportable range (AMR) documented and verified for all quantitative tests?", tjc: "QSA.04.05.01 EP9", cap: "GEN.41500", cfr: "42 CFR §493.1213(b)(1)" },
  { id: 90, domain: "Test Management & Procedures", question: "Biotin interference policy in place for immunoassay testing with patient notification procedure?", tjc: "QSA.04.03.01 EP8", cap: "GEN.57200", cfr: "42 CFR §493.1291" },
  { id: 91, domain: "Test Management & Procedures", question: "Interface validation documented between LIS and instruments to confirm result transmission accuracy?", tjc: "QSA.04.03.01 EP9", cap: "GEN.57300", cfr: "42 CFR §493.1291" },

  // ─── EQUIPMENT & MAINTENANCE (15 items) ───────────────────────────────────
  { id: 92, domain: "Equipment & Maintenance", question: "Preventive maintenance performed per manufacturer's schedule for all instruments?", tjc: "EC.02.04.01 EP1", cap: "GEN.58000", cfr: "42 CFR §493.1254" },
  { id: 93, domain: "Equipment & Maintenance", question: "Maintenance records document completion date, performed by, and results for all scheduled maintenance?", tjc: "EC.02.04.01 EP2", cap: "GEN.58100", cfr: "42 CFR §493.1254(a)" },
  { id: 94, domain: "Equipment & Maintenance", question: "Temperature monitoring logs current for all temperature-sensitive storage (refrigerators, freezers, incubators)?", tjc: "EC.02.04.01 EP3", cap: "GEN.58200", cfr: "42 CFR §493.1254" },
  { id: 95, domain: "Equipment & Maintenance", question: "Temperature excursion corrective action documented with patient impact assessment?", tjc: "EC.02.04.01 EP4", cap: "GEN.58300", cfr: "42 CFR §493.1254" },
  { id: 96, domain: "Equipment & Maintenance", question: "Instrument function checks performed at frequency specified in manufacturer documentation?", tjc: "EC.02.04.01 EP5", cap: "GEN.58400", cfr: "42 CFR §493.1254(b)" },
  { id: 97, domain: "Equipment & Maintenance", question: "Equipment repair records maintained with documentation of validation testing after repair?", tjc: "EC.02.04.01 EP6", cap: "GEN.58500", cfr: "42 CFR §493.1254" },
  { id: 98, domain: "Equipment & Maintenance", question: "Water quality monitoring performed and documented for applicable instruments (deionized, distilled)?", tjc: "EC.02.04.01 EP7", cap: "GEN.58600", cfr: "42 CFR §493.1254" },
  { id: 99, domain: "Equipment & Maintenance", question: "Reagent and supply lot numbers documented with acceptance testing records before use?", tjc: "QSA.04.01.01 EP17", cap: "GEN.58700", cfr: "42 CFR §493.1252" },
  { id: 100, domain: "Equipment & Maintenance", question: "Reagent storage conditions monitored and documented per manufacturer requirements?", tjc: "QSA.04.01.01 EP18", cap: "GEN.58800", cfr: "42 CFR §493.1252" },
  { id: 101, domain: "Equipment & Maintenance", question: "Out-of-service instruments documented with patient result review and corrective action?", tjc: "EC.02.04.01 EP8", cap: "GEN.58900", cfr: "42 CFR §493.1254" },
  { id: 102, domain: "Equipment & Maintenance", question: "Pipette and volumetric equipment calibration documented at required intervals?", tjc: "EC.02.04.01 EP9", cap: "GEN.59000", cfr: "42 CFR §493.1254" },
  { id: 103, domain: "Equipment & Maintenance", question: "Centrifuge speed and timer verified at required intervals?", tjc: "EC.02.04.01 EP10", cap: "GEN.59100", cfr: "42 CFR §493.1254" },
  { id: 104, domain: "Equipment & Maintenance", question: "Reagent expiration dates checked and documented before use?", tjc: "QSA.04.01.01 EP19", cap: "GEN.59200", cfr: "42 CFR §493.1252" },
  { id: 105, domain: "Equipment & Maintenance", question: "New reagent lot acceptance testing performed before patient use?", tjc: "QSA.04.01.01 EP20", cap: "GEN.59300", cfr: "42 CFR §493.1252(b)" },
  { id: 106, domain: "Equipment & Maintenance", question: "Instrument downtime log maintained with escalation process for extended outages?", tjc: "EC.02.04.01 EP11", cap: "GEN.59400", cfr: "42 CFR §493.1254" },

  // ─── SAFETY & ENVIRONMENT (15 items) ──────────────────────────────────────
  { id: 107, domain: "Safety & Environment", question: "Written exposure control plan for bloodborne pathogens current and accessible?", tjc: "EC.02.01.01 EP1", cap: "GEN.60000", cfr: "29 CFR §1910.1030" },
  { id: 108, domain: "Safety & Environment", question: "Annual bloodborne pathogen training documented for all laboratory personnel?", tjc: "EC.02.01.01 EP2", cap: "GEN.60100", cfr: "29 CFR §1910.1030(g)(2)" },
  { id: 109, domain: "Safety & Environment", question: "Chemical hygiene plan (CHP) current and reviewed annually?", tjc: "EC.02.02.01 EP1", cap: "GEN.60200", cfr: "29 CFR §1910.1450" },
  { id: 110, domain: "Safety & Environment", question: "Safety data sheets (SDS) accessible for all hazardous chemicals used in the laboratory?", tjc: "EC.02.02.01 EP2", cap: "GEN.60300", cfr: "29 CFR §1910.1200" },
  { id: 111, domain: "Safety & Environment", question: "Personal protective equipment (PPE) available, used appropriately, and documented in training?", tjc: "EC.02.01.01 EP3", cap: "GEN.60400", cfr: "29 CFR §1910.132" },
  { id: 112, domain: "Safety & Environment", question: "Hepatitis B vaccination offered to all personnel with occupational exposure risk?", tjc: "EC.02.01.01 EP4", cap: "GEN.60500", cfr: "29 CFR §1910.1030(f)" },
  { id: 113, domain: "Safety & Environment", question: "Fire safety equipment (extinguishers, alarms) functional and inspected per facility policy?", tjc: "EC.02.03.01 EP1", cap: "GEN.60600", cfr: "29 CFR §1910.157" },
  { id: 114, domain: "Safety & Environment", question: "Biological waste disposal procedures compliant with state and federal regulations?", tjc: "EC.02.01.01 EP5", cap: "GEN.60700", cfr: "29 CFR §1910.1030(d)(4)" },
  { id: 115, domain: "Safety & Environment", question: "Emergency procedures documented for spill containment, exposure incidents, and evacuation?", tjc: "EC.04.01.01 EP1", cap: "GEN.60800", cfr: "29 CFR §1910.38" },
  { id: 116, domain: "Safety & Environment", question: "Exposure incident reports filed and post-exposure follow-up documented?", tjc: "EC.02.01.01 EP6", cap: "GEN.60900", cfr: "29 CFR §1910.1030(f)(3)" },
  { id: 117, domain: "Safety & Environment", question: "Laboratory ventilation adequate for chemical fume generation (fume hoods functional)?", tjc: "EC.02.06.01 EP1", cap: "GEN.61000", cfr: "29 CFR §1910.1450" },
  { id: 118, domain: "Safety & Environment", question: "Eyewash stations available, functional, and tested weekly per ANSI standards?", tjc: "EC.02.02.01 EP3", cap: "GEN.61100", cfr: "29 CFR §1910.151" },
  { id: 119, domain: "Safety & Environment", question: "Chemical storage segregated appropriately (flammables, acids, bases, oxidizers)?", tjc: "EC.02.02.01 EP4", cap: "GEN.61200", cfr: "29 CFR §1910.1200" },
  { id: 120, domain: "Safety & Environment", question: "Radiation safety program in place if radioactive materials used (survey meter, dosimetry, disposal)?", tjc: "EC.02.02.03 EP1", cap: "GEN.61300", cfr: "10 CFR §35" },
  { id: 121, domain: "Safety & Environment", question: "Annual safety inspection of laboratory areas documented with findings and corrective actions?", tjc: "EC.02.01.01 EP7", cap: "GEN.61400", cfr: "29 CFR §1910.22" },

  // ─── BLOOD BANK & TRANSFUSION (20 items) ──────────────────────────────────
  { id: 122, domain: "Blood Bank & Transfusion", question: "ABO and Rh typing performed on all blood products before transfusion?", tjc: "TRM.01.01.01 EP1", cap: "TRM.30000", cfr: "42 CFR §493.959" },
  { id: 123, domain: "Blood Bank & Transfusion", question: "Compatibility testing (crossmatch or electronic crossmatch) performed per facility protocol?", tjc: "TRM.01.01.01 EP2", cap: "TRM.30100", cfr: "42 CFR §493.959" },
  { id: 124, domain: "Blood Bank & Transfusion", question: "Antibody screen performed on all patients requiring blood transfusion?", tjc: "TRM.01.01.01 EP3", cap: "TRM.30200", cfr: "42 CFR §493.959" },
  { id: 125, domain: "Blood Bank & Transfusion", question: "Blood product issuing procedure includes two-person verification or equivalent safety check?", tjc: "TRM.01.01.01 EP4", cap: "TRM.30300", cfr: "42 CFR §493.959" },
  { id: 126, domain: "Blood Bank & Transfusion", question: "Transfusion reaction investigation policy documented with required workup steps?", tjc: "TRM.02.01.01 EP1", cap: "TRM.40000", cfr: "42 CFR §493.959" },
  { id: 127, domain: "Blood Bank & Transfusion", question: "Transfusion fatality reporting to FDA within required timeframes (immediate for suspected transfusion-related fatality)?", tjc: "TRM.02.01.01 EP2", cap: "TRM.40100", cfr: "21 CFR §606.170(b)" },
  { id: 128, domain: "Blood Bank & Transfusion", question: "Blood product storage temperatures monitored continuously with alarms documented?", tjc: "TRM.03.01.01 EP1", cap: "TRM.50000", cfr: "21 CFR §606.122(g)" },
  { id: 129, domain: "Blood Bank & Transfusion", question: "Blood product inventory management system in place with lot traceability?", tjc: "TRM.03.01.01 EP2", cap: "TRM.50100", cfr: "21 CFR §606.160" },
  { id: 130, domain: "Blood Bank & Transfusion", question: "Massive transfusion protocol (MTP) or equivalent in place and accessible?", tjc: "TRM.01.01.01 EP5", cap: "TRM.30400", cfr: "N/A" },
  { id: 131, domain: "Blood Bank & Transfusion", question: "Blood bank records retained per AABB/FDA requirements (10 years for compatibility testing)?", tjc: "IM.02.01.01 EP4", cap: "TRM.60000", cfr: "21 CFR §606.160(d)" },
  { id: 132, domain: "Blood Bank & Transfusion", question: "Emergency release protocol documented for uncrossmatched blood?", tjc: "TRM.01.01.01 EP6", cap: "TRM.30500", cfr: "42 CFR §493.959" },
  { id: 133, domain: "Blood Bank & Transfusion", question: "Blood product visual inspection performed before issue and documented?", tjc: "TRM.03.01.01 EP3", cap: "TRM.50200", cfr: "21 CFR §606.122" },
  { id: 134, domain: "Blood Bank & Transfusion", question: "Irradiation and leukoreduction policies documented with appropriate indications?", tjc: "TRM.01.01.01 EP7", cap: "TRM.30600", cfr: "N/A" },
  { id: 135, domain: "Blood Bank & Transfusion", question: "Blood utilization review program in place with data reported to medical staff?", tjc: "TRM.02.01.01 EP3", cap: "TRM.40200", cfr: "N/A" },
  { id: 136, domain: "Blood Bank & Transfusion", question: "Consent for transfusion policy in place with documentation in the patient medical record?", tjc: "TRM.01.01.01 EP8", cap: "TRM.30700", cfr: "N/A" },
  { id: 137, domain: "Blood Bank & Transfusion", question: "ISBT 128 or equivalent product labeling standard applied for traceability?", tjc: "TRM.03.01.01 EP4", cap: "TRM.50300", cfr: "21 CFR §606.121" },
  { id: 138, domain: "Blood Bank & Transfusion", question: "Blood administration training documented for nursing staff including two-patient-identifier verification?", tjc: "TRM.01.01.01 EP9", cap: "TRM.30800", cfr: "N/A" },
  { id: 139, domain: "Blood Bank & Transfusion", question: "Special transfusion requirements (e.g., CMV negative, antigen negative) documented and verified before issue?", tjc: "TRM.01.01.01 EP10", cap: "TRM.30900", cfr: "42 CFR §493.959" },
  { id: 140, domain: "Blood Bank & Transfusion", question: "Donor records/deferrals accessible and integrated with blood product receipt from supplier?", tjc: "TRM.03.01.01 EP5", cap: "TRM.50400", cfr: "21 CFR §606.160" },
  { id: 141, domain: "Blood Bank & Transfusion", question: "Blood bank QC program includes daily reagent QC (anti-sera, reagent red cells, check cells)?", tjc: "QSA.04.01.01 EP21", cap: "TRM.70000", cfr: "42 CFR §493.959" },

  // ─── POINT OF CARE TESTING (17 items) ─────────────────────────────────────
  { id: 142, domain: "Point of Care Testing", question: "POCT coordinator designated with documented oversight responsibilities?", tjc: "QSA.01.01.01 EP5", cap: "POC.01000", cfr: "42 CFR §493.35" },
  { id: 143, domain: "Point of Care Testing", question: "All POCT operators trained and competency assessed before performing patient testing?", tjc: "HR.01.06.01 EP7", cap: "POC.02000", cfr: "42 CFR §493.1235" },
  { id: 144, domain: "Point of Care Testing", question: "Annual POCT operator competency assessments current for all staff performing POC tests?", tjc: "HR.01.06.01 EP8", cap: "POC.02100", cfr: "42 CFR §493.1235" },
  { id: 145, domain: "Point of Care Testing", question: "POCT QC performed at required frequency and records accessible?", tjc: "QSA.04.01.01 EP22", cap: "POC.03000", cfr: "42 CFR §493.1256" },
  { id: 146, domain: "Point of Care Testing", question: "Failed POCT QC results trigger corrective action and device lockout or documentation of clinical necessity to continue?", tjc: "QSA.04.01.01 EP23", cap: "POC.03100", cfr: "42 CFR §493.1256(g)" },
  { id: 147, domain: "Point of Care Testing", question: "POCT devices maintained per manufacturer requirements with logs accessible?", tjc: "EC.02.04.01 EP12", cap: "POC.04000", cfr: "42 CFR §493.1254" },
  { id: 148, domain: "Point of Care Testing", question: "POCT reagent lot numbers and expiration dates documented with results?", tjc: "QSA.04.01.01 EP24", cap: "POC.04100", cfr: "42 CFR §493.1252" },
  { id: 149, domain: "Point of Care Testing", question: "POCT results interface or are manually entered into the EMR with appropriate reference ranges?", tjc: "QSA.04.03.01 EP10", cap: "POC.05000", cfr: "42 CFR §493.1291" },
  { id: 150, domain: "Point of Care Testing", question: "POCT proficiency testing or APA enrolled and conducted for all regulated waived and non-waived POC analytes?", tjc: "QSA.04.09.01 EP16", cap: "POC.06000", cfr: "42 CFR §493.801" },
  { id: 151, domain: "Point of Care Testing", question: "POCT written policies and procedures accessible at point of use?", tjc: "QSA.01.01.01 EP6", cap: "POC.07000", cfr: "42 CFR §493.1251" },
  { id: 152, domain: "Point of Care Testing", question: "POCT glucose meter correlation studies performed between all devices used for patient testing?", tjc: "QSA.04.05.01 EP10", cap: "POC.08000", cfr: "42 CFR §493.1213" },
  { id: 153, domain: "Point of Care Testing", question: "POCT critical values policy consistent with core laboratory and nursing notification documented?", tjc: "NPSG.02.03.01 EP4", cap: "POC.09000", cfr: "42 CFR §493.1291(h)" },
  { id: 154, domain: "Point of Care Testing", question: "POCT device inventory current with CLIA certificate coverage verified for all devices?", tjc: "LD.04.01.01 EP2", cap: "POC.10000", cfr: "42 CFR §493.35" },
  { id: 155, domain: "Point of Care Testing", question: "POCT program oversight committee or equivalent meets at defined intervals and minutes documented?", tjc: "QSA.01.01.01 EP7", cap: "POC.11000", cfr: "42 CFR §493.1282" },
  { id: 156, domain: "Point of Care Testing", question: "POCT operator lockout enforced for operators with lapsed competency or QC acknowledgment?", tjc: "HR.01.06.01 EP9", cap: "POC.02200", cfr: "42 CFR §493.1235" },
  { id: 157, domain: "Point of Care Testing", question: "POCT blood glucose meters comply with FDA 2016 guidance for accuracy in intensive care patients (if applicable)?", tjc: "QSA.04.03.01 EP11", cap: "POC.12000", cfr: "42 CFR §493.1253" },
  { id: 158, domain: "Point of Care Testing", question: "POCT connectivity or middleware validated for accurate result transmission?", tjc: "QSA.04.03.01 EP12", cap: "POC.13000", cfr: "42 CFR §493.1291" },

  // ─── LEADERSHIP & GOVERNANCE (10 items) ───────────────────────────────────
  { id: 159, domain: "Leadership & Governance", question: "Laboratory director reviews and signs off on all required policies at defined intervals?", tjc: "LD.04.05.03 EP1", cap: "DIR.60000", cfr: "42 CFR §493.1441" },
  { id: 160, domain: "Leadership & Governance", question: "Laboratory reports to C-suite or hospital leadership with defined accountability structure?", tjc: "LD.04.01.01 EP3", cap: "DIR.70000", cfr: "42 CFR §493.1441" },
  { id: 161, domain: "Leadership & Governance", question: "External agency recommendations (TJC, CAP, CMS) acted upon and responses documented?", tjc: "LD.04.01.01 EP4", cap: "GEN.09500", cfr: "42 CFR §493.1775" },
  { id: 162, domain: "Leadership & Governance", question: "CLIA certificate current and posted in the laboratory?", tjc: "LD.04.01.01 EP5", cap: "GEN.09800", cfr: "42 CFR §493.35" },
  { id: 163, domain: "Leadership & Governance", question: "Accreditation body notification provided for all required reportable events (new testing, director change, ownership change)?", tjc: "LD.04.01.01 EP6", cap: "GEN.09900", cfr: "42 CFR §493.1773" },
  { id: 164, domain: "Leadership & Governance", question: "Laboratory strategic plan or quality goals established and reviewed annually?", tjc: "LD.04.02.07 EP1", cap: "DIR.80000", cfr: "42 CFR §493.1282" },
  { id: 165, domain: "Leadership & Governance", question: "Corrective action log maintained with documented resolution for all open items?", tjc: "LD.04.05.03 EP2", cap: "GEN.20450", cfr: "42 CFR §493.1282" },
  { id: 166, domain: "Leadership & Governance", question: "Laboratory participates in hospital patient safety program and medical staff committees as required?", tjc: "LD.04.01.01 EP7", cap: "DIR.90000", cfr: "N/A" },
  { id: 167, domain: "Leadership & Governance", question: "Disaster recovery and business continuity plan in place for laboratory operations?", tjc: "EM.02.02.01 EP1", cap: "GEN.61500", cfr: "N/A" },
  { id: 168, domain: "Leadership & Governance", question: "Annual laboratory self-assessment or mock inspection performed and findings documented?", tjc: "LD.04.05.03 EP3", cap: "GEN.20500", cfr: "42 CFR §493.1282" },
];

export const DOMAIN_COLORS: Record<ScanDomain, string> = {
  "Quality Systems & QC": "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800",
  "Calibration & Verification": "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-800",
  "Proficiency Testing": "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-800",
  "Personnel & Competency": "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-800",
  "Test Management & Procedures": "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-300 dark:border-cyan-800",
  "Equipment & Maintenance": "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-300 dark:border-yellow-800",
  "Safety & Environment": "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800",
  "Blood Bank & Transfusion": "bg-pink-50 text-pink-700 border-pink-200 dark:bg-pink-950/30 dark:text-pink-300 dark:border-pink-800",
  "Point of Care Testing": "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-800",
  "Leadership & Governance": "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800",
};

export const STATUS_COLORS: Record<ScanStatus, string> = {
  "Compliant": "bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/30 dark:text-emerald-300",
  "Needs Attention": "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-300",
  "Immediate Action": "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-300",
  "N/A": "bg-muted text-muted-foreground border-border",
  "Not Assessed": "bg-background text-muted-foreground border-border",
};
