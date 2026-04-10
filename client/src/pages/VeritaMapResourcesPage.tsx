import { ExternalLink, BookOpen, AlertTriangle } from "lucide-react";

interface Resource {
  title: string;
  url: string;
  description: string;
  publisher: string;
}

interface Section {
  heading: string;
  intro: string;
  resources: Resource[];
}

const SECTIONS: Section[] = [
  {
    heading: "Establishing Reference Intervals",
    intro:
      "CLIA requires labs to establish reference intervals appropriate for their patient population and verify them before reporting results. These resources define the methodology.",
    resources: [
      {
        title: "CLSI EP28-A3c: Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory",
        url: "https://clsi.org/standards/products/method-evaluation/documents/ep28/",
        description:
          "The primary CLSI standard for reference interval establishment. Defines the statistical approach, minimum sample sizes, and transfer/verification methodologies. Required reading for any lab establishing or adopting reference intervals.",
        publisher: "Clinical and Laboratory Standards Institute (CLSI)",
      },
      {
        title: "CLSI C28-A3c: How to Define and Determine Reference Intervals in the Clinical Laboratory",
        url: "https://clsi.org/standards/products/clinical-chemistry-and-toxicology/documents/c28/",
        description:
          "Companion document to EP28. Covers the analytical and pre-analytical considerations for reference interval studies, including partitioning by age, sex, and sample type.",
        publisher: "Clinical and Laboratory Standards Institute (CLSI)",
      },
    ],
  },
  {
    heading: "Critical Values",
    intro:
      "CLIA and TJC both require laboratories to define and document critical values. These resources provide consensus benchmarks and regulatory requirements.",
    resources: [
      {
        title: "Mayo Clinic Laboratories: Critical Values Reference List",
        url: "https://www.mayocliniclabs.com/test-catalog/overview/63264",
        description:
          "Mayo Clinic's published critical value thresholds, widely cited as a benchmark in the literature. Useful as a starting reference when establishing your lab's policy. Note: each lab must establish and validate its own critical value thresholds for its patient population.",
        publisher: "Mayo Clinic Laboratories",
      },
      {
        title: "TJC National Patient Safety Goal NPSG.02.03.01: Critical Values Reporting",
        url: "https://www.jointcommission.org/standards/national-patient-safety-goals/",
        description:
          "TJC requirement for timely reporting of critical test results to the responsible licensed caregiver. Defines the expectation for documentation, timeliness, and read-back verification.",
        publisher: "The Joint Commission (TJC)",
      },
      {
        title: "ADLM/AACC Critical Values Consensus Statement",
        url: "https://www.aacc.org/publications/journals/clinical-chemistry/clinchem-papers-of-note",
        description:
          "Professional society consensus guidelines on critical value policy design, including recommended analytes, thresholds, and documentation practices.",
        publisher: "Association for Diagnostics and Laboratory Medicine (ADLM)",
      },
    ],
  },
  {
    heading: "Analytical Measurement Range (AMR)",
    intro:
      "AMR must be verified per CLIA 42 CFR 493.1253(b)(1) for each instrument before reporting patient results. These resources define the methodology and regulatory basis.",
    resources: [
      {
        title: "CLSI EP6-A: Evaluation of the Linearity of Quantitative Measurement Procedures",
        url: "https://clsi.org/standards/products/method-evaluation/documents/ep6/",
        description:
          "Defines the statistical approach for verifying AMR and linearity. This is the standard referenced by CMS and accreditation bodies for linearity/AMR verification studies.",
        publisher: "Clinical and Laboratory Standards Institute (CLSI)",
      },
      {
        title: "42 CFR 493.1253(b)(1) - Establishment and Verification of Performance Specifications",
        url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
        description:
          "The CLIA regulation requiring labs to verify AMR for each instrument before reporting results and at defined intervals thereafter. The primary regulatory basis for AMR requirements.",
        publisher: "Electronic Code of Federal Regulations (eCFR)",
      },
      {
        title: "Instrument Manufacturer Package Inserts",
        url: "https://www.accessdata.fda.gov/scripts/cdrh/devicesatfda/index.cfm",
        description:
          "Each FDA-cleared analyzer's package insert specifies the manufacturer-claimed AMR. This is the starting point for AMR verification -- labs confirm their instrument performs within the stated range. Contact your instrument manufacturer or check FDA's device database for the current package insert.",
        publisher: "FDA Device Database / Instrument Manufacturer",
      },
    ],
  },
  {
    heading: "Units of Measure",
    intro:
      "Consistent, standardized units are required for inter-laboratory result comparison and are referenced by accreditation standards.",
    resources: [
      {
        title: "LOINC Units of Measure Reference",
        url: "https://loinc.org/usage/units/",
        description:
          "The LOINC units registry provides standardized units for clinical laboratory tests. Useful for ensuring consistency with LIS-reported units and external reference ranges.",
        publisher: "Regenstrief Institute / LOINC",
      },
      {
        title: "SI Units in Laboratory Medicine (CLSI AUTO15-A)",
        url: "https://clsi.org/",
        description:
          "CLSI guidance on the use of Systeme International (SI) units in clinical laboratory reporting. Relevant when comparing reference ranges from international literature sources.",
        publisher: "Clinical and Laboratory Standards Institute (CLSI)",
      },
    ],
  },
];

export default function VeritaMapResourcesPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen size={20} className="text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Reference Literature</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Authoritative sources for establishing reference ranges, critical values, AMR, and units of measure in your clinical laboratory.
        </p>
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-8 flex gap-3">
        <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-800 dark:text-amber-200">
          CLIA requires each laboratory to establish and verify reference intervals, critical values, and AMR for their specific instruments and patient population.
          Values from external sources must be validated before clinical use.
          The resources below are provided as literature references only and do not constitute laboratory-validated values.
          Consult your laboratory director or medical director before adopting any published threshold.
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-10">
        {SECTIONS.map(section => (
          <section key={section.heading}>
            <h2 className="text-base font-semibold text-foreground mb-1">{section.heading}</h2>
            <p className="text-xs text-muted-foreground mb-4">{section.intro}</p>
            <div className="space-y-3">
              {section.resources.map(r => (
                <a
                  key={r.url}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl border border-border bg-card p-4 hover:border-primary/50 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground group-hover:text-primary transition-colors flex items-center gap-1">
                        {r.title}
                        <ExternalLink size={11} className="shrink-0 opacity-50" />
                      </div>
                      <div className="text-[10px] text-primary/70 font-medium mt-0.5 mb-2">{r.publisher}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{r.description}</p>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Footer note */}
      <div className="mt-10 pt-6 border-t border-border">
        <p className="text-xs text-muted-foreground">
          To suggest an additional resource for this page, contact{" "}
          <a href="mailto:info@veritaslabservices.com" className="text-primary underline">
            info@veritaslabservices.com
          </a>
          .
        </p>
      </div>
    </div>
  );
}
