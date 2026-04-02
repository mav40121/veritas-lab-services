import { useEffect } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2, Clock, Circle, ArrowRight, Settings, Map,
  FlaskConical, ClipboardCheck, Users, Award, FileText, Mail, Download, Shield,
} from "lucide-react";

interface OnboardingStatus {
  onboarding_seen: boolean;
  steps: {
    clia_entered: boolean;
    map_created: boolean;
    study_created: boolean;
    scan_started: boolean;
    comp_created: boolean;
    staff_added: boolean;
    cert_entered: boolean;
  };
  completed_count: number;
  total_count: number;
}

const STEPS = [
  {
    key: "clia_entered" as const,
    number: 1,
    title: "Enter your CLIA Number",
    description: "Ties your account to your lab and puts your CLIA number on every compliance report you generate.",
    time: "2 minutes",
    buttonLabel: "Go to Account Settings",
    route: "/account/settings",
    icon: Settings,
  },
  {
    key: "map_created" as const,
    number: 2,
    title: "Build your VeritaMap™",
    description: "Map your instruments and test menu. VeritaMap feeds your competency programs, study instrument selection, and inspection checklist.",
    time: "15 minutes",
    buttonLabel: "Open VeritaMap™",
    route: "/veritamap-app",
    icon: Map,
  },
  {
    key: "study_created" as const,
    number: 3,
    title: "Run your first EP Study",
    description: "Run a method comparison or calibration verification. Both are required every 6 months for every non-waived test.",
    time: "10 minutes",
    buttonLabel: "Run a Study",
    route: "/veritacheck",
    icon: FlaskConical,
  },
  {
    key: "scan_started" as const,
    number: 4,
    title: "Complete VeritaScan™",
    description: "Walk through 168 TJC and CAP inspection standards. Know exactly where you stand before a surveyor arrives.",
    time: "30 minutes",
    buttonLabel: "Open VeritaScan™",
    route: "/veritascan-app",
    icon: ClipboardCheck,
  },
  {
    key: "comp_created" as const,
    number: 5,
    title: "Set up VeritaComp™",
    description: "Create a competency program using your VeritaMap instruments. All three CLIA competency types in one place.",
    time: "15 minutes",
    buttonLabel: "Open VeritaComp™",
    route: "/veritacomp-app",
    icon: Award,
  },
  {
    key: "staff_added" as const,
    number: 6,
    title: "Add your staff in VeritaStaff™",
    description: "Build your employee roster with CLIA role assignments. Track competency timelines for every testing personnel.",
    time: "10 minutes",
    buttonLabel: "Open VeritaStaff™",
    route: "/veritastaff-app",
    icon: Users,
  },
  {
    key: "cert_entered" as const,
    number: 7,
    title: "Confirm your CLIA certificate expiration date",
    description: "Your CLIA certificate was auto-populated from your account setup. Open VeritaLab™ to enter the expiration date and activate renewal reminders at 9 months, 6 months, 3 months, and 30 days.",
    time: "2 minutes",
    buttonLabel: "Open VeritaLab™",
    route: "/veritalab-app",
    icon: FileText,
  },
];

function StepStatusBadge({ complete }: { complete: boolean }) {
  if (complete) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/25 hover:bg-emerald-500/15">
        <CheckCircle2 size={12} className="mr-1" /> Complete
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Circle size={12} className="mr-1" /> Not Started
    </Badge>
  );
}

export default function GettingStartedPage() {
  const { isLoggedIn } = useAuth();

  const { data: status, isLoading } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: isLoggedIn,
  });

  // Mark onboarding as seen when visiting this page
  useEffect(() => {
    if (isLoggedIn && status && !status.onboarding_seen) {
      apiRequest("POST", "/api/onboarding/seen").catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    }
  }, [isLoggedIn, status]);

  if (!isLoggedIn) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-4">Getting Started with VeritaAssure&#8482;</h1>
        <p className="text-muted-foreground mb-6">Sign in to access your onboarding checklist.</p>
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    );
  }

  const completedCount = status?.completed_count ?? 0;
  const totalCount = status?.total_count ?? 7;
  const pct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Getting Started with VeritaAssure&#8482;</h1>
        <p className="text-muted-foreground mt-1">
          Follow these steps to set up your lab. Most labs are fully configured in under an hour.
        </p>

        {/* Progress bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium">{completedCount} of {totalCount} steps complete</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <Progress value={pct} className="h-2.5 [&>div]:bg-primary" />
        </div>
      </div>

      {/* Step Cards */}
      <div className="space-y-4">
        {STEPS.map((step) => {
          const complete = status?.steps?.[step.key] ?? false;
          const Icon = step.icon;
          return (
            <Card key={step.key} className={complete ? "border-emerald-500/30 bg-emerald-500/5" : ""}>
              <CardContent className="p-5 flex items-start gap-4">
                {/* Step number */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${
                  complete
                    ? "bg-emerald-500/20 text-emerald-600"
                    : "bg-primary/10 text-primary"
                }`}>
                  {complete ? <CheckCircle2 size={20} /> : step.number}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-sm">{step.title}</h3>
                    <StepStatusBadge complete={complete} />
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-muted-foreground">
                    <Clock size={11} />
                    <span>{step.time}</span>
                  </div>
                </div>

                {/* Action button */}
                <div className="shrink-0 self-center">
                  {complete ? (
                    <Button asChild variant="outline" size="sm" className="border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10">
                      <Link href={step.route}>
                        <Icon size={13} className="mr-1.5" />
                        {step.buttonLabel}
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                      <Link href={step.route}>
                        <Icon size={13} className="mr-1.5" />
                        {step.buttonLabel}
                        <ArrowRight size={13} className="ml-1" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Free Downloads */}
      <div className="mt-8 rounded-xl border border-primary/20 bg-card p-6">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Free Downloads</div>
        <p className="text-sm text-muted-foreground mb-4">
          Download these two documents to validate and deploy VeritaCheck&#8482; for compliance documentation. No login required.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield size={15} className="text-primary shrink-0" />
              <span className="font-semibold text-sm">CLSI Compliance Matrix</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              One-page reference mapping all 6 VeritaCheck&#8482; study types to CLSI, CLIA, CAP, and TJC standards.
            </p>
            <a
              href="/api/downloads/clsi-compliance-matrix"
              download="VeritaCheck_CLSI_Compliance_Matrix.pdf"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <Download size={13} /> Download PDF
            </a>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 size={15} className="text-primary shrink-0" />
              <span className="font-semibold text-sm">Software Validation Template</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3">
              Validate VeritaCheck&#8482; for compliance documentation before placing it into service. Satisfies CAP GEN.20316 and CLIA 493.1251.
            </p>
            <a
              href="/api/downloads/software-validation-template"
              download="VeritaCheck_Software_Validation_Template.pdf"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              <Download size={13} /> Download PDF
            </a>
          </div>
        </div>
      </div>

      {/* Bottom CTA */}
      <div className="mt-8 rounded-xl bg-primary/10 border border-primary/20 p-6 text-center">
        <p className="text-sm leading-relaxed mb-4">
          Need help getting started? Your plan includes a complimentary 1-hour onboarding session
          via Zoom or Teams with a VeritaAssure&#8482; specialist.
        </p>
        <Button asChild className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <a href="mailto:info@veritaslabservices.com?subject=Onboarding Session Request">
            <Mail size={14} className="mr-1.5" />
            Schedule Onboarding Session
          </a>
        </Button>
      </div>
    </div>
  );
}
