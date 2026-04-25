import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Award, Users, Shield, BarChart3, FlaskConical, BookOpen, ExternalLink, CheckCircle2, Star, Play, MapPin, AlertTriangle, ArrowRight, Briefcase, Wrench, Handshake, GraduationCap, Building2, UserCheck } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

const services = [
  { icon: Users, title: "Leadership Coaching", desc: "One-on-one coaching for lab directors and managers. You pick the topics: C-suite relationships, team development, career advancement." },
  { icon: Shield, title: "Inspection Readiness", desc: "Mock regulatory surveys simulating CLIA, TJC, CAP, COLA, and FDA inspections. Led by a former Joint Commission Surveyor with 200+ facility inspections." },
  { icon: BarChart3, title: "Productivity Analysis", desc: "Expert on-site assessment of workflows, staffing, and resources using industry benchmarks. Actionable reports with data-driven recommendations." },
  { icon: BookOpen, title: "Educational Webinars", desc: "Facility webinars on blood administration, QC/QA, delegation of authority, and lab survey preparation, tailored to your team's needs." },
  { icon: Award, title: "Interim Lab Director", desc: "Experienced interim Lab Administrative Directors who ensure uninterrupted operations and regulatory compliance during leadership transitions." },
  { icon: FlaskConical, title: "VeritaCheck™ - Lab Study Platform", desc: "Our web-based EP evaluation tool, automated calibration verification and method comparison with CLIA-compliant PDF reports.", link: "/veritacheck", linkLabel: "Try VeritaCheck™ Free" },
];

const stats = [
  { value: "200+", label: "Facilities surveyed" },
  { value: "6", label: "Software Products" },
  { value: "168", label: "Compliance items tracked" },
  { value: "22 yrs", label: "Industry experience" },
];

