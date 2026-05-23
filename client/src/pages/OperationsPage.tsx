import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  BarChart3, TrendingUp, Clock, Activity, Boxes, Calculator,
  ChevronRight, Play,
} from "lucide-react";

const MODULES = [
  {
    href: "/calculator",
    label: "VeritaBench™",
    desc: "Free quick benchmarking tool",
    detail:
      "One-page benchmarking against published productivity targets. Free. No sign-in. Designed for a quick pulse check on whether your lab's billable tests per paid hour fall inside, above, or below the published benchmark.",
    badge: "Live",
    badgeColor: "emerald",
    icon: BarChart3,
    color: "text-teal-600 bg-teal-500/10 border-teal-500/20",
  },
  {
    href: "/veritabench",
    label: "VeritaPace™",
    desc: "Monthly data and trends",
    detail:
      "Month-over-month productivity tracking with billable tests, paid hours, FTE, overtime, and trend lines. Built for lab managers who report up to the C-suite on operational performance.",
    badge: "Live",
    badgeColor: "emerald",
    icon: TrendingUp,
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
  },
  {
    href: "/veritabench/staffing",
    label: "VeritaShift™",
    desc: "By-hour demand analysis",
    detail:
      "Hour-by-hour workload analysis for shift design and FTE planning. Shows where staffed capacity matches demand and where the gaps are. Useful for justifying coverage decisions to administration.",
    badge: "Live",
    badgeColor: "emerald",
    icon: Clock,
    color: "text-purple-600 bg-purple-500/10 border-purple-500/20",
  },
  {
    href: "/veritabench/pi",
    label: "VeritaQA™",
    desc: "Department quality metrics",
    detail:
      "Performance Improvement dashboard for department-level quality indicators. Track metric trends, targets, and corrective actions. Designed to satisfy PI requirements without the spreadsheet burden.",
    badge: "Live",
    badgeColor: "emerald",
    icon: Activity,
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  },
  {
    href: "/veritastock",
    label: "VeritaStock™",
    desc: "Reagent and supply tracking",
    detail:
      "Lot tracking, expiration alerts, calculated par levels, FIFO rotation prompts, and burn-rate-based reorder triggers. Built to replace the spreadsheets most labs use today for inventory.",
    badge: "Live",
    badgeColor: "emerald",
    icon: Boxes,
    color: "text-orange-600 bg-orange-500/10 border-orange-500/20",
  },
  {
    href: "/veritaops-app",
    label: "VeritaOps™",
    desc: "Cost per reportable test (CPRT)",
    detail:
      "Layered cost-per-reportable-test calculator: reagents and supplies, plus staff time, with capital depreciation and overhead as opt-in layers. Built on CLSI GP11-A cost accounting principles. Answers the build vs buy and the charge-master questions with transparent math the laboratory director can defend.",
    badge: "Live",
    badgeColor: "emerald",
    icon: Calculator,
    color: "text-teal-600 bg-teal-500/10 border-teal-500/20",
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

export default function OperationsPage() {
  const { isLoggedIn } = useAuth();
  useSEO({
    title: "Operations | VeritaBench, VeritaPace, VeritaShift, VeritaQA, VeritaStock, VeritaOps",
    description: "Operational tools for clinical laboratories: productivity benchmarking, monthly trend tracking, by-hour demand analysis, department quality metrics, and reagent and supply tracking.",
  });
  return (
    <div className="min-h-screen bg-background">

      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/4 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <Badge
            variant="outline"
            className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium"
          >
            Operations
          </Badge>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
            Operations
          </h1>
          <p className="text-xl text-primary font-semibold mb-3">
            The operational side of running a clinical laboratory.
          </p>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mb-8">
            Productivity benchmarking, monthly trend tracking, shift-level demand analysis, department quality metrics, and reagent and supply management. The tools you use when the question is not whether the lab is compliant, but whether the lab is running well.
          </p>
          {!isLoggedIn && (
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
          )}
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 space-y-16">

        {/* Module Grid */}
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-6">
            The Modules
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <Link key={m.href} href={m.href}>
                  <Card className="cursor-pointer hover:border-primary/40 hover:shadow-md transition-all h-full">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-10 h-10 rounded-lg border flex items-center justify-center ${m.color}`}>
                          <Icon size={18} />
                        </div>
                        <BadgePill label={m.badge} color={m.badgeColor} />
                      </div>
                      <div className="font-semibold text-base mb-1">{m.label}</div>
                      <div className="text-xs text-primary mb-2">{m.desc}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{m.detail}</p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>

      </div>
    </div>
  );
}
