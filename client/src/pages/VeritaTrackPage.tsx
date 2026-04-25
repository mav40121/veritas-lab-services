import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck, ChevronRight, CalendarClock, FileSpreadsheet,
  History, BellRing, ListChecks,
} from "lucide-react";

export default function VeritaTrackPage() {
  const { isLoggedIn } = useAuth();

  useSEO({
    title: "VeritaTrack\u2122 | Laboratory QC Task Tracking & Sign-off",
    description:
      "Track recurring QC tasks, daily checks, maintenance, and quality sign-offs across your lab. Due-date alerts, full sign-off history, and Excel export. Included with VeritaAssure\u2122 Suite plans.",
  });

  return (
    <div>
      {/* Landing Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <ClipboardCheck size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">Suite Module</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Included</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaTrack{"\u2122"}</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Laboratory QC Task Tracking and Sign-off
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Every recurring task in your lab, signed off and surveyor-ready."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-4">
                VeritaTrack{"\u2122"} replaces the binders and clipboards your lab uses to document daily, weekly, and monthly QC. Configure recurring tasks across instruments and departments, capture sign-offs with timestamps and analyst initials, and export the full history to Excel for inspection prep.
              </p>
              <ul className="space-y-2 mb-6 text-sm">
                <li className="flex items-start gap-2"><ListChecks size={16} className="text-primary mt-0.5 shrink-0" /><span>Recurring daily, weekly, monthly, and custom-cadence tasks</span></li>
                <li className="flex items-start gap-2"><CalendarClock size={16} className="text-primary mt-0.5 shrink-0" /><span>Color-coded status: Done, Due Soon, Overdue, Not Started</span></li>
                <li className="flex items-start gap-2"><BellRing size={16} className="text-primary mt-0.5 shrink-0" /><span>Due-date alerts so nothing slips through the cracks</span></li>
                <li className="flex items-start gap-2"><History size={16} className="text-primary mt-0.5 shrink-0" /><span>Complete sign-off history with timestamps, initials, and notes</span></li>
                <li className="flex items-start gap-2"><FileSpreadsheet size={16} className="text-primary mt-0.5 shrink-0" /><span>Excel export of any date range for inspector documentation</span></li>
              </ul>

              {/* Pricing */}
              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">From $499/yr</div>
                  <div className="text-xs text-muted-foreground">Included with VeritaAssure{"\u2122"} Suite</div>
                </div>
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">All Plans</div>
                  <div className="text-xs text-muted-foreground">Clinic, Community, Hospital, Enterprise</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {isLoggedIn ? (
                  <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                    <Link href="/veritatrack-app">Open VeritaTrack{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
                  </Button>
                ) : (
                  <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                    <Link href="/login">Launch VeritaTrack{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
                  </Button>
                )}
                <Button asChild variant="outline" size="lg">
                  <Link href="/login">Sign In / Create Account</Link>
                </Button>
              </div>
            </div>

            {/* Right: teal product card */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                  <ClipboardCheck size={40} className="text-white/80 mb-4" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    VeritaTrack{"\u2122"}
                  </div>
                  <div className="text-xs text-white/70 text-center space-y-1 mb-4">
                    <div>Recurring QC Tasks</div>
                    <div>Due-Date Alerts</div>
                    <div>Sign-off History</div>
                    <div>Excel Export</div>
                    <div>Multi-Department</div>
                  </div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-xs text-white/60 text-center">VeritaAssure{"\u2122"} Suite Module</div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
