import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  FlaskConical, Map, ClipboardCheck, Award, Users, FileText,
  ChevronRight, Play, Shield, CalendarDays, TestTubes, ClipboardList,
  Activity, BarChart3, TrendingUp, Clock, Boxes, Calculator, Gauge,
} from "lucide-react";

// Public "Learn VeritaAssure" video library. One short getting-started
// video per module, served same-origin from /public/tutorials/<video>.mp4
// (silent, captioned H.264). Card name + blurb describe what each video
// actually shows, so the library stays self-consistent with the footage.

type LessonModule = {
  video: string;      // filename stem in /public/tutorials
  label: string;      // trademark name shown on the card
  desc: string;       // one line describing what the video shows
  icon: typeof Map;
  color: string;
};

const COMPLIANCE: LessonModule[] = [
  { video: "veritacheck", label: "VeritaCheck™", desc: "Run a verification study and watch the coverage map turn green.", icon: FlaskConical, color: "text-teal-600 bg-teal-500/10 border-teal-500/20" },
  { video: "veritamap", label: "VeritaMap™", desc: "Build your test menu: instruments, analytes, CLIA complexity.", icon: Map, color: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
  { video: "veritascan", label: "VeritaScan™", desc: "See exactly where you stand before a surveyor arrives.", icon: ClipboardCheck, color: "text-purple-600 bg-purple-500/10 border-purple-500/20" },
  { video: "veritatrack", label: "VeritaTrack™", desc: "Your regulatory calendar, imported straight from the map.", icon: CalendarDays, color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/20" },
  { video: "veritapt", label: "VeritaPT™", desc: "Check every analyte against CLIA proficiency-testing rules.", icon: TestTubes, color: "text-cyan-600 bg-cyan-500/10 border-cyan-500/20" },
  { video: "veritacomp", label: "VeritaComp™", desc: "Competency programs across all six CLIA assessment elements.", icon: Award, color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
  { video: "veritapolicy", label: "VeritaPolicy™", desc: "Track required policies and crosswalk each to your accreditor.", icon: Shield, color: "text-teal-600 bg-teal-500/10 border-teal-500/20" },
  { video: "veritastaff", label: "VeritaStaff™", desc: "Personnel roster with CLIA roles and CMS 209 generation.", icon: Users, color: "text-orange-600 bg-orange-500/10 border-orange-500/20" },
  { video: "veritalab", label: "VeritaLab™", desc: "Track certificates, accreditations, and director credentials.", icon: FileText, color: "text-green-600 bg-green-500/10 border-green-500/20" },
  { video: "veritaqc", label: "VeritaQC™", desc: "Daily QC entry with real-time Westgard multi-rule evaluation.", icon: Activity, color: "text-green-600 bg-green-500/10 border-green-500/20" },
  { video: "veritaresponse", label: "VeritaResponse™", desc: "Turn a citation into a tracked Plan of Correction with a clock.", icon: ClipboardList, color: "text-rose-600 bg-rose-500/10 border-rose-500/20" },
];

const OPERATIONS: LessonModule[] = [
  { video: "veritaops", label: "VeritaOps™", desc: "Cost per reportable test, layer by layer.", icon: Calculator, color: "text-teal-600 bg-teal-500/10 border-teal-500/20" },
  { video: "veritastock", label: "VeritaStock™", desc: "Reagent and supply tracking with expiration and par levels.", icon: Boxes, color: "text-orange-600 bg-orange-500/10 border-orange-500/20" },
  { video: "veritabench", label: "VeritaBench™", desc: "Benchmark your productivity against published standards. Free.", icon: BarChart3, color: "text-blue-600 bg-blue-500/10 border-blue-500/20" },
  { video: "veritapace", label: "VeritaPace™", desc: "Track monthly productivity and forecast from a goal.", icon: TrendingUp, color: "text-sky-600 bg-sky-500/10 border-sky-500/20" },
  { video: "veritashift", label: "VeritaShift™", desc: "Build a staffing model shift by shift to your FTE need.", icon: Clock, color: "text-purple-600 bg-purple-500/10 border-purple-500/20" },
  { video: "veritaqa", label: "VeritaQA™", desc: "Quality metrics by department, quarter over quarter.", icon: Gauge, color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
];

function LessonGrid({ modules }: { modules: LessonModule[] }) {
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {modules.map(({ video, label, desc, icon: Icon, color }) => (
        <Card key={video} className="h-full overflow-hidden hover:shadow-md transition-all">
          <div className="bg-muted/40 border-b border-border">
            <video
              controls
              playsInline
              preload="metadata"
              className="w-full aspect-[16/10] bg-black/90"
            >
              <source src={`/tutorials/${video}.mp4`} type="video/mp4" />
            </video>
          </div>
          <CardContent className="p-5">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 ${color}`}>
                <Icon size={15} />
              </div>
              <div className="font-semibold text-sm">{label}</div>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function LearnPage() {
  const { isLoggedIn } = useAuth();
  useSEO({
    title: "Learn VeritaAssure™ | Getting-Started Video Library",
    description:
      "Short getting-started videos for every VeritaAssure™ module: performance verification, test menu mapping, inspection readiness, QC, staffing, and cost per reportable test. Built by a former Joint Commission laboratory surveyor.",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="border-b border-border bg-gradient-to-br from-primary/10 via-primary/4 to-transparent">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
            Video Library
          </Badge>
          <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-4 leading-tight">
            Learn VeritaAssure&#8482;
          </h1>
          <p className="text-xl text-primary font-semibold mb-3">
            See every module in about thirty seconds.
          </p>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed mb-8">
            One short getting-started video for each of the seventeen modules. No sign-in, no sales call.
            Watch how a lab builds its test menu, runs a verification study, and stays inspection-ready,
            then try the same flow yourself in the live demo.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/demo">
                <Play size={15} className="mr-1.5" /> Try the Live Demo
              </Link>
            </Button>
            {!isLoggedIn && (
              <Button asChild size="lg" variant="outline">
                <Link href="/veritaassure">
                  Explore the Suite <ChevronRight size={14} className="ml-1" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14 space-y-16">
        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            Compliance
          </div>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
            Eleven modules for staying inspection-ready, starting with the two that set VeritaAssure&#8482; apart:
            performance verification and the coverage map behind it.
          </p>
          <LessonGrid modules={COMPLIANCE} />
        </section>

        <section>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2">
            Operations
          </div>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl">
            Six modules for running the lab well: cost per reportable test, inventory, staffing, productivity,
            shift coverage, and quality metrics.
          </p>
          <LessonGrid modules={OPERATIONS} />
        </section>

        {/* Closing CTA */}
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-8 text-center">
          <h2 className="font-serif text-2xl font-bold mb-2">Ready to try it on your own lab?</h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-6">
            The live demo runs the same flows you just watched, on a sample laboratory. No installation,
            no credit card.
          </p>
          <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            <Link href="/demo">
              <Play size={15} className="mr-1.5" /> Open the Live Demo
            </Link>
          </Button>
        </section>
      </div>
    </div>
  );
}
