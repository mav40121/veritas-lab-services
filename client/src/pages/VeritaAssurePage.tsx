import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FlaskConical, Map, ClipboardCheck, Award, Users, FileText,
  ChevronRight, CheckCircle2, Download, Shield, Play,
} from "lucide-react";

const MODULES = [
  {
    href: "/veritacheck",
    label: "VeritaCheck\u2122",
    desc: "EP Study Analysis",
    detail:
      "Calibration Verification / Linearity, Correlation / Method Comparison, Precision, Lot-to-Lot Reagent Verification, QC Range Establishment, and Coagulation New Lot studies. CLIA-compliant PDF reports with signature block on page 1.",
    badge: "Live",
    badgeColor: "emerald",
    icon: FlaskConical,
    color: "text-teal-600 bg-teal-500/10 border-teal-500/20",
  },
  {
    href: "/veritamap",
    label: "VeritaMap\u2122",
    desc: "Test Menu Regulatory Mapping",
    detail:
      "Map every instrument and analyte in your lab with CLIA complexity, specialty, and FDA classification. 189 instruments across 18 departments. Feeds VeritaCheck instrument selection and VeritaComp competency programs.",
    badge: "Live",
    badgeColor: "emerald",
    icon: Map,
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
  },
  {
    href: "/veritascan",
    label: "VeritaScan\u2122",
    desc: "Inspection Readiness",
    detail:
      "168 compliance items across 10 domains aligned to TJC and CAP standards. Know exactly where you stand before a surveyor arrives. Executive summary and full PDF export.",
    badge: "Live",
    badgeColor: "emerald",
    icon: ClipboardCheck,
    color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
  },
  {
    href: "/veritacomp",
    label: "VeritaComp\u2122",
    desc: "Competency Management",
    detail:
      "Technical, waived, and non-technical competency programs using all 6 CLIA assessment elements. Competency timelines (Initial, 6-month, Annual). Quiz engine with addendum PDF.",
    badge: "In Progress",
    badgeColor: "amber",
    icon: Award,
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  },
  {
    href: "/veritastaff",
    label: "VeritaStaff\u2122",
    desc: "Personnel Management",
    detail:
      "Employee roster with CLIA role assignments (LD, TC, TS, GS, TP) and specialty tracking. CMS 209 Laboratory Personnel Report auto-generation. NYS additional requirements supported.",
    badge: "In Progress",
    badgeColor: "amber",
    icon: Users,
    color: "text-orange-600 bg-orange-500/10 border-orange-500/20",
  },
  {
    href: "/veritalab",
    label: "VeritaLab\u2122",
    desc: "Certificate and Accreditation Tracking",
    detail:
      "Track CLIA, CAP, TJC, COLA, state licenses, and lab director credentials. Advance email reminders at 90, 60, and 30 days before expiration. Document archive for certificate PDFs.",
    badge: "New",
    badgeColor: "emerald",
    icon: FileText,
    color: "text-green-600 bg-green-500/10 border-green-500/20",
  },
];

const PRICING = [
  { tier: "Per Study", price: "$25", note: "One-time, VeritaCheck only" },
  { tier: "VeritaCheck\u2122 Unlimited", price: "$299/yr", note: "CLIA required, single user" },
  { tier: "Waived", price: "$499/yr", note: "Certificate of Waiver labs, all modules" },
  { tier: "Community", price: "$799/yr", note: "1-8 specialties, all modules" },
  { tier: "Hospital", price: "$1,299/yr", note: "9-15 specialties, all modules" },
  { tier: "Large Hospital", price: "$1,999/yr", note: "16+ specialties, all modules" },
];

const DOWNLOADS = [
  {
    title: "VeritaCheck\u2122 CLSI Compliance Matrix",
    desc: "One-page landscape reference. Maps all 6 VeritaCheck\u2122 study types to applicable CLSI, CLIA (42 CFR), CAP checklist, and TJC standards. Use this to demonstrate regulatory alignment to inspectors.",
    badge: "Free Download",
    url: "/api/downloads/clsi-compliance-matrix",
    filename: "VeritaCheck_CLSI_Compliance_Matrix.pdf",
    icon: Shield,
  },
  {
    title: "VeritaCheck\u2122 Software Validation Template",
    desc: "4-page fillable validation template. Structured workflow to validate VeritaCheck\u2122 for compliance documentation before placing it into service. Satisfies CAP GEN.20316, TJC QSA.15.01.01 EP1, and CLIA 42 CFR 493.1251.",
    badge: "Free Download",
    url: "/api/downloads/software-validation-template",
    filename: "VeritaCheck_Software_Validation_Template.pdf",
    icon: CheckCircle2,
  },
];

