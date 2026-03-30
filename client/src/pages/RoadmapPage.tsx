import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Clock, CalendarDays } from "lucide-react";

interface RoadmapItem {
  title: string;
  description: string;
}

const completedItems: RoadmapItem[] = [
  {
    title: "VeritaCheck\u2122 \u2014 Method Validation Suite",
    description:
      "Runs EP studies required for CLIA and CAP compliance: method comparison, calibration verification/linearity, accuracy, precision, lot-to-lot verification, QC range establishment, and multi-analyte comparison. Generates compliant PDF reports with statistical tables.",
  },
  {
    title: "VeritaMap\u2122 \u2014 Laboratory Test Menu Mapping",
    description:
      "Builds a complete instrument and test menu inventory for your lab. Maps 190+ instruments across all specialties, pulls Mayo Clinic Laboratories reference ranges, critical values, and AMR. Exports a formatted Excel workbook with compliance tracking. Free tier available.",
  },
  {
    title: "VeritaScan\u2122 \u2014 Inspection Readiness Checklist",
    description:
      "168-item checklist covering the most commonly cited TJC and CAP standards. Walks through every major inspection domain, tracks completion status, and exports results to Excel. Built for pre-survey walkthroughs and ongoing readiness monitoring.",
  },
  {
    title: "VeritaLab\u2122 \u2014 Certificate and Accreditation Tracking",
    description:
      "Tracks CLIA certificates, CAP accreditation, TJC accreditation, state licenses, and lab director credentials. Sends advance renewal reminders at 9 months, 6 months, 3 months, 30 days, and expiration. Stores certificate documents for instant retrieval during surveys.",
  },
  {
    title: "CLIA-Based Account Verification",
    description:
      "Every account is tied to a specific CLIA certificate. Lab tier and pricing are determined automatically by certificate type and specialty count. No self-reporting required.",
  },
  {
    title: "VeritaAssure\u2122 Consulting Services",
    description:
      "Mock inspections, regulatory gap analysis, laboratory director services, and policy and procedure development. Available as a standalone engagement or alongside the software suite.",
  },
];

const inProgressItems: RoadmapItem[] = [
  {
    title: "VeritaComp\u2122 \u2014 Competency Assessment Management",
    description:
      "Manages all three CLIA competency types: technical (6-element assessment per method group), waived (2-of-4 method selection), and non-technical (supervisor checklist). Generates compliant PDF records with per-element documentation fields. Active refinement ongoing based on TJC, CAP, and CLIA surveyor expectations.",
  },
  {
    title: "VeritaComp\u2122 \u2014 Problem-Solving Quiz Engine",
    description:
      "Element 6 of the technical competency assessment requires documented problem-solving evaluation. The quiz engine delivers instrument-specific questions per method group, requires 100% to pass, and appends the full question-and-answer record to the competency PDF. Question banks are being expanded by instrument and specialty.",
  },
  {
    title: "VeritaStaff\u2122 \u2014 Personnel and Credentialing Management",
    description:
      "Manages laboratory employee records with CLIA role assignments (LD, TC, TS, GS, TP). Tracks qualification requirements by role and complexity. Generates CMS 209 documentation. Competency timeline engine tracks initial, 6-month, and annual assessment due dates.",
  },
];

const comingSoonItems: RoadmapItem[] = [
  {
    title: "VeritaComp\u2122 \u2014 Expanded Instrument Question Banks",
    description:
      "Pre-built problem-solving questions for every major instrument and specialty. Chemistry, hematology, coagulation, blood bank, microbiology, urinalysis, and point-of-care. Required to fully activate Element 6 across all method groups.",
  },
  {
    title: "VeritaPT\u2122 \u2014 Proficiency Testing Tracker",
    description:
      "Tracks PT enrollment, survey results, and corrective actions by analyte and specialty. Monitors unacceptable results, identifies trends, and generates documentation for surveyor review.",
  },
  {
    title: "VeritaLab\u2122 \u2014 Director and Staff Credential Tracking",
    description:
      "Extends certificate tracking to individual staff credentials: MT/MLS licensure, specialty certifications, and continuing education requirements. Flags expiring credentials before they create compliance gaps.",
  },
  {
    title: "Mobile-Optimized Views",
    description:
      "Core modules optimized for tablet and mobile use. Designed for technologists completing competency documentation at the bench, not just administrators at a desk.",
  },
  {
    title: "Enterprise API Access",
    description:
      "REST API for health systems and reference labs that need to integrate VeritaAssure data into existing LIS, LIMS, or compliance platforms.",
  },
];

interface SectionProps {
  label: string;
  icon: React.ReactNode;
  accentColor: string;
  borderColor: string;
  items: RoadmapItem[];
}

function RoadmapSection({ label, icon, accentColor, borderColor, items }: SectionProps) {
  return (
    <section className="border-b border-border">
      <div className="container-default py-14">
        <div className="flex items-center gap-3 mb-8">
          {icon}
          <h2 className={`font-serif text-2xl font-bold ${accentColor}`}>{label}</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((item) => (
            <Card
              key={item.title}
              className={`border-border bg-card ${borderColor} border-t-2`}
            >
              <CardContent className="p-5">
                <h3 className="font-semibold text-sm mb-2 text-foreground leading-snug">
                  {item.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function RoadmapPage() {
  return (
    <div>
      {/* Header */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="max-w-3xl">
            <h1 className="font-serif text-4xl sm:text-5xl font-bold mb-4">Product Roadmap</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              What we have built, what we are actively working on, and what is coming next. No hype, no dates - just an honest picture of where VeritaAssure is headed.
            </p>
          </div>
        </div>
      </section>

      {/* Completed */}
      <RoadmapSection
        label="Completed"
        icon={<CheckCircle2 size={24} className="text-emerald-600" />}
        accentColor="text-emerald-600"
        borderColor="border-t-emerald-500"
        items={completedItems}
      />

      {/* In Progress */}
      <RoadmapSection
        label="In Progress"
        icon={<Clock size={24} className="text-amber-600" />}
        accentColor="text-amber-600"
        borderColor="border-t-amber-500"
        items={inProgressItems}
      />

      {/* Coming Soon */}
      <RoadmapSection
        label="Coming Soon"
        icon={<CalendarDays size={24} className="text-primary" />}
        accentColor="text-primary"
        borderColor="border-t-primary"
        items={comingSoonItems}
      />

      {/* Footer note */}
      <section className="border-b border-border">
        <div className="container-default py-8">
          <p className="text-xs text-muted-foreground">
            This roadmap reflects our current development priorities. Items may shift based on regulatory changes, customer feedback, and new compliance requirements. No dates are provided intentionally.
          </p>
        </div>
      </section>
    </div>
  );
}
