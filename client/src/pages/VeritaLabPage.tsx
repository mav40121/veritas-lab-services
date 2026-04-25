import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Shield, ChevronRight, FileText, Bell, Archive, Award, AlertTriangle } from "lucide-react";

const FEATURE_CARDS = [
  {
    icon: FileText,
    title: "Certificate Tracking",
    desc: "CLIA auto-populated from your account. Add CAP, TJC, state licenses, and lab director credentials. Never miss a renewal.",
    color: "text-teal-600 bg-teal-500/10 border-teal-500/20",
  },
  {
    icon: Bell,
    title: "Advance Reminders",
    desc: "Automated reminders at 9 months, 6 months, 3 months, 30 days, and expiration. Delivered to your inbox.",
    color: "text-blue-600 bg-blue-500/10 border-blue-500/20",
  },
  {
    icon: Archive,
    title: "Document Archive",
    desc: "Upload and store your actual certificate PDFs. Retrieve them instantly during a survey or renewal process.",
    color: "text-amber-600 bg-amber-500/10 border-amber-500/20",
  },
];

const FEATURES = [
  "CLIA certificate auto-populated from your account CLIA lookup data",
  "Track CAP accreditation, TJC accreditation, state licenses, and lab director licenses",
  "Configurable expiration reminders: 9 months, 6 months, 3 months, 30 days, and at expiration",
  "Reminders delivered via email to the account owner",
  "Upload and archive actual certificate PDFs, scanned images, and supporting documents",
  "Color-coded status badges: expired, expiring soon, current, no date entered",
  "Certificate type badges: CLIA (teal), CAP (blue), TJC (purple), State (orange), Other (gray)",
  "Excel export with status color coding and days-until-expiration calculations",
  "Auto-detection of missing expiration dates on CLIA auto-populated records",
  "Built by a former TJC laboratory surveyor who has reviewed certificate records at 200+ facilities",
];

export default function VeritaLabPage() {
    useSEO({ title: "VeritaLab\u2122 | Laboratory Certificate and Document Storage Software", description: "Centralized storage for laboratory accreditation certificates, licenses, and compliance documents. Never scramble for paperwork during a survey again." });
return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Award size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaLab{"™"}</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Laboratory Certificate and Accreditation Tracking
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Track CLIA certificates, accreditation renewals, state licenses, and lab director credentials in one place. Get advance reminders before anything expires. Store your certificates securely."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Every laboratory inspection begins with a review of your certificates and accreditations. Surveyors check CLIA certificates, state licenses, accreditation status, and lab director credentials before they even walk through the door. VeritaLab{"™"} keeps all of these records organized, sends you reminders well before anything expires, and stores your actual certificate documents so you can retrieve them in seconds.
              </p>

              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Included</div>
                  <div className="text-xs text-muted-foreground">in all VeritaAssure™ plans</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Link href="/veritalab-app">Open VeritaLab{"™"} <ChevronRight size={15} className="ml-1" /></Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/login">Sign In / Create Account</Link>
                </Button>
              </div>
            </div>

            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                  <Award size={40} className="text-white/80 mb-4" />
                  <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                    VeritaLab{"™"}
                  </div>
                  <div className="text-sm text-white/70 text-center mb-4">Certificate &<br />Accreditation Tracking</div>
                  <div className="w-12 h-0.5 bg-white/40 mb-4" />
                  <div className="text-xs text-white/60 text-center">CLIA {"\u00B7"} CAP {"\u00B7"} TJC</div>
                </div>
                <div className="absolute -bottom-3 -right-3 w-16 h-16 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg">
                  <Shield size={28} className="text-white" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WIP Banner */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 mt-6">
        <div className="bg-amber-50 border border-amber-400 text-amber-800 rounded-lg px-5 py-4 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">
            VeritaLab{"™"} is newly launched. Core tracking and reminders are functional. Additional features are being added.
          </p>
        </div>
      </div>

      {/* Three Feature Cards */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-3">What VeritaLab{"™"} Does</h2>
            <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-10">
              Three core functions to keep your certificates and accreditations current, documented, and accessible.
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

      {/* Key Features */}
      <section className="section-padding border-b border-border bg-muted/20">
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
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="max-w-5xl mx-auto">
            <h2 className="font-serif text-3xl font-bold text-center mb-10">How It Works</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { step: "1", title: "Auto-Detect CLIA", desc: "Your CLIA certificate is auto-populated from the CLIA lookup you completed at signup. Just add your expiration date." },
                { step: "2", title: "Add Certificates", desc: "Add CAP, TJC, state licenses, lab director credentials, and any other certificates your lab holds." },
                { step: "3", title: "Get Reminders", desc: "Automated email reminders fire at 9 months, 6 months, 3 months, 30 days, and on the expiration date." },
                { step: "4", title: "Archive Documents", desc: "Upload your actual certificate PDFs and scanned images. Retrieve them instantly when a surveyor asks." },
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
          <h2 className="font-serif text-3xl font-bold mb-4">Ready to track your certificates?</h2>
          <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
            Stop scrambling to find certificates before an inspection. VeritaLab{"™"} keeps everything organized and reminds you before anything expires.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritalab-app">Open VeritaLab{"™"} <ChevronRight size={15} className="ml-1" /></Link>
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