function BadgePill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`text-[9px] font-semibold border rounded px-1.5 py-0.5 leading-none ${
        color === "emerald"
          ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/25"
          : "bg-amber-500/15 text-amber-600 border-amber-500/25"
      }`}
    >
      {label}
    </span>
  );
}

export default function VeritaAssurePage() {
  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/4 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <Badge
            variant="outline"
            className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium"
          >
            Compliance Suite
          </Badge>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
            VeritaAssure&#8482;
          </h1>
          <p className="text-xl text-primary font-semibold mb-3">
            Confidence and clarity for lab compliance.
          </p>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mb-8">
            VeritaAssure&#8482; is the integrated lab compliance suite from Veritas Lab Services, LLC.
            It unites method validation, inspection readiness, test menu mapping, competency management,
            personnel tracking, and certificate monitoring into one platform built by a working lab professional.
            Browser-based. No desktop software. No installation.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/demo">
                <Play size={15} className="mr-1.5" /> View Live Demo
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/login">
                Get Started <ChevronRight size={14} className="ml-1" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 space-y-16">

        {/* Module Grid */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-6">
            The Suite
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULES.map(({ href, label, desc, detail, badge, badgeColor, icon: Icon, color }) => (
              <Link key={href} href={href}>
                <Card className="h-full hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center border ${color}`}
                      >
                        <Icon size={18} />
                      </div>
                      <BadgePill label={badge} color={badgeColor} />
                    </div>
                    <div className="font-semibold text-sm group-hover:text-primary transition-colors mb-0.5">
                      {label}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium mb-2">{desc}</div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{detail}</p>
                    <div className="mt-3 flex items-center gap-1 text-xs text-primary font-medium">
                      Learn more <ChevronRight size={11} />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        {/* Free Downloads */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            Free Downloads
          </div>
          <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
            Two documents to help your lab validate and deploy VeritaCheck&#8482; for compliance documentation.
            No login required.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {DOWNLOADS.map(({ title, desc, badge, url, filename, icon: Icon }) => (
              <Card key={title} className="border-primary/20 hover:border-primary/40 hover:shadow-md transition-all group">
                <CardContent className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-primary" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">
                        {badge}
                      </span>
                    </div>
                  </div>
                  <div className="font-semibold text-sm mb-2 group-hover:text-primary transition-colors">
                    {title}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-4">{desc}</p>
                  <a
                    href={url}
                    download={filename}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Download size={13} /> Download PDF
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Pricing Summary */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            Pricing
          </div>
          <p className="text-sm text-muted-foreground mb-5 max-w-2xl">
            Plans are sized by CLIA specialty count and automatically assigned at checkout after your CLIA lookup.
            Seat 1 is included in every plan. Additional seats available starting at $199/seat/year.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PRICING.map(({ tier, price, note }) => (
              <div
                key={tier}
                className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <div className="font-semibold text-sm">{tier}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{note}</div>
                </div>
                <div className="text-lg font-bold text-primary shrink-0">{price}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Button asChild variant="outline" size="sm">
              <Link href="/services">
                Full pricing and feature comparison <ChevronRight size={13} className="ml-1" />
              </Link>
            </Button>
          </div>
        </section>

        {/* Why VeritaAssure */}
        <section className="rounded-2xl border border-border bg-card p-8">
          <h2 className="font-serif text-2xl font-bold mb-4">Why VeritaAssure&#8482;</h2>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
            {[
              "Fewer surprises during inspections: know your status before a surveyor arrives.",
              "Clear guidance on regulatory questions aligned to CLIA, CAP, COLA, TJC, and FDA.",
              "Stronger quality systems with structured documentation at every step.",
              "Communicate clear, data-driven assurance to hospital leadership.",
              "Built by a former TJC laboratory surveyor with 200+ facility inspections.",
              "3-5x less expensive than leading desktop validation tools.",
              "No installation, no desktop software: runs in any browser.",
              "CLIA number on every PDF report header, every time.",
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                <span className="text-sm text-muted-foreground leading-relaxed">{item}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-2xl bg-primary text-primary-foreground p-10 text-center">
          <FlaskConical size={30} className="mx-auto mb-3 opacity-80" />
          <h2 className="font-serif text-2xl font-bold mb-3">
            Ready to see VeritaAssure&#8482; in action?
          </h2>
          <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-6">
            The live demo runs all five modules with real data and generates actual PDF reports.
            No login required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
              <Link href="/demo">
                <Play size={15} className="mr-1.5" /> View Live Demo
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
              <Link href="/login">
                Create Free Account <ChevronRight size={14} className="ml-1" />
              </Link>
            </Button>
          </div>
        </section>

      </div>
    </div>
  );
}
