import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ChevronRight, FileText, ToggleLeft, BarChart2, BookOpen } from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { useQuery } from "@tanstack/react-query";

// Accreditor display profiles. Counts and chapters are sourced from the server
// requirement files which are auto-generated from the master citation index.
// Logged-out visitors see the TJC default profile (most common accreditor).
// Logged-in users see the profile that matches their lab's accreditation_choice.
type AccreditorProfile = {
  short: string;
  full: string;
  count: number;
  chapters: string;
  surveyTerm: string;
};

const ACCREDITOR_PROFILES: Record<string, AccreditorProfile> = {
  TJC: {
    short: "TJC",
    full: "The Joint Commission",
    count: 88,
    chapters: "APR, DC, EC, EM, HR, IC, IM, LD, PI, QSA, SE, TS, WT",
    surveyTerm: "TJC survey",
  },
  CAP: {
    short: "CAP",
    full: "College of American Pathologists",
    count: 65,
    chapters: "GEN, COM, CHM, HEM, MIC, IMM, TRM, MOL",
    surveyTerm: "CAP inspection",
  },
  COLA: {
    short: "COLA",
    full: "COLA Inc.",
    count: 81,
    chapters: "QC, GLS, PRE, PT, PST, VER, CA",
    surveyTerm: "COLA survey",
  },
  "CAP+AABB": {
    short: "CAP and AABB",
    full: "College of American Pathologists and AABB",
    count: 65,
    chapters: "GEN, COM, CHM, HEM, MIC, IMM, TRM, MOL",
    surveyTerm: "CAP and AABB inspection",
  },
  CLIA: {
    short: "CLIA",
    full: "Clinical Laboratory Improvement Amendments",
    count: 286,
    chapters: "42 CFR 493 Subparts H, J, K, M",
    surveyTerm: "CLIA survey",
  },
};

const DEFAULT_PROFILE = ACCREDITOR_PROFILES.TJC;

export default function VeritaPolicyPage() {
  const { isLoggedIn } = useAuth();
  useSEO({
    title: "VeritaPolicy™ | Laboratory Policy and Procedure Management Software",
    description: "Version-controlled policy and procedure management for clinical laboratories. Track staff acknowledgments, manage document review cycles, and stay survey-ready.",
  });

  // Pull the lab's accreditation_choice when logged in. Endpoint requires auth,
  // so we only fire it when isLoggedIn is true.
  const { data: accountSettings } = useQuery<{ accreditation_choice?: string }>({
    queryKey: ["/api/account/settings"],
    enabled: isLoggedIn,
  });

  const choice = accountSettings?.accreditation_choice || "TJC";
  const profile = ACCREDITOR_PROFILES[choice] || DEFAULT_PROFILE;

  const FEATURE_CARDS = [
    {
      icon: FileText,
      title: `${profile.count} ${profile.short} Requirements Pre-Loaded`,
      desc: `Every policy required by ${profile.full} for laboratory accreditation, organized by chapter. Mapped to the current ${profile.short} standard for laboratory accreditation.`,
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
      desc: `Build your lab's policy library. One policy can satisfy multiple ${profile.short} requirements. Track owner, status, review dates, and upload the actual policy document.`,
      color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
      comingSoon: true,
    },
    {
      icon: BarChart2,
      title: "Readiness Score",
      desc: `See your inspection readiness at a glance. Track completion across all ${profile.short} chapters. Generate an inspector-ready compliance report with one click.`,
      color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
    },
  ];

  const FEATURES = [
    `All ${profile.count} ${profile.short}-required laboratory policies pre-loaded and organized by chapter`,
    "Bulk N/A actions: mark an entire category as N/A with one click, or mark individual requirements",
    "Status tracking per requirement: Not Started, In Progress, Complete, N/A",
    `Link one policy document to multiple ${profile.short} requirements`,
    "Policy library with owner, policy number, review dates, and document upload",
    "Automated review date warnings: 90 days out (amber) and overdue (red)",
    "Readiness score showing % of applicable requirements complete",
    "PDF inspection report: summary on page 1, requirements by chapter, policy index",
    "Laboratory Director or Designee review signature block on all reports",
    "CLIA number on every report, auto-populated from your account",
    `Covers ${profile.short} chapters: ${profile.chapters}`,
    "Built by a credentialed MLS(ASCP), CPHQ with direct laboratory accreditation experience",
  ];

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
                {profile.short} Policy Compliance Tracker
              </p>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Track all {profile.count} policies required by {profile.full} for laboratory accreditation.
                Build your policy library, link documents to requirements, and generate an
                inspector-ready compliance report with one click.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link href="/veritapolicy-app">
                  <Button size="lg" className="gap-2">
                    Open VeritaPolicy&#8482; <ChevronRight size={16} />
                  </Button>
                </Link>
                {!isLoggedIn && (
                  <Link href="/pricing">
                    <Button size="lg" variant="outline">
                      View Pricing
                    </Button>
                  </Link>
                )}
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
                    <span className="text-muted-foreground">Method Validation</span>
                    <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 text-xs">Complete</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground">Staff Competency</span>
                    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-xs">In Progress</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-2">
                    <span className="text-muted-foreground">Culture of Safety</span>
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
            <h2 className="text-2xl font-bold text-foreground mb-3">Built for {profile.short}-Accredited Labs</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Every requirement from the current {profile.short} standard for laboratory and point-of-care testing,
              organized and ready to track.
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
          <h2 className="text-2xl font-bold text-foreground mb-4">Ready for your next {profile.surveyTerm}?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            VeritaPolicy&#8482; is included with all paid VeritaAssure&#8482; plans. No additional cost.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/veritapolicy-app">
              <Button size="lg" className="gap-2">
                Open VeritaPolicy&#8482; <ChevronRight size={16} />
              </Button>
            </Link>
            {!isLoggedIn && (
              <Link href="/pricing">
                <Button size="lg" variant="outline">View Plans</Button>
              </Link>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
