import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ExternalLink, ChevronRight, ClipboardList, AlertTriangle, FlaskConical } from "lucide-react";

const DOMAINS = [
  { num: "I",    label: "Lab Administration",         items: 16, desc: "CLIA certificate, director qualifications, personnel files, org structure, delegation" },
  { num: "II",   label: "Facility & Safety",           items: 18, desc: "BBP, Chemical Hygiene Plan, PPE, sharps, biohazardous waste, eyewash, BSC certification" },
  { num: "III",  label: "Quality Management",          items: 15, desc: "QM program, QA meetings, quality indicators, corrective action, RCA, complaint management" },
  { num: "IV",   label: "Test Management",             items: 18, desc: "Ordering, specimen collection, patient ID, critical values, corrected reports, record retention" },
  { num: "V",    label: "Proficiency Testing",         items: 13, desc: "Enrollment, sample handling, rotation, failure response, alternative assessment, PT prohibition policy" },
  { num: "VI",   label: "Instrument & Equipment",      items: 15, desc: "PM schedules, calibration, calibration verification, reagent lot verification, temperature monitoring" },
  { num: "VII",  label: "Procedure Manual",            items: 22, desc: "Completeness, bench accessibility, biennial review, required SOP elements, change control" },
  { num: "VIII", label: "Quality Control",             items: 19, desc: "QC program, frequency, OOC response, Levey-Jennings charts, IQCP, POCT, reflexive QC" },
  { num: "IX",   label: "Competency Assessment",       items: 16, desc: "All 6 CLIA methods, initial and annual frequency, documentation, remediation, high-complexity supervision" },
  { num: "X",    label: "Blood Bank / Transfusion Svc",items: 16, desc: "Pre-transfusion testing, patient ID, compatibility testing, transfusion reaction workup, FDA reporting" },
];

const STANDARDS = [
  { name: "TJC CAMLAB 2024", desc: "Every question maps to the exact Standard and Element of Performance" },
  { name: "CAP Checklists",  desc: "CAP checklist requirement numbers cited for each item" },
  { name: "42 CFR Part 493", desc: "Specific CFR section for every federal regulatory requirement" },
];

const FEATURES = [
  "168 compliance questions across 10 laboratory domains",
  "Triple-mapped to TJC CAMLAB 2024, CAP checklists, and 42 CFR §493",
  "Live compliance dashboard with real-time scores by domain",
  "Status tracking: Compliant / Needs Attention / Immediate Action / N/A",
  "Finding documentation fields with owner assignment and due dates",
  "Blood bank / transfusion service coverage (Domain X)",
  "Written by a 4-year TJC surveyor with 200+ facility inspections",
  "Exportable: share with medical director, CNO, or consulting team",
];



