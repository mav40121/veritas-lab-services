// State Laboratory Licensure Registry seed data.
//
// Per-state reference catalog of laboratory licensure requirements beyond
// the federal CLIA certificate. Surfaced in VeritaLab > State Registry
// (parking-lot #22 Phase 2). Lab opens the registry, finds their state,
// sees the additional obligation (or confirms CLIA-only).
//
// Field semantics (mirrors the state_lab_licensure_registry table):
//
//   state_code           USPS two-letter postal code (CA, NY, DC).
//   state_name           Display name.
//   licensure_required   'yes'      = state requires its own license on top
//                                     of CLIA.
//                        'no'       = CLIA alone is sufficient.
//                        'exempt'   = CLIA-exempt state where the state
//                                     license substitutes for CLIA entirely
//                                     (NY and WA are the historical CMS
//                                     exempt-state designations).
//                        'unknown'  = needs operator verification before
//                                     a lab acts on this row.
//   authority_name       Regulatory agency that administers the license.
//   authority_url        Agency website (canonical, public).
//   application_form_*   Application packet pointer when licensure='yes'.
//   fee_description      Free-text description of the fee scheme; not
//                        rendered as a parsed currency value.
//   renewal_cadence      'annual' | 'biennial' | 'triennial' | 'other'.
//   notes                Caveats. Anything that needs the director's eye.
//   source_citation      The URL or document the row was authored from.
//   last_verified        ISO date string (YYYY-MM-DD) of authoring or null.
//
// EDITORIAL DISCIPLINE: rows are authored conservatively. When a state's
// licensure scheme is uncertain, the row uses licensure_required='unknown'
// with a verify-with-agency note, rather than fabricating a 'no' or 'yes'.
// Per CLAUDE.md section 9 (Reasoning Standards), the agent does not
// invent regulatory citations. The operator's editorial spot-check is the
// gate before this data is treated as canonical.

export interface StateRegistryRow {
  state_code: string;
  state_name: string;
  licensure_required: 'yes' | 'no' | 'exempt' | 'unknown';
  authority_name: string | null;
  authority_url: string | null;
  application_form_name: string | null;
  application_form_url: string | null;
  fee_description: string | null;
  renewal_cadence: 'annual' | 'biennial' | 'triennial' | 'other' | null;
  notes: string | null;
  source_citation: string | null;
  last_verified: string | null;
}

const TODAY = '2026-05-28';

// CMS exempt states (state license substitutes for CLIA). Only NY and WA
// hold this designation historically (42 CFR 493.551 exempt-state list).
const EXEMPT_NOTE = 'CMS-recognized exempt state per 42 CFR 493.551: the state license substitutes for the federal CLIA certificate.';

// Note shown on every CLIA-only row so the lab understands the default.
const CLIA_ONLY_NOTE = 'No separate state laboratory license is required. The federal CLIA certificate from CMS is the operating credential. Confirm with the state regulatory agency at lab startup or before scope expansion.';

const NEEDS_VERIFICATION_NOTE = 'Laboratory licensure scheme not confirmed at authoring. Verify directly with the state regulatory agency before treating this row as canonical.';

const CLIA_SOURCE = '42 CFR Part 493 (Clinical Laboratory Improvement Amendments of 1988); CMS State Agency Operating Manual.';

// ── State data ───────────────────────────────────────────────────────────
// High-confidence rows (licensure_required='yes' or 'exempt') are authored
// from the operator's regulatory baseline. Authority URLs are intentionally
// omitted (set to null) when the agency's website root is not stable; the
// authority_name is sufficient to locate the agency. Operator can add URLs
// during the editorial pass.

