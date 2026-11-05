import { useSEO } from "@/hooks/useSEO";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, CalendarDays } from "lucide-react";

interface RoadmapItem {
  title: string;
  description: string;
}

const completedItems: RoadmapItem[] = [
  {
    title: "VeritaCheck® - Performance Verification Suite",
    description:
      "Runs the verification studies labs use for CLIA and CAP requirements: Correlation / Method Comparison, Calibration Verification / Linearity, accuracy, precision, lot-to-lot verification, QC range establishment, and multi-analyte comparison. Generates PDF reports with statistical tables.",
  },
  {
    title: "VeritaCheck® - Reference Range Verification Workflow",
    description:
      "Verifies your reference ranges with a structured study based on CLSI EP28. The lab then enters its verified ranges in VeritaMap®, which never pre-fills them. Supports reference interval verification under 42 CFR 493.1253(b)(1)(ii).",
  },
  {
    title: "VeritaStock™ - Laboratory Inventory Management",
    description:
      "Par level-based inventory tracking built for clinical labs. Track items by department, burn rate, lead time, and standing order status. Auto-calculates par levels, order-to quantities, and order quantities in both units and order units. Surfaces what needs to be ordered today, with no spreadsheet math required.",
  },
  {
    title: "VeritaMap® - Laboratory Test Menu Mapping",
    description:
      "Builds a complete instrument and test menu inventory for your lab. Maps more than 270 instruments across 18 departments; the lab verifies and adopts its own reference ranges, critical values, and AMR. Exports a formatted Excel workbook with compliance tracking. Free tier available.",
  },
  {
    title: "VeritaScan® - Inspection Readiness Checklist",
    description:
      "173-item checklist covering the most commonly cited TJC and CAP standards. Walks through every major inspection domain, tracks completion status, and exports results to Excel. Built for pre-survey walkthroughs and ongoing readiness monitoring.",
  },
  {
    title: "VeritaLab™ - Certificate and Accreditation Tracking",
    description:
      "Tracks CLIA certificates, CAP accreditation, TJC accreditation, state licenses, and lab director credentials. Sends advance renewal reminders at 9 months, 6 months, 3 months, 30 days, and expiration. Stores certificate documents for instant retrieval during surveys.",
  },
  {
    title: "VeritaAssure™ Consulting Services",
    description:
      "Mock inspections, productivity analysis, leadership coaching, educational webinars, and laboratory director services. Available as a standalone engagement or alongside the software suite.",
  },
  {
    title: "VeritaCheck® - PT/INR Geometric Mean Calculator",
    description:
      "Re-establishes the Mean Normal PT (MNPT) from a cohort of healthy normal patients when the PT reagent lot changes, then verifies the new INR equation against the prior lot on patient samples. Generates a PDF with full statistical tables and the new geometric mean for instrument and LIS programming. Laboratory director or designee review and approval required.",
  },
  {
    title: "VeritaPT™ - Proficiency Testing Tracker",
    description:
      "Reads your VeritaMap® test menu, checks each analyte against CLIA PT requirements, and surfaces gaps, recommended programs, and current coverage. Tracks PT enrollments by program and logs event results.",
  },
  {
    title: "VeritaDC™ - Policy and Document Control",
    description:
      "A document control system for the lab: manage policies, procedures, and forms with version history, director approval, and periodic reviews. Tracks the policies required under CLIA (42 CFR 493) and crosswalks each one to your accrediting body: CAP, COLA, TJC, or AABB. Service line toggles auto-apply N/A, and one document satisfies multiple requirements. Readiness score with an inspector-ready PDF report.",
  },
  {
    title: "VeritaComp™ - Competency Assessment Management",
    description:
      "Manages technical (6-element assessment per method group), waived (2-of-4 method selection), and non-technical (supervisor checklist) competency. Generates PDF records with per-element documentation fields. Element 6 problem-solving quiz engine is live: directors author quizzes in-app or upload JSON, edit questions in place, and attach a quiz to any method groups in their program. Each quiz requires a 100% score to pass; the full quiz and graded answers append to the competency PDF.",
  },
  {
    title: "VeritaStaff™ - Personnel and Credentialing Management",
    description:
      "Manages laboratory employee records with CLIA role assignments (LD, TC, TS, GS, TP). Tracks qualification requirements by role and complexity, staff credentials and expirations, and continuing education. Generates CMS 209 documentation. Competency timeline engine tracks initial, 6-month, and annual assessment due dates.",
  },
  {
    title: "VeritaTrack™ - Regulatory Compliance Calendar",
    description:
      "Tracks timed regulatory tasks on weekly through biennial frequencies. One-click import of your VeritaMap® test menu, sign-off logging with initials and dates, and an Excel export in a regulatory-calendar layout.",
  },
  {
    title: "VeritaResponse™ - Post-Survey Deficiency Response",
    description:
      "Turns a survey citation into one tracked finding with a due-date clock per accreditor, and renders a Plan of Correction PDF.",
  },
  {
    title: "VeritaQC™ - Daily QC and Westgard Evaluation",
    description:
      "Daily QC entry with Westgard multi-rule evaluation, corrective action capture on rejections, a daily review feed, and a monthly review PDF.",
  },
  {
    title: "VeritaMaintain™ - Equipment Maintenance",
    description:
      "Tracks each instrument's maintenance and function-check schedule, logs who performed each event and when, and shows what is overdue.",
  },
  {
    title: "VeritaBench™ - Free Productivity Scorecard",
    description:
      "A free, no-sign-in scorecard of productive hours per billable test against ranges by facility type.",
  },
  {
    title: "VeritaPace™ - Monthly Productivity Tracking",
    description:
      "Month-over-month tracking of billable tests, productive hours, FTE, overtime, and trend lines.",
  },
  {
    title: "VeritaShift™ - By-Hour Staffing Analysis",
    description:
      "Hour-by-hour workload analysis for shift design and FTE planning, showing where staffed capacity matches demand and where the gaps are.",
  },
  {
    title: "VeritaQA™ - Department Quality Metrics",
    description:
      "Department-level quality indicators with metric trends, targets, and corrective actions.",
  },
  {
    title: "VeritaOps™ - Cost Per Reportable Test",
    description:
      "Layered cost-per-reportable-test calculator: reagents and supplies plus staff time, with capital depreciation and overhead as opt-in layers.",
  },
];

