import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, FlaskConical, ChevronRight, ClipboardList, AlertTriangle, Shield } from "lucide-react";
import { useAuth } from "@/components/AuthContext";

const FEATURES = [
  "Track PT enrollment by analyte, specialty, and PT provider",
  "Enter survey results with peer comparison and automatic SDI calculation",
  "Corrective action documentation with root cause, action taken, and verification",
  "Surveyor-ready PDF report with full PT history by analyte",
  "Integrates with VeritaScan™ to auto-complete PT compliance checklist items",
];

const HOW_IT_WORKS = [
  { step: "1", title: "Add Enrollments", desc: "Record each analyte you are enrolled for, along with the PT provider, program code, and specialty." },
  { step: "2", title: "Enter Survey Results", desc: "Log your result for each PT event along with peer mean, peer SD, and acceptable range. SDI is calculated automatically." },
  { step: "3", title: "Close the Loop on Failures", desc: "For any unacceptable result, document the root cause, corrective action, and verification. Required by CLIA 42 CFR 493.801 and CAP checklist requirements." },
  { step: "4", title: "Generate Your Report", desc: "Download a surveyor-ready PDF covering all enrollments, events, and corrective actions. Have it ready before the survey window opens." },
];

export default function VeritaPTPage() {
  const { isLoggedIn } = useAuth();

    useSEO({ title: "VeritaPT™ | Proficiency Testing Gap Analyzer for Clinical Labs", description: "Identify PT coverage gaps in your laboratory test menu. Ensure every analyte has a proficiency testing program and stay compliant with CLIA PT requirements." });
return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <FlaskConical size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">VeritaPT™</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaPT™</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Proficiency Testing Tracking
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Proficiency testing, tracked the way inspectors expect."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-8">
                Track PT enrollment, survey results, and corrective actions by analyte. Monitor unacceptable results, close the loop with documented corrective actions, and generate surveyor-ready reports in seconds.
              </p>
              <div className="flex flex-wrap gap-3">
                {isLoggedIn ? (
                  <Button asChild size="lg">
                    <Link href="/veritapt/app">Start Tracking PT <ChevronRight size={16} className="ml-1" /></Link>
                  </Button>
                ) : (
                  <Button asChild size="lg">
                    <Link href="/login">Sign In to Access VeritaPT™ <ChevronRight size={16} className="ml-1" /></Link>
                  </Button>
                )}
                <Button variant="outline" size="lg" asChild>
                  <Link href="/demo">View Live Demo</Link>
                </Button>
              </div>
            </div>
            <div className="hidden lg:block">
              <Card className="border-primary/20 shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ClipboardList size={18} className="text-primary" />
                    <span className="font-semibold text-sm">PT Summary</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[
                      { label: "Active Enrollments", value: "12" },
                      { label: "Events This Year", value: "24" },
                      { label: "Pass Rate", value: "95.8%" },
                      { label: "Open CAs", value: "1" },
                    ].map((item) => (
                      <div key={item.label} className="bg-muted/50 rounded-lg p-3 text-center">
                        <div className="text-2xl font-bold text-primary">{item.value}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {[
                      { analyte: "Glucose", event: "2026-B", result: "PASS" },
                      { analyte: "Hemoglobin A1c", event: "2026-A", result: "PASS" },
                      { analyte: "PT/INR", event: "2026-A", result: "PASS" },
                    ].map((row) => (
                      <div key={row.analyte} className="flex items-center justify-between text-sm p-2 rounded bg-muted/30">
                        <span className="font-medium">{row.analyte}</span>
                        <span className="text-xs text-muted-foreground">{row.event}</span>
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border text-xs">
                          {row.result}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b border-border">
        <div className="container-default py-14">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl font-bold mb-2 text-center">What VeritaPT™ Tracks</h2>
            <p className="text-muted-foreground text-center mb-10">Everything an inspector expects to find, organized and retrievable in seconds.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {FEATURES.map((f) => (
                <div key={f} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-card">
                  <CheckCircle2 size={18} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-sm leading-relaxed">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="border-b border-border bg-muted/30">
        <div className="container-default py-14">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl font-bold mb-2 text-center">How It Works</h2>
            <p className="text-muted-foreground text-center mb-10">Four steps from enrollment to surveyor-ready report.</p>
            <div className="grid sm:grid-cols-2 gap-6">
              {HOW_IT_WORKS.map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold text-sm">
                    {item.step}
                  </div>
                  <div>
                    <div className="font-semibold mb-1">{item.title}</div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Regulatory context */}
      <section className="border-b border-border">
        <div className="container-default py-14">
          <div className="max-w-3xl mx-auto">
            <h2 className="font-serif text-3xl font-bold mb-6 text-center">Regulatory Framework</h2>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { name: "42 CFR 493.801", desc: "CLIA PT enrollment and testing requirements" },
                { name: "CAP PT Checklist", desc: "GEN and specialty checklist PT requirements" },
                { name: "TJC Standard", desc: "Proficiency testing and result review requirements" },
              ].map((s) => (
                <Card key={s.name} className="border-primary/20">
                  <CardContent className="p-4 text-center">
                    <Shield size={20} className="text-primary mx-auto mb-2" />
                    <div className="font-semibold text-sm mb-1">{s.name}</div>
                    <div className="text-xs text-muted-foreground">{s.desc}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-6 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 flex items-start gap-3">
              <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800 dark:text-amber-300">
                Unacceptable PT results require documented corrective action including root cause analysis. VeritaPT™ provides the documentation structure. Final review and approval must be completed by the laboratory director or designee.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-primary/5 border-b border-border">
        <div className="container-default py-14 text-center">
          <h2 className="font-serif text-3xl font-bold mb-3">Ready to track PT the right way?</h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-8">
            VeritaPT™ is included in your VeritaAssure™ subscription. Sign in to get started.
          </p>
          {isLoggedIn ? (
            <Button asChild size="lg">
              <Link href="/veritapt/app">Open VeritaPT™ <ChevronRight size={16} className="ml-1" /></Link>
            </Button>
          ) : (
            <div className="flex justify-center gap-3 flex-wrap">
              <Button asChild size="lg">
                <Link href="/register">Get Started</Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/login">Sign In</Link>
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
