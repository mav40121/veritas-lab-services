import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ChevronRight, Users, ClipboardCheck, FlaskConical, BookOpen, Stethoscope, AlertTriangle } from "lucide-react";

const COMPETENCY_TYPES = [
  {
    title: "Technical Competency",
    standard: "HR.01.06.01 EP 18",
    cfr: "42 CFR \u00A7493.1451",
    cap: "CAP GEN.55500",
    icon: FlaskConical,
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
    desc: "Non-waived testing staff. 6 CLIA-required assessment methods \u00D7 method groups (instruments from your VeritaMap). Semiannual in year 1, annual thereafter.",
    methods: [
      "Direct observation of routine patient test performance",
      "Monitoring recording and reporting of test results",
      "Review of QC, PT, and maintenance records",
      "Direct observation of instrument maintenance and calibration",
      "Test performance (blind specimens, PT samples)",
      "Evaluation of problem-solving skills",
    ],
  },
  {
    title: "Waived Testing Competency",
    standard: "WT.03.01.01 EP 5",
    cfr: "42 CFR \u00A7493.15",
    cap: "CAP GEN.55500",
    icon: Stethoscope,
    color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
    desc: "Staff performing waived tests. 2 of 4 methods required per test. Assessed at orientation and annually thereafter.",
    methods: [
      "Blind specimen testing",
      "Periodic observation by supervisor",
      "Monitoring of QC performance",
      "Written test specific to the test assessed",
    ],
  },
  {
    title: "Non-Technical Competency",
    standard: "HR.01.06.01 EP 5/6",
    cfr: "42 CFR \u00A7493.1235",
    cap: "CAP GEN.54500",
    icon: BookOpen,
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    desc: "Phlebotomy, specimen processing, LIS, maintenance, and other non-testing duties. Free-format checklist defined by the lab director. Assessed at orientation and every 2 years.",
    methods: [],
  },
];

const FEATURES = [
  "Three competency types in one system: technical, waived, and non-technical",
  "6-method \u00D7 method-group matrix for technical competency (EP 18)",
  "VeritaMap integration: auto-import instruments and suggest method groups",
  "Employee roster with hire date, LIS initials, and status tracking",
  "Pre-populated department checklists (Chemistry, Phlebotomy, Hematology, Microbiology)",
  "Assessment history per employee with due-date tracking",
  "PDF reports with signature on page 1, matrix/checklist at end, Pass/Fail verdict",
  "VeritaScan integration: completed assessments auto-check Domain IX items",
  "Remediation tracking with action plans and timelines",
  "Written by a former TJC laboratory surveyor with 200+ facility inspections",
];