export default function VeritaScanPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaScan™</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Self-Inspection & Compliance Audit Tool
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Assess your laboratory the way a Joint Commission, CAP, or CMS surveyor would. Domain by domain, standard by standard."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                168 compliance questions. Triple-mapped to TJC CAMLAB 2024, CAP checklists, and 42 CFR Part 493. Built by a former TJC laboratory surveyor who has conducted inspections at more than 200 facilities.
              </p>

              {/* Pricing */}
              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Included</div>
                  <div className="text-xs text-muted-foreground">in Waived ($499/yr) and above</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Link href="/veritascan-app">Launch VeritaScan <ChevronRight size={15} className="ml-1" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/login">Sign In / Create Account</Link>
                </Button>
              </div>
            </div>

            {/* Right: visual */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                  <Shield size={40} className="text-white/80 mb-4" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    VeritaScan™
                  </div>
                  <div className="text-sm text-white/70 text-center mb-4">Self-Inspection &<br />Compliance Audit Tool</div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-xs text-white/60 text-center">TJC · CAP · 42 CFR §493</div>
                  <div className="text-xs text-white/60 text-center mt-1">168 Compliance Items</div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-5">
              <h2 className="font-serif text-3xl font-bold">What is VeritaScan?</h2>
              <p className="text-muted-foreground leading-relaxed">
                Every non-waived laboratory in the United States operates under the same fundamental anxiety: the survey is coming. Whether it arrives from The Joint Commission, the College of American Pathologists, or CMS directly, the inspector will walk through your laboratory domain by domain, standard by standard, and they will find what you haven't looked for.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaScan gives laboratory directors, quality managers, and compliance consultants the same structured lens a surveyor uses, before the surveyor arrives. Each of the 168 compliance questions is mapped to the specific TJC Standard and Element of Performance from the 2024 CAMLAB, the corresponding CAP checklist requirement number, and the applicable 42 CFR Part 493 regulation. This makes VeritaScan more than a checklist. It is a roadmap for understanding why each item is required and exactly where to look when you need to verify it.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                The compliance dashboard updates in real time as you complete your assessment. IMMEDIATE ACTION findings are flagged separately so the highest-priority gaps are never buried in a list of lower-risk items. The result is a document you can take to your medical director, your CNO, or your accreditation body as evidence of proactive self-assessment.
              </p>
              <p className="text-base font-semibold text-foreground">
                Written by a former TJC laboratory surveyor. Used from the same vantage point as an inspection, because it was built from one.
              </p>
            </div>

            {/* Standards mapped */}
            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Standards Referenced</div>
              {STANDARDS.map((s, i) => (
                <div key={i} className="bg-muted/30 border border-border rounded-xl p-4">
                  <div className="font-semibold text-sm mb-1">{s.name}</div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              ))}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mt-2">
                <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1">⚠️ Disclaimer</div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  VeritaScan is an internal self-inspection aid. It does not substitute for official accreditation review, regulatory inspection, or legal counsel. TJC standards are copyright © The Joint Commission. CAP checklist content is copyright © College of American Pathologists.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What's Included</h2>
          <p className="text-muted-foreground mb-8">Everything in one workbook. No assembly required.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10 domains */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">10 Domains, 168 Items</h2>
          <p className="text-muted-foreground mb-8">Every domain a surveyor will inspect. No gaps.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {DOMAINS.map((d, i) => (
              <div key={i} className="border border-border rounded-xl p-4 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">{d.num}</span>
                  </div>
                  <div>
                    <div className="font-semibold text-sm mb-0.5">{d.label}</div>
                    <div className="text-xs text-primary font-medium mb-1">{d.items} items</div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{d.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Status key */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">How It Works</h2>
          <p className="text-muted-foreground mb-8">Four status levels. Each one actionable.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { status: "COMPLIANT", color: "bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400",
                desc: "Requirement is fully met. Documentation is current, accessible, and reflects actual practice." },
              { status: "NEEDS ATTENTION", color: "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400",
                desc: "A gap exists. No immediate patient safety risk, but corrective action required before the next survey." },
              { status: "IMMEDIATE ACTION", color: "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400",
                desc: "A significant deficiency that could result in a citation or patient safety event. Act now." },
              { status: "N/A", color: "bg-muted border-border text-muted-foreground",
                desc: "Does not apply to this laboratory's scope, patient population, or facility type." },
            ].map((s, i) => (
              <div key={i} className={`border rounded-xl p-4 ${s.color}`}>
                <div className="font-bold text-xs mb-2">{s.status}</div>
                <p className="text-xs leading-relaxed opacity-80">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Pricing</h2>
          <p className="text-muted-foreground mb-8">One plan. Everything included. Far less than a single consultant day.</p>
          <div className="max-w-md">
            <Card className="border-2 border-primary bg-primary/5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-emerald-500 text-white border-0">Now Live</Badge>
              </div>
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">VeritaScan™</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-bold">Included</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Included in all VeritaAssure&#8482; plans (starting at $499/yr). Full web access to all 168 checklist items across 10 domains, with Excel export included.
                </p>
                <ul className="space-y-2 mb-6">
                  {[
                    "All 168 items across 10 domains",
                    "Assign owner and due dates per item",
                    "Auto-save progress",
                    "PDF reports (executive summary + full detail)",
                    "Excel export included: download your full scan at any time",
                    "Always current standards",
                    "Integrates with VeritaCheck",
                  ].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/veritascan-app" className="block w-full bg-primary hover:bg-primary/90 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground text-center transition-colors">
                  Launch VeritaScan →
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Bundle callout */}
          <div className="mt-6 max-w-2xl">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex items-start gap-4">
              <FlaskConical size={20} className="text-primary mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-sm mb-1">
                  VeritaAssure&#8482; Suite: <span className="text-primary">Starting at $499/year</span>
                  <Badge className="ml-2 bg-primary/10 text-primary border-0 text-xs">Best Value</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  VeritaCheck™ + VeritaScan™ + VeritaMap™: the complete clinical laboratory regulatory compliance platform. One subscription, full access.
                </p>
                <Link href="/veritacheck#pricing" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                  View all plans <ChevronRight size={13} />
                </Link>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-5">
            Questions?{" "}
            <a href="mailto:info@veritaslabservices.com?subject=VeritaScan Purchase Inquiry" className="text-primary hover:underline">
              Contact us
            </a>{" "}
            - we're happy to help.
          </p>
        </div>
      </section>

      {/* Who it's for */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Who This Is For</h2>
          <p className="text-muted-foreground mb-8">Any non-waived laboratory preparing for or maintaining accreditation.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Laboratory Directors", desc: "You own the CLIA certificate and the regulatory exposure. Know what the surveyor will find before they arrive." },
              { title: "Quality Managers", desc: "Run a structured mock survey on your own schedule. Document findings, assign owners, and track corrective actions to closure." },
              { title: "Lab Compliance Consultants", desc: "Use VeritaScan as your structured assessment framework with clients. Consistent, defensible, citation-mapped." },
              { title: "New Lab Administrators", desc: "You inherited a lab with an unknown compliance posture. VeritaScan tells you where you stand within hours." },
              { title: "Survey-Prep Teams", desc: "In the 90-day survey window? Work through each domain systematically and document your readiness." },
              { title: "Multi-Site Lab Systems", desc: "Apply the same structured assessment across all facilities for consistent compliance monitoring." },
            ].map((item, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <div className="font-semibold text-sm mb-1.5">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding">
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-2xl font-bold mb-3">Ready to assess your lab?</h2>
          <p className="text-muted-foreground mb-6">
            VeritaScan is live. Sign in and run your first self-inspection today.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritascan-app">Launch VeritaScan <ChevronRight size={15} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In / Create Account</Link>
            </Button>
          </div>
          <div className="mt-6">
            <Link href="/veritacheck" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <FlaskConical size={14} />
              Also try VeritaCheck - EP studies
              <ChevronRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
