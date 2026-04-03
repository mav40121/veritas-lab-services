import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ChevronRight, Users, FileText, UserCheck, Building2, AlertTriangle } from "lucide-react";

const FEATURES = [
  "Complete staff roster with credentials, hire dates, and qualification tracking",
  "CLIA role assignments: LD, CC, TC, TS, GS, TP with specialty coverage",
  "CMS 209 Laboratory Personnel Report auto-generation (pre-filled PDF)",
  "Competency timeline engine: Initial, 6-month, 1st Annual, Annual milestones",
  "TJC, CAP, COLA, CLIA-only, and NYS timeline rule sets built in",
  "TC/TS specialty mapping with all 17 CMS specialty categories",
  "VeritaMap integration: import departments and suggest TC/TS specialties",
  "High and moderate complexity role logic with proper separation",
  "Early completion recalculates due dates from actual completion date",
  "Written by a former TJC laboratory surveyor with 200+ facility inspections",
];

const FEATURE_CARDS = [
  {
    icon: Users,
    title: "Staff Roster",
    desc: "Manage your lab's personnel with credentials, qualifications, hire dates, and complexity levels. Track active and inactive staff in one place.",
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
  },
  {
    icon: FileText,
    title: "CMS 209 Auto-Generation",
    desc: "Generate a pre-filled CMS 209 Laboratory Personnel Report from your staff data. One row per specialty per person, exactly as CMS requires.",
    color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    icon: UserCheck,
    title: "Competency Timeline Tracking",
    desc: "Calculate and track competency milestones: Initial (TJC/CAP), 6-month, 1st Annual, and Annual. Rules adjust automatically based on your accreditor.",
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  },
];

export default function VeritaStaffPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Building2 size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaStaff{"™"}</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Laboratory Personnel Management
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Staff roster, CLIA role assignments, competency scheduling, and CMS 209 generation: all in one place."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Every CLIA-certified laboratory must maintain accurate personnel records and demonstrate that staff qualifications match their assigned roles and testing responsibilities. Whether your lab holds a certificate of compliance, accreditation (TJC, CAP, COLA), or operates under CLIA only, VeritaStaff{"™"} manages the complete lifecycle: from hire-date onboarding through competency milestone tracking to CMS 209 report generation.
              </p>

              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Included</div>
                  <div className="text-xs text-muted-foreground">in Waived ($499/yr) and above</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Link href="/veritastaff-app">Launch VeritaStaff{"™"} <ChevronRight size={15} className="ml-1" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/login">Sign In / Create Account</Link>
                </Button>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                  <Building2 size={40} className="text-white/80 mb-4" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    VeritaStaff{"™"}
                  </div>
                  <div className="text-sm text-white/70 text-center mb-4">Laboratory Personnel<br />Management</div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-xs text-white/60 text-center">42 CFR {"\u00B7"} CMS 209</div>
                </div>
                <div className="absolute -bottom-3 -right-3 w-16 h-16 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg">
                  <Shield size={28} className="text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* In Progress Banner */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6">
        <div className="bg-amber-50 border border-amber-400 text-amber-800 rounded-lg px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">
            VeritaStaff{"™"} is actively being developed and refined. You may access and use all features, but some functionality is still being improved. We appreciate your patience.
          </p>
        </div>
      </div>

      {/* Three Feature Cards */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-3">What VeritaStaff{"™"} Does</h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-10">
              Three core functions that cover your personnel management requirements from hire to annual competency review.
            </p>
            <div className="grid md:grid-cols-3 gap-6">
              {FEATURE_CARDS.map((card) => (
                <Card key={card.title} className={`border ${card.color.split(" ").slice(1).join(" ")}`}>
                  <CardContent className="p-6">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-4 ${card.color.split(" ").slice(1, 3).join(" ")}`}>
                      <card.icon size={20} className={card.color.split(" ")[0]} />
                    </div>
                    <h3 className="font-semibold text-lg mb-2">{card.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{card.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CLIA Roles */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="container-default">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-3">CLIA Role Assignments</h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-8">
              VeritaStaff{"™"} enforces correct role assignment rules so your CMS 209 is always accurate.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { code: "LD", name: "Laboratory Director", desc: "Overall responsibility. Not listed as CC, TC, TS, or GS." },
                { code: "CC", name: "Clinical Consultant", desc: "Provides clinical consultation. Delegated by LD." },
                { code: "TC", name: "Technical Consultant", desc: "Moderate complexity oversight. Specialty number required." },
                { code: "TS", name: "Technical Supervisor", desc: "High complexity oversight. Specialty number required." },
                { code: "GS", name: "General Supervisor", desc: "Day-to-day supervision of high complexity testing." },
                { code: "TP", name: "Testing Personnel", desc: "Anyone performing patient testing. Needs competency record." },
              ].map((role) => (
                <Card key={role.code}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="font-mono font-bold text-primary border-primary/30">{role.code}</Badge>
                      <span className="font-semibold text-sm">{role.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{role.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Key Features */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="max-w-4xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-8">Key Features</h2>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
              {FEATURES.map((f) => (
                <div key={f} className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-muted-foreground leading-relaxed">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="container-default">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-10">How It Works</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { step: "1", title: "Set Up Your Lab", desc: "Enter your CLIA number, accreditation body, and testing complexity. Optionally import departments from VeritaMap." },
                { step: "2", title: "Add Staff", desc: "Enter each employee with credentials, qualifications, and hire date. Assign CLIA roles and specialties." },
                { step: "3", title: "Track Competency", desc: "VeritaStaff calculates due dates based on your accreditor's rules. Mark completions and the timeline auto-updates." },
                { step: "4", title: "Generate CMS 209", desc: "Click one button to produce a pre-filled CMS 209 PDF, ready for the laboratory director's signature." },
              ].map((s) => (
                <div key={s.step} className="text-center">
                  <div className="w-12 h-12 rounded-full bg-primary text-primary-foreground font-bold text-xl flex items-center justify-center mx-auto mb-3">
                    {s.step}
                  </div>
                  <h3 className="font-semibold mb-1">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding">
        <div className="container-default text-center">
          <h2 className="font-serif text-3xl font-bold mb-4">Ready to manage your lab personnel?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Set up your roster, assign CLIA roles, and generate your CMS 209 in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritastaff-app">Launch VeritaStaff{"™"} <ChevronRight size={15} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In / Create Account</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