export default function VeritaCompPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Users size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaComp{"\u2122"}</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                TJC/CLIA/CAP Competency Assessment Management
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Manage all three competency types, technical, waived, and non-technical, in one system, linked directly to your test menu."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Every non-waived laboratory must demonstrate staff competency using the 6 CLIA-required methods. Every facility performing waived testing must document 2-of-4 methods per test. And every lab must assess non-technical duties at orientation and biennially.
                Whether your lab is accredited by TJC, CAP, COLA, or operates under CLIA only, VeritaComp{"\u2122"} provides the documentation framework your surveyors expect, with direct integration to VeritaMap{"\u2122"} for automatic instrument and method group setup.
              </p>

              {/* Pricing */}
              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Included</div>
                  <div className="text-xs text-muted-foreground">in Professional ($599/yr) and above</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Link href="/veritacomp-app">Launch VeritaComp{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
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
                  <Users size={40} className="text-white/80 mb-4" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    VeritaComp{"\u2122"}
                  </div>
                  <div className="text-sm text-white/70 text-center mb-4">TJC/CLIA/CAP Competency<br />Assessment Management</div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-xs text-white/60 text-center">HR.01.06.01 {"\u00B7"} WT.03.01.01</div>
                  <div className="text-xs text-white/60 text-center mt-1">3 Types {"\u00B7"} 1 System</div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WIP Banner */}
      <div className="bg-amber-50 dark:bg-amber-950/30 border-y border-amber-400/50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed">
            VeritaComp{"\u2122"} is currently in active development. You may access the module and explore its features, but some functionality is still being refined. Thank you for your patience as we build this out.
          </p>
        </div>
      </div>

      {/* Three competency types */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Three Competency Types. One System.</h2>
          <p className="text-muted-foreground mb-8">TJC, CLIA, and CAP require different assessment methods for different staff roles. VeritaComp{"\u2122"} handles all three.</p>
          <div className="grid lg:grid-cols-3 gap-6">
            {COMPETENCY_TYPES.map((ct, i) => (
              <Card key={i} className="border-2 hover:border-primary/30 transition-colors">
                <CardContent className="p-5">
                  <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg border mb-3 ${ct.color}`}>
                    <ct.icon size={20} />
                  </div>
                  <h3 className="font-bold text-base mb-1">{ct.title}</h3>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px]">{ct.standard}</Badge>
                    <Badge variant="outline" className="text-[10px]">{ct.cfr}</Badge>
                    <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20">{ct.cap}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">{ct.desc}</p>
                  {ct.methods.length > 0 && (
                    <ul className="space-y-1">
                      {ct.methods.map((m, j) => (
                        <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <CheckCircle2 size={11} className="text-primary mt-0.5 shrink-0" />
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Training Angle */}
      <section className="section-padding border-b border-border bg-primary/5">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-4">VeritaComp Teaches the Six CLIA Elements</h2>
          <p className="text-muted-foreground leading-relaxed max-w-3xl">
            Most staff who complete competency assessments have never read 42 CFR 493.1451. They fill out the form because their supervisor told them to. VeritaComp shows them why each element exists. A supervisor building their first competency program in VeritaComp learns the regulatory basis for each field they complete. That understanding is what distinguishes a compliant lab from an inspection-ready one.
          </p>
        </div>
      </section>

      {/* What it does */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What is VeritaComp{"\u2122"}?</h2>
          <div className="grid lg:grid-cols-2 gap-10">
            <div className="space-y-4">
              <p className="text-muted-foreground leading-relaxed">
                Competency assessment is one of the most frequently cited deficiencies during TJC and CAP laboratory surveys. The requirement is deceptively simple: demonstrate that every person who touches a patient specimen is competent to do so. The reality is that most labs manage this with a filing cabinet full of paper forms, inconsistent documentation, and no systematic way to know who is due.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaComp{"\u2122"} replaces the filing cabinet. It reads your test menu directly from VeritaMap{"\u2122"}, automatically groups instruments into method groups (because competency is assessed per workflow, not per analyte), and generates the correct assessment form for each staff member: 6-method technical matrix, 2-of-4 waived form, or departmental checklist.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                When an assessment is completed, the system generates a signed PDF report and auto-completes the relevant VeritaScan{"\u2122"} Domain IX items. No dual entry. No missed deadlines. No citations.
              </p>
            </div>
            <div className="space-y-3">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Key Features</div>
              {FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                  <span className="text-muted-foreground">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">How It Works</h2>
          <p className="text-muted-foreground mb-8">Four steps from setup to signed assessment.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: "1", title: "Create Program", desc: "Name your program, choose the department, select the competency type, and optionally link to a VeritaMap." },
              { step: "2", title: "Define Groups", desc: "For technical: define method groups from your instruments. For non-technical: customize the departmental checklist." },
              { step: "3", title: "Add Employees", desc: "Build your employee roster with name, title, hire date, and LIS initials. Reuse across programs." },
              { step: "4", title: "Assess & Sign", desc: "Complete the assessment form, mark Pass/Fail, generate a signed PDF, and auto-update VeritaScan." },
            ].map((s, i) => (
              <div key={i} className="border border-border rounded-xl p-4 bg-card">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <span className="text-sm font-bold text-primary">{s.step}</span>
                </div>
                <div className="font-semibold text-sm mb-1">{s.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Pricing</h2>
          <p className="text-muted-foreground mb-8">One plan. Everything included. Far less than a single consultant day.</p>
          <div className="max-w-md">
            <Card className="border-2 border-primary bg-primary/5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-emerald-500 text-white border-0">Now Live</Badge>
              </div>
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">VeritaComp{"\u2122"}</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-bold">Included</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Included in Professional ($599/yr) and above. Full access to all three competency types with PDF generation, employee management, and VeritaScan integration.
                </p>
                <ul className="space-y-2 mb-6">
                  {[
                    "Technical, Waived, and Non-Technical competency types",
                    "VeritaMap integration for method group auto-setup",
                    "Employee roster management across programs",
                    "PDF reports with signatures and compliance data",
                    "VeritaScan Domain IX auto-completion",
                    "Pre-populated department checklists",
                    "Remediation tracking with action plans",
                  ].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/veritacomp-app" className="block w-full bg-primary hover:bg-primary/90 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground text-center transition-colors">
                  Launch VeritaComp{"\u2122"} {"\u2192"}
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
                  Professional Plan: <span className="text-primary">$599/year for the full suite</span>
                  <Badge className="ml-2 bg-primary/10 text-primary border-0 text-xs">Best Value</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  VeritaCheck{"\u2122"} + VeritaScan{"\u2122"} + VeritaMap{"\u2122"} + VeritaComp{"\u2122"}: the complete clinical laboratory regulatory compliance platform. One subscription, full access.
                </p>
                <Link href="/veritacheck#pricing" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                  View all plans <ChevronRight size={13} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Who This Is For</h2>
          <p className="text-muted-foreground mb-8">Any clinical laboratory managing staff competency documentation.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Laboratory Directors", desc: "You own the CLIA certificate and the competency requirement. Know exactly who is current and who is overdue." },
              { title: "Technical Consultants / Supervisors", desc: "Delegated to assess technical competency? VeritaComp gives you the structured form and documentation trail." },
              { title: "Quality Managers", desc: "Track competency across the lab. Generate reports for accreditation surveys. No filing cabinet required." },
              { title: "Education Coordinators", desc: "Manage orientation competency checklists for new hires across every department." },
              { title: "POCT Coordinators", desc: "Waived testing competency for every nurse, RT, and CNA performing point-of-care tests." },
              { title: "Lab Compliance Consultants", desc: "Standard competency framework across client sites. Consistent, documented, citation-proof." },
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
          <h2 className="font-serif text-2xl font-bold mb-3">Ready to manage competency the right way?</h2>
          <p className="text-muted-foreground mb-6">
            VeritaComp{"\u2122"} is live. Sign in and create your first competency program today.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritacomp-app">Launch VeritaComp{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In / Create Account</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/veritascan" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <Shield size={14} />
              VeritaScan{"\u2122"} - Inspection Readiness
              <ChevronRight size={13} />
            </Link>
            <Link href="/veritamap" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <ClipboardCheck size={14} />
              VeritaMap{"\u2122"} - Test Menu Mapping
              <ChevronRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
