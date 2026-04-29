import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ChevronRight, FileText, ToggleLeft, BarChart2, BookOpen } from "lucide-react";

const FEATURE_CARDS = [
  {
    icon: FileText,
    title: "88 TJC Requirements Pre-Loaded",
    desc: "Every policy required by The Joint Commission for laboratory accreditation, organized by chapter. Updated from the January 2024 Comprehensive Accreditation Manual.",
    color: "text-teal-600 bg-teal-500/10 border-teal-500/20",
  },
  {
    icon: ToggleLeft,
    title: "Per-Requirement N/A Control",
    desc: "Not all policies apply to every lab. Mark individual requirements or entire categories as N/A with one click. Bulk actions make it fast to configure your lab's scope.",
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
  },
  {
    icon: BookOpen,
    title: "Policy Library",
    desc: "Build your lab's policy library. One policy can satisfy multiple TJC requirements. Track owner, status, review dates, and upload the actual policy document.",
    color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
    comingSoon: true,
  },
  {
    icon: BarChart2,
    title: "Readiness Score",
    desc: "See your inspection readiness at a glance. Track completion across all 13 TJC chapters. Generate an inspector-ready compliance report with one click.",
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  },
];

const FEATURES = [
  "All 88 TJC-required laboratory policies pre-loaded and organized by chapter",
  "Bulk N/A actions: mark an entire category as N/A with one click, or mark individual requirements",
  "Status tracking per requirement: Not Started, In Progress, Complete, N/A",
  "Link one policy document to multiple TJC requirements",
  "Policy library with owner, policy number, review dates, and document upload",
  "Automated review date warnings: 90 days out (amber) and overdue (red)",
  "Readiness score showing % of applicable requirements complete",
  "PDF inspection report: summary on page 1, requirements by chapter, policy index",
  "Laboratory Director or Designee review signature block on all reports",
  "CLIA number on every report, auto-populated from your account",
  "Covers all 13 TJC chapters: APR, DC, EC, EM, HR, IC, IM, LD, PI, QSA, SE, TS, WT",
  "Built by a credentialed MLS(ASCP), CPHQ with direct TJC accreditation experience",
];

export default function VeritaPolicyPage() {
    useSEO({ title: "VeritaPolicy™ | Laboratory Policy and Procedure Management Software", description: "Version-controlled policy and procedure management for clinical laboratories. Track staff acknowledgments, manage document review cycles, and stay survey-ready." });
return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Shield size={20} className="text-primary" />
                <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5">
                  New
                </Badge>
              </div>
              <h1 className="text-4xl font-bold text-foreground mb-4">
                VeritaPolicy&#8482;
              </h1>
              <p className="text-xl text-muted-foreground mb-2 font-medium">
                TJC Policy Compliance Tracker
              </p>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Track all 88 policies required by The Joint Commission for laboratory accreditation.
                Build your policy library, link documents to requirements, and generate an
                inspector-ready compliance report with one click.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/veritapolicy-app">
                  <Button size="lg" className="gap-2">
                    Open VeritaPolicy&#8482; <ChevronRight size={16} />
                  </Button>
                </Link>
                <Link href="/pricing">
                  <Button size="lg" variant="outline">
                    View Pricing
                  </Button>
                </Link>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="bg-card border border-border rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">Readiness Score</span>
                  <span className="text-2xl font-bold text-primary">68%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-3">
                  <div className="bg-primary h-3 rounded-full" style={{ width: "68%" }} />
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  {[
                    { label: "Complete", value: "42", color: "text-green-600" },
                    { label: "In Progress", value: "18", color: "text-amber-600" },
                    { label: "Not Started", value: "2", color: "text-muted-foreground" },
                  ].map((s) => (
                    <div key={s.label} className="text-center p-2 bg-muted/40 rounded-lg">
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                      <div className="text-xs text-muted-foreground">{s.label}</div>
                    </div>
                  ))}
                </div>
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">QSA.02.10.01 - Method Validation</span>
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">Complete</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground">HR.01.06.01 - Staff Competency</span>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">In Progress</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground">LD.03.01.01 - Culture of Safety</span>
                    <Badge className="bg-muted text-muted-foreground text-xs">Not Started</Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="py-16 border-b border-border">
        <div className="container-default">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold text-foreground mb-3">Built for TJC-Accredited Labs</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every requirement from the January 2024 Comprehensive Accreditation Manual for Laboratory
              and Point-of-Care Testing, organized and ready to track.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {FEATURE_CARDS.map((card) => (
              <Card key={card.title} className="border-border">
                <CardContent className="pt-6">
                  <div className={`w-10 h-10 rounded-lg border flex items-center justify-center mb-4 ${card.color}`}>
                    <card.icon size={20} />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-foreground">{card.title}</h3>
                    {card.comingSoon && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide border-amber-500/40 text-amber-600 bg-amber-500/10">Coming Soon</Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{card.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Full feature list */}
      <section className="py-16 border-b border-border bg-muted/30">
        <div className="container-default">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl font-bold text-foreground mb-8 text-center">Everything Included</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {FEATURES.map((f) => (
                <div key={f} className="flex items-start gap-3">
                  <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
                  <span className="text-sm text-muted-foreground leading-relaxed">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container-default text-center">
          <h2 className="text-2xl font-bold text-foreground mb-4">Ready for your next TJC survey?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            VeritaPolicy&#8482; is included with all paid VeritaAssure&#8482; plans. No additional cost.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/veritapolicy-app">
              <Button size="lg" className="gap-2">
                Open VeritaPolicy&#8482; <ChevronRight size={16} />
              </Button>
            </Link>
            <Link href="/pricing">
              <Button size="lg" variant="outline">View Plans</Button>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