const comingSoonItems: RoadmapItem[] = [
  {
    title: "VeritaComp™ - Shared Question Library (Phase 2)",
    description:
      "Community-sourced library of Element 6 problem-solving questions, customer-built. Directors who author a quiz can opt in to contribute questions to a cross-lab library matched by instrument, analyte, specialty, and complexity. Other directors browse, upvote and downvote, and import library questions into their own quizzes (each import is a deep copy so local edits do not affect the library entry). All sharing is opt-in and anonymized at the lab level. The library is an optional accelerator; Element 6 is fully functional today via director-authored quizzes.",
  },
  {
    title: "Mobile-Optimized Views",
    description:
      "Core modules optimized for tablet and mobile use. Designed for technologists completing competency documentation at the bench, not just administrators at a desk.",
  },
  {
    title: "Enterprise API Access",
    description:
      "REST API for health systems and reference labs that need to integrate VeritaAssure® data into existing LIS, LIMS, or compliance platforms.",
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
    useSEO({ title: "Product Roadmap | VeritaAssure® Lab Compliance Software", description: "See what is coming next for VeritaAssure®. Upcoming features for clinical laboratory compliance, quality management, and accreditation readiness." });
return (
    <div>
      {/* Header */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="max-w-3xl">
            <h1 className="font-serif text-4xl sm:text-5xl font-bold mb-4">Product Roadmap</h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              What we have built and what is coming next. No hype, no dates - just an honest picture of where VeritaAssure® is headed.
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