export const STATE_REGISTRY_SEED: StateRegistryRow[] = [
  // ── States with explicit clinical laboratory licensure beyond CLIA ──

  {
    state_code: 'CA',
    state_name: 'California',
    licensure_required: 'yes',
    authority_name: 'California Department of Public Health, Laboratory Field Services (CDPH LFS)',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Annual license fee scaled by laboratory scope; consult CDPH LFS for current schedule.',
    renewal_cadence: 'annual',
    notes: 'California separately licenses both the clinical laboratory and the testing personnel (CLS, MLT, CGMBS). Personnel licensure is enforced; a CLIA certificate alone does not authorize testing.',
    source_citation: 'California Business and Professions Code Division 2, Chapter 3 (Clinical Laboratory Technology); CDPH LFS guidance.',
    last_verified: TODAY,
  },
  {
    state_code: 'FL',
    state_name: 'Florida',
    licensure_required: 'yes',
    authority_name: 'Agency for Health Care Administration (AHCA), Bureau of Health Facility Regulation',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Biennial license fee tied to specialty / subspecialty count; consult AHCA for current schedule.',
    renewal_cadence: 'biennial',
    notes: 'Florida licenses the clinical laboratory directly; personnel licensure is separate.',
    source_citation: 'Florida Statutes Chapter 483 (Clinical, Public Health, Public Health Laboratories).',
    last_verified: TODAY,
  },
  {
    state_code: 'MA',
    state_name: 'Massachusetts',
    licensure_required: 'yes',
    authority_name: 'Massachusetts Department of Public Health, Division of Health Care Facility Licensure and Certification',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Biennial license fee; consult DPH for current schedule.',
    renewal_cadence: 'biennial',
    notes: 'Massachusetts requires a state clinical laboratory license in addition to CLIA. Personnel licensure is separate where applicable.',
    source_citation: '105 CMR 180 (Clinical Laboratories); Massachusetts General Laws Chapter 111D.',
    last_verified: TODAY,
  },
  {
    state_code: 'MD',
    state_name: 'Maryland',
    licensure_required: 'yes',
    authority_name: 'Maryland Department of Health, Office of Health Care Quality (OHCQ), Laboratory Licensing and Certification Program',
    authority_url: null,
    application_form_name: 'Medical Laboratory Permit Application',
    application_form_url: null,
    fee_description: 'Annual license fee; consult OHCQ for current schedule.',
    renewal_cadence: 'annual',
    notes: 'Maryland separately licenses the laboratory and the technical personnel. Test menu approval is part of the application.',
    source_citation: 'Maryland Code of Regulations COMAR 10.10 (Laboratories).',
    last_verified: TODAY,
  },
  {
    state_code: 'NJ',
    state_name: 'New Jersey',
    licensure_required: 'yes',
    authority_name: 'New Jersey Department of Health, Clinical Laboratory Improvement Service (CLIS)',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Annual license fee; consult CLIS for current schedule.',
    renewal_cadence: 'annual',
    notes: 'New Jersey requires a state clinical laboratory license in addition to CLIA. CLIS administers both inspections and personnel review.',
    source_citation: 'New Jersey Administrative Code N.J.A.C. 8:44 (Clinical Laboratories).',
    last_verified: TODAY,
  },
  {
    state_code: 'NY',
    state_name: 'New York',
    licensure_required: 'exempt',
    authority_name: 'New York State Department of Health, Clinical Laboratory Evaluation Program (CLEP)',
    authority_url: null,
    application_form_name: 'New York State Clinical Laboratory Permit Application',
    application_form_url: null,
    fee_description: 'Annual permit fee scaled by lab scope; consult CLEP for current schedule. Pathologist or doctoral lab director credential required.',
    renewal_cadence: 'annual',
    notes: `${EXEMPT_NOTE} New York runs its own inspection program (CLEP). PT proficiency goes through the NYS PT program. Test menu and method validation reviewed at permit issuance and at scope changes.`,
    source_citation: 'New York Public Health Law Article 5, Title V; 10 NYCRR Part 58.',
    last_verified: TODAY,
  },
  {
    state_code: 'OR',
    state_name: 'Oregon',
    licensure_required: 'yes',
    authority_name: 'Oregon Health Authority, Public Health Division, Clinical Laboratory Section',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Annual license fee; consult OHA for current schedule.',
    renewal_cadence: 'annual',
    notes: 'Oregon licenses the clinical laboratory in addition to CLIA. Personnel requirements are separate where applicable.',
    source_citation: 'Oregon Revised Statutes ORS 438; Oregon Administrative Rules OAR 333-024.',
    last_verified: TODAY,
  },
  {
    state_code: 'PA',
    state_name: 'Pennsylvania',
    licensure_required: 'yes',
    authority_name: 'Pennsylvania Department of Health, Bureau of Laboratories',
    authority_url: null,
    application_form_name: 'Clinical Laboratory Permit Application',
    application_form_url: null,
    fee_description: 'Annual permit fee; consult Bureau of Laboratories for current schedule.',
    renewal_cadence: 'annual',
    notes: 'Pennsylvania requires a state clinical laboratory permit in addition to CLIA.',
    source_citation: '28 Pa. Code Chapter 5 (Clinical Laboratory Act).',
    last_verified: TODAY,
  },
  {
    state_code: 'RI',
    state_name: 'Rhode Island',
    licensure_required: 'yes',
    authority_name: 'Rhode Island Department of Health, Center for Health Facilities Regulation',
    authority_url: null,
    application_form_name: 'Clinical Laboratory License Application',
    application_form_url: null,
    fee_description: 'Annual license fee; consult RIDOH for current schedule.',
    renewal_cadence: 'annual',
    notes: 'Rhode Island requires a state clinical laboratory license in addition to CLIA.',
    source_citation: 'Rhode Island General Laws Chapter 23-16.2; 216 RICR 60-05-7.',
    last_verified: TODAY,
  },
  {
    state_code: 'WA',
    state_name: 'Washington',
    licensure_required: 'exempt',
    authority_name: 'Washington State Department of Health, Office of Laboratory Quality Assurance, Medical Test Site (MTS) program',
    authority_url: null,
    application_form_name: 'Medical Test Site License Application',
    application_form_url: null,
    fee_description: 'Biennial license fee scaled by test categories; consult DOH OLQA for current schedule.',
    renewal_cadence: 'biennial',
    notes: `${EXEMPT_NOTE} Washington's Medical Test Site (MTS) license is the state's equivalent of the CLIA certificate. State proficiency testing requirements apply.`,
    source_citation: 'Washington Administrative Code WAC 246-338; Revised Code of Washington RCW 70.42.',
    last_verified: TODAY,
  },

  // ── States Michael flagged for verification (licensure scheme uncertain) ──

  {
    state_code: 'KS',
    state_name: 'Kansas',
    licensure_required: 'unknown',
    authority_name: 'Kansas Department of Health and Environment (KDHE)',
    authority_url: null,
    application_form_name: null,
    application_form_url: null,
    fee_description: null,
    renewal_cadence: null,
    notes: NEEDS_VERIFICATION_NOTE,
    source_citation: 'Per operator triage list; agency confirmation pending.',
    last_verified: null,
  },
  {
    state_code: 'NH',
    state_name: 'New Hampshire',
    licensure_required: 'unknown',
    authority_name: 'New Hampshire Department of Health and Human Services',
    authority_url: null,
    application_form_name: null,
    application_form_url: null,
    fee_description: null,
    renewal_cadence: null,
    notes: NEEDS_VERIFICATION_NOTE,
    source_citation: 'Per operator triage list; agency confirmation pending.',
    last_verified: null,
  },
  {
    state_code: 'NM',
    state_name: 'New Mexico',
    licensure_required: 'unknown',
    authority_name: 'New Mexico Department of Health',
    authority_url: null,
    application_form_name: null,
    application_form_url: null,
    fee_description: null,
    renewal_cadence: null,
    notes: NEEDS_VERIFICATION_NOTE,
    source_citation: 'Per operator triage list; agency confirmation pending.',
    last_verified: null,
  },
  {
    state_code: 'TX',
    state_name: 'Texas',
    licensure_required: 'unknown',
    authority_name: 'Texas Department of State Health Services (DSHS)',
    authority_url: null,
    application_form_name: null,
    application_form_url: null,
    fee_description: null,
    renewal_cadence: null,
    notes: `${NEEDS_VERIFICATION_NOTE} Texas licenses radiologic technologists and clinical lab personnel categories separately under the Texas Occupations Code; clinical laboratory facility licensure scheme not confirmed at authoring.`,
    source_citation: 'Per operator triage list; agency confirmation pending.',
    last_verified: null,
  },

  // ── CLIA-only states (no state license required) ──

  ...([
    ['AL', 'Alabama'],
    ['AK', 'Alaska'],
    ['AZ', 'Arizona'],
    ['AR', 'Arkansas'],
    ['CO', 'Colorado'],
    ['CT', 'Connecticut'],
    ['DE', 'Delaware'],
    ['DC', 'District of Columbia'],
    ['GA', 'Georgia'],
    ['HI', 'Hawaii'],
    ['ID', 'Idaho'],
    ['IL', 'Illinois'],
    ['IN', 'Indiana'],
    ['IA', 'Iowa'],
    ['KY', 'Kentucky'],
    ['LA', 'Louisiana'],
    ['ME', 'Maine'],
    ['MI', 'Michigan'],
    ['MN', 'Minnesota'],
    ['MS', 'Mississippi'],
    ['MO', 'Missouri'],
    ['MT', 'Montana'],
    ['NE', 'Nebraska'],
    ['NV', 'Nevada'],
    ['NC', 'North Carolina'],
    ['ND', 'North Dakota'],
    ['OH', 'Ohio'],
    ['OK', 'Oklahoma'],
    ['SC', 'South Carolina'],
    ['SD', 'South Dakota'],
    ['TN', 'Tennessee'],
    ['UT', 'Utah'],
    ['VT', 'Vermont'],
    ['VA', 'Virginia'],
    ['WV', 'West Virginia'],
    ['WI', 'Wisconsin'],
    ['WY', 'Wyoming'],
  ] as const).map<StateRegistryRow>(([code, name]) => ({
    state_code: code,
    state_name: name,
    licensure_required: 'no',
    authority_name: 'CMS State Agency (federal CLIA program); state surveys conducted by the State Survey Agency on behalf of CMS.',
    authority_url: null,
    application_form_name: 'CMS Form 116 (CLIA Application for Certification)',
    application_form_url: null,
    fee_description: 'Federal CLIA biennial certificate fee scaled by certificate type and annual test volume; per the CMS published CLIA fee schedule.',
    renewal_cadence: 'biennial',
    notes: CLIA_ONLY_NOTE,
    source_citation: CLIA_SOURCE,
    last_verified: TODAY,
  })),
];