export default function HomePage() {
    useSEO({ title: "Veritas Lab Services | Clinical Laboratory Compliance Software", description: "VeritaAssure™ is the all-in-one compliance platform for clinical laboratories. Method validation, inspection readiness, PT gap analysis, competency tracking, and more." });
return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-28">
          <div className="max-w-3xl">
            <div className="flex gap-2 mb-5">
              <Badge variant="outline" className="text-primary border-primary/30 bg-primary/5 font-medium">
                Consulting
              </Badge>
              <Badge className="bg-primary text-primary-foreground font-medium">
                Software Suite
              </Badge>
            </div>
            <h1 className="font-serif text-4xl sm:text-5xl font-bold tracking-tight mb-5 leading-tight text-foreground">
              You spent years mastering the science. Nobody taught you the compliance.
            </h1>
            <p className="text-lg text-muted-foreground mb-8 leading-relaxed max-w-2xl">
              VeritaAssure™ gives every lab professional the tools, the structure, and the confidence to walk into any survey ready.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              {/* Mobile: VeritaCheck primary, Explore secondary */}
              <Button asChild size="lg" className="sm:hidden bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                <Link href="/veritacheck">Try VeritaCheck™ Free <ChevronRight size={16} className="ml-1" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="sm:hidden">
                <Link href="/demo">Explore VeritaAssure™</Link>
              </Button>
              {/* Desktop: Explore primary, VeritaCheck secondary */}
              <Button asChild size="lg" className="hidden sm:inline-flex bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                <Link href="/demo">Explore VeritaAssure™ <ChevronRight size={16} className="ml-1" /></Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="hidden sm:inline-flex">
                <Link href="/veritacheck">Try VeritaCheck™ Free</Link>
              </Button>
            </div>
            <Link href="/demo" className="sm:hidden inline-flex items-center gap-1 text-sm text-primary font-medium mt-3 hover:underline">
              See it in action - no login required <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Pull Quote */}
      <section className="border-b border-border">
        <div className="max-w-[700px] mx-auto px-4 sm:px-6 py-10">
          <blockquote className="border-l-4 border-[#01696F] bg-[#F0FAFA] rounded-lg px-6 py-5">
            <p className="italic leading-relaxed mb-2" style={{ color: '#1B4B4E' }}>
              "I became a laboratory director without ever being taught how. That experience is why I built VeritaAssure™."
            </p>
            <footer className="text-sm" style={{ color: '#1B4B4E' }}>
              Michael Veri, MS, MBA, MLS(ASCP), CPHQ | Founder, VeritaAssure™
            </footer>
          </blockquote>
        </div>
      </section>

      {/* Mobile Product Strip */}
      <section className="border-b border-border bg-card sm:hidden">
        <div className="px-4 py-3 overflow-x-auto">
          <div className="flex gap-2 whitespace-nowrap">
            {[
              { name: "VeritaCheck™", href: "/veritacheck" },
              { name: "VeritaMap™", href: "/veritamap" },
              { name: "VeritaScan™", href: "/veritascan" },
              { name: "VeritaComp™", href: "/veritacomp" },
              { name: "VeritaStaff™", href: "/veritastaff" },
              { name: "VeritaLab™", href: "/veritalab" },
            ].map(({ name, href }) => (
              <Link key={name} href={href}>
                <span className="inline-flex items-center px-3 py-1.5 rounded-full border border-primary/30 text-primary text-xs font-medium bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
                  {name}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {stats.map(({ value, label }) => (
            <div key={label}>
              <div className="text-2xl font-bold text-primary font-serif">{value}</div>
              <div className="text-sm sm:text-xs text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Bridge Paragraph */}
      <section className="border-b border-border">
        <div className="max-w-[650px] mx-auto px-4 sm:px-6 py-10 text-center">
          <p className="text-sm text-[#7A7974] leading-relaxed">
            Most labs manage compliance with a folder of spreadsheets, a binder of outdated SOPs, and the hope that nothing has slipped through the cracks. VeritaAssure™ replaces all of that with purpose-built tools designed around what surveyors actually look for.
          </p>
        </div>
      </section>

      {/* Meet VeritaAssure */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl font-bold mb-4">Meet VeritaAssure™</h2>
            <p className="text-lg text-foreground leading-relaxed max-w-[750px] mx-auto mb-6">
              VeritaAssure™ is a suite of six purpose-built compliance tools covering every regulatory requirement a clinical laboratory faces - from EP method validation studies and inspection readiness to competency management, test menu mapping, personnel credentialing, and certificate tracking.
            </p>
            <p className="text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              VeritaAssure™ is the compliance framework behind everything Veritas Lab Services delivers. It combines hands-on consulting with purpose-built software tools (VeritaCheck™, VeritaMap™, VeritaScan™, VeritaComp™, VeritaStaff™, and VeritaLab™) to give your laboratory a complete picture of where it stands and what needs to change. Whether you need a structured mock survey, a workflow gap analysis, or ongoing compliance monitoring, VeritaAssure™ brings the expertise and the tools together so your team isn't scrambling before the next inspection.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <Wrench size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">VeritaAssure™ Tools</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  VeritaCheck™, VeritaMap™, VeritaScan™, VeritaComp™, VeritaStaff™, and VeritaLab™ are the 6 software products of the VeritaAssure™ suite, built for lab directors who want data-driven compliance without waiting on a consultant.
                </p>
                <Button asChild size="sm" variant="outline" className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10">
                  <Link href="/veritacheck">Explore the Tools →</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <Briefcase size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">VeritaAssure™ Consulting</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  Structured mock surveys, regulatory gap analysis, productivity and workflow assessments, leadership coaching, and CLIA Laboratory Director services. On-site expertise aligned with CLIA, CAP, COLA, TJC, and FDA expectations.
                </p>
                <Button asChild size="sm" variant="outline" className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10">
                  <Link href="/services">View Services →</Link>
                </Button>
              </CardContent>
            </Card>
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <Handshake size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">VeritaAssure™ Together</h3>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  For labs that want both: consulting engagements that use the same tools your team works in every day, so the findings don't disappear when the engagement ends.
                </p>
                <Button asChild size="sm" variant="outline" className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10">
                  <Link href="/contact">Contact Us →</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Mission */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="grid sm:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="font-serif text-3xl font-bold mb-4">Our Mission</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Veritas Lab Services' mission is to empower clinical laboratories by providing expert consulting in leadership coaching, comprehensive productivity analysis, and strategic regulatory readiness solutions, ensuring operational excellence and compliance with CLIA standards within every client organization.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Founded by Michael Veri, a US Army veteran, former Joint Commission Surveyor, and published author. VLS was built on the recognition that administrative lab leaders lacked accessible avenues for growth and mentorship.
              </p>
              <Button asChild variant="outline" className="mt-6">
                <Link href="/team">Meet Michael Veri <ChevronRight size={14} className="ml-1" /></Link>
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: CheckCircle2, text: "CLIA standards expertise" },
                { icon: CheckCircle2, text: "TJC / CAP / COLA / FDA" },
                { icon: CheckCircle2, text: "Published author & speaker" },
                { icon: CheckCircle2, text: "CPHQ credential holder" },
                { icon: CheckCircle2, text: "200+ facility inspections" },
                { icon: CheckCircle2, text: "On-site & remote support" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-2 text-sm">
                  <Icon size={15} className="text-primary shrink-0" />
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Services */}
      <section className="section-padding border-b border-border bg-secondary/20">
        <div className="container-default">
          <div className="text-center mb-12">
            <h2 className="font-serif text-3xl font-bold mb-3">Available Services</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">From on-site inspections to digital EP analysis, comprehensive support for your laboratory.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map(({ icon: Icon, title, desc, link, linkLabel }) => (
              <Card key={title} className="border-border hover:border-primary/30 transition-colors group bg-card">
                <CardContent className="p-5">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                    <Icon size={18} />
                  </div>
                  <h3 className="font-semibold text-sm mb-2">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed mb-3">{desc}</p>
                  {link && (
                    <Button asChild size="sm" variant="outline" className="text-xs h-7 border-primary/30 text-primary hover:bg-primary/10">
                      <Link href={link}>{linkLabel} →</Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="text-center mt-8">
            <Button asChild variant="outline">
              <Link href="/services">See Full Service Details <ChevronRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* VeritaCheck CTA banner */}
      <section className="section-padding border-b border-border bg-primary/5">
        <div className="container-default text-center">
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary rounded-full px-4 py-1.5 text-sm font-semibold mb-4">
            <FlaskConical size={14} />
            New Tool - VeritaCheck™
          </div>
          <h2 className="font-serif text-3xl font-bold mb-3">The studies your lab has always run, finally done right.</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-6 leading-relaxed">
            Calibration verification and method comparison, automated and browser-based. CLIA-compliant PDF reports with scatter plots, percent recovery charts, and pass/fail evaluation, no desktop software required.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritacheck">Try VeritaCheck™ Free <ChevronRight size={16} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/pricing">See Pricing</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Training Section */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="text-center mb-10">
            <h2 className="font-serif text-3xl font-bold mb-4">Built to Teach. Built to Lead.</h2>
            <p className="text-muted-foreground max-w-3xl mx-auto leading-relaxed">
              Most lab directors learn compliance the hard way. VeritaAssure changes that. Every module is built around the regulatory requirements it satisfies, so using the software teaches you why each requirement exists, not just how to document it. New directors build institutional knowledge. Supervisors develop inspection readiness. Health systems create a shared compliance foundation across every lab they run.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <GraduationCap size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">For New Directors</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Build your test menu map, run your first EP study, and establish your compliance baseline in your first 90 days.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <UserCheck size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">For Developing Leaders</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Assign supervisors to own one module at a time. They learn the regulatory framework by doing the work, not reading about it.
                </p>
              </CardContent>
            </Card>
            <Card className="border-border hover:border-primary/30 transition-colors group bg-card">
              <CardContent className="p-5">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-3 text-primary group-hover:bg-primary/20 transition-colors">
                  <Building2 size={18} />
                </div>
                <h3 className="font-semibold text-sm mb-2">For Health Systems</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  A shared compliance environment across multiple labs. Standards, documentation, and knowledge that survives leadership transitions.
                </p>
              </CardContent>
            </Card>
          </div>
          <div className="text-center mt-8">
            <Button asChild variant="outline">
              <Link href="/resources/how-veritaassure-trains-lab-leaders">Read: How VeritaAssure Trains the Next Generation of Lab Leaders <ChevronRight size={14} className="ml-1" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* ── Demo Teaser ── */}
      <section className="section-padding border-b border-border">
        <div className="container-default">
          <div className="rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent overflow-hidden">
            <div className="grid sm:grid-cols-2 gap-0">
              {/* Left — copy */}
              <div className="p-8 sm:p-10">
                <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5 font-medium">
                  See It In Action
                </Badge>
                <h2 className="font-serif text-2xl sm:text-3xl font-bold mb-3 leading-tight">
                  Watch the entire compliance workflow, live.
                </h2>
                <p className="text-muted-foreground text-sm leading-relaxed mb-5">
                  Follow a real hospital lab from test menu mapping to flagged compliance gaps, then watch those gaps get closed with EP studies and an inspection readiness score. No login. No demo call. Just the product.
                </p>
                <div className="space-y-2 mb-6">
                  {[
                    { icon: MapPin, text: "VeritaMap™ surfaces 2 compliance gaps across 5 analytes" },
                    { icon: FlaskConical, text: "VeritaCheck™ runs the EP studies and generates signed PDF reports" },
                    { icon: Shield, text: "VeritaScan™ scores inspection readiness across CLIA, TJC & CAP" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-2.5 text-sm">
                      <Icon size={14} className="text-primary shrink-0" />
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
                <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                  <Link href="/demo"><Play size={15} className="mr-2" />Launch Interactive Demo</Link>
                </Button>
              </div>
              {/* Right — preview cards */}
              <div className="bg-muted/30 border-l border-border p-6 flex flex-col justify-center gap-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Demo Preview - Riverside Regional Medical Center</div>
                {[
                  { analyte: "Glucose", status: "PASS", color: "emerald" },
                  { analyte: "Hemoglobin", status: "OVERDUE", color: "red" },
                  { analyte: "Prothrombin Time", status: "GAP", color: "amber" },
                  { analyte: "Creatinine", status: "PASS", color: "emerald" },
                  { analyte: "Urine hCG", status: "PASS", color: "emerald" },
                ].map(({ analyte, status, color }) => (
                  <div key={analyte} className="flex items-center justify-between bg-card rounded-lg border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{analyte}</span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                      color === "emerald" ? "text-emerald-700 bg-emerald-50 border-emerald-200" :
                      color === "red" ? "text-red-700 bg-red-50 border-red-200" :
                      "text-amber-700 bg-amber-50 border-amber-200"
                    }`}>{status}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2 text-xs text-amber-600 font-medium mt-1">
                  <AlertTriangle size={12} /> 2 compliance gaps detected, click to resolve
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Newsletter */}
      <section className="section-padding border-b border-border">
        <div className="container-default max-w-2xl">
          <NewsletterSignup variant="banner" source="homepage" />
        </div>
      </section>

      {/* Publications */}
      <section className="section-padding">
        <div className="container-default">
          <h2 className="font-serif text-2xl font-bold mb-6 text-center">Published Work</h2>
          <div className="grid sm:grid-cols-2 gap-4 max-w-3xl mx-auto">
            {[
              { title: "Co-Own Blood Administration Among Lab, Nursing and Providers", url: "https://www.medlabmag.com/article/2195" },
              { title: "Laboratory Leadership's View of Accreditation", url: "https://www.medlabmag.com/article/1766" },
              { title: "Forming a Blood Utilization and Management Program", url: "https://www.medlabmag.com/article/1732" },
              { title: "Capturing Productivity in the Laboratory", url: "https://www.medlabmag.com/article/1575" },
            ].map(({ title, url }) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-3 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-secondary/50 transition-colors group">
                <Star size={14} className="text-primary mt-0.5 shrink-0" />
                <span className="text-sm font-medium group-hover:text-primary transition-colors">{title}</span>
                <ExternalLink size={12} className="shrink-0 mt-0.5 text-muted-foreground ml-auto" />
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
